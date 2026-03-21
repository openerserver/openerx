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

export interface TaskSessionTimelineMeta {
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

export interface TaskSessionTreeMessagesResponse {
  data?: unknown[];
  meta?: TaskSessionTimelineMeta;
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
    lineageResult.ok && Array.isArray(lineageResult.data?.data)
      ? lineageResult.data.data
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
  return cpFetch<TaskSessionTimelineResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/branches/${encodeURIComponent(sessionId)}/timeline${suffix}`,
    { authorization },
  );
}

export async function fetchTaskSessionMessagesFromTreeSource(
  taskId: string,
  sessionId: string,
  authorization: string,
  options?: { includeLineage?: boolean },
) {
  const suffix = options?.includeLineage ? "?includeLineage=true" : "";
  return cpFetch<TaskSessionTreeMessagesResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/branches/${encodeURIComponent(sessionId)}/messages${suffix}`,
    { authorization },
  );
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