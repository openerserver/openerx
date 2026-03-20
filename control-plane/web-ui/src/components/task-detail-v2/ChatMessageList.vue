<template>
  <div ref="scrollContainer" class="chat-message-list" data-testid="task-detail-v2-message-list" @scroll="handleScroll">
    <a-spin v-if="loading" />
    <a-alert v-else-if="error" type="error" show-icon :message="error" />
    <a-empty v-else-if="items.length === 0" description="当前分支还没有可展示的消息" />
    <div v-else class="chat-message-list__items">
      <article v-for="item in items" :key="item.key" class="chat-message-card" :class="`chat-message-card--${item.role}`">
        <a-flex justify="space-between" align="center" class="chat-message-card__header">
          <a-space size="small" wrap>
            <a-tag :color="roleColor(item.role)">{{ roleLabel(item.role) }}</a-tag>
            <a-tag v-if="item.agent" color="geekblue">{{ item.agent }}</a-tag>
            <a-tag v-if="item.isStreaming" color="processing" class="chat-message-card__streaming-tag">生成中</a-tag>
            <a-typography-text v-if="item.createdAt" type="secondary" class="chat-message-card__time">
              {{ formatTime(item.createdAt) }}
            </a-typography-text>
          </a-space>
          <a-button v-if="canCopy(item)" type="text" size="small" @click="handleCopy(copyText(item))">复制</a-button>
        </a-flex>

        <div v-if="item.toolCalls.length > 0" class="chat-message-card__tools">
          <div v-for="tool in item.toolCalls" :key="tool.key" class="chat-tool-call">
            <a-flex justify="space-between" align="start" gap="small" wrap="wrap">
              <a-space size="small" wrap>
                <a-tag :color="tool.stateColor">{{ tool.stateLabel }}</a-tag>
                <span class="chat-tool-call__label">{{ tool.label }}</span>
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
            <div v-if="toolHeadlineText(tool)" class="chat-tool-call__headline">
              {{ toolHeadlineText(tool) }}
            </div>
            <pre v-if="toolDetailText(tool)" class="chat-tool-call__detail">{{ toolDetailText(tool) }}</pre>
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
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { renderMarkdown } from "../../lib/markdown";
import type { TaskConversationMessageItem, TaskConversationToolCallItem } from "../../composables/useTaskMessages";

const props = defineProps<{
  items: TaskConversationMessageItem[];
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  (e: "openFilePreview", payload: { filePath: string; content?: string }): void;
}>();

const scrollContainer = ref<HTMLElement | null>(null);
const shouldAutoScroll = ref(true);
const revealText = ref<Record<string, string>>({});
const STREAMING_PLACEHOLDER_TEXT = "正在生成...";
const AUTO_SCROLL_THRESHOLD_PX = 120;
const REVEAL_INTERVAL_MS = 22;
const REVEAL_MINOR_PAUSE_MS = 90;
const REVEAL_MAJOR_PAUSE_MS = 180;
let revealTimer: ReturnType<typeof setTimeout> | null = null;

const itemsSignature = computed(() =>
  props.items.map((item) => `${item.key}:${item.text || ""}:${item.isStreaming ? 1 : 0}`).join("|"),
);

function roleColor(role: string) {
  if (role === "assistant") return "cyan";
  if (role === "user") return "gold";
  if (role === "tool") return "purple";
  return "default";
}

function roleLabel(role: string) {
  if (role === "assistant") return "模型回复";
  if (role === "user") return "用户输入";
  if (role === "tool") return "工具输出";
  return role || "系统";
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

function toolDetailText(tool: TaskConversationToolCallItem) {
  return tool.command || tool.outputPreview || tool.inputPreview;
}

function buildToolCopyText(tool: TaskConversationToolCallItem) {
  return [
    `工具: ${tool.label}`,
    `状态: ${tool.stateLabel}`,
    tool.filePath ? `路径: ${tool.filePath}` : null,
    tool.headline || tool.description ? `摘要: ${tool.headline || tool.description}` : null,
    toolDetailText(tool) ? `详情:\n${toolDetailText(tool)}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n");
}

function canCopy(item: TaskConversationMessageItem) {
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

.chat-tool-call {
  padding: 10px 12px;
  border-radius: 10px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
}

.chat-tool-call__label {
  font-weight: 600;
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