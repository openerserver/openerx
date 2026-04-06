<template>
  <a-card size="small" :bordered="false" :body-style="{ padding: '8px 12px' }">
    <a-flex justify="space-between" align="center" style="margin-bottom: 8px">
      <a-typography-text strong style="font-size: 13px">执行配置</a-typography-text>
      <a-space size="small">
        <a-tag style="cursor:pointer" @click="$emit('choose-mode')">{{ modeLabel }}</a-tag>
        <a-tooltip title="workflow 执行推进已从主执行链移除，当前仅展示历史配置状态">
          <a-tag :color="autoAdvance ? 'green' : 'default'">
            {{ autoAdvance ? '历史配置：自动推进' : '历史配置：手动推进' }}
          </a-tag>
        </a-tooltip>
      </a-space>
    </a-flex>

    <a-typography-text v-if="isExecuting" type="secondary" style="font-size: 12px">
      <a-tag color="processing">执行中</a-tag>
      {{ executionHint }}
    </a-typography-text>
  </a-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ExecutionMode } from "../../lib/api";

const props = defineProps<{
  executionMode: ExecutionMode | undefined;
  autoAdvance: boolean;
  isExecuting: boolean;
  executing: boolean;
}>();

const emit = defineEmits<(e: "choose-mode") => void>();

const modeLabel = computed(() => {
  switch (props.executionMode) {
    case "parallel":
      return "并行比较";
    case "sequential-chain":
      return "顺序编排";
    default:
      return "单次执行";
  }
});

const executionHint = computed(() => {
  if (props.executionMode === "parallel") return "多候选并行中…";
  if (props.executionMode === "sequential-chain") return "步骤串行中…";
  return "模型生成中…";
});
</script>
