import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  roleAggregateConclusions,
  taskArtifacts,
  taskDomainEvents,
  taskExecutionPhases,
  taskMessageParts,
  taskMessages,
  taskOperations,
  taskSessionRuns,
  taskSessions,
  taskSnapshots,
  taskStageRuns,
  taskTimelineViews,
  taskUsageLedgerEntries,
  taskWorkflowRuns,
} from "../../db/schema";
import type { TaskTreeRecord } from "../project-tree/task-view";
import { ensureTaskWorkflowFactsAvailable } from "../task-workflows/legacy-role-workflow-storage";
import { buildPublicTaskExecutionPhaseRecord } from "./task-phase-public-record";
import { resolvePublicTaskSessionSourceType } from "./task-session-public-source-type";
import {
  dedupeTaskToolTimelineRows,
  resolveTaskToolIdentity,
} from "./task-tool-dedupe";
import {
  orderTaskSessionsByTopology,
  resolveLatestTaskSessionId,
} from "./task-session-topology-order";

type TaskSessionMessagePartRecord = {
  id: string | null;
  messageId: string | null;
  partIndex: number | null;
  partType: string | null;
  textContent: string | null;
  jsonPayload: Record<string, unknown> | null;
  createdAt: string | null;
};

type TaskSessionMessageRecord = {
  id: string;
  sessionId: string;
  taskId: string | null;
  projectId: string | null;
  runtimeMessageId: string | null;
  role: string | null;
  status: string | null;
  clientMessageId: string | null;
  providerMessageId: string | null;
  messageIndex: number | null;
  textContent: string | null;
  summaryText: string | null;
  rawPayload: Record<string, unknown> | null;
  tokenUsed: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorText: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  agent: string | null;
  model: string | null;
  userInputText: string | null;
  systemContextText: string | null;
  finalSentText: string | null;
  parts: TaskSessionMessagePartRecord[];
};

type TaskSessionMessageRecordInput = Omit<TaskSessionMessageRecord, "parts">;

type CanonicalTaskMessageRow = {
  id: string;
  taskId: string;
  sessionId: string;
  runtimeMessageId: string | null;
  role: string;
  status: string;
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

type TaskTimelineViewRow = {
  id: string;
  taskId: string;
  projectId: string;
  sessionId: string | null;
  messageId: string | null;
  operationId: string | null;
  artifactId: string | null;
  itemKind: string | null;
  itemRole: string | null;
  title: string | null;
  displayText: string | null;
  metadataJson: Record<string, unknown> | null;
  sortAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

const CANONICAL_TASK_MESSAGE_COLUMNS = {
  id: taskMessages.id,
  taskId: taskMessages.taskId,
  sessionId: taskMessages.sessionId,
  runtimeMessageId: taskMessages.runtimeMessageId,
  role: taskMessages.role,
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

type TaskSessionHydrationSnapshot = {
  latestResult?: string | null;
  latestResultSummary?: string | null;
} | null;

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeTaskSessionMessageTimeValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim();
  if (/^\d+$/u.test(normalized)) {
    const parsedNumber = Number(normalized);
    if (Number.isFinite(parsedNumber)) {
      const parsed = new Date(parsedNumber);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? normalized : new Date(parsed).toISOString();
}

function extractPersistedStandalonePart(message: unknown) {
  const record = asRecord(message);
  const part = record?.part;
  return part && typeof part === "object" ? (part as Record<string, unknown>) : undefined;
}

function extractPersistedStandalonePartType(message: unknown) {
  const part = extractPersistedStandalonePart(message);
  return typeof part?.type === "string" ? part.type : undefined;
}

function extractPersistedStandalonePartStatus(message: unknown) {
  const part = extractPersistedStandalonePart(message);
  const state = part?.state;
  if (!state || typeof state !== "object") {
    return undefined;
  }

  return typeof (state as Record<string, unknown>).status === "string"
    ? ((state as Record<string, unknown>).status as string)
    : undefined;
}

export function shouldPersistStandalonePartEvent(message: unknown) {
  const partType = extractPersistedStandalonePartType(message);
  if (partType === "step-start") {
    return false;
  }

  if (partType === "tool" || partType === "tool-result") {
    return true;
  }

  if (partType === "source") {
    const status = extractPersistedStandalonePartStatus(message);
    return status === "completed" || status === "error";
  }

  return false;
}

export type TaskSessionLineageRecord = {
  id: string;
  parentSessionId?: string | null;
};

export function buildTaskSessionLineagePath(
  records: TaskSessionLineageRecord[],
  sessionId: string,
) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(sessionId);

  while (current && !visited.has(current.id)) {
    path.unshift(current.id);
    visited.add(current.id);
    current = current.parentSessionId ? byId.get(current.parentSessionId) : undefined;
  }

  return path.length > 0 ? path : [sessionId];
}

export function toCanonicalTaskSessionId(taskId: string, sessionId?: string | null) {
  if (typeof sessionId !== "string") {
    return null;
  }

  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }

  if (normalizedSessionId.startsWith("task-session:")) {
    return normalizedSessionId;
  }

  return `task-session:${taskId}:${normalizedSessionId}`;
}

export function resolveTaskSessionRecordId(
  sessions: Array<{ id: string; runtimeSessionId?: string | null }>,
  sessionId?: string | null,
) {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return null;
  }

  const normalizedSessionId = sessionId.trim();
  return (
    sessions.find((session) => session.id === normalizedSessionId)?.id ??
    sessions.find((session) => session.runtimeSessionId === normalizedSessionId)?.id ??
    null
  );
}

async function loadTaskSnapshot(taskId: string) {
  const snapshot = await db.query.taskSnapshots.findFirst({
    where: eq(taskSnapshots.taskId, taskId),
  });

  return snapshot ?? null;
}

async function loadTaskProjectionHeadVersion(taskId: string) {
  if (!taskDomainEvents) {
    return 0;
  }

  const rows = await db
    .select({ seq: taskDomainEvents.seq })
    .from(taskDomainEvents)
    .where(eq(taskDomainEvents.taskId, taskId))
    .orderBy(desc(taskDomainEvents.seq), desc(taskDomainEvents.createdAt));

  return typeof rows[0]?.seq === "number" && Number.isFinite(rows[0].seq) ? rows[0].seq : 0;
}

async function loadTaskSessionRecord(taskId: string, sessionId: string) {
  return db.query.taskSessions.findFirst({
    where: and(eq(taskSessions.taskId, taskId), eq(taskSessions.id, sessionId)),
  });
}

async function loadTaskSessionRecords(taskId: string) {
  const sessions = await db
    .select()
    .from(taskSessions)
    .where(eq(taskSessions.taskId, taskId))
    .orderBy(asc(taskSessions.createdAt));

  return orderTaskSessionsByTopology(sessions);
}

async function loadTaskExecutionPhaseRecords(taskId: string) {
  return db.query.taskExecutionPhases.findMany({
    where: eq(taskExecutionPhases.taskId, taskId),
    orderBy: [asc(taskExecutionPhases.phaseIndex), asc(taskExecutionPhases.createdAt)],
  });
}

function collectMissingTaskSessionModelIds(
  sessions: Array<{ id: string; selectedModel?: string | null; effectiveModel?: string | null }>,
) {
  return Array.from(
    new Set(
      sessions
        .filter((session) => !asNonEmptyString(session.selectedModel ?? null))
        .filter((session) => !asNonEmptyString(session.effectiveModel ?? null))
        .map((session) => session.id)
        .filter(
          (sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0,
        ),
    ),
  );
}

async function loadTaskSessionSelectedModelFallbacks(taskId: string, sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return new Map<string, string>();
  }

  const operationRows = await db
    .select({
      sessionId: taskSessionRuns.sessionId,
      modelRoute: taskSessionRuns.modelRoute,
      createdAt: taskSessionRuns.createdAt,
    })
    .from(taskSessionRuns)
    .where(and(eq(taskSessionRuns.taskId, taskId), inArray(taskSessionRuns.sessionId, sessionIds)))
    .orderBy(asc(taskSessionRuns.createdAt));

  const selectedModelBySessionId = new Map<string, string>();
  for (const row of operationRows) {
    const sessionId = asNonEmptyString(row.sessionId);
    if (!sessionId || selectedModelBySessionId.has(sessionId)) {
      continue;
    }

    const formattedModel = asNonEmptyString(row.modelRoute);
    if (formattedModel) {
      selectedModelBySessionId.set(sessionId, formattedModel);
    }
  }

  return selectedModelBySessionId;
}

function hydrateTaskSessionSelectedModels<
  TSession extends { id: string; selectedModel?: string | null; effectiveModel?: string | null },
>(sessions: TSession[], selectedModelBySessionId: Map<string, string>) {
  return sessions.map((session) => ({
    ...session,
    selectedModel:
      session.selectedModel ??
      session.effectiveModel ??
      selectedModelBySessionId.get(session.id) ??
      null,
  }));
}

function resolveCurrentTaskSessionId(
  sessions: Array<{ id: string; runtimeSessionId?: string | null }>,
  currentSessionId?: string | null,
) {
  return resolveTaskSessionRecordId(sessions, currentSessionId);
}

function resolveTaskSessionPhaseId<
  TSession extends { id: string; phaseId?: string | null; coordinationKey?: string | null },
>(session?: TSession | null) {
  return asNonEmptyString(session?.phaseId) ?? null;
}

function findTaskSessionByIdentifier<
  TSession extends { id: string; runtimeSessionId?: string | null },
>(
  sessions: TSession[],
  sessionId?: string | null,
) {
  if (!sessionId) {
    return null;
  }

  return (
    sessions.find(
      (session) => session.id === sessionId || session.runtimeSessionId === sessionId,
    ) ?? null
  );
}

function resolveTaskSessionPhaseIdBySessionId<
  TSession extends {
    id: string;
    phaseId?: string | null;
    coordinationKey?: string | null;
    runtimeSessionId?: string | null;
  },
>(
  sessions: TSession[],
  sessionId?: string | null,
) {
  return resolveTaskSessionPhaseId(findTaskSessionByIdentifier(sessions, sessionId));
}

function resolveTaskExecutionPhaseId<
  TPhase extends { id: string },
  TSession extends {
    id: string;
    phaseId?: string | null;
    coordinationKey?: string | null;
    runtimeSessionId?: string | null;
  },
>(args: {
  explicitPhaseId?: string | null;
  phases: TPhase[];
  sessions: TSession[];
  sessionId?: string | null;
}) {
  const explicitPhaseId = asNonEmptyString(args.explicitPhaseId);
  if (explicitPhaseId) {
    return (
      args.phases.find((phase) => phase.id === explicitPhaseId)?.id ??
      explicitPhaseId
    );
  }

  return resolveTaskSessionPhaseIdBySessionId(args.sessions, args.sessionId);
}

function countTaskSessionPhases<
  TSession extends { id: string; phaseId?: string | null; coordinationKey?: string | null },
>(sessions: TSession[]) {
  const phaseIds = new Set<string>();

  for (const session of sessions) {
    const phaseId = resolveTaskSessionPhaseId(session);
    if (phaseId) {
      phaseIds.add(phaseId);
    }
  }

  return phaseIds.size;
}

function normalizePublicTaskSessionStatusValue(status?: string | null) {
  const normalizedStatus = asNonEmptyString(status)?.toLowerCase();
  if (!normalizedStatus) {
    return null;
  }

  if (normalizedStatus === "completed") {
    return "complete" as const;
  }

  if (normalizedStatus === "error") {
    return "failed" as const;
  }

  if (normalizedStatus === "stopped" || normalizedStatus === "terminated") {
    return "cancelled" as const;
  }

  if (
    normalizedStatus === "queued" ||
    normalizedStatus === "running" ||
    normalizedStatus === "awaiting_adoption" ||
    normalizedStatus === "complete" ||
    normalizedStatus === "failed" ||
    normalizedStatus === "cancelled"
  ) {
    return normalizedStatus;
  }

  return null;
}

function normalizePublicTaskSessionExecutionStatus(args: {
  executionStatus?: string | null;
  status?: string | null;
}) {
  const normalizedExecutionStatus = normalizePublicTaskSessionStatusValue(args.executionStatus);
  const normalizedLegacyStatus = normalizePublicTaskSessionStatusValue(args.status);

  if (
    (normalizedExecutionStatus === "queued" || normalizedExecutionStatus === "running") &&
    normalizedLegacyStatus &&
    normalizedLegacyStatus !== normalizedExecutionStatus
  ) {
    return normalizedLegacyStatus;
  }

  return normalizedExecutionStatus ?? normalizedLegacyStatus;
}

function isCompleteTaskSessionExecutionStatus(status?: string | null) {
  return status === "complete" || status === "failed" || status === "cancelled";
}

function buildTaskPhaseMessageGroupTimelineMeta(args: {
  executionStatus?: string | null;
  itemCount: number;
}) {
  const itemCount = Number.isFinite(args.itemCount) && args.itemCount > 0 ? args.itemCount : 0;
  const normalizedExecutionStatus = normalizePublicTaskSessionExecutionStatus({
    executionStatus: args.executionStatus,
  });
  const isComplete = isCompleteTaskSessionExecutionStatus(normalizedExecutionStatus);
  const cacheState =
    itemCount <= 0 ? ("none" as const) : isComplete ? ("complete" as const) : ("partial" as const);

  return {
    cacheState,
    complete: cacheState === "complete",
    itemCount,
  };
}

async function loadTaskTimelineItemCountsBySessionId(taskId: string, sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return new Map<string, number>();
  }

  const rows = await db
    .select({
      sessionId: taskTimelineViews.sessionId,
    })
    .from(taskTimelineViews)
    .where(and(eq(taskTimelineViews.taskId, taskId), inArray(taskTimelineViews.sessionId, sessionIds)))
    .orderBy(asc(taskTimelineViews.sessionId));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const sessionId = asNonEmptyString(row.sessionId);
    if (!sessionId) {
      continue;
    }

    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  }

  return counts;
}

function projectPublicTaskSessions<
  TSession extends {
    id: string;
    parentSessionId?: string | null;
    runtimeSessionId?: string | null;
    forkedFromMessageId?: string | null;
    status?: string | null;
    executionStatus?: string | null;
    sessionKind?: string | null;
    phaseId?: string | null;
    phaseRole?: string | null;
    phaseItemIndex?: number | null;
    candidateIndex?: number | null;
    executionModeSnapshot?: string | null;
    coordinationKey?: string | null;
  },
>(sessions: TSession[]) {
  const byId = new Map(sessions.map((session) => [session.id, session] as const));

  return sessions.map((session) => {
    const parentRuntimeSessionId = session.parentSessionId
      ? (byId.get(session.parentSessionId)?.runtimeSessionId ?? session.parentSessionId)
      : null;
    const phaseId = resolveTaskSessionPhaseId(session);

    return {
      ...session,
      phaseId,
      executionStatus: normalizePublicTaskSessionExecutionStatus({
        executionStatus: session.executionStatus ?? null,
        status: session.status ?? null,
      }),
      parentRuntimeSessionId,
      sourceType: resolvePublicTaskSessionSourceType({
        sourceType: null,
        sessionKind: session.sessionKind ?? null,
        parentSessionId: session.parentSessionId ?? null,
        parentRuntimeSessionId,
        forkedFromMessageId: session.forkedFromMessageId ?? null,
        candidateIndex:
          typeof session.candidateIndex === "number" ? session.candidateIndex : null,
        executionModeSnapshot: session.executionModeSnapshot ?? null,
        phaseId,
      }),
    };
  });
}

function resolveTaskPhaseRoleSortOrder(phaseRole?: string | null) {
  switch (phaseRole) {
    case "mainline":
      return 0;
    case "step":
      return 1;
    case "candidate":
      return 2;
    case "judge":
      return 3;
    default:
      return 4;
  }
}

function resolveTaskPhaseSortTime(session: { createdAt?: string | null; updatedAt?: string | null }) {
  const createdAt = Date.parse(session.createdAt ?? "");
  if (!Number.isNaN(createdAt)) {
    return createdAt;
  }

  const updatedAt = Date.parse(session.updatedAt ?? "");
  return Number.isNaN(updatedAt) ? Number.MAX_SAFE_INTEGER : updatedAt;
}

function orderTaskSessionsByPhase<
  TSession extends {
    id: string;
    runtimeSessionId?: string | null;
    phaseId?: string | null;
    coordinationKey?: string | null;
    phaseRole?: string | null;
    phaseItemIndex?: number | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  },
>(sessions: TSession[], phaseIndexById: Map<string, number>) {
  return sessions.slice().sort((left, right) => {
    const leftPhaseIndex =
      phaseIndexById.get(resolveTaskSessionPhaseId(left) ?? "") ?? Number.MAX_SAFE_INTEGER;
    const rightPhaseIndex =
      phaseIndexById.get(resolveTaskSessionPhaseId(right) ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (leftPhaseIndex !== rightPhaseIndex) {
      return leftPhaseIndex - rightPhaseIndex;
    }

    const leftRoleOrder = resolveTaskPhaseRoleSortOrder(left.phaseRole);
    const rightRoleOrder = resolveTaskPhaseRoleSortOrder(right.phaseRole);
    if (leftRoleOrder !== rightRoleOrder) {
      return leftRoleOrder - rightRoleOrder;
    }

    const leftItemIndex =
      typeof left.phaseItemIndex === "number" ? left.phaseItemIndex : Number.MAX_SAFE_INTEGER;
    const rightItemIndex =
      typeof right.phaseItemIndex === "number" ? right.phaseItemIndex : Number.MAX_SAFE_INTEGER;
    if (leftItemIndex !== rightItemIndex) {
      return leftItemIndex - rightItemIndex;
    }

    const leftTime = resolveTaskPhaseSortTime(left);
    const rightTime = resolveTaskPhaseSortTime(right);
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    const leftRuntimeSessionId = asNonEmptyString(left.runtimeSessionId) ?? left.id;
    const rightRuntimeSessionId = asNonEmptyString(right.runtimeSessionId) ?? right.id;
    return leftRuntimeSessionId.localeCompare(rightRuntimeSessionId);
  });
}

function attachTaskSessionMessageParts(
  messages: TaskSessionMessageRecordInput[],
  parts: TaskSessionMessagePartRecord[],
) {
  const partsByMessageId = new Map<string, TaskSessionMessagePartRecord[]>();
  for (const part of parts) {
    const messageId = asNonEmptyString(part.messageId);
    if (!messageId) {
      continue;
    }

    const existing = partsByMessageId.get(messageId) ?? [];
    existing.push(part);
    partsByMessageId.set(messageId, existing);
  }

  return messages.map((message) => ({
    ...message,
    parts: partsByMessageId.get(message.id) ?? [],
  }));
}

function normalizeTaskSessionMessagePart(
  part: typeof taskMessageParts.$inferSelect,
): TaskSessionMessagePartRecord {
  return {
    id: part.id ?? null,
    messageId: part.messageId ?? null,
    partIndex: typeof part.partIndex === "number" ? part.partIndex : null,
    partType: part.partType ?? null,
    textContent: part.textContent ?? null,
    jsonPayload: part.jsonPayload ?? null,
    createdAt: normalizeTaskSessionMessageTimeValue(part.createdAt) ?? null,
  };
}

function resolveTaskSessionMessageCreatedAt(
  rawMessage: Record<string, unknown>,
) {
  const rawPayload = asRecord(rawMessage.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  const rawTime = asRecord(rawInfo?.time);

  return (
    normalizeTaskSessionMessageTimeValue(rawTime?.created) ??
    normalizeTaskSessionMessageTimeValue(rawMessage.createdAt) ??
    null
  );
}

function resolveTaskSessionMessageCompletedAt(
  rawMessage: Record<string, unknown>,
) {
  const rawPayload = asRecord(rawMessage.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  const rawTime = asRecord(rawInfo?.time);

  return (
    normalizeTaskSessionMessageTimeValue(rawTime?.completed) ??
    normalizeTaskSessionMessageTimeValue(rawMessage.completedAt) ??
    null
  );
}

function resolveTaskSessionMessageTextContent(
  rawMessage: Record<string, unknown>,
) {
  return (
    asNonEmptyString(rawMessage.textContent) ??
    asNonEmptyString(rawMessage.textPreview) ??
    null
  );
}

function resolveTaskSessionMessageRuntimeMessageId(args: {
  rawMessage: Record<string, unknown>;
}) {
  return asNonEmptyString(args.rawMessage.runtimeMessageId) ?? null;
}

function resolveTaskSessionMessageClientMessageId(
  rawMessage: Record<string, unknown>,
) {
  return asNonEmptyString(rawMessage.clientMessageId) ?? null;
}

function resolveTaskSessionMessageProviderMessageId(args: {
  rawMessage: Record<string, unknown>;
}) {
  return asNonEmptyString(args.rawMessage.providerMessageId) ?? null;
}

function resolveTaskSessionMessageIndex(rawMessage: Record<string, unknown>) {
  if (typeof rawMessage.seq === "number") {
    return rawMessage.seq;
  }

  return typeof rawMessage.messageIndex === "number" ? rawMessage.messageIndex : null;
}

function resolveTaskSessionMessageSummaryText(
  rawMessage: Record<string, unknown>,
  textContent: string | null,
) {
  return (
    asNonEmptyString(rawMessage.summaryText) ??
    asNonEmptyString(rawMessage.textPreview) ??
    textContent
  );
}

function resolveTaskSessionMessageErrorText(
  rawMessage: Record<string, unknown>,
) {
  return asNonEmptyString(rawMessage.errorText) ?? null;
}

function resolveTaskSessionPromptDecomposition(rawPayload: Record<string, unknown> | null) {
  const promptDecomposition = asRecord(rawPayload?.promptDecomposition);
  return {
    userInputText: asNonEmptyString(promptDecomposition?.userInputText) ?? null,
    systemContextText: asNonEmptyString(promptDecomposition?.systemContextText) ?? null,
    finalSentText: asNonEmptyString(promptDecomposition?.finalSentText) ?? null,
  };
}

function normalizeTaskSessionMessageRecord(
  message: CanonicalTaskMessageRow,
): TaskSessionMessageRecordInput {
  const rawMessage = message as Record<string, unknown>;
  const rawPayload = asRecord(rawMessage.rawPayload) ?? null;
  const rawInfo = asRecord(rawPayload?.info) ?? null;
  const createdAt = resolveTaskSessionMessageCreatedAt(rawMessage);
  const completedAt = resolveTaskSessionMessageCompletedAt(rawMessage);
  const textContent = resolveTaskSessionMessageTextContent(rawMessage);
  const promptDecomposition = resolveTaskSessionPromptDecomposition(rawPayload);

  return {
    id: message.id,
    sessionId: message.sessionId,
    taskId: asNonEmptyString(rawMessage.taskId),
    projectId: asNonEmptyString(rawMessage.projectId),
    runtimeMessageId: resolveTaskSessionMessageRuntimeMessageId({
      rawMessage,
    }),
    role: message.role,
    status: asNonEmptyString(rawMessage.status),
    clientMessageId: resolveTaskSessionMessageClientMessageId(rawMessage),
    providerMessageId: resolveTaskSessionMessageProviderMessageId({
      rawMessage,
    }),
    messageIndex: resolveTaskSessionMessageIndex(rawMessage),
    textContent,
    summaryText: resolveTaskSessionMessageSummaryText(rawMessage, textContent),
    rawPayload,
    tokenUsed: typeof rawMessage.tokenUsed === "number" ? rawMessage.tokenUsed : null,
    startedAt: normalizeTaskSessionMessageTimeValue(rawMessage.startedAt) ?? createdAt,
    completedAt,
    errorText: resolveTaskSessionMessageErrorText(rawMessage),
    agent: asNonEmptyString(rawInfo?.agent) ?? asNonEmptyString(rawPayload?.agent) ?? null,
    model: asNonEmptyString(rawInfo?.model) ?? asNonEmptyString(rawPayload?.model) ?? null,
    userInputText: promptDecomposition.userInputText,
    systemContextText: promptDecomposition.systemContextText,
    finalSentText: promptDecomposition.finalSentText,
    createdAt,
    updatedAt: normalizeTaskSessionMessageTimeValue(rawMessage.updatedAt) ?? createdAt,
  };
}

async function loadTaskSessionMessagesInternal(
  taskId: string,
  sessionId: string,
  options?: {
    sortMode?: "timeline" | "session";
  },
): Promise<TaskSessionMessageRecord[]> {
  const canonicalMessages = await db
    .select(CANONICAL_TASK_MESSAGE_COLUMNS)
    .from(taskMessages)
    .where(and(eq(taskMessages.taskId, taskId), eq(taskMessages.sessionId, sessionId)))
    .orderBy(asc(taskMessages.seq), asc(taskMessages.createdAt));

  const canonicalMessageIds = canonicalMessages.map((message) => message.id);
  const canonicalParts =
    canonicalMessageIds.length > 0
      ? await db
          .select()
          .from(taskMessageParts)
          .where(inArray(taskMessageParts.messageId, canonicalMessageIds))
          .orderBy(asc(taskMessageParts.partIndex))
      : [];

  if (canonicalMessages.length > 0) {
    const hydratedMessages = attachTaskSessionMessageParts(
      canonicalMessages.map((message) => normalizeTaskSessionMessageRecord(message)),
      canonicalParts.map((part) => normalizeTaskSessionMessagePart(part)),
    );
    return options?.sortMode === "session"
      ? sortTaskSessionMessageRecordsForSessionRead(hydratedMessages)
      : sortSingleTaskSessionMessageRecords(hydratedMessages);
  }

  return [];
}

async function loadTaskWorkflowRuns(taskId: string) {
  return db
    .select()
    .from(taskWorkflowRuns)
    .where(eq(taskWorkflowRuns.taskId, taskId))
    .orderBy(asc(taskWorkflowRuns.createdAt));
}

type LoadedTaskSessionMessageRecord = TaskSessionMessageRecord;

function extractTaskSessionMessageRole(message: LoadedTaskSessionMessageRecord) {
  return asNonEmptyString(message.role) ?? "assistant";
}

function extractTaskSessionMessageTextFromParts(
  parts: Array<{
    textContent?: string | null;
    jsonPayload?: Record<string, unknown> | null;
  }>,
) {
  return parts
    .map((part) => {
      const payload = asRecord(part.jsonPayload);
      return (
        asNonEmptyString(part.textContent) ??
        asNonEmptyString(payload?.text) ??
        asNonEmptyString(payload?.content) ??
        ""
      );
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractTaskSessionMessageText(message: LoadedTaskSessionMessageRecord) {
  const partText = extractTaskSessionMessageTextFromParts(
    Array.isArray(message.parts) ? message.parts : [],
  );
  if (partText) {
    return partText;
  }

  const rawPayload = asRecord(message.rawPayload);
  const rawParts = Array.isArray(rawPayload?.parts)
    ? rawPayload.parts
        .map((part) => asRecord(part))
        .filter(
          (
            part,
          ): part is Record<string, unknown> & {
            textContent?: string | null;
            jsonPayload?: Record<string, unknown> | null;
          } => Boolean(part),
        )
    : [];
  const rawPartText = extractTaskSessionMessageTextFromParts(rawParts);
  if (rawPartText) {
    return rawPartText;
  }

  return (
    asNonEmptyString(message.textContent) ??
    asNonEmptyString(rawPayload?.text) ??
    asNonEmptyString(rawPayload?.content) ??
    ""
  );
}

function hasDisplayableTaskSessionMessageContent(message: LoadedTaskSessionMessageRecord) {
  return extractTaskSessionMessageText(message).length > 0;
}

function hasStructuredTaskSessionMessageParts(message: LoadedTaskSessionMessageRecord) {
  if (Array.isArray(message.parts) && message.parts.some((part) => Boolean(part))) {
    return true;
  }

  const rawPayload = asRecord(message.rawPayload);
  return Array.isArray(rawPayload?.parts) && rawPayload.parts.some((part) => Boolean(part));
}

function isHydratableTaskSessionMessageShell(message: LoadedTaskSessionMessageRecord) {
  return (
    !hasDisplayableTaskSessionMessageContent(message) &&
    !hasStructuredTaskSessionMessageParts(message)
  );
}

function buildSyntheticTaskSessionTextPart(
  message: LoadedTaskSessionMessageRecord,
  text: string,
): TaskSessionMessagePartRecord {
  return {
    id: `${message.id}:synthetic-text`,
    messageId: message.id,
    partIndex: Array.isArray(message.parts) ? message.parts.length : 0,
    partType: "text",
    textContent: text,
    jsonPayload: {
      type: "text",
      text,
      content: text,
    },
    createdAt:
      asNonEmptyString(message.createdAt) ??
      asNonEmptyString(message.completedAt) ??
      asNonEmptyString(message.startedAt) ??
      null,
  };
}

function hydrateTaskSessionMessageShell(message: LoadedTaskSessionMessageRecord, text: string) {
  const rawPayload = asRecord(message.rawPayload) ?? {};
  const rawInfo = asRecord(rawPayload.info) ?? {};
  const rawTime = asRecord(rawInfo.time) ?? {};
  const existingParts = Array.isArray(message.parts) ? message.parts : [];
  const nextParts =
    extractTaskSessionMessageTextFromParts(existingParts).length > 0
      ? existingParts
      : [...existingParts, buildSyntheticTaskSessionTextPart(message, text)];
  const rawParts = Array.isArray(rawPayload.parts)
    ? rawPayload.parts.filter((part) => Boolean(part))
    : [];

  return {
    ...message,
    textContent: asNonEmptyString(message.textContent) ?? text,
    rawPayload: {
      ...rawPayload,
      ...(asNonEmptyString(rawPayload.text) ? {} : { text }),
      info: {
        ...rawInfo,
        ...(asNonEmptyString(rawInfo.preview) ? {} : { preview: text }),
        time: {
          ...rawTime,
          ...(rawTime.created !== undefined || !asNonEmptyString(message.createdAt)
            ? {}
            : { created: message.createdAt }),
          ...(rawTime.completed !== undefined || !asNonEmptyString(message.completedAt)
            ? {}
            : { completed: message.completedAt }),
        },
      },
      parts:
        rawParts.length > 0
          ? rawParts
          : [
              {
                type: "text",
                text,
                content: text,
              },
            ],
    },
    parts: nextParts,
  } satisfies LoadedTaskSessionMessageRecord;
}

function findHydratableTaskSessionMessageIndex(
  messages: LoadedTaskSessionMessageRecord[],
  role: "user" | "assistant",
  fromEnd = false,
) {
  if (fromEnd) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) {
        continue;
      }

      if (
        extractTaskSessionMessageRole(message) === role &&
        isHydratableTaskSessionMessageShell(message)
      ) {
        return index;
      }
    }
    return -1;
  }

  return messages.findIndex(
    (message) =>
      extractTaskSessionMessageRole(message) === role &&
      isHydratableTaskSessionMessageShell(message),
  );
}

function hydrateTaskConversationShellMessages(args: {
  messages: LoadedTaskSessionMessageRecord[];
  promptText?: string | null;
  task: TaskTreeRecord;
  snapshot?: TaskSessionHydrationSnapshot;
}) {
  const hydrated = [...args.messages];
  const promptText = asNonEmptyString(args.promptText);
  if (promptText) {
    const userIndex = findHydratableTaskSessionMessageIndex(hydrated, "user");
    const userMessage = userIndex >= 0 ? hydrated[userIndex] : undefined;
    if (userMessage) {
      hydrated[userIndex] = hydrateTaskSessionMessageShell(userMessage, promptText);
    }
  }

  const latestResponseText =
    asNonEmptyString(args.snapshot?.latestResult) ??
    asNonEmptyString(args.snapshot?.latestResultSummary) ??
    asNonEmptyString(args.task.result) ??
    asNonEmptyString(args.task.latestResultSummary);
  if (latestResponseText) {
    const assistantIndex = findHydratableTaskSessionMessageIndex(hydrated, "assistant", true);
    const assistantMessage = assistantIndex >= 0 ? hydrated[assistantIndex] : undefined;
    if (assistantMessage) {
      hydrated[assistantIndex] = hydrateTaskSessionMessageShell(
        assistantMessage,
        latestResponseText,
      );
    }
  }

  return hydrated;
}

function buildSyntheticRootPromptMessage(args: {
  taskId: string;
  sessionId: string;
  promptText: string;
  createdAt: string | null;
}) {
  const messageId = `${args.sessionId}:synthetic-root-prompt`;
  const textPart = buildSyntheticTaskSessionTextPart(
    {
      id: messageId,
      sessionId: args.sessionId,
      taskId: args.taskId,
      projectId: null,
      runtimeMessageId: `${messageId}:runtime`,
      role: "user",
      status: "completed",
      clientMessageId: null,
      providerMessageId: null,
      messageIndex: -1,
      textContent: args.promptText,
      summaryText: args.promptText,
      rawPayload: {
        info: {
          id: `${messageId}:runtime`,
          role: "user",
          preview: args.promptText,
          time: {
            created: args.createdAt,
          },
        },
      },
      tokenUsed: null,
      startedAt: args.createdAt,
      completedAt: args.createdAt,
      errorText: null,
      agent: null,
      model: null,
      userInputText: null,
      systemContextText: null,
      finalSentText: null,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
      parts: [],
    },
    args.promptText,
  );

  return {
    id: messageId,
    sessionId: args.sessionId,
    taskId: args.taskId,
    projectId: null,
    runtimeMessageId: `${messageId}:runtime`,
    role: "user",
    status: "completed",
    clientMessageId: null,
    providerMessageId: null,
    messageIndex: -1,
    textContent: args.promptText,
    summaryText: args.promptText,
    rawPayload: {
      info: {
        id: `${messageId}:runtime`,
        role: "user",
        preview: args.promptText,
        time: {
          created: args.createdAt,
        },
      },
      text: args.promptText,
      parts: [
        {
          type: "text",
          text: args.promptText,
          content: args.promptText,
        },
      ],
    },
    tokenUsed: null,
    startedAt: args.createdAt,
    completedAt: args.createdAt,
    errorText: null,
    agent: null,
    model: null,
    userInputText: null,
    systemContextText: null,
    finalSentText: null,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
    parts: [textPart],
  } satisfies LoadedTaskSessionMessageRecord;
}

function ensureRootPromptMessage(args: {
  messages: LoadedTaskSessionMessageRecord[];
  task: TaskTreeRecord;
  sessionId: string;
  isRootSession: boolean;
}) {
  if (!args.isRootSession) {
    return args.messages;
  }

  const promptText = asNonEmptyString(args.task.prompt);
  if (!promptText) {
    return args.messages;
  }

  const normalizePromptEquivalenceText = (value: string) => value.replace(/\s+/g, " ").trim();
  const normalizedPromptText = normalizePromptEquivalenceText(promptText);

  const hasPromptEquivalentUserMessage = args.messages.some((message) => {
    if (extractTaskSessionMessageRole(message) !== "user") {
      return false;
    }

    const messageText = extractTaskSessionMessageText(message);
    if (!messageText) {
      return false;
    }

    const normalizedMessageText = normalizePromptEquivalenceText(messageText);
    if (!normalizedPromptText) {
      return true;
    }

    if (messageText.trim().startsWith("Execution context:")) {
      return false;
    }

    return normalizedMessageText === normalizedPromptText;
  });
  if (hasPromptEquivalentUserMessage) {
    return args.messages;
  }

  const syntheticPrompt = buildSyntheticRootPromptMessage({
    taskId: args.task.id,
    sessionId: args.sessionId,
    promptText,
    createdAt: args.task.createdAt ?? null,
  });
  return sortSingleTaskSessionMessageRecords([syntheticPrompt, ...args.messages]);
}

function extractWorkflowTemplateId(task: TaskTreeRecord) {
  const strategy = asRecord(task.strategy);
  return (
    asNonEmptyString(strategy?.workflowTemplateId) ??
    asNonEmptyString(strategy?.selectedTemplateId) ??
    null
  );
}

function extractWorkflowStageKey(args: {
  selectedSessionId: string | null;
  scopedSessions: Array<{
    id: string;
    workflowStageKey?: string | null;
    createdAt?: string | null;
  }>;
  scopedRuns: Array<{
    sessionId?: string | null;
    workflowStageKey?: string | null;
    createdAt?: string | null;
  }>;
  task: TaskTreeRecord;
}) {
  const selectedSession = args.selectedSessionId
    ? (args.scopedSessions.find((session) => session.id === args.selectedSessionId) ?? null)
    : null;
  const latestRun = [...args.scopedRuns]
    .sort((left, right) =>
      String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")),
    )
    .at(-1);
  const strategy = asRecord(args.task.strategy);
  return (
    asNonEmptyString(selectedSession?.workflowStageKey) ??
    asNonEmptyString(latestRun?.workflowStageKey) ??
    asNonEmptyString(strategy?.currentStage) ??
    null
  );
}

function formatWorkflowStageLabel(stageKey: string | null) {
  if (!stageKey) {
    return null;
  }

  return stageKey
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function inferWorkflowApprovalState(taskStatus?: string | null) {
  if (taskStatus === "paused" || taskStatus === "waiting-approval") {
    return "pending";
  }

  return "not-required";
}

function summarizeOperationPayload(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => summarizeOperationPayload(entry))
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join(" | ");
  }

  if (typeof value === "object") {
    const record = asRecord(value);
    if (!record) {
      return null;
    }

    return Object.entries(record)
      .map(([key, entry]) => {
        const summarized = summarizeOperationPayload(entry);
        return summarized ? `${key}: ${summarized}` : null;
      })
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join(" | ");
  }

  return null;
}

function extractTaskTreeMessageParentId(message: LoadedTaskSessionMessageRecord) {
  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  return asNonEmptyString(rawPayload?.parentID) ?? asNonEmptyString(rawInfo?.parentID) ?? null;
}

function extractTaskTreeMessageRunId(
  message: LoadedTaskSessionMessageRecord,
  runs: Array<{ id: string; sessionId?: string | null }>,
) {
  if (extractTaskSessionMessageRole(message) === "user") {
    return null;
  }

  const sessionRuns = runs.filter((run) => run.sessionId === message.sessionId);
  return sessionRuns.at(-1)?.id ?? null;
}

function isFallbackTaskOperationPart(
  part: TaskSessionMessagePartRecord | undefined,
): part is TaskSessionMessagePartRecord & {
  id: string;
  partType: "tool_call" | "tool_result";
} {
  return Boolean(part?.id) && (part?.partType === "tool_call" || part?.partType === "tool_result");
}

function resolveFallbackOperationToolName(payload: Record<string, unknown>) {
  return (
    asNonEmptyString(payload.name) ??
    asNonEmptyString(payload.tool) ??
    asNonEmptyString(asRecord(payload.toolCall)?.name) ??
    asNonEmptyString(asRecord(payload.toolCall)?.tool) ??
    asNonEmptyString(asRecord(payload.metadata)?.toolName) ??
    "tool"
  );
}

function resolveFallbackOperationExecutionStatus(
  operationKind: "tool_call" | "tool_result",
  payload: Record<string, unknown>,
) {
  if (operationKind !== "tool_result") {
    return "complete";
  }

  return asNonEmptyString(asRecord(payload.state)?.status) ?? "complete";
}

function resolveFallbackOperationOutputText(
  operationKind: "tool_call" | "tool_result",
  payload: Record<string, unknown>,
  part: TaskSessionMessagePartRecord,
) {
  if (operationKind !== "tool_result") {
    return null;
  }

  return (
    asNonEmptyString(asRecord(payload.state)?.output) ??
    asNonEmptyString(payload.output) ??
    asNonEmptyString(payload.text) ??
    asNonEmptyString(part.textContent)
  );
}

function resolveFallbackOperationErrorText(
  operationKind: "tool_call" | "tool_result",
  payload: Record<string, unknown>,
) {
  if (operationKind !== "tool_result") {
    return null;
  }

  return asNonEmptyString(asRecord(payload.state)?.error) ?? asNonEmptyString(payload.error);
}

function resolveFallbackOperationArgumentsSummary(
  operationKind: "tool_call" | "tool_result",
  payload: Record<string, unknown>,
) {
  if (operationKind !== "tool_call") {
    return null;
  }

  return summarizeOperationPayload(payload.input ?? payload.arguments ?? payload.args);
}

function buildFallbackOperationFromMessagePart(
  message: LoadedTaskSessionMessageRecord,
  part: TaskSessionMessagePartRecord | undefined,
) {
  if (!isFallbackTaskOperationPart(part)) {
    return null;
  }

  const payload = asRecord(part.jsonPayload) ?? {};
  const toolName = resolveFallbackOperationToolName(payload);
  const operationKind = part.partType;

  return {
    id: `fallback-operation:${part.id}`,
    sessionId: message.sessionId,
    taskId: message.taskId,
    projectId: message.projectId,
    messageId: message.id,
    runtimeOperationId: asNonEmptyString(payload.callId) ?? asNonEmptyString(payload.id) ?? part.id,
    operationIndex: part.partIndex,
    operationKind,
    executorKey: toolName,
    executorLabel: toolName,
    providerId: null,
    modelId: null,
    executionStatus: resolveFallbackOperationExecutionStatus(operationKind, payload),
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    outputText: resolveFallbackOperationOutputText(operationKind, payload, part),
    errorText: resolveFallbackOperationErrorText(operationKind, payload),
    metadataJson: {
      source: "message-part-fallback",
      messageId: message.id,
      partId: part.id,
      partType: part.partType,
      toolName,
      argumentsSummary: resolveFallbackOperationArgumentsSummary(operationKind, payload),
      rawPart: payload,
    },
    summaryJson: {
      source: "message-part-fallback",
      messageId: message.id,
      partId: part.id,
      partType: part.partType,
    },
    startedAt: message.startedAt,
    finishedAt: message.completedAt ?? message.updatedAt,
    createdAt: part.createdAt ?? message.createdAt,
    updatedAt: message.updatedAt,
  };
}

type FallbackTaskSessionOperationRecord = Exclude<
  ReturnType<typeof buildFallbackOperationFromMessagePart>,
  null
>;

function buildFallbackOperationsFromMessageParts(
  messages: LoadedTaskSessionMessageRecord[],
): FallbackTaskSessionOperationRecord[] {
  return messages.flatMap((message) => {
    const parts = Array.isArray(message.parts) ? message.parts : [];
    return parts
      .map((part) => buildFallbackOperationFromMessagePart(message, part))
      .filter((operation): operation is FallbackTaskSessionOperationRecord => Boolean(operation));
  });
}

async function loadTaskWorkflowFacts(taskId: string) {
  let workflowRuns = await loadTaskWorkflowRuns(taskId);
  let latestWorkflowRun = workflowRuns.at(-1) ?? null;

  if (!latestWorkflowRun) {
    await ensureTaskWorkflowFactsAvailable(taskId);
    workflowRuns = await loadTaskWorkflowRuns(taskId);
    latestWorkflowRun = workflowRuns.at(-1) ?? null;
  }

  if (!latestWorkflowRun) {
    return { workflowRun: null, stages: [], roleConclusions: [] };
  }

  const [stages, conclusions] = await Promise.all([
    db
      .select()
      .from(taskStageRuns)
      .where(eq(taskStageRuns.workflowRunId, latestWorkflowRun.id))
      .orderBy(asc(taskStageRuns.createdAt)),
    db
      .select()
      .from(roleAggregateConclusions)
      .where(eq(roleAggregateConclusions.taskId, taskId))
      .orderBy(asc(roleAggregateConclusions.createdAt)),
  ]);

  return {
    workflowRun: latestWorkflowRun,
    stages,
    roleConclusions: conclusions,
  };
}

function extractTaskSessionMessageIdentity(message: TaskSessionMessageRecord) {
  return (typeof message.runtimeMessageId === "string" && message.runtimeMessageId.trim()) || message.id;
}

function extractTaskSessionMessageRuntimeSessionId(message: TaskSessionMessageRecord) {
  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  return (
    asNonEmptyString(rawInfo?.sessionID) ??
    asNonEmptyString(rawInfo?.sessionId) ??
    asNonEmptyString(rawPayload?.sessionID) ??
    asNonEmptyString(rawPayload?.sessionId) ??
    null
  );
}

function resolveTaskSessionMessageToolCallIdentity(message: TaskSessionMessageRecord) {
  if (extractTaskSessionMessageRole(message) !== "tool") {
    return null;
  }

  const runtimeSessionId = extractTaskSessionMessageRuntimeSessionId(message);
  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  const rawInfoTool = asRecord(rawInfo?.tool);
  const rawPart = asRecord(rawPayload?.part);
  const rawPayloadParts = Array.isArray(rawPayload?.parts)
    ? rawPayload.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
  const persistedParts = Array.isArray(message.parts)
    ? message.parts
        .map((part) => asRecord(part.jsonPayload))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];

  return resolveTaskToolIdentity({
    runtimeSessionId,
    identitySources: [rawPart, rawInfoTool, ...persistedParts, ...rawPayloadParts],
    runtimeCandidates: [
      asNonEmptyString(message.runtimeMessageId),
      asNonEmptyString(rawInfo?.id),
      asNonEmptyString(rawPayload?.id),
    ],
  });
}

function countTaskSessionMessageParts(message: TaskSessionMessageRecord) {
  if (Array.isArray(message.parts) && message.parts.length > 0) {
    return message.parts.length;
  }

  const rawPayload = asRecord(message.rawPayload);
  return Array.isArray(rawPayload?.parts) ? rawPayload.parts.filter((part) => Boolean(part)).length : 0;
}

function normalizeTaskSessionMessageComparableText(text: string) {
  return text.replace(/\s+/gu, " ").trim();
}

function resolveTaskSessionMessageSemanticDuplicateKey(message: TaskSessionMessageRecord) {
  const role = extractTaskSessionMessageRole(message);
  if (role === "tool") {
    const sessionId = asNonEmptyString(message.sessionId);
    const toolCallIdentity = resolveTaskSessionMessageToolCallIdentity(message);
    if (!sessionId || !toolCallIdentity) {
      return null;
    }

    return `${sessionId}::tool::${toolCallIdentity}`;
  }

  if (role !== "assistant") {
    return null;
  }

  const sessionId = asNonEmptyString(message.sessionId);
  const sortTime = resolveTaskSessionMessageSortTime(message);
  const normalizedText = normalizeTaskSessionMessageComparableText(
    extractTaskSessionMessageText(message),
  );
  if (!sessionId || sortTime == null || !normalizedText) {
    return null;
  }

  return `${sessionId}::assistant::${sortTime}::${normalizedText}`;
}

function resolveTaskSessionMessageRichness(message: TaskSessionMessageRecord) {
  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  const summaryBonus = asNonEmptyString(message.summaryText) ? 100 : 0;
  const previewBonus = asNonEmptyString(rawInfo?.preview) ? 10 : 0;
  const textLength = extractTaskSessionMessageText(message).length;
  return countTaskSessionMessageParts(message) * 1000 + summaryBonus + previewBonus + textLength;
}

function resolveTaskSessionMessageStatePriority(message: TaskSessionMessageRecord) {
  switch (asNonEmptyString(message.status)) {
    case "completed":
      return 3;
    case "error":
    case "failed":
    case "cancelled":
      return 2;
    case "streaming":
    case "running":
      return 1;
    case "pending":
      return 0;
    default:
      return -1;
  }
}

function mergeTaskSessionDuplicateMessages(
  existing: TaskSessionMessageRecord,
  candidate: TaskSessionMessageRecord,
) {
  const existingText = extractTaskSessionMessageText(existing);
  const candidateText = extractTaskSessionMessageText(candidate);
  const existingStatePriority = resolveTaskSessionMessageStatePriority(existing);
  const candidateStatePriority = resolveTaskSessionMessageStatePriority(candidate);
  const preferred =
    candidateStatePriority === existingStatePriority
      ? resolveTaskSessionMessageRichness(candidate) > resolveTaskSessionMessageRichness(existing)
        ? candidate
        : existing
      : candidateStatePriority > existingStatePriority
        ? candidate
        : existing;
  const preferredText = extractTaskSessionMessageText(preferred);
  const longerText =
    candidateText.length > existingText.length
      ? candidateText
      : existingText.length > 0
        ? existingText
        : candidateText;

  if (longerText.length > preferredText.length) {
    return hydrateTaskSessionMessageShell(preferred, longerText);
  }

  return preferred;
}

function dedupeTaskSessionMessageRecords(messages: TaskSessionMessageRecord[]) {
  const seenByIdentity = new Map<string, number>();
  const seenBySemanticKey = new Map<string, number>();
  const deduped: TaskSessionMessageRecord[] = [];

  for (const message of messages) {
    const identity = extractTaskSessionMessageIdentity(message);
    const semanticKey = resolveTaskSessionMessageSemanticDuplicateKey(message);
    const existingIndex = seenByIdentity.get(identity) ??
      (semanticKey ? seenBySemanticKey.get(semanticKey) : undefined);
    if (existingIndex != null) {
      const existing = deduped[existingIndex];
      if (!existing) {
        deduped.push(message);
        seenByIdentity.set(identity, deduped.length - 1);
        if (semanticKey) {
          seenBySemanticKey.set(semanticKey, deduped.length - 1);
        }
        continue;
      }

      const merged = mergeTaskSessionDuplicateMessages(existing, message);
      deduped[existingIndex] = merged;
      seenByIdentity.set(identity, existingIndex);
      seenByIdentity.set(extractTaskSessionMessageIdentity(existing), existingIndex);
      seenByIdentity.set(extractTaskSessionMessageIdentity(merged), existingIndex);
      if (semanticKey) {
        seenBySemanticKey.set(semanticKey, existingIndex);
      }
      const mergedSemanticKey = resolveTaskSessionMessageSemanticDuplicateKey(merged);
      if (mergedSemanticKey) {
        seenBySemanticKey.set(mergedSemanticKey, existingIndex);
      }
      continue;
    }
    seenByIdentity.set(identity, deduped.length);
    if (semanticKey) {
      seenBySemanticKey.set(semanticKey, deduped.length);
    }
    deduped.push(message);
  }

  return deduped;
}

function resolveTaskSessionMessageSortTime(message: TaskSessionMessageRecord) {
  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  const rawTime = asRecord(rawInfo?.time);
  const candidates = [
    message.createdAt,
    rawTime?.created,
    message.startedAt,
    rawTime?.started,
    message.completedAt,
    rawTime?.completed,
  ];

  for (const candidate of candidates) {
    const value = asNonEmptyString(candidate);
    if (!value) {
      continue;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function resolveTaskSessionMessageRolePriority(message: TaskSessionMessageRecord) {
  switch (extractTaskSessionMessageRole(message)) {
    case "user":
      return 0;
    case "assistant":
      return 1;
    case "tool":
      return 2;
    default:
      return 3;
  }
}

function sortSingleTaskSessionMessageRecords(
  messages: TaskSessionMessageRecord[],
) {
  return messages
    .map((message, index) => ({
      message,
      index,
      sortTime: resolveTaskSessionMessageSortTime(message),
      rolePriority: resolveTaskSessionMessageRolePriority(message),
      messageIndex:
        typeof message.messageIndex === "number" && Number.isFinite(message.messageIndex)
          ? message.messageIndex
          : Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => {
      if (left.sortTime != null && right.sortTime != null && left.sortTime !== right.sortTime) {
        return left.sortTime - right.sortTime;
      }

      if (left.sortTime != null && right.sortTime == null) {
        return -1;
      }

      if (left.sortTime == null && right.sortTime != null) {
        return 1;
      }

      if (left.rolePriority !== right.rolePriority) {
        return left.rolePriority - right.rolePriority;
      }

      if (left.messageIndex !== right.messageIndex) {
        return left.messageIndex - right.messageIndex;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.message);
}

function sortTaskSessionMessageRecordsForSessionRead(
  messages: TaskSessionMessageRecord[],
) {
  return messages
    .map((message, index) => ({
      message,
      index,
      messageIndex:
        typeof message.messageIndex === "number" && Number.isFinite(message.messageIndex)
          ? message.messageIndex
          : Number.MAX_SAFE_INTEGER,
      createdAt: Date.parse(message.createdAt ?? ""),
    }))
    .sort((left, right) => {
      if (left.messageIndex !== right.messageIndex) {
        return left.messageIndex - right.messageIndex;
      }

      const leftCreatedAt = Number.isNaN(left.createdAt) ? Number.MAX_SAFE_INTEGER : left.createdAt;
      const rightCreatedAt = Number.isNaN(right.createdAt)
        ? Number.MAX_SAFE_INTEGER
        : right.createdAt;
      if (leftCreatedAt !== rightCreatedAt) {
        return leftCreatedAt - rightCreatedAt;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.message);
}

function sortTaskSessionMessageRecordsChronologically(
  messages: LoadedTaskSessionMessageRecord[],
  sessionIds: string[],
) {
  const sessionOrder = new Map(sessionIds.map((sessionId, index) => [sessionId, index] as const));

  return messages.slice().sort((left, right) => {
    const leftSortTime = resolveTaskSessionMessageSortTime(left);
    const rightSortTime = resolveTaskSessionMessageSortTime(right);
    if (leftSortTime != null && rightSortTime != null && leftSortTime !== rightSortTime) {
      return leftSortTime - rightSortTime;
    }
    if (leftSortTime == null && rightSortTime != null) {
      return 1;
    }
    if (leftSortTime != null && rightSortTime == null) {
      return -1;
    }

    const leftSessionIndex = sessionOrder.get(left.sessionId ?? "") ?? Number.MAX_SAFE_INTEGER;
    const rightSessionIndex = sessionOrder.get(right.sessionId ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (leftSessionIndex !== rightSessionIndex) {
      return leftSessionIndex - rightSessionIndex;
    }

    const leftRolePriority = resolveTaskSessionMessageRolePriority(left);
    const rightRolePriority = resolveTaskSessionMessageRolePriority(right);
    if (leftRolePriority !== rightRolePriority) {
      return leftRolePriority - rightRolePriority;
    }

    const leftMessageIndex =
      typeof left.messageIndex === "number" ? left.messageIndex : Number.MAX_SAFE_INTEGER;
    const rightMessageIndex =
      typeof right.messageIndex === "number" ? right.messageIndex : Number.MAX_SAFE_INTEGER;
    if (leftMessageIndex !== rightMessageIndex) {
      return leftMessageIndex - rightMessageIndex;
    }

    return left.id.localeCompare(right.id);
  });
}

function sliceTaskSessionMessagesForLineageBoundary(
  messages: LoadedTaskSessionMessageRecord[],
  childRecord:
    | {
        sourceMessageId?: string | null;
        forkedFromMessageId?: string | null;
      }
    | undefined,
) {
  const boundaryMessageId =
    asNonEmptyString(childRecord?.sourceMessageId) ??
    asNonEmptyString(childRecord?.forkedFromMessageId);
  if (!boundaryMessageId) {
    return messages;
  }

  const boundaryIndex = messages.findIndex(
    (message) => message.id === boundaryMessageId || message.runtimeMessageId === boundaryMessageId,
  );
  if (boundaryIndex < 0) {
    return messages;
  }

  return messages.slice(0, boundaryIndex + 1);
}

function resolveTaskSessionSelection(args: {
  requestedSessionId?: string | null;
  includeLineage: boolean;
  sessions: Array<{
    id: string;
    runtimeSessionId?: string | null;
    parentSessionId?: string | null;
  }>;
  currentSessionId?: string | null;
}) {
  const normalizedRequestedSessionId = resolveTaskSessionRecordId(
    args.sessions,
    args.requestedSessionId,
  );
  const currentSessionId = resolveCurrentTaskSessionId(args.sessions, args.currentSessionId);
  const latestSessionId = resolveLatestTaskSessionId(args.sessions);

  if (args.requestedSessionId && !normalizedRequestedSessionId) {
    return {
      ok: false as const,
      status: 404 as const,
      error: "Task session not found",
    };
  }

  const selectedSessionId =
    normalizedRequestedSessionId ?? currentSessionId ?? latestSessionId ?? null;
  const lineagePath = selectedSessionId
    ? args.includeLineage
      ? buildTaskSessionLineagePath(args.sessions, selectedSessionId)
      : [selectedSessionId]
    : [];

  return {
    ok: true as const,
    currentSessionId,
    latestSessionId,
    selectedSessionId,
    lineagePath,
  };
}

async function loadTaskSessionOperationsInternal(taskId: string, sessionId: string) {
  const operations = await db
    .select()
    .from(taskOperations)
    .where(and(eq(taskOperations.taskId, taskId), eq(taskOperations.sessionId, sessionId)))
    .orderBy(asc(taskOperations.operationIndex), asc(taskOperations.createdAt));

  return operations.map((operation) => ({
    id: operation.id,
    sessionId: operation.sessionId,
    taskId: operation.taskId,
    projectId: null,
    runtimeOperationId: operation.runtimeOperationId,
    operationIndex: operation.operationIndex,
    operationKind:
      operation.operationKind === "model_request" ? "executor" : operation.operationKind,
    executorKey: operation.title ?? operation.operationKind,
    executorLabel: operation.title ?? operation.operationKind,
    providerId: null,
    modelId: null,
    executionStatus:
      operation.status === "completed"
        ? "complete"
        : operation.status === "queued"
          ? "queued"
          : operation.status,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    outputText: null,
    errorText: null,
    metadataJson: operation.summaryJson,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  }));
}

async function loadTaskSessionArtifactsInternal(taskId: string, sessionId: string) {
  return db
    .select()
    .from(taskArtifacts)
    .where(and(eq(taskArtifacts.taskId, taskId), eq(taskArtifacts.sessionId, sessionId)))
    .orderBy(asc(taskArtifacts.createdAt));
}

async function loadTaskUsageLedgerEntriesInternal(taskId: string, sessionId?: string | null) {
  const filters = [eq(taskUsageLedgerEntries.taskId, taskId)];
  if (sessionId) {
    filters.push(eq(taskUsageLedgerEntries.sessionId, sessionId));
  }

  return db
    .select()
    .from(taskUsageLedgerEntries)
    .where(and(...filters))
    .orderBy(asc(taskUsageLedgerEntries.recordedAt), asc(taskUsageLedgerEntries.createdAt));
}

type TaskSessionReadSessionRecord = typeof taskSessions.$inferSelect;
type TaskSessionReadRunRecord = typeof taskSessionRuns.$inferSelect;
type TaskSessionReadOperationRecord = typeof taskOperations.$inferSelect;
type TaskWorkflowFacts = Awaited<ReturnType<typeof loadTaskWorkflowFacts>>;

export function createTaskSessionReadApi(deps: {
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
}) {
  function resolveTaskTreeScopedSessionIds(args: {
    requestedSessionId?: string | null;
    includeLineage: boolean;
    lineagePath: string[];
    sessions: TaskSessionReadSessionRecord[];
  }) {
    return args.requestedSessionId || args.includeLineage === false
      ? args.lineagePath
      : args.sessions.map((session) => session.id);
  }

  async function loadScopedTaskSessionRuns(taskId: string, sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return [] as TaskSessionReadRunRecord[];
    }

    return db
      .select()
      .from(taskSessionRuns)
      .where(
        and(eq(taskSessionRuns.taskId, taskId), inArray(taskSessionRuns.sessionId, sessionIds)),
      )
      .orderBy(asc(taskSessionRuns.createdAt));
  }

  async function loadScopedTaskSessionOperations(taskId: string, sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return [] as TaskSessionReadOperationRecord[];
    }

    return db
      .select()
      .from(taskOperations)
      .where(and(eq(taskOperations.taskId, taskId), inArray(taskOperations.sessionId, sessionIds)))
      .orderBy(asc(taskOperations.createdAt), asc(taskOperations.operationIndex));
  }

  async function loadScopedTaskSessionArtifacts(taskId: string, sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return [] as (typeof taskArtifacts.$inferSelect)[];
    }

    return db
      .select()
      .from(taskArtifacts)
      .where(and(eq(taskArtifacts.taskId, taskId), inArray(taskArtifacts.sessionId, sessionIds)))
      .orderBy(asc(taskArtifacts.createdAt));
  }

  async function loadScopedTaskTreeMessages(args: {
    taskId: string;
    sessionIds: string[];
    sessions: TaskSessionReadSessionRecord[];
    task: TaskTreeRecord;
    snapshot: TaskSessionHydrationSnapshot;
  }) {
    if (args.sessionIds.length === 0) {
      return [] as LoadedTaskSessionMessageRecord[];
    }

    const records = await Promise.all(
      args.sessionIds.map(async (sessionId) => {
        const session = args.sessions.find((record) => record.id === sessionId) ?? null;
        const loadedMessages = await loadTaskSessionMessagesInternal(args.taskId, sessionId);
        const promptReadyMessages = ensureRootPromptMessage({
          messages: loadedMessages,
          task: args.task,
          sessionId,
          isRootSession: session?.parentSessionId == null,
        });
        const hydratedMessages = hydrateTaskConversationShellMessages({
          messages: promptReadyMessages,
          promptText: session?.parentSessionId ? null : args.task.prompt,
          task: args.task,
          snapshot: args.snapshot,
        });
        return sortSingleTaskSessionMessageRecords(hydratedMessages);
      }),
    );

    return records.flat();
  }

  function resolveTaskTreeMessages(args: {
    taskId: string;
    task: TaskTreeRecord;
    scopedSessionMessages: LoadedTaskSessionMessageRecord[];
  }) {
    const messagesWithRootPrompt =
      args.scopedSessionMessages.length === 0
        ? ensureRootPromptMessage({
            messages: [],
            task: args.task,
            sessionId: `virtual-root-${args.taskId}`,
            isRootSession: true,
          })
        : args.scopedSessionMessages;

      return sortSingleTaskSessionMessageRecords(dedupeTaskSessionMessageRecords(messagesWithRootPrompt));
  }

  function resolveTaskTreeWorkflowContext(args: {
    workflowFacts: TaskWorkflowFacts;
    task: TaskTreeRecord;
    selectedSessionId: string | null;
    scopedSessions: TaskSessionReadSessionRecord[];
    runs: TaskSessionReadRunRecord[];
  }) {
    const workflowStageKey =
      asNonEmptyString(args.workflowFacts.workflowRun?.currentStage) ??
      extractWorkflowStageKey({
        selectedSessionId: args.selectedSessionId,
        scopedSessions: args.scopedSessions,
        scopedRuns: args.runs,
        task: args.task,
      });

    return {
      workflowStageKey,
      workflowTemplateId:
        asNonEmptyString(args.workflowFacts.workflowRun?.templateId) ??
        extractWorkflowTemplateId(args.task),
      currentStageRun:
        args.workflowFacts.stages.find((stage) => stage.stageKey === workflowStageKey) ?? null,
    };
  }

  function resolveTaskTreeRootSessionId(sessions: TaskSessionReadSessionRecord[]) {
    return (
      sessions.find((session) => session.parentSessionId == null)?.id ?? sessions[0]?.id ?? null
    );
  }

  function buildTaskTreeParallelGroups(runs: TaskSessionReadRunRecord[]) {
    const groups = runs
      .filter((run) => typeof run.phaseId === "string" && run.phaseId.length > 0)
      .reduce(
        (result, run) => {
          const key = run.phaseId;
          if (!key) {
            return result;
          }

          const existing = result.get(key) ?? {
            phaseId: key,
            sessionId: run.sessionId,
            executionMode: run.executionKind,
            winnerRunId: null as string | null,
            runIds: [] as string[],
          };
          existing.runIds.push(run.id);
          result.set(key, existing);
          return result;
        },
        new Map<
          string,
          {
            phaseId: string;
            sessionId: string;
            executionMode: string | null;
            winnerRunId: string | null;
            runIds: string[];
          }
        >(),
      );

    return Array.from(groups.values());
  }

  function buildTaskTreeEdges(args: {
    sessions: TaskSessionReadSessionRecord[];
    runs: TaskSessionReadRunRecord[];
    messages: LoadedTaskSessionMessageRecord[];
    operations: Array<Record<string, unknown>>;
  }) {
    return {
      sessionParent: args.sessions
        .filter((session) => session.parentSessionId)
        .map((session) => ({ sessionId: session.id, parentSessionId: session.parentSessionId })),
      sessionSource: args.sessions
        .filter((session) => session.sourceMessageId)
        .map((session) => ({ sessionId: session.id, sourceMessageId: session.sourceMessageId })),
      sessionRun: args.runs.map((run) => ({ sessionId: run.sessionId, runId: run.id })),
      sessionMessage: args.messages.map((message) => ({
        sessionId: message.sessionId,
        messageId: message.id,
      })),
      messageParent: args.messages
        .map((message) => ({
          messageId: message.id,
          parentMessageId: extractTaskTreeMessageParentId(message),
        }))
        .filter((message) => message.parentMessageId),
      messageReply: args.messages
        .map((message) => ({
          messageId: message.id,
          replyToMessageId: extractTaskTreeMessageParentId(message),
        }))
        .filter((message) => message.replyToMessageId),
      runMessage: args.messages
        .map((message) => ({
          runId: extractTaskTreeMessageRunId(message, args.runs),
          messageId: message.id,
        }))
        .filter((message) => message.runId),
      messageOperation: args.operations
        .filter((operation) => operation.messageId)
        .map((operation) => ({ messageId: operation.messageId, operationId: operation.id })),
      operationConsumes: args.operations.flatMap((operation) => {
        const consumed = asRecord(operation.summaryJson)?.consumedOperationIds;
        const consumedIds = Array.isArray(consumed)
          ? consumed.filter(
              (value): value is string => typeof value === "string" && value.length > 0,
            )
          : [];
        return consumedIds.map((consumedOperationId) => ({
          operationId: operation.id,
          consumedOperationId,
        }));
      }),
    };
  }

  function resolveTaskConversationScope(args: {
    requestedSessionId?: string | null;
    includeLineage: boolean;
    sessions: TaskSessionReadSessionRecord[];
    selectedSessionId: string | null;
    lineagePath: string[];
    currentSessionId?: string | null;
  }) {
    const isTaskWideConversation = !args.requestedSessionId && args.includeLineage;
    const sessionScopeIds = isTaskWideConversation
      ? args.sessions.map((session) => session.id)
      : args.lineagePath;
    const sessionsById = new Map(args.sessions.map((session) => [session.id, session] as const));
    const scopeRecords = sessionScopeIds
      .map((sessionId) => sessionsById.get(sessionId))
      .filter((session): session is TaskSessionReadSessionRecord => Boolean(session));

    return {
      isTaskWideConversation,
      sessionScopeIds,
      scopeRecords,
      currentSessionRecordId:
        resolveCurrentTaskSessionId(args.sessions, args.currentSessionId) ??
        args.selectedSessionId ??
        scopeRecords.at(-1)?.id ??
        null,
    };
  }

  async function loadTaskConversationMessageSets(
    taskId: string,
    scopeRecords: TaskSessionReadSessionRecord[],
    sortMode: "timeline" | "session",
  ) {
    return Promise.all(
      scopeRecords.map((record) =>
        loadTaskSessionMessagesInternal(taskId, record.id, { sortMode }),
      ),
    );
  }

  function normalizeTaskConversationMessageSets(args: {
    isTaskWideConversation: boolean;
    messageSets: LoadedTaskSessionMessageRecord[][];
    scopeRecords: TaskSessionReadSessionRecord[];
    currentSessionRecordId: string | null;
    task: TaskTreeRecord;
    snapshot: TaskSessionHydrationSnapshot;
  }) {
    if (!args.isTaskWideConversation) {
      return args.messageSets;
    }

    return args.messageSets.map((messages, index) =>
      hydrateTaskConversationShellMessages({
        messages,
        promptText: args.scopeRecords[index]?.parentSessionId ? null : args.task.prompt,
        task: args.task,
        snapshot:
          args.scopeRecords[index]?.id === args.currentSessionRecordId ? args.snapshot : null,
      }),
    );
  }

  function buildTaskConversationData(args: {
    isTaskWideConversation: boolean;
    normalizedMessageSets: LoadedTaskSessionMessageRecord[][];
    sessionScopeIds: string[];
    scopeRecords: TaskSessionReadSessionRecord[];
    task: TaskTreeRecord;
    snapshot: TaskSessionHydrationSnapshot;
  }) {
    const rawMessages = args.isTaskWideConversation
      ? sortTaskSessionMessageRecordsChronologically(
          args.normalizedMessageSets.flat(),
          args.sessionScopeIds,
        )
      : args.normalizedMessageSets.flatMap((messages, index) =>
          sliceTaskSessionMessagesForLineageBoundary(messages, args.scopeRecords[index + 1]),
        );
    const dedupedMessages = dedupeTaskSessionMessageRecords(rawMessages);

    if (args.isTaskWideConversation) {
      return dedupedMessages;
    }

    return hydrateTaskConversationShellMessages({
      messages: dedupedMessages,
      promptText: args.scopeRecords.some((record) => record.parentSessionId == null)
        ? args.task.prompt
        : null,
      task: args.task,
      snapshot: args.snapshot,
    });
  }

  function asNonNegativeFiniteNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }

    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function resolveLoadedTaskSessionMessagePersistedRevision(
    message: LoadedTaskSessionMessageRecord,
  ) {
    const rawPayload = asRecord(message.rawPayload);
    const rawInfo = asRecord(rawPayload?.info);

    return (
      asNonNegativeFiniteNumber(message.messageIndex) ??
      asNonNegativeFiniteNumber(rawInfo?.messageIndex) ??
      asNonNegativeFiniteNumber(rawPayload?.messageIndex) ??
      asNonNegativeFiniteNumber(rawInfo?.seq) ??
      asNonNegativeFiniteNumber(rawPayload?.seq)
    );
  }

  function resolveLoadedTaskSessionMessagesPersistedThroughRevision(
    messages: LoadedTaskSessionMessageRecord[],
  ) {
    const persistedThroughRevision = messages.reduce((maxRevision, message) => {
      const revision = resolveLoadedTaskSessionMessagePersistedRevision(message);
      if (revision == null) {
        return maxRevision;
      }

      return Math.max(maxRevision, revision);
    }, -1);

    return persistedThroughRevision >= 0 ? persistedThroughRevision : undefined;
  }

  function resolveSelectedTaskSession(
    sessions: TaskSessionReadSessionRecord[],
    selectedSessionId: string | null,
  ) {
    return selectedSessionId
      ? (sessions.find((session) => session.id === selectedSessionId) ?? null)
      : null;
  }

  async function loadTaskExecutionTraceCollections(args: {
    taskId: string;
    selectedSessionId: string | null;
    includeLineage: boolean;
  }) {
    return Promise.all([
      buildTaskSessionTimelineViewResponse({
        taskId: args.taskId,
        sessionId: args.selectedSessionId,
        includeLineage: args.includeLineage,
      }),
      args.selectedSessionId
        ? loadTaskSessionMessagesInternal(args.taskId, args.selectedSessionId, {
            sortMode: "session",
          })
        : Promise.resolve([]),
      args.selectedSessionId
        ? loadTaskSessionOperationsInternal(args.taskId, args.selectedSessionId)
        : Promise.resolve([]),
      args.selectedSessionId
        ? loadTaskSessionArtifactsInternal(args.taskId, args.selectedSessionId)
        : Promise.resolve([]),
      loadTaskUsageLedgerEntriesInternal(args.taskId, args.selectedSessionId),
    ]);
  }

  async function buildTaskTreeResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    const task = await ensureTask(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions, workflowFacts, phases] = await Promise.all([
      loadTaskSnapshot(args.taskId),
      loadTaskSessionRecords(args.taskId),
      loadTaskWorkflowFacts(args.taskId),
      loadTaskExecutionPhaseRecords(args.taskId),
    ]);

    const selection = resolveTaskSessionSelection({
      sessions,
      currentSessionId: snapshot?.currentSessionId,
      requestedSessionId: args.sessionId,
      includeLineage: args.includeLineage,
    });
    if (!selection.ok) {
      return selection;
    }

    const scopedSessionIds = resolveTaskTreeScopedSessionIds({
      requestedSessionId: args.sessionId,
      includeLineage: args.includeLineage,
      lineagePath: selection.lineagePath,
      sessions,
    });

    const [runs, scopedSessionMessages, operations, artifacts] = await Promise.all([
      loadScopedTaskSessionRuns(args.taskId, scopedSessionIds),
      loadScopedTaskTreeMessages({
        taskId: args.taskId,
        sessionIds: scopedSessionIds,
        sessions,
        task,
        snapshot,
      }),
      loadScopedTaskSessionOperations(args.taskId, scopedSessionIds),
      loadScopedTaskSessionArtifacts(args.taskId, scopedSessionIds),
    ]);

    const messages = resolveTaskTreeMessages({
      taskId: args.taskId,
      task,
      scopedSessionMessages,
    });
    const messageParts = messages.flatMap((message) => message.parts ?? []);
    const normalizedOperations =
      operations.length > 0 ? operations : buildFallbackOperationsFromMessageParts(messages);
    const scopedSessions = sessions.filter((session) => scopedSessionIds.includes(session.id));
    const phaseIdsInScope = new Set(
      scopedSessions
        .map((session) => resolveTaskSessionPhaseId(session))
        .filter((phaseId): phaseId is string => Boolean(phaseId)),
    );
    const workflowContext = resolveTaskTreeWorkflowContext({
      workflowFacts,
      task,
      selectedSessionId: selection.selectedSessionId,
      scopedSessions,
      runs,
    });
    const rootSessionId = resolveTaskTreeRootSessionId(sessions);
    const parallelGroups = buildTaskTreeParallelGroups(runs);
    const scopedPhases = phases
      .filter((phase) => phaseIdsInScope.has(phase.id))
      .map((phase) => ({
        id: phase.id,
        parentPhaseId: phase.parentPhaseId,
        phaseIndex: phase.phaseIndex,
        phaseKind: phase.phaseKind,
        triggerType: phase.triggerType,
        status: phase.status,
        resumedFromPhaseId: phase.resumedFromPhaseId,
        anchorSessionId: phase.anchorSessionId,
        anchorMessageId: phase.anchorMessageId,
        coordinationKey: null,
        candidateCount: phase.candidateCount,
        winnerSessionId: phase.winnerSessionId,
        judgeSessionId: phase.judgeSessionId,
        startedAt: phase.startedAt,
        finishedAt: phase.finishedAt,
        createdAt: phase.createdAt,
        updatedAt: phase.updatedAt,
      }));
    const edges = buildTaskTreeEdges({
      sessions,
      runs,
      messages,
      operations: normalizedOperations,
    });

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        meta: {
          contractVersion: "2026-04-01.v2",
          taskId: args.taskId,
          currentSessionId: selection.selectedSessionId,
          rootSessionId,
          generatedAt: new Date().toISOString(),
          incomplete: false,
        },
        task: {
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          status: task.status,
          summary: task.latestResultSummary,
          currentSessionId: selection.selectedSessionId,
          rootSessionId,
          createdAt: task.createdAt,
          updatedAt: task.lastActivityAt ?? task.createdAt,
        },
        workflow: {
          templateId: workflowContext.workflowTemplateId,
          currentStageKey: workflowContext.workflowStageKey,
          currentStageLabel: formatWorkflowStageLabel(workflowContext.workflowStageKey),
          status: asNonEmptyString(workflowFacts.workflowRun?.status) ?? task.status,
          approvalState:
            asNonEmptyString(workflowContext.currentStageRun?.approvalState) ??
            inferWorkflowApprovalState(task.status),
          workflowRun: workflowFacts.workflowRun,
          stages: workflowFacts.stages,
          roleConclusions: workflowFacts.roleConclusions,
        },
        phases: scopedPhases,
        parallelGroups,
        sessions: scopedSessions,
        runs,
        messages,
        messageParts,
        operations: normalizedOperations,
        artifacts,
        edges,
      },
    };
  }

  async function buildTaskTimelineResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    return buildTaskSessionTimelineViewResponse(args);
  }

  async function ensureTask(taskId: string) {
    return deps.loadTaskTreeBackedRecord(taskId);
  }

  async function listTaskSessions(taskId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions, phases] = await Promise.all([
      loadTaskSnapshot(taskId),
      loadTaskSessionRecords(taskId),
      loadTaskExecutionPhaseRecords(taskId),
    ]);
    const selectedModelBySessionId = await loadTaskSessionSelectedModelFallbacks(
      taskId,
      collectMissingTaskSessionModelIds(sessions),
    );
    const hydratedSessions = hydrateTaskSessionSelectedModels(sessions, selectedModelBySessionId);
    const phaseIndexById = new Map(phases.map((phase) => [phase.id, phase.phaseIndex] as const));
    const projectedSessions = orderTaskSessionsByPhase(
      projectPublicTaskSessions(hydratedSessions),
      phaseIndexById,
    );
    const latestSessionId = resolveLatestTaskSessionId(projectedSessions);
    const currentSessionId = resolveCurrentTaskSessionId(
      projectedSessions,
      snapshot?.currentSessionId,
    );
    const currentPhaseId = resolveTaskExecutionPhaseId({
      explicitPhaseId: snapshot?.currentPhaseId,
      phases,
      sessions: projectedSessions,
      sessionId: currentSessionId,
    });
    const latestPhaseId = resolveTaskExecutionPhaseId({
      explicitPhaseId: snapshot?.latestPhaseId,
      phases,
      sessions: projectedSessions,
      sessionId: latestSessionId,
    });

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: projectedSessions,
        meta: {
          readSource: "task-phase-first" as const,
          currentSessionId,
          currentPhaseId,
          latestSessionId,
          latestPhaseId,
          phaseCount: countTaskSessionPhases(projectedSessions),
          sessionCount: projectedSessions.length,
        },
      },
    };
  }

  async function getTaskPhaseView(taskId: string, phaseId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions, phases] = await Promise.all([
      loadTaskSnapshot(taskId),
      loadTaskSessionRecords(taskId),
      loadTaskExecutionPhaseRecords(taskId),
    ]);
    const phase = phases.find((record) => record.id === phaseId) ?? null;
    if (!phase) {
      return { ok: false as const, status: 404 as const, error: "Task phase not found" };
    }

    const selectedModelBySessionId = await loadTaskSessionSelectedModelFallbacks(
      taskId,
      collectMissingTaskSessionModelIds(sessions),
    );
    const hydratedSessions = hydrateTaskSessionSelectedModels(sessions, selectedModelBySessionId);
    const phaseIndexById = new Map(phases.map((record) => [record.id, record.phaseIndex] as const));
    const projectedSessions = orderTaskSessionsByPhase(
      projectPublicTaskSessions(hydratedSessions),
      phaseIndexById,
    );
    const phaseSessions = projectedSessions.filter(
      (session) => resolveTaskSessionPhaseId(session) === phaseId,
    );
    const timelineItemCountsBySessionId = await loadTaskTimelineItemCountsBySessionId(
      taskId,
      phaseSessions.map((session) => session.id),
    );
    const latestSessionId = resolveLatestTaskSessionId(projectedSessions);
    const currentSessionId = resolveCurrentTaskSessionId(
      projectedSessions,
      snapshot?.currentSessionId,
    );
    const currentPhaseId = resolveTaskExecutionPhaseId({
      explicitPhaseId: snapshot?.currentPhaseId,
      phases,
      sessions: projectedSessions,
      sessionId: currentSessionId,
    });
    const latestPhaseId = resolveTaskExecutionPhaseId({
      explicitPhaseId: snapshot?.latestPhaseId,
      phases,
      sessions: projectedSessions,
      sessionId: latestSessionId,
    });
    const messageGroups = await Promise.all(
      phaseSessions.map(async (session) => ({
        taskSessionId: session.id,
        runtimeSessionId: asNonEmptyString(session.runtimeSessionId),
        phaseRole: session.phaseRole ?? null,
        phaseItemIndex:
          typeof session.phaseItemIndex === "number" ? session.phaseItemIndex : null,
        candidateIndex:
          typeof session.candidateIndex === "number" ? session.candidateIndex : null,
        stepIndex: typeof session.stepIndex === "number" ? session.stepIndex : null,
        title: asNonEmptyString(session.title) ?? asNonEmptyString(session.branchName) ?? null,
        selectedModel: asNonEmptyString(session.selectedModel) ?? null,
        executionStatus: asNonEmptyString(session.executionStatus) ?? null,
        timelineMeta: buildTaskPhaseMessageGroupTimelineMeta({
          executionStatus: session.executionStatus,
          itemCount: timelineItemCountsBySessionId.get(session.id) ?? 0,
        }),
        messages: await loadTaskSessionMessagesInternal(taskId, session.id, {
          sortMode: "session",
        }),
      })),
    );

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: {
          phase: buildPublicTaskExecutionPhaseRecord({
            phase,
            sessionIds: phaseSessions.map((session) => session.id),
          }),
          sessions: phaseSessions,
          messageGroups,
          meta: {
            readSource: "task-phase-first" as const,
            currentSessionId,
            currentPhaseId,
            latestSessionId,
            latestPhaseId,
            phaseCount: countTaskSessionPhases(projectedSessions),
            sessionCount: phaseSessions.length,
            messageGroupCount: messageGroups.length,
            messageCount: messageGroups.reduce(
              (count, group) => count + group.messages.length,
              0,
            ),
          },
        },
      },
    };
  }

  async function getTaskSession(taskId: string, sessionId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions, session] = await Promise.all([
      loadTaskSnapshot(taskId),
      loadTaskSessionRecords(taskId),
      loadTaskSessionRecord(taskId, sessionId),
    ]);

    if (!session) {
      return { ok: false as const, status: 404 as const, error: "Task session not found" };
    }

    const selectedModelBySessionId = await loadTaskSessionSelectedModelFallbacks(
      taskId,
      collectMissingTaskSessionModelIds([...sessions, session]),
    );
    const hydratedSessions = hydrateTaskSessionSelectedModels(sessions, selectedModelBySessionId);
    const projectedSessions = projectPublicTaskSessions(hydratedSessions);
    const projectedSession = projectedSessions.find((entry) => entry.id === session.id) ?? null;
    if (!projectedSession) {
      return { ok: false as const, status: 500 as const, error: "Task session projection failed" };
    }
    const latestSessionId = resolveLatestTaskSessionId(projectedSessions);
    const currentSessionId = resolveCurrentTaskSessionId(
      projectedSessions,
      snapshot?.currentSessionId,
    );

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: projectedSession,
        meta: {
          readSource: "task-session-first" as const,
          lineagePath: buildTaskSessionLineagePath(hydratedSessions, sessionId),
          isCurrent: currentSessionId === sessionId,
          isLatest: latestSessionId === sessionId,
        },
      },
    };
  }

  async function listTaskSessionMessages(taskId: string, sessionId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const session = await loadTaskSessionRecord(taskId, sessionId);
    if (!session) {
      return { ok: false as const, status: 404 as const, error: "Task session not found" };
    }

    const [snapshot, rawData] = await Promise.all([
      loadTaskSnapshot(taskId),
      loadTaskSessionMessagesInternal(taskId, sessionId, {
        sortMode: "session",
      }),
    ]);
    const data = hydrateTaskConversationShellMessages({
      messages: rawData,
      promptText: session.parentSessionId ? null : task.prompt,
      task,
      snapshot,
    });
    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-first" as const,
          sessionId,
          messageCount: data.length,
        },
      },
    };
  }

  async function buildTaskConversationMessagesResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    const task = await ensureTask(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions, snapshotVersion] = await Promise.all([
      loadTaskSnapshot(args.taskId),
      loadTaskSessionRecords(args.taskId),
      loadTaskProjectionHeadVersion(args.taskId),
    ]);
    const selection = resolveTaskSessionSelection({
      sessions,
      currentSessionId: snapshot?.currentSessionId,
      requestedSessionId: args.sessionId,
      includeLineage: args.includeLineage,
    });
    if (!selection.ok) {
      return selection;
    }

    const conversationScope = resolveTaskConversationScope({
      requestedSessionId: args.sessionId,
      includeLineage: args.includeLineage,
      sessions,
      selectedSessionId: selection.selectedSessionId,
      lineagePath: selection.lineagePath,
      currentSessionId: snapshot?.currentSessionId,
    });
    const messageSets = await loadTaskConversationMessageSets(
      args.taskId,
      conversationScope.scopeRecords,
      conversationScope.isTaskWideConversation ? "timeline" : "session",
    );
    const normalizedMessageSets = normalizeTaskConversationMessageSets({
      isTaskWideConversation: conversationScope.isTaskWideConversation,
      messageSets,
      scopeRecords: conversationScope.scopeRecords,
      currentSessionRecordId: conversationScope.currentSessionRecordId,
      task,
      snapshot,
    });
    const data = buildTaskConversationData({
      isTaskWideConversation: conversationScope.isTaskWideConversation,
      normalizedMessageSets,
      sessionScopeIds: conversationScope.sessionScopeIds,
      scopeRecords: conversationScope.scopeRecords,
      task,
      snapshot,
    });
    const persistedThroughRevision =
      resolveLoadedTaskSessionMessagesPersistedThroughRevision(data);
    const hasSelectedSession = Boolean(selection.selectedSessionId);

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-first" as const,
          sessionId: selection.selectedSessionId,
          includeLineage: args.includeLineage,
          lineagePath: conversationScope.sessionScopeIds,
          snapshotVersion,
          cachedSessionCount: conversationScope.scopeRecords.length,
          cacheState: hasSelectedSession ? ("complete" as const) : ("none" as const),
          complete: hasSelectedSession,
          itemCount: data.length,
          messageCount: data.length,
          ...(persistedThroughRevision != null ? { persistedThroughRevision } : {}),
        },
      },
    };
  }

  async function buildTaskNormalizedConversationQueryResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    const response = await buildTaskConversationMessagesResponse(args);
    if (!response.ok) {
      return response;
    }

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: response.data.data,
        meta: {
          ...response.data.meta,
          viewType: "normalized-conversation" as const,
          querySurface: "service-direct" as const,
          debugOnly: true,
          deprecated: true,
        },
      },
    };
  }

  async function listTaskSessionOperations(taskId: string, sessionId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const session = await loadTaskSessionRecord(taskId, sessionId);
    if (!session) {
      return { ok: false as const, status: 404 as const, error: "Task session not found" };
    }

    const data = await loadTaskSessionOperationsInternal(taskId, sessionId);
    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-first" as const,
          sessionId,
          operationCount: data.length,
        },
      },
    };
  }

  async function listTaskSessionArtifacts(taskId: string, sessionId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const session = await loadTaskSessionRecord(taskId, sessionId);
    if (!session) {
      return { ok: false as const, status: 404 as const, error: "Task session not found" };
    }

    const data = await loadTaskSessionArtifactsInternal(taskId, sessionId);
    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-first" as const,
          sessionId,
          artifactCount: data.length,
        },
      },
    };
  }

  async function listTaskUsageLedgerEntries(taskId: string, sessionId?: string | null) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    if (sessionId) {
      const session = await loadTaskSessionRecord(taskId, sessionId);
      if (!session) {
        return { ok: false as const, status: 404 as const, error: "Task session not found" };
      }
    }

    const data = await loadTaskUsageLedgerEntriesInternal(taskId, sessionId);
    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-first" as const,
          sessionId: sessionId ?? null,
          entryCount: data.length,
        },
      },
    };
  }

  async function buildTaskSessionTimelineViewResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    const task = await ensureTask(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions, snapshotVersion] = await Promise.all([
      loadTaskSnapshot(args.taskId),
      loadTaskSessionRecords(args.taskId),
      loadTaskProjectionHeadVersion(args.taskId),
    ]);
    const selection = resolveTaskSessionSelection({
      sessions,
      currentSessionId: snapshot?.currentSessionId,
      requestedSessionId: args.sessionId,
      includeLineage: args.includeLineage,
    });
    if (!selection.ok) {
      return selection;
    }

    const sessionsById = new Map(sessions.map((session) => [session.id, session] as const));
    const scopeRecords = selection.lineagePath
      .map((sessionId) => sessionsById.get(sessionId))
      .filter((session): session is TaskSessionReadSessionRecord => Boolean(session));

    const filters = [eq(taskTimelineViews.taskId, args.taskId)];
    if (selection.lineagePath.length > 0) {
      filters.push(inArray(taskTimelineViews.sessionId, selection.lineagePath));
    }

    const [timelineRows, messageSets] = await Promise.all([
      db
        .select({
          id: taskTimelineViews.id,
          taskId: taskTimelineViews.taskId,
          projectId: taskTimelineViews.projectId,
          sessionId: taskTimelineViews.sessionId,
          messageId: taskTimelineViews.messageId,
          operationId: taskTimelineViews.operationId,
          artifactId: taskTimelineViews.artifactId,
          itemKind: taskTimelineViews.itemKind,
          itemRole: taskTimelineViews.itemRole,
          title: taskTimelineViews.title,
          displayText: taskTimelineViews.displayText,
          metadataJson: taskTimelineViews.metadataJson,
          sortAt: taskTimelineViews.sortAt,
          createdAt: taskTimelineViews.createdAt,
          updatedAt: taskTimelineViews.updatedAt,
        })
        .from(taskTimelineViews)
        .where(and(...filters))
        .orderBy(asc(taskTimelineViews.sortAt), asc(taskTimelineViews.createdAt)),
      scopeRecords.length > 0
        ? loadTaskConversationMessageSets(args.taskId, scopeRecords, "timeline")
        : Promise.resolve([] as LoadedTaskSessionMessageRecord[][]),
    ]);

    const data = dedupeTaskToolTimelineRows(timelineRows as TaskTimelineViewRow[], sessions);
    const persistedThroughRevision = resolveLoadedTaskSessionMessagesPersistedThroughRevision(
      messageSets.flat(),
    );

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-projection" as const,
          sessionId: selection.selectedSessionId,
          includeLineage: args.includeLineage,
          lineagePath: selection.lineagePath,
          snapshotVersion,
          itemCount: data.length,
          complete: data.length > 0,
          ...(persistedThroughRevision != null ? { persistedThroughRevision } : {}),
        },
      },
    };
  }

  async function buildTaskExecutionTraceResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    const task = await ensureTask(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions] = await Promise.all([
      loadTaskSnapshot(args.taskId),
      loadTaskSessionRecords(args.taskId),
    ]);
    const selection = resolveTaskSessionSelection({
      sessions,
      currentSessionId: snapshot?.currentSessionId,
      requestedSessionId: args.sessionId,
      includeLineage: args.includeLineage,
    });
    if (!selection.ok) {
      return selection;
    }

    const selectedSessionId = selection.selectedSessionId;
    const selectedSession = resolveSelectedTaskSession(sessions, selectedSessionId);
    const [timeline, messages, operations, artifacts, usageLedger] =
      await loadTaskExecutionTraceCollections({
        taskId: args.taskId,
        selectedSessionId,
        includeLineage: args.includeLineage,
      });

    if (!timeline.ok) {
      return timeline;
    }

    const hydratedMessages = hydrateTaskConversationShellMessages({
      messages,
      promptText: selectedSession?.parentSessionId ? null : task.prompt,
      task,
      snapshot,
    });

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: {
          snapshot: snapshot ?? null,
          sessions,
          selectedSessionId,
          selectedSession,
          timeline: timeline.data.data,
          messages: hydratedMessages,
          operations,
          artifacts,
          usageLedger,
        },
        meta: {
          readSource: "task-session-first" as const,
          timelineReadSource: timeline.data.meta.readSource,
          includeLineage: args.includeLineage,
          lineagePath: timeline.data.meta.lineagePath,
          complete: Boolean(snapshot || sessions.length > 0),
          sessionCount: sessions.length,
          timelineItemCount: timeline.data.meta.itemCount,
        },
      },
    };
  }

  return {
    listTaskSessions,
    getTaskPhaseView,
    getTaskSession,
    buildTaskTreeResponse,
    buildTaskTimelineResponse,
    listTaskSessionMessages,
    buildTaskConversationMessagesResponse,
    buildTaskNormalizedConversationQueryResponse,
    listTaskSessionOperations,
    listTaskSessionArtifacts,
    listTaskUsageLedgerEntries,
    buildTaskSessionTimelineViewResponse,
    buildTaskExecutionTraceResponse,
  };
}
