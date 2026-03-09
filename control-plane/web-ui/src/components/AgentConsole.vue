<template>
  <a-card size="small" :bordered="true">
    <template #title>
      <a-flex align="center" :gap="8">
        <span>{{ agentType }}</span>
        <a-typography-text code style="font-size: 11px">{{
          agentRunId.slice(0, 8)
        }}</a-typography-text>
        <a-tag :color="statusColor">{{ statusLabel }}</a-tag>
      </a-flex>
    </template>

    <!-- Control buttons -->
    <a-space style="margin-bottom: 8px">
      <a-button
        v-if="status === 'running'"
        size="small"
        @click="handleAction(() => pauseAgent(agentRunId))"
        :loading="loading"
      >
        <template #icon><PauseCircleOutlined /></template>
        暂停
      </a-button>
      <a-button
        v-if="status === 'paused'"
        size="small"
        type="primary"
        @click="handleAction(() => resumeAgent(agentRunId))"
        :loading="loading"
      >
        <template #icon><PlayCircleOutlined /></template>
        恢复
      </a-button>
      <a-popconfirm
        v-if="status === 'running' || status === 'paused'"
        title="确定终止此 Agent？"
        @confirm="handleAction(() => terminateAgent(agentRunId))"
      >
        <a-button size="small" danger :loading="loading">
          <template #icon><StopOutlined /></template>
          终止
        </a-button>
      </a-popconfirm>
    </a-space>

    <!-- Guidance input (only when paused) -->
    <a-input-search
      v-if="status === 'paused'"
      :value="guidance"
      placeholder="注入指令..."
      enter-button="发送"
      size="small"
      :loading="loading"
      @search="sendGuidance"
      @update:value="guidance = String($event ?? '')"
    />
  </a-card>
</template>

<script setup lang="ts">
import { PauseCircleOutlined, PlayCircleOutlined, StopOutlined } from "@ant-design/icons-vue";
import { computed, ref } from "vue";
import { injectGuidance, pauseAgent, resumeAgent, terminateAgent } from "../lib/api";

const props = defineProps<{
  agentRunId: string;
  agentType: string;
  status: string;
}>();

const guidance = ref("");
const loading = ref(false);

const statusColor = computed(() => {
  const map: Record<string, string> = {
    running: "blue",
    paused: "orange",
    completed: "green",
    failed: "red",
    stopped: "default",
  };
  return map[props.status] || "default";
});

const statusLabel = computed(() => {
  const map: Record<string, string> = {
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    stopped: "已停止",
  };

  return map[props.status] || props.status;
});

async function handleAction(action: () => Promise<unknown>) {
  loading.value = true;
  try {
    await action();
  } catch {
    // Error handling
  } finally {
    loading.value = false;
  }
}

async function sendGuidance() {
  if (!guidance.value.trim()) return;
  await handleAction(() => injectGuidance(props.agentRunId, guidance.value));
  guidance.value = "";
}
</script>
