import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  attentionRequestSchema,
  remoteCommandSchema,
  remoteDevicePairingSchema,
  remotePairingChallengeSchema,
  remoteProductEventSchema,
} from "../src";

const accountId = randomUUID();
const controllerDeviceId = randomUUID();
const hostDeviceId = randomUUID();
const pairingId = randomUUID();
const opaque = "A".repeat(43);

function command() {
  return {
    version: 1,
    commandId: randomUUID(),
    accountId,
    pairingId,
    controllerDeviceId,
    hostDeviceId,
    conversationId: randomUUID(),
    generationId: randomUUID(),
    kind: "session.steer",
    baseRevision: 4,
    sessionSequence: 8,
    issuedAt: "2026-08-25T10:00:00.000Z",
    expiresAt: "2026-08-25T10:01:00.000Z",
    idempotencyKey: "remote-command-0001",
    encryptedPayload: opaque,
    signature: opaque,
  } as const;
}

describe("M2 Remote foundation contracts", () => {
  it("accepts a versioned, expiring, signed command envelope", () => {
    expect(remoteCommandSchema.parse(command())).toMatchObject({
      version: 1,
      kind: "session.steer",
      sessionSequence: 8,
    });
  });

  it("rejects replay-prone, expired, same-device and extensible command shapes", () => {
    expect(() => remoteCommandSchema.parse({ ...command(), sessionSequence: 0 })).toThrow();
    expect(() =>
      remoteCommandSchema.parse({
        ...command(),
        expiresAt: "2026-08-25T09:59:59.000Z",
      }),
    ).toThrow();
    expect(() =>
      remoteCommandSchema.parse({ ...command(), controllerDeviceId: hostDeviceId }),
    ).toThrow();
    expect(() =>
      remoteCommandSchema.parse({ ...command(), version: 2, plaintext: "secret" }),
    ).toThrow();
  });

  it("requires one-time pairing expiry and explicit revocation state", () => {
    expect(
      remotePairingChallengeSchema.parse({
        version: 1,
        challengeId: randomUUID(),
        accountId,
        hostDeviceId,
        oneTimeNonce: opaque,
        hostPublicKey: opaque,
        createdAt: "2026-08-25T10:00:00.000Z",
        expiresAt: "2026-08-25T10:02:00.000Z",
      }),
    ).toMatchObject({ hostDeviceId });
    expect(() =>
      remoteDevicePairingSchema.parse({
        version: 1,
        pairingId,
        accountId,
        controllerDeviceId,
        hostDeviceId,
        controllerPublicKey: opaque,
        hostPublicKey: opaque,
        status: "revoked",
        createdAt: "2026-08-25T10:00:00.000Z",
        expiresAt: "2026-09-25T10:00:00.000Z",
        revokedAt: null,
      }),
    ).toThrow();
  });

  it("keeps attention decisions and mobile events encrypted and versioned", () => {
    expect(
      attentionRequestSchema.parse({
        version: 1,
        attentionRequestId: randomUUID(),
        accountId,
        hostDeviceId,
        conversationId: randomUUID(),
        generationId: randomUUID(),
        kind: "permission",
        riskLevel: "L4",
        status: "pending",
        title: "需要审批",
        encryptedPayload: opaque,
        revision: 1,
        createdAt: "2026-08-25T10:00:00.000Z",
        expiresAt: "2026-08-25T10:01:00.000Z",
        resolvedAt: null,
      }),
    ).toMatchObject({ status: "pending", riskLevel: "L4" });
    expect(
      remoteProductEventSchema.parse({
        version: 1,
        eventId: randomUUID(),
        accountId,
        hostDeviceId,
        conversationId: null,
        cursor: "remote:42",
        kind: "host.presence_changed",
        occurredAt: "2026-08-25T10:00:00.000Z",
        encryptedPayload: opaque,
      }),
    ).toMatchObject({ cursor: "remote:42" });
  });
});
