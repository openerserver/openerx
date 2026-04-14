import { computed, ref, type Ref } from "vue";
import {
  type ExecutionMode,
  getTaskWorkflowView,
  type TaskSessionRecord,
  type TaskWorkflowViewModel,
} from "../lib/api";
import { shouldAcceptTaskDetailSnapshot } from "./taskDetailSnapshotAcceptance";
import { useTaskDetailSequentialStepsCoordinator } from "./useTaskDetailSequentialStepsCoordinator";
import { useTaskWorkflowActions } from "./useTaskWorkflowActions";
import { useTaskWorkflowSteps } from "./useTaskWorkflowSteps";
import type { TreeTask } from "./useProjectTreeTask";

export function useTaskWorkflowFeature(args: {
  editableExecutionMode: Ref<ExecutionMode>;
  taskId: Ref<string>;
  task: Ref<TreeTask | null | undefined>;
  taskSessionSummaries: Ref<TaskSessionRecord[]>;
  refreshTask: (silent?: boolean) => void | Promise<void>;
}) {
  const workflowView = ref<TaskWorkflowViewModel | null>(null);
  const workflowReconcileRequired = computed(() => Boolean(workflowView.value?.meta?.reconcileRequired));

  const { currentStageLabel, workflowStages, workflowSummary } = useTaskWorkflowSteps({
    workflowView,
  });
  const { editableSequentialSteps, resetSequentialStepState } =
    useTaskDetailSequentialStepsCoordinator({
      taskId: args.taskId,
      task: args.task,
      taskSessionSummaries: args.taskSessionSummaries,
      editableExecutionMode: args.editableExecutionMode,
    });
  const {
    executionModeSaving,
    filterModelOption,
    handleChooseMode,
    handleExecutionModeConfirm,
    handleSelectedModelChange,
    loadModels,
    modelOptions,
    modelsLoading,
    resetWorkflowActionState,
    setExecutionModeModalOpen,
    showExecutionModeModal,
  } = useTaskWorkflowActions({
    taskId: args.taskId,
    task: args.task,
    editableExecutionMode: args.editableExecutionMode,
    refreshTask: args.refreshTask,
  });

  function resetWorkflowSnapshotState() {
    workflowView.value = null;
  }

  function resetWorkflowState() {
    resetWorkflowSnapshotState();
    resetSequentialStepState();
    resetWorkflowActionState();
  }

  async function loadWorkflowSnapshot(currentTaskId: string, preserveCurrent: boolean) {
    const currentWorkflowView = workflowView.value;
    const nextWorkflowView = await getTaskWorkflowView(currentTaskId).catch(() =>
      preserveCurrent ? currentWorkflowView : null,
    );

    if (args.taskId.value !== currentTaskId) {
      return;
    }

    workflowView.value = shouldAcceptTaskDetailSnapshot(workflowView.value, nextWorkflowView)
      ? nextWorkflowView
      : workflowView.value;
  }

  async function refreshTaskContext(silent: boolean) {
    const requestedTaskId = args.taskId.value;
    if (!requestedTaskId) {
      return null;
    }

    await args.refreshTask(silent);
    const currentTaskId = args.taskId.value;
    if (!currentTaskId || currentTaskId !== requestedTaskId) {
      return null;
    }

    return currentTaskId;
  }

  async function refreshWorkflowSnapshot() {
    try {
      const currentTaskId = await refreshTaskContext(true);
      if (!currentTaskId) {
        return;
      }

      await loadWorkflowSnapshot(currentTaskId, true);
    } catch {
      // Keep current page state when a silent refresh fails.
    }
  }

  async function loadInitialWorkflowSnapshot() {
    const currentTaskId = args.taskId.value;
    if (!currentTaskId) {
      resetWorkflowState();
      return;
    }

    try {
      await loadWorkflowSnapshot(currentTaskId, false);
    } catch {
      // Keep workflow state aligned with the current task.
    }
  }

  return {
    currentStageLabel,
    editableSequentialSteps,
    executionModeSaving,
    filterModelOption,
    handleChooseMode,
    handleExecutionModeConfirm,
    handleSelectedModelChange,
    loadInitialWorkflowSnapshot,
    loadModels,
    modelOptions,
    modelsLoading,
    workflowReconcileRequired,
    refreshWorkflowSnapshot,
    resetWorkflowState,
    resetWorkflowSnapshotState,
    setExecutionModeModalOpen,
    showExecutionModeModal,
    workflowStages,
    workflowSummary,
    workflowView,
  };
}