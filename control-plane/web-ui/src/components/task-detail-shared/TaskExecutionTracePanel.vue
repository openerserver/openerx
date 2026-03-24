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
          <a-radio-group :value="segmentFilter" size="small" button-style="solid" @update:value="segmentFilter = $event">
            <a-radio-button value="all">全部</a-radio-button>
            <a-radio-button value="user-input">用户输入</a-radio-button>
            <a-radio-button value="hook">Hook</a-radio-button>
            <a-radio-button value="model-response">模型回复</a-radio-button>
          </a-radio-group>

          <div class="trace-panel__segments">
            <a-card
              v-for="(segment, index) in filteredSegments"
              :key="`${segment.type}-${segment.hookId || segment.label}-${index}`"
              size="small"
              :bordered="false"
              :body-style="{ padding: '8px 12px' }"
            >
              <a-space size="small" style="margin-bottom: 4px" wrap>
                <a-tag :color="segmentColor(segment.type)">{{ segmentLabel(segment.type) }}</a-tag>
                <a-typography-text type="secondary" style="font-size: 12px">
                  {{ segment.label }}
                </a-typography-text>
              </a-space>
              <a-space v-if="segment.filePath || segment.fileRange || segment.toolStatus" size="small" wrap style="margin-bottom: 6px">
                <a-tag v-if="segment.filePath" color="default">{{ segment.filePath }}</a-tag>
                <a-tag v-if="segment.fileRange" color="default">L{{ segment.fileRange }}</a-tag>
                <a-tag v-if="segment.toolStatus" color="default">{{ segment.toolStatus }}</a-tag>
              </a-space>
              <div v-if="segment.toolArgumentsSummary || segment.diffSummary" class="trace-panel__meta-lines">
                <div v-if="segment.toolArgumentsSummary" class="trace-panel__meta-line">
                  <span class="trace-panel__meta-label">参数</span>
                  <span class="trace-panel__meta-value">{{ segment.toolArgumentsSummary }}</span>
                </div>
                <div v-if="segment.diffSummary" class="trace-panel__meta-line">
                  <span class="trace-panel__meta-label">变更</span>
                  <span class="trace-panel__meta-value">{{ segment.diffSummary }}</span>
                </div>
              </div>
              <pre class="trace-panel__content">{{ segment.content }}</pre>
            </a-card>
          </div>

          <a-divider style="margin: 4px 0" />

          <a-radio-group :value="messageRoleFilter" size="small" button-style="solid" @update:value="messageRoleFilter = $event">
            <a-radio-button value="all">全部时间线</a-radio-button>
            <a-radio-button value="user">用户</a-radio-button>
            <a-radio-button value="assistant">模型</a-radio-button>
            <a-radio-button value="tool">工具</a-radio-button>
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
import { computed, ref, toRef } from "vue";
import { useTaskExecutionTrace } from "../../composables/useTaskExecutionTrace";

const props = defineProps<{
  taskId: string;
  sessionId?: string;
}>();

const collapsed = ref(false);

const taskIdRef = toRef(props, "taskId");
const sessionIdRef = toRef(props, "sessionId");
const {
  trace,
  loading,
  error,
  segmentFilter,
  messageRoleFilter,
  expandedMessageRaw,
  refresh,
  filteredSegments,
  filteredMessages,
  summaryItems,
} = useTaskExecutionTrace(
  computed(() => taskIdRef.value),
  computed(() => sessionIdRef.value),
);

function segmentColor(type: string) {
  if (type === "user-input") return "blue";
  if (type === "workflow-context") return "cyan";
  if (type === "model-response") return "green";
  if (type === "final-prompt") return "purple";
  if (["tool-call", "tool-output", "file-reference", "diff"].includes(type)) return "geekblue";
  if (["candidate-result", "judge-decision", "chain-step-result"].includes(type)) return "gold";
  if (["status-transition", "session-activate", "session-branch", "session-archive"].includes(type))
    return "default";
  return "orange";
}

function segmentLabel(type: string) {
  const labels: Record<string, string> = {
    "user-input": "用户输入",
    "workflow-context": "工作流上下文",
    "hook-injection": "Hook 注入",
    "hook-result": "Hook 结果",
    "hook-rewrite": "Hook 重写",
    "final-prompt": "最终 Prompt",
    "model-response": "模型回复",
    "tool-call": "工具调用",
    "tool-output": "工具输出",
    thinking: "思考过程",
    "file-reference": "文件引用",
    diff: "Diff",
    "candidate-result": "候选结果",
    "judge-decision": "Judge 决策",
    "chain-step-result": "链式步骤",
    "status-transition": "状态变更",
    "session-activate": "会话激活",
    "session-branch": "会话分支",
    "session-archive": "会话归档",
  };
  return labels[type] ?? type;
}

function tagTone(value?: string) {
  if (value === "warning") return "orange";
  if (value === "purple") return "purple";
  return value || "default";
}

function traceRoleColor(role: string) {
  if (role === "assistant") return "cyan";
  if (role === "user") return "gold";
  if (role === "tool") return "purple";
  return "default";
}

function traceRoleLabel(role: string) {
  if (role === "assistant") return "模型";
  if (role === "user") return "用户";
  if (role === "tool") return "工具";
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

.trace-panel__segments,
.trace-panel__messages {
  display: flex;
  flex-direction: column;
  gap: 6px;
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