import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AccessPrincipal,
  RemoteApplyCommandResponseFrame,
  RemoteCommand,
  RemoteCommandPayload,
  RemoteEventPublishInput,
  RemoteHostRegistrationInput,
} from "@openerx/contracts";
import { RemoteControlGateway } from "@openerx/remote-control-gateway";
import { type RemoteGatewayTransport, RemoteHostConnector } from "@openerx/remote-host";
import {
  commandCipherContext,
  decryptRemoteObject,
  encryptRemotePayload,
  generateRemoteDeviceKeyPair,
  remotePairingProof,
  signRemoteCommand,
} from "@openerx/remote-protocol";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const deterministicRandom = (seed: number) => (length: number) =>
  Uint8Array.from({ length }, (_, index) => (seed + index * 31) % 256);

function principal(accountId: string, deviceId: string): AccessPrincipal {
  return { accountId, deviceId, sessionId: randomUUID(), sessionVersion: 1 };
}

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-connector-"));
  directories.push(directory);
  const nowRef = { value: new Date("2026-08-26T09:00:00.000Z") };
  const gateway = new RemoteControlGateway(path.join(directory, "gateway.sqlite"), {
    now: () => nowRef.value,
  });
  const accountId = randomUUID();
  const hostDeviceId = randomUUID();
  const controllerDeviceId = randomUUID();
  const hostPrincipal = principal(accountId, hostDeviceId);
  const controllerPrincipal = principal(accountId, controllerDeviceId);
  const hostKeys = generateRemoteDeviceKeyPair(deterministicRandom(3));
  const controllerKeys = generateRemoteDeviceKeyPair(deterministicRandom(17));
  const host: RemoteHostRegistrationInput = {
    hostDeviceId,
    displayName: "Windows Workstation",
    platform: "win32",
    arch: "x64",
    appVersion: "2.0.0-alpha.0",
    capabilities: ["chat", "tool", "review"],
    remoteEnabled: true,
  };
  const registered = gateway.registerHost(hostPrincipal, host);
  const online = gateway.updatePresence(hostPrincipal, {
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
  class Transport implements RemoteGatewayTransport {
    replay: RemoteCommand | null = null;
    registerHost(input: RemoteHostRegistrationInput) {
      return Promise.resolve(gateway.registerHost(hostPrincipal, input));
    }
    updatePresence(input: {
      hostDeviceId: string;
      presence: "online" | "degraded" | "offline";
      revision: number;
    }) {
      return Promise.resolve(gateway.updatePresence(hostPrincipal, input));
    }
    listPairings() {
      return Promise.resolve(gateway.listPairings(hostPrincipal));
    }
    pullCommands(target: string, limit: number) {
      return Promise.resolve(
        this.replay ? [this.replay] : gateway.pullHostCommands(hostPrincipal, target, limit),
      );
    }
    recordReceipt(receipt: Parameters<typeof gateway.recordReceipt>[1]) {
      return Promise.resolve(gateway.recordReceipt(hostPrincipal, receipt));
    }
    publishEvent(input: RemoteEventPublishInput) {
      return Promise.resolve(gateway.publishEvent(hostPrincipal, input));
    }
  }
  const transport = new Transport();
  const makeCommand = (
    payload: RemoteCommandPayload,
    sequence = 1,
    baseRevision = 4,
  ): RemoteCommand => {
    const commandId = randomUUID();
    const encryptedPayload = encryptRemotePayload(
      payload,
      controllerKeys.privateKey,
      hostKeys.publicKey,
      commandCipherContext({ commandId, pairingId: pairing.pairingId }),
      deterministicRandom(41 + sequence),
    );
    return signRemoteCommand(
      {
        version: 1,
        commandId,
        accountId,
        pairingId: pairing.pairingId,
        controllerDeviceId,
        hostDeviceId,
        conversationId: randomUUID(),
        generationId: randomUUID(),
        kind: payload.kind,
        baseRevision,
        sessionSequence: sequence,
        issuedAt: nowRef.value.toISOString(),
        expiresAt: new Date(nowRef.value.getTime() + 60_000).toISOString(),
        idempotencyKey: `remote-host-${sequence.toString().padStart(4, "0")}`,
        encryptedPayload,
      },
      controllerKeys.privateKey,
    );
  };
  return {
    directory,
    nowRef,
    gateway,
    accountId,
    controllerPrincipal,
    hostKeys,
    controllerKeys,
    pairing,
    host,
    online,
    transport,
    makeCommand,
  };
}

describe("RemoteHostConnector", () => {
  it("decrypts and applies a valid command once across Relay redelivery", async () => {
    const state = setup();
    const remoteCommand = state.makeCommand({ kind: "session.steer", text: "先运行测试" });
    state.gateway.submitCommand(state.controllerPrincipal, remoteCommand);
    let applications = 0;
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier: {
        currentRevision: async () => 4,
        apply: async (_command, payload) => {
          applications += 1;
          expect(payload).toEqual({ kind: "session.steer", text: "先运行测试" });
          return {
            kind: "remote.command.result",
            requestId: randomUUID(),
            ok: true,
            appliedRevision: 5,
          };
        },
      },
    });
    await connector.start();
    expect(await connector.tick()).toBe(1);
    state.transport.replay = remoteCommand;
    expect(await connector.tick()).toBe(1);
    expect(applications).toBe(1);
    connector.close();
    state.gateway.close();
  });

  it("keeps accepted work retryable when the App Service response is lost", async () => {
    const state = setup();
    const remoteCommand = state.makeCommand({ kind: "session.follow_up", text: "完成后总结" });
    state.gateway.submitCommand(state.controllerPrincipal, remoteCommand);
    const applied = new Map<string, RemoteApplyCommandResponseFrame>();
    let sideEffects = 0;
    let loseFirstReply = true;
    const applier = {
      currentRevision: async () => 4,
      apply: async (command: RemoteCommand) => {
        let result = applied.get(command.commandId);
        if (!result) {
          sideEffects += 1;
          result = {
            kind: "remote.command.result" as const,
            requestId: randomUUID(),
            ok: true as const,
            appliedRevision: 5,
          };
          applied.set(command.commandId, result);
        }
        if (loseFirstReply) {
          loseFirstReply = false;
          throw new Error("APP_SERVICE_CHANNEL_LOST");
        }
        return result;
      },
    };
    const databasePath = path.join(state.directory, "connector.sqlite");
    const first = new RemoteHostConnector({
      databasePath,
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier,
    });
    await first.start();
    await expect(first.tick()).rejects.toThrow("APP_SERVICE_CHANNEL_LOST");
    first.close();

    const restarted = new RemoteHostConnector({
      databasePath,
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier,
    });
    await restarted.start();
    await restarted.tick();
    expect(sideEffects).toBe(1);
    restarted.close();
    state.gateway.close();
  });

  it("publishes a safe reconciliation event when App Service reports an unknown outcome", async () => {
    const state = setup();
    const remoteCommand = state.makeCommand({ kind: "session.follow_up", text: "apply changes" });
    state.gateway.submitCommand(state.controllerPrincipal, remoteCommand);
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier: {
        currentRevision: async () => 4,
        apply: async () => ({
          kind: "remote.command.result",
          requestId: remoteCommand.commandId,
          ok: false,
          errorCode: "REMOTE_COMMAND_OUTCOME_UNKNOWN",
          currentRevision: 4,
        }),
      },
    });
    await connector.start();
    await connector.tick();
    const [event] = state.gateway.listEvents(state.controllerPrincipal, {
      hostDeviceId: state.host.hostDeviceId,
      afterCursor: null,
    });
    expect(event).toMatchObject({ kind: "review.available" });
    if (!event) throw new Error("reconciliation event missing");
    expect(
      decryptRemoteObject(
        event.encryptedPayload,
        state.controllerKeys.privateKey,
        state.hostKeys.publicKey,
        `event:${event.eventId}:${state.pairing.pairingId}`,
      ),
    ).toEqual({
      reconciliation: [
        {
          kind: "remote_command",
          targetId: remoteCommand.commandId,
          status: "outcome_unknown",
          actionRequired: true,
        },
      ],
    });
    connector.close();
    state.gateway.close();
  });

  it("returns project listings as an encrypted, path-free controller snapshot", async () => {
    const state = setup();
    const remoteCommand = state.makeCommand({ kind: "project.list", includeArchived: false });
    state.gateway.submitCommand(state.controllerPrincipal, remoteCommand);
    const snapshot = {
      kind: "project.snapshot" as const,
      generatedAt: state.nowRef.value.toISOString(),
      projects: [
        {
          projectId: randomUUID(),
          name: "手机项目",
          instructions: "先运行测试。",
          pinnedRank: null,
          archivedAt: null,
          revision: 1,
          conversationCount: 0,
          directories: [
            {
              projectDirectoryId: randomUUID(),
              displayName: "主目录",
              role: "primary" as const,
              desiredAccess: "read_write" as const,
              connectionState: "connected" as const,
            },
          ],
        },
      ],
    };
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier: {
        currentRevision: async () => 4,
        apply: async () => ({
          kind: "remote.command.result",
          requestId: remoteCommand.commandId,
          ok: true,
          appliedRevision: 4,
          result: snapshot,
        }),
      },
    });
    await connector.start();
    await connector.tick();
    const [event] = state.gateway.listEvents(state.controllerPrincipal, {
      hostDeviceId: state.host.hostDeviceId,
      afterCursor: null,
    });
    expect(event).toMatchObject({ kind: "project.snapshot", conversationId: null });
    if (!event) throw new Error("project snapshot missing");
    const decrypted = decryptRemoteObject(
      event.encryptedPayload,
      state.controllerKeys.privateKey,
      state.hostKeys.publicKey,
      `event:${event.eventId}:${state.pairing.pairingId}`,
    );
    expect(decrypted).toEqual(snapshot);
    expect(JSON.stringify(decrypted)).not.toContain("rootPath");
    connector.close();
    state.gateway.close();
  });

  it("rejects stale base revisions before invoking App Service", async () => {
    const state = setup();
    const remoteCommand = state.makeCommand({
      kind: "session.abort",
      assistantMessageId: randomUUID(),
    });
    state.gateway.submitCommand(state.controllerPrincipal, remoteCommand);
    let applied = false;
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      applier: {
        currentRevision: async () => 9,
        apply: async () => {
          applied = true;
          throw new Error("unexpected");
        },
      },
    });
    await connector.start();
    await connector.tick();
    expect(applied).toBe(false);
    connector.close();
    state.gateway.close();
  });

  it("encrypts projected events separately for the paired controller", async () => {
    const state = setup();
    const connector = new RemoteHostConnector({
      databasePath: path.join(state.directory, "connector.sqlite"),
      host: state.host,
      hostPrivateKey: state.hostKeys.privateKey,
      transport: state.transport,
      now: () => state.nowRef.value,
      idFactory: randomUUID,
      applier: {
        currentRevision: async () => 0,
        apply: async () => {
          throw new Error("unused");
        },
      },
    });
    await connector.start();
    const [event] = await connector.publishEvent({
      kind: "review.available",
      conversationId: randomUUID(),
      payload: { resourceId: randomUUID(), kind: "diff" },
    });
    if (!event) throw new Error("event missing");
    expect(
      decryptRemoteObject(
        event.encryptedPayload,
        state.controllerKeys.privateKey,
        state.hostKeys.publicKey,
        `event:${event.eventId}:${state.pairing.pairingId}`,
      ),
    ).toMatchObject({ kind: "diff" });
    connector.close();
    state.gateway.close();
  });
});
