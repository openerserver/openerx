import { onScopeDispose, ref, type Ref, watch } from "vue";
import {
  measureTaskRealtimeDuration,
  summarizeTaskRefreshRequest,
  traceTaskDetailRealtime,
} from "../lib/task-detail-realtime-debug";
import {
  shouldRefreshTaskDetailMessagesFromPoll,
  type TaskDetailRefreshTargets,
  type TaskDetailRefreshRequest,
} from "../lib/task-detail-refresh-policy";

type TaskDetailRefreshScheduleReason =
  | TaskDetailRefreshRequest["reason"]
  | "realtime-reconnected"
  | "message-reconcile-required"
  | "workflow-reconcile-required";

export function useTaskDetailRefreshController(args: {
  taskId: Ref<string>;
  latestTaskRefreshRequest: Ref<TaskDetailRefreshRequest | null | undefined>;
  messageReconcileRequired: Ref<boolean>;
  workflowReconcileRequired: Ref<boolean>;
  forceMessagePolling: Ref<boolean>;
  skipMessageRefreshEventId?: Ref<string | null>;
  realtimeConnected: Ref<boolean>;
  shouldPollRunningStatus: Ref<boolean>;
  refreshFlowSnapshot: () => void | Promise<void>;
  refreshMessageSnapshot: (phaseId?: string) => void | Promise<void>;
  refreshTaskSnapshot: (options?: TaskDetailRefreshTargets) => void | Promise<void>;
  refreshWorkflowSnapshot: () => void | Promise<void>;
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
      traceTaskDetailRealtime("refresh:poll-stop", {
        taskId: args.taskId.value,
      }, { taskId: args.taskId.value });
    }
  }

  function scheduleTaskRefreshOptions(
    options: TaskDetailRefreshTargets,
    reason: TaskDetailRefreshScheduleReason,
    phaseId?: string,
  ) {
    if (!args.taskId.value) {
      return;
    }

    clearScheduledTaskRefresh();
    const delay = 180;
    traceTaskDetailRealtime("refresh:schedule", {
      taskId: args.taskId.value,
      reason,
      phaseId,
      options,
      delay,
    }, { taskId: args.taskId.value });
    taskRefreshTimer = setTimeout(async () => {
      taskRefreshTimer = null;
      const startedAt = performance.now();
      const refreshPath = options.messages && !options.workflow && !options.flow
        ? "messages-only"
        : options.workflow && !options.flow && !options.messages
          ? "workflow-only"
          : options.flow && !options.workflow && !options.messages
            ? "flow-only"
            : "task-snapshot";
      traceTaskDetailRealtime("refresh:execute", {
        taskId: args.taskId.value,
        reason,
        phaseId,
        options,
        refreshPath,
      }, { taskId: args.taskId.value });

      try {
        if (refreshPath === "messages-only") {
          await args.refreshMessageSnapshot(phaseId);
        } else if (refreshPath === "workflow-only") {
          await args.refreshWorkflowSnapshot();
        } else if (refreshPath === "flow-only") {
          await args.refreshFlowSnapshot();
        } else {
          await args.refreshTaskSnapshot(options);
        }

        traceTaskDetailRealtime("refresh:complete", {
          taskId: args.taskId.value,
          reason,
          phaseId,
          options,
          refreshPath,
          durationMs: measureTaskRealtimeDuration(startedAt),
        }, { taskId: args.taskId.value });
      } catch (error) {
        traceTaskDetailRealtime("refresh:failed", {
          taskId: args.taskId.value,
          reason,
          phaseId,
          options,
          refreshPath,
          durationMs: measureTaskRealtimeDuration(startedAt),
          error: error instanceof Error ? error.message : String(error),
        }, { level: "warn", taskId: args.taskId.value });
      }
    }, delay);
  }

  function scheduleTaskRefresh(request: TaskDetailRefreshRequest) {
    scheduleTaskRefreshOptions(request.targets, request.reason, request.phaseId);
  }

  function ensureRunningStatusPoll() {
    if (runningStatusPollTimer || !args.taskId.value) {
      return;
    }

    traceTaskDetailRealtime("refresh:poll-start", {
      taskId: args.taskId.value,
      realtimeConnected: args.realtimeConnected.value,
      forceMessagePolling: args.forceMessagePolling.value,
    }, { taskId: args.taskId.value });
    runningStatusPollTimer = setInterval(() => {
      if (
        args.forceMessagePolling.value ||
        shouldRefreshTaskDetailMessagesFromPoll(args.realtimeConnected.value)
      ) {
        traceTaskDetailRealtime("refresh:poll-tick", {
          taskId: args.taskId.value,
          realtimeConnected: args.realtimeConnected.value,
          forceMessagePolling: args.forceMessagePolling.value,
          mode: "task-snapshot",
        }, { taskId: args.taskId.value });
        void args.refreshTaskSnapshot({ workflow: false, flow: true, messages: true });
        return;
      }

      traceTaskDetailRealtime("refresh:poll-tick", {
        taskId: args.taskId.value,
        realtimeConnected: args.realtimeConnected.value,
        forceMessagePolling: args.forceMessagePolling.value,
        mode: "flow-only",
      }, { taskId: args.taskId.value });
      void args.refreshFlowSnapshot();
    }, 2000);
  }

  watch(
    () => args.latestTaskRefreshRequest.value?.eventId,
    () => {
      const refreshRequest = args.latestTaskRefreshRequest.value;
      if (!refreshRequest) {
        return;
      }

      traceTaskDetailRealtime("refresh:request", {
        taskId: args.taskId.value,
        request: summarizeTaskRefreshRequest(refreshRequest),
      }, { taskId: args.taskId.value });
      if (refreshRequest.shouldBumpTraceRefreshKey) {
        traceRefreshKey.value += 1;
      }
      if (
        refreshRequest.targets.messages === true &&
        refreshRequest.targets.workflow === false &&
        refreshRequest.targets.flow === false &&
        args.skipMessageRefreshEventId?.value === refreshRequest.eventId
      ) {
        traceTaskDetailRealtime("refresh:skip", {
          taskId: args.taskId.value,
          reason: refreshRequest.reason,
          eventId: refreshRequest.eventId,
          refreshPath: "messages-only",
        }, { taskId: args.taskId.value });
        return;
      }
      scheduleTaskRefresh(refreshRequest);
    },
  );

  watch(
    () => args.realtimeConnected.value,
    (connected, previousConnected) => {
      if (!connected || previousConnected !== false || !args.taskId.value) {
        return;
      }

      traceTaskDetailRealtime("refresh:realtime-reconnected", {
        taskId: args.taskId.value,
      }, { taskId: args.taskId.value });
      scheduleTaskRefreshOptions(
        { workflow: false, flow: false, messages: true },
        "realtime-reconnected",
      );
    },
  );

  watch(
    () => args.messageReconcileRequired.value,
    (reconcileRequired, previousReconcileRequired) => {
      if (!reconcileRequired || previousReconcileRequired === true || !args.taskId.value) {
        return;
      }

      traceTaskDetailRealtime("refresh:message-reconcile-required", {
        taskId: args.taskId.value,
      }, { taskId: args.taskId.value });
      scheduleTaskRefreshOptions(
        { workflow: false, flow: false, messages: true },
        "message-reconcile-required",
      );
    },
  );

  watch(
    () => args.workflowReconcileRequired.value,
    (reconcileRequired, previousReconcileRequired) => {
      if (!reconcileRequired || previousReconcileRequired === true || !args.taskId.value) {
        return;
      }

      traceTaskDetailRealtime("refresh:workflow-reconcile-required", {
        taskId: args.taskId.value,
      }, { taskId: args.taskId.value });
      scheduleTaskRefreshOptions(
        { workflow: true, flow: false, messages: false },
        "workflow-reconcile-required",
      );
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