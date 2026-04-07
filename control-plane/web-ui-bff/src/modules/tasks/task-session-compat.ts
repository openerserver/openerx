// Legacy compatibility barrel.
// Canonical task-session store helpers live in task-session-store.ts.
// Compatibility-only conversation and lineage-fallback reads live in
// task-session-read-compat.ts.

export {
  createProjectionTraceTimelineMeta,
  fetchTaskSessionLineageRecords,
  fetchTaskSessionTimeline,
  normalizeTaskSessionTimelineMeta,
  persistTaskSessionMessageSnapshot,
  shouldReplaceTraceTimeline,
  toCanonicalTaskSessionId,
  upsertTaskSessionLineageRecord,
} from "./task-session-store";
export type {
  TaskSessionCachedMessagesResponse,
  TaskSessionLineageRecord,
  TaskSessionTimelineItem,
  TaskSessionTimelineMeta,
  TaskSessionTimelineReadSource,
  TaskSessionTimelineResponse,
  UpsertTaskSessionLineageInput,
} from "./task-session-store";

export {
  fetchTaskConversationCompatMessages as fetchTaskConversationMessages,
  fetchTaskSessionCachedCompatMessages as fetchTaskSessionCachedMessages,
  resolvePendingParallelCompatSuppressedSessionIds as resolvePendingParallelSuppressedSessionIds,
} from "./task-session-read-compat";
