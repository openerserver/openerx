import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";

export const workspaceAccessSchema = z.enum(["read_only", "read_write"]);
export const workspaceBindingRoleSchema = z.enum(["primary", "additional"]);
export const workspaceBindingSourceSchema = z.enum(["default", "project", "user_added"]);

export const workspaceGrantSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    conversationId: entityIdSchema.nullable(),
    displayName: z.string().trim().min(1).max(240),
    rootPath: z.string().min(1).max(4_096),
    access: workspaceAccessSchema,
    allowNetwork: z.boolean(),
    expiresAt: timestampSchema.nullable(),
    revokedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    bindingRole: workspaceBindingRoleSchema.optional(),
    bindingSource: workspaceBindingSourceSchema.optional(),
  })
  .strict();

export const workspaceGrantPrivilegedInputSchema = z
  .object({
    rootPath: z.string().min(1).max(4_096),
    conversationId: entityIdSchema.nullable(),
    access: workspaceAccessSchema.default("read_write"),
    allowNetwork: z.boolean().default(false),
    expiresAt: timestampSchema.nullable().default(null),
  })
  .strict();

export const workspaceChooseInputSchema = workspaceGrantPrivilegedInputSchema
  .omit({ rootPath: true })
  .strict();

export const workspaceListInputSchema = z
  .object({ conversationId: entityIdSchema.optional() })
  .strict();

export const workspaceRevokeInputSchema = z.object({ workspaceGrantId: entityIdSchema }).strict();

export const workspaceInstructionSourceSchema = z
  .object({
    kind: z.enum(["global", "project", "nested"]),
    workspaceGrantId: entityIdSchema.nullable(),
    relativePath: z.string().min(1).max(2_048),
    appliesTo: z.string().min(1).max(2_048),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    content: z.string().max(200_000),
  })
  .strict();

export const workspaceChangeSchema = z
  .object({
    id: entityIdSchema,
    workspaceGrantId: entityIdSchema,
    runId: entityIdSchema,
    relativePath: z.string().min(1).max(2_048),
    status: z.enum(["preparing", "applied", "reverted", "failed", "outcome_unknown"]),
    beforeSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    afterSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    diff: z.string().max(5_000_000),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const workspaceChangeSetStatusSchema = z.enum([
  "pending_review",
  "reviewed",
  "applying",
  "applied",
  "reverted",
  "discarded",
  "blocked",
  "apply_failed",
  "outcome_unknown",
]);

export const workspaceChangeSetEntrySchema = z
  .object({
    workspaceGrantId: entityIdSchema,
    workspaceLogicalName: z.string().min(1).max(240),
    relativePath: z.string().min(1).max(2_048),
    previousRelativePath: z.string().min(1).max(2_048).nullable(),
    kind: z.enum(["created", "modified", "deleted", "renamed"]),
    entryType: z.enum(["file", "directory", "symlink", "other"]),
    beforeSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    afterSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    beforeText: z.string().max(1_000_000).nullable(),
    afterText: z.string().max(1_000_000).nullable(),
    applySupported: z.boolean(),
  })
  .strict();

export const workspaceChangeSetSchema = z
  .object({
    id: entityIdSchema,
    workspaceGrantId: entityIdSchema,
    runId: entityIdSchema,
    toolCallId: entityIdSchema,
    status: workspaceChangeSetStatusSchema,
    baselineRevision: z.string().regex(/^[a-f0-9]{64}$/u),
    finalRevision: z.string().regex(/^[a-f0-9]{64}$/u),
    manifest: z.array(z.unknown()).max(10_000),
    diffs: z.array(z.unknown()).max(10_000),
    entries: z.array(workspaceChangeSetEntrySchema).max(10_000),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type WorkspaceAccess = z.infer<typeof workspaceAccessSchema>;
export type WorkspaceBindingRole = z.infer<typeof workspaceBindingRoleSchema>;
export type WorkspaceBindingSource = z.infer<typeof workspaceBindingSourceSchema>;
export type WorkspaceGrant = z.infer<typeof workspaceGrantSchema>;
export type WorkspaceInstructionSource = z.infer<typeof workspaceInstructionSourceSchema>;
export type WorkspaceChange = z.infer<typeof workspaceChangeSchema>;
export type WorkspaceChangeSetStatus = z.infer<typeof workspaceChangeSetStatusSchema>;
export type WorkspaceChangeSetEntry = z.infer<typeof workspaceChangeSetEntrySchema>;
export type WorkspaceChangeSet = z.infer<typeof workspaceChangeSetSchema>;

export interface WorkspaceBridge {
  chooseWorkspace(
    input: z.input<typeof workspaceChooseInputSchema>,
  ): Promise<WorkspaceGrant | null>;
  listWorkspaces(input?: z.input<typeof workspaceListInputSchema>): Promise<WorkspaceGrant[]>;
  revokeWorkspace(input: z.input<typeof workspaceRevokeInputSchema>): Promise<WorkspaceGrant>;
}
