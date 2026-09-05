import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";

export const remoteOpaqueSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .min(32)
  .max(8_192);
export const remoteCursorSchema = z.string().regex(/^remote:\d+$/);

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
    oneTimeNonce: remoteOpaqueSchema,
    hostPublicKey: remoteOpaqueSchema,
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
    controllerPublicKey: remoteOpaqueSchema,
    hostPublicKey: remoteOpaqueSchema,
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
  "project.list",
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
    encryptedPayload: remoteOpaqueSchema,
    signature: remoteOpaqueSchema,
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
    encryptedPayload: remoteOpaqueSchema,
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
  "project.snapshot",
  "conversation.updated",
  "message.delta",
  "message.completed",
  "message.cancelling",
  "message.stopped",
  "message.interrupted",
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
    encryptedPayload: remoteOpaqueSchema,
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

export const remoteTaskStartPayloadSchema = z
  .object({
    kind: z.literal("task.start"),
    text: z.string().trim().min(1).max(100_000),
    clientOperationId: z.string().min(8).max(200),
    executionMode: z.enum(["attended", "unattended"]).optional(),
    projectId: entityIdSchema.nullable().optional(),
  })
  .strict();

export const remoteSessionPromptPayloadSchema = z
  .object({
    kind: z.literal("session.prompt"),
    text: z.string().trim().min(1).max(100_000),
    clientOperationId: z.string().min(8).max(200),
    executionMode: z.enum(["attended", "unattended"]).optional(),
  })
  .strict();

export const remotePromptPayloadSchema = z.union([
  remoteTaskStartPayloadSchema,
  remoteSessionPromptPayloadSchema,
]);

export const remoteProjectListPayloadSchema = z
  .object({
    kind: z.literal("project.list"),
    includeArchived: z.boolean().default(false),
  })
  .strict();

export const remoteProjectDirectoryStatusSchema = z
  .object({
    projectDirectoryId: entityIdSchema,
    displayName: z.string().trim().min(1).max(240),
    role: z.enum(["primary", "additional"]),
    desiredAccess: z.enum(["read_only", "read_write"]),
    connectionState: z.enum(["connected", "reconnect_required"]),
  })
  .strict();

export const remoteProjectSummarySchema = z
  .object({
    projectId: entityIdSchema,
    name: z.string().trim().min(1).max(80),
    instructions: z.string().max(20_000),
    pinnedRank: z.number().int().nonnegative().nullable(),
    archivedAt: timestampSchema.nullable(),
    revision: z.number().int().positive(),
    conversationCount: z.number().int().nonnegative(),
    directories: z.array(remoteProjectDirectoryStatusSchema).max(100),
  })
  .strict();

export const remoteProjectSnapshotPayloadSchema = z
  .object({
    kind: z.literal("project.snapshot"),
    generatedAt: timestampSchema,
    projects: z.array(remoteProjectSummarySchema).max(500),
  })
  .strict();

export const remoteSteerPayloadSchema = z
  .object({
    kind: z.literal("session.steer"),
    text: z.string().trim().min(1).max(100_000),
  })
  .strict();

export const remoteFollowUpPayloadSchema = z
  .object({
    kind: z.literal("session.follow_up"),
    text: z.string().trim().min(1).max(100_000),
  })
  .strict();

export const remoteAbortPayloadSchema = z
  .object({
    kind: z.literal("session.abort"),
    assistantMessageId: entityIdSchema,
  })
  .strict();

export const remotePermissionDecisionPayloadSchema = z
  .object({
    kind: z.literal("permission.decide"),
    attentionRequestId: entityIdSchema,
    permissionRequestId: entityIdSchema,
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["once", "session", "deny"]),
    deviceUnlocked: z.boolean(),
    biometricVerified: z.boolean(),
    reauthenticatedAt: timestampSchema,
  })
  .strict();

export const remoteAttentionResponsePayloadSchema = z
  .object({
    kind: z.literal("attention.respond"),
    attentionRequestId: entityIdSchema,
    response: z.string().trim().min(1).max(100_000),
    delivery: z.enum(["prompt", "steer", "follow_up"]),
  })
  .strict();

export const remoteCommandPayloadSchema = z.discriminatedUnion("kind", [
  remoteProjectListPayloadSchema,
  remoteTaskStartPayloadSchema,
  remoteSessionPromptPayloadSchema,
  remoteSteerPayloadSchema,
  remoteFollowUpPayloadSchema,
  remoteAbortPayloadSchema,
  remotePermissionDecisionPayloadSchema,
  remoteAttentionResponsePayloadSchema,
]);

export const remotePairingAcceptInputSchema = z
  .object({
    challengeId: entityIdSchema,
    oneTimeNonce: remoteOpaqueSchema,
    controllerDeviceId: entityIdSchema,
    controllerPublicKey: remoteOpaqueSchema,
    proof: remoteOpaqueSchema,
  })
  .strict();

export const remotePairingChallengeInputSchema = z
  .object({
    hostDeviceId: entityIdSchema,
    hostPublicKey: remoteOpaqueSchema,
  })
  .strict();

export const remotePresenceUpdateSchema = z
  .object({
    hostDeviceId: entityIdSchema,
    presence: z.enum(["online", "degraded", "offline"]),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const remoteHostRegistrationInputSchema = z
  .object({
    hostDeviceId: entityIdSchema,
    displayName: z.string().trim().min(1).max(120),
    platform: z.enum(["darwin", "win32"]),
    arch: z.enum(["arm64", "x64"]),
    appVersion: z.string().min(1).max(64),
    capabilities: z.array(z.string().regex(/^[a-z][a-z0-9._-]*$/)).max(64),
    remoteEnabled: z.boolean(),
  })
  .strict();

export const remoteCommandPullInputSchema = z
  .object({
    hostDeviceId: entityIdSchema,
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();

export const remoteCursorAckInputSchema = z
  .object({
    hostDeviceId: entityIdSchema,
    conversationId: entityIdSchema.nullable(),
    cursor: remoteCursorSchema,
  })
  .strict();

export const remoteEventPublishInputSchema = z
  .object({
    pairingId: entityIdSchema,
    controllerDeviceId: entityIdSchema,
    event: remoteProductEventSchema.omit({ cursor: true }),
    expiresAt: timestampSchema,
  })
  .strict();

export const remoteEventListInputSchema = z
  .object({
    hostDeviceId: entityIdSchema,
    conversationId: entityIdSchema.nullable().optional(),
    afterCursor: remoteCursorSchema.nullable(),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict();

export const remoteReviewResourceSchema = z
  .object({
    resourceId: entityIdSchema,
    kind: z.enum(["diff", "test", "terminal", "screenshot", "artifact", "attachment"]),
    mediaType: z.string().min(1).max(200),
    encryptedObjectRef: remoteOpaqueSchema,
    sizeBytes: z.number().int().nonnegative().max(100_000_000),
    expiresAt: timestampSchema,
  })
  .strict();

export const remotePushEnvelopeSchema = z
  .object({
    version: z.literal(1),
    category: z.enum(["attention", "completed", "failed"]),
    hostDeviceId: entityIdSchema,
    conversationId: entityIdSchema.nullable(),
    attentionRequestId: entityIdSchema.nullable(),
    eventId: entityIdSchema,
  })
  .strict();

export const remoteApplyCommandRequestFrameSchema = z
  .object({
    kind: z.literal("remote.command.apply"),
    requestId: entityIdSchema,
    command: remoteCommandSchema,
    payload: remoteCommandPayloadSchema,
  })
  .strict();

export const remoteApplyCommandResponseFrameSchema = z.discriminatedUnion("ok", [
  z
    .object({
      kind: z.literal("remote.command.result"),
      requestId: entityIdSchema,
      ok: z.literal(true),
      appliedRevision: z.number().int().nonnegative(),
      result: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("remote.command.result"),
      requestId: entityIdSchema,
      ok: z.literal(false),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      currentRevision: z.number().int().nonnegative(),
    })
    .strict(),
]);

export const remoteConnectorBootstrapSchema = z
  .object({
    kind: z.literal("remote-connector.bootstrap"),
    contractVersion: z.literal(1),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const remoteConnectorReadyFrameSchema = z
  .object({
    kind: z.literal("remote-connector.ready"),
    contractVersion: z.literal(1),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const remoteConnectorConfigureFrameSchema = z
  .object({
    kind: z.literal("remote-connector.configure"),
    profileDirectory: z.string().min(1),
    authorization: z
      .object({
        accountId: entityIdSchema,
        accessToken: z.string().min(32),
        accessTokenExpiresAt: timestampSchema,
        platformBaseUrl: z.url(),
      })
      .strict(),
    host: remoteHostRegistrationInputSchema,
    hostPrivateKey: remoteOpaqueSchema,
  })
  .strict();

export const remoteConnectorDisableFrameSchema = z
  .object({ kind: z.literal("remote-connector.disable") })
  .strict();

export const remoteRevisionRequestFrameSchema = z
  .object({
    kind: z.literal("remote.revision.request"),
    requestId: entityIdSchema,
    conversationId: entityIdSchema.nullable(),
  })
  .strict();

export const remoteRevisionResponseFrameSchema = z
  .object({
    kind: z.literal("remote.revision.response"),
    requestId: entityIdSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const remoteLocalEventFrameSchema = z
  .object({
    kind: z.literal("remote.event.publish"),
    eventKind: remoteProductEventKindSchema,
    conversationId: entityIdSchema.nullable(),
    occurredAt: timestampSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const remoteConnectorPortFrameSchema = z.union([
  remoteConnectorReadyFrameSchema,
  remoteConnectorConfigureFrameSchema,
  remoteConnectorDisableFrameSchema,
  remoteRevisionRequestFrameSchema,
  remoteRevisionResponseFrameSchema,
  remoteApplyCommandRequestFrameSchema,
  remoteApplyCommandResponseFrameSchema,
  remoteLocalEventFrameSchema,
]);

export type RemoteHost = z.infer<typeof remoteHostSchema>;
export type RemotePairingChallenge = z.infer<typeof remotePairingChallengeSchema>;
export type RemoteDevicePairing = z.infer<typeof remoteDevicePairingSchema>;
export type RemoteCommand = z.infer<typeof remoteCommandSchema>;
export type RemoteCommandReceipt = z.infer<typeof remoteCommandReceiptSchema>;
export type AttentionRequest = z.infer<typeof attentionRequestSchema>;
export type RemoteProductEvent = z.infer<typeof remoteProductEventSchema>;
export type RemoteEventCursor = z.infer<typeof remoteEventCursorSchema>;
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;
export type RemoteCommandPayload = z.infer<typeof remoteCommandPayloadSchema>;
export type RemoteProjectDirectoryStatus = z.infer<typeof remoteProjectDirectoryStatusSchema>;
export type RemoteProjectSummary = z.infer<typeof remoteProjectSummarySchema>;
export type RemoteProjectSnapshotPayload = z.infer<typeof remoteProjectSnapshotPayloadSchema>;
export type RemotePairingAcceptInput = z.infer<typeof remotePairingAcceptInputSchema>;
export type RemoteHostRegistrationInput = z.infer<typeof remoteHostRegistrationInputSchema>;
export type RemoteEventPublishInput = z.infer<typeof remoteEventPublishInputSchema>;
export type RemoteReviewResource = z.infer<typeof remoteReviewResourceSchema>;
export type RemotePushEnvelope = z.infer<typeof remotePushEnvelopeSchema>;
export type RemoteApplyCommandRequestFrame = z.infer<typeof remoteApplyCommandRequestFrameSchema>;
export type RemoteApplyCommandResponseFrame = z.infer<typeof remoteApplyCommandResponseFrameSchema>;
export type RemoteConnectorConfigureFrame = z.infer<typeof remoteConnectorConfigureFrameSchema>;
export type RemoteRevisionRequestFrame = z.infer<typeof remoteRevisionRequestFrameSchema>;
export type RemoteRevisionResponseFrame = z.infer<typeof remoteRevisionResponseFrameSchema>;
export type RemoteLocalEventFrame = z.infer<typeof remoteLocalEventFrameSchema>;
