import { ref, type Ref } from "vue";
import {
  getTaskMemberView,
  getTaskWorkflowView,
  type TaskMemberViewModel,
  type TaskWorkflowViewModel,
} from "../lib/api";

export type TaskDetailSnapshotRefreshOptions = {
  workflow?: boolean;
  flow?: boolean;
  messages?: boolean;
};

type TaskDetailSnapshotTaskState = {
  status?: string | null;
};

export function useTaskDetailSnapshotCoordinator(args: {
  taskId: Ref<string>;
  projectId: Ref<string | null | undefined>;
  task: Ref<TaskDetailSnapshotTaskState | null | undefined>;
  isParallelComparisonMode: () => boolean;
  refreshTask: (silent?: boolean) => void | Promise<void>;
  refreshSessions: (silent?: boolean) => void | Promise<void>;
  refreshMessages: (silent?: boolean) => void | Promise<void>;
  refreshTaskRunSummaries: (taskId: string, silent?: boolean) => void | Promise<void>;
  refreshParallelCandidateMessages: (taskId: string, silent?: boolean) => void | Promise<void>;
  clearParallelCandidateState: () => void;
  refreshRuntimePermissions: (silent?: boolean) => void | Promise<void>;
  ensureSelectedSession: () => void;
  subscribeProject: (projectId: string) => void;
  subscribeTask: (taskId: string) => void;
}) {
  const workflowView = ref<TaskWorkflowViewModel | null>(null);
  const memberView = ref<TaskMemberViewModel | null>(null);
  const memberViewLoading = ref(false);

  function resetSnapshotState() {
    workflowView.value = null;
    memberView.value = null;
    memberViewLoading.value = false;
  }

  async function refreshWorkflowSnapshot(currentTaskId: string, preserveCurrent: boolean) {
    const currentWorkflowView = workflowView.value;
    const currentMemberView = memberView.value;
    const [nextWorkflowView, nextMemberView] = await Promise.all([
      getTaskWorkflowView(currentTaskId).catch(() =>
        preserveCurrent ? currentWorkflowView : null,
      ),
      getTaskMemberView(currentTaskId).catch(() =>
        preserveCurrent ? currentMemberView : null,
      ),
    ]);

    if (args.taskId.value !== currentTaskId) {
      return;
    }

    workflowView.value = nextWorkflowView;
    memberView.value = nextMemberView;
  }

  async function refreshFlowSnapshot(currentTaskId: string, silentSessions: boolean) {
    if (silentSessions) {
      await args.refreshSessions(true);
    } else {
      await args.refreshSessions();
    }

    if (args.taskId.value !== currentTaskId) {
      return;
    }

    await args.refreshTaskRunSummaries(currentTaskId, true);
    if (args.taskId.value !== currentTaskId) {
      return;
    }

    args.ensureSelectedSession();
    if (args.isParallelComparisonMode()) {
      await args.refreshParallelCandidateMessages(currentTaskId, true);
    } else {
      args.clearParallelCandidateState();
    }

    if (args.taskId.value !== currentTaskId) {
      return;
    }

    args.ensureSelectedSession();
    await args.refreshRuntimePermissions(true);
  }

  async function refreshTaskSnapshot(options?: TaskDetailSnapshotRefreshOptions) {
    const requestedTaskId = args.taskId.value;
    if (!requestedTaskId) {
      return;
    }

    const previousStatus = args.task.value?.status;
    try {
      await args.refreshTask(true);
      const currentTaskId = args.taskId.value;
      if (!currentTaskId || currentTaskId !== requestedTaskId) {
        return;
      }

      const shouldRefreshWorkflow =
        Boolean(options?.workflow) ||
        !workflowView.value ||
        args.task.value?.status !== previousStatus;
      if (shouldRefreshWorkflow) {
        await refreshWorkflowSnapshot(currentTaskId, true);
      }
      if (args.taskId.value !== currentTaskId) {
        return;
      }

      if (options?.flow) {
        await refreshFlowSnapshot(currentTaskId, true);
      }
      if (args.taskId.value !== currentTaskId) {
        return;
      }

      if (options?.messages) {
        await args.refreshMessages(true);
      }
    } catch {
      // Keep current page state when a silent refresh fails.
    }
  }

  async function loadInitialSnapshot() {
    const currentTaskId = args.taskId.value;
    if (!currentTaskId) {
      resetSnapshotState();
      return;
    }

    try {
      memberViewLoading.value = true;
      await refreshWorkflowSnapshot(currentTaskId, false);
      if (args.taskId.value !== currentTaskId) {
        return;
      }

      if (args.projectId.value) {
        args.subscribeProject(args.projectId.value);
      }

      await refreshFlowSnapshot(currentTaskId, false);
      if (args.taskId.value !== currentTaskId) {
        return;
      }

      args.subscribeTask(currentTaskId);
    } catch {
      // useProjectTreeTask handles its own error state
    } finally {
      if (args.taskId.value === currentTaskId) {
        memberViewLoading.value = false;
      }
    }
  }

  return {
    workflowView,
    memberView,
    memberViewLoading,
    refreshTaskSnapshot,
    loadInitialSnapshot,
    resetSnapshotState,
  };
}