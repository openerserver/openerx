<template>
  <div v-if="toolCalls.length > 0" class="task-tool-call-group chat-message-card__tools">
    <div class="task-tool-call-group__header">
      <div class="task-tool-call-group__summary-inline">
        <span class="task-tool-call-group__label">动作</span>
        <span class="task-tool-call-group__header-separator" aria-hidden="true">·</span>
        <span class="chat-message-card__tools-count">{{ summaryText }}</span>
      </div>
      <a-button type="text" size="small" class="chat-tool-call__toggle task-tool-call-group__toggle" @click="toggleExpanded">
        {{ expanded ? "收起" : "展开" }}
      </a-button>
    </div>

    <div v-if="expanded" class="task-tool-call-group__details">
      <section v-for="(tool, toolIndex) in toolCalls" :key="tool.key" class="chat-tool-call">
        <button
          type="button"
          class="task-tool-call-group__action-button"
          @click="toggleTool(tool.key)"
        >
          <span class="chat-tool-call__index">{{ toolIndex + 1 }}.</span>
          <span class="task-tool-call-group__action-copy">{{ buildToolActionLabel(tool) }}</span>
          <a-tag :color="tool.stateColor">{{ tool.stateLabel }}</a-tag>
          <span class="task-tool-call-group__action-toggle">{{ isToolExpanded(tool.key) ? "收起" : "详情" }}</span>
        </button>
        <div v-if="isToolExpanded(tool.key)" class="task-tool-call-group__action-detail">
          <div v-if="tool.filePath" class="chat-tool-call__line">
            <span class="chat-tool-call__field">文件</span>
            <button
              type="button"
              class="chat-tool-call__path-button"
              @click="emit('openFilePreview', { filePath: tool.filePath, content: tool.fileContent })"
            >
              {{ tool.filePath }}
            </button>
          </div>
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
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { TaskConversationToolCallItem } from "../../lib/message-normalize";
import {
  buildToolActionLabel,
  toolCallText,
  toolInputText,
  toolOutputText,
} from "../../lib/task-tool-call-display";

const props = defineProps<{
  toolCalls: TaskConversationToolCallItem[];
}>();

const emit = defineEmits<{
  (e: "openFilePreview", payload: { filePath: string; content?: string }): void;
}>();

const expanded = ref(false);
const expandedTools = ref<Record<string, boolean>>({});

const summaryText = computed(() => {
  const firstTool = props.toolCalls[0];
  if (!firstTool) {
    return "暂无动作";
  }

  const firstActionLabel = buildToolActionLabel(firstTool);
  if (props.toolCalls.length === 1) {
    return firstActionLabel;
  }

  return `${firstActionLabel} 等 ${props.toolCalls.length} 个动作`;
});

function toggleExpanded() {
  expanded.value = !expanded.value;
}

function isToolExpanded(key: string) {
  return expandedTools.value[key] === true;
}

function toggleTool(key: string) {
  expandedTools.value = {
    ...expandedTools.value,
    [key]: !expandedTools.value[key],
  };
}
</script>

<style scoped>
.task-tool-call-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 0 8px;
  padding: 8px 10px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.025);
}

.task-tool-call-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-tool-call-group__summary-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.task-tool-call-group__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(0, 0, 0, 0.32);
}

.chat-message-card__tools-count {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.chat-message-card__tools-count {
  font-weight: 500;
  color: rgba(0, 0, 0, 0.56);
}

.task-tool-call-group__header-separator {
  color: rgba(0, 0, 0, 0.22);
}

.task-tool-call-group__toggle {
  flex-shrink: 0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.52);
}

.task-tool-call-group__details {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 2px;
  padding-left: 10px;
  border-left: 1px solid rgba(15, 23, 42, 0.08);
}

.task-tool-call-group__action-button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.task-tool-call-group__action-copy {
  flex: 1;
  min-width: 0;
  color: rgba(0, 0, 0, 0.82);
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}

.task-tool-call-group__action-toggle {
  flex-shrink: 0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.48);
}

.task-tool-call-group__action-detail {
  margin-top: 4px;
  padding: 0 0 6px 18px;
}

.chat-tool-call {
  padding: 0;
  border-radius: 0;
  background: transparent;
  border: 0;
}

.chat-tool-call + .chat-tool-call {
  border-top: 1px dashed #f3f3f3;
}

.chat-tool-call__index {
  color: rgba(0, 0, 0, 0.32);
  font-size: 12px;
}

.chat-tool-call__label {
  font-weight: 600;
}

.chat-tool-call__summary {
  white-space: pre-wrap;
  word-break: break-word;
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

.chat-tool-call__path-button {
  display: inline-block;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: #1677ff;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-tool-call__path-button:hover {
  color: #4096ff;
  text-decoration: underline;
}

.chat-tool-call__toggle {
  border: 0;
  background: transparent;
  color: #1677ff;
  font-size: 12px;
  padding: 0;
  cursor: pointer;
}

.chat-tool-call__toggle:hover {
  color: #4096ff;
  text-decoration: underline;
}

.chat-tool-call__detail {
  margin: 8px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
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
</style>