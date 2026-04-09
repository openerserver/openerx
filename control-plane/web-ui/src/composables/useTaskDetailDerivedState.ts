import { computed, type Ref } from "vue";
import { type ExecutionMode, type TaskWorkflowViewModel } from "../lib/api";
import { resolveTaskDisplayStatus } from "../lib/task-display-status";
import {
  resolveEditableExecutionMode,
  resolveEditableJudgeConfig,
  resolveEditableParallelCandidates,
} from "../lib/taskExecutionMode";
import type { TreeTask } from "./useProjectTreeTask";

export function useTaskDetailTaskDerivedState(args: {
  task: Ref<TreeTask | null | undefined>;
  taskLoading: Ref<boolean>;
  taskLoadError: Ref<string | null | undefined>;
}) {
  const pageLoading = computed(() => args.taskLoading.value && !args.task.value);
  const loadError = computed(() => args.taskLoadError.value || "");
  const taskDisplayStatus = computed(() => resolveTaskDisplayStatus(args.task.value));
  const isExecuting = computed(() => args.task.value?.status === "running" && !args.task.value?.finishedAt);
  const canTerminateExecution = computed(() => isExecuting.value && Boolean(args.task.value?.agentRunId));

  const taskFailureReason = computed(() => {
    const status = args.task.value?.status;
    if (status !== "failed" && status !== "error") {
      return "";
    }
    return args.task.value?.result || "";
  });

  const editableExecutionMode = computed<ExecutionMode>(() =>
    resolveEditableExecutionMode(args.task.value),
  );
  const editableJudgeConfig = computed(() => resolveEditableJudgeConfig(args.task.value));
  const editableParallelCandidates = computed(() => resolveEditableParallelCandidates(args.task.value));

  return {
    canTerminateExecution,
    editableExecutionMode,
    editableJudgeConfig,
    editableParallelCandidates,
    isExecuting,
    loadError,
    pageLoading,
    taskDisplayStatus,
    taskFailureReason,
  };
}

export function useTaskDetailWorkflowDerivedState(args: {
  workflowView: Ref<TaskWorkflowViewModel | null>;
}) {
  const workflowSummary = computed(() => args.workflowView.value?.workflow ?? null);
  const workflowStages = computed(() => workflowSummary.value?.stages ?? []);
  const currentStageLabel = computed(() => {
    const currentStage = workflowSummary.value?.currentStage;
    if (!currentStage) {
      return "";
    }

    const matchedStage = workflowStages.value.find((stage) => stage.stageKey === currentStage);
    return matchedStage?.stageLabel || currentStage;
  });

  return {
    currentStageLabel,
    workflowStages,
    workflowSummary,
  };
}

export function useTaskDetailPollingState(args: {
  isExecuting: Ref<boolean>;
  hasStreamingAssistant: Ref<boolean>;
  continuing: Ref<boolean>;
  forking: Ref<boolean>;
}) {
  const shouldPollRunningStatus = computed(
    () =>
      args.isExecuting.value ||
      args.hasStreamingAssistant.value ||
      args.continuing.value ||
      args.forking.value,
  );

  return {
    shouldPollRunningStatus,
  };
}