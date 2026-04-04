import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  taskMessageParts,
  taskMessages,
  taskSessionRuns,
  taskSessions,
  taskTimelineViews,
  type TaskSessionMessagePartType,
  type TaskSessionMessageRole,
  type TaskSessionMessageStatus,
} from "../../db/schema";
import {
  buildTaskSessionDefaultRunId,
  buildTaskSessionWriteId,
  type UpsertTaskSessionRecordArgs,
} from "./task-session-write-api";

type TaskSessionMessageRecordArgs = {
  task: {
    id: string;
    projectId: string;
  };
  sessionId?: string;
  runtimeSessionId?: string;
  message: Record<string, unknown>;
};

type TaskSessionMessageCompatRecord = {
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  sessionKind?:
    | "primary"
    | "candidate"
    | "judge"
    | "sequential_step"
    | "resume"
    | "manual_branch"
    | "hook"
    | null;
};

type TaskSessionMessageCompatRow = {
  source: "canonical" | "legacy";
  id: string;
  role: TaskSessionMessageRole;
  runtimeMessageId: string | null;
  status: TaskSessionMessageStatus | null;
  clientMessageId: string | null;
  providerMessageId: string | null;
  messageIndex: number;
  textContent: string | null;
  rawPayload: Record<string, unknown>;
  tokenUsed: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
};

const CANDIDATE_USER_MESSAGE_DEDUPE_WINDOW_MS = 15_000;
const ASSISTANT_TOOL_CALL_RESULT_MERGE_WINDOW_MS = 15_000;

function asTaskSessionMessageRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTaskSessionMessageString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function buildTaskSessionMessageWriteId(sessionId: string, runtimeMessageId: string) {
  return `task-session-message:${sessionId}:${runtimeMessageId}`;
}

function buildTaskMessagePreview(textContent: string | null) {
  return textContent ? textContent.slice(0, 280) : null;
}

function mapTaskMessageKind(role: TaskSessionMessageRole) {
  if (role === "user") {
    return "prompt" as const;
  }
  if (role === "assistant") {
    return "reply" as const;
  }
  if (role === "tool") {
    return "tool_echo" as const;
  }
  return "note" as const;
}

function mapTaskSessionMessageStatusToNodeStatus(status: TaskSessionMessageStatus) {
  if (status === "completed") {
    return "completed" as const;
  }
  if (status === "failed") {
    return "failed" as const;
  }
  if (status === "cancelled") {
    return "cancelled" as const;
  }
  return "running" as const;
}

function mapLegacySessionKindToRunExecutionKind(sessionKind?: TaskSessionMessageCompatRecord["sessionKind"]) {
  if (sessionKind === "candidate") {
    return "parallel_candidate" as const;
  }
  if (sessionKind === "judge") {
    return "judge" as const;
  }
  if (sessionKind === "sequential_step") {
    return "workflow_step" as const;
  }
  if (sessionKind === "resume") {
    return "resume" as const;
  }
  if (sessionKind === "hook") {
    return "hook" as const;
  }
  return "single" as const;
}

function mapLegacySessionKindToRunLaneRole(sessionKind?: TaskSessionMessageCompatRecord["sessionKind"]) {
  if (sessionKind === "candidate") {
    return "candidate" as const;
  }
  if (sessionKind === "judge") {
    return "judge" as const;
  }
  if (sessionKind === "resume") {
    return "resume" as const;
  }
  if (sessionKind === "hook") {
    return "hook" as const;
  }
  return "primary" as const;
}

function mapLegacySessionKindToExecutorKind(sessionKind?: TaskSessionMessageCompatRecord["sessionKind"]) {
  if (sessionKind === "judge") {
    return "judge";
  }
  if (sessionKind === "hook") {
    return "hook";
  }
  return "assistant";
}

function mapLegacyTriggerTypeToRunTriggerType(triggerType?: string | null) {
  if (triggerType === "continue") {
    return "assistant_reply" as const;
  }
  if (triggerType === "resume") {
    return "resume" as const;
  }
  if (triggerType === "workflow_spawn") {
    return "workflow_spawn" as const;
  }
  if (triggerType === "manual_branch") {
    return "manual_branch" as const;
  }
  return "user_prompt" as const;
}

function normalizeTaskSessionMessageRole(message: Record<string, unknown>): TaskSessionMessageRole {
  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  const role =
    typeof message.role === "string"
      ? message.role
      : typeof info?.role === "string"
        ? info.role
        : "assistant";
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }

  return "assistant";
}

function normalizeTaskSessionMessagePartType(
  part: Record<string, unknown>,
): TaskSessionMessagePartType {
  const rawType = typeof part.type === "string" ? part.type : "text";
  if (rawType === "tool" || rawType === "tool-result" || rawType === "tool_result") {
    return "tool_result";
  }
  if (rawType === "tool-call" || rawType === "tool_call") {
    return "tool_call";
  }
  if (rawType === "reasoning") {
    return "thinking";
  }
  if (rawType === "file" || rawType === "file-reference" || rawType === "file_reference") {
    return "file_reference";
  }
  if (rawType === "diff") {
    return "diff";
  }
  if (rawType === "thinking") {
    return "thinking";
  }

  return "text";
}

function normalizeTaskSessionMessageStatus(
  message: Record<string, unknown>,
): TaskSessionMessageStatus {
  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  const rawStatus =
    typeof message.status === "string"
      ? message.status
      : typeof info?.status === "string"
        ? info.status
        : null;
  if (
    rawStatus === "pending" ||
    rawStatus === "streaming" ||
    rawStatus === "completed" ||
    rawStatus === "failed" ||
    rawStatus === "cancelled"
  ) {
    return rawStatus;
  }

  const errorText = extractTaskSessionMessageErrorText(message);
  if (errorText) {
    return "failed";
  }

  const completedAt = extractTaskSessionMessageCompletedAt(message);
  if (completedAt) {
    return "completed";
  }

  if (normalizeTaskSessionMessageRole(message) === "user") {
    return "completed";
  }

  return extractTaskSessionMessageText(message) ? "streaming" : "pending";
}

function extractTaskSessionMessageText(message: Record<string, unknown>) {
  const candidates = [message.textContent, message.text, message.summaryText, message.content];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  const parts = extractTaskSessionMessageParts(message);
  for (const part of parts) {
    const text = extractTaskSessionMessagePartText(part);
    if (text) {
      return text;
    }
  }

  return null;
}

function normalizeTaskSessionMessageComparableText(value: string | null) {
  return typeof value === "string" && value.trim() ? value.replace(/\r\n/g, "\n").trim() : null;
}

function extractTaskSessionMessageTokenUsage(message: Record<string, unknown>) {
  const tokenCandidates = [message.tokenUsed, message.token_usage, message.tokens];
  for (const candidate of tokenCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  const tokenInfo =
    info?.tokens && typeof info.tokens === "object"
      ? (info.tokens as Record<string, unknown>)
      : null;
  if (typeof tokenInfo?.total === "number" && Number.isFinite(tokenInfo.total)) {
    return tokenInfo.total;
  }

  return null;
}

function extractTaskSessionMessageClientId(message: Record<string, unknown>) {
  const raw = message.clientMessageId ?? message.client_message_id;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function extractTaskSessionMessageRuntimeId(message: Record<string, unknown>) {
  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  const raw = message.runtimeMessageId ?? message.runtime_message_id ?? message.id ?? info?.id;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function extractTaskSessionMessageProviderMessageId(message: Record<string, unknown>) {
  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  const raw = message.providerMessageId ?? message.provider_message_id ?? info?.id;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function extractTaskSessionMessageErrorText(message: Record<string, unknown>) {
  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  const raw = message.errorText ?? message.error_text ?? info?.error;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function normalizeTaskSessionMessageTimeValue(value: unknown) {
  if (typeof value === "string" && value) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  return null;
}

function extractTaskSessionMessageCreatedAt(message: Record<string, unknown>) {
  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  const infoTime =
    info?.time && typeof info.time === "object"
      ? (info.time as Record<string, unknown>)
      : null;

  return (
    normalizeTaskSessionMessageTimeValue(message.createdAt) ||
    normalizeTaskSessionMessageTimeValue(infoTime?.created) ||
    new Date().toISOString()
  );
}

function extractTaskSessionMessageCompletedAt(message: Record<string, unknown>) {
  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  const infoTime =
    info?.time && typeof info.time === "object"
      ? (info.time as Record<string, unknown>)
      : null;

  return (
    normalizeTaskSessionMessageTimeValue(message.completedAt) ||
    normalizeTaskSessionMessageTimeValue(infoTime?.completed) ||
    null
  );
}

function extractTaskSessionMessageParts(message: Record<string, unknown>) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts.filter(
    (part): part is Record<string, unknown> => Boolean(part && typeof part === "object"),
  );
}

function extractTaskSessionMessageFinishReason(message: Record<string, unknown>) {
  const info = extractTaskSessionMessageInfoRecord(message);
  return asTaskSessionMessageString(message.finish) ?? asTaskSessionMessageString(info?.finish);
}

function extractTaskSessionMessageInfoRecord(message: Record<string, unknown>) {
  return asTaskSessionMessageRecord(message.info);
}

function extractTaskSessionMessageParentId(message: Record<string, unknown>) {
  const info = extractTaskSessionMessageInfoRecord(message);
  const raw =
    message.parentID ??
    message.parentId ??
    message.parent_id ??
    info?.parentID ??
    info?.parentId ??
    info?.parent_id;
  return asTaskSessionMessageString(raw);
}

function extractTaskSessionMessageMergedRuntimeMessageIds(message: Record<string, unknown>) {
  const merged = message.mergedRuntimeMessageIds;
  if (!Array.isArray(merged)) {
    return [];
  }

  return merged.filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function buildMergedTaskSessionRuntimeMessageIds(args: {
  existingPayload: Record<string, unknown>;
  existingRuntimeMessageId: string | null;
  incomingRuntimeMessageId: string;
}) {
  const merged = new Set<string>(
    extractTaskSessionMessageMergedRuntimeMessageIds(args.existingPayload),
  );
  const existingInfo = extractTaskSessionMessageInfoRecord(args.existingPayload);
  const existingInfoId = asTaskSessionMessageString(existingInfo?.id);
  if (existingInfoId) {
    merged.add(existingInfoId);
  }
  if (args.existingRuntimeMessageId) {
    merged.add(args.existingRuntimeMessageId);
  }
  merged.add(args.incomingRuntimeMessageId);
  return Array.from(merged);
}

function isTaskSessionMessagePartType(part: Record<string, unknown>, partType: string) {
  return asTaskSessionMessageString(part.type) === partType;
}

function isToolLikeTaskSessionMessagePart(part: Record<string, unknown>) {
  const type = asTaskSessionMessageString(part.type);
  return type === "tool" || type === "tool_call" || type === "tool-result" || type === "tool_result";
}

function extractTaskSessionMessagePartIdentity(part: Record<string, unknown>) {
  return (
    asTaskSessionMessageString(part.id) ??
    asTaskSessionMessageString(part.callID) ??
    asTaskSessionMessageString(part.toolCallId)
  );
}

function hasTaskSessionMessageToolPart(message: Record<string, unknown>) {
  return extractTaskSessionMessageParts(message).some((part) => isToolLikeTaskSessionMessagePart(part));
}

function mergeAssistantToolCallFollowupParts(args: {
  existingMessage: Record<string, unknown>;
  incomingMessage: Record<string, unknown>;
}) {
  const existingParts = extractTaskSessionMessageParts(args.existingMessage);
  const incomingParts = extractTaskSessionMessageParts(args.incomingMessage).map((part) => ({
    ...part,
  }));
  const incomingToolIds = new Set(
    incomingParts
      .filter((part) => isToolLikeTaskSessionMessagePart(part))
      .map((part) => extractTaskSessionMessagePartIdentity(part))
      .filter((value): value is string => Boolean(value)),
  );
  const carryoverToolParts = existingParts
    .filter((part) => isToolLikeTaskSessionMessagePart(part))
    .filter((part) => {
      const identity = extractTaskSessionMessagePartIdentity(part);
      return !identity || !incomingToolIds.has(identity);
    })
    .map((part) => ({ ...part }));

  const mergedParts = [...incomingParts];
  if (carryoverToolParts.length > 0) {
    const insertAt = mergedParts.findIndex(
      (part) =>
        isTaskSessionMessagePartType(part, "text") || isTaskSessionMessagePartType(part, "step-finish"),
    );
    if (insertAt < 0) {
      mergedParts.push(...carryoverToolParts);
    } else {
      mergedParts.splice(insertAt, 0, ...carryoverToolParts);
    }
  }

  if (!mergedParts.some((part) => isTaskSessionMessagePartType(part, "text"))) {
    const fallbackTextParts = existingParts
      .filter((part) => isTaskSessionMessagePartType(part, "text"))
      .map((part) => ({ ...part }));
    if (fallbackTextParts.length > 0) {
      const insertAt = mergedParts.findIndex((part) => isTaskSessionMessagePartType(part, "step-finish"));
      if (insertAt < 0) {
        mergedParts.push(...fallbackTextParts);
      } else {
        mergedParts.splice(insertAt, 0, ...fallbackTextParts);
      }
    }
  }

  if (!mergedParts.some((part) => isTaskSessionMessagePartType(part, "step-start"))) {
    const fallbackStepStart = existingParts.find((part) => isTaskSessionMessagePartType(part, "step-start"));
    if (fallbackStepStart) {
      mergedParts.unshift({ ...fallbackStepStart });
    }
  }

  if (!mergedParts.some((part) => isTaskSessionMessagePartType(part, "step-finish"))) {
    const fallbackStepFinish = [...existingParts]
      .reverse()
      .find((part) => isTaskSessionMessagePartType(part, "step-finish"));
    if (fallbackStepFinish) {
      mergedParts.push({ ...fallbackStepFinish });
    }
  }

  return mergedParts;
}

function buildMergedAssistantToolCallFollowupPayload(args: {
  existingPayload: Record<string, unknown>;
  existingRuntimeMessageId: string | null;
  incomingMessage: Record<string, unknown>;
  incomingRuntimeMessageId: string;
}) {
  const existingInfo = extractTaskSessionMessageInfoRecord(args.existingPayload) ?? {};
  const incomingInfo = extractTaskSessionMessageInfoRecord(args.incomingMessage) ?? {};
  const existingTime = asTaskSessionMessageRecord(existingInfo.time) ?? {};
  const incomingTime = asTaskSessionMessageRecord(incomingInfo.time) ?? {};
  const preservedMessageId =
    asTaskSessionMessageString(existingInfo.id) ??
    asTaskSessionMessageString(args.existingPayload.id) ??
    args.existingRuntimeMessageId ??
    args.incomingRuntimeMessageId;
  const preservedRuntimeMessageId =
    asTaskSessionMessageString(args.existingPayload.runtimeMessageId) ??
    args.existingRuntimeMessageId ??
    preservedMessageId;
  const mergedText =
    extractTaskSessionMessageText(args.incomingMessage) ??
    extractTaskSessionMessageText(args.existingPayload);
  const mergedParentId =
    extractTaskSessionMessageParentId(args.incomingMessage) ??
    extractTaskSessionMessageParentId(args.existingPayload);
  const mergedRuntimeMessageIds = buildMergedTaskSessionRuntimeMessageIds({
    existingPayload: args.existingPayload,
    existingRuntimeMessageId: args.existingRuntimeMessageId,
    incomingRuntimeMessageId: args.incomingRuntimeMessageId,
  });

  return {
    ...args.existingPayload,
    ...args.incomingMessage,
    id: preservedMessageId,
    runtimeMessageId: preservedRuntimeMessageId,
    text: mergedText,
    textContent: mergedText,
    summaryText: mergedText,
    parts: mergeAssistantToolCallFollowupParts({
      existingMessage: args.existingPayload,
      incomingMessage: args.incomingMessage,
    }),
    mergedRuntimeMessageIds,
    info: {
      ...existingInfo,
      ...incomingInfo,
      id: preservedMessageId,
      ...(mergedParentId ? { parentID: mergedParentId } : {}),
      time: {
        ...existingTime,
        ...incomingTime,
        created:
          existingTime.created ??
          incomingTime.created ??
          args.existingPayload.createdAt ??
          args.incomingMessage.createdAt,
        completed:
          incomingTime.completed ??
          existingTime.completed ??
          args.incomingMessage.completedAt ??
          args.existingPayload.completedAt,
      },
    },
  } satisfies Record<string, unknown>;
}

function shouldMergeAssistantToolCallFollowup(args: {
  latestMessage: {
    role: TaskSessionMessageRole;
    rawPayload: Record<string, unknown>;
    textContent: string | null;
    createdAt: string;
    runtimeMessageId: string | null;
  };
  incomingMessage: Record<string, unknown>;
  incomingRuntimeMessageId: string;
  incomingTextContent: string | null;
  incomingCreatedAt: string;
}) {
  if (args.latestMessage.role !== "assistant") {
    return false;
  }

  const existingText = normalizeTaskSessionMessageComparableText(
    args.latestMessage.textContent ?? extractTaskSessionMessageText(args.latestMessage.rawPayload),
  );
  const incomingText = normalizeTaskSessionMessageComparableText(
    args.incomingTextContent ?? extractTaskSessionMessageText(args.incomingMessage),
  );
  if (!existingText || !incomingText || existingText !== incomingText) {
    return false;
  }

  const latestMergedRuntimeIds = extractTaskSessionMessageMergedRuntimeMessageIds(
    args.latestMessage.rawPayload,
  );
  if (latestMergedRuntimeIds.includes(args.incomingRuntimeMessageId)) {
    return true;
  }

  if (!hasTaskSessionMessageToolPart(args.latestMessage.rawPayload)) {
    return false;
  }

  if (extractTaskSessionMessageFinishReason(args.latestMessage.rawPayload) !== "tool-calls") {
    return false;
  }

  if (extractTaskSessionMessageFinishReason(args.incomingMessage) === "tool-calls") {
    return false;
  }

  const latestParentId = extractTaskSessionMessageParentId(args.latestMessage.rawPayload);
  const incomingParentId = extractTaskSessionMessageParentId(args.incomingMessage);
  if (latestParentId !== incomingParentId) {
    return false;
  }

  const latestCreatedAt = parseTaskSessionMessageTime(args.latestMessage.createdAt);
  const incomingCreatedAt = parseTaskSessionMessageTime(args.incomingCreatedAt);
  if (latestCreatedAt === null || incomingCreatedAt === null) {
    return false;
  }

  return Math.abs(incomingCreatedAt - latestCreatedAt) <= ASSISTANT_TOOL_CALL_RESULT_MERGE_WINDOW_MS;
}

function buildTaskTimelineMessageId(messageId: string) {
  return `task-timeline:message:${messageId}`;
}

function parseTaskSessionMessageTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function shouldReuseParentUserMessage(args: {
  existingCreatedAt: string;
  incomingCreatedAt: string;
}) {
  const existingTime = parseTaskSessionMessageTime(args.existingCreatedAt);
  const incomingTime = parseTaskSessionMessageTime(args.incomingCreatedAt);
  if (existingTime === null || incomingTime === null) {
    return false;
  }

  return Math.abs(existingTime - incomingTime) <= CANDIDATE_USER_MESSAGE_DEDUPE_WINDOW_MS;
}

function normalizePersistedTaskSessionMessageStatus(value: string | null | undefined) {
  if (
    value === "pending" ||
    value === "streaming" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}

function mapCanonicalTaskSessionMessageRow(
  message: typeof taskMessages.$inferSelect,
): TaskSessionMessageCompatRow {
  return {
    source: "canonical",
    id: message.id,
    role: message.role,
    runtimeMessageId:
      message.runtimeMessageId ?? extractTaskSessionMessageRuntimeId(message.rawPayload) ?? null,
    status: normalizePersistedTaskSessionMessageStatus(message.status),
    clientMessageId: message.clientMessageId ?? extractTaskSessionMessageClientId(message.rawPayload),
    providerMessageId:
      message.providerMessageId ??
      extractTaskSessionMessageProviderMessageId(message.rawPayload),
    messageIndex: message.seq,
    textContent:
      message.textContent ??
      extractTaskSessionMessageText(message.rawPayload) ??
      message.textPreview ??
      null,
    rawPayload: message.rawPayload,
    tokenUsed: message.tokenUsed,
    startedAt: message.startedAt ?? message.createdAt,
    completedAt: message.completedAt ?? null,
    errorText: message.errorText ?? extractTaskSessionMessageErrorText(message.rawPayload),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

async function loadCanonicalTaskSessionMessageById(messageId: string) {
  const message = await db.query.taskMessages.findFirst({
    where: eq(taskMessages.id, messageId),
  });
  return message ? mapCanonicalTaskSessionMessageRow(message) : null;
}

async function loadTaskSessionMessageById(messageId: string) {
  return loadCanonicalTaskSessionMessageById(messageId);
}

async function loadLatestCanonicalTaskSessionMessage(sessionId: string) {
  const message = await db.query.taskMessages.findFirst({
    where: eq(taskMessages.sessionId, sessionId),
    orderBy: [desc(taskMessages.seq), desc(taskMessages.createdAt)],
  });
  return message ? mapCanonicalTaskSessionMessageRow(message) : null;
}

async function loadLatestTaskSessionMessage(sessionId: string) {
  return loadLatestCanonicalTaskSessionMessage(sessionId);
}

async function loadEquivalentCanonicalTaskSessionUserMessage(args: {
  sessionId: string;
  textContent: string;
}) {
  const message = await db.query.taskMessages.findFirst({
    where: and(
      eq(taskMessages.sessionId, args.sessionId),
      eq(taskMessages.role, "user"),
      eq(taskMessages.textContent, args.textContent),
    ),
    orderBy: [desc(taskMessages.createdAt)],
  });
  return message ? mapCanonicalTaskSessionMessageRow(message) : null;
}

async function findEquivalentTaskSessionUserMessage(args: {
  sessionId: string;
  textContent: string;
  createdAt: string;
}) {
  const existing = await loadEquivalentCanonicalTaskSessionUserMessage(args);

  if (!existing) {
    return null;
  }

  return shouldReuseParentUserMessage({
    existingCreatedAt: existing.createdAt,
    incomingCreatedAt: args.createdAt,
  })
    ? existing
    : null;
}

async function resolveTaskSessionMessageTarget(args: {
  task: { id: string; projectId: string };
  runtimeSessionId?: string;
  role: TaskSessionMessageRole;
  textContent: string | null;
  createdAt: string;
  resolveTaskSessionRecordByRuntimeSessionId: (
    taskId: string,
    projectId: string,
    runtimeSessionId: string,
  ) => Promise<TaskSessionMessageCompatRecord | null>;
}) {
  if (args.role !== "user" || !args.textContent || !args.runtimeSessionId) {
    return null;
  }

  const sessionRecord = await args.resolveTaskSessionRecordByRuntimeSessionId(
    args.task.id,
    args.task.projectId,
    args.runtimeSessionId,
  );
  if (
    !sessionRecord ||
    sessionRecord.sessionKind !== "candidate" ||
    !sessionRecord.parentRuntimeSessionId
  ) {
    return null;
  }

  const parentRecord = await args.resolveTaskSessionRecordByRuntimeSessionId(
    args.task.id,
    args.task.projectId,
    sessionRecord.parentRuntimeSessionId,
  );
  if (!parentRecord) {
    return null;
  }

  const parentSessionId = buildTaskSessionWriteId(args.task.id, parentRecord.runtimeSessionId);
  const existingParentMessage = await findEquivalentTaskSessionUserMessage({
    sessionId: parentSessionId,
    textContent: args.textContent,
    createdAt: args.createdAt,
  });

  return {
    sessionId: parentSessionId,
    existingMessageId: existingParentMessage?.id ?? null,
  };
}

function extractTaskSessionMessagePartText(part: Record<string, unknown>) {
  if (typeof part.text === "string" && part.text.trim()) {
    return part.text;
  }
  if (typeof part.content === "string" && part.content.trim()) {
    return part.content;
  }

  return null;
}

export function createTaskSessionMessageWriteApi(deps: {
  upsertTaskSessionRecord: (args: UpsertTaskSessionRecordArgs) => Promise<string>;
  resolveTaskSessionRecordByRuntimeSessionId: (
    taskId: string,
    projectId: string,
    runtimeSessionId: string,
  ) => Promise<TaskSessionMessageCompatRecord | null>;
}) {
  async function upsertTaskSessionMessageRecord(args: TaskSessionMessageRecordArgs) {
    const info =
      args.message.info && typeof args.message.info === "object"
        ? (args.message.info as Record<string, unknown>)
        : null;
    const role = normalizeTaskSessionMessageRole(args.message);
    const textContent = extractTaskSessionMessageText(args.message);
    const createdAt = extractTaskSessionMessageCreatedAt(args.message);
    const updatedAt = new Date().toISOString();

    // Parallel candidates replay the same user prompt into each runtime branch.
    // Persist that prompt once on the parent session so candidate sessions only retain replies.
    const routedTarget =
      !args.sessionId && args.runtimeSessionId
        ? await resolveTaskSessionMessageTarget({
            task: args.task,
            runtimeSessionId: args.runtimeSessionId,
            role,
            textContent,
            createdAt,
            resolveTaskSessionRecordByRuntimeSessionId:
              deps.resolveTaskSessionRecordByRuntimeSessionId,
          })
        : null;

    if (routedTarget?.existingMessageId) {
      return {
        messageId: routedTarget.existingMessageId,
        sessionId: routedTarget.sessionId,
        seq: 0,
      };
    }

    const sessionId = args.sessionId
      ? args.sessionId
      : routedTarget?.sessionId
        ? routedTarget.sessionId
        : args.runtimeSessionId
          ? await deps.upsertTaskSessionRecord({
              task: args.task,
              runtimeSessionId: args.runtimeSessionId,
              sourceType: "root",
              isActive: true,
            })
          : (() => {
              throw new Error("Task session message write requires sessionId or runtimeSessionId");
            })();
    const runtimeMessageId =
      (typeof args.message.id === "string" && args.message.id) ||
      (typeof args.message.runtimeMessageId === "string" && args.message.runtimeMessageId) ||
      (typeof info?.id === "string" && info.id) ||
      crypto.randomUUID();
    const messageId = buildTaskSessionMessageWriteId(sessionId, runtimeMessageId);
    const existing = await loadTaskSessionMessageById(messageId);
    const latestMessage = await loadLatestTaskSessionMessage(sessionId);
    const assistantMergeTarget =
      !existing &&
      latestMessage &&
      shouldMergeAssistantToolCallFollowup({
        latestMessage: {
          role: latestMessage.role,
          rawPayload: latestMessage.rawPayload,
          textContent: latestMessage.textContent,
          createdAt: latestMessage.createdAt,
          runtimeMessageId: latestMessage.runtimeMessageId,
        },
        incomingMessage: args.message,
        incomingRuntimeMessageId: runtimeMessageId,
        incomingTextContent: textContent,
        incomingCreatedAt: createdAt,
      })
        ? latestMessage
        : null;
    const persistedExisting = assistantMergeTarget ?? existing;
    const persistedMessageId = assistantMergeTarget?.id ?? messageId;
    const persistedRuntimeMessageId = assistantMergeTarget?.runtimeMessageId ?? runtimeMessageId;
    const persistedPayload = assistantMergeTarget
      ? buildMergedAssistantToolCallFollowupPayload({
          existingPayload: assistantMergeTarget.rawPayload,
          existingRuntimeMessageId: assistantMergeTarget.runtimeMessageId,
          incomingMessage: args.message,
          incomingRuntimeMessageId: runtimeMessageId,
        })
      : args.message;
    const persistedTextContent = extractTaskSessionMessageText(persistedPayload);
    const persistedCompletedAt = extractTaskSessionMessageCompletedAt(persistedPayload);
    const persistedStatus = normalizeTaskSessionMessageStatus(persistedPayload);
    const persistedClientMessageId = extractTaskSessionMessageClientId(persistedPayload);
    const persistedProviderMessageId = extractTaskSessionMessageProviderMessageId(persistedPayload);
    const persistedErrorText = extractTaskSessionMessageErrorText(persistedPayload);
    const persistedParts = extractTaskSessionMessageParts(persistedPayload);
    const persistedTokenUsage = extractTaskSessionMessageTokenUsage(persistedPayload) ?? 0;
    const persistedCreatedAt = persistedExisting?.createdAt ?? createdAt;
    const persistedStartedAt = persistedExisting?.startedAt ?? createdAt;
    const messageIndex = persistedExisting?.messageIndex ?? (latestMessage?.messageIndex ?? -1) + 1;
    const sessionRecord = await db.query.taskSessions.findFirst({
      where: eq(taskSessions.id, sessionId),
    });
    const defaultRunId = sessionRecord?.latestRunId ?? buildTaskSessionDefaultRunId(sessionId);
    const messagePreview = buildTaskMessagePreview(persistedTextContent);
    const taskMessageStatus = role === "assistant"
      ? mapTaskSessionMessageStatusToNodeStatus(persistedStatus)
      : ("running" as const);
    const taskMessageParentId = persistedExisting ? null : (latestMessage?.id ?? null);

    await db
      .insert(taskSessionRuns)
      .values({
        id: defaultRunId,
        taskId: args.task.id,
        sessionId,
        attemptIndex: 1,
        runtimeSessionId: sessionRecord?.runtimeSessionId ?? args.runtimeSessionId ?? null,
        triggerType: mapLegacyTriggerTypeToRunTriggerType(sessionRecord?.triggerType ?? null),
        executionKind: mapLegacySessionKindToRunExecutionKind(sessionRecord?.sessionKind),
        coordinationKey: sessionRecord?.coordinationKey ?? sessionRecord?.rootSessionId ?? sessionId,
        operationId: sessionRecord?.operationId ?? null,
        candidateIndex: sessionRecord?.candidateIndex ?? null,
        laneRole: mapLegacySessionKindToRunLaneRole(sessionRecord?.sessionKind),
        executorKind: mapLegacySessionKindToExecutorKind(sessionRecord?.sessionKind),
        modelRoute: sessionRecord?.effectiveModel ?? sessionRecord?.selectedModel ?? null,
        workflowStageKey: sessionRecord?.workflowStageKey ?? null,
        status: taskMessageStatus,
        inputTokens: 0,
        outputTokens: role === "assistant" ? persistedTokenUsage : 0,
        totalTokens: role === "assistant" ? persistedTokenUsage : 0,
        costUsd: sessionRecord?.costUsd ?? 0,
        resultSummary: role === "assistant" ? messagePreview : null,
        errorText: persistedErrorText,
        startedAt: sessionRecord?.startedAt ?? persistedCreatedAt,
        finishedAt:
          role === "assistant" && persistedStatus !== "pending" && persistedStatus !== "streaming"
            ? (persistedCompletedAt ?? updatedAt)
            : null,
        createdAt: sessionRecord?.createdAt ?? persistedCreatedAt,
      })
      .onConflictDoUpdate({
        target: taskSessionRuns.id,
        set: {
          taskId: args.task.id,
          sessionId,
          runtimeSessionId: sessionRecord?.runtimeSessionId ?? args.runtimeSessionId ?? null,
          triggerType: mapLegacyTriggerTypeToRunTriggerType(sessionRecord?.triggerType ?? null),
          executionKind: mapLegacySessionKindToRunExecutionKind(sessionRecord?.sessionKind),
          coordinationKey: sessionRecord?.coordinationKey ?? sessionRecord?.rootSessionId ?? sessionId,
          candidateIndex: sessionRecord?.candidateIndex ?? null,
          laneRole: mapLegacySessionKindToRunLaneRole(sessionRecord?.sessionKind),
          executorKind: mapLegacySessionKindToExecutorKind(sessionRecord?.sessionKind),
          modelRoute: sessionRecord?.effectiveModel ?? sessionRecord?.selectedModel ?? null,
          status: taskMessageStatus,
          outputTokens: role === "assistant" ? persistedTokenUsage : 0,
          totalTokens: role === "assistant" ? persistedTokenUsage : 0,
          resultSummary: role === "assistant" ? messagePreview : null,
          errorText: persistedErrorText,
          startedAt: sessionRecord?.startedAt ?? persistedCreatedAt,
          finishedAt:
            role === "assistant" && persistedStatus !== "pending" && persistedStatus !== "streaming"
              ? (persistedCompletedAt ?? updatedAt)
              : null,
        },
      });

    await db
      .insert(taskMessages)
      .values({
        id: persistedMessageId,
        taskId: args.task.id,
        sessionId,
        createdByRunId: role === "user" ? null : defaultRunId,
        role,
        messageKind: mapTaskMessageKind(role),
        parentMessageId: taskMessageParentId,
        replyToMessageId: taskMessageParentId,
        runtimeMessageId: persistedRuntimeMessageId,
        clientMessageId: persistedClientMessageId,
        providerMessageId: persistedProviderMessageId,
        seq: messageIndex,
        textContent: persistedTextContent,
        textPreview: messagePreview,
        rawPayload: persistedPayload,
        partCount: persistedParts.length,
        tokenUsed: persistedTokenUsage,
        status: persistedStatus,
        errorText: persistedErrorText,
        startedAt: persistedStartedAt,
        createdAt: persistedCreatedAt,
        updatedAt,
        completedAt: persistedCompletedAt,
      })
      .onConflictDoUpdate({
        target: taskMessages.id,
        set: {
          createdByRunId: role === "user" ? null : defaultRunId,
          role,
          messageKind: mapTaskMessageKind(role),
          runtimeMessageId: persistedRuntimeMessageId,
          clientMessageId: persistedClientMessageId,
          providerMessageId: persistedProviderMessageId,
          seq: messageIndex,
          textContent: persistedTextContent,
          textPreview: messagePreview,
          rawPayload: persistedPayload,
          partCount: persistedParts.length,
          tokenUsed: persistedTokenUsage,
          status: persistedStatus,
          errorText: persistedErrorText,
          startedAt: persistedStartedAt,
          updatedAt,
          completedAt: persistedCompletedAt,
        },
      });

    await db.delete(taskMessageParts).where(eq(taskMessageParts.messageId, persistedMessageId));

    if (persistedParts.length > 0) {
      await db.insert(taskMessageParts).values(
        persistedParts.map((part, index) => ({
          id: `${persistedMessageId}:${index}`,
          messageId: persistedMessageId,
          partIndex: index,
          partType: normalizeTaskSessionMessagePartType(part),
          textContent: extractTaskSessionMessagePartText(part),
          jsonPayload: part,
          createdAt: persistedCreatedAt,
        })),
      );
    }

    await db
      .insert(taskTimelineViews)
      .values({
        id: buildTaskTimelineMessageId(persistedMessageId),
        projectId: args.task.projectId,
        taskId: args.task.id,
        sessionId,
        messageId: persistedMessageId,
        operationId: null,
        artifactId: null,
        itemKind: "message",
        itemRole: role,
        title: null,
        displayText: persistedTextContent,
        metadataJson: {
          runtimeMessageId: persistedRuntimeMessageId,
          role,
        },
        sortAt: persistedCompletedAt ?? persistedCreatedAt,
        createdAt: persistedCreatedAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: taskTimelineViews.id,
        set: {
          sessionId,
          messageId: persistedMessageId,
          itemKind: "message",
          itemRole: role,
          displayText: persistedTextContent,
          metadataJson: {
            runtimeMessageId: persistedRuntimeMessageId,
            role,
          },
          sortAt: persistedCompletedAt ?? persistedCreatedAt,
          updatedAt,
        },
      });

    const sessionUpdates: Partial<typeof taskSessions.$inferInsert> = {
      latestRunId: defaultRunId,
      lastActivityAt: updatedAt,
      updatedAt,
    };

    if (role === "user") {
      sessionUpdates.status = "running";
      if (!sessionRecord?.userPromptSummary) {
        sessionUpdates.userPromptSummary = messagePreview;
      }
    } else if (persistedStatus === "completed") {
      sessionUpdates.status = "completed";
      sessionUpdates.headMessageId = persistedMessageId;
    } else if (persistedStatus === "failed") {
      sessionUpdates.status = "failed";
    } else if (persistedStatus === "cancelled") {
      sessionUpdates.status = "cancelled";
    } else {
      sessionUpdates.status = "running";
    }

    await db.update(taskSessions).set(sessionUpdates).where(eq(taskSessions.id, sessionId));

    return {
      messageId: persistedMessageId,
      sessionId,
      seq: 0,
    };
  }

  return {
    upsertTaskSessionMessageRecord,
  };
}