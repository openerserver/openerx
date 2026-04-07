import { z } from "zod";

export const taskSessionRuntimeMessageStringSchema = z.string().trim().min(1);
export const taskSessionRuntimeMessageTextSchema = z.string().trim().min(1);
export const taskSessionRuntimeTimeValueSchema = z.union([
  taskSessionRuntimeMessageStringSchema,
  z.number().finite(),
]);

export const taskSessionRuntimeMessageInfoSchema = z
  .object({
    id: taskSessionRuntimeMessageStringSchema.optional(),
    messageID: taskSessionRuntimeMessageStringSchema.optional(),
    messageId: taskSessionRuntimeMessageStringSchema.optional(),
    role: taskSessionRuntimeMessageStringSchema.optional(),
    error: z.string().optional(),
    finish: taskSessionRuntimeMessageStringSchema.optional(),
    status: taskSessionRuntimeMessageStringSchema.optional(),
    parentID: taskSessionRuntimeMessageStringSchema.optional(),
    parentId: taskSessionRuntimeMessageStringSchema.optional(),
    parent_id: taskSessionRuntimeMessageStringSchema.optional(),
    sessionID: taskSessionRuntimeMessageStringSchema.optional(),
    agent: taskSessionRuntimeMessageStringSchema.optional(),
    model: taskSessionRuntimeMessageStringSchema.optional(),
    preview: z.string().optional(),
    time: z
      .object({
        created: taskSessionRuntimeTimeValueSchema.optional(),
        completed: taskSessionRuntimeTimeValueSchema.optional(),
      })
      .passthrough()
      .optional(),
    tokens: z
      .object({
        total: z.number().finite().optional(),
        input: z.number().finite().optional(),
        output: z.number().finite().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const taskSessionRuntimeTokenUsageSchema = z
  .object({
    total: z.number().finite().optional(),
    input: z.number().finite().optional(),
    output: z.number().finite().optional(),
  })
  .passthrough();

function hasTaskSessionRuntimePartContent(part: Record<string, unknown>) {
  return [
    part.id,
    part.type,
    part.text,
    part.content,
    part.name,
    part.tool,
    part.toolName,
    part.callID,
    part.callId,
    part.toolCallId,
    part.messageID,
    part.messageId,
    part.sessionID,
    part.filePath,
    part.input,
    part.arguments,
    part.state,
    part.startLine,
    part.endLine,
  ].some((value) => value !== undefined && value !== null);
}

export const taskSessionRuntimeMessagePartSchema = z
  .object({
    id: taskSessionRuntimeMessageStringSchema.optional(),
    type: taskSessionRuntimeMessageStringSchema.optional(),
    text: z.string().optional(),
    content: z.string().optional(),
    name: taskSessionRuntimeMessageStringSchema.optional(),
    tool: taskSessionRuntimeMessageStringSchema.optional(),
    toolName: taskSessionRuntimeMessageStringSchema.optional(),
    callID: taskSessionRuntimeMessageStringSchema.optional(),
    callId: taskSessionRuntimeMessageStringSchema.optional(),
    toolCallId: taskSessionRuntimeMessageStringSchema.optional(),
    messageID: taskSessionRuntimeMessageStringSchema.optional(),
    messageId: taskSessionRuntimeMessageStringSchema.optional(),
    sessionID: taskSessionRuntimeMessageStringSchema.optional(),
    filePath: taskSessionRuntimeMessageStringSchema.optional(),
    startLine: z.number().int().optional(),
    endLine: z.number().int().optional(),
    input: z.unknown().optional(),
    arguments: z.unknown().optional(),
    state: z
      .union([
        taskSessionRuntimeMessageStringSchema,
        z
          .object({
            status: taskSessionRuntimeMessageStringSchema.optional(),
            output: z.unknown().optional(),
            error: z.unknown().optional(),
          })
          .passthrough(),
      ])
      .optional(),
  })
  .passthrough()
  .superRefine((part, ctx) => {
    if (!hasTaskSessionRuntimePartContent(part)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Runtime message part must include explicit part content",
      });
    }
  });

export const taskSessionRuntimePromptDecompositionSchema = z
  .object({
    userInputText: taskSessionRuntimeMessageTextSchema.optional(),
    systemContextText: taskSessionRuntimeMessageTextSchema.optional(),
    finalSentText: taskSessionRuntimeMessageTextSchema.optional(),
  })
  .passthrough()
  .superRefine((decomposition, ctx) => {
    if (
      decomposition.userInputText === undefined &&
      decomposition.systemContextText === undefined &&
      decomposition.finalSentText === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "promptDecomposition must include explicit prompt fields",
      });
    }
  });

export function extractTaskSessionMessageRuntimeId(message: Record<string, unknown>) {
  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  const part =
    message.part && typeof message.part === "object"
      ? (message.part as Record<string, unknown>)
      : null;
  const raw =
    message.runtimeMessageId ??
    message.runtime_message_id ??
    message.id ??
    message.messageID ??
    message.messageId ??
    info?.id ??
    info?.messageID ??
    info?.messageId ??
    part?.messageID ??
    part?.messageId;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

const taskSessionRuntimeMessageContentSchema = z.union([
  z.object({
    parts: z.array(taskSessionRuntimeMessagePartSchema).min(1),
  }),
  z.object({
    part: taskSessionRuntimeMessagePartSchema,
  }),
  z.object({
    text: taskSessionRuntimeMessageTextSchema,
  }),
  z.object({
    textContent: taskSessionRuntimeMessageTextSchema,
  }),
  z.object({
    summaryText: taskSessionRuntimeMessageTextSchema,
  }),
  z.object({
    content: taskSessionRuntimeMessageTextSchema,
  }),
  z.object({
    promptDecomposition: taskSessionRuntimePromptDecompositionSchema,
  }),
]);

const taskSessionRuntimeMessageBaseSchema = z
  .object({
    id: taskSessionRuntimeMessageStringSchema.optional(),
    runtimeMessageId: taskSessionRuntimeMessageStringSchema.optional(),
    runtime_message_id: taskSessionRuntimeMessageStringSchema.optional(),
    messageID: taskSessionRuntimeMessageStringSchema.optional(),
    messageId: taskSessionRuntimeMessageStringSchema.optional(),
    role: taskSessionRuntimeMessageStringSchema.optional(),
    status: taskSessionRuntimeMessageStringSchema.optional(),
    tokenUsed: z.number().finite().optional(),
    token_usage: z.number().finite().optional(),
    tokens: z.union([z.number().finite(), taskSessionRuntimeTokenUsageSchema]).optional(),
    text: taskSessionRuntimeMessageTextSchema.optional(),
    textContent: taskSessionRuntimeMessageTextSchema.nullable().optional(),
    summaryText: taskSessionRuntimeMessageTextSchema.nullable().optional(),
    content: taskSessionRuntimeMessageTextSchema.optional(),
    createdAt: taskSessionRuntimeTimeValueSchema.optional(),
    completedAt: taskSessionRuntimeTimeValueSchema.nullable().optional(),
    providerMessageId: taskSessionRuntimeMessageStringSchema.optional(),
    provider_message_id: taskSessionRuntimeMessageStringSchema.optional(),
    clientMessageId: taskSessionRuntimeMessageStringSchema.optional(),
    client_message_id: taskSessionRuntimeMessageStringSchema.optional(),
    errorText: z.string().nullable().optional(),
    error_text: z.string().nullable().optional(),
    finish: taskSessionRuntimeMessageStringSchema.optional(),
    parentID: taskSessionRuntimeMessageStringSchema.optional(),
    parentId: taskSessionRuntimeMessageStringSchema.optional(),
    parent_id: taskSessionRuntimeMessageStringSchema.optional(),
    rawType: taskSessionRuntimeMessageStringSchema.optional(),
    mergedRuntimeMessageIds: z.array(taskSessionRuntimeMessageStringSchema).optional(),
    parts: z.array(taskSessionRuntimeMessagePartSchema).optional(),
    part: taskSessionRuntimeMessagePartSchema.optional(),
    info: taskSessionRuntimeMessageInfoSchema.optional(),
    promptDecomposition: taskSessionRuntimePromptDecompositionSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    attachments: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const taskSessionRuntimeMessageSchema = taskSessionRuntimeMessageBaseSchema
  .and(taskSessionRuntimeMessageContentSchema)
  .superRefine((message, ctx) => {
    if (!extractTaskSessionMessageRuntimeId(message)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Task session message write requires stable runtimeMessageId",
        path: ["id"],
      });
    }

    if (!(message.role || message.info?.role)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Runtime message must include an explicit role",
        path: ["role"],
      });
    }
  });

export type TaskSessionRuntimeMessageInput = z.infer<typeof taskSessionRuntimeMessageSchema>;

function hasTaskSessionRuntimeExplicitRole(message: Record<string, unknown>): boolean {
  if (typeof message.role === "string" && message.role.trim()) {
    return true;
  }

  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  return typeof info?.role === "string" && info.role.trim().length > 0;
}

function hasTaskSessionRuntimePromptDecompositionContent(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const decomposition = value as Record<string, unknown>;
  return [
    decomposition.userInputText,
    decomposition.systemContextText,
    decomposition.finalSentText,
  ].some((field) => typeof field === "string" && field.trim().length > 0);
}

function hasTaskSessionRuntimeExplicitContent(message: Record<string, unknown>): boolean {
  if (Array.isArray(message.parts)) {
    return message.parts.length > 0;
  }

  if (message.part && typeof message.part === "object") {
    return true;
  }

  if (
    [message.text, message.textContent, message.summaryText, message.content].some(
      (field) => typeof field === "string" && field.trim().length > 0,
    )
  ) {
    return true;
  }

  return hasTaskSessionRuntimePromptDecompositionContent(message.promptDecomposition);
}

function collectTaskSessionRuntimeSchemaIssueMessages(
  issues: z.ZodIssue[],
  messages: Set<string>,
): void {
  for (const issue of issues) {
    if (issue.code === "invalid_union") {
      for (const unionError of issue.unionErrors) {
        collectTaskSessionRuntimeSchemaIssueMessages(unionError.issues, messages);
      }
      continue;
    }

    if (issue.message) {
      messages.add(issue.message);
    }
  }
}

function collectTaskSessionRuntimeSemanticMessages(
  value: unknown,
  messages: Set<string>,
): void {
  if (!value || typeof value !== "object") {
    return;
  }

  const message = value as Record<string, unknown>;

  if (!extractTaskSessionMessageRuntimeId(message)) {
    messages.add("Task session message write requires stable runtimeMessageId");
  }

  if (!hasTaskSessionRuntimeExplicitRole(message)) {
    messages.add("Runtime message must include an explicit role");
  }

  if (!hasTaskSessionRuntimeExplicitContent(message)) {
    messages.add(
      "Runtime message must include explicit content via parts, part, text, textContent, summaryText, content, or promptDecomposition",
    );
  }
}

export function parseTaskSessionRuntimeMessage(value: unknown): TaskSessionRuntimeMessageInput {
  const parsed = taskSessionRuntimeMessageSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  const messages = new Set<string>();
  collectTaskSessionRuntimeSchemaIssueMessages(parsed.error.issues, messages);
  collectTaskSessionRuntimeSemanticMessages(value, messages);
  if (messages.size > 1) {
    messages.delete("Required");
  }
  throw new Error(Array.from(messages).join("; "));
}