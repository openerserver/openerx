import type { TaskWorkflowViewModel } from "../lib/api";
import { resolveWorkflowStageLabel } from "../lib/task-workflow-display-policy";
import { computed, type Ref } from "vue";

export function useTaskWorkflowSteps(args: {
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