<template>
  <div
    v-if="visible"
    style="margin-bottom: 12px; border: 1px solid #e8e8e8; border-radius: 8px; padding: 8px; background: #fafafa"
    data-testid="task-detail-quick-overview"
  >
    <a-flex justify="space-between" align="center" style="margin-bottom: 4px; padding: 0 4px">
      <a-typography-text strong style="font-size: 13px">Workflow 速览</a-typography-text>
      <a-button type="text" size="small" @click="collapsed = !collapsed">
        {{ collapsed ? "展开" : "收起" }}
      </a-button>
    </a-flex>

    <div v-show="!collapsed" style="display: flex; flex-direction: column; gap: 6px">
      <!-- 阶段总览 -->
      <TaskWorkflowStageOverviewCard
        v-if="workflowSummary"
        :current-stage="workflowSummary.currentStage"
        :workflow-status="workflowSummary.status"
        :stages="workflowStages"
      />

      <!-- 执行控制 -->
      <TaskExecutionControlCard
        :execution-mode="executionMode"
        :auto-advance="autoAdvance"
        :is-executing="isExecuting"
        :executing="executing"
        @execute="$emit('execute')"
        @choose-mode="$emit('choose-mode')"
        @update:auto-advance="$emit('update:auto-advance', $event)"
      />

      <!-- 并行候选结果 -->
      <TaskParallelCandidatesCard
        v-if="candidates.length >= 2"
        :candidates="candidates"
        :winner-index="winnerIndex"
        :all-settled="allCandidatesSettled"
        :adopting-index="adoptingIndex"
        :judge-summary="judgeSummary"
        :judge-reasoning="judgeReasoning"
        @adopt="$emit('adopt', $event)"
      />

      <!-- 完结操作 -->
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
import { computed, ref } from "vue";
import type {
  ExecutionCandidate,
  ExecutionMode,
  TaskStageViewModel,
} from "../../lib/api";

const props = defineProps<{
  // Workflow 阶段
  workflowSummary: { currentStage: string; status: string } | null;
  workflowStages: TaskStageViewModel[];
  // 执行控制
  executionMode: ExecutionMode | undefined;
  autoAdvance: boolean;
  isExecuting: boolean;
  executing: boolean;
  // 并行候选
  candidates: ExecutionCandidate[];
  winnerIndex: number;
  allCandidatesSettled: boolean;
  adoptingIndex: number | null;
  judgeSummary?: string;
  judgeReasoning?: string;
  // 完结操作
  taskStatus: string;
  completing: boolean;
  advancing: boolean;
}>();

defineEmits<{
  (e: "execute"): void;
  (e: "choose-mode"): void;
  (e: "update:auto-advance", value: boolean): void;
  (e: "adopt", index: number): void;
  (e: "complete"): void;
  (e: "advance"): void;
}>();

const collapsed = ref(false);

const visible = computed(
  () => props.workflowSummary != null || props.candidates.length >= 2,
);

const canComplete = computed(() => {
  const s = props.taskStatus;
  return s === "running" || s === "awaiting_input";
});

const canAdvance = computed(() => {
  if (!props.workflowSummary) return false;
  const currentStage = props.workflowStages.find(
    (s) => s.stageKey === props.workflowSummary!.currentStage,
  );
  if (!currentStage) return false;
  // 如果当前阶段已完成，且不是最后一个阶段
  const idx = props.workflowStages.indexOf(currentStage);
  return currentStage.status === "completed" && idx < props.workflowStages.length - 1;
});

const showCompletionActions = computed(
  () => canComplete.value || canAdvance.value,
);
</script>
