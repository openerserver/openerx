import { computed, type Ref } from "vue";
import { type ExecutionMode, type Task, type TaskWorkflowViewModel } from "../lib/api";
import { resolveTaskDisplayStatus } from "../lib/task-display-status";
import { resolveWorkflowStageLabel } from "../lib/task-workflow-display-policy";
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
  currentPhaseId?: Ref<string | null>;
}) {
  const pageLoading = computed(() => args.taskLoading.value && !args.task.value);
  const loadError = computed(() => args.taskLoadError.value || "");
  const taskDisplayStatus = computed(() => resolveTaskDisplayStatus(args.task.value));
  const isExecuting = computed(() => {
    const task = args.task.value;
    if (!task || task.status !== "running" || task.finishedAt) {
      return false;
    }

    return hasExplicitTaskExecutionEvidence(task, args.currentPhaseId?.value ?? null);
  });
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

function hasActiveRunId(task: Task) {
  return (
    (typeof task.agentRunId === "string" && task.agentRunId.trim().length > 0) ||
    (typeof task.currentRunId === "string" && task.currentRunId.trim().length > 0)
  );
}

function hasExplicitTaskExecutionEvidence(task: Task, _currentPhaseId?: string | null) {
  // An active run id is the strongest signal of ongoing execution.
  if (hasActiveRunId(task)) {
    return true;
  }

  // currentRunStatus alone (without a run id) is stale after session
  // completion and must not keep the spinner alive.

  if (typeof task.activeCandidateCount === "number" && task.activeCandidateCount > 0) {
    return true;
  }

  if (typeof task.currentRunCandidateCount === "number" && task.currentRunCandidateCount > 0) {
    return true;
  }

  return false;
}

export function useTaskDetailWorkflowDerivedState(args: {
  workflowView: Ref<TaskWorkflowViewModel | null>;
}) {
  const workflowSummary = computed(() => args.workflowView.value?.workflow ?? null);
  const workflowStages = computed(() => workflowSummary.value?.stages ?? []);
  const currentStageLabel = computed(() =>
    resolveWorkflowStageLabel(workflowSummary.value?.currentStage, workflowStages.value, ""),
  );

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