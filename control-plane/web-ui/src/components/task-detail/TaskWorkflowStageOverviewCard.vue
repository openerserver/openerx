<template>
  <a-card size="small" :bordered="false" :body-style="{ padding: '8px 12px' }">
    <a-space size="small" wrap style="margin-bottom: 8px">
      <a-tag color="blue">阶段 {{ currentStageLabel }}</a-tag>
      <a-tag :color="statusDisplay.tagColor">{{ statusDisplay.label }}</a-tag>
      <a-tag v-if="blocked" color="red">已阻断</a-tag>
      <a-tag v-if="approvalPending" color="orange">待审批</a-tag>
    </a-space>

    <a-steps
      :current="currentStageIndex"
      size="small"
      :style="{ margin: '4px 0' }"
    >
      <a-step
        v-for="stage in stages"
        :key="stage.stageKey"
        :title="stageTitle(stage)"
        :status="stageStepStatus(stage)"
      />
    </a-steps>

    <div v-if="hasArtifacts" style="margin-top: 8px">
      <a-typography-text type="secondary" style="font-size: 12px">
        已完成 {{ completedCount }} / {{ stages.length }} 个阶段
      </a-typography-text>
    </div>
  </a-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { TaskStageViewModel } from "../../lib/api";
import {
  resolveWorkflowStageLabel,
  resolveWorkflowStatusDisplay,
  resolveWorkflowStepStatus,
} from "../../lib/task-workflow-display-policy";

const props = defineProps<{
  currentStage: string;
  workflowStatus: string;
  stages: TaskStageViewModel[];
}>();

const currentStageLabel = computed(() =>
  resolveWorkflowStageLabel(props.currentStage, props.stages, "—"),
);

const currentStageIndex = computed(() => {
  const idx = props.stages.findIndex((s) => s.stageKey === props.currentStage);
  return idx >= 0 ? idx : 0;
});

const completedCount = computed(() => props.stages.filter((s) => s.status === "completed").length);

const hasArtifacts = computed(() => completedCount.value > 0);

const blocked = computed(() =>
  props.stages.some((s) => s.stageKey === props.currentStage && s.blockingReason),
);

const approvalPending = computed(() =>
  props.stages.some(
    (s) => s.stageKey === props.currentStage && s.runtimeSummary?.approvalResult === "pending",
  ),
);

const statusDisplay = computed(() => resolveWorkflowStatusDisplay(props.workflowStatus));

function stageStepStatus(stage: TaskStageViewModel): "finish" | "process" | "wait" | "error" {
  return resolveWorkflowStepStatus(stage, props.currentStage);
}

function stageTitle(stage: TaskStageViewModel) {
  return resolveWorkflowStageLabel(stage.stageKey, props.stages, stage.stageKey);
}
</script>
