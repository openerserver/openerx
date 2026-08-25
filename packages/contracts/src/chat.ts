import { z } from "zod";
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
  localCacheClearResultSchema,
  type SyncConflict,
  syncConflictSchema,
  syncResolveConflictInputSchema,
  syncStatusSchema,
} from "./sync";

export const entityIdSchema = z.uuid();
export const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO timestamp",
});

export const messageStatusSchema = z.enum([
  "pending",
  "streaming",
  "completed",
  "stopped",
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
    title: z.string().min(1).max(120),
    activeBranchId: entityIdSchema,
    selectedModelRef: z.string().min(1),
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
    text: z.string().trim().min(1).max(100_000),
    idempotencyKey: z.string().min(8).max(200),
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

export const chatDeleteInputSchema = z.object({ conversationId: entityIdSchema }).strict();

export const chatSelectModelInputSchema = z
  .object({
    conversationId: entityIdSchema,
    modelRef: z.string().regex(/^platform\/[a-z0-9][a-z0-9._-]*$/),
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
  z.object({ command: z.literal("sync.now"), input: emptyInputSchema }).strict(),
  z.object({ command: z.literal("sync.conflicts"), input: emptyInputSchema }).strict(),
  z.object({ command: z.literal("sync.resolve"), input: syncResolveConflictInputSchema }).strict(),
  z.object({ command: z.literal("cache.clear"), input: emptyInputSchema }).strict(),
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
  z.object({ command: z.literal("chat.search"), input: chatSearchInputSchema }).strict(),
  z
    .object({ command: z.literal("chat.activateBranch"), input: chatActivateBranchInputSchema })
    .strict(),
  z.object({ command: z.literal("chat.events"), input: chatEventsInputSchema }).strict(),
  z.object({ command: z.literal("file.import"), input: fileImportPrivilegedInputSchema }).strict(),
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
      "message.stopped",
      "message.failed",
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
  "sync.now": z.infer<typeof syncStatusSchema>;
  "sync.conflicts": SyncConflict[];
  "sync.resolve": z.infer<typeof syncStatusSchema>;
  "cache.clear": z.infer<typeof localCacheClearResultSchema>;
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
  "chat.search": SearchResult[];
  "chat.activateBranch": ConversationSnapshot;
  "chat.events": ChatEvent[];
  "file.import": PersonalFile[];
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
}

export function parseChatCommandResult<C extends keyof ChatCommandResultMap>(
  command: C,
  value: unknown,
): ChatCommandResultMap[C] {
  let parsed: unknown;
  switch (command) {
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
  }
  return parsed as ChatCommandResultMap[C];
}

export interface ChatBridge {
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
  search(input: z.input<typeof chatSearchInputSchema>): Promise<SearchResult[]>;
  activateBranch(
    input: z.input<typeof chatActivateBranchInputSchema>,
  ): Promise<ConversationSnapshot>;
  getChatEvents(input: z.input<typeof chatEventsInputSchema>): Promise<ChatEvent[]>;
  onChatEvent(listener: (event: ChatEvent) => void): () => void;
}
