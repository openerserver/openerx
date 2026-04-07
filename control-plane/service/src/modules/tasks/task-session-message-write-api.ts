import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../../db";
import {
  type TaskSessionMessagePartType,
  type TaskSessionMessageRole,
  type TaskSessionMessageStatus,
  type TaskSessionNodeStatus,
  taskArtifacts,
  taskMessageParts,
  taskMessages,
  taskOperations,
  taskSessionRuns,
  taskSessions,
  taskTimelineViews,
} from "../../db/schema";
import {
  type UpsertTaskSessionRecordArgs,
  buildTaskSessionDefaultRunId,
  buildTaskSessionWriteId,
} from "./task-session-write-api";
import {
  extractTaskSessionMessageRuntimeId,
  parseTaskSessionRuntimeMessage,
  type TaskSessionRuntimeMessageInput,
} from "./task-session-runtime-message-schema";

type TaskSessionMessageRecordArgs = {
  task: {
    id: string;
    projectId: string;
  };
  sessionId?: string;
  runtimeSessionId?: string;
  message: TaskSessionRuntimeMessageInput;
};

type TaskSessionMessageWriteRequestArgs = Omit<TaskSessionMessageRecordArgs, "message"> & {
  message: unknown;
};

type NormalizedIncomingTaskSessionMessage = {
  rawMessage: TaskSessionRuntimeMessageInput;
  role: TaskSessionMessageRole;
  textContent: string | null;
  createdAt: string;
  completedAt: string | null;
  runtimeMessageId: string;
  status: TaskSessionMessageStatus;
  parentId: string | null;
  finishReason: string | null;
  clientMessageId: string | null;
  providerMessageId: string | null;
  errorText: string | null;
  parts: Record<string, unknown>[];
  tokenUsage: number;
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

type TaskSessionMessageRow = {
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

type CanonicalTaskMessageRow = {
  id: string;
  taskId: string;
  sessionId: string;
  role: TaskSessionMessageRole;
  runtimeMessageId: string | null;
  status: TaskSessionMessageStatus;
  clientMessageId: string | null;
  providerMessageId: string | null;
  seq: number;
  textContent: string | null;
  textPreview: string | null;
  rawPayload: Record<string, unknown>;
  tokenUsed: number;
  startedAt: string | null;
  completedAt: string | null;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
};

const CANONICAL_TASK_MESSAGE_COLUMNS = {
  id: taskMessages.id,
  taskId: taskMessages.taskId,
  sessionId: taskMessages.sessionId,
  role: taskMessages.role,
  runtimeMessageId: taskMessages.runtimeMessageId,
  status: taskMessages.status,
  clientMessageId: taskMessages.clientMessageId,
  providerMessageId: taskMessages.providerMessageId,
  seq: taskMessages.seq,
  textContent: taskMessages.textContent,
  textPreview: taskMessages.textPreview,
  rawPayload: taskMessages.rawPayload,
  tokenUsed: taskMessages.tokenUsed,
  startedAt: taskMessages.startedAt,
  completedAt: taskMessages.completedAt,
  errorText: taskMessages.errorText,
  createdAt: taskMessages.createdAt,
  updatedAt: taskMessages.updatedAt,
};

const CANDIDATE_USER_MESSAGE_DEDUPE_WINDOW_MS = 15_000;
const ASSISTANT_TOOL_CALL_RESULT_MERGE_WINDOW_MS = 15_000;
const TASK_MESSAGE_TOOL_OPERATION_INDEX_STRIDE = 1_000;
const TASK_MESSAGE_SESSION_SEQ_INSERT_RETRY_LIMIT = 12;
const TASK_MESSAGE_SESSION_SEQ_INSERT_RETRY_DELAY_MS = 5;

type TaskToolExecutionStatus = "running" | "completed" | "failed" | "cancelled";

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

function mapLegacySessionKindToRunExecutionKind(
  sessionKind?: TaskSessionMessageCompatRecord["sessionKind"],
) {
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

function mapLegacySessionKindToRunLaneRole(
  sessionKind?: TaskSessionMessageCompatRecord["sessionKind"],
) {
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

function mapLegacySessionKindToExecutorKind(
  sessionKind?: TaskSessionMessageCompatRecord["sessionKind"],
) {
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
    if (normalizeTaskSessionMessagePartType(part) !== "text") {
      continue;
    }
    const text = extractTaskSessionMessagePartText(part);
    if (text) {
      return text;
    }
  }

  for (const part of parts) {
    const partType = normalizeTaskSessionMessagePartType(part);
    if (partType === "thinking" || partType === "tool_call") {
      continue;
    }
    const text = extractTaskSessionMessagePartText(part);
    if (text) {
      return text;
    }
  }

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

function normalizeIncomingTaskSessionMessageRole(
  message: TaskSessionRuntimeMessageInput,
): TaskSessionMessageRole {
  const rawRole =
    typeof message.role === "string"
      ? message.role
      : typeof message.info?.role === "string"
        ? message.info.role
        : "assistant";
  if (rawRole === "user" || rawRole === "assistant" || rawRole === "system" || rawRole === "tool") {
    return rawRole;
  }

  return "assistant";
}

function extractIncomingTaskSessionMessageParts(message: TaskSessionRuntimeMessageInput) {
  const explicitParts = Array.isArray(message.parts) ? message.parts : [];
  const standalonePart =
    message.part && typeof message.part === "object" ? [message.part] : [];

  return [...explicitParts, ...standalonePart].map((part) => ({ ...part }));
}

function extractIncomingTaskSessionMessageText(message: TaskSessionRuntimeMessageInput) {
  const candidates = [message.textContent, message.text, message.summaryText, message.content];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  const parts = extractIncomingTaskSessionMessageParts(message);
  for (const part of parts) {
    if (normalizeTaskSessionMessagePartType(part) !== "text") {
      continue;
    }
    const text = extractTaskSessionMessagePartText(part);
    if (text) {
      return text;
    }
  }

  for (const part of parts) {
    const partType = normalizeTaskSessionMessagePartType(part);
    if (partType === "thinking" || partType === "tool_call") {
      continue;
    }
    const text = extractTaskSessionMessagePartText(part);
    if (text) {
      return text;
    }
  }

  for (const part of parts) {
    const text = extractTaskSessionMessagePartText(part);
    if (text) {
      return text;
    }
  }

  return null;
}

function extractIncomingTaskSessionMessageTokenUsage(message: TaskSessionRuntimeMessageInput) {
  const candidates = [message.tokenUsed, message.token_usage, message.tokens];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (
      candidate &&
      typeof candidate === "object" &&
      typeof (candidate as { total?: unknown }).total === "number" &&
      Number.isFinite((candidate as { total: number }).total)
    ) {
      return (candidate as { total: number }).total;
    }
  }

  const tokenInfo =
    message.info?.tokens && typeof message.info.tokens === "object" ? message.info.tokens : null;
  if (typeof tokenInfo?.total === "number" && Number.isFinite(tokenInfo.total)) {
    return tokenInfo.total;
  }

  return 0;
}

function normalizeIncomingTaskSessionMessageParentId(message: TaskSessionRuntimeMessageInput) {
  const raw =
    message.parentID ??
    message.parentId ??
    message.parent_id ??
    message.info?.parentID ??
    message.info?.parentId ??
    message.info?.parent_id;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function normalizeIncomingTaskSessionMessageFinishReason(message: TaskSessionRuntimeMessageInput) {
  const raw =
    typeof message.finish === "string"
      ? message.finish
      : typeof message.info?.finish === "string"
        ? message.info.finish
        : null;
  return raw && raw.trim() ? raw : null;
}

function normalizeIncomingTaskSessionMessageStatus(message: {
  rawMessage: TaskSessionRuntimeMessageInput;
  role: TaskSessionMessageRole;
  textContent: string | null;
  completedAt: string | null;
  errorText: string | null;
}) {
  const rawStatus =
    typeof message.rawMessage.status === "string"
      ? message.rawMessage.status
      : typeof message.rawMessage.info?.status === "string"
        ? message.rawMessage.info.status
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

  if (message.errorText) {
    return "failed";
  }

  if (message.completedAt) {
    return "completed";
  }

  if (message.role === "user") {
    return "completed";
  }

  return message.textContent ? "streaming" : "pending";
}

function normalizeIncomingTaskSessionMessage(
  message: TaskSessionRuntimeMessageInput,
): NormalizedIncomingTaskSessionMessage {
  const role = normalizeIncomingTaskSessionMessageRole(message);
  const textContent = extractIncomingTaskSessionMessageText(message);
  const rawCreatedAt =
    normalizeTaskSessionMessageTimeValue(message.createdAt) ||
    normalizeTaskSessionMessageTimeValue(message.info?.time?.created);
  const rawCompletedAt =
    normalizeTaskSessionMessageTimeValue(message.completedAt) ||
    normalizeTaskSessionMessageTimeValue(message.info?.time?.completed);
  const createdAt =
    pickEarlierTaskSessionMessageTime(
      rawCreatedAt ?? rawCompletedAt ?? new Date().toISOString(),
      rawCompletedAt,
    ) ??
    rawCreatedAt ??
    rawCompletedAt ??
    new Date().toISOString();
  const runtimeMessageId = extractTaskSessionMessageRuntimeId(message);
  if (!runtimeMessageId) {
    throw new Error("Task session message write requires stable runtimeMessageId");
  }

  const errorText = (() => {
    if (typeof message.errorText === "string" && message.errorText.trim()) {
      return message.errorText;
    }
    if (typeof message.error_text === "string" && message.error_text.trim()) {
      return message.error_text;
    }
    if (typeof message.info?.error === "string" && message.info.error.trim()) {
      return message.info.error;
    }
    for (const part of extractIncomingTaskSessionMessageParts(message)) {
      const partError = extractTaskSessionMessagePartToolError(part);
      if (partError) {
        return partError;
      }
    }
    return null;
  })();
  const provisionalStatus = normalizeIncomingTaskSessionMessageStatus({
    rawMessage: message,
    role,
    textContent,
    completedAt: rawCompletedAt ?? null,
    errorText,
  });
  const completedAt =
    rawCompletedAt ??
    (provisionalStatus === "completed" ||
    provisionalStatus === "failed" ||
    provisionalStatus === "cancelled"
      ? createdAt
      : null);

  return {
    rawMessage: message,
    role,
    textContent,
    createdAt,
    completedAt,
    runtimeMessageId,
    status: normalizeIncomingTaskSessionMessageStatus({
      rawMessage: message,
      role,
      textContent,
      completedAt,
      errorText,
    }),
    parentId: normalizeIncomingTaskSessionMessageParentId(message),
    finishReason: normalizeIncomingTaskSessionMessageFinishReason(message),
    clientMessageId:
      typeof message.clientMessageId === "string" && message.clientMessageId.trim()
        ? message.clientMessageId
        : typeof message.client_message_id === "string" && message.client_message_id.trim()
          ? message.client_message_id
          : null,
    providerMessageId:
      typeof message.providerMessageId === "string" && message.providerMessageId.trim()
        ? message.providerMessageId
        : typeof message.provider_message_id === "string" && message.provider_message_id.trim()
          ? message.provider_message_id
          : null,
    errorText,
    parts: extractIncomingTaskSessionMessageParts(message),
    tokenUsage: extractIncomingTaskSessionMessageTokenUsage(message),
  };
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
  if (typeof raw === "string" && raw.trim()) {
    return raw;
  }

  const parts = extractTaskSessionMessageParts(message);
  for (const part of parts) {
    const errorText = extractTaskSessionMessagePartToolError(part);
    if (errorText) {
      return errorText;
    }
  }

  return null;
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
    info?.time && typeof info.time === "object" ? (info.time as Record<string, unknown>) : null;

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
    info?.time && typeof info.time === "object" ? (info.time as Record<string, unknown>) : null;

  return (
    normalizeTaskSessionMessageTimeValue(message.completedAt) ||
    normalizeTaskSessionMessageTimeValue(infoTime?.completed) ||
    null
  );
}

function extractTaskSessionMessageParts(message: Record<string, unknown>) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const singlePart = message.part;
  const candidates = singlePart && typeof singlePart === "object" ? [...parts, singlePart] : parts;

  return candidates.filter((part): part is Record<string, unknown> =>
    Boolean(part && typeof part === "object"),
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
  return (
    type === "tool" || type === "tool_call" || type === "tool-result" || type === "tool_result"
  );
}

function extractTaskSessionMessagePartIdentity(part: Record<string, unknown>) {
  return (
    asTaskSessionMessageString(part.id) ??
    asTaskSessionMessageString(part.callID) ??
    asTaskSessionMessageString(part.toolCallId)
  );
}

function hasTaskSessionMessageToolPart(message: Record<string, unknown>) {
  return extractTaskSessionMessageParts(message).some((part) => isTaskSessionMessagePartType(part, "tool"));
}

function cloneTaskSessionMessageParts(parts: Record<string, unknown>[]) {
  return parts.map((part) => ({ ...part }));
}

function collectTaskSessionMessageToolPartIds(parts: Record<string, unknown>[]) {
  return new Set(
    parts
      .filter((part) => isToolLikeTaskSessionMessagePart(part))
      .map((part) => extractTaskSessionMessagePartIdentity(part))
      .filter((value): value is string => Boolean(value)),
  );
}

function collectCarryoverTaskSessionToolParts(
  existingParts: Record<string, unknown>[],
  incomingToolIds: Set<string>,
) {
  return cloneTaskSessionMessageParts(
    existingParts
      .filter((part) => isToolLikeTaskSessionMessagePart(part))
      .filter((part) => {
        const identity = extractTaskSessionMessagePartIdentity(part);
        return !identity || !incomingToolIds.has(identity);
      }),
  );
}

function hasTaskSessionMessagePartType(parts: Record<string, unknown>[], partType: string) {
  return parts.some((part) => isTaskSessionMessagePartType(part, partType));
}

function insertTaskSessionMessagePartsBeforeBoundary(args: {
  parts: Record<string, unknown>[];
  inserts: Record<string, unknown>[];
  boundaryTypes: string[];
}) {
  if (args.inserts.length === 0) {
    return args.parts;
  }

  const insertAt = args.parts.findIndex((part) =>
    args.boundaryTypes.some((boundaryType) => isTaskSessionMessagePartType(part, boundaryType)),
  );
  if (insertAt < 0) {
    return [...args.parts, ...args.inserts];
  }

  const merged = [...args.parts];
  merged.splice(insertAt, 0, ...args.inserts);
  return merged;
}

function findTaskSessionMessagePart(
  parts: Record<string, unknown>[],
  partType: string,
  fromEnd = false,
) {
  if (!fromEnd) {
    return parts.find((part) => isTaskSessionMessagePartType(part, partType));
  }

  return [...parts].reverse().find((part) => isTaskSessionMessagePartType(part, partType));
}

function mergeAssistantToolCallFollowupParts(args: {
  existingMessage: Record<string, unknown>;
  incomingParts: Record<string, unknown>[];
}) {
  const existingParts = extractTaskSessionMessageParts(args.existingMessage);
  const incomingParts = cloneTaskSessionMessageParts(args.incomingParts);
  const incomingToolIds = collectTaskSessionMessageToolPartIds(incomingParts);
  const carryoverToolParts = collectCarryoverTaskSessionToolParts(existingParts, incomingToolIds);

  let mergedParts = insertTaskSessionMessagePartsBeforeBoundary({
    parts: incomingParts,
    inserts: carryoverToolParts,
    boundaryTypes: ["text", "step-finish"],
  });

  if (!hasTaskSessionMessagePartType(mergedParts, "text")) {
    mergedParts = insertTaskSessionMessagePartsBeforeBoundary({
      parts: mergedParts,
      inserts: cloneTaskSessionMessageParts(
        existingParts.filter((part) => isTaskSessionMessagePartType(part, "text")),
      ),
      boundaryTypes: ["step-finish"],
    });
  }

  if (!hasTaskSessionMessagePartType(mergedParts, "step-start")) {
    const fallbackStepStart = findTaskSessionMessagePart(existingParts, "step-start");
    if (fallbackStepStart) {
      mergedParts = [{ ...fallbackStepStart }, ...mergedParts];
    }
  }

  if (!hasTaskSessionMessagePartType(mergedParts, "step-finish")) {
    const fallbackStepFinish = findTaskSessionMessagePart(existingParts, "step-finish", true);
    if (fallbackStepFinish) {
      mergedParts = [...mergedParts, { ...fallbackStepFinish }];
    }
  }

  return mergedParts;
}

function buildMergedAssistantToolCallFollowupPayload(args: {
  existingPayload: Record<string, unknown>;
  existingRuntimeMessageId: string | null;
  incomingMessage: NormalizedIncomingTaskSessionMessage;
}) {
  const existingInfo = extractTaskSessionMessageInfoRecord(args.existingPayload) ?? {};
  const incomingInfo = extractTaskSessionMessageInfoRecord(args.incomingMessage.rawMessage) ?? {};
  const existingTime = asTaskSessionMessageRecord(existingInfo.time) ?? {};
  const incomingTime = asTaskSessionMessageRecord(incomingInfo.time) ?? {};
  const preservedMessageId =
    asTaskSessionMessageString(existingInfo.id) ??
    asTaskSessionMessageString(args.existingPayload.id) ??
    args.existingRuntimeMessageId ??
    args.incomingMessage.runtimeMessageId;
  const preservedRuntimeMessageId =
    asTaskSessionMessageString(args.existingPayload.runtimeMessageId) ??
    args.existingRuntimeMessageId ??
    preservedMessageId;
  const mergedText =
    args.incomingMessage.textContent ?? extractTaskSessionMessageText(args.existingPayload);
  const mergedParentId =
    args.incomingMessage.parentId ?? extractTaskSessionMessageParentId(args.existingPayload);
  const mergedRuntimeMessageIds = buildMergedTaskSessionRuntimeMessageIds({
    existingPayload: args.existingPayload,
    existingRuntimeMessageId: args.existingRuntimeMessageId,
    incomingRuntimeMessageId: args.incomingMessage.runtimeMessageId,
  });

  return {
    ...args.existingPayload,
    ...args.incomingMessage.rawMessage,
    id: preservedMessageId,
    runtimeMessageId: preservedRuntimeMessageId,
    text: mergedText,
    textContent: mergedText,
    summaryText: mergedText,
    parts: mergeAssistantToolCallFollowupParts({
      existingMessage: args.existingPayload,
      incomingParts: args.incomingMessage.parts,
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
  incomingMessage: NormalizedIncomingTaskSessionMessage;
}) {
  if (args.latestMessage.role !== "assistant") {
    return false;
  }

  const existingText = normalizeTaskSessionMessageComparableText(
    args.latestMessage.textContent ?? extractTaskSessionMessageText(args.latestMessage.rawPayload),
  );
  const incomingText = normalizeTaskSessionMessageComparableText(args.incomingMessage.textContent);
  if (!existingText || !incomingText || existingText !== incomingText) {
    return false;
  }

  const latestMergedRuntimeIds = extractTaskSessionMessageMergedRuntimeMessageIds(
    args.latestMessage.rawPayload,
  );
  if (latestMergedRuntimeIds.includes(args.incomingMessage.runtimeMessageId)) {
    return true;
  }

  if (!hasTaskSessionMessageToolPart(args.latestMessage.rawPayload)) {
    return false;
  }

  if (extractTaskSessionMessageFinishReason(args.latestMessage.rawPayload) !== "tool-calls") {
    return false;
  }

  if (args.incomingMessage.finishReason === "tool-calls") {
    return false;
  }

  const latestParentId = extractTaskSessionMessageParentId(args.latestMessage.rawPayload);
  const incomingParentId = args.incomingMessage.parentId;
  if (latestParentId !== incomingParentId) {
    return false;
  }

  const latestCreatedAt = parseTaskSessionMessageTime(args.latestMessage.createdAt);
  const incomingCreatedAt = parseTaskSessionMessageTime(args.incomingMessage.createdAt);
  if (latestCreatedAt === null || incomingCreatedAt === null) {
    return false;
  }

  return (
    Math.abs(incomingCreatedAt - latestCreatedAt) <= ASSISTANT_TOOL_CALL_RESULT_MERGE_WINDOW_MS
  );
}

function buildTaskTimelineMessageId(messageId: string) {
  return `task-timeline:message:${messageId}`;
}

function parseTaskSessionMessageTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function pickEarlierTaskSessionMessageTime(
  current: string | null | undefined,
  candidate: string | null | undefined,
) {
  if (!current) {
    return candidate ?? null;
  }
  if (!candidate) {
    return current;
  }

  const currentTime = parseTaskSessionMessageTime(current);
  const candidateTime = parseTaskSessionMessageTime(candidate);
  if (currentTime === null || candidateTime === null) {
    return current;
  }

  return candidateTime < currentTime ? candidate : current;
}

function pickLaterTaskSessionMessageTime(
  current: string | null | undefined,
  candidate: string | null | undefined,
) {
  if (!current) {
    return candidate ?? null;
  }
  if (!candidate) {
    return current;
  }

  const currentTime = parseTaskSessionMessageTime(current);
  const candidateTime = parseTaskSessionMessageTime(candidate);
  if (currentTime === null || candidateTime === null) {
    return candidate;
  }

  return candidateTime > currentTime ? candidate : current;
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
  message: CanonicalTaskMessageRow,
): TaskSessionMessageRow {
  return {
    id: message.id,
    role: message.role,
    runtimeMessageId: message.runtimeMessageId,
    status: normalizePersistedTaskSessionMessageStatus(message.status),
    clientMessageId: message.clientMessageId,
    providerMessageId: message.providerMessageId,
    messageIndex: message.seq,
    textContent: message.textContent ?? message.textPreview ?? null,
    rawPayload: message.rawPayload,
    tokenUsed: message.tokenUsed,
    startedAt: message.startedAt ?? message.createdAt,
    completedAt: message.completedAt ?? null,
    errorText: message.errorText,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

async function loadTaskSessionMessageById(messageId: string) {
  const [message] = await db
    .select(CANONICAL_TASK_MESSAGE_COLUMNS)
    .from(taskMessages)
    .where(eq(taskMessages.id, messageId))
    .limit(1);
  return message ? mapCanonicalTaskSessionMessageRow(message) : null;
}

async function loadLatestTaskSessionMessage(sessionId: string) {
  const [message] = await db
    .select(CANONICAL_TASK_MESSAGE_COLUMNS)
    .from(taskMessages)
    .where(eq(taskMessages.sessionId, sessionId))
    .orderBy(desc(taskMessages.seq), desc(taskMessages.createdAt))
    .limit(1);
  return message ? mapCanonicalTaskSessionMessageRow(message) : null;
}

async function loadEquivalentTaskSessionUserMessage(args: {
  sessionId: string;
  textContent: string;
}) {
  const [message] = await db
    .select(CANONICAL_TASK_MESSAGE_COLUMNS)
    .from(taskMessages)
    .where(
      and(
        eq(taskMessages.sessionId, args.sessionId),
        eq(taskMessages.role, "user"),
        eq(taskMessages.textContent, args.textContent),
      ),
    )
    .orderBy(desc(taskMessages.createdAt))
    .limit(1);
  return message ? mapCanonicalTaskSessionMessageRow(message) : null;
}

async function findEquivalentTaskSessionUserMessage(args: {
  sessionId: string;
  textContent: string;
  createdAt: string;
}) {
  const existing = await loadEquivalentTaskSessionUserMessage(args);

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

  const outputText = extractTaskSessionMessagePartToolOutput(part);
  if (outputText) {
    return outputText;
  }

  const errorText = extractTaskSessionMessagePartToolError(part);
  if (errorText) {
    return errorText;
  }

  return null;
}

function stringifyTaskSessionMessageValue(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }

  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" && serialized.length > 0 ? serialized : String(value);
  } catch {
    return String(value);
  }
}

function extractTaskSessionStructuredContentText(value: unknown) {
  const record = asTaskSessionMessageRecord(value);
  if (!record) {
    return null;
  }

  const directText = asTaskSessionMessageString(record.text);
  if (directText) {
    return directText;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  const text = content
    .map((entry) => asTaskSessionMessageRecord(entry))
    .map((entry) => asTaskSessionMessageString(entry?.text))
    .filter((entry): entry is string => Boolean(entry))
    .join("\n")
    .trim();

  return text || null;
}

function normalizeTaskSessionMessageToolOutputText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const structuredText = extractTaskSessionStructuredContentText(value);
  if (structuredText) {
    return structuredText;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      const parsedText = extractTaskSessionStructuredContentText(parsed);
      if (parsedText) {
        return parsedText;
      }
    } catch {
      // Ignore parse failures and keep the raw text.
    }
  }

  return stringifyTaskSessionMessageValue(value);
}

function extractTaskSessionMessagePartState(part: Record<string, unknown>) {
  if (typeof part.state === "string" && part.state.trim()) {
    return { status: part.state };
  }
  return asTaskSessionMessageRecord(part.state);
}

function extractTaskSessionMessagePartToolName(part: Record<string, unknown>) {
  const metadata = asTaskSessionMessageRecord(part.metadata);
  const toolCall = asTaskSessionMessageRecord(part.toolCall);

  return (
    asTaskSessionMessageString(part.name) ??
    asTaskSessionMessageString(part.tool) ??
    asTaskSessionMessageString(part.toolName) ??
    asTaskSessionMessageString(metadata?.toolName) ??
    asTaskSessionMessageString(toolCall?.name) ??
    asTaskSessionMessageString(toolCall?.tool) ??
    null
  );
}

function extractTaskSessionMessagePartRuntimeOperationId(part: Record<string, unknown>) {
  const metadata = asTaskSessionMessageRecord(part.metadata);
  const toolCall = asTaskSessionMessageRecord(part.toolCall);

  return (
    asTaskSessionMessageString(part.callID) ??
    asTaskSessionMessageString(part.callId) ??
    asTaskSessionMessageString(part.toolCallId) ??
    asTaskSessionMessageString(part.id) ??
    asTaskSessionMessageString(metadata?.callID) ??
    asTaskSessionMessageString(metadata?.callId) ??
    asTaskSessionMessageString(metadata?.toolCallId) ??
    asTaskSessionMessageString(toolCall?.id) ??
    null
  );
}

function extractTaskSessionMessagePartToolInput(part: Record<string, unknown>) {
  const toolCall = asTaskSessionMessageRecord(part.toolCall);
  return (
    part.input ??
    part.arguments ??
    part.args ??
    toolCall?.input ??
    toolCall?.arguments ??
    toolCall?.args
  );
}

function extractTaskSessionMessagePartToolOutput(part: Record<string, unknown>) {
  const state = extractTaskSessionMessagePartState(part);
  return normalizeTaskSessionMessageToolOutputText(
    state?.output ?? state?.result ?? part.output ?? part.result,
  );
}

function extractTaskSessionMessagePartToolError(part: Record<string, unknown>) {
  const state = extractTaskSessionMessagePartState(part);
  return stringifyTaskSessionMessageValue(state?.error ?? part.error);
}

function normalizeTaskSessionMessagePartToolStatus(
  part: Record<string, unknown>,
): TaskToolExecutionStatus {
  const partType = normalizeTaskSessionMessagePartType(part);
  const state = extractTaskSessionMessagePartState(part);
  const rawStatus =
    asTaskSessionMessageString(state?.status) ?? (partType === "tool_call" ? "running" : null);

  if (rawStatus === "failed" || rawStatus === "error") {
    return "failed";
  }
  if (rawStatus === "cancelled" || rawStatus === "stopped" || rawStatus === "terminated") {
    return "cancelled";
  }
  if (rawStatus === "completed" || rawStatus === "complete") {
    return "completed";
  }
  if (
    rawStatus === "queued" ||
    rawStatus === "pending" ||
    rawStatus === "running" ||
    rawStatus === "streaming"
  ) {
    return "running";
  }

  if (extractTaskSessionMessagePartToolError(part)) {
    return "failed";
  }

  return partType === "tool_result" ? "completed" : "running";
}

function mapTaskToolExecutionStatusToNodeStatus(
  status: TaskToolExecutionStatus,
): TaskSessionNodeStatus {
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "running";
}

function buildTaskToolOperationId(
  messageId: string,
  runtimeOperationId: string | null,
  fallbackIndex: number,
) {
  return runtimeOperationId
    ? `task-operation:${runtimeOperationId}`
    : `task-operation:${messageId}:tool:${fallbackIndex}`;
}

function buildTaskToolArtifactId(
  messageId: string,
  runtimeOperationId: string | null,
  fallbackIndex: number,
) {
  return runtimeOperationId
    ? `task-artifact:${runtimeOperationId}`
    : `task-artifact:${messageId}:tool:${fallbackIndex}`;
}

function buildTaskToolOperationSummary(args: {
  messageId: string;
  runtimeOperationId: string | null;
  toolName: string;
  input: unknown;
  outputText: string | null;
  errorText: string | null;
  partIndices: number[];
  rawPart: Record<string, unknown>;
}) {
  return {
    source: "task-session-message-write",
    messageId: args.messageId,
    runtimeOperationId: args.runtimeOperationId,
    toolName: args.toolName,
    input: args.input ?? null,
    outputText: args.outputText,
    errorText: args.errorText,
    partIndices: args.partIndices,
    rawPart: args.rawPart,
  } satisfies Record<string, unknown>;
}

type TaskToolExecutionRecord = {
  artifactId: string;
  runtimeOperationId: string | null;
  toolName: string;
  input: unknown;
  outputText: string | null;
  errorText: string | null;
  operationIndex: number;
  status: TaskToolExecutionStatus;
  partIndices: number[];
  rawPart: Record<string, unknown>;
  shouldPersistArtifact: boolean;
};

function normalizeTaskToolExecutionPartType(part: Record<string, unknown>) {
  const partType = normalizeTaskSessionMessagePartType(part);
  return partType === "tool_call" || partType === "tool_result" ? partType : null;
}

function buildTaskToolArtifactTitle(toolName: string) {
  return [toolName, "result"].join(" ");
}

function buildTaskToolExecutionRecord(args: {
  existing: TaskToolExecutionRecord | undefined;
  messageId: string;
  messageIndex: number;
  part: Record<string, unknown>;
  partIndex: number;
  partType: "tool_call" | "tool_result";
  nextOperationOffset: number;
}) {
  const runtimeOperationId = extractTaskSessionMessagePartRuntimeOperationId(args.part);
  const toolName = extractTaskSessionMessagePartToolName(args.part) ?? "tool";
  const input = extractTaskSessionMessagePartToolInput(args.part);
  const outputText = extractTaskSessionMessagePartToolOutput(args.part);
  const errorText = extractTaskSessionMessagePartToolError(args.part);
  const status = normalizeTaskSessionMessagePartToolStatus(args.part);
  const operationIndex =
    args.existing?.operationIndex ??
    args.messageIndex * TASK_MESSAGE_TOOL_OPERATION_INDEX_STRIDE + args.nextOperationOffset;

  return {
    operationId: buildTaskToolOperationId(args.messageId, runtimeOperationId, args.partIndex),
    record: {
      artifactId:
        args.existing?.artifactId ??
        buildTaskToolArtifactId(args.messageId, runtimeOperationId, args.partIndex),
      runtimeOperationId,
      toolName: args.existing?.toolName ?? toolName,
      input: args.existing?.input ?? input,
      outputText: outputText ?? args.existing?.outputText ?? null,
      errorText: errorText ?? args.existing?.errorText ?? null,
      operationIndex,
      status:
        args.partType === "tool_result"
          ? status
          : args.existing?.status === "completed" ||
              args.existing?.status === "failed" ||
              args.existing?.status === "cancelled"
            ? args.existing.status
            : status,
      partIndices: [...(args.existing?.partIndices ?? []), args.partIndex],
      rawPart: args.part,
      shouldPersistArtifact:
        args.existing?.shouldPersistArtifact === true || args.partType === "tool_result",
    },
  };
}

function collectTaskToolExecutionRecords(args: {
  messageId: string;
  messageIndex: number;
  parts: Record<string, unknown>[];
}) {
  const toolOperationRecords = new Map<string, TaskToolExecutionRecord>();
  let nextOperationOffset = 0;

  for (const [partIndex, part] of args.parts.entries()) {
    const partType = normalizeTaskToolExecutionPartType(part);
    if (!partType) {
      continue;
    }

    const operationId = buildTaskToolOperationId(
      args.messageId,
      extractTaskSessionMessagePartRuntimeOperationId(part),
      partIndex,
    );
    const existing = toolOperationRecords.get(operationId);
    const nextRecord = buildTaskToolExecutionRecord({
      existing,
      messageId: args.messageId,
      messageIndex: args.messageIndex,
      part,
      partIndex,
      partType,
      nextOperationOffset,
    });
    if (!existing) {
      nextOperationOffset += 1;
    }
    toolOperationRecords.set(nextRecord.operationId, nextRecord.record);
  }

  return toolOperationRecords;
}

function buildTaskToolOperationSummaryFromRecord(
  messageId: string,
  operation: TaskToolExecutionRecord,
) {
  return buildTaskToolOperationSummary({
    messageId,
    runtimeOperationId: operation.runtimeOperationId,
    toolName: operation.toolName,
    input: operation.input,
    outputText: operation.outputText,
    errorText: operation.errorText,
    partIndices: operation.partIndices,
    rawPart: operation.rawPart,
  });
}

function resolveTaskToolOperationFinishedAt(args: {
  status: TaskToolExecutionStatus;
  completedAt: string | null;
  updatedAt: string;
}) {
  const nodeStatus = mapTaskToolExecutionStatusToNodeStatus(args.status);
  return nodeStatus === "completed" || nodeStatus === "failed" || nodeStatus === "cancelled"
    ? (args.completedAt ?? args.updatedAt)
    : null;
}

async function upsertTaskToolExecutionOperation(args: {
  task: { id: string; projectId: string };
  sessionId: string;
  runId: string;
  messageId: string;
  operationId: string;
  operation: TaskToolExecutionRecord;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}) {
  const nodeStatus = mapTaskToolExecutionStatusToNodeStatus(args.operation.status);
  const finishedAt = resolveTaskToolOperationFinishedAt({
    status: args.operation.status,
    completedAt: args.completedAt,
    updatedAt: args.updatedAt,
  });
  const summaryJson = buildTaskToolOperationSummaryFromRecord(args.messageId, args.operation);

  await db
    .insert(taskOperations)
    .values({
      id: args.operationId,
      taskId: args.task.id,
      sessionId: args.sessionId,
      runId: args.runId,
      messageId: args.messageId,
      parentOperationId: null,
      runtimeOperationId: args.operation.runtimeOperationId,
      operationIndex: args.operation.operationIndex,
      operationKind: "tool_call",
      toolName: args.operation.toolName,
      title: args.operation.toolName,
      status: nodeStatus,
      summaryJson,
      startedAt: args.createdAt,
      finishedAt,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    })
    .onConflictDoUpdate({
      target: taskOperations.id,
      set: {
        runId: args.runId,
        messageId: args.messageId,
        runtimeOperationId: args.operation.runtimeOperationId,
        operationIndex: args.operation.operationIndex,
        operationKind: "tool_call",
        toolName: args.operation.toolName,
        title: args.operation.toolName,
        status: nodeStatus,
        summaryJson,
        startedAt: args.createdAt,
        finishedAt,
        updatedAt: args.updatedAt,
      },
    });
}

async function upsertTaskToolExecutionArtifact(args: {
  task: { id: string; projectId: string };
  sessionId: string;
  messageId: string;
  operationId: string;
  operation: TaskToolExecutionRecord;
  createdAt: string;
  updatedAt: string;
}) {
  if (!args.operation.shouldPersistArtifact) {
    return;
  }

  const title = buildTaskToolArtifactTitle(args.operation.toolName);
  const payloadJson = buildTaskToolOperationSummaryFromRecord(args.messageId, args.operation);

  await db
    .insert(taskArtifacts)
    .values({
      id: args.operation.artifactId,
      taskId: args.task.id,
      projectId: args.task.projectId,
      sessionId: args.sessionId,
      messageId: args.messageId,
      operationId: args.operationId,
      parentArtifactId: null,
      artifactKind: "result",
      storageKind: "inline",
      title,
      mimeType: "text/plain",
      filePath: null,
      externalUri: null,
      contentText: args.operation.outputText ?? args.operation.errorText,
      payloadJson,
      byteSize: null,
      sha256: null,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    })
    .onConflictDoUpdate({
      target: taskArtifacts.id,
      set: {
        sessionId: args.sessionId,
        messageId: args.messageId,
        operationId: args.operationId,
        title,
        mimeType: "text/plain",
        contentText: args.operation.outputText ?? args.operation.errorText,
        payloadJson,
        updatedAt: args.updatedAt,
      },
    });
}

function buildTaskToolOperationTimelineId(operationId: string) {
  return `task-timeline:operation:${operationId}`;
}

function buildTaskToolArtifactTimelineId(artifactId: string) {
  return `task-timeline:artifact:${artifactId}`;
}

function buildTaskToolExecutionInputSummary(input: unknown) {
  return stringifyTaskSessionMessageValue(input);
}

function buildTaskToolExecutionOutputSummary(operation: TaskToolExecutionRecord) {
  return operation.outputText ?? operation.errorText ?? null;
}

async function upsertTaskToolExecutionOperationTimeline(args: {
  task: { id: string; projectId: string };
  sessionId: string;
  messageId: string;
  operationId: string;
  operation: TaskToolExecutionRecord;
  createdAt: string;
  updatedAt: string;
}) {
  const argumentsSummary = buildTaskToolExecutionInputSummary(args.operation.input);

  await db
    .insert(taskTimelineViews)
    .values({
      id: buildTaskToolOperationTimelineId(args.operationId),
      projectId: args.task.projectId,
      taskId: args.task.id,
      sessionId: args.sessionId,
      messageId: args.messageId,
      operationId: args.operationId,
      artifactId: null,
      itemKind: "operation",
      itemRole: "tool",
      title: args.operation.toolName,
      displayText: argumentsSummary ?? args.operation.toolName,
      metadataJson: {
        sourceKind: "tool-call",
        toolName: args.operation.toolName,
        argumentsSummary,
        status: args.operation.status,
        runtimeOperationId: args.operation.runtimeOperationId,
      },
      sortAt: args.createdAt,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    })
    .onConflictDoUpdate({
      target: taskTimelineViews.id,
      set: {
        sessionId: args.sessionId,
        messageId: args.messageId,
        operationId: args.operationId,
        itemKind: "operation",
        itemRole: "tool",
        title: args.operation.toolName,
        displayText: argumentsSummary ?? args.operation.toolName,
        metadataJson: {
          sourceKind: "tool-call",
          toolName: args.operation.toolName,
          argumentsSummary,
          status: args.operation.status,
          runtimeOperationId: args.operation.runtimeOperationId,
        },
        sortAt: args.createdAt,
        updatedAt: args.updatedAt,
      },
    });
}

async function upsertTaskToolExecutionArtifactTimeline(args: {
  task: { id: string; projectId: string };
  sessionId: string;
  messageId: string;
  operationId: string;
  operation: TaskToolExecutionRecord;
  createdAt: string;
  updatedAt: string;
}) {
  if (!args.operation.shouldPersistArtifact) {
    return;
  }

  const outputSummary = buildTaskToolExecutionOutputSummary(args.operation);

  await db
    .insert(taskTimelineViews)
    .values({
      id: buildTaskToolArtifactTimelineId(args.operation.artifactId),
      projectId: args.task.projectId,
      taskId: args.task.id,
      sessionId: args.sessionId,
      messageId: args.messageId,
      operationId: args.operationId,
      artifactId: args.operation.artifactId,
      itemKind: "artifact",
      itemRole: "tool",
      title: buildTaskToolArtifactTitle(args.operation.toolName),
      displayText: outputSummary,
      metadataJson: {
        sourceKind: "tool-output",
        artifactKind: "result",
        toolName: args.operation.toolName,
        outputSummary,
        status: args.operation.status,
        runtimeOperationId: args.operation.runtimeOperationId,
      },
      sortAt: args.updatedAt,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    })
    .onConflictDoUpdate({
      target: taskTimelineViews.id,
      set: {
        sessionId: args.sessionId,
        messageId: args.messageId,
        operationId: args.operationId,
        artifactId: args.operation.artifactId,
        itemKind: "artifact",
        itemRole: "tool",
        title: buildTaskToolArtifactTitle(args.operation.toolName),
        displayText: outputSummary,
        metadataJson: {
          sourceKind: "tool-output",
          artifactKind: "result",
          toolName: args.operation.toolName,
          outputSummary,
          status: args.operation.status,
          runtimeOperationId: args.operation.runtimeOperationId,
        },
        sortAt: args.updatedAt,
        updatedAt: args.updatedAt,
      },
    });
}

async function syncTaskToolExecutionFacts(args: {
  task: { id: string; projectId: string };
  sessionId: string;
  runId: string;
  messageId: string;
  messageIndex: number;
  parts: Record<string, unknown>[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}) {
  const toolOperationRecords = collectTaskToolExecutionRecords({
    messageId: args.messageId,
    messageIndex: args.messageIndex,
    parts: args.parts,
  });

  for (const [operationId, operation] of toolOperationRecords.entries()) {
    await upsertTaskToolExecutionOperation({
      task: args.task,
      sessionId: args.sessionId,
      runId: args.runId,
      messageId: args.messageId,
      operationId,
      operation,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
      completedAt: args.completedAt,
    });
    await upsertTaskToolExecutionOperationTimeline({
      task: args.task,
      sessionId: args.sessionId,
      messageId: args.messageId,
      operationId,
      operation,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });

    await upsertTaskToolExecutionArtifact({
      task: args.task,
      sessionId: args.sessionId,
      messageId: args.messageId,
      operationId,
      operation,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
    await upsertTaskToolExecutionArtifactTimeline({
      task: args.task,
      sessionId: args.sessionId,
      messageId: args.messageId,
      operationId,
      operation,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
  }
}

export function createTaskSessionMessageWriteApi(deps: {
  upsertTaskSessionRecord: (args: UpsertTaskSessionRecordArgs) => Promise<string>;
  resolveTaskSessionRecordByRuntimeSessionId: (
    taskId: string,
    projectId: string,
    runtimeSessionId: string,
  ) => Promise<TaskSessionMessageCompatRecord | null>;
}) {
  async function resolveTaskSessionMessageRouting(args: TaskSessionMessageRecordArgs) {
    const incomingMessage = normalizeIncomingTaskSessionMessage(args.message);
    const updatedAt = new Date().toISOString();
    const routedTarget =
      !args.sessionId && args.runtimeSessionId
        ? await resolveTaskSessionMessageTarget({
            task: args.task,
            runtimeSessionId: args.runtimeSessionId,
            role: incomingMessage.role,
            textContent: incomingMessage.textContent,
            createdAt: incomingMessage.createdAt,
            resolveTaskSessionRecordByRuntimeSessionId:
              deps.resolveTaskSessionRecordByRuntimeSessionId,
          })
        : null;

    return {
      incomingMessage,
      updatedAt,
      routedTarget,
    };
  }

  async function resolveTaskSessionMessageSessionId(args: {
    task: { id: string; projectId: string };
    sessionId?: string;
    runtimeSessionId?: string;
    routedTarget: Awaited<ReturnType<typeof resolveTaskSessionMessageTarget>>;
  }) {
    if (args.sessionId) {
      return args.sessionId;
    }

    if (args.routedTarget?.sessionId) {
      return args.routedTarget.sessionId;
    }

    if (args.runtimeSessionId) {
      return deps.upsertTaskSessionRecord({
        task: args.task,
        runtimeSessionId: args.runtimeSessionId,
        sourceType: "root",
        isActive: true,
      });
    }

    throw new Error("Task session message write requires sessionId or runtimeSessionId");
  }

  async function loadTaskSessionMessagePersistenceState(args: {
    sessionId: string;
    messageId: string;
    incomingMessage: NormalizedIncomingTaskSessionMessage;
  }) {
    const existing = await loadTaskSessionMessageById(args.messageId);
    const latestMessage = await loadLatestTaskSessionMessage(args.sessionId);
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
        incomingMessage: args.incomingMessage,
      })
        ? latestMessage
        : null;

    return {
      existing,
      latestMessage,
      assistantMergeTarget,
    };
  }

  function buildPersistedTaskSessionMessageState(args: {
    incomingMessage: NormalizedIncomingTaskSessionMessage;
    messageId: string;
    persistenceState: Awaited<ReturnType<typeof loadTaskSessionMessagePersistenceState>>;
  }) {
    const { existing, latestMessage, assistantMergeTarget } = args.persistenceState;
    const persistedExisting = assistantMergeTarget ?? existing;
    const persistedMessageId = assistantMergeTarget?.id ?? args.messageId;
    const persistedPayload = assistantMergeTarget
      ? parseTaskSessionRuntimeMessage(
          buildMergedAssistantToolCallFollowupPayload({
            existingPayload: assistantMergeTarget.rawPayload,
            existingRuntimeMessageId: assistantMergeTarget.runtimeMessageId,
            incomingMessage: args.incomingMessage,
          }),
        )
      : args.incomingMessage.rawMessage;
    const persistedNormalizedMessage = assistantMergeTarget
      ? normalizeIncomingTaskSessionMessage(persistedPayload)
      : args.incomingMessage;
    const persistedRuntimeMessageId = persistedNormalizedMessage.runtimeMessageId;
    const persistedTextContent = persistedNormalizedMessage.textContent;
    const persistedCompletedAt = persistedNormalizedMessage.completedAt;
    const persistedStatus = persistedNormalizedMessage.status;
    const persistedClientMessageId = persistedNormalizedMessage.clientMessageId;
    const persistedProviderMessageId = persistedNormalizedMessage.providerMessageId;
    const persistedErrorText = persistedNormalizedMessage.errorText;
    const persistedParts = persistedNormalizedMessage.parts;
    const persistedTokenUsage = persistedNormalizedMessage.tokenUsage;
    const persistedCreatedAt = persistedExisting?.createdAt ?? persistedNormalizedMessage.createdAt;
    const persistedStartedAt = persistedExisting?.startedAt ?? persistedNormalizedMessage.createdAt;
    const messageIndex = persistedExisting?.messageIndex ?? (latestMessage?.messageIndex ?? -1) + 1;
    const taskMessageParentId = persistedExisting ? null : (latestMessage?.id ?? null);

    return {
      latestMessage,
      persistedExisting,
      persistedMessageId,
      persistedRuntimeMessageId,
      persistedPayload,
      persistedTextContent,
      persistedCompletedAt,
      persistedStatus,
      persistedClientMessageId,
      persistedProviderMessageId,
      persistedErrorText,
      persistedParts,
      persistedTokenUsage,
      persistedCreatedAt,
      persistedStartedAt,
      messageIndex,
      taskMessageParentId,
    };
  }

  async function loadTaskSessionMessageRunState(sessionId: string) {
    const sessionRecord = await db.query.taskSessions.findFirst({
      where: eq(taskSessions.id, sessionId),
    });

    return {
      sessionRecord,
      defaultRunId: sessionRecord?.latestRunId ?? buildTaskSessionDefaultRunId(sessionId),
    };
  }

  function resolveTaskSessionMessageNodeStatus(
    role: TaskSessionMessageRole,
    persistedStatus: TaskSessionMessageStatus,
  ) {
    return role === "assistant"
      ? mapTaskSessionMessageStatusToNodeStatus(persistedStatus)
      : ("running" as const);
  }

  function resolveTaskSessionMessageRunFinishedAt(args: {
    role: TaskSessionMessageRole;
    persistedStatus: TaskSessionMessageStatus;
    persistedCompletedAt: string | null;
    updatedAt: string;
  }) {
    return args.role === "assistant" &&
      args.persistedStatus !== "pending" &&
      args.persistedStatus !== "streaming"
      ? (args.persistedCompletedAt ?? args.updatedAt)
      : null;
  }

  async function buildTaskSessionMessageWriteContext(args: {
    task: { id: string; projectId: string };
    sessionId: string;
    runtimeSessionId?: string;
    message: TaskSessionRuntimeMessageInput;
    routing: Awaited<ReturnType<typeof resolveTaskSessionMessageRouting>>;
  }) {
    const runtimeMessageId = args.routing.incomingMessage.runtimeMessageId;
    const messageId = buildTaskSessionMessageWriteId(args.sessionId, runtimeMessageId);
    const persistenceState = await loadTaskSessionMessagePersistenceState({
      sessionId: args.sessionId,
      messageId,
      incomingMessage: args.routing.incomingMessage,
    });
    const persistedState = buildPersistedTaskSessionMessageState({
      incomingMessage: args.routing.incomingMessage,
      messageId,
      persistenceState,
    });
    const runState = await loadTaskSessionMessageRunState(args.sessionId);

    return {
      task: args.task,
      sessionId: args.sessionId,
      runtimeSessionId: args.runtimeSessionId,
      role: args.routing.incomingMessage.role,
      updatedAt: args.routing.updatedAt,
      sessionRecord: runState.sessionRecord,
      defaultRunId: runState.defaultRunId,
      messagePreview: buildTaskMessagePreview(persistedState.persistedTextContent),
      taskMessageStatus: resolveTaskSessionMessageNodeStatus(
        args.routing.incomingMessage.role,
        persistedState.persistedStatus,
      ),
      ...persistedState,
    };
  }

  type TaskSessionMessageWriteContext = Awaited<
    ReturnType<typeof buildTaskSessionMessageWriteContext>
  >;

  function buildTaskSessionRunContextValues(context: TaskSessionMessageWriteContext) {
    return {
      runtimeSessionId: context.sessionRecord?.runtimeSessionId ?? context.runtimeSessionId ?? null,
      triggerType: mapLegacyTriggerTypeToRunTriggerType(context.sessionRecord?.triggerType ?? null),
      executionKind: mapLegacySessionKindToRunExecutionKind(context.sessionRecord?.sessionKind),
      coordinationKey:
        context.sessionRecord?.coordinationKey ??
        context.sessionRecord?.rootSessionId ??
        context.sessionId,
      operationId: context.sessionRecord?.operationId ?? null,
      candidateIndex: context.sessionRecord?.candidateIndex ?? null,
      laneRole: mapLegacySessionKindToRunLaneRole(context.sessionRecord?.sessionKind),
      executorKind: mapLegacySessionKindToExecutorKind(context.sessionRecord?.sessionKind),
      modelRoute:
        context.sessionRecord?.effectiveModel ?? context.sessionRecord?.selectedModel ?? null,
      workflowStageKey: context.sessionRecord?.workflowStageKey ?? null,
    };
  }

  function buildTaskSessionRunResultValues(context: TaskSessionMessageWriteContext) {
    const startedAt = pickEarlierTaskSessionMessageTime(
      context.sessionRecord?.startedAt ?? null,
      context.persistedCreatedAt,
    );
    const finishedAt = resolveTaskSessionMessageRunFinishedAt({
      role: context.role,
      persistedStatus: context.persistedStatus,
      persistedCompletedAt: context.persistedCompletedAt,
      updatedAt: context.updatedAt,
    });

    return {
      status: context.taskMessageStatus,
      outputTokens: context.role === "assistant" ? context.persistedTokenUsage : 0,
      totalTokens: context.role === "assistant" ? context.persistedTokenUsage : 0,
      resultSummary: context.role === "assistant" ? context.messagePreview : null,
      errorText: context.persistedErrorText,
      startedAt,
      finishedAt: finishedAt ? pickLaterTaskSessionMessageTime(startedAt, finishedAt) : null,
    };
  }

  function buildTaskSessionRunInsertValues(context: TaskSessionMessageWriteContext) {
    return {
      id: context.defaultRunId,
      taskId: context.task.id,
      sessionId: context.sessionId,
      attemptIndex: 1,
      ...buildTaskSessionRunContextValues(context),
      ...buildTaskSessionRunResultValues(context),
      inputTokens: 0,
      costUsd: context.sessionRecord?.costUsd ?? 0,
      createdAt: pickEarlierTaskSessionMessageTime(
        context.sessionRecord?.createdAt ?? null,
        context.persistedCreatedAt,
      ) ?? undefined,
    };
  }

  function buildTaskSessionRunUpdateValues(context: TaskSessionMessageWriteContext) {
    return {
      taskId: context.task.id,
      sessionId: context.sessionId,
      ...buildTaskSessionRunContextValues(context),
      ...buildTaskSessionRunResultValues(context),
    };
  }

  function buildTaskMessageInsertValues(context: TaskSessionMessageWriteContext) {
    return {
      id: context.persistedMessageId,
      taskId: context.task.id,
      sessionId: context.sessionId,
      createdByRunId: context.role === "user" ? null : context.defaultRunId,
      role: context.role,
      messageKind: mapTaskMessageKind(context.role),
      parentMessageId: context.taskMessageParentId,
      replyToMessageId: context.taskMessageParentId,
      runtimeMessageId: context.persistedRuntimeMessageId,
      clientMessageId: context.persistedClientMessageId,
      providerMessageId: context.persistedProviderMessageId,
      seq: context.messageIndex,
      textContent: context.persistedTextContent,
      textPreview: context.messagePreview,
      rawPayload: context.persistedPayload,
      partCount: context.persistedParts.length,
      tokenUsed: context.persistedTokenUsage,
      status: context.persistedStatus,
      errorText: context.persistedErrorText,
      startedAt: context.persistedStartedAt,
      createdAt: context.persistedCreatedAt,
      updatedAt: context.updatedAt,
      completedAt: context.persistedCompletedAt,
    };
  }

  function buildTaskMessageUpdateValues(context: TaskSessionMessageWriteContext) {
    return {
      createdByRunId: context.role === "user" ? null : context.defaultRunId,
      role: context.role,
      messageKind: mapTaskMessageKind(context.role),
      runtimeMessageId: context.persistedRuntimeMessageId,
      clientMessageId: context.persistedClientMessageId,
      providerMessageId: context.persistedProviderMessageId,
      seq: context.messageIndex,
      textContent: context.persistedTextContent,
      textPreview: context.messagePreview,
      rawPayload: context.persistedPayload,
      partCount: context.persistedParts.length,
      tokenUsed: context.persistedTokenUsage,
      status: context.persistedStatus,
      errorText: context.persistedErrorText,
      startedAt: context.persistedStartedAt,
      updatedAt: context.updatedAt,
      completedAt: context.persistedCompletedAt,
    };
  }

  function buildTaskMessagePartValues(context: TaskSessionMessageWriteContext) {
    return context.persistedParts.map((part, index) => ({
      id: [context.persistedMessageId, String(index)].join(":"),
      messageId: context.persistedMessageId,
      partIndex: index,
      partType: normalizeTaskSessionMessagePartType(part),
      textContent: extractTaskSessionMessagePartText(part),
      jsonPayload: part,
      createdAt: context.persistedCreatedAt,
    }));
  }

  async function replaceTaskSessionMessageParts(context: TaskSessionMessageWriteContext) {
    if (context.persistedParts.length === 0) {
      await db
        .delete(taskMessageParts)
        .where(eq(taskMessageParts.messageId, context.persistedMessageId));
      return;
    }

    const partValues = buildTaskMessagePartValues(context);

    for (const value of partValues) {
      await db.insert(taskMessageParts).values(value).onConflictDoUpdate({
        target: [taskMessageParts.messageId, taskMessageParts.partIndex],
        set: {
          partIndex: value.partIndex,
          partType: value.partType,
          textContent: value.textContent,
          jsonPayload: value.jsonPayload,
        },
      });
    }

    await db.delete(taskMessageParts).where(
      and(
        eq(taskMessageParts.messageId, context.persistedMessageId),
        gte(taskMessageParts.partIndex, context.persistedParts.length),
      ),
    );
  }

  function buildTaskTimelineInsertValues(
    context: TaskSessionMessageWriteContext,
  ): typeof taskTimelineViews.$inferInsert {
    return {
      id: buildTaskTimelineMessageId(context.persistedMessageId),
      projectId: context.task.projectId,
      taskId: context.task.id,
      sessionId: context.sessionId,
      messageId: context.persistedMessageId,
      operationId: null,
      artifactId: null,
      itemKind: "message",
      itemRole: context.role,
      title: null,
      displayText: context.persistedTextContent,
      metadataJson: {
        runtimeMessageId: context.persistedRuntimeMessageId,
        role: context.role,
      },
      sortAt: context.persistedCompletedAt ?? context.persistedCreatedAt,
      createdAt: context.persistedCreatedAt,
      updatedAt: context.updatedAt,
    };
  }

  function buildTaskTimelineUpdateValues(
    context: TaskSessionMessageWriteContext,
  ): Partial<typeof taskTimelineViews.$inferInsert> {
    return {
      sessionId: context.sessionId,
      messageId: context.persistedMessageId,
      itemKind: "message",
      itemRole: context.role,
      displayText: context.persistedTextContent,
      metadataJson: {
        runtimeMessageId: context.persistedRuntimeMessageId,
        role: context.role,
      },
      sortAt: context.persistedCompletedAt ?? context.persistedCreatedAt,
      updatedAt: context.updatedAt,
    };
  }

  function buildTaskSessionUpdatesFromMessage(context: TaskSessionMessageWriteContext) {
    const sessionUpdates: Partial<typeof taskSessions.$inferInsert> = {
      latestRunId: context.defaultRunId,
      lastActivityAt: context.updatedAt,
      updatedAt: context.updatedAt,
    };

    if (context.role === "user") {
      sessionUpdates.status = "running";
      if (!context.sessionRecord?.userPromptSummary) {
        sessionUpdates.userPromptSummary = context.messagePreview;
      }
      return sessionUpdates;
    }

    if (context.role !== "assistant") {
      if (!context.sessionRecord?.status || context.sessionRecord.status === "queued") {
        sessionUpdates.status = "running";
      }
      return sessionUpdates;
    }

    if (context.persistedStatus === "completed") {
      sessionUpdates.status = "completed";
      sessionUpdates.headMessageId = context.persistedMessageId;
      return sessionUpdates;
    }

    if (context.persistedStatus === "failed") {
      sessionUpdates.status = "failed";
      return sessionUpdates;
    }

    if (context.persistedStatus === "cancelled") {
      sessionUpdates.status = "cancelled";
      return sessionUpdates;
    }

    sessionUpdates.status = "running";
    return sessionUpdates;
  }

  function isTaskMessageSessionSeqConflict(error: unknown): boolean {
    if (!error) {
      return false;
    }

    if (error instanceof Error) {
      if (error.message.includes("idx_task_messages_session_seq")) {
        return true;
      }

      return isTaskMessageSessionSeqConflict((error as Error & { cause?: unknown }).cause);
    }

    if (typeof error !== "object") {
      return false;
    }

    const record = error as {
      message?: unknown;
      cause?: unknown;
      constraint?: unknown;
    };

    if (record.constraint === "idx_task_messages_session_seq") {
      return true;
    }
    if (
      typeof record.message === "string" &&
      record.message.includes("idx_task_messages_session_seq")
    ) {
      return true;
    }

    return isTaskMessageSessionSeqConflict(record.cause);
  }

  async function persistTaskSessionMessageContext(context: TaskSessionMessageWriteContext) {
    await db
      .insert(taskSessionRuns)
      .values(buildTaskSessionRunInsertValues(context))
      .onConflictDoUpdate({
        target: taskSessionRuns.id,
        set: buildTaskSessionRunUpdateValues(context),
      });

    await db
      .insert(taskMessages)
      .values(buildTaskMessageInsertValues(context))
      .onConflictDoUpdate({
        target: taskMessages.id,
        set: buildTaskMessageUpdateValues(context),
      });

    await replaceTaskSessionMessageParts(context);

    await syncTaskToolExecutionFacts({
      task: context.task,
      sessionId: context.sessionId,
      runId: context.defaultRunId,
      messageId: context.persistedMessageId,
      messageIndex: context.messageIndex,
      parts: context.persistedParts,
      createdAt: context.persistedCreatedAt,
      updatedAt: context.updatedAt,
      completedAt: context.persistedCompletedAt,
    });

    await db
      .insert(taskTimelineViews)
      .values(buildTaskTimelineInsertValues(context))
      .onConflictDoUpdate({
        target: taskTimelineViews.id,
        set: buildTaskTimelineUpdateValues(context),
      });

    await db
      .update(taskSessions)
      .set(buildTaskSessionUpdatesFromMessage(context))
      .where(eq(taskSessions.id, context.sessionId));
  }

  async function upsertTaskSessionMessageRecord(args: TaskSessionMessageWriteRequestArgs) {
    const normalizedArgs: TaskSessionMessageRecordArgs = {
      ...args,
      message: parseTaskSessionRuntimeMessage(args.message),
    };
    const routing = await resolveTaskSessionMessageRouting(normalizedArgs);

    if (routing.routedTarget?.existingMessageId) {
      return {
        messageId: routing.routedTarget.existingMessageId,
        sessionId: routing.routedTarget.sessionId,
        seq: 0,
      };
    }

    const sessionId = await resolveTaskSessionMessageSessionId({
      task: normalizedArgs.task,
      sessionId: normalizedArgs.sessionId,
      runtimeSessionId: normalizedArgs.runtimeSessionId,
      routedTarget: routing.routedTarget,
    });

    for (let attempt = 0; attempt <= TASK_MESSAGE_SESSION_SEQ_INSERT_RETRY_LIMIT; attempt += 1) {
      const context = await buildTaskSessionMessageWriteContext({
        task: normalizedArgs.task,
        sessionId,
        runtimeSessionId: normalizedArgs.runtimeSessionId,
        message: normalizedArgs.message,
        routing,
      });

      try {
        await persistTaskSessionMessageContext(context);

        return {
          messageId: context.persistedMessageId,
          sessionId: context.sessionId,
          seq: 0,
        };
      } catch (error) {
        if (
          attempt >= TASK_MESSAGE_SESSION_SEQ_INSERT_RETRY_LIMIT ||
          !isTaskMessageSessionSeqConflict(error)
        ) {
          throw error;
        }

        await new Promise((resolve) =>
          setTimeout(
            resolve,
            TASK_MESSAGE_SESSION_SEQ_INSERT_RETRY_DELAY_MS * (attempt + 1),
          ),
        );
      }
    }

    throw new Error("Task session message write exhausted seq retry budget");
  }

  return {
    upsertTaskSessionMessageRecord,
  };
}
