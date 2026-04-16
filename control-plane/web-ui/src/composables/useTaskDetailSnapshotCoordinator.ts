import { type Ref } from "vue";
import type { TaskExecutionReconcileEnvelope } from "../lib/api";
import {
  measureTaskRealtimeDuration,
  traceTaskDetailRealtime,
} from "../lib/task-detail-realtime-debug";

export type TaskDetailSnapshotRefreshOptions = {
  workflow?: boolean;
  flow?: boolean;
  messages?: boolean;
};

export function useTaskDetailSnapshotCoordinator(args: {
  taskId: Ref<string>;
  projectId: Ref<string | null | undefined>;
  selectedSessionId?: Ref<string | undefined>;
  bumpConversationFocus?: (sessionId?: string) => void;
  refreshMessages: (silent?: boolean) => void | Promise<void>;
  refreshFlowSnapshot: () => void | Promise<void>;
  refreshWorkflowSnapshot: () => void | Promise<void>;
  loadInitialFlowSnapshot: () => void | Promise<void>;
  loadInitialWorkflowSnapshot: () => void | Promise<void>;
  resetFlowSnapshotState: () => void;
  resetWorkflowTargetState: () => void;
  subscribeProject: (projectId: string) => void;
  subscribeTask: (taskId: string) => void;
}) {
  function resetSnapshotState() {
    args.resetWorkflowTargetState();
    args.resetFlowSnapshotState();
  }

  async function refreshMessageSnapshot() {
    if (!args.taskId.value) {
      return;
    }

    const startedAt = performance.now();
    try {
      traceTaskDetailRealtime("snapshot-coordinator:refresh-messages", {
        taskId: args.taskId.value,
      }, { taskId: args.taskId.value });
      await args.refreshMessages(true);
      traceTaskDetailRealtime("snapshot-coordinator:refresh-messages-complete", {
        taskId: args.taskId.value,
        durationMs: measureTaskRealtimeDuration(startedAt),
      }, { taskId: args.taskId.value });
    } catch {
      traceTaskDetailRealtime("snapshot-coordinator:refresh-messages-failed", {
        taskId: args.taskId.value,
        durationMs: measureTaskRealtimeDuration(startedAt),
      }, { level: "warn", taskId: args.taskId.value });
      // Keep current page state when a silent refresh fails.
    }
  }

  async function refreshTaskSnapshot(options?: TaskDetailSnapshotRefreshOptions) {
    try {
      const currentTaskId = args.taskId.value;
      if (!currentTaskId) {
        return;
      }

      if (options?.workflow) {
        await args.refreshWorkflowSnapshot();
      }
      if (args.taskId.value !== currentTaskId) {
        return;
      }

      if (options?.flow) {
        await args.refreshFlowSnapshot();
      }
      if (args.taskId.value !== currentTaskId) {
        return;
      }

      if (options?.messages) {
        await refreshMessageSnapshot();
      }
    } catch {
      // Keep current page state when a silent refresh fails.
    }
  }

  async function reconcileExecutionEnvelope(envelope?: TaskExecutionReconcileEnvelope | null) {
    const refreshTargets = envelope?.refreshTargets ?? {
      workflow: true,
      flow: true,
      messages: true,
    };

    const nextSessionId = envelope?.nextSessionId?.trim() || undefined;
    traceTaskDetailRealtime("snapshot-coordinator:reconcile-envelope", {
      taskId: args.taskId.value,
      nextSessionId,
      refreshTargets,
    }, { taskId: args.taskId.value });
    if (nextSessionId && args.selectedSessionId) {
      args.selectedSessionId.value = nextSessionId;
    }
    if (nextSessionId && args.bumpConversationFocus) {
      args.bumpConversationFocus(nextSessionId);
    }

    await refreshTaskSnapshot(refreshTargets);
  }

  async function loadInitialSnapshot() {
    const currentTaskId = args.taskId.value;
    if (!currentTaskId) {
      resetSnapshotState();
      return;
    }

    const startedAt = performance.now();
    try {
      traceTaskDetailRealtime("snapshot-coordinator:initial-load-start", {
        taskId: currentTaskId,
        projectId: args.projectId.value,
      }, { taskId: currentTaskId });
      await args.loadInitialWorkflowSnapshot();
      if (args.taskId.value !== currentTaskId) {
        return;
      }

      if (args.projectId.value) {
        args.subscribeProject(args.projectId.value);
      }

      await args.loadInitialFlowSnapshot();
      if (args.taskId.value !== currentTaskId) {
        return;
      }

      args.subscribeTask(currentTaskId);
      traceTaskDetailRealtime("snapshot-coordinator:initial-load-complete", {
        taskId: currentTaskId,
        projectId: args.projectId.value,
        durationMs: measureTaskRealtimeDuration(startedAt),
      }, { taskId: currentTaskId });
    } catch {
      traceTaskDetailRealtime("snapshot-coordinator:initial-load-failed", {
        taskId: currentTaskId,
        projectId: args.projectId.value,
        durationMs: measureTaskRealtimeDuration(startedAt),
      }, { level: "warn", taskId: currentTaskId });
      // useProjectTreeTask handles its own error state
    }
  }

  return {
    reconcileExecutionEnvelope,
    refreshMessageSnapshot,
    refreshTaskSnapshot,
    refreshFlowSnapshot: args.refreshFlowSnapshot,
    refreshWorkflowSnapshot: args.refreshWorkflowSnapshot,
    loadInitialSnapshot,
    resetSnapshotState,
  };
}