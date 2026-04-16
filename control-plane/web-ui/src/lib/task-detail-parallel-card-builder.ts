import type {
  ExecutionCandidate,
  ExecutionTraceTimelineMeta,
  ProjectionRunCandidate,
  ProjectionRunRecord,
  TaskExecutionTrace,
} from "./api";
import type {
  LiveAssistantState,
  TaskConversationMessageItem,
  TaskParallelComparisonCard,
} from "./message-normalize";
import { toTimestampMs } from "./task-detail-parallel-runtime";
import { resolveTraceTimelineAvailability } from "./task-trace-timeline-state";

export type ParallelCandidateTraceState = {
  state?: "incomplete" | "stale";
  note?: string;
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

export function resolveParallelCandidateTraceState(trace: TaskExecutionTrace) {
  return resolveParallelCandidateTraceStateFromTimelineMeta(
    trace.timelineMeta,
    trace.timeline?.length ?? 0,
  );
}

export function resolveParallelCandidateTraceStateFromTimelineMeta(
  timelineMeta?: Pick<ExecutionTraceTimelineMeta, "cacheState" | "complete" | "itemCount" | "reconcileRequired"> | null,
  fallbackItemCount = 0,
) {
  const itemCount =
    typeof timelineMeta?.itemCount === "number" ? timelineMeta.itemCount : fallbackItemCount;
  const timelineAvailability = resolveTraceTimelineAvailability(timelineMeta, itemCount);

  if (timelineMeta?.reconcileRequired === true) {
    return {
      state: "incomplete" as const,
      note:
        itemCount > 0
          ? "当前候选执行追踪仍在同步，展示内容可能不完整。"
          : "当前候选执行追踪仍在同步，暂时没有可用的执行追踪时间线。",
    };
  }

  if (timelineAvailability === "partial") {
    return {
      state: "incomplete" as const,
      note: "当前候选只拿到了部分执行追踪，展示内容可能不完整。",
    };
  }
  if (timelineAvailability === "none") {
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