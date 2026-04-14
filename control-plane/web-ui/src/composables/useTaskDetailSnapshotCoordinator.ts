import { type Ref } from "vue";
import type { TaskExecutionReconcileEnvelope } from "../lib/api";

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

    try {
      await args.refreshMessages(true);
    } catch {
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

    try {
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
    } catch {
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