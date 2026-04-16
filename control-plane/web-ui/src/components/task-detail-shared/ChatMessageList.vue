<template>
  <div ref="scrollContainer" class="chat-message-list" data-testid="task-detail-v2-message-list" @scroll="handleScroll">
    <div
      v-if="!loading && !error && (historyLoading || hasOlderHistory)"
      class="chat-message-list__history-status"
    >
      <button
        type="button"
        class="chat-message-list__history-trigger"
        :disabled="historyLoading"
        @click="handleLoadOlderHistoryClick"
      >
        {{ historyLoading ? '正在加载更早消息...' : '向上滚动或点击加载更早消息' }}
      </button>
    </div>
    <a-spin v-if="loading" />
    <a-alert v-else-if="error" type="error" show-icon :message="error" />
    <a-empty v-else-if="items.length === 0" description="当前分支还没有可展示的消息" />
    <div v-else class="chat-message-list__items">
      <div v-for="item in visibleItems" :key="item.key" class="chat-message-list__item-group">
        <article class="chat-message-card" :class="`chat-message-card--${item.role}`">
        <template v-if="isWorkflowItem(item)">
          <div class="chat-message-card__workflow-group">
            <div class="chat-message-card__workflow-header" @click="toggleWorkflowCollapse(item.key)">
              <a-space size="small" wrap>
                <a-tag :color="workflowTagColor(item)">{{ workflowTagLabel(item) }}</a-tag>
                <a-typography-text type="secondary" class="chat-message-card__workflow-hint">
                  {{ workflowHint(item) }}
                </a-typography-text>
              </a-space>
              <a-button type="text" size="small">
                {{ isWorkflowCollapsed(item.key) ? '展开详情' : '收起' }}
              </a-button>
            </div>

            <div v-if="!isWorkflowCollapsed(item.key)" class="chat-message-card__workflow-steps">
              <div
                v-for="step in item.steps"
                :key="step.sessionId"
                class="chat-message-card__workflow-step"
              >
                <div class="chat-message-card__workflow-step-header" @click="toggleWorkflowStep(step.sessionId)">
                  <a-space size="small" wrap>
                    <a-tag color="geekblue">{{ step.agentName }}</a-tag>
                    <a-typography-text type="secondary" style="font-size: 12px;">
                      {{ step.items.length }} 条消息
                    </a-typography-text>
                  </a-space>
                  <a-button type="text" size="small">
                    {{ isWorkflowStepCollapsed(step.sessionId) ? '展开' : '收起' }}
                  </a-button>
                </div>

                <div v-if="!isWorkflowStepCollapsed(step.sessionId)" class="chat-message-card__workflow-step-messages">
                  <div
                    v-for="turn in visibleMessageTurns(step.items)"
                    :key="turn.item.key"
                    class="chat-message-card__workflow-entry"
                    :class="`chat-message-card__workflow-entry--${turn.item.role}`"
                  >
                    <a-flex justify="space-between" align="center" style="margin-bottom: 6px;">
                      <a-space size="small" wrap>
                        <a-tag :color="roleColor(turn.item.role)" size="small">{{ messageRoleLabel(turn.item) }}</a-tag>
                        <a-tag v-if="assistantModelLabel(turn.item)" color="geekblue" size="small">{{ assistantModelLabel(turn.item) }}</a-tag>
                        <a-tag
                          v-if="shouldShowMessageStatus(turn.item)"
                          :color="messageStatusColor(turn.item.status)"
                          size="small"
                          class="chat-message-card__status-tag"
                        >
                          {{ messageStatusLabel(turn.item.status) }}
                        </a-tag>
                      </a-space>
                      <a-typography-text v-if="turn.item.createdAt" type="secondary" class="chat-message-card__time">
                        {{ formatTime(turn.item.createdAt) }}
                      </a-typography-text>
                    </a-flex>

                      <div v-if="assistantThinkingText(turn.item)" class="chat-message-card__thinking">
                        <button
                          type="button"
                          class="chat-message-card__thinking-toggle"
                          @click="toggleThinking(turn.item.key)"
                        >
                          {{ isThinkingExpanded(turn.item.key) ? '收起思考过程' : '查看思考过程' }}
                        </button>
                        <div
                          v-if="isThinkingExpanded(turn.item.key)"
                          class="chat-message-card__thinking-content"
                        >
                          <div
                            class="chat-message-card__markdown chat-message-card__thinking-markdown"
                            v-html="render(assistantThinkingText(turn.item) || '')"
                          ></div>
                        </div>
                      </div>

                    <div
                      v-if="turn.item.role === 'assistant' && turn.item.text && shouldRenderMarkdown(turn.item)"
                      class="chat-message-card__markdown"
                      v-html="render(sanitizeTextForDisplay(turn.item.role, turn.item.text))"
                    ></div>
                    <pre
                      v-else-if="sanitizedItemText(turn.item)"
                      class="chat-message-card__plain"
                    >{{ sanitizedItemText(turn.item) }}</pre>
                    <TaskToolCallGroup
                      :tool-calls="turn.toolCalls"
                      @open-file-preview="emit('openFilePreview', $event)"
                    />
                    <div v-if="messageErrorText(turn.item)" class="chat-message-card__error-text">
                      {{ messageErrorText(turn.item) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <template v-else-if="isParallelComparisonItem(item)">
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
                    <a-tag
                      v-if="candidate.traceState"
                      :color="candidateTraceStateColor(candidate.traceState)"
                    >
                      {{ candidateTraceStateLabel(candidate.traceState) }}
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
                  <a-button
                    v-if="canCopyParallelCandidate(candidate)"
                    type="text"
                    size="small"
                    @click="handleCopy(copyParallelCandidateText(candidate))"
                  >
                    复制候选
                  </a-button>
                </a-flex>

                <a-typography-text v-if="candidate.meta" type="secondary" class="chat-message-card__parallel-meta">
                  {{ candidate.meta }}
                </a-typography-text>
                <a-typography-text
                  v-if="candidate.traceNote"
                  type="warning"
                  class="chat-message-card__parallel-meta"
                >
                  {{ candidate.traceNote }}
                </a-typography-text>

                <a-typography-text v-if="candidate.loading" type="secondary">
                  正在等待该模型返回结果...
                </a-typography-text>
                <a-typography-text v-else-if="visibleMessageTurns(candidate.items).length === 0" type="secondary">
                  该模型暂时还没有可展示的回复。
                </a-typography-text>
                <div v-else class="chat-message-card__parallel-thread">
                  <div
                    v-for="turn in visibleMessageTurns(candidate.items)"
                    :key="turn.item.key"
                    class="chat-message-card__parallel-entry"
                    :class="`chat-message-card__parallel-entry--${turn.item.role}`"
                  >
                    <a-flex justify="space-between" align="center" class="chat-message-card__parallel-entry-header">
                      <div class="chat-message-card__parallel-entry-header-main">
                        <span class="chat-message-card__parallel-entry-kicker">
                          {{ messageKicker(turn.item) }}
                        </span>
                        <a-space size="small" wrap>
                          <a-tag :color="roleColor(turn.item.role)">{{ messageRoleLabel(turn.item) }}</a-tag>
                          <a-tag v-if="turn.item.agent" color="geekblue">{{ turn.item.agent }}</a-tag>
                          <a-tag v-if="turn.item.isStreaming" color="processing">生成中</a-tag>
                          <a-tag
                            v-if="shouldShowMessageStatus(turn.item)"
                            :color="messageStatusColor(turn.item.status)"
                            class="chat-message-card__status-tag"
                          >
                            {{ messageStatusLabel(turn.item.status) }}
                          </a-tag>
                        </a-space>
                      </div>
                      <a-typography-text v-if="turn.item.createdAt" type="secondary" class="chat-message-card__time">
                        {{ formatTime(turn.item.createdAt) }}
                      </a-typography-text>
                    </a-flex>

                      <div v-if="assistantThinkingText(turn.item)" class="chat-message-card__thinking">
                        <button
                          type="button"
                          class="chat-message-card__thinking-toggle"
                          @click="toggleThinking(turn.item.key)"
                        >
                          {{ isThinkingExpanded(turn.item.key) ? '收起思考过程' : '查看思考过程' }}
                        </button>
                        <div
                          v-if="isThinkingExpanded(turn.item.key)"
                          class="chat-message-card__thinking-content"
                        >
                          <div
                            class="chat-message-card__markdown chat-message-card__thinking-markdown"
                            v-html="render(assistantThinkingText(turn.item) || '')"
                          ></div>
                        </div>
                      </div>

                    <div
                      v-if="turn.item.role === 'assistant' && turn.item.text && shouldRenderMarkdown(turn.item)"
                      class="chat-message-card__markdown"
                      v-html="render(displayText(turn.item) || sanitizedItemText(turn.item) || turn.item.text)"
                    ></div>
                    <div
                      v-else-if="turn.item.isStreaming && !displayText(turn.item) && turn.toolCalls.length === 0"
                      class="streaming-skeleton"
                      aria-hidden="true"
                    >
                      <span class="streaming-skeleton__dot">.</span>
                      <span class="streaming-skeleton__dot">.</span>
                      <span class="streaming-skeleton__dot">.</span>
                      <span class="streaming-skeleton__dot">.</span>
                    </div>
                    <pre
                      v-else-if="displayText(turn.item) || sanitizedItemText(turn.item) || shouldRenderEmptyTextFallback(turn.item, turn.toolCalls.length)"
                      class="chat-message-card__plain chat-message-card__parallel-plain"
                      :class="{ 'chat-message-card__plain--streaming': turn.item.isStreaming || isRevealing(turn.item) }"
                    >{{ displayText(turn.item) || sanitizedItemText(turn.item) || '暂无文本内容' }}</pre>
                    <TaskToolCallGroup
                      :tool-calls="turn.toolCalls"
                      @open-file-preview="emit('openFilePreview', $event)"
                    />
                    <div v-if="messageErrorText(turn.item)" class="chat-message-card__error-text">
                      {{ messageErrorText(turn.item) }}
                    </div>
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
              <a-tag v-if="assistantModelLabel(item)" color="geekblue">{{ assistantModelLabel(item) }}</a-tag>
              <a-tag v-if="item.isStreaming" color="processing" class="chat-message-card__streaming-tag">生成中</a-tag>
              <a-tag
                v-if="shouldShowMessageStatus(item)"
                :color="messageStatusColor(item.status)"
                class="chat-message-card__status-tag"
              >
                {{ messageStatusLabel(item.status) }}
              </a-tag>
              <a-typography-text v-if="item.createdAt" type="secondary" class="chat-message-card__time">
                {{ formatTime(item.createdAt) }}
              </a-typography-text>
            </a-space>
            <a-button v-if="canCopy(item)" type="text" size="small" @click="handleCopy(copyText(item))">复制</a-button>
          </a-flex>

            <div v-if="assistantThinkingText(item)" class="chat-message-card__thinking">
              <button
                type="button"
                class="chat-message-card__thinking-toggle"
                @click="toggleThinking(item.key)"
              >
                {{ isThinkingExpanded(item.key) ? '收起思考过程' : '查看思考过程' }}
              </button>
              <div v-if="isThinkingExpanded(item.key)" class="chat-message-card__thinking-content">
                <div
                  class="chat-message-card__markdown chat-message-card__thinking-markdown"
                  v-html="render(assistantThinkingText(item) || '')"
                ></div>
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
          <template v-else-if="hasPromptDecomposition(item)">
            <pre class="chat-message-card__plain">{{ userDisplayText(item) }}</pre>
            <div v-if="item.finalSentText" class="chat-message-card__final-sent">
              <button
                type="button"
                class="chat-message-card__final-sent-toggle"
                @click="toggleFinalSent(item.key)"
              >
                {{ isFinalSentExpanded(item.key) ? '收起完整发送内容' : '查看完整发送内容' }}
              </button>
              <pre
                v-if="isFinalSentExpanded(item.key)"
                class="chat-message-card__plain chat-message-card__final-sent-content"
              >{{ item.finalSentText }}</pre>
            </div>
          </template>
          <pre
            v-else-if="displayText(item) || sanitizedItemText(item) || shouldRenderEmptyTextFallback(item, item.toolCalls.length)"
            class="chat-message-card__plain"
            :class="{ 'chat-message-card__plain--streaming': item.isStreaming || isRevealing(item) }"
          >{{ displayText(item) || sanitizedItemText(item) || '暂无文本内容' }}</pre>
          <TaskToolCallGroup
            :tool-calls="topLevelDisplayToolCalls(item)"
            @open-file-preview="emit('openFilePreview', $event)"
          />
          <div v-if="messageErrorText(item)" class="chat-message-card__error-text">
            {{ messageErrorText(item) }}
          </div>
        </template>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { renderMarkdown } from "../../lib/markdown";
import { buildToolCopyText } from "../../lib/task-tool-call-display";
import type {
  TaskConversationListItem,
  TaskConversationMessageItem,
  TaskConversationParallelItem,
  TaskConversationToolCallItem,
  TaskConversationWorkflowItem,
  TaskParallelComparisonCard,
} from "../../lib/message-normalize";

const props = defineProps<{
  items: TaskConversationListItem[];
  loading: boolean;
  error: string | null;
  activeSessionId?: string;
  forceScrollToken?: number;
  defaultAssistantModel?: string;
  hasOlderHistory?: boolean;
  historyLoading?: boolean;
}>();

const emit = defineEmits<{
  (e: "openFilePreview", payload: { filePath: string; content?: string }): void;
  (e: "adoptCandidate", index: number): void;
  (e: "loadOlderHistory"): void;
}>();

const scrollContainer = ref<HTMLElement | null>(null);
const shouldAutoScroll = ref(true);
const historyLoadLocked = ref(false);
const pendingHistoryAnchor = ref<{ scrollHeight: number; scrollTop: number } | null>(null);
const revealText = ref<Record<string, string>>({});
const expandedThinking = ref<Record<string, boolean>>({});
const expandedFinalSent = ref<Record<string, boolean>>({});
const collapsedWorkflows = ref<Record<string, boolean>>({});
const collapsedWorkflowSteps = ref<Record<string, boolean>>({});
const STREAMING_PLACEHOLDER_TEXT = "正在生成...";
const AUTO_SCROLL_THRESHOLD_PX = 120;
const HISTORY_LOAD_TOP_THRESHOLD_PX = 80;
const REVEAL_INTERVAL_MS = 22;
const REVEAL_MINOR_PAUSE_MS = 90;
const REVEAL_MAJOR_PAUSE_MS = 180;
let revealTimer: ReturnType<typeof setTimeout> | null = null;

type ConversationDisplayTurn = {
  item: TaskConversationMessageItem;
  toolCalls: TaskConversationToolCallItem[];
};

type PendingToolRef = {
  turnIndex: number;
  toolIndex: number;
  sessionId?: string;
  kind: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function cloneToolCall(tool: TaskConversationToolCallItem): TaskConversationToolCallItem {
  return { ...tool };
}

function mergeDistinctText(primary?: string, secondary?: string) {
  const left = primary?.trim();
  const right = secondary?.trim();
  if (!left) {
    return right;
  }
  if (!right || right === left || left.includes(right)) {
    return left;
  }
  if (right.includes(left)) {
    return right;
  }
  return `${left}\n\n${right}`;
}

function resolveMessageSessionId(item: TaskConversationMessageItem) {
  const raw = asRecord(item.raw);
  const info = asRecord(raw?.info);
  return (
    asString(raw?.sessionId) ??
    asString(info?.sessionID) ??
    asString(info?.sessionId)
  );
}

function mergeToolCallIntoTarget(
  target: TaskConversationToolCallItem,
  incoming: TaskConversationToolCallItem,
) {
  target.stateLabel = incoming.stateLabel || target.stateLabel;
  target.stateColor = incoming.stateColor || target.stateColor;
  target.headline = target.headline || incoming.headline;
  target.description = target.description || incoming.description;
  target.command = target.command || incoming.command;
  target.filePath = target.filePath || incoming.filePath;
  target.fileContent = target.fileContent || incoming.fileContent;
  target.inputPreview = mergeDistinctText(target.inputPreview, incoming.inputPreview);
  target.outputPreview = mergeDistinctText(target.outputPreview, incoming.outputPreview);
}

function appendToolOutputText(target: TaskConversationToolCallItem, text?: string) {
  if (!text?.trim()) {
    return;
  }
  target.outputPreview = mergeDistinctText(target.outputPreview, text);
}

function toolMatchScore(
  target: TaskConversationToolCallItem,
  candidate: TaskConversationToolCallItem,
) {
  if (target.kind !== candidate.kind) {
    return -1;
  }

  let score = 10;
  if (target.filePath && candidate.filePath && target.filePath === candidate.filePath) {
    score += 6;
  }
  if (target.command && candidate.command && target.command === candidate.command) {
    score += 4;
  }
  if (target.headline && candidate.headline && target.headline === candidate.headline) {
    score += 3;
  }
  if (target.label === candidate.label) {
    score += 1;
  }

  return score;
}

function findPendingToolRefIndex(
  pendingRefs: PendingToolRef[],
  turns: ConversationDisplayTurn[],
  candidate: TaskConversationToolCallItem,
  sessionId?: string,
) {
  let bestIndex = -1;
  let bestScore = -1;

  for (let index = pendingRefs.length - 1; index >= 0; index -= 1) {
    const ref = pendingRefs[index];
    if (sessionId && ref.sessionId && ref.sessionId !== sessionId) {
      continue;
    }
    const target = turns[ref.turnIndex]?.toolCalls[ref.toolIndex];
    if (!target) {
      continue;
    }
    const score = toolMatchScore(target, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function findRecentToolRef(
  turns: ConversationDisplayTurn[],
  pendingRefs: PendingToolRef[],
  lastMatchedRef: PendingToolRef | null,
  sessionId?: string,
) {
  if (lastMatchedRef && (!sessionId || !lastMatchedRef.sessionId || lastMatchedRef.sessionId === sessionId)) {
    return lastMatchedRef;
  }

  for (let index = pendingRefs.length - 1; index >= 0; index -= 1) {
    const ref = pendingRefs[index];
    if (!sessionId || !ref.sessionId || ref.sessionId === sessionId) {
      return ref;
    }
  }

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const turnSessionId = resolveMessageSessionId(turn.item);
    if (sessionId && turnSessionId && turnSessionId !== sessionId) {
      continue;
    }
    if (turn.toolCalls.length === 0) {
      continue;
    }
    return {
      turnIndex,
      toolIndex: turn.toolCalls.length - 1,
      sessionId: turnSessionId,
      kind: turn.toolCalls[turn.toolCalls.length - 1]?.kind ?? "tool",
    } satisfies PendingToolRef;
  }

  return null;
}

function shouldDisplayConversationTurn(turn: ConversationDisplayTurn) {
  return turn.toolCalls.length > 0 || hasStandaloneMessageContent(turn.item);
}

function buildConversationDisplayTurns(items: TaskConversationMessageItem[]) {
  const turns: ConversationDisplayTurn[] = [];
  const pendingRefs: PendingToolRef[] = [];
  let lastMatchedRef: PendingToolRef | null = null;

  const registerTurnToolCalls = (turnIndex: number) => {
    const turn = turns[turnIndex];
    const sessionId = resolveMessageSessionId(turn.item);
    turn.toolCalls.forEach((tool, toolIndex) => {
      pendingRefs.push({
        turnIndex,
        toolIndex,
        sessionId,
        kind: tool.kind,
      });
    });
  };

  for (const item of items) {
    const sessionId = resolveMessageSessionId(item);
    if (item.role === "tool") {
      const clonedToolCalls = item.toolCalls.map(cloneToolCall);
      const matchedToolIndexes = new Set<number>();

      clonedToolCalls.forEach((tool, toolIndex) => {
        const pendingIndex = findPendingToolRefIndex(pendingRefs, turns, tool, sessionId);
        if (pendingIndex < 0) {
          return;
        }
        const ref = pendingRefs[pendingIndex];
        const target = turns[ref.turnIndex]?.toolCalls[ref.toolIndex];
        if (!target) {
          return;
        }
        mergeToolCallIntoTarget(target, tool);
        pendingRefs.splice(pendingIndex, 1);
        matchedToolIndexes.add(toolIndex);
        lastMatchedRef = ref;
      });

      const toolText = sanitizedItemText(item)?.trim() || item.text?.trim();
      let textMerged = false;
      if (toolText) {
        const targetRef = findRecentToolRef(turns, pendingRefs, lastMatchedRef, sessionId);
        if (targetRef) {
          const target = turns[targetRef.turnIndex]?.toolCalls[targetRef.toolIndex];
          if (target) {
            appendToolOutputText(target, toolText);
            lastMatchedRef = targetRef;
            textMerged = true;
          }
        }
      }

      const unmatchedToolCalls = clonedToolCalls.filter((_, index) => !matchedToolIndexes.has(index));
      if (unmatchedToolCalls.length === 0 && (!toolText || textMerged)) {
        continue;
      }

      turns.push({
        item: textMerged ? { ...item, text: undefined } : item,
        toolCalls: unmatchedToolCalls,
      });
      continue;
    }

    turns.push({
      item,
      toolCalls: item.toolCalls.map(cloneToolCall),
    });
    registerTurnToolCalls(turns.length - 1);
  }

  return turns.filter((turn) => shouldDisplayConversationTurn(turn));
}

const topLevelDisplayTurns = computed(() =>
  buildConversationDisplayTurns(
    props.items.filter(
      (item): item is TaskConversationMessageItem =>
        !isParallelComparisonItem(item) && !isWorkflowItem(item),
    ),
  ),
);

const topLevelDisplayTurnMap = computed(
  () => new Map(topLevelDisplayTurns.value.map((turn) => [turn.item.key, turn])),
);

const visibleItems = computed(() =>
  props.items.filter((item) => {
    if (isParallelComparisonItem(item) || isWorkflowItem(item)) {
      return true;
    }
    return topLevelDisplayTurnMap.value.has(item.key);
  }),
);

const itemsSignature = computed(() =>
  props.items
    .map((item) =>
      isParallelComparisonItem(item)
        ? `${item.key}:${item.candidates.map((candidate) => `${candidate.key}:${candidate.status}:${candidate.items.map((entry) => `${entry.key}:${entry.text || ""}:${entry.toolCalls.length}`).join("!")}`).join("~")}`
        : isWorkflowItem(item)
          ? `${item.key}:workflow:${item.steps.length}`
          : `${item.key}:${item.text || ""}:${item.isStreaming ? 1 : 0}`,
    )
    .join("|"),
);

function roleColor(role: string) {
  if (role === "assistant") return "cyan";
  if (role === "user") return "gold";
  if (role === "tool") return "purple";
  if (role === "workflow") return "blue";
  if (role === "parallel") return "volcano";
  return "default";
}

function roleLabel(role: string) {
  if (role === "assistant") return "模型回复";
  if (role === "user") return "用户输入";
  if (role === "tool") return "工具输出";
  if (role === "workflow") return "工作流消息";
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

function isFailedMessageStatus(status: string | undefined) {
  return status === "failed" || status === "error";
}

function shouldShowMessageStatus(item: TaskConversationMessageItem) {
  return isFailedMessageStatus(item.status);
}

function messageStatusLabel(status: string | undefined) {
  if (status === "failed" || status === "error") return "失败";
  if (status === "running") return "执行中";
  if (status === "completed") return "完成";
  return status || "未知";
}

function messageStatusColor(status: string | undefined) {
  if (status === "failed" || status === "error") return "error";
  if (status === "running") return "processing";
  if (status === "completed") return "success";
  return "default";
}

function messageErrorText(item: TaskConversationMessageItem) {
  if (!isFailedMessageStatus(item.status)) {
    return undefined;
  }
  return item.errorText?.trim() || "执行失败";
}

function assistantModelLabel(item: TaskConversationMessageItem): string | undefined {
  if (item.role !== "assistant") {
    return undefined;
  }

  const explicitModel = item.model?.trim();
  if (explicitModel) {
    return explicitModel;
  }

  const fallbackModel = props.defaultAssistantModel?.trim();
  return fallbackModel || undefined;
}

function isParallelComparisonItem(
  item: TaskConversationListItem,
): item is TaskConversationParallelItem {
  return item.role === "parallel";
}

function isWorkflowItem(item: TaskConversationListItem): item is TaskConversationWorkflowItem {
  return item.role === "workflow";
}

function visibleMessageTurns(items: TaskConversationMessageItem[]) {
  return buildConversationDisplayTurns(items);
}

function topLevelDisplayToolCalls(item: TaskConversationListItem) {
  if (isParallelComparisonItem(item) || isWorkflowItem(item)) {
    return [];
  }

  return topLevelDisplayTurnMap.value.get(item.key)?.toolCalls ?? item.toolCalls;
}

function isWorkflowCollapsed(key: string) {
  return collapsedWorkflows.value[key] === true;
}

function workflowTagLabel(item: TaskConversationWorkflowItem) {
  return item.label || (item.variant === "context" ? "工作流消息" : "工作流调度");
}

function workflowTagColor(item: TaskConversationWorkflowItem) {
  return item.variant === "context" ? "blue" : "purple";
}

function workflowHint(item: TaskConversationWorkflowItem) {
  if (item.hint) {
    return item.hint;
  }

  if (item.variant === "context") {
    return "当前阶段与执行上下文";
  }

  return `${item.steps.length} 个子 Agent 执行`;
}

function toggleWorkflowCollapse(key: string) {
  collapsedWorkflows.value = { ...collapsedWorkflows.value, [key]: !collapsedWorkflows.value[key] };
}

function isWorkflowStepCollapsed(sessionId: string) {
  return collapsedWorkflowSteps.value[sessionId] === true;
}

function toggleWorkflowStep(sessionId: string) {
  collapsedWorkflowSteps.value = {
    ...collapsedWorkflowSteps.value,
    [sessionId]: !collapsedWorkflowSteps.value[sessionId],
  };
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

function candidateTraceStateLabel(state: "incomplete" | "stale") {
  if (state === "stale") return "追踪已过期";
  return "追踪不完整";
}

function candidateTraceStateColor(state: "incomplete" | "stale") {
  if (state === "stale") return "warning";
  return "gold";
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

function assistantThinkingText(item: TaskConversationMessageItem) {
  if (item.role !== "assistant" || !item.thinkingText) {
    return undefined;
  }
  return sanitizeTextForDisplay("assistant", item.thinkingText);
}

function shouldRenderEmptyTextFallback(item: TaskConversationMessageItem, toolCallCount: number) {
  if (toolCallCount > 0 || item.isStreaming) {
    return false;
  }

  if (item.role === "assistant" && assistantThinkingText(item)?.trim()) {
    return false;
  }

  return true;
}

function hasStandaloneMessageContent(item: TaskConversationMessageItem) {
  if (item.role === "tool") {
    return item.toolCalls.length === 0 && Boolean(sanitizedItemText(item)?.trim() || item.text?.trim());
  }

  if (item.role === "user") {
    return Boolean(userDisplayText(item).trim() || item.finalSentText);
  }

  if (item.role === "assistant") {
    return Boolean(
      assistantThinkingText(item)?.trim() ||
      sanitizedItemText(item)?.trim() ||
        item.text?.trim() ||
        item.finalSentText ||
        (item.isStreaming && item.toolCalls.length === 0),
    );
  }

  return Boolean(sanitizedItemText(item)?.trim() || item.text?.trim());
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
  maybeLoadOlderHistory();
}

function requestOlderHistory(options: { requireNearTop?: boolean } = {}) {
  const element = scrollContainer.value;
  if (
    !element ||
    !props.hasOlderHistory ||
    props.historyLoading ||
    historyLoadLocked.value
  ) {
    return false;
  }

  if ((options.requireNearTop ?? true) && element.scrollTop > HISTORY_LOAD_TOP_THRESHOLD_PX) {
    return false;
  }

  pendingHistoryAnchor.value = {
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  };
  historyLoadLocked.value = true;
  emit("loadOlderHistory");
  return true;
}

function maybeLoadOlderHistory() {
  requestOlderHistory({ requireNearTop: true });
}

function handleLoadOlderHistoryClick() {
  requestOlderHistory({ requireNearTop: false });
}

async function restoreHistoryAnchor() {
  const anchor = pendingHistoryAnchor.value;
  const element = scrollContainer.value;
  pendingHistoryAnchor.value = null;
  historyLoadLocked.value = false;

  if (!anchor || !element) {
    return;
  }

  await nextTick();
  const scrollDelta = element.scrollHeight - anchor.scrollHeight;
  element.scrollTop = Math.max(0, anchor.scrollTop + scrollDelta);
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

function resolveCurrentRevealText(item: TaskConversationMessageItem, fullText: string) {
  return revealText.value[item.key] ?? (item.isStreaming ? "" : fullText);
}

function shouldKeepExistingReveal(
  item: TaskConversationMessageItem,
  currentText: string,
  fullText: string,
) {
  return (
    (!item.isStreaming && currentText.length >= fullText.length) ||
    (!item.isStreaming && currentText.length === 0)
  );
}

function applyRevealProgress(
  item: TaskConversationMessageItem,
  nextReveal: Record<string, string>,
  fullText: string,
  currentText: string,
) {
  if (shouldKeepExistingReveal(item, currentText, fullText)) {
    nextReveal[item.key] = fullText;
    return null;
  }

  const progress = nextRevealProgress(fullText, currentText.length);
  nextReveal[item.key] = fullText.slice(0, progress.nextLength);
  return progress;
}

function scheduleNextReveal(delay: number) {
  revealTimer = setTimeout(() => {
    revealTimer = null;
    syncReveal();
  }, delay);
}

function syncReveal() {
  const nextReveal: Record<string, string> = {};
  let hasPendingReveal = false;
  let nextDelay = REVEAL_INTERVAL_MS;

  for (const item of props.items) {
    if (isParallelComparisonItem(item) || isWorkflowItem(item)) {
      continue;
    }

    const fullText = item.text;
    if (!fullText) {
      continue;
    }

    if (item.isStreaming) {
      nextReveal[item.key] = fullText;
      continue;
    }

    const current = resolveCurrentRevealText(item, fullText);
    const progress = applyRevealProgress(item, nextReveal, fullText, current);
    if (!progress) {
      continue;
    }

    if (progress.nextLength < fullText.length) {
      hasPendingReveal = true;
      nextDelay = Math.max(nextDelay, progress.delay);
    }
  }

  revealText.value = nextReveal;
  stopReveal();
  void nextTick().then(scrollToBottom);

  if (hasPendingReveal) {
    scheduleNextReveal(nextDelay);
  }
}

function displayText(item: TaskConversationMessageItem) {
  const fullText = sanitizedItemText(item);
  if (!fullText || fullText === STREAMING_PLACEHOLDER_TEXT) {
    return undefined;
  }
  if (item.isStreaming) {
    return fullText;
  }
  const revealed = revealText.value[item.key];
  if (revealed) {
    return sanitizeTextForDisplay(item.role, revealed);
  }
  return fullText;
}

function isRevealing(item: TaskConversationMessageItem) {
  if (item.isStreaming) {
    return false;
  }
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

function isFinalSentExpanded(key: string) {
  return expandedFinalSent.value[key] === true;
}

function isThinkingExpanded(key: string) {
  return expandedThinking.value[key] === true;
}

function toggleThinking(key: string) {
  expandedThinking.value = {
    ...expandedThinking.value,
    [key]: !expandedThinking.value[key],
  };
}

function toggleFinalSent(key: string) {
  expandedFinalSent.value = {
    ...expandedFinalSent.value,
    [key]: !expandedFinalSent.value[key],
  };
}

function hasPromptDecomposition(item: TaskConversationMessageItem) {
  return item.role === "user" && Boolean(item.userInputText);
}

function userDisplayText(item: TaskConversationMessageItem) {
  const userInputText = item.userInputText;
  if (hasPromptDecomposition(item) && userInputText) {
    return userInputText;
  }
  return sanitizedItemText(item) || item.text || "";
}

function canCopy(item: TaskConversationListItem) {
  if (isParallelComparisonItem(item) || isWorkflowItem(item)) {
    return false;
  }
  return Boolean(displayText(item) || sanitizedItemText(item) || topLevelDisplayToolCalls(item).length);
}

function canCopyParallelCandidate(candidate: TaskParallelComparisonCard) {
  return visibleMessageTurns(candidate.items).some((turn) =>
    Boolean(displayText(turn.item) || sanitizedItemText(turn.item) || turn.toolCalls.length),
  );
}

async function handleCopy(text: string) {
  if (!text.trim()) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the legacy copy path below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    document.execCommand?.("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function copyText(item: TaskConversationMessageItem, toolCalls = item.toolCalls) {
  const text = displayText(item) || sanitizedItemText(item) || item.text || "";
  const toolText = toolCalls
    .map((tool) => buildToolCopyText(tool))
    .filter(Boolean)
    .join("\n\n");
  return [text, toolText].filter(Boolean).join("\n\n");
}

function copyParallelCandidateText(candidate: TaskParallelComparisonCard) {
  const header = [
    `候选: ${candidate.label}`,
    candidate.model ? `模型: ${candidate.model}` : null,
    candidate.status ? `状态: ${candidateStatusLabel(candidate.status)}` : null,
    candidate.meta ? `说明: ${candidate.meta}` : null,
    candidate.traceNote ? `追踪: ${candidate.traceNote}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n");

  const body = visibleMessageTurns(candidate.items)
    .map((turn) => {
      const label = messageRoleLabel(turn.item);
      const content = copyText(turn.item, turn.toolCalls);
      return content ? `${label}:\n${content}` : undefined;
    })
    .filter((item): item is string => Boolean(item))
    .join("\n\n");

  return [header, body].filter(Boolean).join("\n\n");
}

watch(
  itemsSignature,
  async () => {
    syncReveal();
  },
  { immediate: true },
);

watch(
  () => [props.activeSessionId ?? "", props.forceScrollToken ?? 0].join("|"),
  async () => {
    shouldAutoScroll.value = true;
    await nextTick();
    scrollToBottom();
  },
  { immediate: true },
);

watch(
  () => props.historyLoading ?? false,
  async (isLoading, wasLoading) => {
    if (isLoading) {
      return;
    }

    if (wasLoading || historyLoadLocked.value) {
      await restoreHistoryAnchor();
    }
  },
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

.chat-message-list__history-status {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  justify-content: center;
  padding: 8px 0 10px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0.82));
}

.chat-message-list__history-trigger {
  border: 1px solid rgba(22, 119, 255, 0.16);
  border-radius: 999px;
  background: rgba(240, 247, 255, 0.96);
  color: #1677ff;
  font-size: 12px;
  line-height: 1.4;
  padding: 6px 12px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease;
}

.chat-message-list__history-trigger:hover:not(:disabled) {
  background: rgba(230, 244, 255, 1);
  border-color: rgba(22, 119, 255, 0.28);
  box-shadow: 0 6px 14px rgba(22, 119, 255, 0.08);
}

.chat-message-list__history-trigger:disabled {
  cursor: default;
  color: rgba(0, 0, 0, 0.45);
  border-color: rgba(0, 0, 0, 0.08);
  background: rgba(250, 250, 250, 0.96);
}

.chat-message-list__items {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-message-list__item-group {
  display: flex;
  flex-direction: column;
  gap: 0;
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

.chat-message-card__status-tag {
  flex-shrink: 0;
}

.chat-message-card__plain {
  margin: 0;
  white-space: pre-wrap;
  font-family: inherit;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-message-card__markdown {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-message-card__error-text {
  margin-top: 8px;
  color: #cf1322;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-message-card__thinking {
  margin-bottom: 10px;
}

.chat-message-card__thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: none;
  background: none;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.2s;
}

.chat-message-card__thinking-toggle:hover {
  color: #1677ff;
}

.chat-message-card__thinking-content {
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #f0f0f0;
  background: rgba(0, 0, 0, 0.02);
}

.chat-message-card__thinking-markdown {
  color: rgba(0, 0, 0, 0.72);
  font-size: 13px;
}

.chat-message-card__final-sent {
  margin-top: 8px;
  border-top: 1px dashed #e8e8e8;
  padding-top: 6px;
}

.chat-message-card__final-sent-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: none;
  background: none;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.2s;
}

.chat-message-card__final-sent-toggle:hover {
  color: #1677ff;
}

.chat-message-card__final-sent-content {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid #f0f0f0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  max-height: 300px;
  overflow-y: auto;
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

.chat-tool-call__headline {
  margin-top: 6px;
  white-space: pre-wrap;
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

/* ---- Workflow group ---- */
.chat-message-card--workflow {
  background: linear-gradient(180deg, #f9f5ff 0%, #ffffff 100%);
  border-color: #d3adf7;
}

.chat-message-card__workflow-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-message-card__workflow-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
}

.chat-message-card__workflow-hint {
  font-size: 12px;
}

.chat-message-card__workflow-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 12px;
  border-left: 2px solid #d3adf7;
}

.chat-message-card__workflow-step {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-message-card__workflow-step-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}

.chat-message-card__workflow-step-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 14px;
  position: relative;
}

.chat-message-card__workflow-step-messages::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 2px;
  bottom: 2px;
  width: 1px;
  background: linear-gradient(180deg, rgba(140, 140, 140, 0.1) 0%, rgba(140, 140, 140, 0.35) 18%, rgba(140, 140, 140, 0.35) 82%, rgba(140, 140, 140, 0.1) 100%);
}

.chat-message-card__workflow-entry {
  position: relative;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #ececec;
  background: #ffffff;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.03);
}

.chat-message-card__workflow-entry::before {
  content: "";
  position: absolute;
  left: -13px;
  top: 14px;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #ffffff;
  border: 2px solid #d9d9d9;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
}

.chat-message-card__workflow-entry--assistant {
  background: linear-gradient(180deg, #f8fcff 0%, #ffffff 100%);
  border-left: 3px solid #91caff;
}

.chat-message-card__workflow-entry--assistant::before {
  border-color: #91caff;
}

.chat-message-card__workflow-entry--tool {
  background: linear-gradient(180deg, #fcf8ff 0%, #ffffff 100%);
  border-left: 3px solid #c8a6ff;
}

.chat-message-card__workflow-entry--tool::before {
  border-color: #c8a6ff;
}

.chat-message-card__workflow-entry--user {
  background: linear-gradient(180deg, #fffaf0 0%, #ffffff 100%);
  border-left: 3px solid #f7c97f;
}

.chat-message-card__workflow-entry--user::before {
  border-color: #f7c97f;
}
</style>