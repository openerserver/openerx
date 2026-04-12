import { onScopeDispose, ref, type Ref, watch } from "vue";
import {
  shouldRefreshTaskDetailMessagesFromPoll,
  type TaskDetailRefreshRequest,
} from "../lib/task-detail-refresh-policy";

export type TaskDetailRefreshSnapshotOptions = {
  workflow?: boolean;
  flow?: boolean;
  messages?: boolean;
};

const SLOW_REFRESH_REASONS = new Set<TaskDetailRefreshRequest["reason"]>([
  "user-message",
  "tool-message",
]);

const WORKFLOW_REFRESH_REASONS = new Set<TaskDetailRefreshRequest["reason"]>([
  "user-message",
  "tool-message",
  "session-created",
  "session-updated",
  "task-updated",
  "task-completed",
  "task-continued",
  "task-node-updated",
  "agent-started",
  "task-hooks-updated",
  "task-followup-started",
  "task-followup-completed",
  "task-followup-failed",
]);

const FLOW_REFRESH_REASONS = new Set<TaskDetailRefreshRequest["reason"]>([
  "session-created",
  "session-updated",
  "phase-created",
  "phase-updated",
  "phase-awaiting-adoption",
  "phase-paused",
  "phase-resumed",
  "phase-cancelled",
  "phase-completed",
  "phase-failed",
]);

export function toTaskDetailRefreshSnapshotOptions(
  request: TaskDetailRefreshRequest,
): TaskDetailRefreshSnapshotOptions {
  return {
    workflow: WORKFLOW_REFRESH_REASONS.has(request.reason),
    flow: FLOW_REFRESH_REASONS.has(request.reason),
    messages: request.shouldRefreshMessages,
  };
}

export function useTaskDetailRefreshController(args: {
  taskId: Ref<string>;
  latestTaskRefreshRequest: Ref<TaskDetailRefreshRequest | null | undefined>;
  realtimeConnected: Ref<boolean>;
  shouldPollRunningStatus: Ref<boolean>;
  refreshTaskSnapshot: (options?: TaskDetailRefreshSnapshotOptions) => void | Promise<void>;
}) {
  const traceRefreshKey = ref(0);
  let taskRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let runningStatusPollTimer: ReturnType<typeof setInterval> | null = null;

  function clearScheduledTaskRefresh() {
    if (taskRefreshTimer) {
      clearTimeout(taskRefreshTimer);
      taskRefreshTimer = null;
    }
  }

  function stopRunningStatusPoll() {
    if (runningStatusPollTimer) {
      clearInterval(runningStatusPollTimer);
      runningStatusPollTimer = null;
    }
  }

  function scheduleTaskRefresh(request: TaskDetailRefreshRequest) {
    if (!args.taskId.value) {
      return;
    }

    clearScheduledTaskRefresh();
    const delay = SLOW_REFRESH_REASONS.has(request.reason) ? 260 : 180;
    taskRefreshTimer = setTimeout(() => {
      taskRefreshTimer = null;
      void args.refreshTaskSnapshot(toTaskDetailRefreshSnapshotOptions(request));
    }, delay);
  }

  function ensureRunningStatusPoll() {
    if (runningStatusPollTimer || !args.taskId.value) {
      return;
    }

    runningStatusPollTimer = setInterval(() => {
      void args.refreshTaskSnapshot({
        flow: true,
        messages: shouldRefreshTaskDetailMessagesFromPoll(args.realtimeConnected.value),
      });
    }, 2000);
  }

  watch(
    () => args.latestTaskRefreshRequest.value?.eventId,
    () => {
      const refreshRequest = args.latestTaskRefreshRequest.value;
      if (!refreshRequest) {
        return;
      }

      if (refreshRequest.shouldBumpTraceRefreshKey) {
        traceRefreshKey.value += 1;
      }
      scheduleTaskRefresh(refreshRequest);
    },
  );

  watch(
    () => [args.taskId.value, args.shouldPollRunningStatus.value].join("|"),
    () => {
      if (!args.taskId.value || !args.shouldPollRunningStatus.value) {
        stopRunningStatusPoll();
        return;
      }

      ensureRunningStatusPoll();
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    clearScheduledTaskRefresh();
    stopRunningStatusPoll();
  });

  return {
    traceRefreshKey,
  };
}