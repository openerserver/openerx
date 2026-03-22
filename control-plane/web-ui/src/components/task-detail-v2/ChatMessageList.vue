<template>
  <div ref="scrollContainer" class="chat-message-list" data-testid="task-detail-v2-message-list" @scroll="handleScroll">
    <a-spin v-if="loading" />
    <a-alert v-else-if="error" type="error" show-icon :message="error" />
    <a-empty v-else-if="items.length === 0" description="当前分支还没有可展示的消息" />
    <div v-else class="chat-message-list__items">
      <article v-for="item in items" :key="item.key" class="chat-message-card" :class="`chat-message-card--${item.role}`">
        <template v-if="isParallelComparisonItem(item)">
          <div class="chat-message-card__parallel-group">
            <a-space size="small" wrap>
              <a-tag color="volcano">并行模型结果</a-tag>
              <a-typography-text type="secondary" class="chat-message-card__parallel-hint">
                多个模型会同时回复，请在这里对比后手动决定采纳哪个结果。
              </a-typography-text>
            </a-space>

            <div class="chat-message-card__parallel-grid">
              <div
                v-for="candidate in item.candidates"
                :key="candidate.key"
                class="chat-message-card__parallel-card"
                :class="{
                  'chat-message-card__parallel-card--winner': candidate.isAdopted,
                  'chat-message-card__parallel-card--recommended': candidate.isRecommended,
                }"
              >
                <a-flex justify="space-between" align="start" gap="small">
                  <a-space size="small" wrap>
                    <a-tag color="blue">{{ candidate.label }}</a-tag>
                    <a-tag v-if="candidate.model" color="cyan">{{ candidate.model }}</a-tag>
                    <a-tag :color="candidateStatusColor(candidate.status)">
                      {{ candidateStatusLabel(candidate.status) }}
                    </a-tag>
                    <a-tag v-if="candidate.isAdopted" color="gold">已采纳</a-tag>
                    <a-tag v-else-if="candidate.isRecommended" color="geekblue">Judge 推荐</a-tag>
                  </a-space>
                  <a-button
                    v-if="candidate.canAdopt"
                    type="primary"
                    size="small"
                    @click="emit('adoptCandidate', candidate.index)"
                  >
                    采纳为回复
                  </a-button>
                </a-flex>

                <a-typography-text v-if="candidate.meta" type="secondary" class="chat-message-card__parallel-meta">
                  {{ candidate.meta }}
                </a-typography-text>

                <a-typography-text v-if="candidate.loading" type="secondary">
                  正在等待该模型返回结果...
                </a-typography-text>
                <a-typography-text v-else-if="candidate.items.length === 0" type="secondary">
                  该模型暂时还没有可展示的回复。
                </a-typography-text>
                <div v-else class="chat-message-card__parallel-thread">
                  <div
                    v-for="entry in candidate.items"
                    :key="entry.key"
                    class="chat-message-card__parallel-entry"
                    :class="`chat-message-card__parallel-entry--${entry.role}`"
                  >
                    <a-flex justify="space-between" align="center" class="chat-message-card__parallel-entry-header">
                      <div class="chat-message-card__parallel-entry-header-main">
                        <span class="chat-message-card__parallel-entry-kicker">
                          {{ messageKicker(entry) }}
                        </span>
                        <a-space size="small" wrap>
                          <a-tag :color="roleColor(entry.role)">{{ messageRoleLabel(entry) }}</a-tag>
                          <a-tag v-if="entry.agent" color="geekblue">{{ entry.agent }}</a-tag>
                          <a-tag v-if="entry.isStreaming" color="processing">生成中</a-tag>
                        </a-space>
                      </div>
                      <a-typography-text v-if="entry.createdAt" type="secondary" class="chat-message-card__time">
                        {{ formatTime(entry.createdAt) }}
                      </a-typography-text>
                    </a-flex>

                    <div v-if="entry.toolCalls.length > 0" class="chat-message-card__tools">
                      <div class="chat-message-card__tools-header">
                        <span class="chat-message-card__tools-title">工具调用</span>
                        <span class="chat-message-card__tools-count">{{ entry.toolCalls.length }} 次</span>
                      </div>
                      <div v-for="(tool, toolIndex) in entry.toolCalls" :key="tool.key" class="chat-tool-call">
                        <a-flex justify="space-between" align="start" gap="small" wrap="wrap">
                          <a-space size="small" wrap>
                            <span class="chat-tool-call__index">{{ toolIndex + 1 }}.</span>
                            <span class="chat-tool-call__label">{{ tool.label }}</span>
                            <a-tag :color="tool.stateColor">{{ tool.stateLabel }}</a-tag>
                          </a-space>
                          <a-space size="small" wrap>
                            <button
                              v-if="tool.filePath"
                              type="button"
                              class="chat-tool-call__path-button"
                              @click="emit('openFilePreview', { filePath: tool.filePath, content: tool.fileContent })"
                            >
                              {{ tool.filePath }}
                            </button>
                            <button
                              v-if="toolDetailText(tool)"
                              type="button"
                              class="chat-tool-call__toggle"
                              @click="toggleCandidateTool(tool.key)"
                            >
                              {{ isCandidateToolExpanded(tool.key) ? '收起详情' : '展开详情' }}
                            </button>
                          </a-space>
                        </a-flex>
                        <div v-if="toolCallText(tool)" class="chat-tool-call__line">
                          <span class="chat-tool-call__field">调用</span>
                          <span class="chat-tool-call__value">{{ toolCallText(tool) }}</span>
                        </div>
                        <div v-if="toolInputText(tool)" class="chat-tool-call__line chat-tool-call__line--stacked">
                          <span class="chat-tool-call__field">参数</span>
                          <pre class="chat-tool-call__detail chat-tool-call__detail--compact">{{ toolInputText(tool) }}</pre>
                        </div>
                        <div
                          v-if="toolOutputText(tool) && isCandidateToolExpanded(tool.key)"
                          class="chat-tool-call__line chat-tool-call__line--stacked"
                        >
                          <span class="chat-tool-call__field">输出</span>
                          <pre class="chat-tool-call__detail chat-tool-call__detail--compact">{{ toolOutputText(tool) }}</pre>
                        </div>
                      </div>
                    </div>

                    <div
                      v-if="entry.role === 'assistant' && entry.text && shouldRenderMarkdown(entry)"
                      class="chat-message-card__markdown"
                      v-html="render(displayText(entry) || sanitizedItemText(entry) || entry.text)"
                    ></div>
                    <div
                      v-else-if="entry.isStreaming && !displayText(entry) && entry.toolCalls.length === 0"
                      class="streaming-skeleton"
                      aria-hidden="true"
                    >
                      <span class="streaming-skeleton__dot">.</span>
                      <span class="streaming-skeleton__dot">.</span>
                      <span class="streaming-skeleton__dot">.</span>
                      <span class="streaming-skeleton__dot">.</span>
                    </div>
                    <pre
                      v-else-if="displayText(entry) || sanitizedItemText(entry) || (!entry.toolCalls.length && !entry.isStreaming)"
                      class="chat-message-card__plain chat-message-card__parallel-plain"
                      :class="{ 'chat-message-card__plain--streaming': entry.isStreaming || isRevealing(entry) }"
                    >{{ displayText(entry) || sanitizedItemText(entry) || '暂无文本内容' }}</pre>
                  </div>
                </div>
              </div>
            </div>

            <a-alert
              v-if="item.judgeSummary"
              type="info"
              show-icon
              :message="item.judgeSummary"
              :description="item.judgeReasoning"
            />
          </div>
        </template>
        <template v-else>
          <a-flex justify="space-between" align="center" class="chat-message-card__header">
            <a-space size="small" wrap>
              <a-tag :color="roleColor(item.role)">{{ messageRoleLabel(item) }}</a-tag>
              <a-tag v-if="item.agent" color="geekblue">{{ item.agent }}</a-tag>
              <a-tag v-if="item.isStreaming" color="processing" class="chat-message-card__streaming-tag">生成中</a-tag>
              <a-typography-text v-if="item.createdAt" type="secondary" class="chat-message-card__time">
                {{ formatTime(item.createdAt) }}
              </a-typography-text>
            </a-space>
            <a-button v-if="canCopy(item)" type="text" size="small" @click="handleCopy(copyText(item))">复制</a-button>
          </a-flex>

          <div v-if="item.toolCalls.length > 0" class="chat-message-card__tools">
            <div class="chat-message-card__tools-header">
              <span class="chat-message-card__tools-title">工具调用</span>
              <span class="chat-message-card__tools-count">{{ item.toolCalls.length }} 次</span>
            </div>
            <div v-for="(tool, toolIndex) in item.toolCalls" :key="tool.key" class="chat-tool-call">
              <a-flex justify="space-between" align="start" gap="small" wrap="wrap">
                <a-space size="small" wrap>
                  <span class="chat-tool-call__index">{{ toolIndex + 1 }}.</span>
                  <span class="chat-tool-call__label">{{ tool.label }}</span>
                  <a-tag :color="tool.stateColor">{{ tool.stateLabel }}</a-tag>
                </a-space>
                <button
                  v-if="tool.filePath"
                  type="button"
                  class="chat-tool-call__path-button"
                  @click="emit('openFilePreview', { filePath: tool.filePath, content: tool.fileContent })"
                >
                  {{ tool.filePath }}
                </button>
              </a-flex>
              <div v-if="toolCallText(tool)" class="chat-tool-call__line">
                <span class="chat-tool-call__field">调用</span>
                <span class="chat-tool-call__value">{{ toolCallText(tool) }}</span>
              </div>
              <div v-if="toolInputText(tool)" class="chat-tool-call__line chat-tool-call__line--stacked">
                <span class="chat-tool-call__field">参数</span>
                <pre class="chat-tool-call__detail chat-tool-call__detail--compact">{{ toolInputText(tool) }}</pre>
              </div>
              <div v-if="toolOutputText(tool)" class="chat-tool-call__line chat-tool-call__line--stacked">
                <span class="chat-tool-call__field">输出</span>
                <pre class="chat-tool-call__detail chat-tool-call__detail--compact">{{ toolOutputText(tool) }}</pre>
              </div>
            </div>
          </div>

          <div
            v-if="item.role === 'assistant' && item.text && shouldRenderMarkdown(item)"
            class="chat-message-card__markdown"
            v-html="render(displayText(item) || sanitizedItemText(item) || item.text)"
          ></div>
          <div v-else-if="item.isStreaming && !displayText(item) && item.toolCalls.length === 0" class="streaming-skeleton" aria-hidden="true">
            <span class="streaming-skeleton__dot">.</span>
            <span class="streaming-skeleton__dot">.</span>
            <span class="streaming-skeleton__dot">.</span>
            <span class="streaming-skeleton__dot">.</span>
          </div>
          <pre
            v-else-if="displayText(item) || sanitizedItemText(item) || (!item.toolCalls.length && !item.isStreaming)"
            class="chat-message-card__plain"
            :class="{ 'chat-message-card__plain--streaming': item.isStreaming || isRevealing(item) }"
          >{{ displayText(item) || sanitizedItemText(item) || '暂无文本内容' }}</pre>
        </template>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { renderMarkdown } from "../../lib/markdown";
import type {
  TaskConversationListItem,
  TaskConversationMessageItem,
  TaskConversationParallelItem,
  TaskConversationToolCallItem,
} from "../../composables/useTaskMessages";

const props = defineProps<{
  items: TaskConversationListItem[];
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  (e: "openFilePreview", payload: { filePath: string; content?: string }): void;
  (e: "adoptCandidate", index: number): void;
}>();

const scrollContainer = ref<HTMLElement | null>(null);
const shouldAutoScroll = ref(true);
const revealText = ref<Record<string, string>>({});
const expandedCandidateTools = ref<Record<string, boolean>>({});
const STREAMING_PLACEHOLDER_TEXT = "正在生成...";
const AUTO_SCROLL_THRESHOLD_PX = 120;
const REVEAL_INTERVAL_MS = 22;
const REVEAL_MINOR_PAUSE_MS = 90;
const REVEAL_MAJOR_PAUSE_MS = 180;
let revealTimer: ReturnType<typeof setTimeout> | null = null;

const itemsSignature = computed(() =>
  props.items
    .map((item) =>
      isParallelComparisonItem(item)
        ? `${item.key}:${item.candidates.map((candidate) => `${candidate.key}:${candidate.status}:${candidate.items.map((entry) => `${entry.key}:${entry.text || ""}:${entry.toolCalls.length}`).join("!")}`).join("~")}`
        : `${item.key}:${item.text || ""}:${item.isStreaming ? 1 : 0}`,
    )
    .join("|"),
);

function roleColor(role: string) {
  if (role === "assistant") return "cyan";
  if (role === "user") return "gold";
  if (role === "tool") return "purple";
  if (role === "parallel") return "volcano";
  return "default";
}

function roleLabel(role: string) {
  if (role === "assistant") return "模型回复";
  if (role === "user") return "用户输入";
  if (role === "tool") return "工具输出";
  if (role === "parallel") return "并行回复";
  return role || "系统";
}

function isToolOnlyAssistantMessage(item: TaskConversationMessageItem) {
  return item.role === "assistant" && item.toolCalls.length > 0 && !sanitizedItemText(item);
}

function messageRoleLabel(item: TaskConversationMessageItem) {
  return isToolOnlyAssistantMessage(item) ? "工具调用" : roleLabel(item.role);
}

function messageKicker(item: TaskConversationMessageItem) {
  return isToolOnlyAssistantMessage(item)
    ? "工具调用"
    : item.role === "assistant"
      ? "模型回复"
      : item.role === "tool"
        ? "工具输出"
        : roleLabel(item.role);
}

function isParallelComparisonItem(item: TaskConversationListItem): item is TaskConversationParallelItem {
  return item.role === "parallel";
}

function candidateStatusLabel(status: string | undefined) {
  if (status === "completed") return "已完成";
  if (status === "running") return "执行中";
  if (status === "failed") return "失败";
  if (status === "pending") return "待执行";
  return status || "未知";
}

function candidateStatusColor(status: string | undefined) {
  if (status === "completed") return "success";
  if (status === "running") return "processing";
  if (status === "failed") return "error";
  return "default";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function render(text: string) {
  return renderMarkdown(text);
}

function stripStageCompleteMarker(text: string): string {
  return text
    .replace(/^\s*\[STAGE_COMPLETE\]\s*$/gmu, "")
    .replace(/\s*\[STAGE_COMPLETE\]\s*/gu, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripWorkflowExecutionContextPrefix(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return normalized;
  }

  const contextMarkers = [
    "Execution context:",
    "当前执行上下文",
    "请只完成当前阶段的目标。",
    "完成后请输出本阶段产出摘要。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加",
  ];

  const hasContextPrefix = contextMarkers.some((marker) => normalized.includes(marker));
  if (!hasContextPrefix) {
    return normalized;
  }

  const cutMarkers = [
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加",
    "完成后请输出本阶段产出摘要。",
    "请只完成当前阶段的目标。",
  ];

  for (const marker of cutMarkers) {
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex < 0) {
      continue;
    }
    const stripped = normalized.slice(markerIndex + marker.length).trim();
    if (stripped) {
      return stripped;
    }
  }

  const lastDoubleBreak = normalized.lastIndexOf("\n\n");
  if (lastDoubleBreak >= 0) {
    const stripped = normalized.slice(lastDoubleBreak + 2).trim();
    if (stripped) {
      return stripped;
    }
  }

  return "";
}

function sanitizeTextForDisplay(role: string, text: string): string {
  if (role === "user") {
    return stripStageCompleteMarker(stripWorkflowExecutionContextPrefix(text));
  }

  if (role === "assistant") {
    return stripStageCompleteMarker(text);
  }

  return text;
}

function sanitizedItemText(item: TaskConversationMessageItem) {
  if (!item.text) {
    return undefined;
  }
  return sanitizeTextForDisplay(item.role, item.text);
}

function isNearBottom() {
  const element = scrollContainer.value;
  if (!element) {
    return true;
  }
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceToBottom <= AUTO_SCROLL_THRESHOLD_PX;
}

function handleScroll() {
  shouldAutoScroll.value = isNearBottom();
}

function scrollToBottom() {
  const element = scrollContainer.value;
  if (!element || !shouldAutoScroll.value) {
    return;
  }
  element.scrollTop = element.scrollHeight;
}

function nextRevealProgress(fullText: string, currentLength: number) {
  const remaining = Math.max(fullText.length - currentLength, 0);
  if (remaining <= 0) {
    return { nextLength: fullText.length, delay: REVEAL_INTERVAL_MS };
  }

  const lookahead = fullText.slice(currentLength, currentLength + 6);
  const sentenceBreakIndex = lookahead.search(/[。！？!?]/u);
  const punctuationIndex = lookahead.search(/[，,、；：]/u);
  const lineBreakIndex = lookahead.indexOf("\n");

  if (sentenceBreakIndex >= 0 || lineBreakIndex >= 0) {
    const index = sentenceBreakIndex >= 0 ? sentenceBreakIndex : lineBreakIndex;
    return { nextLength: currentLength + index + 1, delay: REVEAL_MAJOR_PAUSE_MS };
  }

  if (punctuationIndex >= 0) {
    return { nextLength: currentLength + punctuationIndex + 1, delay: REVEAL_MINOR_PAUSE_MS };
  }

  const step = remaining > 180 ? 6 : remaining > 96 ? 4 : 2;
  return {
    nextLength: Math.min(fullText.length, currentLength + step),
    delay: REVEAL_INTERVAL_MS,
  };
}

function stopReveal() {
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
}

function syncReveal() {
  const nextReveal: Record<string, string> = {};
  let hasPendingReveal = false;
  let nextDelay = REVEAL_INTERVAL_MS;

  for (const item of props.items) {
    if (isParallelComparisonItem(item)) {
      continue;
    }

    const fullText = item.text;
    if (!fullText) {
      continue;
    }

    const current = revealText.value[item.key] ?? (item.isStreaming ? "" : fullText);
    if (!item.isStreaming && current.length >= fullText.length) {
      nextReveal[item.key] = fullText;
      continue;
    }

    if (!item.isStreaming && current.length === 0) {
      nextReveal[item.key] = fullText;
      continue;
    }

    const progress = nextRevealProgress(fullText, current.length);
    nextReveal[item.key] = fullText.slice(0, progress.nextLength);
    if (progress.nextLength < fullText.length) {
      hasPendingReveal = true;
      nextDelay = Math.max(nextDelay, progress.delay);
    }
  }

  revealText.value = nextReveal;
  stopReveal();
  void nextTick().then(scrollToBottom);

  if (hasPendingReveal) {
    revealTimer = setTimeout(() => {
      revealTimer = null;
      syncReveal();
    }, nextDelay);
  }
}

function displayText(item: TaskConversationMessageItem) {
  const fullText = sanitizedItemText(item);
  if (!fullText || fullText === STREAMING_PLACEHOLDER_TEXT) {
    return undefined;
  }
  const revealed = revealText.value[item.key];
  if (revealed) {
    return sanitizeTextForDisplay(item.role, revealed);
  }
  return item.isStreaming ? undefined : fullText;
}

function isRevealing(item: TaskConversationMessageItem) {
  const fullText = sanitizedItemText(item);
  if (!fullText) {
    return false;
  }
  const revealed = revealText.value[item.key];
  return Boolean(revealed && stripStageCompleteMarker(revealed).length < fullText.length);
}

function shouldRenderMarkdown(item: TaskConversationMessageItem) {
  return item.role === "assistant" && !item.isStreaming && !isRevealing(item);
}

function toolHeadlineText(tool: TaskConversationToolCallItem) {
  const text = tool.headline || tool.description;
  if (!text) {
    return undefined;
  }

  if (tool.filePath && text.trim() === tool.filePath.trim()) {
    return undefined;
  }

  if (text.trim() === tool.label.trim()) {
    return undefined;
  }

  return text;
}

function toolCallText(tool: TaskConversationToolCallItem) {
  return tool.command || toolHeadlineText(tool) || tool.description;
}

function toolInputText(tool: TaskConversationToolCallItem) {
  const input = tool.inputPreview?.trim();
  if (!input) {
    return undefined;
  }

  const callText = toolCallText(tool)?.trim();
  if (callText && input === callText) {
    return undefined;
  }

  return input;
}

function toolOutputText(tool: TaskConversationToolCallItem) {
  const output = tool.outputPreview?.trim();
  return output || undefined;
}

function toolDetailText(tool: TaskConversationToolCallItem) {
  return [toolCallText(tool), toolInputText(tool), toolOutputText(tool)].filter(Boolean).join("\n\n");
}

function isCandidateToolExpanded(key: string) {
  return expandedCandidateTools.value[key] === true;
}

function toggleCandidateTool(key: string) {
  expandedCandidateTools.value = {
    ...expandedCandidateTools.value,
    [key]: !expandedCandidateTools.value[key],
  };
}

function buildToolCopyText(tool: TaskConversationToolCallItem) {
  return [
    `工具: ${tool.label}`,
    `状态: ${tool.stateLabel}`,
    tool.filePath ? `路径: ${tool.filePath}` : null,
    toolCallText(tool) ? `调用: ${toolCallText(tool)}` : null,
    toolInputText(tool) ? `参数:\n${toolInputText(tool)}` : null,
    toolOutputText(tool) ? `输出:\n${toolOutputText(tool)}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n");
}

function canCopy(item: TaskConversationListItem) {
  if (isParallelComparisonItem(item)) {
    return false;
  }
  return Boolean(displayText(item) || sanitizedItemText(item) || item.toolCalls.length);
}

async function handleCopy(text: string) {
  await navigator.clipboard.writeText(text);
}

function copyText(item: TaskConversationMessageItem) {
  const text = displayText(item) || sanitizedItemText(item) || item.text || "";
  const toolText = item.toolCalls.map((tool) => buildToolCopyText(tool)).filter(Boolean).join("\n\n");
  return [text, toolText].filter(Boolean).join("\n\n");
}

watch(
  itemsSignature,
  async () => {
    syncReveal();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopReveal();
});
</script>

<style scoped>
.chat-message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.chat-message-list__items {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-message-card {
  border: 1px solid #e8e8e8;
  border-radius: 12px;
  padding: 12px 14px;
  background: #fff;
}

.chat-message-card--user {
  background: #fffbe6;
}

.chat-message-card--parallel {
  background: linear-gradient(180deg, #fffaf2 0%, #ffffff 100%);
}

.chat-message-card__header {
  margin-bottom: 8px;
}

.chat-message-card__time {
  font-size: 12px;
}

.chat-message-card__streaming-tag {
  position: relative;
  overflow: hidden;
}

.chat-message-card__streaming-tag::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45), transparent);
  transform: translateX(-100%);
  animation: streaming-tag-shimmer 1.6s linear infinite;
}

.chat-message-card__plain {
  margin: 0;
  white-space: pre-wrap;
  font-family: inherit;
}

.chat-message-card__plain--streaming {
  position: relative;
}

.chat-message-card__plain--streaming::after {
  content: "";
  display: inline-block;
  width: 0.55em;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: currentColor;
  opacity: 0.28;
  animation: streaming-caret 0.9s steps(1) infinite;
}

.chat-message-card__markdown :deep(pre) {
  overflow-x: auto;
}

.chat-message-card__tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.chat-message-card__tools-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.chat-message-card__tools-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.88);
}

.chat-message-card__tools-count {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.chat-message-card__parallel-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-message-card__parallel-hint {
  font-size: 12px;
}

.chat-message-card__parallel-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.chat-message-card__parallel-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid #e8e8e8;
  background: #ffffff;
  min-height: 180px;
}

.chat-message-card__parallel-card--winner {
  border-color: #f0b429;
  box-shadow: inset 0 0 0 1px rgba(240, 180, 41, 0.25);
  background: #fffbe8;
}

.chat-message-card__parallel-card--recommended {
  border-color: #91caff;
  box-shadow: inset 0 0 0 1px rgba(145, 202, 255, 0.25);
  background: #f0f7ff;
}

.chat-message-card__parallel-meta {
  display: block;
  font-size: 12px;
}

.chat-message-card__parallel-thread {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  padding-left: 18px;
}

.chat-message-card__parallel-thread::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 2px;
  bottom: 2px;
  width: 1px;
  background: linear-gradient(180deg, rgba(140, 140, 140, 0.1) 0%, rgba(140, 140, 140, 0.45) 18%, rgba(140, 140, 140, 0.45) 82%, rgba(140, 140, 140, 0.1) 100%);
}

.chat-message-card__parallel-entry {
  position: relative;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid #ececec;
  background: #ffffff;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.03);
}

.chat-message-card__parallel-entry::before {
  content: "";
  position: absolute;
  left: -17px;
  top: 18px;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #ffffff;
  border: 2px solid #d9d9d9;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
}

.chat-message-card__parallel-entry--assistant {
  background: linear-gradient(180deg, #f8fcff 0%, #ffffff 100%);
  border-left: 4px solid #91caff;
}

.chat-message-card__parallel-entry--assistant::before {
  border-color: #91caff;
}

.chat-message-card__parallel-entry--tool {
  background: linear-gradient(180deg, #fcf8ff 0%, #ffffff 100%);
  border-left: 4px solid #c8a6ff;
}

.chat-message-card__parallel-entry--tool::before {
  border-color: #c8a6ff;
}

.chat-message-card__parallel-entry--user {
  background: linear-gradient(180deg, #fffaf0 0%, #ffffff 100%);
  border-left: 4px solid #f7c97f;
}

.chat-message-card__parallel-entry--user::before {
  border-color: #f7c97f;
}

.chat-message-card__parallel-entry-header {
  margin-bottom: 8px;
  gap: 12px;
}

.chat-message-card__parallel-entry-header-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.chat-message-card__parallel-entry-kicker {
  color: #8c6b2e;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.chat-message-card__parallel-plain {
  margin-bottom: 0;
}

.chat-message-card__parallel-entry :deep(.chat-tool-call) {
  border: 1px solid #eadcff;
  background: #faf6ff;
}

.chat-message-card__parallel-entry :deep(.chat-tool-call__headline) {
  font-weight: 600;
}

.chat-message-card__parallel-entry :deep(.chat-tool-call__summary) {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.55;
  margin-top: 6px;
}

.chat-message-card__parallel-entry :deep(.chat-tool-call__toggle) {
  border: 0;
  background: transparent;
  color: #7c4dff;
  font-size: 12px;
  padding: 0;
  cursor: pointer;
}

.chat-message-card__parallel-entry :deep(.chat-tool-call__toggle:hover) {
  color: #5b21b6;
}

.chat-message-card__parallel-entry :deep(.chat-message-card__markdown) {
  margin-top: 2px;
}

.chat-tool-call {
  padding: 10px 12px;
  border-radius: 10px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
}

.chat-tool-call + .chat-tool-call {
  margin-top: 0;
}

.chat-tool-call__index {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.chat-tool-call__label {
  font-weight: 600;
}

.chat-tool-call__line {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-top: 8px;
}

.chat-tool-call__line--stacked {
  flex-direction: column;
  gap: 6px;
}

.chat-tool-call__field {
  min-width: 32px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  line-height: 1.6;
}

.chat-tool-call__value {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-tool-call__path {
  max-width: 100%;
  word-break: break-all;
  color: rgba(0, 0, 0, 0.55);
  font-size: 12px;
}

.chat-tool-call__path-button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #1677ff;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  word-break: break-all;
}

.chat-tool-call__path-button:hover {
  color: #4096ff;
  text-decoration: underline;
}

.chat-tool-call__headline {
  margin-top: 6px;
  white-space: pre-wrap;
}

.chat-tool-call__detail {
  margin: 8px 0 0;
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 12px;
  background: #fff;
  border-radius: 8px;
  padding: 8px 10px;
}

.chat-tool-call__detail--compact {
  margin-top: 0;
  width: 100%;
}

.streaming-skeleton {
  display: inline-flex;
  gap: 4px;
  font-size: 20px;
  line-height: 1;
  color: rgba(0, 0, 0, 0.35);
}

.streaming-skeleton__dot {
  animation: streaming-dot 1.1s ease-in-out infinite;
}

.streaming-skeleton__dot:nth-child(2) {
  animation-delay: 0.12s;
}

.streaming-skeleton__dot:nth-child(3) {
  animation-delay: 0.24s;
}

.streaming-skeleton__dot:nth-child(4) {
  animation-delay: 0.36s;
}

@keyframes streaming-dot {
  0%,
  80%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }

  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@keyframes streaming-caret {
  0%,
  45% {
    opacity: 0.1;
  }

  46%,
  100% {
    opacity: 0.35;
  }
}

@keyframes streaming-tag-shimmer {
  100% {
    transform: translateX(100%);
  }
}
</style>