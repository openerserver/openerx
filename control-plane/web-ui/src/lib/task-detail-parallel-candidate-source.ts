import {
  getTaskConversationMessages,
  getTaskExecutionTraceView,
} from "./api";
import {
  normalizeSessionConversationItems,
} from "./message-normalize";
import {
  resolveParallelCandidateTraceState,
} from "./task-detail-parallel-card-builder";
import {
  hasDisplayableParallelCandidateItems,
  resolveParallelCandidateSessionStateFromSources,
  type ParallelCandidateSessionState,
} from "./task-detail-parallel-source-policy";
import { condenseParallelCandidateToolItems } from "./task-detail-parallel-tool-condense";
import { normalizeTraceConversationItems } from "./task-trace-conversation";

export type { ParallelCandidateSessionState } from "./task-detail-parallel-source-policy";

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
  return resolveParallelCandidateSessionStateFromSources({
    cachedState: args.cachedState,
    sessionFallback: sessionMessageFallback,
    silent: args.silent,
    traceLoad: traceResult.ok
      ? {
          ok: true,
          trace: traceResult.trace,
          traceItems: condenseParallelCandidateToolItems(
            normalizeTraceConversationItems(traceResult.trace),
          ),
          traceState: resolveParallelCandidateTraceState(traceResult.trace),
        }
      : { ok: false },
  });
}