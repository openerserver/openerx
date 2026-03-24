<template>
  <div
    v-if="visible"
    style="border: 1px solid #e8e8e8; border-radius: 8px; padding: 8px; background: #fafafa"
    data-testid="task-detail-quick-overview"
  >
    <div style="display: flex; flex-direction: column; gap: 6px">
      <TaskExecutionControlCard
        :execution-mode="executionMode"
        :auto-advance="autoAdvance"
        :is-executing="isExecuting"
        :executing="executing"
        @choose-mode="$emit('choose-mode')"
        @update:auto-advance="$emit('update:auto-advance', $event)"
      />

      <TaskCompletionActionsCard
        v-if="showCompletionActions"
        :can-complete="canComplete"
        :can-advance="canAdvance"
        :completing="completing"
        :advancing="advancing"
        @complete="$emit('complete')"
        @advance="$emit('advance')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ExecutionMode, TaskStageViewModel } from "../../lib/api";

const props = defineProps<{
  // Workflow 阶段
  workflowSummary: { currentStage: string; status: string } | null;
  workflowStages: TaskStageViewModel[];
  // 执行控制
  executionMode: ExecutionMode | undefined;
  autoAdvance: boolean;
  isExecuting: boolean;
  executing: boolean;
  // 完结操作
  taskStatus: string;
  completing: boolean;
  advancing: boolean;
}>();

defineEmits<{
  (e: "choose-mode"): void;
  (e: "update:auto-advance", value: boolean): void;
  (e: "complete"): void;
  (e: "advance"): void;
}>();

const visible = computed(() => true);

const canComplete = computed(() => {
  const s = props.taskStatus;
  return s === "running" || s === "awaiting_input";
});

const canAdvance = computed(() => {
  if (!props.workflowSummary) return false;
  const currentStage = props.workflowStages.find(
    (s) => s.stageKey === props.workflowSummary?.currentStage,
  );
  if (!currentStage) return false;
  // 如果当前阶段已完成，且不是最后一个阶段
  const idx = props.workflowStages.indexOf(currentStage);
  return currentStage.status === "completed" && idx < props.workflowStages.length - 1;
});

const showCompletionActions = computed(() => canComplete.value || canAdvance.value);
</script>
