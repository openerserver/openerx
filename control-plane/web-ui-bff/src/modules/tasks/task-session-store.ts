import { cpFetch } from "../../lib/control-plane-client";
import { resolvePublicTaskSessionSourceType } from "./task-session-public-source-type";

// Canonical service-backed task-session helpers.
// Legacy workflow-context shaping and cached message compatibility reads remain
// in task-session-read-compat.ts while mainline callers move here.

export interface TaskSessionLineageRecord {
  id?: string;
  taskId?: string;
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  branchName?: string | null;
  sourceType: string;
  isActive: boolean;
  phaseId?: string | null;
  phaseRole?: string | null;
  phaseItemIndex?: number | null;
  winnerSessionId?: string | null;
  executionStatus?: string | null;
  sessionKind?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  executionModeSnapshot?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
}

export interface UpsertTaskSessionLineageInput {
  runtimeSessionId: string;
  parentRuntimeSessionId?: string;
  forkedFromMessageId?: string;
  branchName?: string;
  sourceType?: "root" | "fork" | "sub_session" | "parallel";
  sessionKind?:
    | "primary"
    | "candidate"
    | "judge"
    | "sequential_step"
    | "resume"
    | "manual_branch"
    | "hook";
  executionModeSnapshot?: "single" | "parallel" | "sequential_chain";
  phaseId?: string;
  phaseRole?: "mainline" | "candidate" | "judge" | "step" | "aux";
  phaseItemIndex?: number;
  isActive: boolean;
  candidateIndex?: number;
  stepIndex?: number;
  selectedModel?: string;
  operationId?: string;
}

export interface TaskSessionTimelineItem {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  completedAt?: string | null;
  raw?: unknown;
  sourceEventTypes?: string[];
}

export type TaskSessionTimelineReadSource =
  | "conversation-table"
  | "task-domain-events"
  | "conversation-table+task-domain-events"
  | "runtime-fallback"
  | "task-domain-projection"
  | "task-session-projection"
  | "task-session-first";

export interface TaskSessionTimelineMeta {
  readSource?: TaskSessionTimelineReadSource;
  cacheState?: "none" | "partial" | "complete";
  complete?: boolean;
  includeLineage?: boolean;
  lineagePath?: string[];
  cachedSessionCount?: number;
  itemCount?: number;
}

export interface TaskSessionTimelineResponse {
  data: TaskSessionTimelineItem[];
  meta?: TaskSessionTimelineMeta;
}

export interface TaskSessionCachedMessagesResponse {
  data?: unknown[];
  meta?: TaskSessionTimelineMeta;
}

type ServiceTaskSessionRecord = {
  id: string;
  taskId?: string;
  sourceType?: string | null;
  parentSessionId?: string | null;
  parentRuntimeSessionId?: string | null;
  phaseId?: string | null;
  phaseRole?: string | null;
  phaseItemIndex?: number | null;
  runtimeSessionId?: string | null;
  forkedFromMessageId?: string | null;
  branchName?: string | null;
  sessionKind?: string | null;
  executionModeSnapshot?: string | null;
  executionStatus?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  winnerSessionId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
};

type ServiceTaskSessionListResponse = {
  data?: ServiceTaskSessionRecord[];
  meta?: {
    currentSessionId?: string | null;
    latestSessionId?: string | null;
  };
};

type ServiceTaskTimelineItem = {
  id: string;
  sessionId?: string | null;
  messageId?: string | null;
  operationId?: string | null;
  artifactId?: string | null;
  itemKind?: string | null;
  itemRole?: string | null;
  role?: string | null;
  title?: string | null;
  displayText?: string | null;
  text?: string | null;
  raw?: Record<string, unknown> | null;
  metadataJson?: Record<string, unknown> | null;
  sortAt?: string;
  createdAt?: string;
};

type ServiceTaskTimelineResponse = {
  data?: ServiceTaskTimelineItem[];
  meta?: TaskSessionTimelineMeta;
};

export function normalizeTaskSessionTimelineMeta(
  meta?: TaskSessionTimelineMeta,
): TaskSessionTimelineMeta | undefined {
  if (!meta) {
    return undefined;
  }
  return meta;
}

export function toCanonicalTaskSessionId(taskId: string, sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }
  if (normalizedSessionId.startsWith("task-session:")) {
    return normalizedSessionId;
  }
  return `task-session:${taskId}:${normalizedSessionId}`;
}

function mapServiceTaskSessionsToLineageRecords(
  sessions: ServiceTaskSessionRecord[],
  currentSessionId?: string | null,
) {
  const byId = new Map(sessions.map((session) => [session.id, session] as const));

  return sessions.map(
    (session) =>
      ({
        id: session.id,
        taskId: session.taskId,
        runtimeSessionId: session.runtimeSessionId ?? session.id,
        parentRuntimeSessionId: session.parentSessionId
          ? (byId.get(session.parentSessionId)?.runtimeSessionId ?? session.parentSessionId)
          : (session.parentRuntimeSessionId ?? null),
        forkedFromMessageId: session.forkedFromMessageId ?? null,
        branchName: session.branchName ?? null,
        sourceType: resolvePublicTaskSessionSourceType({
          sourceType: session.sourceType ?? null,
          sessionKind: session.sessionKind,
          parentSessionId: session.parentSessionId,
          parentRuntimeSessionId: session.parentRuntimeSessionId,
          phaseId: session.phaseId,
          candidateIndex: session.candidateIndex,
          executionModeSnapshot: session.executionModeSnapshot,
        }),
        isActive: currentSessionId
          ? session.id === currentSessionId
          : session.executionStatus === "running" && !session.archivedAt,
        phaseId: session.phaseId ?? null,
        phaseRole: session.phaseRole ?? null,
        phaseItemIndex:
          typeof session.phaseItemIndex === "number" ? session.phaseItemIndex : null,
        winnerSessionId: session.winnerSessionId ?? null,
        executionStatus: session.executionStatus ?? null,
        sessionKind: session.sessionKind ?? null,
        candidateIndex: typeof session.candidateIndex === "number" ? session.candidateIndex : null,
        stepIndex: typeof session.stepIndex === "number" ? session.stepIndex : null,
        selectedModel: session.selectedModel ?? null,
        executionModeSnapshot: session.executionModeSnapshot ?? null,
        createdAt: session.createdAt ?? null,
        updatedAt: session.updatedAt ?? null,
        archivedAt: session.archivedAt ?? null,
      }) satisfies TaskSessionLineageRecord,
  );
}

function mapTimelineRole(item: ServiceTaskTimelineItem) {
  if (item.itemRole) {
    return item.itemRole;
  }
  if (item.role) {
    return item.role;
  }
  if (item.itemKind === "user-input") {
    return "user";
  }
  if (item.itemKind === "assistant-output" || item.itemKind === "thinking") {
    return "assistant";
  }
  if (item.itemKind === "tool-call" || item.itemKind === "tool-output") {
    return "tool";
  }
  return "system";
}

function mapServiceTimelineItems(items: ServiceTaskTimelineItem[]) {
  return items.map(
    (item) =>
      ({
        id: item.messageId || item.operationId || item.artifactId || item.id,
        role: mapTimelineRole(item),
        text: item.displayText || item.title || item.text || "",
        createdAt: item.createdAt,
        completedAt: item.sortAt ?? null,
        raw: {
          ...(item.raw ?? {}),
          projection: true,
          sessionId: item.sessionId ?? null,
          messageId: item.messageId ?? null,
          operationId: item.operationId ?? null,
          artifactId: item.artifactId ?? null,
          itemKind: item.itemKind,
          itemRole: item.itemRole ?? null,
          legacyRole: item.role ?? null,
          title: item.title ?? null,
          displayText: item.displayText ?? null,
          legacyText: item.text ?? null,
          metadata: item.metadataJson ?? null,
        },
        sourceEventTypes: [`projection:${item.itemKind ?? item.role ?? "unknown"}`],
      }) satisfies TaskSessionTimelineItem,
  );
}

async function resolvePersistedTaskSessionId(
  taskId: string,
  sessionId: string,
  authorization: string,
) {
  const canonicalSessionId = toCanonicalTaskSessionId(taskId, sessionId);
  if (!canonicalSessionId) {
    return null;
  }

  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  if (lineageResult.ok) {
    const record = lineageResult.records.find(
      (item) => item.id === sessionId || item.runtimeSessionId === sessionId,
    );
    if (record?.id) {
      return record.id;
    }
  }

  return canonicalSessionId;
}

export function createProjectionTraceTimelineMeta(args: {
  meta?: TaskSessionTimelineMeta;
  itemCount: number;
}): TaskSessionTimelineMeta {
  return {
    ...args.meta,
    readSource: "task-session-projection",
    complete: args.meta?.complete === true && args.itemCount > 0,
  };
}

export function shouldReplaceTraceTimeline(args: {
  currentItemCount: number;
  fallbackItemCount: number;
  projectionComplete?: boolean;
}): boolean {
  return args.currentItemCount === 0 && args.fallbackItemCount > 0;
}

export async function persistTaskSessionMessageSnapshot(
  taskId: string,
  authorization: string,
  input: {
    runtimeSessionId: string;
    message: unknown;
  },
) {
  return cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/sessions/messages`, {
    method: "POST",
    authorization,
    body: {
      runtimeSessionId: input.runtimeSessionId,
      message: input.message,
    },
  });
}

export async function fetchTaskSessionLineageRecords(taskId: string, authorization: string) {
  const lineageResult = await cpFetch<ServiceTaskSessionListResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/sessions`,
    { authorization },
  );

  const records =
    lineageResult.ok && Array.isArray(lineageResult.data?.data)
      ? mapServiceTaskSessionsToLineageRecords(
          lineageResult.data.data,
          lineageResult.data.meta?.currentSessionId,
        )
      : [];

  return {
    ok: lineageResult.ok,
    status: lineageResult.status,
    records,
    activeRecords: records.filter((record) => !record.archivedAt),
  };
}

export async function upsertTaskSessionLineageRecord(
  taskId: string,
  authorization: string,
  input: UpsertTaskSessionLineageInput,
) {
  return cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/sessions`, {
    method: "POST",
    body: {
      runtimeSessionId: input.runtimeSessionId,
      parentRuntimeSessionId: input.parentRuntimeSessionId,
      forkedFromMessageId: input.forkedFromMessageId,
      branchName: input.branchName,
      sourceType: input.sourceType,
      sessionKind: input.sessionKind,
      executionModeSnapshot: input.executionModeSnapshot,
      phaseId: input.phaseId,
      phaseRole: input.phaseRole,
      phaseItemIndex: input.phaseItemIndex,
      isActive: input.isActive,
      candidateIndex: input.candidateIndex,
      stepIndex: input.stepIndex,
      selectedModel: input.selectedModel,
      operationId: input.operationId,
    },
    authorization,
  });
}

export async function fetchTaskSessionTimeline(
  taskId: string,
  sessionId: string,
  authorization: string,
  options?: { includeLineage?: boolean },
) {
  const persistedSessionId = await resolvePersistedTaskSessionId(taskId, sessionId, authorization);
  if (!persistedSessionId) {
    return {
      ok: false as const,
      status: 404,
      data: undefined,
      error: "Task session not found",
    };
  }

  const suffix = options?.includeLineage ? "?includeLineage=true" : "";
  const result = await cpFetch<ServiceTaskTimelineResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/sessions/${encodeURIComponent(persistedSessionId)}/timeline${suffix}`,
    { authorization },
  );
  return {
    ...result,
    data: result.data
      ? {
          data: Array.isArray(result.data.data) ? mapServiceTimelineItems(result.data.data) : [],
          meta: normalizeTaskSessionTimelineMeta(result.data.meta),
        }
      : undefined,
  };
}