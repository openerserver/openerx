import type {
  ExecutionCandidate,
  ProjectionRunCandidate,
  ProjectionRunRecord,
} from "./api";
import {
  getTaskConversationMessages,
  getTaskExecutionTraceView,
} from "./api";
import {
  asRecord,
  asString,
  type LiveAssistantState,
  normalizeSessionConversationItems,
  type TaskConversationListItem,
  type TaskConversationMessageItem,
  type TaskConversationParallelItem,
  type TaskConversationToolCallItem,
  type TaskParallelComparisonCard,
} from "./message-normalize";
import { toTimestampMs } from "./task-detail-parallel-runtime";
import { normalizeTraceConversationItems } from "./task-trace-conversation";

export type ParallelCandidateTraceState = {
  state?: "incomplete" | "stale";
  note?: string;
};

export type ParallelCandidateSessionState = {
  items: TaskConversationMessageItem[];
  hasSettledReply: boolean;
  traceState: ParallelCandidateTraceState;
};

function cloneParallelCandidateMessageItem(
  item: TaskConversationMessageItem,
): TaskConversationMessageItem {
  return {
    ...item,
    toolCalls: item.toolCalls.map((toolCall) => ({ ...toolCall })),
  };
}

function normalizeParallelCandidateLiveText(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function hasDisplayableParallelCandidateLiveReply(liveState?: LiveAssistantState | null) {
  if (!liveState) {
    return false;
  }

  return liveState.orderedAssistantMessageIds.some((messageId) => {
    if (liveState.incompleteIds.has(messageId)) {
      return false;
    }

    return Boolean(normalizeParallelCandidateLiveText(liveState.textById.get(messageId)));
  });
}

export function applyParallelCandidateLiveAssistantState(args: {
  items: TaskConversationMessageItem[];
  liveState?: LiveAssistantState | null;
}) {
  const liveState = args.liveState;
  if (!liveState || liveState.orderedAssistantMessageIds.length === 0) {
    return {
      items: args.items,
      hasSettledReply: false,
    };
  }

  const nextItems = args.items.map((item) => cloneParallelCandidateMessageItem(item));
  const assistantIndexById = new Map<string, number>();
  for (let index = 0; index < nextItems.length; index += 1) {
    const item = nextItems[index];
    if (item.role === "assistant") {
      assistantIndexById.set(item.key, index);
    }
  }

  for (const messageId of liveState.orderedAssistantMessageIds) {
    const meta = liveState.metaById.get(messageId);
    const liveText = normalizeParallelCandidateLiveText(liveState.textById.get(messageId));
    const isStreaming = liveState.incompleteIds.has(messageId);
    const existingIndex = assistantIndexById.get(messageId);

    if (typeof existingIndex === "number") {
      const existing = nextItems[existingIndex];
      nextItems[existingIndex] = {
        ...existing,
        agent: existing.agent ?? meta?.agent,
        model: existing.model ?? meta?.modelLabel,
        text:
          liveText && liveText.length > (existing.text?.length ?? 0) ? liveText : existing.text,
        createdAt: existing.createdAt ?? meta?.createdAt,
        isStreaming,
      };
      continue;
    }

    if (!isStreaming && !liveText) {
      continue;
    }

    nextItems.push({
      key: messageId,
      role: "assistant",
      agent: meta?.agent,
      model: meta?.modelLabel,
      text: liveText ?? "正在生成...",
      toolCalls: [],
      createdAt: meta?.createdAt,
      raw: null,
      isStreaming,
    });
  }

  return {
    items: nextItems,
    hasSettledReply: hasDisplayableParallelCandidateLiveReply(liveState),
  };
}

function resolveParallelCandidateDisplayStatus(
  candidate: Pick<ExecutionCandidate, "status"> | Pick<ProjectionRunCandidate, "status">,
  items: TaskConversationMessageItem[],
  taskStatus?: string | null,
  hasSettledReply = false,
) {
  if (candidate.status !== "running") {
    return candidate.status || "pending";
  }

  if (taskStatus !== "running") {
    return "completed";
  }

  const hasCompletedReply = items.some(
    (item) =>
      item.role === "assistant" &&
      !item.isStreaming &&
      ((typeof item.text === "string" && item.text.trim().length > 0) || item.toolCalls.length > 0),
  );

  return hasCompletedReply || hasSettledReply ? "completed" : "running";
}

export function resolveParallelCandidateTraceState(
  trace: Awaited<ReturnType<typeof getTaskExecutionTraceView>>,
) {
  const cacheState = trace.timelineMeta?.cacheState;
  if (cacheState === "partial") {
    return {
      state: "incomplete" as const,
      note: "当前候选只拿到了部分执行追踪，展示内容可能不完整。",
    };
  }
  if (cacheState === "none") {
    return {
      state: "incomplete" as const,
      note: "当前候选暂时没有可用的执行追踪时间线。",
    };
  }
  return {};
}

function buildParallelCandidateFallbackItem(
  run: ProjectionRunRecord,
  candidate: ProjectionRunCandidate,
  index: number,
) {
  const fallbackText = typeof candidate.result === "string" ? candidate.result.trim() : "";
  if (!fallbackText) {
    return null;
  }

  return {
    key: `${run.parallelRunId}:${candidate.sessionId || `candidate-${index}`}:fallback-result`,
    role: "assistant",
    agent: candidate.agent,
    text: fallbackText,
    toolCalls: [],
    createdAt: candidate.finishedAt ?? candidate.startedAt ?? run.finishedAt ?? run.startedAt,
    raw: {
      synthetic: true,
      source: "parallel-candidate-result-fallback",
      runId: run.parallelRunId,
      candidateIndex: index,
      sessionId: candidate.sessionId,
    },
    isStreaming: false,
  } satisfies TaskConversationMessageItem;
}

function resolveParallelRunConversationAnchorCreatedAt(
  run: ProjectionRunRecord,
  baseConversationItems: TaskConversationListItem[],
  parallelCandidateItems: Record<string, TaskConversationMessageItem[]>,
) {
  const anchorMessageCreatedAt =
    typeof run.anchorMessageId === "string"
      ? baseConversationItems.find((item) => {
          const raw = asRecord(item.raw);
          const info = asRecord(raw?.info);
          const messageId = asString(info?.id) ?? asString(raw?.id) ?? item.key;
          return messageId === run.anchorMessageId;
        })?.createdAt
      : undefined;

  if (anchorMessageCreatedAt) {
    return anchorMessageCreatedAt;
  }

  const parallelExecutionFinishedAtMs = toTimestampMs(run.finishedAt);

  const candidatePromptCreatedAt = run.candidateSessions
    .flatMap((candidate) => {
      const candidateStartedAtMs = toTimestampMs(candidate.startedAt ?? run.startedAt);
      return candidate.sessionId ? (parallelCandidateItems[candidate.sessionId] ?? []).filter((item) => {
        if (item.role !== "user" || typeof item.createdAt !== "string" || item.createdAt.length === 0) {
          return false;
        }

        const itemCreatedAtMs = toTimestampMs(item.createdAt);
        if (itemCreatedAtMs == null) {
          return false;
        }

        if (candidateStartedAtMs != null && itemCreatedAtMs < candidateStartedAtMs) {
          return false;
        }

        if (parallelExecutionFinishedAtMs != null && itemCreatedAtMs > parallelExecutionFinishedAtMs) {
          return false;
        }

        return true;
      }) : [];
    })
    .filter(
      (item): item is TaskConversationMessageItem =>
        item.role === "user" && typeof item.createdAt === "string" && item.createdAt.length > 0,
    )
    .map((item) => item.createdAt)
    .sort((left, right) => (toTimestampMs(right) ?? 0) - (toTimestampMs(left) ?? 0))[0];

  if (candidatePromptCreatedAt) {
    return candidatePromptCreatedAt;
  }

  return run.startedAt ?? run.finishedAt;
}

export function buildParallelComparisonCardsForRun(args: {
  run: ProjectionRunRecord;
  currentParallelRunId?: string;
  taskStatus?: string | null;
  parallelCandidateItems: Record<string, TaskConversationMessageItem[]>;
  parallelCandidateSettledReply: Record<string, boolean>;
  parallelCandidateTraceStates: Record<string, ParallelCandidateTraceState>;
  parallelCandidateLiveStates?: Record<string, LiveAssistantState>;
}) {
  const parallelExecutionFinishedAtMs = toTimestampMs(args.run.finishedAt);
  const cards = args.run.candidateSessions.map((candidate, index) => {
    const sessionId = candidate.sessionId;
    const candidateStartedAtMs = toTimestampMs(candidate.startedAt ?? args.run.startedAt);
    const items = sessionId ? (args.parallelCandidateItems[sessionId] ?? []) : [];
    const visibleItems = items.filter((item) => {
      if (item.role === "user") {
        return false;
      }
      const itemCreatedAtMs = toTimestampMs(item.createdAt);
      if (
        candidateStartedAtMs != null &&
        itemCreatedAtMs != null &&
        itemCreatedAtMs < candidateStartedAtMs
      ) {
        return false;
      }
      if (parallelExecutionFinishedAtMs == null) {
        return true;
      }
      return itemCreatedAtMs == null || itemCreatedAtMs <= parallelExecutionFinishedAtMs;
    });
    const fallbackItem = buildParallelCandidateFallbackItem(args.run, candidate, index);
    const displayItems = visibleItems.length > 0 || !fallbackItem ? visibleItems : [fallbackItem];
    const liveDisplayState = applyParallelCandidateLiveAssistantState({
      items: displayItems,
      liveState: sessionId ? args.parallelCandidateLiveStates?.[sessionId] : undefined,
    });
    const mergedDisplayItems = liveDisplayState.items;
    const metaParts = [candidate.agent].filter((value): value is string => Boolean(value));
    const status = resolveParallelCandidateDisplayStatus(
      candidate,
      mergedDisplayItems,
      args.taskStatus,
      sessionId
        ? args.parallelCandidateSettledReply[sessionId] === true ||
            liveDisplayState.hasSettledReply
        : false,
    );
    const traceState = sessionId ? args.parallelCandidateTraceStates[sessionId] : undefined;
    return {
      key: `${args.run.parallelRunId}:${sessionId || `candidate-${index}`}`,
      index,
      label: candidate.label || `候选 ${index + 1}`,
      model: candidate.model,
      status,
      traceState: traceState?.state,
      traceNote: traceState?.note,
      meta: metaParts.join(" · ") || undefined,
      loading: mergedDisplayItems.length === 0 && status === "running",
      items: mergedDisplayItems,
      canAdopt: false,
      isAdopted:
        typeof args.run.winnerCandidateIndex === "number" &&
        args.run.winnerCandidateIndex === index,
      isRecommended:
        typeof args.run.winnerCandidateIndex !== "number" &&
        args.run.judgeResult?.winnerIndex === index,
    } satisfies TaskParallelComparisonCard;
  });

  const allCandidatesSettled =
    cards.length >= 2 &&
    cards.every((candidate) => candidate.status === "completed" || candidate.status === "failed");

  return cards.map((candidate) => ({
    ...candidate,
    canAdopt:
      args.run.parallelRunId === args.currentParallelRunId &&
      allCandidatesSettled &&
      candidate.status === "completed" &&
      typeof args.run.winnerCandidateIndex !== "number",
  }));
}

export function buildParallelConversationItems(args: {
  visibleParallelRuns: ProjectionRunRecord[];
  currentParallelRunId?: string;
  taskStatus?: string | null;
  baseConversationItems: TaskConversationListItem[];
  parallelCandidateItems: Record<string, TaskConversationMessageItem[]>;
  parallelCandidateSettledReply: Record<string, boolean>;
  parallelCandidateTraceStates: Record<string, ParallelCandidateTraceState>;
  parallelCandidateLiveStates?: Record<string, LiveAssistantState>;
}) {
  const items: TaskConversationParallelItem[] = [];

  for (const run of args.visibleParallelRuns) {
    const cards = buildParallelComparisonCardsForRun({
      run,
      currentParallelRunId: args.currentParallelRunId,
      taskStatus: args.taskStatus,
      parallelCandidateItems: args.parallelCandidateItems,
      parallelCandidateSettledReply: args.parallelCandidateSettledReply,
      parallelCandidateTraceStates: args.parallelCandidateTraceStates,
      parallelCandidateLiveStates: args.parallelCandidateLiveStates,
    });
    if (cards.length < 2) {
      continue;
    }

    const winnerLabel =
      typeof run.judgeResult?.winnerIndex === "number"
        ? run.candidateSessions[run.judgeResult.winnerIndex]?.label ||
          `候选 ${run.judgeResult.winnerIndex + 1}`
        : undefined;
    const judgeSummary = winnerLabel
      ? Array.isArray(run.judgeResult?.scores) && run.judgeResult.scores.length > 0
        ? `Judge 推荐 ${winnerLabel}，得分 ${run.judgeResult.scores.map((score) => Number(score).toFixed(1)).join(" / ")}`
        : `Judge 推荐 ${winnerLabel}`
      : undefined;

    items.push({
      key: `parallel-${run.parallelRunId}`,
      role: "parallel",
      createdAt: resolveParallelRunConversationAnchorCreatedAt(
        run,
        args.baseConversationItems,
        args.parallelCandidateItems,
      ),
      candidates: cards,
      judgeSummary,
      judgeReasoning: run.judgeResult?.reasoning,
      raw: run,
      toolCalls: [],
    });
  }

  return items;
}

function shouldHideUnadoptedParallelMessagesForRun(parallelItem: TaskConversationParallelItem) {
  return !parallelItem.candidates?.some((candidate) => candidate.isAdopted);
}

function findParallelConversationAnchorIndex(
  items: TaskConversationListItem[],
  parallelItem: TaskConversationParallelItem,
) {
  const createdAtMs = toTimestampMs(parallelItem.createdAt);

  if (createdAtMs != null) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.role !== "user") continue;
      const itemCreatedAtMs = toTimestampMs(item.createdAt);
      if (itemCreatedAtMs == null || itemCreatedAtMs <= createdAtMs) {
        return index;
      }
    }
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

function findNextUserConversationIndex(items: TaskConversationListItem[], anchorIndex: number) {
  for (let index = anchorIndex + 1; index < items.length; index += 1) {
    if (items[index]?.role === "user") {
      return index;
    }
  }

  return items.length;
}

function resolveParallelConversationWindowEndAt(parallelItem: TaskConversationParallelItem) {
  return parallelItem.candidates
    .flatMap((candidate) => candidate.items)
    .map((item) => toTimestampMs(item.createdAt))
    .filter((value): value is number => value != null)
    .sort((left, right) => right - left)[0];
}

function insertParallelConversationItem(
  items: TaskConversationListItem[],
  parallelItem: TaskConversationParallelItem,
) {
  const anchorIndex = findParallelConversationAnchorIndex(items, parallelItem);
  if (shouldHideUnadoptedParallelMessagesForRun(parallelItem)) {
    if (anchorIndex < 0) {
      items.unshift(parallelItem);
      return;
    }

    const parallelWindowEndAt = resolveParallelConversationWindowEndAt(parallelItem);
    const rawRun = asRecord(parallelItem.raw);
    const hasFactualParallelAnchor =
      typeof asString(rawRun?.anchorMessageId) === "string" ||
      parallelItem.candidates.some((candidate) =>
        candidate.items.some((item) => item.role === "user"),
      );
    if (parallelWindowEndAt != null && hasFactualParallelAnchor) {
      let replaceEndIndex = anchorIndex + 1;
      while (replaceEndIndex < items.length) {
        const currentItem = items[replaceEndIndex];
        const currentItemCreatedAt = toTimestampMs(currentItem?.createdAt);
        if (currentItemCreatedAt == null) {
          break;
        }
        if (currentItemCreatedAt > parallelWindowEndAt) {
          break;
        }
        replaceEndIndex += 1;
      }

      items.splice(anchorIndex + 1, replaceEndIndex - (anchorIndex + 1), parallelItem);
      return;
    }

    const nextUserIndex = findNextUserConversationIndex(items, anchorIndex);
    items.splice(anchorIndex + 1, nextUserIndex - (anchorIndex + 1), parallelItem);
    return;
  }

  if (anchorIndex >= 0) {
    const hasAdoptedCandidate = parallelItem.candidates?.some((candidate) => candidate.isAdopted);
    if (hasAdoptedCandidate) {
      items.splice(anchorIndex + 1, 0, parallelItem);
      return;
    }

    const nextUserIndex = findNextUserConversationIndex(items, anchorIndex);
    items.splice(nextUserIndex, 0, parallelItem);
    return;
  }

  items.push(parallelItem);
}

export function buildConversationItemsWithParallelRuns(args: {
  baseConversationItems: TaskConversationListItem[];
  parallelConversationItems: TaskConversationParallelItem[];
}) {
  const base = [...args.baseConversationItems];
  if (args.parallelConversationItems.length === 0) {
    return base;
  }

  for (const parallelConversationItem of args.parallelConversationItems) {
    insertParallelConversationItem(base, parallelConversationItem);
  }

  return base;
}

function hasDisplayableParallelCandidateItems(items: TaskConversationMessageItem[]) {
  return items.some(
    (item) =>
      item.role !== "user" &&
      ((typeof item.text === "string" && item.text.trim().length > 0) || item.toolCalls.length > 0),
  );
}

function traceHasSettledCandidateReply(
  trace: Awaited<ReturnType<typeof getTaskExecutionTraceView>>,
) {
  if (typeof trace?.latestResponse === "string" && trace.latestResponse.trim().length > 0) {
    return true;
  }

  const messages = Array.isArray(trace?.messages) ? trace.messages : [];
  if (
    messages.some(
      (message) =>
        message.role === "assistant" &&
        typeof message.text === "string" &&
        message.text.trim().length > 0,
    )
  ) {
    return true;
  }

  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  return timeline.some(
    (item) =>
      item.role === "assistant" &&
      typeof item.text === "string" &&
      item.text.trim().length > 0,
  );
}

function normalizeParallelCandidateToolText(value?: string) {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : undefined;
}

function preferParallelCandidateToolText(primary?: string, secondary?: string) {
  return normalizeParallelCandidateToolText(primary) ?? normalizeParallelCandidateToolText(secondary);
}

function mergeParallelCandidateToolText(primary?: string, secondary?: string) {
  const normalizedPrimary = normalizeParallelCandidateToolText(primary);
  const normalizedSecondary = normalizeParallelCandidateToolText(secondary);
  if (!normalizedPrimary) {
    return normalizedSecondary;
  }
  if (!normalizedSecondary) {
    return normalizedPrimary;
  }
  if (normalizedPrimary === normalizedSecondary) {
    return normalizedPrimary;
  }
  if (normalizedPrimary.includes(normalizedSecondary)) {
    return normalizedPrimary;
  }
  if (normalizedSecondary.includes(normalizedPrimary)) {
    return normalizedSecondary;
  }
  return `${normalizedPrimary}\n\n${normalizedSecondary}`;
}

function appendParallelCandidateToolIdentifier(identifiers: Set<string>, value: unknown) {
  const normalizedValue = asString(value)?.trim();
  if (!normalizedValue) {
    return;
  }

  identifiers.add(normalizedValue);
  const marker = ":tool:";
  const markerIndex = normalizedValue.lastIndexOf(marker);
  if (markerIndex < 0) {
    return;
  }

  const suffix = normalizedValue
    .slice(markerIndex + marker.length)
    .split(":")[0]
    ?.trim();
  if (suffix) {
    identifiers.add(suffix);
  }
}

function parallelCandidateMessageParts(item: TaskConversationMessageItem) {
  const record = asRecord(item.raw);
  const parts = record?.parts;
  return Array.isArray(parts)
    ? parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
}

type ParallelCandidateToolRef = {
  index: number;
  identifiers: Set<string>;
};

function buildParallelCandidateToolRefs(item: TaskConversationMessageItem): ParallelCandidateToolRef[] {
  const toolParts = parallelCandidateMessageParts(item).filter(
    (part) => asString(part.type) === "tool",
  );

  return item.toolCalls.map((toolCall, index) => {
    const identifiers = new Set<string>();
    appendParallelCandidateToolIdentifier(identifiers, toolCall.key);

    const part = toolParts[index];
    appendParallelCandidateToolIdentifier(identifiers, part?.callID);
    appendParallelCandidateToolIdentifier(identifiers, part?.messageID);
    appendParallelCandidateToolIdentifier(identifiers, part?.id);

    return {
      index,
      identifiers,
    } satisfies ParallelCandidateToolRef;
  });
}

function extractParallelCandidateToolIdentifiers(item: TaskConversationMessageItem) {
  const identifiers = new Set<string>();
  const record = asRecord(item.raw);
  const info = asRecord(record?.info);
  appendParallelCandidateToolIdentifier(identifiers, record?.id);
  appendParallelCandidateToolIdentifier(identifiers, info?.id);

  for (const part of parallelCandidateMessageParts(item)) {
    if (asString(part.type) !== "tool") {
      continue;
    }

    appendParallelCandidateToolIdentifier(identifiers, part.callID);
    appendParallelCandidateToolIdentifier(identifiers, part.messageID);
    appendParallelCandidateToolIdentifier(identifiers, part.id);
  }

  return identifiers;
}

function shareParallelCandidateToolIdentifiers(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return false;
  }

  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function findParallelCandidateToolCallIndex(
  item: TaskConversationMessageItem,
  identifiers: Set<string>,
) {
  const toolRefs = buildParallelCandidateToolRefs(item);
  if (toolRefs.length === 0) {
    return -1;
  }

  const matchedRef = toolRefs.find((toolRef) =>
    shareParallelCandidateToolIdentifiers(toolRef.identifiers, identifiers),
  );
  if (matchedRef) {
    return matchedRef.index;
  }

  return toolRefs.length === 1 ? 0 : -1;
}

function cloneParallelCandidateItem(item: TaskConversationMessageItem): TaskConversationMessageItem {
  return cloneParallelCandidateMessageItem(item);
}

function mergeParallelCandidateToolCall(
  target: TaskConversationToolCallItem,
  incoming: TaskConversationToolCallItem,
  outputText?: string,
): TaskConversationToolCallItem {
  return {
    ...target,
    stateLabel: incoming.stateLabel || target.stateLabel,
    stateColor: incoming.stateColor || target.stateColor,
    headline: preferParallelCandidateToolText(target.headline, incoming.headline),
    description: preferParallelCandidateToolText(target.description, incoming.description),
    command: preferParallelCandidateToolText(target.command, incoming.command),
    filePath: preferParallelCandidateToolText(target.filePath, incoming.filePath),
    fileContent: mergeParallelCandidateToolText(target.fileContent, incoming.fileContent),
    inputPreview: mergeParallelCandidateToolText(target.inputPreview, incoming.inputPreview),
    outputPreview: mergeParallelCandidateToolText(
      mergeParallelCandidateToolText(target.outputPreview, incoming.outputPreview),
      outputText,
    ),
  };
}

function findParallelCandidateToolMergeTargetIndex(
  items: TaskConversationMessageItem[],
  sourceIdentifiers: Set<string>,
) {
  if (sourceIdentifiers.size === 0) {
    return -1;
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.role === "user") {
      break;
    }
    if (item.toolCalls.length === 0) {
      if (item.role === "assistant") {
        break;
      }
      continue;
    }

    if (findParallelCandidateToolCallIndex(item, sourceIdentifiers) >= 0) {
      return index;
    }
  }

  return -1;
}

function condenseParallelCandidateToolItems(items: TaskConversationMessageItem[]) {
  const condensed: TaskConversationMessageItem[] = [];

  for (const item of items) {
    const clonedItem = cloneParallelCandidateItem(item);
    if (clonedItem.role !== "tool") {
      condensed.push(clonedItem);
      continue;
    }

    const sourceIdentifiers = extractParallelCandidateToolIdentifiers(clonedItem);
    const targetIndex = findParallelCandidateToolMergeTargetIndex(condensed, sourceIdentifiers);
    if (targetIndex < 0) {
      condensed.push(clonedItem);
      continue;
    }

    const mergedTarget = cloneParallelCandidateItem(condensed[targetIndex]);
    let merged = false;

    if (clonedItem.toolCalls.length > 0) {
      const sourceToolRefs = buildParallelCandidateToolRefs(clonedItem);
      clonedItem.toolCalls.forEach((toolCall, toolCallIndex) => {
        const targetToolCallIndex = findParallelCandidateToolCallIndex(
          mergedTarget,
          sourceToolRefs[toolCallIndex]?.identifiers ?? sourceIdentifiers,
        );
        if (targetToolCallIndex < 0) {
          return;
        }

        mergedTarget.toolCalls[targetToolCallIndex] = mergeParallelCandidateToolCall(
          mergedTarget.toolCalls[targetToolCallIndex],
          toolCall,
        );
        merged = true;
      });
    }

    const textOutput = normalizeParallelCandidateToolText(clonedItem.text);
    if (textOutput) {
      const targetToolCallIndex = findParallelCandidateToolCallIndex(
        mergedTarget,
        sourceIdentifiers,
      );
      if (targetToolCallIndex >= 0) {
        mergedTarget.toolCalls[targetToolCallIndex] = mergeParallelCandidateToolCall(
          mergedTarget.toolCalls[targetToolCallIndex],
          mergedTarget.toolCalls[targetToolCallIndex],
          textOutput,
        );
        merged = true;
      }
    }

    if (merged) {
      condensed[targetIndex] = mergedTarget;
      continue;
    }

    condensed.push(clonedItem);
  }

  return condensed;
}

async function loadParallelCandidateSessionMessageFallback(
  currentTaskId: string,
  sessionId: string,
) {
  try {
    const response = await getTaskConversationMessages(currentTaskId, sessionId, {
      includeLineage: false,
    });
    const items = condenseParallelCandidateToolItems(
      normalizeSessionConversationItems(Array.isArray(response.data) ? response.data : []),
    );

    return {
      items,
      hasSettledReply: hasDisplayableParallelCandidateItems(items),
    };
  } catch {
    return {
      items: [] as TaskConversationMessageItem[],
      hasSettledReply: false,
    };
  }
}

function buildParallelCandidateSessionFallbackTraceState(args: {
  traceState?: ParallelCandidateTraceState;
  reason: "empty-trace" | "trace-error";
}) {
  if (args.reason === "trace-error") {
    return {
      state: "stale" as const,
      note: "执行追踪暂时不可用，当前已回退到会话消息展示候选回复。",
    };
  }

  return {
    state: args.traceState?.state ?? ("incomplete" as const),
    note: "执行追踪暂未返回可展示回复，当前已回退到会话消息展示候选内容。",
  };
}

export async function loadParallelCandidateSessionState(args: {
  taskId: string;
  sessionId: string;
  silent?: boolean;
  cachedState?: ParallelCandidateSessionState;
  onProgress?: (state: ParallelCandidateSessionState) => void;
}) {
  const sessionMessageFallbackPromise = loadParallelCandidateSessionMessageFallback(
    args.taskId,
    args.sessionId,
  );
  const tracePromise = getTaskExecutionTraceView(args.taskId, args.sessionId, {
    includeLineage: false,
  })
    .then((trace) => ({ ok: true as const, trace }))
    .catch((error) => ({ ok: false as const, error }));

  const sessionMessageFallback = await sessionMessageFallbackPromise;
  const canDisplaySessionFallback =
    hasDisplayableParallelCandidateItems(sessionMessageFallback.items) ||
    sessionMessageFallback.hasSettledReply;
  if (canDisplaySessionFallback) {
    args.onProgress?.({
      items: sessionMessageFallback.items,
      hasSettledReply: sessionMessageFallback.hasSettledReply,
      traceState: args.cachedState?.traceState ?? {},
    });
  }

  const traceResult = await tracePromise;
  if (traceResult.ok) {
    const trace = traceResult.trace;
    const traceItems = condenseParallelCandidateToolItems(normalizeTraceConversationItems(trace));
    const hasDisplayableTraceItems = hasDisplayableParallelCandidateItems(traceItems);
    const hasSettledReply = traceHasSettledCandidateReply(trace);
    const traceState = resolveParallelCandidateTraceState(trace);
    const shouldUseSessionDisplay = canDisplaySessionFallback;

    if (shouldUseSessionDisplay) {
      return {
        items: sessionMessageFallback.items,
        hasSettledReply: hasSettledReply || sessionMessageFallback.hasSettledReply,
        traceState:
          hasDisplayableTraceItems || hasSettledReply
            ? traceState
            : buildParallelCandidateSessionFallbackTraceState({
                traceState,
                reason: "empty-trace",
              }),
      } satisfies ParallelCandidateSessionState;
    }

    return {
      items: traceItems,
      hasSettledReply,
      traceState,
    } satisfies ParallelCandidateSessionState;
  }

  if (canDisplaySessionFallback) {
    return {
      items: sessionMessageFallback.items,
      hasSettledReply: true,
      traceState: buildParallelCandidateSessionFallbackTraceState({
        reason: "trace-error",
      }),
    } satisfies ParallelCandidateSessionState;
  }

  const hasCachedTrace =
    args.silent &&
    ((args.cachedState?.items.length ?? 0) > 0 ||
      args.cachedState?.hasSettledReply === true ||
      Boolean(args.cachedState?.traceState && Object.keys(args.cachedState.traceState).length > 0));
  return {
    items: args.silent ? (args.cachedState?.items ?? []) : [],
    hasSettledReply: args.silent ? args.cachedState?.hasSettledReply === true : false,
    traceState: hasCachedTrace
      ? {
          state: "stale" as const,
          note: "静默刷新失败，当前展示的是上一次成功加载的执行追踪。",
        }
      : {},
  } satisfies ParallelCandidateSessionState;
}