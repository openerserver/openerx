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
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ExecutionMode, TaskStageViewModel } from "../../lib/api";

defineProps<{
  // Workflow 阶段
  workflowSummary: { currentStage: string; status: string } | null;
  workflowStages: TaskStageViewModel[];
  // 执行控制
  executionMode: ExecutionMode | undefined;
  autoAdvance: boolean;
  isExecuting: boolean;
  executing: boolean;
}>();

defineEmits<{
  (e: "choose-mode"): void;
}>();

const visible = computed(() => true);
</script>
