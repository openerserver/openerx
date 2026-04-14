import { onScopeDispose, ref, type Ref, watch } from "vue";
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
  realtimeConnected: Ref<boolean>;
  shouldPollRunningStatus: Ref<boolean>;
  refreshFlowSnapshot: () => void | Promise<void>;
  refreshMessageSnapshot: () => void | Promise<void>;
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
    }
  }

  function scheduleTaskRefreshOptions(
    options: TaskDetailRefreshTargets,
    reason: TaskDetailRefreshScheduleReason,
  ) {
    if (!args.taskId.value) {
      return;
    }

    clearScheduledTaskRefresh();
    const delay = 180;
    taskRefreshTimer = setTimeout(() => {
      taskRefreshTimer = null;
      if (options.messages && !options.workflow && !options.flow) {
        void args.refreshMessageSnapshot();
        return;
      }

      if (options.workflow && !options.flow && !options.messages) {
        void args.refreshWorkflowSnapshot();
        return;
      }

      if (options.flow && !options.workflow && !options.messages) {
        void args.refreshFlowSnapshot();
        return;
      }

      void args.refreshTaskSnapshot(options);
    }, delay);
  }

  function scheduleTaskRefresh(request: TaskDetailRefreshRequest) {
    scheduleTaskRefreshOptions(request.targets, request.reason);
  }

  function ensureRunningStatusPoll() {
    if (runningStatusPollTimer || !args.taskId.value) {
      return;
    }

    runningStatusPollTimer = setInterval(() => {
      if (shouldRefreshTaskDetailMessagesFromPoll(args.realtimeConnected.value)) {
        void args.refreshTaskSnapshot({ workflow: false, flow: true, messages: true });
        return;
      }

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

      if (refreshRequest.shouldBumpTraceRefreshKey) {
        traceRefreshKey.value += 1;
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