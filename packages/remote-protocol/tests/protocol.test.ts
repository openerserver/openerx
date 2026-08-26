import { randomUUID } from "node:crypto";
import type { RemoteCommandPayload } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import {
  commandCipherContext,
  decryptRemotePayload,
  encryptRemotePayload,
  generateRemoteDeviceKeyPair,
  remotePairingProof,
  signRemoteCommand,
  verifyRemoteCommand,
  verifyRemotePairingProof,
} from "../src";

const deterministicRandom = (seed: number) => (length: number) =>
  Uint8Array.from({ length }, (_, index) => (seed + index * 17) % 256);

describe("remote end-to-end protocol", () => {
  it("encrypts for only the paired host and signs the immutable command envelope", () => {
    const controller = generateRemoteDeviceKeyPair(deterministicRandom(7));
    const host = generateRemoteDeviceKeyPair(deterministicRandom(19));
    const otherHost = generateRemoteDeviceKeyPair(deterministicRandom(31));
    const commandId = randomUUID();
    const pairingId = randomUUID();
    const context = commandCipherContext({ commandId, pairingId });
    const payload: RemoteCommandPayload = { kind: "session.steer", text: "先修复测试" };
    const encryptedPayload = encryptRemotePayload(
      payload,
      controller.privateKey,
      host.publicKey,
      context,
      deterministicRandom(43),
    );
    const command = signRemoteCommand(
      {
        version: 1,
        commandId,
        accountId: randomUUID(),
        pairingId,
        controllerDeviceId: randomUUID(),
        hostDeviceId: randomUUID(),
        conversationId: randomUUID(),
        generationId: randomUUID(),
        kind: payload.kind,
        baseRevision: 4,
        sessionSequence: 2,
        issuedAt: "2026-08-26T08:00:00.000Z",
        expiresAt: "2026-08-26T08:01:00.000Z",
        idempotencyKey: "remote-steer-0001",
        encryptedPayload,
      },
      controller.privateKey,
    );

    expect(verifyRemoteCommand(command, controller.publicKey)).toBe(true);
    expect(
      decryptRemotePayload(
        command.encryptedPayload,
        host.privateKey,
        controller.publicKey,
        context,
      ),
    ).toEqual(payload);
    expect(() =>
      decryptRemotePayload(
        command.encryptedPayload,
        otherHost.privateKey,
        controller.publicKey,
        context,
      ),
    ).toThrow("REMOTE_PAYLOAD_AUTHENTICATION_FAILED");
    expect(verifyRemoteCommand({ ...command, baseRevision: 5 }, controller.publicKey)).toBe(false);
  });

  it("proves controller private-key possession for one-time pairing", () => {
    const controller = generateRemoteDeviceKeyPair(deterministicRandom(53));
    const challengeId = randomUUID();
    const controllerDeviceId = randomUUID();
    const nonce = "N".repeat(43);
    const proof = remotePairingProof(challengeId, nonce, controllerDeviceId, controller.privateKey);
    expect(
      verifyRemotePairingProof(challengeId, nonce, controllerDeviceId, controller.publicKey, proof),
    ).toBe(true);
    expect(
      verifyRemotePairingProof(
        challengeId,
        `${nonce}A`,
        controllerDeviceId,
        controller.publicKey,
        proof,
      ),
    ).toBe(false);
  });
});
