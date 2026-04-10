<template>
  <div class="v2-panel" data-testid="task-detail-v2-trace-panel">
    <a-flex justify="space-between" align="center" class="v2-panel__header">
      <a-typography-text strong class="v2-panel__title">执行追踪</a-typography-text>
      <a-space size="small">
        <a-button type="text" size="small" @click="() => void refresh()">刷新</a-button>
        <a-button type="text" size="small" @click="collapsed = !collapsed">
          {{ collapsed ? "展开" : "收起" }}
        </a-button>
      </a-space>
    </a-flex>

    <div v-show="!collapsed" class="trace-panel__body">
      <a-spin v-if="loading" />
      <a-alert v-else-if="error" type="error" show-icon :message="error" />
      <template v-else-if="trace">
        <a-space size="small" wrap class="trace-panel__summary">
          <a-tag v-for="item in summaryItems" :key="item.label" :color="tagTone(item.tone)">
            {{ item.label }}: {{ item.value }}
          </a-tag>
        </a-space>

        <a-alert
          v-if="trace.timelineMeta?.cacheState && trace.timelineMeta.cacheState !== 'complete'"
          type="warning"
          show-icon
          :message="trace.timelineMeta.cacheState === 'partial' ? '时间线缓存仅部分可用' : '时间线缓存暂不可用'"
          :description="trace.timelineMeta.cacheState === 'partial'
            ? '当前执行追踪只拿到了部分时间线结果；主链已停止隐式回退到运行时消息，请结合时间线来源和会话范围判断缺口。'
            : '当前执行追踪暂时没有可用时间线结果；页面会显式保留不完整状态，而不会隐式回退到运行时消息。'"
        />

        <a-space direction="vertical" style="width: 100%" size="small">
          <a-radio-group :value="messageRoleFilter" size="small" button-style="solid" @update:value="messageRoleFilter = $event">
            <a-radio-button value="narrative">关键时间线</a-radio-button>
            <a-radio-button value="all">全部时间线</a-radio-button>
            <a-radio-button value="user">用户输入</a-radio-button>
            <a-radio-button value="assistant">模型</a-radio-button>
            <a-radio-button value="tool">工具</a-radio-button>
            <a-radio-button value="tool-request">工具发起</a-radio-button>
            <a-radio-button value="tool-result">工具结果</a-radio-button>
            <a-radio-button value="debug">调试事件</a-radio-button>
          </a-radio-group>

          <div class="trace-panel__messages">
            <a-empty v-if="filteredMessages.length === 0" description="当前时间线没有可展示的事件项" />
            <a-card
              v-for="message in filteredMessages"
              :key="message.id"
              size="small"
              :bordered="false"
              :body-style="{ padding: '8px 12px' }"
            >
              <a-flex justify="space-between" align="center" style="margin-bottom: 4px">
                <a-space size="small" wrap>
                  <a-tag :color="traceRoleColor(message.role)">{{ traceRoleLabel(message.role) }}</a-tag>
                  <a-typography-text type="secondary" style="font-size: 12px">
                    {{ message.id.slice(0, 8) }}
                  </a-typography-text>
                  <a-tag v-for="eventType in message.sourceEventTypes || []" :key="eventType" color="default">
                    {{ eventType }}
                  </a-tag>
                </a-space>
                <a-button type="text" size="small" :disabled="!message.raw" @click="toggleMessageRaw(message.id)">
                  {{ expandedMessageRaw[message.id] ? "收起 JSON" : "展开 JSON" }}
                </a-button>
              </a-flex>
              <a-typography-text type="secondary" style="font-size: 12px; display: block; margin-bottom: 6px">
                {{ formatTimelineTime(message.createdAt, message.completedAt) }}
              </a-typography-text>
              <div v-if="traceToolSummaryPrimary(message)" class="trace-panel__tool-summary">
                <div class="trace-panel__tool-summary-primary">{{ traceToolSummaryPrimary(message) }}</div>
                <div v-if="traceToolSummaryMeta(message)" class="trace-panel__tool-summary-meta">
                  {{ traceToolSummaryMeta(message) }}
                </div>
              </div>
              <pre class="trace-panel__content">{{ message.text }}</pre>
              <pre v-if="expandedMessageRaw[message.id] && message.raw" class="trace-panel__raw">{{ JSON.stringify(message.raw, null, 2) }}</pre>
            </a-card>
          </div>
        </a-space>
      </template>
      <a-empty v-else description="暂无执行追踪" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import type { ExecutionTraceTimelineItem } from "../../lib/api";
import type { ToolCallDisplayItem } from "../../lib/task-tool-call-display";
import { summarizeToolCalls } from "../../lib/task-tool-call-display";
import { useTaskExecutionTrace } from "../../composables/useTaskExecutionTrace";

const props = defineProps<{
  taskId: string;
  sessionId?: string;
  refreshKey?: number;
}>();

const collapsed = ref(false);

const taskIdRef = toRef(props, "taskId");
const sessionIdRef = toRef(props, "sessionId");
const {
  trace,
  loading,
  error,
  messageRoleFilter,
  expandedMessageRaw,
  refresh,
  filteredMessages,
  summaryItems,
} = useTaskExecutionTrace(
  computed(() => taskIdRef.value),
  computed(() => sessionIdRef.value),
);

function tagTone(value?: string) {
  if (value === "warning") return "orange";
  if (value === "purple") return "purple";
  return value || "default";
}

function traceRoleColor(role: string) {
  if (role === "assistant") return "cyan";
  if (role === "user") return "gold";
  if (role === "tool") return "purple";
  if (role === "tool-request") return "geekblue";
  if (role === "tool-result") return "green";
  return "default";
}

function traceRoleLabel(role: string) {
  if (role === "assistant") return "模型";
  if (role === "user") return "用户";
  if (role === "tool") return "工具";
  if (role === "tool-request") return "工具发起";
  if (role === "tool-result") return "工具结果";
  return role || "系统";
}

function formatTimelineTime(createdAt?: string, completedAt?: string | null) {
  const parts: string[] = [];
  if (createdAt) {
    parts.push(`创建 ${createdAt}`);
  }
  if (completedAt) {
    parts.push(`完成 ${completedAt}`);
  }
  return parts.join(" · ") || "无时间信息";
}

function toggleMessageRaw(messageId: string) {
  expandedMessageRaw.value = {
    ...expandedMessageRaw.value,
    [messageId]: !expandedMessageRaw.value[messageId],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeTraceStatusLabel(status?: string) {
  if (status === "completed") return "完成";
  if (status === "running") return "执行中";
  if (status === "failed" || status === "error") return "失败";
  return status || "已触发";
}

function normalizeTracePreview(value: unknown, maxLength = 220) {
  const text =
    typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return undefined;
          }
        })();

  if (!text) {
    return undefined;
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function resolveTraceToolDisplayItem(message: ExecutionTraceTimelineItem): ToolCallDisplayItem | null {
  if (!["tool", "tool-request", "tool-result"].includes(message.role)) {
    return null;
  }

  const raw = asRecord(message.raw);
  if (!raw) {
    return null;
  }

  const request = asRecord(raw.request);
  const result = asRecord(raw.result);
  const rawPart = asRecord(raw.rawPart);
  const rawState = asRecord(rawPart?.state);
  const kind = asString(raw.toolName) ?? asString(rawPart?.toolName) ?? asString(rawPart?.tool) ?? "tool";
  const status =
    asString(request?.status) ?? asString(result?.status) ?? asString(rawState?.status) ?? undefined;

  return {
    kind,
    label: kind,
    stateLabel: normalizeTraceStatusLabel(status),
    headline: asString(request?.headline) ?? asString(result?.headline),
    description: asString(request?.description),
    command: asString(request?.command),
    filePath: asString(request?.filePath) ?? asString(result?.filePath),
    inputPreview: normalizeTracePreview(request?.input),
    outputPreview: normalizeTracePreview(result?.output ?? result?.error),
  };
}

function traceToolSummaryPrimary(message: ExecutionTraceTimelineItem) {
  const tool = resolveTraceToolDisplayItem(message);
  if (!tool) {
    return undefined;
  }

  return summarizeToolCalls([tool]).primary;
}

function traceToolSummaryMeta(message: ExecutionTraceTimelineItem) {
  const tool = resolveTraceToolDisplayItem(message);
  if (!tool) {
    return undefined;
  }

  const summary = summarizeToolCalls([tool]);
  return [summary.status, summary.secondary].filter(Boolean).join(" · ");
}

watch(
  () => props.refreshKey,
  () => {
    void refresh(true);
  },
);
</script>

<style scoped>
.v2-panel {
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 8px;
  background: #fafafa;
}

.v2-panel__header {
  margin-bottom: 4px;
  padding: 0 4px;
}

.v2-panel__title {
  font-size: 13px;
}

.trace-panel__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
}

.trace-panel__summary {
  margin-bottom: 4px;
}

.trace-panel__messages {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trace-panel__tool-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #f0f0f0;
  background: #fafafa;
}

.trace-panel__tool-summary-primary {
  font-size: 13px;
  line-height: 1.55;
  color: #262626;
}

.trace-panel__tool-summary-meta {
  font-size: 12px;
  line-height: 1.5;
  color: #8c8c8c;
}

.trace-panel__meta-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}

.trace-panel__meta-line {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.trace-panel__meta-label {
  color: #8c8c8c;
  min-width: 28px;
}

.trace-panel__meta-value {
  color: #262626;
  word-break: break-word;
}

.trace-panel__content,
.trace-panel__raw {
  margin: 0;
  white-space: pre-wrap;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.trace-panel__raw {
  margin-top: 8px;
  padding: 8px;
  border-radius: 8px;
  background: #f5f5f5;
}
</style>