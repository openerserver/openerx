import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./common";
import {
  type Artifact,
  type Attachment,
  artifactCreateInputSchema,
  artifactExportPrivilegedInputSchema,
  artifactExportResultSchema,
  artifactGetInputSchema,
  artifactListInputSchema,
  artifactNewVersionInputSchema,
  artifactPreviewInputSchema,
  artifactSchema,
  attachmentSchema,
  type ContentPreview,
  contentPreviewSchema,
  type FileScope,
  type FileSearchResult,
  fileAttachInputSchema,
  fileImportDataInputSchema,
  fileImportPrivilegedInputSchema,
  fileListInputSchema,
  filePreviewInputSchema,
  fileRevokeScopeInputSchema,
  fileScopeSchema,
  fileSearchInputSchema,
  fileSearchResultSchema,
  type PersonalFile,
  personalFileSchema,
} from "./file";
import {
  localWebSearchRuntimeResetInputSchema,
  localWebSearchSettingsStateSchema,
  localWebSearchSettingsUpdateInputSchema,
} from "./local-web-search";
import {
  type AutomaticMemoryCreatedEvent,
  type ConversationMemorySettings,
  conversationMemorySettingsGetInputSchema,
  conversationMemorySettingsSchema,
  conversationMemorySettingsUpdateInputSchema,
  type MemoryClearResult,
  type MemoryEntry,
  type MemoryMergeReview,
  type MemorySettings,
  type MemorySourceLink,
  memoryClearInputSchema,
  memoryClearResultSchema,
  memoryDeleteInputSchema,
  memoryEntrySchema,
  memoryListInputSchema,
  memoryMergeReviewListInputSchema,
  memoryMergeReviewResolveInputSchema,
  memoryMergeReviewSchema,
  memorySettingsSchema,
  memorySettingsUpdateInputSchema,
  memorySourceLinkSchema,
  memorySourcesListInputSchema,
  memoryUpsertInputSchema,
} from "./memory";
import { defaultThinkingLevel, thinkingLevelSchema, usageQueryInputSchema } from "./model";
import { byokUsageQueryResultSchema } from "./model-usage";
import {
  type SkillInstallation,
  type SkillInvocation,
  skillApprovePermissionsInputSchema,
  skillAutoInvokeInputSchema,
  skillEnableInputSchema,
  skillGetInputSchema,
  skillInstallationSchema,
  skillInstallPrivilegedInputSchema,
  skillInvocationListInputSchema,
  skillInvocationSchema,
  skillListInputSchema,
  skillResetPermissionsInputSchema,
  skillRollbackInputSchema,
  skillUninstallInputSchema,
  skillUninstallResultSchema,
  skillUpdatePrivilegedInputSchema,
} from "./skill";
import {
  localCacheClearResultSchema,
  type SyncConflict,
  syncConflictSchema,
  syncResolveConflictInputSchema,
  syncStatusSchema,
} from "./sync";
import {
  capabilityScopeSchema,
  executionRunSchema,
  mcpServerAuthorizationStateSchema,
  mcpServerAuthorizeInputSchema,
  mcpServerConfigSchema,
  mcpServerRemoveInputSchema,
  mcpServerRemoveResultSchema,
  mcpServerUpsertInputSchema,
  permissionListInputSchema,
  permissionRequestSchema,
  permissionResolveInputSchema,
  runStepSchema,
  toolCallSchema,
  toolListInputSchema,
  toolPermissionModeGetInputSchema,
  toolPermissionModeSchema,
  toolPermissionModeSetInputSchema,
  toolPermissionModeStateSchema,
  toolRuntimeReadinessInputSchema,
  toolRuntimeReadinessSchema,
  toolScopeRevokeInputSchema,
  workItemDetailSchema,
  workItemGetInputSchema,
  workItemSchema,
} from "./tool";
import {
  type WorkspaceGrant,
  workspaceGrantPrivilegedInputSchema,
  workspaceGrantSchema,
  workspaceListInputSchema,
  workspaceRevokeInputSchema,
  workspaceSetPrimaryInputSchema,
} from "./workspace";

export { entityIdSchema, timestampSchema } from "./common";

export const messageStatusSchema = z.enum([
  "pending",
  "streaming",
  "cancelling",
  "completed",
  "stopped",
  "interrupted",
  "failed",
]);

export const messageSchema = z
  .object({
    id: entityIdSchema,
    conversationId: entityIdSchema,
    branchId: entityIdSchema,
    parentMessageId: entityIdSchema.nullable(),
    role: z.enum(["user", "assistant", "system"]),
    status: messageStatusSchema,
    parts: z
      .array(
        z
          .object({
            id: entityIdSchema,
            type: z.literal("text"),
            text: z.string(),
          })
          .strict(),
      )
      .min(1),
    errorCode: z.string().min(1).nullable(),
    cancellationRequestedAt: timestampSchema.nullable(),
    attempt: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    revision: z.number().int().positive(),
  })
  .strict();

export const conversationSchema = z
  .object({
    id: entityIdSchema,
    ownerProfileId: z.string().min(1),
    projectId: entityIdSchema.nullable().default(null),
    title: z.string().min(1).max(120),
    activeBranchId: entityIdSchema,
    selectedModelRef: z.string().min(1),
    thinkingLevel: thinkingLevelSchema.default(defaultThinkingLevel),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    archivedAt: timestampSchema.nullable(),
    deletedAt: timestampSchema.nullable(),
    revision: z.number().int().positive(),
  })
  .strict();

export const conversationSummarySchema = conversationSchema.extend({
  lastMessagePreview: z.string(),
  messageCount: z.number().int().nonnegative(),
});

export const branchSchema = z
  .object({
    id: entityIdSchema,
    conversationId: entityIdSchema,
    parentBranchId: entityIdSchema.nullable(),
    forkedFromMessageId: entityIdSchema.nullable(),
    label: z.string().min(1),
    createdAt: timestampSchema,
  })
  .strict();

export const conversationSnapshotSchema = z
  .object({
    conversation: conversationSchema,
    branches: z.array(branchSchema),
    messages: z.array(messageSchema),
    attachments: z.array(attachmentSchema).default([]),
  })
  .strict();

export const generationReceiptSchema = z
  .object({
    conversationId: entityIdSchema,
    branchId: entityIdSchema,
    userMessageId: entityIdSchema.nullable(),
    assistantMessageId: entityIdSchema,
  })
  .strict();

export const searchResultSchema = z
  .object({
    conversationId: entityIdSchema,
    branchId: entityIdSchema,
    messageId: entityIdSchema.nullable(),
    title: z.string().min(1),
    excerpt: z.string(),
    updatedAt: timestampSchema,
  })
  .strict();

export const chatListInputSchema = z
  .object({
    includeArchived: z.boolean().optional(),
  })
  .strict();

export const chatGetInputSchema = z.object({ conversationId: entityIdSchema }).strict();

export const chatSendInputSchema = z
  .object({
    conversationId: entityIdSchema.nullable().optional(),
    projectId: entityIdSchema.nullable().optional(),
    text: z.string().trim().min(1).max(100_000),
    idempotencyKey: z.string().min(8).max(200),
    modelRef: z
      .string()
      .regex(/^platform\/[a-z0-9][a-z0-9._-]*$/)
      .optional(),
    personalFileIds: z.array(entityIdSchema).max(100).optional(),
    skillInstallationId: entityIdSchema.optional(),
    thinkingLevel: thinkingLevelSchema.optional(),
    permissionMode: toolPermissionModeSchema.optional(),
  })
  .strict();

export const chatStopInputSchema = z
  .object({
    conversationId: entityIdSchema,
    assistantMessageId: entityIdSchema,
  })
  .strict();

export const chatRegenerateInputSchema = z
  .object({
    conversationId: entityIdSchema,
    assistantMessageId: entityIdSchema,
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

export const chatEditInputSchema = z
  .object({
    conversationId: entityIdSchema,
    messageId: entityIdSchema,
    text: z.string().trim().min(1).max(100_000),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

export const chatRenameInputSchema = z
  .object({
    conversationId: entityIdSchema,
    title: z.string().trim().min(1).max(120),
  })
  .strict();

export const chatArchiveInputSchema = z
  .object({
    conversationId: entityIdSchema,
    archived: z.boolean(),
  })
  .strict();

export const chatDeleteInputSchema = z
  .object({
    conversationId: entityIdSchema,
    forgetSourceMemories: z.boolean().optional(),
  })
  .strict();

export const chatSelectModelInputSchema = z
  .object({
    conversationId: entityIdSchema,
    modelRef: z.string().regex(/^platform\/[a-z0-9][a-z0-9._-]*$/),
  })
  .strict();

export const chatSelectThinkingLevelInputSchema = z
  .object({
    conversationId: entityIdSchema,
    thinkingLevel: thinkingLevelSchema,
  })
  .strict();

export const chatSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    includeArchived: z.boolean().optional(),
  })
  .strict();

export const chatActivateBranchInputSchema = z
  .object({
    conversationId: entityIdSchema,
    branchId: entityIdSchema,
  })
  .strict();

export const chatEventsInputSchema = z
  .object({
    conversationId: entityIdSchema,
    afterSequence: z.number().int().nonnegative(),
  })
  .strict();

export const emptyInputSchema = z.object({}).strict();

export const chatCommandEnvelopeSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("usage.byok.list"), input: usageQueryInputSchema }).strict(),
  z.object({ command: z.literal("sync.now"), input: emptyInputSchema }).strict(),
  z.object({ command: z.literal("sync.conflicts"), input: emptyInputSchema }).strict(),
  z.object({ command: z.literal("sync.resolve"), input: syncResolveConflictInputSchema }).strict(),
  z.object({ command: z.literal("cache.clear"), input: emptyInputSchema }).strict(),
  z.object({ command: z.literal("memory.settings.get"), input: emptyInputSchema }).strict(),
  z
    .object({
      command: z.literal("memory.settings.update"),
      input: memorySettingsUpdateInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("memory.conversation.settings.get"),
      input: conversationMemorySettingsGetInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("memory.conversation.settings.update"),
      input: conversationMemorySettingsUpdateInputSchema,
    })
    .strict(),
  z.object({ command: z.literal("memory.list"), input: memoryListInputSchema }).strict(),
  z
    .object({
      command: z.literal("memory.merge-reviews.list"),
      input: memoryMergeReviewListInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("memory.merge-reviews.resolve"),
      input: memoryMergeReviewResolveInputSchema,
    })
    .strict(),
  z
    .object({ command: z.literal("memory.sources.list"), input: memorySourcesListInputSchema })
    .strict(),
  z.object({ command: z.literal("memory.upsert"), input: memoryUpsertInputSchema }).strict(),
  z.object({ command: z.literal("memory.delete"), input: memoryDeleteInputSchema }).strict(),
  z.object({ command: z.literal("memory.clear"), input: memoryClearInputSchema }).strict(),
  z.object({ command: z.literal("chat.list"), input: chatListInputSchema }).strict(),
  z.object({ command: z.literal("chat.get"), input: chatGetInputSchema }).strict(),
  z.object({ command: z.literal("chat.send"), input: chatSendInputSchema }).strict(),
  z.object({ command: z.literal("chat.stop"), input: chatStopInputSchema }).strict(),
  z.object({ command: z.literal("chat.regenerate"), input: chatRegenerateInputSchema }).strict(),
  z.object({ command: z.literal("chat.edit"), input: chatEditInputSchema }).strict(),
  z.object({ command: z.literal("chat.rename"), input: chatRenameInputSchema }).strict(),
  z.object({ command: z.literal("chat.archive"), input: chatArchiveInputSchema }).strict(),
  z.object({ command: z.literal("chat.delete"), input: chatDeleteInputSchema }).strict(),
  z.object({ command: z.literal("chat.selectModel"), input: chatSelectModelInputSchema }).strict(),
  z
    .object({
      command: z.literal("chat.selectThinkingLevel"),
      input: chatSelectThinkingLevelInputSchema,
    })
    .strict(),
  z.object({ command: z.literal("chat.search"), input: chatSearchInputSchema }).strict(),
  z
    .object({ command: z.literal("chat.activateBranch"), input: chatActivateBranchInputSchema })
    .strict(),
  z.object({ command: z.literal("chat.events"), input: chatEventsInputSchema }).strict(),
  z.object({ command: z.literal("file.import"), input: fileImportPrivilegedInputSchema }).strict(),
  z.object({ command: z.literal("file.importData"), input: fileImportDataInputSchema }).strict(),
  z.object({ command: z.literal("file.list"), input: fileListInputSchema }).strict(),
  z.object({ command: z.literal("file.search"), input: fileSearchInputSchema }).strict(),
  z.object({ command: z.literal("file.preview"), input: filePreviewInputSchema }).strict(),
  z.object({ command: z.literal("file.scope.revoke"), input: fileRevokeScopeInputSchema }).strict(),
  z.object({ command: z.literal("file.attach"), input: fileAttachInputSchema }).strict(),
  z.object({ command: z.literal("artifact.create"), input: artifactCreateInputSchema }).strict(),
  z
    .object({ command: z.literal("artifact.newVersion"), input: artifactNewVersionInputSchema })
    .strict(),
  z.object({ command: z.literal("artifact.list"), input: artifactListInputSchema }).strict(),
  z.object({ command: z.literal("artifact.get"), input: artifactGetInputSchema }).strict(),
  z.object({ command: z.literal("artifact.preview"), input: artifactPreviewInputSchema }).strict(),
  z
    .object({ command: z.literal("artifact.export"), input: artifactExportPrivilegedInputSchema })
    .strict(),
  z.object({ command: z.literal("tool.workItems.list"), input: toolListInputSchema }).strict(),
  z
    .object({
      command: z.literal("tool.runtime.readiness"),
      input: toolRuntimeReadinessInputSchema,
    })
    .strict(),
  z.object({ command: z.literal("tool.webSearch.settings.get"), input: emptyInputSchema }).strict(),
  z
    .object({
      command: z.literal("tool.webSearch.settings.update"),
      input: localWebSearchSettingsUpdateInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("tool.webSearch.runtime.reset"),
      input: localWebSearchRuntimeResetInputSchema,
    })
    .strict(),
  z.object({ command: z.literal("tool.workItem.get"), input: workItemGetInputSchema }).strict(),
  z
    .object({ command: z.literal("tool.permissions.list"), input: permissionListInputSchema })
    .strict(),
  z
    .object({ command: z.literal("tool.permission.resolve"), input: permissionResolveInputSchema })
    .strict(),
  z
    .object({
      command: z.literal("tool.permissionMode.get"),
      input: toolPermissionModeGetInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("tool.permissionMode.set"),
      input: toolPermissionModeSetInputSchema,
    })
    .strict(),
  z.object({ command: z.literal("tool.scopes.list"), input: emptyInputSchema }).strict(),
  z.object({ command: z.literal("tool.scope.revoke"), input: toolScopeRevokeInputSchema }).strict(),
  z
    .object({ command: z.literal("workspace.grant"), input: workspaceGrantPrivilegedInputSchema })
    .strict(),
  z.object({ command: z.literal("workspace.list"), input: workspaceListInputSchema }).strict(),
  z.object({ command: z.literal("workspace.revoke"), input: workspaceRevokeInputSchema }).strict(),
  z
    .object({ command: z.literal("workspace.setPrimary"), input: workspaceSetPrimaryInputSchema })
    .strict(),
  z.object({ command: z.literal("mcp.servers.list"), input: emptyInputSchema }).strict(),
  z.object({ command: z.literal("mcp.servers.authorization"), input: emptyInputSchema }).strict(),
  z
    .object({ command: z.literal("mcp.server.authorize"), input: mcpServerAuthorizeInputSchema })
    .strict(),
  z.object({ command: z.literal("mcp.server.upsert"), input: mcpServerUpsertInputSchema }).strict(),
  z.object({ command: z.literal("mcp.server.remove"), input: mcpServerRemoveInputSchema }).strict(),
  z.object({ command: z.literal("skill.list"), input: skillListInputSchema }).strict(),
  z.object({ command: z.literal("skill.get"), input: skillGetInputSchema }).strict(),
  z
    .object({ command: z.literal("skill.install"), input: skillInstallPrivilegedInputSchema })
    .strict(),
  z
    .object({ command: z.literal("skill.update"), input: skillUpdatePrivilegedInputSchema })
    .strict(),
  z.object({ command: z.literal("skill.enable"), input: skillEnableInputSchema }).strict(),
  z.object({ command: z.literal("skill.autoInvoke"), input: skillAutoInvokeInputSchema }).strict(),
  z
    .object({
      command: z.literal("skill.permissions.approve"),
      input: skillApprovePermissionsInputSchema,
    })
    .strict(),
  z
    .object({
      command: z.literal("skill.permissions.reset"),
      input: skillResetPermissionsInputSchema,
    })
    .strict(),
  z.object({ command: z.literal("skill.rollback"), input: skillRollbackInputSchema }).strict(),
  z.object({ command: z.literal("skill.uninstall"), input: skillUninstallInputSchema }).strict(),
  z
    .object({ command: z.literal("skill.invocations.list"), input: skillInvocationListInputSchema })
    .strict(),
]);

export const deletedConversationResultSchema = z
  .object({
    conversationId: entityIdSchema,
    deletedAt: timestampSchema,
  })
  .strict();

export const chatEventSchema = z
  .object({
    eventId: entityIdSchema,
    type: z.enum([
      "service.status",
      "conversation.created",
      "conversation.updated",
      "conversation.deleted",
      "branch.activated",
      "message.accepted",
      "message.delta",
      "message.completed",
      "message.cancelling",
      "message.stopped",
      "message.interrupted",
      "message.failed",
      "run.started",
      "run.progressed",
      "run.cancelling",
      "run.compacted",
      "run.retrying",
      "run.completed",
      "run.failed",
      "run.interrupted",
      "run.cancelled",
      "tool.requested",
      "tool.progressed",
      "tool.completed",
      "tool.failed",
      "permission.required",
      "permission.resolved",
    ]),
    conversationId: entityIdSchema.nullable(),
    messageId: entityIdSchema.nullable(),
    sequence: z.number().int().nonnegative(),
    occurredAt: timestampSchema,
    payloadVersion: z.literal(1),
    payload: z
      .object({
        conversation: conversationSchema.optional(),
        message: messageSchema.optional(),
        delta: z.string().optional(),
        status: z.enum(["starting", "ready", "restarting", "unavailable"]).optional(),
        reason: z.string().optional(),
        workItem: workItemSchema.optional(),
        run: executionRunSchema.optional(),
        step: runStepSchema.optional(),
        toolCall: toolCallSchema.optional(),
        permission: permissionRequestSchema.optional(),
        reconciliation: z
          .array(
            z
              .object({
                kind: z.enum(["remote_command", "tool_side_effect", "workspace_change_set"]),
                targetId: z.string().min(1).max(240),
                status: z.enum([
                  "pending_review",
                  "reviewed",
                  "applied",
                  "reverted",
                  "discarded",
                  "blocked",
                  "apply_failed",
                  "outcome_unknown",
                ]),
                actionRequired: z.boolean(),
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict(),
  })
  .strict();

export type Message = z.infer<typeof messageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type Branch = z.infer<typeof branchSchema>;
export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;
export type GenerationReceipt = z.infer<typeof generationReceiptSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type ChatCommandEnvelope = z.infer<typeof chatCommandEnvelopeSchema>;
export type ChatEvent = z.infer<typeof chatEventSchema>;

export interface ChatCommandResultMap {
  "usage.byok.list": z.infer<typeof byokUsageQueryResultSchema>;
  "sync.now": z.infer<typeof syncStatusSchema>;
  "sync.conflicts": SyncConflict[];
  "sync.resolve": z.infer<typeof syncStatusSchema>;
  "cache.clear": z.infer<typeof localCacheClearResultSchema>;
  "memory.settings.get": MemorySettings;
  "memory.settings.update": MemorySettings;
  "memory.conversation.settings.get": ConversationMemorySettings;
  "memory.conversation.settings.update": ConversationMemorySettings;
  "memory.list": MemoryEntry[];
  "memory.merge-reviews.list": MemoryMergeReview[];
  "memory.merge-reviews.resolve": MemoryMergeReview;
  "memory.sources.list": MemorySourceLink[];
  "memory.upsert": MemoryEntry;
  "memory.delete": MemoryEntry;
  "memory.clear": MemoryClearResult;
  "chat.list": ConversationSummary[];
  "chat.get": ConversationSnapshot;
  "chat.send": GenerationReceipt;
  "chat.stop": Message;
  "chat.regenerate": GenerationReceipt;
  "chat.edit": GenerationReceipt;
  "chat.rename": Conversation;
  "chat.archive": Conversation;
  "chat.delete": z.infer<typeof deletedConversationResultSchema>;
  "chat.selectModel": Conversation;
  "chat.selectThinkingLevel": Conversation;
  "chat.search": SearchResult[];
  "chat.activateBranch": ConversationSnapshot;
  "chat.events": ChatEvent[];
  "file.import": PersonalFile[];
  "file.importData": PersonalFile[];
  "file.list": PersonalFile[];
  "file.search": FileSearchResult[];
  "file.preview": ContentPreview;
  "file.scope.revoke": FileScope;
  "file.attach": Attachment;
  "artifact.create": Artifact;
  "artifact.newVersion": Artifact;
  "artifact.list": Artifact[];
  "artifact.get": Artifact;
  "artifact.preview": ContentPreview;
  "artifact.export": z.infer<typeof artifactExportResultSchema>;
  "tool.workItems.list": z.infer<typeof workItemSchema>[];
  "tool.runtime.readiness": z.infer<typeof toolRuntimeReadinessSchema>[];
  "tool.webSearch.settings.get": z.infer<typeof localWebSearchSettingsStateSchema>;
  "tool.webSearch.settings.update": z.infer<typeof localWebSearchSettingsStateSchema>;
  "tool.webSearch.runtime.reset": z.infer<typeof localWebSearchSettingsStateSchema>;
  "tool.workItem.get": z.infer<typeof workItemDetailSchema>;
  "tool.permissions.list": z.infer<typeof permissionRequestSchema>[];
  "tool.permission.resolve": z.infer<typeof permissionRequestSchema>;
  "tool.permissionMode.get": z.infer<typeof toolPermissionModeStateSchema>;
  "tool.permissionMode.set": z.infer<typeof toolPermissionModeStateSchema>;
  "tool.scopes.list": z.infer<typeof capabilityScopeSchema>[];
  "tool.scope.revoke": z.infer<typeof capabilityScopeSchema>;
  "workspace.grant": WorkspaceGrant;
  "workspace.list": WorkspaceGrant[];
  "workspace.revoke": WorkspaceGrant;
  "workspace.setPrimary": WorkspaceGrant;
  "mcp.servers.list": z.infer<typeof mcpServerConfigSchema>[];
  "mcp.servers.authorization": z.infer<typeof mcpServerAuthorizationStateSchema>[];
  "mcp.server.authorize": z.infer<typeof mcpServerAuthorizationStateSchema>;
  "mcp.server.upsert": z.infer<typeof mcpServerConfigSchema>;
  "mcp.server.remove": z.infer<typeof mcpServerRemoveResultSchema>;
  "skill.list": SkillInstallation[];
  "skill.get": SkillInstallation;
  "skill.install": SkillInstallation;
  "skill.update": SkillInstallation;
  "skill.enable": SkillInstallation;
  "skill.autoInvoke": SkillInstallation;
  "skill.permissions.approve": SkillInstallation;
  "skill.permissions.reset": SkillInstallation;
  "skill.rollback": SkillInstallation;
  "skill.uninstall": z.infer<typeof skillUninstallResultSchema>;
  "skill.invocations.list": SkillInvocation[];
}

export function parseChatCommandResult<C extends keyof ChatCommandResultMap>(
  command: C,
  value: unknown,
): ChatCommandResultMap[C] {
  let parsed: unknown;
  switch (command) {
    case "usage.byok.list":
      parsed = byokUsageQueryResultSchema.parse(value);
      break;
    case "sync.now":
    case "sync.resolve":
      parsed = syncStatusSchema.parse(value);
      break;
    case "sync.conflicts":
      parsed = z.array(syncConflictSchema).parse(value);
      break;
    case "cache.clear":
      parsed = localCacheClearResultSchema.parse(value);
      break;
    case "memory.settings.get":
    case "memory.settings.update":
      parsed = memorySettingsSchema.parse(value);
      break;
    case "memory.conversation.settings.get":
    case "memory.conversation.settings.update":
      parsed = conversationMemorySettingsSchema.parse(value);
      break;
    case "memory.list":
      parsed = z.array(memoryEntrySchema).parse(value);
      break;
    case "memory.merge-reviews.list":
      parsed = z.array(memoryMergeReviewSchema).max(100).parse(value);
      break;
    case "memory.merge-reviews.resolve":
      parsed = memoryMergeReviewSchema.parse(value);
      break;
    case "memory.sources.list":
      parsed = z.array(memorySourceLinkSchema).max(200).parse(value);
      break;
    case "memory.upsert":
    case "memory.delete":
      parsed = memoryEntrySchema.parse(value);
      break;
    case "memory.clear":
      parsed = memoryClearResultSchema.parse(value);
      break;
    case "chat.list":
      parsed = z.array(conversationSummarySchema).parse(value);
      break;
    case "chat.get":
    case "chat.activateBranch":
      parsed = conversationSnapshotSchema.parse(value);
      break;
    case "chat.send":
    case "chat.regenerate":
    case "chat.edit":
      parsed = generationReceiptSchema.parse(value);
      break;
    case "chat.stop":
      parsed = messageSchema.parse(value);
      break;
    case "chat.rename":
    case "chat.archive":
    case "chat.selectModel":
    case "chat.selectThinkingLevel":
      parsed = conversationSchema.parse(value);
      break;
    case "chat.delete":
      parsed = deletedConversationResultSchema.parse(value);
      break;
    case "chat.search":
      parsed = z.array(searchResultSchema).parse(value);
      break;
    case "chat.events":
      parsed = z.array(chatEventSchema).parse(value);
      break;
    case "file.import":
    case "file.importData":
    case "file.list":
      parsed = z.array(personalFileSchema).parse(value);
      break;
    case "file.search":
      parsed = z.array(fileSearchResultSchema).parse(value);
      break;
    case "file.preview":
    case "artifact.preview":
      parsed = contentPreviewSchema.parse(value);
      break;
    case "file.scope.revoke":
      parsed = fileScopeSchema.parse(value);
      break;
    case "file.attach":
      parsed = attachmentSchema.parse(value);
      break;
    case "artifact.create":
    case "artifact.newVersion":
    case "artifact.get":
      parsed = artifactSchema.parse(value);
      break;
    case "artifact.list":
      parsed = z.array(artifactSchema).parse(value);
      break;
    case "artifact.export":
      parsed = artifactExportResultSchema.parse(value);
      break;
    case "tool.workItems.list":
      parsed = z.array(workItemSchema).parse(value);
      break;
    case "tool.runtime.readiness":
      parsed = z.array(toolRuntimeReadinessSchema).parse(value);
      break;
    case "tool.webSearch.settings.get":
    case "tool.webSearch.settings.update":
    case "tool.webSearch.runtime.reset":
      parsed = localWebSearchSettingsStateSchema.parse(value);
      break;
    case "tool.workItem.get":
      parsed = workItemDetailSchema.parse(value);
      break;
    case "tool.permissions.list":
      parsed = z.array(permissionRequestSchema).parse(value);
      break;
    case "tool.permission.resolve":
      parsed = permissionRequestSchema.parse(value);
      break;
    case "tool.permissionMode.get":
    case "tool.permissionMode.set":
      parsed = toolPermissionModeStateSchema.parse(value);
      break;
    case "tool.scopes.list":
      parsed = z.array(capabilityScopeSchema).parse(value);
      break;
    case "tool.scope.revoke":
      parsed = capabilityScopeSchema.parse(value);
      break;
    case "workspace.grant":
    case "workspace.revoke":
    case "workspace.setPrimary":
      parsed = workspaceGrantSchema.parse(value);
      break;
    case "workspace.list":
      parsed = z.array(workspaceGrantSchema).parse(value);
      break;
    case "mcp.servers.list":
      parsed = z.array(mcpServerConfigSchema).parse(value);
      break;
    case "mcp.servers.authorization":
      parsed = z.array(mcpServerAuthorizationStateSchema).parse(value);
      break;
    case "mcp.server.authorize":
      parsed = mcpServerAuthorizationStateSchema.parse(value);
      break;
    case "mcp.server.upsert":
      parsed = mcpServerConfigSchema.parse(value);
      break;
    case "mcp.server.remove":
      parsed = mcpServerRemoveResultSchema.parse(value);
      break;
    case "skill.list":
      parsed = z.array(skillInstallationSchema).parse(value);
      break;
    case "skill.get":
    case "skill.install":
    case "skill.update":
    case "skill.enable":
    case "skill.autoInvoke":
    case "skill.permissions.approve":
    case "skill.permissions.reset":
    case "skill.rollback":
      parsed = skillInstallationSchema.parse(value);
      break;
    case "skill.uninstall":
      parsed = skillUninstallResultSchema.parse(value);
      break;
    case "skill.invocations.list":
      parsed = z.array(skillInvocationSchema).parse(value);
      break;
  }
  return parsed as ChatCommandResultMap[C];
}

export interface ChatBridge {
  getMemorySettings(): Promise<MemorySettings>;
  updateMemorySettings(
    input: z.input<typeof memorySettingsUpdateInputSchema>,
  ): Promise<MemorySettings>;
  getConversationMemorySettings(
    input: z.input<typeof conversationMemorySettingsGetInputSchema>,
  ): Promise<ConversationMemorySettings>;
  updateConversationMemorySettings(
    input: z.input<typeof conversationMemorySettingsUpdateInputSchema>,
  ): Promise<ConversationMemorySettings>;
  listMemories(input?: z.input<typeof memoryListInputSchema>): Promise<MemoryEntry[]>;
  listMemoryMergeReviews(
    input?: z.input<typeof memoryMergeReviewListInputSchema>,
  ): Promise<MemoryMergeReview[]>;
  resolveMemoryMergeReview(
    input: z.input<typeof memoryMergeReviewResolveInputSchema>,
  ): Promise<MemoryMergeReview>;
  listMemorySources(
    input: z.input<typeof memorySourcesListInputSchema>,
  ): Promise<MemorySourceLink[]>;
  upsertMemory(input: z.input<typeof memoryUpsertInputSchema>): Promise<MemoryEntry>;
  deleteMemory(input: z.input<typeof memoryDeleteInputSchema>): Promise<MemoryEntry>;
  clearMemories(input: z.input<typeof memoryClearInputSchema>): Promise<MemoryClearResult>;
  onAutomaticMemoryCreated(listener: (event: AutomaticMemoryCreatedEvent) => void): () => void;
  onMemoryNavigate(listener: (memoryId: string) => void): () => void;
  listConversations(input?: z.input<typeof chatListInputSchema>): Promise<ConversationSummary[]>;
  getConversation(input: z.input<typeof chatGetInputSchema>): Promise<ConversationSnapshot>;
  sendMessage(input: z.input<typeof chatSendInputSchema>): Promise<GenerationReceipt>;
  stopGeneration(input: z.input<typeof chatStopInputSchema>): Promise<Message>;
  regenerateMessage(input: z.input<typeof chatRegenerateInputSchema>): Promise<GenerationReceipt>;
  editMessage(input: z.input<typeof chatEditInputSchema>): Promise<GenerationReceipt>;
  renameConversation(input: z.input<typeof chatRenameInputSchema>): Promise<Conversation>;
  setConversationArchived(input: z.input<typeof chatArchiveInputSchema>): Promise<Conversation>;
  deleteConversation(
    input: z.input<typeof chatDeleteInputSchema>,
  ): Promise<z.infer<typeof deletedConversationResultSchema>>;
  selectConversationModel(input: z.input<typeof chatSelectModelInputSchema>): Promise<Conversation>;
  selectConversationThinkingLevel(
    input: z.input<typeof chatSelectThinkingLevelInputSchema>,
  ): Promise<Conversation>;
  search(input: z.input<typeof chatSearchInputSchema>): Promise<SearchResult[]>;
  activateBranch(
    input: z.input<typeof chatActivateBranchInputSchema>,
  ): Promise<ConversationSnapshot>;
  getChatEvents(input: z.input<typeof chatEventsInputSchema>): Promise<ChatEvent[]>;
  onChatEvent(listener: (event: ChatEvent) => void): () => void;
}
