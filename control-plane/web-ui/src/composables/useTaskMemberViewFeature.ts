import { computed, ref, type Ref } from "vue";
import { getTaskMemberView, type TaskMemberViewModel } from "../lib/api";
import { shouldAcceptTaskDetailSnapshot } from "./taskDetailSnapshotAcceptance";

export function useTaskMemberViewFeature(args: { taskId: Ref<string> }) {
  const memberView = ref<TaskMemberViewModel | null>(null);
  const memberViewLoading = ref(false);
  const memberReconcileRequired = computed(() => Boolean(memberView.value?.meta?.reconcileRequired));

  function resetMemberViewState() {
    memberView.value = null;
    memberViewLoading.value = false;
  }

  async function loadMemberViewSnapshot(currentTaskId: string, preserveCurrent: boolean) {
    const currentMemberView = memberView.value;
    const nextMemberView = await getTaskMemberView(currentTaskId).catch(() =>
      preserveCurrent ? currentMemberView : null,
    );

    if (args.taskId.value !== currentTaskId) {
      return;
    }

    memberView.value = shouldAcceptTaskDetailSnapshot(memberView.value, nextMemberView)
      ? nextMemberView
      : memberView.value;
  }

  async function refreshMemberViewSnapshot() {
    const currentTaskId = args.taskId.value;
    if (!currentTaskId) {
      return;
    }

    try {
      await loadMemberViewSnapshot(currentTaskId, true);
    } catch {
      // Keep current page state when a silent refresh fails.
    }
  }

  async function loadInitialMemberViewSnapshot() {
    const currentTaskId = args.taskId.value;
    if (!currentTaskId) {
      resetMemberViewState();
      return;
    }

    try {
      memberViewLoading.value = true;
      await loadMemberViewSnapshot(currentTaskId, false);
    } catch {
      // Keep sidebar state aligned with the current task.
    } finally {
      if (args.taskId.value === currentTaskId) {
        memberViewLoading.value = false;
      }
    }
  }

  return {
    loadInitialMemberViewSnapshot,
    memberReconcileRequired,
    memberView,
    memberViewLoading,
    refreshMemberViewSnapshot,
    resetMemberViewState,
  };
}