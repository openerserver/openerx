<template>
  <div class="session-flow-node" :class="{ 'session-flow-node--selected': data.selected }">
    <a-card size="small" :bordered="false" :body-style="{ padding: '8px 12px' }">
      <a-space size="small" wrap style="margin-bottom: 4px">
        <a-tag :color="data.sourceType === 'root' ? 'blue' : 'default'">
          {{ data.sourceType === "root" ? "主线" : "分叉" }}
        </a-tag>
        <a-tag v-if="data.isActive" color="processing">当前</a-tag>
      </a-space>

      <a-typography-text strong class="session-flow-node__title">
        {{ data.title }}
      </a-typography-text>

      <a-typography-text type="secondary" class="session-flow-node__meta">
        {{ data.shortId }}
      </a-typography-text>

      <a-typography-text v-if="summaryLabel" type="secondary" class="session-flow-node__meta">
        {{ summaryLabel }}
      </a-typography-text>
    </a-card>

    <Handle type="target" :position="Position.Top" />
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import { computed } from "vue";
import type { SessionFlowNodeData } from "../../composables/useSessionFlow";

const props = defineProps<{
  data: SessionFlowNodeData;
}>();

const summaryLabel = computed(() => {
  if (!props.data.summary) {
    return "";
  }
  return `+${props.data.summary.additions} -${props.data.summary.deletions} (${props.data.summary.files} files)`;
});
</script>

<style scoped>
.session-flow-node {
  width: 200px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  background: #fafafa;
}

.session-flow-node--selected {
  border: 2px solid #1677ff;
}

.session-flow-node__title {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
}

.session-flow-node__meta {
  display: block;
  font-size: 12px;
}
</style>