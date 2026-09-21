import { z } from "zod";

const entityIdSchema = z.uuid();
const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO timestamp",
});

export const syncObjectTypeSchema = z.enum([
  "project",
  "project_directory",
  "conversation",
  "branch",
  "message",
  "personal_file",
  "attachment",
  "artifact",
  "artifact_version",
  "assistant_profile",
  "skill_installation",
  "memory_entry",
  "memory_settings",
  "memory_conversation_settings",
]);

export const syncPayloadSchema = z.record(z.string(), z.unknown());

export const syncOperationSchema = z
  .object({
    operationId: entityIdSchema,
    accountId: entityIdSchema,
    deviceId: entityIdSchema,
    objectType: syncObjectTypeSchema,
    objectId: entityIdSchema,
    mutation: z.enum(["upsert", "delete"]),
    baseRevision: z.number().int().nonnegative(),
    payloadVersion: z.literal(1),
    payload: syncPayloadSchema.nullable(),
    idempotencyKey: z.string().min(8).max(200),
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.mutation === "upsert" && operation.payload === null) {
      context.addIssue({ code: "custom", message: "Upsert requires a payload" });
    }
    if (operation.mutation === "delete" && operation.payload !== null) {
      context.addIssue({ code: "custom", message: "Delete payload must be null" });
    }
  });

export const syncConflictSchema = z
  .object({
    conflictId: entityIdSchema,
    accountId: entityIdSchema,
    objectType: syncObjectTypeSchema,
    objectId: entityIdSchema,
    operationId: entityIdSchema,
    clientBaseRevision: z.number().int().nonnegative(),
    serverRevision: z.number().int().nonnegative(),
    clientPayload: syncPayloadSchema.nullable(),
    serverPayload: syncPayloadSchema.nullable(),
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
  })
  .strict();

export const syncChangeSchema = z
  .object({
    cursor: z.string().regex(/^cursor:\d+$/),
    accountId: entityIdSchema,
    objectType: syncObjectTypeSchema,
    objectId: entityIdSchema,
    revision: z.number().int().positive(),
    tombstone: z.boolean(),
    payloadVersion: z.literal(1),
    payload: syncPayloadSchema.nullable(),
    operationId: entityIdSchema,
    changedAt: timestampSchema,
    retainUntil: timestampSchema.nullable(),
  })
  .strict();

export const syncPushResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("committed"),
      operationId: entityIdSchema,
      revision: z.number().int().positive(),
      cursor: z.string().regex(/^cursor:\d+$/),
      replayed: z.boolean(),
    })
    .strict(),
  z
    .object({
      status: z.literal("conflict"),
      operationId: entityIdSchema,
      conflict: syncConflictSchema,
      cursor: z.string().regex(/^cursor:\d+$/),
      replayed: z.boolean(),
    })
    .strict(),
]);

export const syncPullResultSchema = z
  .object({
    changes: z.array(syncChangeSchema),
    nextCursor: z.string().regex(/^cursor:\d+$/),
  })
  .strict();

export type SyncObjectType = z.infer<typeof syncObjectTypeSchema>;
export type SyncPayload = z.infer<typeof syncPayloadSchema>;
export type SyncOperation = z.infer<typeof syncOperationSchema>;
export type SyncConflict = z.infer<typeof syncConflictSchema>;
export type SyncChange = z.infer<typeof syncChangeSchema>;
export type SyncPushResult = z.infer<typeof syncPushResultSchema>;
export type SyncPullResult = z.infer<typeof syncPullResultSchema>;

export const syncStatusSchema = z
  .object({
    cursor: z.string().regex(/^cursor:\d+$/),
    pushed: z.number().int().nonnegative(),
    pulled: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    syncedAt: timestampSchema,
  })
  .strict();

export const syncConflictResolutionSchema = z.enum(["local", "cloud"]);

export const syncResolveConflictInputSchema = z
  .object({
    conflictId: entityIdSchema,
    resolution: syncConflictResolutionSchema,
  })
  .strict();

export const localCacheClearResultSchema = z
  .object({
    clearedAt: timestampSchema,
  })
  .strict();

export const cloudDataDeletionResultSchema = z
  .object({
    deletedObjects: z.number().int().nonnegative(),
    cursor: z.string().regex(/^cursor:\d+$/),
    retainUntil: timestampSchema,
  })
  .strict();

export type SyncStatus = z.infer<typeof syncStatusSchema>;
export type SyncConflictResolution = z.infer<typeof syncConflictResolutionSchema>;
export type LocalCacheClearResult = z.infer<typeof localCacheClearResultSchema>;
export type CloudDataDeletionResult = z.infer<typeof cloudDataDeletionResultSchema>;

export interface SyncBridge {
  syncNow(): Promise<SyncStatus>;
  listSyncConflicts(): Promise<SyncConflict[]>;
  resolveSyncConflict(input: z.input<typeof syncResolveConflictInputSchema>): Promise<SyncStatus>;
  clearLocalCache(): Promise<LocalCacheClearResult>;
  deleteCloudData(): Promise<CloudDataDeletionResult>;
}
