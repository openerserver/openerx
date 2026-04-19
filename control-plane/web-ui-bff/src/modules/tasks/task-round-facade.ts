/**
 * Compat-only round facade.
 *
 * Phase-first migration (checklist §5.3 / §10.2) replaces round-level DTOs with
 * `task.phase.*` realtime contract + `/phases` / `/phases/:phaseId/view` BFF routes.
 * This module is retained for legacy consumers of `/current-round`, `/rounds`, and
 * `/rounds/:roundId/messages` only. Do **not** consume its output from any new
 * TaskDetail primary-path logic; instead go through the phase-keyed DTOs. See
 * `docs/task-detail/task-detail-phase-first-migration-checklist.md`.
 */
import { fetchTaskSessionCachedCompatMessages } from "./task-session-read-compat";
import { resolvePendingParallelCompatMainlineRecord } from "./task-session-parallel-compat";
import {
  fetchTaskSessionLineageRecords,
  toCanonicalTaskSessionId,
  type TaskSessionLineageRecord,
} from "./task-session-store";

export type TaskRoundKind = "continue" | "compare-candidate" | "workflow-step";
export type TaskRoundSource = "continue" | "compare" | "workflow";
export type TaskRoundStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TaskRoundDto {
  id: string;
  taskId: string;
  sessionId: string;
  parentRoundId?: string | null;
  parentSessionId?: string | null;
  phaseId?: string | null;
  kind: TaskRoundKind;
  source: TaskRoundSource;
  status: TaskRoundStatus;
  title?: string | null;
  promptText: string;
  model?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  stale?: boolean;
  partial?: boolean;
}

export interface TaskRoundListDto {
  taskId: string;
  currentRoundId?: string | null;
  rounds: TaskRoundDto[];
}

export type TaskMessageRole = "user" | "assistant" | "tool" | "system";
export type TaskMessageStatus = "pending" | "streaming" | "completed" | "failed" | "cancelled";
export type TaskMessagePartType = "text" | "toolCall" | "toolResult";

export interface TaskMessagePartDto {
  id: string;
  partIndex: number;
  partType: TaskMessagePartType;
  text: string;
  finalizedAt?: string | null;
  [key: string]: unknown;
}

export interface TaskMessageDto {
  id: string;
  roundId: string;
  sessionId: string;
  role: TaskMessageRole;
  status: TaskMessageStatus;
  text: string;
  errorText?: string | null;
  parts: TaskMessagePartDto[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface TaskRoundMessagesDto {
  taskId: string;
  round: TaskRoundDto;
  messages: TaskMessageDto[];
  reconcileRequired?: boolean;
  snapshotVersion: number;
  persistedThroughRevision: number;
}

export interface TaskRoundSyncStateDto {
  reconcileRequired: boolean;
  snapshotVersion: number;
  persistedThroughRevision: number;
}

type QueryOk<T> = { ok: true; status: number; data: T };
type QueryError = { ok: false; status: number; error: string; data?: Record<string, unknown> };
type TaskRoundMessagesMeta = {
  messageCount?: number;
  complete?: boolean;
  snapshotVersion?: number;
  persistedThroughRevision?: number;
} | undefined;


function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveRoundKind(record: TaskSessionLineageRecord): TaskRoundKind {
  if (record.phaseRole === "candidate" || record.sessionKind === "candidate") {
    return "compare-candidate";
  }
  if (record.phaseRole === "step" || record.sessionKind === "sequential_step") {
    return "workflow-step";
  }
  return "continue";
}

function resolveRoundSource(kind: TaskRoundKind): TaskRoundSource {
  if (kind === "compare-candidate") {
    return "compare";
  }
  if (kind === "workflow-step") {
    return "workflow";
  }
  return "continue";
}

function resolveRoundStatus(record: TaskSessionLineageRecord): TaskRoundStatus {
  const normalized = asString(record.executionStatus)?.toLowerCase();
  if (normalized === "queued" || normalized === "pending") {
    return "queued";
  }
  if (normalized === "running" || normalized === "paused") {
    return "running";
  }
  if (normalized === "completed" || normalized === "complete") {
    return "completed";
  }
  if (normalized === "failed" || normalized === "error") {
    return "failed";
  }
  if (normalized === "cancelled" || normalized === "stopped" || normalized === "terminated") {
    return "cancelled";
  }
  return record.isActive ? "running" : "completed";
}

function resolveRoundId(taskId: string, record: TaskSessionLineageRecord) {
  return record.id ?? toCanonicalTaskSessionId(taskId, record.runtimeSessionId) ?? record.runtimeSessionId;
}

function resolveParentRoundId(
  taskId: string,
  recordsByRuntimeSessionId: Map<string, TaskSessionLineageRecord>,
  parentRuntimeSessionId?: string | null,
) {
  if (!parentRuntimeSessionId) {
    return null;
  }
  const parentRecord = recordsByRuntimeSessionId.get(parentRuntimeSessionId);
  if (parentRecord) {
    return resolveRoundId(taskId, parentRecord);
  }
  return toCanonicalTaskSessionId(taskId, parentRuntimeSessionId) ?? parentRuntimeSessionId;
}

function compareNullableIso(left?: string | null, right?: string | null) {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  return left.localeCompare(right);
}

function pickCurrentRoundRecord(records: TaskSessionLineageRecord[]) {
  const pendingParallelMainlineRecord = resolvePendingParallelCompatMainlineRecord(records);
  if (pendingParallelMainlineRecord) {
    return pendingParallelMainlineRecord;
  }

  const activeRecords = records.filter((record) => record.isActive);
  const preferredActive = activeRecords
    .filter((record) => resolveRoundKind(record) === "continue")
    .sort((left, right) => compareNullableIso(left.createdAt, right.createdAt));
  if (preferredActive.length > 0) {
    return preferredActive.at(-1) ?? null;
  }
  if (activeRecords.length > 0) {
    return activeRecords.sort((left, right) => compareNullableIso(left.createdAt, right.createdAt)).at(-1) ?? null;
  }
  return records.sort((left, right) => compareNullableIso(left.createdAt, right.createdAt)).at(-1) ?? null;
}

function extractLegacyMessageId(message: unknown) {
  const record = asRecord(message);
  const info = asRecord(record?.info);
  return asString(info?.id) ?? asString(record?.id);
}

function extractLegacyMessageRole(message: unknown): TaskMessageRole {
  const record = asRecord(message);
  const info = asRecord(record?.info);
  const role = asString(info?.role) ?? asString(record?.role);
  if (role === "user" || role === "assistant" || role === "tool") {
    return role;
  }
  return "system";
}

function extractLegacyMessageText(message: unknown) {
  const record = asRecord(message);
  const directText =
    asString(record?.text) ??
    asString(record?.textContent) ??
    asString(record?.content) ??
    asString(record?.summaryText);
  if (directText) {
    return directText;
  }

  const parts = Array.isArray(record?.parts) ? record.parts : [];
  const text = parts
    .map((part) => {
      const partRecord = asRecord(part);
      return (
        asString(partRecord?.text) ??
        asString(partRecord?.content) ??
        asString(partRecord?.textContent) ??
        ""
      );
    })
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
  return text || "";
}

function extractLegacyMessageCreatedAt(message: unknown) {
  const record = asRecord(message);
  const info = asRecord(record?.info);
  const time = asRecord(info?.time);
  return (
    asString(record?.createdAt) ??
    asString(record?.startedAt) ??
    asString(time?.created) ??
    new Date(0).toISOString()
  );
}

function extractLegacyMessageCompletedAt(message: unknown) {
  const record = asRecord(message);
  const info = asRecord(record?.info);
  const time = asRecord(info?.time);
  return asString(record?.completedAt) ?? asString(time?.completed) ?? null;
}

function extractLegacyMessagePersistedRevision(message: unknown): number | null {
  const record = asRecord(message);
  const info = asRecord(record?.info);
  const revision =
    asFiniteNumber(record?.messageIndex) ??
    asFiniteNumber(info?.messageIndex) ??
    asFiniteNumber(record?.seq) ??
    asFiniteNumber(info?.seq);

  return typeof revision === "number" && revision >= 0 ? revision : null;
}

function resolveTaskRoundSyncState(
  rawMessages: unknown[],
  meta: TaskRoundMessagesMeta,
): TaskRoundSyncStateDto {
  const snapshotVersion =
    typeof meta?.snapshotVersion === "number" && Number.isFinite(meta.snapshotVersion)
      ? meta.snapshotVersion
      : meta?.messageCount ?? rawMessages.length;
  const persistedThroughRevision =
    typeof meta?.persistedThroughRevision === "number" &&
    Number.isFinite(meta.persistedThroughRevision)
      ? meta.persistedThroughRevision
      : rawMessages.reduce<number>((maxRevision, message) => {
          const revision = extractLegacyMessagePersistedRevision(message);
          if (revision == null) {
            return maxRevision;
          }
          return Math.max(maxRevision, revision);
        }, -1);

  return {
    reconcileRequired: meta?.complete === false,
    snapshotVersion,
    persistedThroughRevision:
      persistedThroughRevision >= 0 ? persistedThroughRevision : snapshotVersion,
  };
}

function extractLegacyMessageErrorText(message: unknown) {
  const record = asRecord(message);
  const info = asRecord(record?.info);
  return asString(record?.errorText) ?? asString(info?.error) ?? null;
}

function extractLegacyMessageStatus(message: unknown): TaskMessageStatus {
  const record = asRecord(message);
  const info = asRecord(record?.info);
  const completedAt = extractLegacyMessageCompletedAt(message);
  const errorText = extractLegacyMessageErrorText(message);
  const status = asString(record?.status) ?? asString(info?.status);
  const normalized = status?.toLowerCase();
  if (normalized === "failed" || normalized === "error" || errorText) {
    return "failed";
  }
  if (normalized === "cancelled" || normalized === "stopped" || normalized === "terminated") {
    return "cancelled";
  }
  if (normalized === "pending" || normalized === "queued") {
    return "pending";
  }
  if (completedAt) {
    return "completed";
  }
  return extractLegacyMessageRole(message) === "assistant" ? "streaming" : "completed";
}

function mapPartType(type: string | undefined): TaskMessagePartType {
  if (type === "tool" || type === "tool-call" || type === "toolCall") {
    return "toolCall";
  }
  if (type === "tool-result" || type === "toolResult") {
    return "toolResult";
  }
  return "text";
}

function extractLegacyMessageParts(message: unknown): TaskMessagePartDto[] {
  const record = asRecord(message);
  const parts = Array.isArray(record?.parts) ? record.parts : [];
  if (parts.length === 0) {
    const text = extractLegacyMessageText(message);
    if (!text) {
      return [];
    }
    return [
      {
        id: `${extractLegacyMessageId(message) ?? crypto.randomUUID()}:part:0`,
        partIndex: 0,
        partType: "text",
        text,
        finalizedAt: extractLegacyMessageCompletedAt(message),
      },
    ];
  }

  return parts.map((part, index) => {
    const partRecord = asRecord(part);
    const type = asString(partRecord?.type) ?? asString(partRecord?.partType);
    return {
      ...(partRecord ?? {}),
      id:
        asString(partRecord?.id) ??
        `${extractLegacyMessageId(message) ?? crypto.randomUUID()}:part:${index}`,
      partIndex: index,
      partType: mapPartType(type),
      text:
        asString(partRecord?.text) ??
        asString(partRecord?.content) ??
        asString(partRecord?.textContent) ??
        "",
      finalizedAt: extractLegacyMessageCompletedAt(message),
    } satisfies TaskMessagePartDto;
  });
}

function isExecutionContextText(text: string) {
  return text.startsWith("Execution context:");
}

function extractPromptTextFromMessages(messages: unknown[]) {
  for (const message of messages) {
    if (extractLegacyMessageRole(message) !== "user") {
      continue;
    }
    const text = extractLegacyMessageText(message).trim();
    if (!text || isExecutionContextText(text)) {
      continue;
    }
    return text;
  }
  return "";
}

async function resolveRoundPromptText(
  taskId: string,
  authorization: string,
  record: TaskSessionLineageRecord,
) {
  const messagesResult = await fetchTaskSessionCachedCompatMessages(
    taskId,
    record.runtimeSessionId,
    authorization,
    { includeLineage: false },
  );
  if (!messagesResult.ok) {
    return record.branchName ?? "";
  }
  const messages = Array.isArray(messagesResult.data?.data) ? messagesResult.data.data : [];
  return extractPromptTextFromMessages(messages) || (record.branchName ?? "");
}

function resolvePartialRoundPromptText() {
  return "";
}

async function buildRoundDto(
  taskId: string,
  authorization: string,
  record: TaskSessionLineageRecord,
  recordsByRuntimeSessionId: Map<string, TaskSessionLineageRecord>,
  options?: { allowPartialPrompt?: boolean },
): Promise<TaskRoundDto> {
  const kind = resolveRoundKind(record);
  const roundId = resolveRoundId(taskId, record);
  const allowPartialPrompt = options?.allowPartialPrompt === true;
  const promptText = allowPartialPrompt
    ? resolvePartialRoundPromptText()
    : await resolveRoundPromptText(taskId, authorization, record);
  const createdAt = record.createdAt ?? record.updatedAt ?? new Date(0).toISOString();
  const updatedAt = record.updatedAt ?? record.createdAt ?? createdAt;

  return {
    id: roundId,
    taskId,
    sessionId: roundId,
    parentRoundId: resolveParentRoundId(taskId, recordsByRuntimeSessionId, record.parentRuntimeSessionId),
    parentSessionId: resolveParentRoundId(taskId, recordsByRuntimeSessionId, record.parentRuntimeSessionId),
    phaseId: record.phaseId ?? null,
    kind,
    source: resolveRoundSource(kind),
    status: resolveRoundStatus(record),
    title: record.branchName ?? null,
    promptText,
    model: record.selectedModel ?? null,
    candidateIndex: typeof record.candidateIndex === "number" ? record.candidateIndex : null,
    stepIndex: typeof record.stepIndex === "number" ? record.stepIndex : null,
    startedAt: record.createdAt ?? null,
    completedAt: resolveRoundStatus(record) === "completed" ? record.updatedAt ?? record.createdAt ?? null : null,
    createdAt,
    updatedAt,
    stale: false,
    partial: allowPartialPrompt || promptText.length === 0,
  } satisfies TaskRoundDto;
}

function buildMessageDto(round: TaskRoundDto, message: unknown): TaskMessageDto | null {
  const messageId = extractLegacyMessageId(message);
  if (!messageId) {
    return null;
  }

  const createdAt = extractLegacyMessageCreatedAt(message);
  const completedAt = extractLegacyMessageCompletedAt(message);
  return {
    id: messageId,
    roundId: round.id,
    sessionId: round.sessionId,
    role: extractLegacyMessageRole(message),
    status: extractLegacyMessageStatus(message),
    text: extractLegacyMessageText(message),
    errorText: extractLegacyMessageErrorText(message),
    parts: extractLegacyMessageParts(message),
    createdAt,
    updatedAt: completedAt ?? createdAt,
    startedAt: createdAt,
    completedAt,
  } satisfies TaskMessageDto;
}

export async function queryTaskRounds(args: {
  taskId: string;
  authorization: string;
}): Promise<QueryOk<TaskRoundListDto> | QueryError> {
  const lineageResult = await fetchTaskSessionLineageRecords(args.taskId, args.authorization);
  if (!lineageResult.ok) {
    return {
      ok: false,
      status: lineageResult.status,
      error: "Failed to load task rounds",
    };
  }

  const records = lineageResult.activeRecords;
  const recordsByRuntimeSessionId = new Map(
    records.map((record) => [record.runtimeSessionId, record] as const),
  );
  const rounds = await Promise.all(
    records.map((record) => buildRoundDto(args.taskId, args.authorization, record, recordsByRuntimeSessionId)),
  );
  const currentRecord = pickCurrentRoundRecord(records);

  return {
    ok: true,
    status: 200,
    data: {
      taskId: args.taskId,
      currentRoundId: currentRecord ? resolveRoundId(args.taskId, currentRecord) : null,
      rounds,
    },
  };
}

export async function queryCurrentTaskRound(args: {
  taskId: string;
  authorization: string;
}): Promise<QueryOk<{ taskId: string; round: TaskRoundDto | null }> | QueryError> {
  const lineageResult = await fetchTaskSessionLineageRecords(args.taskId, args.authorization);
  if (!lineageResult.ok) {
    return {
      ok: false,
      status: lineageResult.status,
      error: "Failed to load task rounds",
    };
  }

  const records = lineageResult.activeRecords;
  const currentRecord = pickCurrentRoundRecord(records);
  const round = currentRecord
    ? await buildRoundDto(
        args.taskId,
        args.authorization,
        currentRecord,
        new Map(records.map((record) => [record.runtimeSessionId, record] as const)),
        { allowPartialPrompt: true },
      )
    : null;

  return {
    ok: true,
    status: 200,
    data: {
      taskId: args.taskId,
      round,
    },
  };
}

export async function queryTaskRoundSyncState(args: {
  taskId: string;
  sessionId: string;
  authorization: string;
}) {
  const messagesResult = await fetchTaskSessionCachedCompatMessages(
    args.taskId,
    args.sessionId,
    args.authorization,
    { includeLineage: false },
  );
  if (!messagesResult.ok) {
    return {
      ok: false as const,
      status: messagesResult.status,
      error: messagesResult.error ?? "Failed to load task round sync state",
    };
  }

  const rawMessages = Array.isArray(messagesResult.data?.data) ? messagesResult.data.data : [];
  return {
    ok: true as const,
    status: 200 as const,
    data: resolveTaskRoundSyncState(rawMessages, messagesResult.data?.meta),
  };
}

export async function queryTaskRoundMessages(args: {
  taskId: string;
  roundId: string;
  authorization: string;
}): Promise<QueryOk<TaskRoundMessagesDto> | QueryError> {
  const lineageResult = await fetchTaskSessionLineageRecords(args.taskId, args.authorization);
  if (!lineageResult.ok) {
    return {
      ok: false,
      status: lineageResult.status,
      error: "Failed to load task rounds",
    };
  }

  const records = lineageResult.activeRecords;
  const recordsByRuntimeSessionId = new Map(
    records.map((record) => [record.runtimeSessionId, record] as const),
  );
  const record = records.find(
    (item) =>
      item.id === args.roundId ||
      item.runtimeSessionId === args.roundId ||
      resolveRoundId(args.taskId, item) === args.roundId,
  );
  if (!record) {
    return {
      ok: false,
      status: 404,
      error: "Task round not found",
    };
  }

  const round = await buildRoundDto(args.taskId, args.authorization, record, recordsByRuntimeSessionId);
  const messagesResult = await fetchTaskSessionCachedCompatMessages(
    args.taskId,
    record.runtimeSessionId,
    args.authorization,
    { includeLineage: false },
  );
  if (!messagesResult.ok) {
    return {
      ok: false,
      status: messagesResult.status,
      error: messagesResult.error ?? "Failed to load task round messages",
    };
  }

  const rawMessages = Array.isArray(messagesResult.data?.data) ? messagesResult.data.data : [];
  const messages = rawMessages
    .map((message) => buildMessageDto(round, message))
    .filter((message): message is TaskMessageDto => Boolean(message));
  const syncState = resolveTaskRoundSyncState(rawMessages, messagesResult.data?.meta);

  return {
    ok: true,
    status: 200,
    data: {
      taskId: args.taskId,
      round,
      messages,
      reconcileRequired: syncState.reconcileRequired,
      snapshotVersion: syncState.snapshotVersion,
      persistedThroughRevision: syncState.persistedThroughRevision,
    },
  };
}