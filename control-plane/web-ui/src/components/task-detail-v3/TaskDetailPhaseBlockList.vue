<template>
  <div class="task-detail-v3-phase-blocks__list">
    <section
      v-for="block in displayBlocks"
      :key="block.key"
      class="task-detail-v3-phase-block"
    >
      <header class="task-detail-v3-phase-block__header">
        <a-flex justify="space-between" align="center" gap="small" wrap>
          <a-space size="small" wrap>
            <a-tag color="blue">阶段 {{ block.phaseIndex }}</a-tag>
            <a-tag :color="phaseKindColor(block.phaseKind)">{{ phaseKindLabel(block.phaseKind) }}</a-tag>
            <a-tag :color="phaseStatusColor(block.status)">{{ phaseStatusLabel(block.status) }}</a-tag>
            <a-tag color="default">{{ phaseTriggerLabel(block.triggerType) }}</a-tag>
          </a-space>
          <a-typography-text v-if="block.createdAt" type="secondary" class="task-detail-v3-phase-block__time">
            {{ formatTime(block.createdAt) }}
          </a-typography-text>
        </a-flex>
      </header>

      <div class="task-detail-v3-phase-block__items">
        <template v-for="entry in block.displayItems">
          <article
            v-if="entry.kind === 'message'"
            :key="entry.key"
            class="task-detail-phase-card"
            :class="`task-detail-phase-card--${entry.item.role}`"
          >
            <a-flex justify="space-between" align="center" class="task-detail-phase-card__header">
              <a-space size="small" wrap>
                <a-tag :color="roleColor(entry.item.role)">{{ messageRoleLabel(entry.item) }}</a-tag>
                <a-tag v-if="assistantModelLabel(entry.item)" color="geekblue">{{ assistantModelLabel(entry.item) }}</a-tag>
                <a-tag
                  v-if="shouldShowMessageStatus(entry.item)"
                  :color="messageStatusColor(entry.item.status)"
                  class="task-detail-phase-card__status-tag"
                >
                  {{ messageStatusLabel(entry.item.status) }}
                </a-tag>
                <a-tag v-if="entry.item.isStreaming" color="processing">生成中</a-tag>
                <a-typography-text v-if="entry.item.createdAt" type="secondary" class="task-detail-phase-card__time">
                  {{ formatTime(entry.item.createdAt) }}
                </a-typography-text>
              </a-space>
              <a-button
                v-if="canCopyMessage(entry.item, entry.toolCalls)"
                type="text"
                size="small"
                @click="handleCopy(copyText(entry.item, entry.toolCalls))"
              >
                复制
              </a-button>
            </a-flex>

            <div v-if="assistantThinkingText(entry.item)" class="task-detail-phase-card__thinking">
              <button
                type="button"
                class="task-detail-phase-card__thinking-toggle"
                @click="toggleThinking(entry.item.key)"
              >
                {{ isThinkingExpanded(entry.item.key) ? '收起思考过程' : '查看思考过程' }}
              </button>
              <div v-if="isThinkingExpanded(entry.item.key)" class="task-detail-phase-card__thinking-content">
                <div
                  class="task-detail-phase-card__markdown task-detail-phase-card__thinking-markdown"
                  v-html="render(assistantThinkingText(entry.item) || '')"
                ></div>
              </div>
            </div>

            <div
              v-if="entry.item.role === 'assistant' && displayText(entry.item) && shouldRenderMarkdown(entry.item)"
              class="task-detail-phase-card__markdown"
              v-html="render(displayText(entry.item) || '')"
            ></div>
            <div
              v-else-if="entry.item.isStreaming && !displayText(entry.item) && entry.toolCalls.length === 0"
              class="streaming-skeleton"
              aria-hidden="true"
            >
              <span class="streaming-skeleton__dot">.</span>
              <span class="streaming-skeleton__dot">.</span>
              <span class="streaming-skeleton__dot">.</span>
              <span class="streaming-skeleton__dot">.</span>
            </div>
            <template v-else-if="hasPromptDecomposition(entry.item)">
              <pre class="task-detail-phase-card__plain">{{ userDisplayText(entry.item) }}</pre>
              <div v-if="entry.item.finalSentText" class="task-detail-phase-card__final-sent">
                <button
                  type="button"
                  class="task-detail-phase-card__final-sent-toggle"
                  @click="toggleFinalSent(entry.item.key)"
                >
                  {{ isFinalSentExpanded(entry.item.key) ? '收起完整发送内容' : '查看完整发送内容' }}
                </button>
                <pre
                  v-if="isFinalSentExpanded(entry.item.key)"
                  class="task-detail-phase-card__plain task-detail-phase-card__final-sent-content"
                >{{ entry.item.finalSentText }}</pre>
              </div>
            </template>
            <pre
              v-else-if="displayText(entry.item) || sanitizedItemText(entry.item) || shouldRenderEmptyTextFallback(entry.item, entry.toolCalls.length)"
              class="task-detail-phase-card__plain"
              :class="{ 'task-detail-phase-card__plain--streaming': entry.item.isStreaming }"
            >{{ displayText(entry.item) || sanitizedItemText(entry.item) || '暂无文本内容' }}</pre>
            <TaskToolCallGroup
              :tool-calls="entry.toolCalls"
              @open-file-preview="emit('openFilePreview', $event)"
            />
            <div v-if="messageErrorText(entry.item)" class="task-detail-phase-card__error-text">
              {{ messageErrorText(entry.item) }}
            </div>
          </article>

          <article
            v-else
            :key="entry.key"
            class="task-detail-phase-card task-detail-phase-card--parallel"
          >
            <div class="task-detail-phase-card__parallel-group">
              <a-space size="small" wrap>
                <a-tag color="volcano">并行模型结果</a-tag>
                <a-typography-text type="secondary" class="task-detail-phase-card__parallel-hint">
                  多个模型会同时回复，请在这里对比后手动决定采纳哪个结果。
                </a-typography-text>
              </a-space>

              <div class="task-detail-phase-card__parallel-grid">
                <div
                  v-for="candidate in entry.item.candidates"
                  :key="candidate.key"
                  class="task-detail-phase-card__parallel-card"
                  :class="{
                    'task-detail-phase-card__parallel-card--winner': candidate.isAdopted,
                    'task-detail-phase-card__parallel-card--recommended': candidate.isRecommended,
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
                    <div class="task-detail-phase-card__parallel-actions">
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
                    </div>
                  </a-flex>

                  <a-typography-text v-if="candidate.meta" type="secondary" class="task-detail-phase-card__parallel-meta">
                    {{ candidate.meta }}
                  </a-typography-text>
                  <a-typography-text
                    v-if="candidate.traceNote"
                    type="warning"
                    class="task-detail-phase-card__parallel-meta"
                  >
                    {{ candidate.traceNote }}
                  </a-typography-text>

                  <a-typography-text v-if="candidate.loading" type="secondary">
                    正在等待该模型返回结果...
                  </a-typography-text>
                  <a-typography-text v-else-if="visibleMessageTurns(candidate.items).length === 0" type="secondary">
                    该模型暂时还没有可展示的回复。
                  </a-typography-text>
                  <div v-else class="task-detail-phase-card__parallel-thread">
                    <div
                      v-for="turn in visibleMessageTurns(candidate.items)"
                      :key="turn.item.key"
                      class="task-detail-phase-card__parallel-entry"
                      :class="`task-detail-phase-card__parallel-entry--${turn.item.role}`"
                    >
                      <a-flex justify="space-between" align="center" class="task-detail-phase-card__parallel-entry-header">
                        <div class="task-detail-phase-card__parallel-entry-header-main">
                          <span class="task-detail-phase-card__parallel-entry-kicker">
                            {{ messageKicker(turn.item) }}
                          </span>
                          <a-space size="small" wrap>
                            <a-tag :color="roleColor(turn.item.role)">{{ messageRoleLabel(turn.item) }}</a-tag>
                            <a-tag v-if="turn.item.agent" color="geekblue">{{ turn.item.agent }}</a-tag>
                            <a-tag v-if="turn.item.isStreaming" color="processing">生成中</a-tag>
                            <a-tag
                              v-if="shouldShowMessageStatus(turn.item)"
                              :color="messageStatusColor(turn.item.status)"
                            >
                              {{ messageStatusLabel(turn.item.status) }}
                            </a-tag>
                          </a-space>
                        </div>
                        <a-typography-text v-if="turn.item.createdAt" type="secondary" class="task-detail-phase-card__time">
                          {{ formatTime(turn.item.createdAt) }}
                        </a-typography-text>
                      </a-flex>

                      <div v-if="assistantThinkingText(turn.item)" class="task-detail-phase-card__thinking">
                        <button
                          type="button"
                          class="task-detail-phase-card__thinking-toggle"
                          @click="toggleThinking(turn.item.key)"
                        >
                          {{ isThinkingExpanded(turn.item.key) ? '收起思考过程' : '查看思考过程' }}
                        </button>
                        <div v-if="isThinkingExpanded(turn.item.key)" class="task-detail-phase-card__thinking-content">
                          <div
                            class="task-detail-phase-card__markdown task-detail-phase-card__thinking-markdown"
                            v-html="render(assistantThinkingText(turn.item) || '')"
                          ></div>
                        </div>
                      </div>

                      <div
                        v-if="turn.item.role === 'assistant' && displayText(turn.item) && shouldRenderMarkdown(turn.item)"
                        class="task-detail-phase-card__markdown"
                        v-html="render(displayText(turn.item) || '')"
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
                        class="task-detail-phase-card__plain task-detail-phase-card__parallel-plain"
                        :class="{ 'task-detail-phase-card__plain--streaming': turn.item.isStreaming }"
                      >{{ displayText(turn.item) || sanitizedItemText(turn.item) || '暂无文本内容' }}</pre>
                      <TaskToolCallGroup
                        :tool-calls="turn.toolCalls"
                        @open-file-preview="emit('openFilePreview', $event)"
                      />
                      <div v-if="messageErrorText(turn.item)" class="task-detail-phase-card__error-text">
                        {{ messageErrorText(turn.item) }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <a-alert
                v-if="entry.item.judgeSummary"
                type="info"
                show-icon
                :message="entry.item.judgeSummary"
                :description="entry.item.judgeReasoning"
              />
            </div>
          </article>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { renderMarkdown } from "../../lib/markdown";
import { buildToolCopyText } from "../../lib/task-tool-call-display";
import type { TaskDetailPhaseBlock } from "../../lib/task-detail-phase-blocks";
import type {
  TaskConversationMessageItem,
  TaskConversationParallelItem,
  TaskConversationToolCallItem,
  TaskParallelComparisonCard,
} from "../../lib/message-normalize";

const props = defineProps<{
  blocks: TaskDetailPhaseBlock[];
  defaultAssistantModel?: string;
}>();

const emit = defineEmits<{
  (e: "openFilePreview", payload: { filePath: string; content?: string }): void;
  (e: "adoptCandidate", index: number): void;
}>();

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

type MessageDisplayEntry = {
  key: string;
  kind: "message";
  item: TaskConversationMessageItem;
  toolCalls: TaskConversationToolCallItem[];
};

type ParallelDisplayEntry = {
  key: string;
  kind: "parallel";
  item: TaskConversationParallelItem;
};

type PhaseBlockDisplay = TaskDetailPhaseBlock & {
  displayItems: Array<MessageDisplayEntry | ParallelDisplayEntry>;
};

const expandedThinking = ref<Record<string, boolean>>({});
const expandedFinalSent = ref<Record<string, boolean>>({});
const STREAMING_PLACEHOLDER_TEXT = "正在生成...";

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
  return asString(raw?.sessionId) ?? asString(info?.sessionID) ?? asString(info?.sessionId);
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

function hasPromptDecomposition(item: TaskConversationMessageItem) {
  return item.role === "user" && Boolean(item.userInputText);
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

function userDisplayText(item: TaskConversationMessageItem) {
  const userInputText = item.userInputText;
  if (hasPromptDecomposition(item) && userInputText) {
    return userInputText;
  }
  return sanitizedItemText(item) || item.text || "";
}

function displayText(item: TaskConversationMessageItem) {
  const text = sanitizedItemText(item);
  if (!text || text === STREAMING_PLACEHOLDER_TEXT) {
    return undefined;
  }
  return text;
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

function isParallelComparisonItem(item: unknown): item is TaskConversationParallelItem {
  return (item as TaskConversationParallelItem | undefined)?.role === "parallel";
}

function isMessageItem(item: unknown): item is TaskConversationMessageItem {
  const role = (item as TaskConversationMessageItem | undefined)?.role;
  return typeof role === "string" && role !== "parallel" && role !== "workflow";
}

const displayBlocks = computed<PhaseBlockDisplay[]>(() =>
  props.blocks.map((block) => {
    const topLevelDisplayTurns = buildConversationDisplayTurns(
      block.items.filter((item): item is TaskConversationMessageItem => isMessageItem(item)),
    );
    const topLevelDisplayTurnMap = new Map(topLevelDisplayTurns.map((turn) => [turn.item.key, turn]));
    const displayItems: Array<MessageDisplayEntry | ParallelDisplayEntry> = [];

    for (const item of block.items) {
      if (isParallelComparisonItem(item)) {
        displayItems.push({
          key: item.key,
          kind: "parallel",
          item,
        });
        continue;
      }

      if (!isMessageItem(item)) {
        continue;
      }

      const turn = topLevelDisplayTurnMap.get(item.key);
      if (!turn) {
        continue;
      }

      displayItems.push({
        key: item.key,
        kind: "message",
        item,
        toolCalls: turn.toolCalls,
      });
    }

    return {
      ...block,
      displayItems,
    } satisfies PhaseBlockDisplay;
  }),
);

function visibleMessageTurns(items: TaskConversationMessageItem[]) {
  return buildConversationDisplayTurns(items);
}

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

function canCopyMessage(item: TaskConversationMessageItem, toolCalls: TaskConversationToolCallItem[]) {
  return Boolean(displayText(item) || sanitizedItemText(item) || toolCalls.length);
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

function isThinkingExpanded(key: string) {
  return expandedThinking.value[key] === true;
}

function toggleThinking(key: string) {
  expandedThinking.value = {
    ...expandedThinking.value,
    [key]: !expandedThinking.value[key],
  };
}

function isFinalSentExpanded(key: string) {
  return expandedFinalSent.value[key] === true;
}

function toggleFinalSent(key: string) {
  expandedFinalSent.value = {
    ...expandedFinalSent.value,
    [key]: !expandedFinalSent.value[key],
  };
}

function render(text: string) {
  return renderMarkdown(text);
}

function shouldRenderMarkdown(item: TaskConversationMessageItem) {
  return item.role === "assistant" && !item.isStreaming;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function phaseKindLabel(kind: string) {
  if (kind === "parallel") return "并行";
  if (kind === "single") return "单轮";
  if (kind === "sequential_chain") return "串行";
  if (kind === "root") return "根阶段";
  if (kind === "manual_branch") return "手动分支";
  if (kind === "hook") return "Hook";
  return kind || "阶段";
}

function phaseKindColor(kind: string) {
  if (kind === "parallel") return "volcano";
  if (kind === "single") return "geekblue";
  if (kind === "sequential_chain") return "purple";
  return "default";
}

function phaseStatusLabel(status: string) {
  if (status === "running") return "执行中";
  if (status === "awaiting_adoption") return "待采纳";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  if (status === "paused") return "已暂停";
  return status || "未知";
}

function phaseStatusColor(status: string) {
  if (status === "running") return "processing";
  if (status === "awaiting_adoption") return "gold";
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  return "default";
}

function phaseTriggerLabel(triggerType: string) {
  if (triggerType === "execute") return "执行";
  if (triggerType === "continue") return "继续";
  if (triggerType === "resume") return "恢复";
  if (triggerType === "candidate_adopt") return "采纳";
  if (triggerType === "workflow_spawn") return "工作流派生";
  if (triggerType === "manual_branch") return "手动分支";
  return triggerType || "触发";
}
</script>

<style scoped>
.task-detail-v3-phase-blocks__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-detail-v3-phase-block {
  border: 1px solid #f0f0f0;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(250, 250, 250, 0.92), #ffffff);
  padding: 12px;
}

.task-detail-v3-phase-block__header {
  margin-bottom: 10px;
}

.task-detail-v3-phase-block__time {
  font-size: 12px;
}

.task-detail-v3-phase-block__items {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-detail-phase-card {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  padding: 12px;
  background: #fff;
}

.task-detail-phase-card--assistant {
  background: rgba(246, 250, 255, 0.92);
}

.task-detail-phase-card--user {
  background: rgba(255, 251, 237, 0.92);
}

.task-detail-phase-card--tool {
  background: rgba(249, 245, 255, 0.96);
}

.task-detail-phase-card__header,
.task-detail-phase-card__parallel-entry-header {
  margin-bottom: 8px;
}

.task-detail-phase-card__time {
  font-size: 12px;
}

.task-detail-phase-card__markdown,
.task-detail-phase-card__thinking-markdown {
  font-size: 13px;
  line-height: 1.7;
  color: rgba(15, 23, 42, 0.92);
}

.task-detail-phase-card__plain {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(15, 23, 42, 0.92);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
}

.task-detail-phase-card__plain--streaming {
  color: rgba(15, 23, 42, 0.72);
}

.task-detail-phase-card__parallel-plain {
  background: rgba(248, 250, 252, 0.92);
  border-radius: 8px;
  padding: 10px;
}

.task-detail-phase-card__thinking,
.task-detail-phase-card__final-sent {
  margin-bottom: 10px;
}

.task-detail-phase-card__thinking-toggle,
.task-detail-phase-card__final-sent-toggle {
  border: 0;
  background: transparent;
  padding: 0;
  color: #1677ff;
  cursor: pointer;
  font-size: 12px;
}

.task-detail-phase-card__thinking-content,
.task-detail-phase-card__final-sent-content {
  margin-top: 8px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.04);
}

.task-detail-phase-card__error-text {
  margin-top: 8px;
  color: #cf1322;
  font-size: 12px;
  white-space: pre-wrap;
}

.task-detail-phase-card__parallel-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-detail-phase-card__parallel-hint,
.task-detail-phase-card__parallel-meta {
  font-size: 12px;
}

.task-detail-phase-card__parallel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}

.task-detail-phase-card__parallel-card {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  padding: 12px;
  background: rgba(248, 250, 252, 0.82);
}

.task-detail-phase-card__parallel-card--winner {
  border-color: rgba(250, 173, 20, 0.55);
  background: rgba(255, 250, 230, 0.92);
}

.task-detail-phase-card__parallel-card--recommended {
  border-color: rgba(22, 119, 255, 0.28);
}

.task-detail-phase-card__parallel-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.task-detail-phase-card__parallel-thread {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-detail-phase-card__parallel-entry {
  border-top: 1px dashed rgba(15, 23, 42, 0.08);
  padding-top: 10px;
}

.task-detail-phase-card__parallel-entry:first-child {
  border-top: 0;
  padding-top: 0;
}

.task-detail-phase-card__parallel-entry-kicker {
  display: inline-block;
  margin-right: 8px;
  font-size: 11px;
  color: rgba(15, 23, 42, 0.45);
}

.task-detail-phase-card__parallel-entry-header-main {
  min-width: 0;
}

.streaming-skeleton {
  display: inline-flex;
  gap: 4px;
  color: rgba(15, 23, 42, 0.45);
  font-size: 18px;
  line-height: 1;
}

.streaming-skeleton__dot {
  animation: task-detail-phase-streaming-blink 1.2s infinite ease-in-out;
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

@keyframes task-detail-phase-streaming-blink {
  0%,
  80%,
  100% {
    opacity: 0.28;
  }
  40% {
    opacity: 1;
  }
}
</style>