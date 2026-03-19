<template>
  <a-card
    v-if="candidates.length >= 2"
    size="small"
    :bordered="false"
    :body-style="{ padding: '8px 12px' }"
  >
    <a-typography-text strong style="font-size: 13px; margin-bottom: 8px; display: block">
      并行候选结果
    </a-typography-text>

    <div style="display: flex; flex-direction: column; gap: 8px">
      <div
        v-for="(candidate, index) in candidates"
        :key="index"
        :style="{
          padding: '8px',
          borderRadius: '6px',
          border: winnerIndex === index ? '2px solid #faad14' : '1px solid #d9d9d9',
          background: winnerIndex === index ? '#fffbe6' : '#fafafa',
        }"
      >
        <a-flex justify="space-between" align="center">
          <a-space size="small">
            <a-typography-text strong>{{ candidate.label || `候选 ${index + 1}` }}</a-typography-text>
            <a-tag v-if="candidate.model" color="cyan">{{ candidate.model }}</a-tag>
            <a-tag :color="candidateStatusColor(candidate.status)">
              {{ candidateStatusLabel(candidate.status) }}
            </a-tag>
            <a-tag v-if="winnerIndex === index" color="gold">胜出</a-tag>
          </a-space>
          <a-button
            v-if="canAdopt(candidate, index)"
            type="primary"
            size="small"
            :loading="adoptingIndex === index"
            @click="$emit('adopt', index)"
          >
            采纳
          </a-button>
        </a-flex>
        <a-typography-paragraph
          v-if="candidate.result"
          type="secondary"
          :style="{ fontSize: '12px', margin: '4px 0 0 0', maxHeight: '60px', overflow: 'hidden' }"
        >
          {{ candidate.result.slice(0, 200) }}{{ candidate.result.length > 200 ? "…" : "" }}
        </a-typography-paragraph>
      </div>
    </div>

    <a-alert
      v-if="judgeSummary"
      type="info"
      show-icon
      :message="judgeSummary"
      :description="judgeReasoning"
      style="margin-top: 8px"
    />
  </a-card>
</template>

<script setup lang="ts">
import type { ExecutionCandidate } from "../../lib/api";

const props = defineProps<{
  candidates: ExecutionCandidate[];
  winnerIndex: number;
  allSettled: boolean;
  adoptingIndex: number | null;
  judgeSummary?: string;
  judgeReasoning?: string;
}>();

defineEmits<{
  (e: "adopt", index: number): void;
}>();

function canAdopt(candidate: ExecutionCandidate, index: number): boolean {
  return (
    props.allSettled &&
    candidate.status === "completed" &&
    props.winnerIndex < 0
  );
}

function candidateStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "success";
    case "running":
      return "processing";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function candidateStatusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "running":
      return "执行中";
    case "failed":
      return "失败";
    case "pending":
      return "待执行";
    default:
      return status;
  }
}
</script>
