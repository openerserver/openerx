import type { TaskMessagePatchEvent } from "./task-message-patch-event";

export type TaskMessagePatchEffects = {
  updatesLiveAssistantState: boolean;
  shouldRefreshCanonicalMessages: boolean;
  shouldRefreshTaskDetailMessages: boolean;
  shouldScheduleTaskDetailRefresh: boolean;
  shouldBumpTaskDetailTraceRefreshKey: boolean;
  shouldRefreshMonitorSummary: boolean;
};

const LIVE_ASSISTANT_PATCH_KINDS = new Set<TaskMessagePatchEvent["kind"]>([
  "assistant-progress",
  "assistant-completed",
  "assistant-delta",
]);

const CANONICAL_MESSAGE_REFRESH_PATCH_KINDS = new Set<TaskMessagePatchEvent["kind"]>([
  "message-persisted",
  "round-synced",
  "message-reconcile-required",
  "task-reconcile-required",
]);

const PHASE_REFRESH_PATCH_KINDS = new Set<TaskMessagePatchEvent["kind"]>([
  "phase-created",
  "phase-updated",
  "phase-awaiting-adoption",
  "phase-paused",
  "phase-resumed",
  "phase-cancelled",
  "phase-completed",
  "phase-failed",
]);

const TASK_DETAIL_MESSAGE_REFRESH_PATCH_KINDS = new Set<TaskMessagePatchEvent["kind"]>([
  "round-synced",
  "message-reconcile-required",
  "tool-message",
  "user-message",
]);

const TASK_DETAIL_TRACE_REFRESH_PATCH_KINDS = new Set<TaskMessagePatchEvent["kind"]>([
  "task-hooks-updated",
  "task-followup-started",
  "task-followup-completed",
  "task-followup-failed",
]);

const TASK_DETAIL_REFRESH_PATCH_KINDS = new Set<TaskMessagePatchEvent["kind"]>([
  "flow-reconcile-required",
  "task-reconcile-required",
  "workflow-reconcile-required",
  "task-updated",
  "task-completed",
  "task-failed",
  "task-continued",
  "task-node-updated",
  "agent-started",
  ...PHASE_REFRESH_PATCH_KINDS,
  ...TASK_DETAIL_TRACE_REFRESH_PATCH_KINDS,
]);

const MONITOR_SUMMARY_REFRESH_PATCH_KINDS = new Set<TaskMessagePatchEvent["kind"]>([
  "task-reconcile-required",
  "session-created",
  "session-updated",
  ...PHASE_REFRESH_PATCH_KINDS,
  "task-updated",
  "task-completed",
  "task-failed",
  "task-continued",
  "task-node-updated",
  "agent-started",
  "task-hooks-updated",
  "task-followup-started",
  "task-followup-completed",
  "task-followup-failed",
]);

function createEmptyTaskMessagePatchEffects(): TaskMessagePatchEffects {
  return {
    updatesLiveAssistantState: false,
    shouldRefreshCanonicalMessages: false,
    shouldRefreshTaskDetailMessages: false,
    shouldScheduleTaskDetailRefresh: false,
    shouldBumpTaskDetailTraceRefreshKey: false,
    shouldRefreshMonitorSummary: false,
  };
}

export function getTaskMessagePatchEffects(
  patchEvent: TaskMessagePatchEvent | null | undefined,
): TaskMessagePatchEffects {
  if (!patchEvent) {
    return createEmptyTaskMessagePatchEffects();
  }

  const shouldRefreshTaskDetailMessages = TASK_DETAIL_MESSAGE_REFRESH_PATCH_KINDS.has(
    patchEvent.kind,
  );
  const shouldBumpTaskDetailTraceRefreshKey = TASK_DETAIL_TRACE_REFRESH_PATCH_KINDS.has(
    patchEvent.kind,
  );

  return {
    updatesLiveAssistantState: LIVE_ASSISTANT_PATCH_KINDS.has(patchEvent.kind),
    shouldRefreshCanonicalMessages: CANONICAL_MESSAGE_REFRESH_PATCH_KINDS.has(patchEvent.kind),
    shouldRefreshTaskDetailMessages,
    shouldScheduleTaskDetailRefresh:
      shouldRefreshTaskDetailMessages || TASK_DETAIL_REFRESH_PATCH_KINDS.has(patchEvent.kind),
    shouldBumpTaskDetailTraceRefreshKey,
    shouldRefreshMonitorSummary: MONITOR_SUMMARY_REFRESH_PATCH_KINDS.has(patchEvent.kind),
  };
}

export function summarizeTaskMessagePatchEffects(
  patchEvents: TaskMessagePatchEvent[],
): TaskMessagePatchEffects {
  const effects = createEmptyTaskMessagePatchEffects();

  for (const patchEvent of patchEvents) {
    const nextEffects = getTaskMessagePatchEffects(patchEvent);
    effects.updatesLiveAssistantState ||= nextEffects.updatesLiveAssistantState;
    effects.shouldRefreshCanonicalMessages ||= nextEffects.shouldRefreshCanonicalMessages;
    effects.shouldRefreshTaskDetailMessages ||= nextEffects.shouldRefreshTaskDetailMessages;
    effects.shouldScheduleTaskDetailRefresh ||= nextEffects.shouldScheduleTaskDetailRefresh;
    effects.shouldBumpTaskDetailTraceRefreshKey ||= nextEffects.shouldBumpTaskDetailTraceRefreshKey;
    effects.shouldRefreshMonitorSummary ||= nextEffects.shouldRefreshMonitorSummary;
  }

  return effects;
}

export function shouldRefreshTaskDetailMessagesFromPoll(isRealtimeConnected: boolean) {
  return !isRealtimeConnected;
}