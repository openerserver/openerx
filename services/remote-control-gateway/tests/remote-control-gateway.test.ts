import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AccessPrincipal, RemoteCommand, RemoteCommandPayload } from "@openerx/contracts";
import {
  commandCipherContext,
  encodeRemoteOpaque,
  encryptRemotePayload,
  generateRemoteDeviceKeyPair,
  remotePairingProof,
  signRemoteCommand,
} from "@openerx/remote-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteControlGateway } from "../src";

const temporaryDirectories: string[] = [];
const gateways = new Set<RemoteControlGateway>();
afterEach(() => {
  for (const gateway of gateways) gateway.close();
  gateways.clear();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const deterministicRandom = (seed: number) => (length: number) =>
  Uint8Array.from({ length }, (_, index) => (seed + index * 29) % 256);

function principal(accountId: string, deviceId: string): AccessPrincipal {
  return { accountId, deviceId, sessionId: randomUUID(), sessionVersion: 1 };
}

function setup(nowRef = { value: new Date("2026-08-26T08:00:00.000Z") }) {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-remote-gateway-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "remote.sqlite");
  const gateway = new RemoteControlGateway(databasePath, { now: () => nowRef.value });
  gateways.add(gateway);
  const accountId = randomUUID();
  const hostDeviceId = randomUUID();
  const controllerDeviceId = randomUUID();
  const hostPrincipal = principal(accountId, hostDeviceId);
  const controllerPrincipal = principal(accountId, controllerDeviceId);
  const hostKeys = generateRemoteDeviceKeyPair(deterministicRandom(11));
  const controllerKeys = generateRemoteDeviceKeyPair(deterministicRandom(23));
  const registered = gateway.registerHost(hostPrincipal, {
    hostDeviceId,
    displayName: "Mac Studio",
    platform: "darwin",
    arch: "arm64",
    appVersion: "2.0.0-alpha.0",
    capabilities: ["chat", "tool", "artifact"],
    remoteEnabled: true,
  });
  gateway.updatePresence(hostPrincipal, {
    hostDeviceId,
    presence: "online",
    revision: registered.revision,
  });
  const challenge = gateway.createPairingChallenge(hostPrincipal, {
    hostDeviceId,
    hostPublicKey: hostKeys.publicKey,
  });
  const pairing = gateway.acceptPairing(controllerPrincipal, {
    challengeId: challenge.challengeId,
    oneTimeNonce: challenge.oneTimeNonce,
    controllerDeviceId,
    controllerPublicKey: controllerKeys.publicKey,
    proof: remotePairingProof(
      challenge.challengeId,
      challenge.oneTimeNonce,
      controllerDeviceId,
      controllerKeys.privateKey,
    ),
  });
  return {
    gateway,
    databasePath,
    nowRef,
    accountId,
    hostDeviceId,
    controllerDeviceId,
    hostPrincipal,
    controllerPrincipal,
    hostKeys,
    controllerKeys,
    pairing,
  };
}

function command(
  state: ReturnType<typeof setup>,
  sequence: number,
  overrides: Partial<RemoteCommand> = {},
): RemoteCommand {
  const commandId = overrides.commandId ?? randomUUID();
  const pairingId = overrides.pairingId ?? state.pairing.pairingId;
  const payload: RemoteCommandPayload = { kind: "session.steer", text: `steer-${sequence}` };
  const encryptedPayload = encryptRemotePayload(
    payload,
    state.controllerKeys.privateKey,
    state.hostKeys.publicKey,
    commandCipherContext({ commandId, pairingId }),
    deterministicRandom(37 + sequence),
  );
  const issuedAt = state.nowRef.value;
  return signRemoteCommand(
    {
      version: 1,
      commandId,
      accountId: state.accountId,
      pairingId,
      controllerDeviceId: state.controllerDeviceId,
      hostDeviceId: state.hostDeviceId,
      conversationId: overrides.conversationId ?? randomUUID(),
      generationId: overrides.generationId ?? randomUUID(),
      kind: "session.steer",
      baseRevision: overrides.baseRevision ?? 1,
      sessionSequence: sequence,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
      idempotencyKey:
        overrides.idempotencyKey ?? `remote-command-${sequence.toString().padStart(4, "0")}`,
      encryptedPayload,
      ...overrides,
    },
    state.controllerKeys.privateKey,
  );
}

describe("RemoteControlGateway", () => {
  it("pairs only same-account devices with a live one-time proof", () => {
    const state = setup();
    expect(state.pairing).toMatchObject({ status: "active", accountId: state.accountId });

    expect(() =>
      state.gateway.acceptPairing(state.controllerPrincipal, {
        challengeId: state.pairing.pairingId,
        oneTimeNonce: "N".repeat(43),
        controllerDeviceId: state.controllerDeviceId,
        controllerPublicKey: state.controllerKeys.publicKey,
        proof: "P".repeat(86),
      }),
    ).toThrow("REMOTE_PAIRING_CHALLENGE_NOT_FOUND");

    const challenge = state.gateway.createPairingChallenge(state.hostPrincipal, {
      hostDeviceId: state.hostDeviceId,
      hostPublicKey: state.hostKeys.publicKey,
    });
    const attacker = principal(randomUUID(), randomUUID());
    expect(() =>
      state.gateway.acceptPairing(attacker, {
        challengeId: challenge.challengeId,
        oneTimeNonce: challenge.oneTimeNonce,
        controllerDeviceId: attacker.deviceId,
        controllerPublicKey: state.controllerKeys.publicKey,
        proof: remotePairingProof(
          challenge.challengeId,
          challenge.oneTimeNonce,
          attacker.deviceId,
          state.controllerKeys.privateKey,
        ),
      }),
    ).toThrow("ACCOUNT_SCOPE_VIOLATION");
  });

  it("routes signed commands once and rejects replay conflicts, ordering and offline writes", () => {
    const state = setup();
    const conversationId = randomUUID();
    const first = command(state, 1, { conversationId });
    expect(state.gateway.submitCommand(state.controllerPrincipal, first)).toMatchObject({
      status: "submitted",
    });
    expect(state.gateway.submitCommand(state.controllerPrincipal, first)).toMatchObject({
      commandId: first.commandId,
      status: "submitted",
    });
    expect(state.gateway.pullHostCommands(state.hostPrincipal, state.hostDeviceId)).toEqual([
      first,
    ]);

    expect(() =>
      state.gateway.submitCommand(
        state.controllerPrincipal,
        command(state, 1, { conversationId, idempotencyKey: "remote-out-of-order" }),
      ),
    ).toThrow("REMOTE_SEQUENCE_OUT_OF_ORDER");
    expect(() =>
      state.gateway.submitCommand(state.controllerPrincipal, { ...first, baseRevision: 99 }),
    ).toThrow("REMOTE_COMMAND_SIGNATURE_INVALID");

    const host = state.gateway.listHosts(state.hostPrincipal)[0];
    if (!host) throw new Error("host missing");
    state.gateway.updatePresence(state.hostPrincipal, {
      hostDeviceId: state.hostDeviceId,
      presence: "offline",
      revision: host.revision,
    });
    expect(() =>
      state.gateway.submitCommand(state.controllerPrincipal, command(state, 2, { conversationId })),
    ).toThrow("REMOTE_HOST_OFFLINE");
  });

  it("enforces receipt transitions and cursor visibility without storing plaintext", () => {
    const state = setup();
    const submitted = command(state, 1);
    state.gateway.submitCommand(state.controllerPrincipal, submitted);
    const now = state.nowRef.value.toISOString();
    expect(
      state.gateway.recordReceipt(state.hostPrincipal, {
        version: 1,
        commandId: submitted.commandId,
        accountId: state.accountId,
        pairingId: state.pairing.pairingId,
        hostDeviceId: state.hostDeviceId,
        status: "accepted",
        resultCode: null,
        appliedRevision: null,
        receivedAt: now,
        updatedAt: now,
      }),
    ).toMatchObject({ status: "accepted" });
    expect(
      state.gateway.recordReceipt(state.hostPrincipal, {
        version: 1,
        commandId: submitted.commandId,
        accountId: state.accountId,
        pairingId: state.pairing.pairingId,
        hostDeviceId: state.hostDeviceId,
        status: "applied",
        resultCode: "OK",
        appliedRevision: 2,
        receivedAt: now,
        updatedAt: now,
      }),
    ).toMatchObject({ status: "applied", appliedRevision: 2 });

    const event = state.gateway.publishEvent(state.hostPrincipal, {
      pairingId: state.pairing.pairingId,
      controllerDeviceId: state.controllerDeviceId,
      event: {
        version: 1,
        eventId: randomUUID(),
        accountId: state.accountId,
        hostDeviceId: state.hostDeviceId,
        conversationId: submitted.conversationId,
        kind: "message.completed",
        occurredAt: now,
        encryptedPayload: encodeRemoteOpaque({
          status: "completed",
          padding: "opaque-event-payload-padding",
        }),
      },
      expiresAt: new Date(state.nowRef.value.getTime() + 60_000).toISOString(),
    });
    expect(
      state.gateway.listEvents(state.controllerPrincipal, {
        hostDeviceId: state.hostDeviceId,
        afterCursor: null,
      }),
    ).toEqual([event]);
    expect(
      state.gateway.acknowledgeCursor(state.controllerPrincipal, {
        hostDeviceId: state.hostDeviceId,
        conversationId: submitted.conversationId,
        cursor: event.cursor,
      }),
    ).toMatchObject({ cursor: event.cursor });
    expect(JSON.stringify(state.gateway.auditRows())).not.toContain("steer-1");
  });

  it("persists pairings and pending command delivery across gateway restart", () => {
    const state = setup();
    const pending = command(state, 1);
    state.gateway.submitCommand(state.controllerPrincipal, pending);
    state.gateway.close();
    gateways.delete(state.gateway);

    const restarted = new RemoteControlGateway(state.databasePath, {
      now: () => state.nowRef.value,
    });
    expect(restarted.listPairings(state.hostPrincipal)).toEqual([
      expect.objectContaining({ pairingId: state.pairing.pairingId, status: "active" }),
    ]);
    expect(restarted.pullHostCommands(state.hostPrincipal, state.hostDeviceId)).toEqual([pending]);
    restarted.close();
  });

  it("revokes pairings and exposes only opaque push routing identifiers", () => {
    const state = setup();
    const revoked = state.gateway.revokePairing(state.controllerPrincipal, state.pairing.pairingId);
    expect(revoked.status).toBe("revoked");
    expect(() => state.gateway.submitCommand(state.controllerPrincipal, command(state, 1))).toThrow(
      "REMOTE_PAIRING_NOT_ACTIVE",
    );
    const envelope = state.gateway.createPushEnvelope({
      version: 1,
      category: "attention",
      hostDeviceId: state.hostDeviceId,
      conversationId: randomUUID(),
      attentionRequestId: randomUUID(),
      eventId: randomUUID(),
    });
    expect(Object.keys(envelope).sort()).toEqual([
      "attentionRequestId",
      "category",
      "conversationId",
      "eventId",
      "hostDeviceId",
      "version",
    ]);
  });
});
