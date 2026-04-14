import type { ProjectionRunRecord } from "./api";
import type {
  LiveAssistantState,
  TaskConversationMessageItem,
} from "./message-normalize";
import {
  buildParallelComparisonCardsForRun,
  type ParallelCandidateTraceState,
} from "./task-detail-parallel-card-builder";

export type TaskDetailParallelAdoptionState = {
  adoptedCandidateSessionId?: string;
  isCurrentParallelRunPendingAdoption: boolean;
};

function resolveAdoptedCandidateSessionId(run: ProjectionRunRecord | null) {
  if (!run || typeof run.winnerCandidateIndex !== "number") {
    return undefined;
  }

  const sessionId = run.candidateSessions[run.winnerCandidateIndex]?.sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined;
}

export function buildTaskDetailParallelAdoptionState(args: {
  currentParallelRunId?: string;
  currentParallelRunRecord: ProjectionRunRecord | null;
  parallelCandidateItems: Record<string, TaskConversationMessageItem[]>;
  parallelCandidateLiveStates?: Record<string, LiveAssistantState>;
  parallelCandidateSettledReply: Record<string, boolean>;
  parallelCandidateTraceStates: Record<string, ParallelCandidateTraceState>;
  taskStatus?: string | null;
}): TaskDetailParallelAdoptionState {
  const currentRun = args.currentParallelRunRecord;
  const adoptedCandidateSessionId = resolveAdoptedCandidateSessionId(currentRun);

  if (!currentRun || currentRun.parallelRunId !== args.currentParallelRunId) {
    return {
      adoptedCandidateSessionId,
      isCurrentParallelRunPendingAdoption: false,
    };
  }

  if (typeof currentRun.winnerCandidateIndex === "number") {
    return {
      adoptedCandidateSessionId,
      isCurrentParallelRunPendingAdoption: false,
    };
  }

  const cards = buildParallelComparisonCardsForRun({
    run: currentRun,
    currentParallelRunId: args.currentParallelRunId,
    taskStatus: args.taskStatus,
    parallelCandidateItems: args.parallelCandidateItems,
    parallelCandidateSettledReply: args.parallelCandidateSettledReply,
    parallelCandidateTraceStates: args.parallelCandidateTraceStates,
    parallelCandidateLiveStates: args.parallelCandidateLiveStates,
  });

  return {
    adoptedCandidateSessionId,
    isCurrentParallelRunPendingAdoption:
      cards.length >= 2 &&
      cards.every((candidate) => candidate.status === "completed" || candidate.status === "failed"),
  };
}