import type { TaskExecutionTrace } from "./api";
import type { TaskConversationMessageItem } from "./message-normalize";
import type { ParallelCandidateTraceState } from "./task-detail-parallel-card-builder";

export type ParallelCandidateSessionState = {
  items: TaskConversationMessageItem[];
  hasSettledReply: boolean;
  traceState: ParallelCandidateTraceState;
};

type ParallelCandidateFallbackState = Pick<
  ParallelCandidateSessionState,
  "items" | "hasSettledReply"
>;

type SuccessfulTraceLoad = {
  ok: true;
  trace: TaskExecutionTrace;
  traceItems: TaskConversationMessageItem[];
  traceState: ParallelCandidateTraceState;
};

type FailedTraceLoad = {
  ok: false;
};

function traceHasSettledCandidateReply(trace: TaskExecutionTrace) {
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

export function hasDisplayableParallelCandidateItems(items: TaskConversationMessageItem[]) {
  return items.some(
    (item) =>
      item.role !== "user" &&
      ((typeof item.text === "string" && item.text.trim().length > 0) || item.toolCalls.length > 0),
  );
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

export function resolveParallelCandidateSessionStateFromSources(args: {
  cachedState?: ParallelCandidateSessionState;
  sessionFallback: ParallelCandidateFallbackState;
  silent?: boolean;
  traceLoad: SuccessfulTraceLoad | FailedTraceLoad;
}): ParallelCandidateSessionState {
  const canDisplaySessionFallback =
    hasDisplayableParallelCandidateItems(args.sessionFallback.items) ||
    args.sessionFallback.hasSettledReply;

  if (args.traceLoad.ok) {
    const hasDisplayableTraceItems = hasDisplayableParallelCandidateItems(args.traceLoad.traceItems);
    const hasSettledReply = traceHasSettledCandidateReply(args.traceLoad.trace);

    if (canDisplaySessionFallback) {
      return {
        items: args.sessionFallback.items,
        hasSettledReply: hasSettledReply || args.sessionFallback.hasSettledReply,
        traceState:
          hasDisplayableTraceItems || hasSettledReply
            ? args.traceLoad.traceState
            : buildParallelCandidateSessionFallbackTraceState({
                traceState: args.traceLoad.traceState,
                reason: "empty-trace",
              }),
      };
    }

    return {
      items: args.traceLoad.traceItems,
      hasSettledReply,
      traceState: args.traceLoad.traceState,
    };
  }

  if (canDisplaySessionFallback) {
    return {
      items: args.sessionFallback.items,
      hasSettledReply: true,
      traceState: buildParallelCandidateSessionFallbackTraceState({
        reason: "trace-error",
      }),
    };
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
  };
}