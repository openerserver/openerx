import type { TaskAgentRunRecord, TaskSessionRecord } from "./api";
import type { TaskConversationListItem } from "./message-normalize";
import { buildSessionSummaryParallelRuns } from "./session-summary-parallel-runs";
import {
  buildSessionScopedParallelRuns,
  buildSessionTreeFallbackParallelRun,
  buildVisibleParallelRunSet,
  findLatestComparableRunForSession,
  hasLaterSingleConversationAfterFallback,
  isRunStartedAfter,
  isSessionTreeFallbackParallelRun,
  resolveSessionSummaryWinnerCandidateIndex,
  toTimestampMs,
  type ParallelRunRecord,
} from "./task-detail-parallel-runtime";
import type { TreeTask } from "../composables/useProjectTreeTask";
import type { TreeSessionNodeRecord } from "../composables/useTreeBranches";

type ConfiguredParallelCandidate = {
  label?: string;
  model?: string;
};

export type TaskDetailParallelReadModel = {
  currentParallelRunId?: string;
  currentParallelRunRecord: ParallelRunRecord | null;
  isParallelComparisonMode: boolean;
  resolvedParallelRuns: ParallelRunRecord[];
  sessionScopedParallelRuns: ParallelRunRecord[];
  sessionTreeFallbackRunSessionKey: string;
  visibleParallelCandidateSessionIds: string[];
  visibleParallelRuns: ParallelRunRecord[];
};

function resolveCurrentParallelRunId(args: {
  resolvedParallelRuns: ParallelRunRecord[];
  sessionScopedParallelRuns: ParallelRunRecord[];
  task?: TreeTask | null | undefined;
}) {
  const taskSessionComparableRun = findLatestComparableRunForSession(
    args.resolvedParallelRuns,
    args.task?.sessionId,
  );
  const sessionScopedComparableRun = args.sessionScopedParallelRuns
    .slice()
    .reverse()
    .find((run) => run.candidateSessions.length >= 2);

  if (
    taskSessionComparableRun &&
    (!sessionScopedComparableRun ||
      isRunStartedAfter(taskSessionComparableRun, sessionScopedComparableRun))
  ) {
    return taskSessionComparableRun.parallelRunId;
  }

  if (sessionScopedComparableRun) {
    return sessionScopedComparableRun.parallelRunId;
  }

  if (typeof args.task?.currentRunId === "string") {
    const activeRun = args.resolvedParallelRuns.find(
      (run) => run.parallelRunId === args.task?.currentRunId,
    );
    if (activeRun?.candidateSessions.length && activeRun.candidateSessions.length >= 2) {
      return activeRun.parallelRunId;
    }

    const latestComparableRun = args.resolvedParallelRuns
      .slice()
      .reverse()
      .find((run) => run.candidateSessions.length >= 2);
    if (latestComparableRun) {
      return latestComparableRun.parallelRunId;
    }
  }

  if (args.resolvedParallelRuns.length > 0) {
    return args.resolvedParallelRuns[args.resolvedParallelRuns.length - 1]?.parallelRunId;
  }

  if (
    args.task?.orchestrationKind === "parallel" &&
    typeof args.task?.currentRunId === "string"
  ) {
    return args.task.currentRunId;
  }

  return undefined;
}

function resolveCurrentParallelRunRecord(
  resolvedParallelRuns: ParallelRunRecord[],
  currentParallelRunId?: string,
) {
  if (currentParallelRunId) {
    return resolvedParallelRuns.find((run) => run.parallelRunId === currentParallelRunId) ?? null;
  }

  return resolvedParallelRuns[resolvedParallelRuns.length - 1] ?? null;
}

function buildResolvedParallelRuns(args: {
  agentRuns: TaskAgentRunRecord[];
  configuredCandidates: ConfiguredParallelCandidate[];
  flatNodes: TreeSessionNodeRecord[];
  selectedSessionId?: string;
  selectedSessionNode?: TreeSessionNodeRecord | null;
  task?: TreeTask | null | undefined;
  taskNodeId: string;
  taskSessionSummaries: TaskSessionRecord[];
}) {
  const primaryParallelRuns = buildSessionSummaryParallelRuns({
    task: args.task,
    sessionSummaries: args.taskSessionSummaries,
    sessionNodes: args.flatNodes,
    agentRuns: args.agentRuns,
    configuredCandidates: args.configuredCandidates.map((candidate) => ({
      label: candidate.label,
      model: candidate.model ?? "",
    })),
  });

  const sessionTreeFallbackRun = buildSessionTreeFallbackParallelRun({
    taskNodeId: args.taskNodeId,
    task: args.task,
    flatNodes: args.flatNodes,
    selectedSessionId: args.selectedSessionId,
    selectedSessionNode: args.selectedSessionNode,
    configuredCandidates: args.configuredCandidates,
    existingRuns: primaryParallelRuns,
  });
  const resolvedRuns = sessionTreeFallbackRun
    ? [...primaryParallelRuns, sessionTreeFallbackRun]
    : primaryParallelRuns;

  return resolvedRuns
    .map((run) => {
      if (typeof run.winnerCandidateIndex === "number") {
        return run;
      }

      const winnerCandidateIndex = resolveSessionSummaryWinnerCandidateIndex(
        run,
        args.taskSessionSummaries,
      );
      return typeof winnerCandidateIndex === "number"
        ? { ...run, winnerCandidateIndex }
        : run;
    })
    .slice()
    .sort(
      (left, right) =>
        (toTimestampMs(left.startedAt) || 0) - (toTimestampMs(right.startedAt) || 0),
    );
}

function buildSessionTreeFallbackRunSessionKey(resolvedParallelRuns: ParallelRunRecord[]) {
  return resolvedParallelRuns
    .filter((run) => isSessionTreeFallbackParallelRun(run))
    .map(
      (run) =>
        `${run.parallelRunId}:${run.candidateSessions
          .map((candidate) => candidate.sessionId ?? "")
          .join(",")}`,
    )
    .join("|");
}

export function buildTaskDetailParallelReadModel(args: {
  agentRuns: TaskAgentRunRecord[];
  baseConversationItems: TaskConversationListItem[];
  configuredCandidates: ConfiguredParallelCandidate[];
  flatNodes: TreeSessionNodeRecord[];
  selectedSessionId?: string;
  selectedSessionNode?: TreeSessionNodeRecord | null;
  task?: TreeTask | null | undefined;
  taskNodeId: string;
  taskSessionSummaries: TaskSessionRecord[];
}): TaskDetailParallelReadModel {
  const resolvedParallelRuns = buildResolvedParallelRuns(args);
  const isParallelComparisonMode =
    resolvedParallelRuns.length > 0 || args.task?.orchestrationKind === "parallel";
  const sessionScopedParallelRuns = buildSessionScopedParallelRuns({
    resolvedParallelRuns,
    selectedSessionId: args.selectedSessionId,
    selectedSessionNode: args.selectedSessionNode,
    flatNodes: args.flatNodes,
    task: args.task,
  });
  const currentParallelRunId = resolveCurrentParallelRunId({
    resolvedParallelRuns,
    sessionScopedParallelRuns,
    task: args.task,
  });
  const currentParallelRunRecord = resolveCurrentParallelRunRecord(
    resolvedParallelRuns,
    currentParallelRunId,
  );

  const visibleParallelRuns = buildVisibleParallelRunSet({
    resolvedParallelRuns,
    sessionScopedParallelRuns,
    selectedSessionId: args.selectedSessionId,
    selectedSessionNode: args.selectedSessionNode,
    flatNodes: args.flatNodes,
    task: args.task,
  });

  const filteredVisibleParallelRuns =
    args.task?.status === "running" && args.task?.executionMode === "single"
      ? visibleParallelRuns.filter(
          (run) =>
            !isSessionTreeFallbackParallelRun(run) ||
            !hasLaterSingleConversationAfterFallback(run, args.baseConversationItems),
        )
      : visibleParallelRuns;

  const visibleParallelCandidateSessionIds = Array.from(
    new Set(
      filteredVisibleParallelRuns
        .flatMap((run) => run.candidateSessions.map((candidate) => candidate.sessionId))
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ),
  );

  return {
    currentParallelRunId,
    currentParallelRunRecord,
    isParallelComparisonMode,
    resolvedParallelRuns,
    sessionScopedParallelRuns,
    sessionTreeFallbackRunSessionKey:
      buildSessionTreeFallbackRunSessionKey(resolvedParallelRuns),
    visibleParallelCandidateSessionIds,
    visibleParallelRuns: filteredVisibleParallelRuns,
  };
}