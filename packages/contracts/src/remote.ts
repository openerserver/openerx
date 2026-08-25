import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./chat";

const base64UrlSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .min(32)
  .max(8_192);
const remoteCursorSchema = z.string().regex(/^remote:\d+$/);

export const remotePresenceSchema = z.enum(["online", "degraded", "offline", "revoked"]);

export const remoteHostSchema = z
  .object({
    version: z.literal(1),
    accountId: entityIdSchema,
    hostDeviceId: entityIdSchema,
    displayName: z.string().trim().min(1).max(120),
    platform: z.enum(["darwin", "win32"]),
    arch: z.enum(["arm64", "x64"]),
    appVersion: z.string().min(1).max(64),
    capabilities: z.array(z.string().regex(/^[a-z][a-z0-9._-]*$/)).max(64),
    presence: remotePresenceSchema,
    remoteEnabled: z.boolean(),
    revision: z.number().int().nonnegative(),
    presenceChangedAt: timestampSchema,
  })
  .strict();

export const remotePairingChallengeSchema = z
  .object({
    version: z.literal(1),
    challengeId: entityIdSchema,
    accountId: entityIdSchema,
    hostDeviceId: entityIdSchema,
    oneTimeNonce: base64UrlSchema,
    hostPublicKey: base64UrlSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict()
  .superRefine((challenge, context) => {
    if (Date.parse(challenge.expiresAt) <= Date.parse(challenge.createdAt)) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "Pairing must expire" });
    }
  });

export const remoteDevicePairingSchema = z
  .object({
    version: z.literal(1),
    pairingId: entityIdSchema,
    accountId: entityIdSchema,
    controllerDeviceId: entityIdSchema,
    hostDeviceId: entityIdSchema,
    controllerPublicKey: base64UrlSchema,
    hostPublicKey: base64UrlSchema,
    status: z.enum(["pending", "active", "expired", "revoked"]),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    revokedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((pairing, context) => {
    if (pairing.controllerDeviceId === pairing.hostDeviceId) {
      context.addIssue({
        code: "custom",
        path: ["controllerDeviceId"],
        message: "Distinct devices required",
      });
    }
    if (pairing.status === "revoked" && pairing.revokedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "Revocation time required",
      });
    }
    if (pairing.status !== "revoked" && pairing.revokedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "Unexpected revocation time",
      });
    }
  });

export const remoteCommandKindSchema = z.enum([
  "task.start",
  "session.prompt",
  "session.steer",
  "session.follow_up",
  "session.abort",
  "permission.decide",
  "attention.respond",
]);

export const remoteCommandSchema = z
  .object({
    version: z.literal(1),
    commandId: entityIdSchema,
    accountId: entityIdSchema,
    pairingId: entityIdSchema,
    controllerDeviceId: entityIdSchema,
    hostDeviceId: entityIdSchema,
    conversationId: entityIdSchema.nullable(),
    generationId: entityIdSchema.nullable(),
    kind: remoteCommandKindSchema,
    baseRevision: z.number().int().nonnegative(),
    sessionSequence: z.number().int().positive(),
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    idempotencyKey: z.string().min(8).max(240),
    encryptedPayload: base64UrlSchema,
    signature: base64UrlSchema,
  })
  .strict()
  .superRefine((command, context) => {
    if (Date.parse(command.expiresAt) <= Date.parse(command.issuedAt)) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: "Command must expire" });
    }
    if (command.controllerDeviceId === command.hostDeviceId) {
      context.addIssue({
        code: "custom",
        path: ["controllerDeviceId"],
        message: "Distinct devices required",
      });
    }
  });

export const remoteCommandReceiptSchema = z
  .object({
    version: z.literal(1),
    commandId: entityIdSchema,
    accountId: entityIdSchema,
    pairingId: entityIdSchema,
    hostDeviceId: entityIdSchema,
    status: z.enum(["submitted", "accepted", "applied", "rejected", "expired"]),
    resultCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .nullable(),
    appliedRevision: z.number().int().nonnegative().nullable(),
    receivedAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const attentionRequestSchema = z
  .object({
    version: z.literal(1),
    attentionRequestId: entityIdSchema,
    accountId: entityIdSchema,
    hostDeviceId: entityIdSchema,
    conversationId: entityIdSchema,
    generationId: entityIdSchema,
    kind: z.enum(["question", "permission"]),
    riskLevel: z.enum(["L1", "L2", "L3", "L4", "L5"]),
    status: z.enum(["pending", "approved", "denied", "expired"]),
    title: z.string().trim().min(1).max(200),
    encryptedPayload: base64UrlSchema,
    revision: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.status === "pending" && request.resolvedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["resolvedAt"],
        message: "Pending request is unresolved",
      });
    }
    if (request.status !== "pending" && request.resolvedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["resolvedAt"],
        message: "Resolution time required",
      });
    }
  });

export const remoteProductEventKindSchema = z.enum([
  "host.presence_changed",
  "conversation.updated",
  "message.delta",
  "message.completed",
  "message.stopped",
  "message.failed",
  "run.status_changed",
  "tool.status_changed",
  "attention.requested",
  "attention.resolved",
  "attention.expired",
  "artifact.created",
  "artifact.version_created",
  "review.available",
  "usage.pending",
  "usage.recorded",
]);

export const remoteProductEventSchema = z
  .object({
    version: z.literal(1),
    eventId: entityIdSchema,
    accountId: entityIdSchema,
    hostDeviceId: entityIdSchema,
    conversationId: entityIdSchema.nullable(),
    cursor: remoteCursorSchema,
    kind: remoteProductEventKindSchema,
    occurredAt: timestampSchema,
    encryptedPayload: base64UrlSchema,
  })
  .strict();

export const remoteEventCursorSchema = z
  .object({
    version: z.literal(1),
    accountId: entityIdSchema,
    controllerDeviceId: entityIdSchema,
    hostDeviceId: entityIdSchema,
    conversationId: entityIdSchema.nullable(),
    cursor: remoteCursorSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const pushSubscriptionSchema = z
  .object({
    version: z.literal(1),
    subscriptionId: entityIdSchema,
    accountId: entityIdSchema,
    deviceId: entityIdSchema,
    platform: z.enum(["ios", "android"]),
    pushTokenRef: z.string().min(8).max(240),
    status: z.enum(["active", "revoked"]),
    rotatedAt: timestampSchema,
    revokedAt: timestampSchema.nullable(),
  })
  .strict();

export type RemoteHost = z.infer<typeof remoteHostSchema>;
export type RemotePairingChallenge = z.infer<typeof remotePairingChallengeSchema>;
export type RemoteDevicePairing = z.infer<typeof remoteDevicePairingSchema>;
export type RemoteCommand = z.infer<typeof remoteCommandSchema>;
export type RemoteCommandReceipt = z.infer<typeof remoteCommandReceiptSchema>;
export type AttentionRequest = z.infer<typeof attentionRequestSchema>;
export type RemoteProductEvent = z.infer<typeof remoteProductEventSchema>;
export type RemoteEventCursor = z.infer<typeof remoteEventCursorSchema>;
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;
