import type { TaskExecutionTrace } from "./api";
import type { TaskConversationMessageItem } from "./message-normalize";
import type { ParallelCandidateTraceState } from "./task-detail-parallel-card-builder";

export type ParallelCandidateSessionState = {
  items: TaskConversationMessageItem[];
  hasSettledReply: boolean;
  traceState: ParallelCandidateTraceState;
  skipTraceLoad?: boolean;
};

type ParallelCandidateFallbackState = Pick<
  ParallelCandidateSessionState,
  "items" | "hasSettledReply"
>;

type ParallelCandidateDisplaySource = "phase-view" | "session";

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
  displaySource: ParallelCandidateDisplaySource;
}) {
  const sourceLabel = args.displaySource === "phase-view" ? "阶段视图" : "会话消息";

  if (args.reason === "trace-error") {
    return {
      state: "stale" as const,
      note: `执行追踪暂时不可用，当前继续展示来自${sourceLabel}的候选内容。`,
    };
  }

  return {
    state: args.traceState?.state ?? ("incomplete" as const),
    note: `执行追踪暂未返回可展示回复，当前继续展示来自${sourceLabel}的候选内容。`,
  };
}

function hasTraceState(traceState?: ParallelCandidateTraceState | null) {
  return Boolean(traceState?.state || traceState?.note);
}

function resolvePhaseBaselineTraceState(
  displaySource: ParallelCandidateDisplaySource,
  phaseBaseline?: ParallelCandidateSessionState | Pick<ParallelCandidateSessionState, "traceState">,
) {
  if (displaySource !== "phase-view") {
    return undefined;
  }

  return hasTraceState(phaseBaseline?.traceState) ? phaseBaseline?.traceState : undefined;
}

function canDisplayParallelCandidateState(state?: ParallelCandidateFallbackState | null) {
  if (!state) {
    return false;
  }

  return hasDisplayableParallelCandidateItems(state.items) || state.hasSettledReply;
}

export function resolveParallelCandidateSessionStateFromSources(args: {
  phaseBaseline?: ParallelCandidateFallbackState;
  cachedState?: ParallelCandidateSessionState;
  sessionFallback: ParallelCandidateFallbackState;
  silent?: boolean;
  traceLoad: SuccessfulTraceLoad | FailedTraceLoad;
}): ParallelCandidateSessionState {
  const canDisplayPhaseBaseline = canDisplayParallelCandidateState(args.phaseBaseline);
  const canDisplaySessionFallback = canDisplayParallelCandidateState(args.sessionFallback);
  const preferredDisplayState = canDisplayPhaseBaseline
    ? args.phaseBaseline!
    : canDisplaySessionFallback
      ? args.sessionFallback
      : null;
  const preferredDisplaySource: ParallelCandidateDisplaySource = canDisplayPhaseBaseline
    ? "phase-view"
    : "session";
  const preferredPhaseBaselineTraceState = resolvePhaseBaselineTraceState(
    preferredDisplaySource,
    args.phaseBaseline,
  );

  if (args.traceLoad.ok) {
    const hasDisplayableTraceItems = hasDisplayableParallelCandidateItems(args.traceLoad.traceItems);
    const hasSettledReply = traceHasSettledCandidateReply(args.traceLoad.trace);

    if (preferredDisplayState) {
      return {
        items: preferredDisplayState.items,
        hasSettledReply: hasSettledReply || preferredDisplayState.hasSettledReply,
        traceState: hasDisplayableTraceItems || hasSettledReply
          ? (hasTraceState(args.traceLoad.traceState)
              ? args.traceLoad.traceState
              : (preferredPhaseBaselineTraceState ?? {}))
          : (preferredPhaseBaselineTraceState ??
            buildParallelCandidateSessionFallbackTraceState({
              traceState: args.traceLoad.traceState,
              reason: "empty-trace",
              displaySource: preferredDisplaySource,
            })),
      };
    }

    return {
      items: args.traceLoad.traceItems,
      hasSettledReply,
      traceState: args.traceLoad.traceState,
    };
  }

  if (preferredDisplayState) {
    return {
      items: preferredDisplayState.items,
      hasSettledReply: preferredDisplayState.hasSettledReply,
      traceState:
        preferredPhaseBaselineTraceState ??
        buildParallelCandidateSessionFallbackTraceState({
          reason: "trace-error",
          displaySource: preferredDisplaySource,
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