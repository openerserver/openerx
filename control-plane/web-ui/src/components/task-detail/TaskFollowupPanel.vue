<template>
  <div class="followup-panel">
    <a-flex justify="space-between" align="center" class="followup-panel__header">
      <a-typography-text strong>Follow-up</a-typography-text>
      <a-button type="text" size="small" @click="() => void refresh()">刷新</a-button>
    </a-flex>

    <a-spin v-if="loading" />
    <a-alert v-else-if="error" type="error" show-icon :message="error" />
    <a-empty v-else-if="followups.length === 0" description="当前任务还没有 follow-up 记录" />
    <div v-else class="followup-panel__body">
      <a-alert
        v-if="latestAlert"
        :type="latestAlert.type"
        show-icon
        :message="latestAlert.message"
        :description="latestAlert.description"
      />
      <a-alert
        v-if="hasBlockingIssue"
        type="warning"
        show-icon
        message="存在需要处理的 follow-up 问题"
        description="请前往设置页的编排策略检查 Follow-up 模板配置，或查看下方失败记录中的具体报错。"
      />

      <a-card
        v-for="(item, index) in followups"
        :key="`${item.templateId}-${item.completedAt}-${index}`"
        size="small"
        class="followup-panel__card"
      >
        <a-flex justify="space-between" align="start" gap="small">
          <div>
            <a-space size="small" wrap>
              <a-tag :color="statusColor(item)">{{ statusLabel(item) }}</a-tag>
              <a-tag color="blue">模板 {{ item.templateId }}</a-tag>
              <a-tag color="cyan">Agent {{ item.agent || '未指定' }}</a-tag>
              <a-tag v-if="item.model" color="default">{{ item.model }}</a-tag>
            </a-space>
            <div class="followup-panel__meta">触发 Hook: {{ item.triggerHookId }}</div>
            <div class="followup-panel__meta">完成时间: {{ item.completedAt || '未知' }}</div>
          </div>
        </a-flex>

        <a-alert
          v-if="item.failureType === 'template-missing'"
          type="warning"
          show-icon
          message="缺少已启用的 follow-up 模板"
          :description="item.error || 'Hook 已请求 follow-up，但系统中没有找到对应模板。请到设置页 > 编排策略 > Follow-up 模板补齐配置。'"
          class="followup-panel__alert"
        />
        <a-alert
          v-else-if="item.status === 'failed'"
          type="error"
          show-icon
          message="Follow-up 执行失败"
          :description="item.error || 'Detached follow-up 运行失败。请根据错误信息修正模板、模型或 Agent 配置后重试。'"
          class="followup-panel__alert"
        />

        <div v-if="item.result" class="followup-panel__section">
          <div class="followup-panel__section-title">结果</div>
          <pre class="followup-panel__content">{{ item.result }}</pre>
        </div>

        <div v-else-if="item.prompt" class="followup-panel__section">
          <div class="followup-panel__section-title">Prompt</div>
          <pre class="followup-panel__content">{{ item.prompt }}</pre>
        </div>
      </a-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef, watch } from "vue";
import { useTaskExecutionTrace } from "../../composables/useTaskExecutionTrace";

const props = defineProps<{
  taskId: string;
  sessionId?: string;
  refreshKey?: number;
}>();

const { trace, loading, error, refresh } = useTaskExecutionTrace(
  toRef(props, "taskId"),
  toRef(props, "sessionId"),
);

const followups = computed(() => trace.value?.followupExecutions ?? []);

const hasBlockingIssue = computed(() =>
  followups.value.some(
    (item) => item.failureType === "template-missing" || item.status === "failed",
  ),
);

const latestAlert = computed(() => {
  const latest = followups.value[followups.value.length - 1];
  if (!latest) {
    return null;
  }
  if (latest.failureType === "template-missing") {
    return {
      type: "warning" as const,
      message: "Follow-up 未执行",
      description:
        latest.error || "缺少已启用的模板配置，请到设置页 > 编排策略 > Follow-up 模板补齐。",
    };
  }
  if (latest.status === "failed") {
    return {
      type: "error" as const,
      message: "Follow-up 执行失败",
      description: latest.error || "Detached follow-up 运行失败，请检查下方错误详情。",
    };
  }
  return {
    type: "success" as const,
    message: "Follow-up 已完成",
    description: latest.result?.trim() || `模板 ${latest.templateId} 已执行完成。`,
  };
});

function statusColor(item: { status: string; failureType?: string }) {
  if (item.failureType === "template-missing") return "orange";
  if (item.status === "failed") return "red";
  if (item.status === "completed") return "green";
  return "default";
}

function statusLabel(item: { status: string; failureType?: string }) {
  if (item.failureType === "template-missing") return "模板缺失";
  if (item.status === "failed") return "执行失败";
  if (item.status === "completed") return "已完成";
  return item.status || "未知";
}

watch(
  () => props.refreshKey,
  () => {
    void refresh(true);
  },
);
</script>

<style scoped>
.followup-panel {
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 8px;
  background: #fafafa;
}

.followup-panel__header {
  margin-bottom: 8px;
}

.followup-panel__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  overflow-y: auto;
}

.followup-panel__card {
  border-radius: 10px;
}

.followup-panel__meta {
  margin-top: 6px;
  font-size: 12px;
  color: #64748b;
}

.followup-panel__alert {
  margin-top: 10px;
}

.followup-panel__section {
  margin-top: 10px;
}

.followup-panel__section-title {
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.followup-panel__content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
</style>
