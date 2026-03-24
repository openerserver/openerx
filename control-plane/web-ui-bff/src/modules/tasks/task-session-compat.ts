import { cpFetch } from "../../lib/control-plane-client";

export interface TaskSessionLineageRecord {
  id?: string;
  taskId?: string;
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  branchName?: string | null;
  sourceType: string;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
}

export interface UpsertTaskSessionLineageInput {
  runtimeSessionId: string;
  parentRuntimeSessionId?: string;
  forkedFromMessageId?: string;
  branchName?: string;
  sourceType?: "root" | "fork" | "sub_session";
  isActive: boolean;
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
  | "task-domain-projection";

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

export function normalizeTaskSessionTimelineMeta(
  meta?: TaskSessionTimelineMeta,
): TaskSessionTimelineMeta | undefined {
  if (!meta) return undefined;
  return meta;
}

export function createProjectionTraceTimelineMeta(args: {
  meta?: TaskSessionTimelineMeta;
  itemCount: number;
}): TaskSessionTimelineMeta {
  return {
    ...args.meta,
    readSource: "task-domain-projection",
    complete: args.meta?.complete === true && args.itemCount > 0,
  };
}

export function shouldReplaceTraceTimeline(args: {
  currentItemCount: number;
  fallbackItemCount: number;
  projectionComplete?: boolean;
}): boolean {
  return !args.projectionComplete && args.fallbackItemCount >= args.currentItemCount;
}

export async function persistTaskSessionMessageSnapshot(
  taskId: string,
  authorization: string,
  input: {
    runtimeSessionId: string;
    message: unknown;
  },
) {
  return cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/branches/messages`, {
    method: "POST",
    authorization,
    body: {
      runtimeSessionId: input.runtimeSessionId,
      message: input.message,
    },
  });
}

export async function fetchTaskSessionLineageRecords(taskId: string, authorization: string) {
  const lineageResult = await cpFetch<{ data?: TaskSessionLineageRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/branches`,
    { authorization },
  );

  const records =
    lineageResult.ok && Array.isArray(lineageResult.data?.data) ? lineageResult.data.data : [];

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
  return cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/branches`, {
    method: "POST",
    body: {
      runtimeSessionId: input.runtimeSessionId,
      parentRuntimeSessionId: input.parentRuntimeSessionId,
      forkedFromMessageId: input.forkedFromMessageId,
      branchName: input.branchName,
      sourceType: input.sourceType,
      isActive: input.isActive,
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
  const suffix = options?.includeLineage ? "?includeLineage=true" : "";
  const result = await cpFetch<TaskSessionTimelineResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/branches/${encodeURIComponent(sessionId)}/timeline${suffix}`,
    { authorization },
  );
  return {
    ...result,
    data: result.data
      ? {
          ...result.data,
          meta: normalizeTaskSessionTimelineMeta(result.data.meta),
        }
      : result.data,
  };
}

export async function fetchTaskSessionCachedMessages(
  taskId: string,
  sessionId: string,
  authorization: string,
  options?: { includeLineage?: boolean },
) {
  const suffix = options?.includeLineage ? "?includeLineage=true" : "";
  const result = await cpFetch<TaskSessionCachedMessagesResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/branches/${encodeURIComponent(sessionId)}/messages${suffix}`,
    { authorization },
  );
  return {
    ...result,
    data: result.data
      ? {
          ...result.data,
          meta: normalizeTaskSessionTimelineMeta(result.data.meta),
        }
      : result.data,
  };
}

export async function activateTaskSessionLineageByRecordId(
  taskId: string,
  recordId: string,
  authorization: string,
) {
  return cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/branches/${encodeURIComponent(recordId)}/activate`,
    { method: "POST", authorization },
  );
}

export async function archiveTaskSessionLineageByRecordId(
  taskId: string,
  recordId: string,
  authorization: string,
) {
  return cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/branches/${encodeURIComponent(recordId)}/archive`,
    { method: "POST", authorization },
  );
}
