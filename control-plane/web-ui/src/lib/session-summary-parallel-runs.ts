import type {
  ProjectionRunCandidate,
  ProjectionRunRecord,
  TaskAgentRunRecord,
  TaskSessionRecord,
} from "./api";
import {
  buildExplicitParallelTaskSessionGroups,
  resolveExplicitParallelParentRuntimeSessionId,
  resolveExplicitParallelPhaseId,
} from "./task-session-parallel-groups";

type SessionParentNode = {
  id?: string;
  runtimeSessionId: string;
  parentRuntimeSessionId?: string | null;
  parentId?: string | null;
};

type SessionRunTaskContext = {
  sessionId?: string | null;
  status?: string | null;
  createdAt?: string | null;
};

type SessionSummaryParallelRunArgs = {
  task?: SessionRunTaskContext | null;
  sessionSummaries: TaskSessionRecord[];
  sessionNodes: SessionParentNode[];
  agentRuns: TaskAgentRunRecord[];
  configuredCandidates?: Array<{ model: string; label?: string }>;
};

function toTimestampMs(value?: string | null) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function taskRunStatusPriority(status?: string | null) {
  if (status === "running") return 4;
  if (status === "paused") return 3;
  if (status === "completed" || status === "complete") return 2;
  if (status === "pending") return 1;
  return 0;
}

function normalizeCandidateStatus(status?: string | null) {
  if (status === "complete") {
    return "completed";
  }
  if (
    status === "cancelled" ||
    status === "terminated" ||
    status === "stopped" ||
    status === "error"
  ) {
    return "failed";
  }
  return status ?? "pending";
}

function isOpenCandidateStatus(status?: string | null) {
  return status === "running" || status === "pending" || status === "paused";
}

function compareCandidateSummaries(left: TaskSessionRecord, right: TaskSessionRecord) {
  const leftIndex =
    typeof left.candidateIndex === "number" ? left.candidateIndex : Number.MAX_SAFE_INTEGER;
  const rightIndex =
    typeof right.candidateIndex === "number" ? right.candidateIndex : Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  const leftCreatedAt =
    toTimestampMs(left.createdAt) ?? toTimestampMs(left.updatedAt) ?? Number.MAX_SAFE_INTEGER;
  const rightCreatedAt =
    toTimestampMs(right.createdAt) ?? toTimestampMs(right.updatedAt) ?? Number.MAX_SAFE_INTEGER;
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  return String(left.id).localeCompare(String(right.id), "zh-CN");
}

function resolveCandidateAgentRun(
  runtimeSessionId: string,
  candidateIndex: number,
  agentRuns: TaskAgentRunRecord[],
) {
  const sessionMatches = agentRuns.filter((agentRun) => agentRun.sessionId === runtimeSessionId);
  const matches =
    sessionMatches.length > 0
      ? sessionMatches
      : agentRuns.filter((agentRun) => agentRun.candidateIndex === candidateIndex);

  if (matches.length === 0) {
    return null;
  }

  return matches.slice().sort((left, right) => {
    const priority = taskRunStatusPriority(right.status) - taskRunStatusPriority(left.status);
    if (priority !== 0) {
      return priority;
    }

    const rightStartedAt =
      toTimestampMs(right.startedAt) ??
      toTimestampMs(right.createdAt) ??
      toTimestampMs(right.finishedAt) ??
      0;
    const leftStartedAt =
      toTimestampMs(left.startedAt) ??
      toTimestampMs(left.createdAt) ??
      toTimestampMs(left.finishedAt) ??
      0;
    return rightStartedAt - leftStartedAt;
  })[0];
}

function resolveWinnerCandidateIndex(summaries: TaskSessionRecord[]) {
  const candidateSessionIds = new Set(
    summaries
      .flatMap((summary) => [summary.id, summary.taskSessionId])
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const winnerSessionIds = Array.from(
    new Set(
      summaries
        .map((summary) => summary.winnerSessionId)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0 && candidateSessionIds.has(value),
        ),
    ),
  );

  if (winnerSessionIds.length !== 1) {
    return undefined;
  }

  const winnerSummary = summaries.find(
    (summary) =>
      summary.id === winnerSessionIds[0] || summary.taskSessionId === winnerSessionIds[0],
  );
  if (!winnerSummary) {
    return undefined;
  }

  const winnerCandidateIndex = summaries.findIndex((summary) => summary.id === winnerSummary.id);
  return winnerCandidateIndex >= 0 ? winnerCandidateIndex : undefined;
}

function resolveSharedParentRuntimeSessionId(
  summaries: TaskSessionRecord[],
  parentByRuntimeSessionId: Map<string, string | null>,
) {
  const parentSessionIds = Array.from(
    new Set(
      summaries
        .map(
          (summary) =>
            summary.parentRuntimeSessionId ?? parentByRuntimeSessionId.get(summary.id) ?? null,
        )
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  return parentSessionIds.length === 1 ? parentSessionIds[0] : null;
}

function resolveParentRuntimeSessionId(
  summaries: TaskSessionRecord[],
  parentByRuntimeSessionId: Map<string, string | null>,
  task?: SessionRunTaskContext | null,
) {
  return (
    resolveSharedParentRuntimeSessionId(summaries, parentByRuntimeSessionId) ??
    task?.sessionId ??
    null
  );
}

function buildCandidateSession(
  summary: TaskSessionRecord,
  candidateIndex: number,
  agentRun: TaskAgentRunRecord | null,
  configuredCandidate?: { model: string; label?: string },
): ProjectionRunCandidate {
  const status = normalizeCandidateStatus(agentRun?.status ?? summary.executionStatus);
  return {
    label: configuredCandidate?.label || summary.title || `候选 ${candidateIndex + 1}`,
    agent: agentRun?.agentType,
    model: configuredCandidate?.model || agentRun?.modelUsed || summary.selectedModel || undefined,
    status,
    sessionId: summary.id,
    agentRunId: agentRun?.id,
    result: agentRun?.result || undefined,
    startedAt: agentRun?.startedAt ?? summary.createdAt ?? undefined,
    finishedAt:
      agentRun?.finishedAt ??
      (isOpenCandidateStatus(status)
        ? undefined
        : (summary.updatedAt ?? summary.createdAt ?? undefined)),
  } satisfies ProjectionRunCandidate;
}

function earliestTimestamp(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice()
    .sort((left, right) => (toTimestampMs(left) ?? 0) - (toTimestampMs(right) ?? 0))[0];
}

function latestTimestamp(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice()
    .sort((left, right) => (toTimestampMs(right) ?? 0) - (toTimestampMs(left) ?? 0))[0];
}

export function hasSessionSummaryParallelGroups(sessionSummaries: TaskSessionRecord[]) {
  return buildExplicitParallelTaskSessionGroups(sessionSummaries).length > 0;
}

export function buildRuntimeSessionParentMap(nodes: SessionParentNode[]) {
  const parentByRuntimeSessionId = new Map<string, string | null>();
  const nodesById = new Map(
    nodes
      .filter(
        (node): node is SessionParentNode & { id: string } =>
          typeof node.id === "string" && node.id.length > 0,
      )
      .map((node) => [node.id, node] as const),
  );

  for (const node of nodes) {
    if (typeof node.runtimeSessionId !== "string" || node.runtimeSessionId.length === 0) {
      continue;
    }

    const parentRuntimeSessionId =
      typeof node.parentRuntimeSessionId === "string"
        ? node.parentRuntimeSessionId
        : typeof node.parentId === "string"
          ? (nodesById.get(node.parentId)?.runtimeSessionId ?? null)
          : null;

    parentByRuntimeSessionId.set(node.runtimeSessionId, parentRuntimeSessionId);
  }

  return parentByRuntimeSessionId;
}

export function buildSessionSummaryParallelRuns(args: SessionSummaryParallelRunArgs) {
  const parentByRuntimeSessionId = buildRuntimeSessionParentMap(args.sessionNodes);
  return buildExplicitParallelTaskSessionGroups(args.sessionSummaries)
    .map(({ phaseId, candidateSessions }): ProjectionRunRecord | null => {
      const orderedSummaries = candidateSessions.slice().sort(compareCandidateSummaries);
      if (orderedSummaries.length < 2) {
        return null;
      }

      const parentSessionId =
        resolveExplicitParallelParentRuntimeSessionId(orderedSummaries) ??
        resolveParentRuntimeSessionId(orderedSummaries, parentByRuntimeSessionId, args.task);
      const winnerCandidateIndex = resolveWinnerCandidateIndex(orderedSummaries);
      const projectionCandidateSessions = orderedSummaries.map((summary, index) =>
        buildCandidateSession(
          summary,
          index,
          resolveCandidateAgentRun(summary.id, index, args.agentRuns),
          args.configuredCandidates?.[index],
        ),
      );
      const startedAt =
        earliestTimestamp([
          ...projectionCandidateSessions.map((candidate) => candidate.startedAt),
          ...orderedSummaries.map((summary) => summary.createdAt),
        ]) ??
        latestTimestamp([
          ...orderedSummaries.map((summary) => summary.createdAt),
          ...orderedSummaries.map((summary) => summary.updatedAt),
        ]) ??
        args.task?.createdAt ??
        "";

      const hasOpenCandidate = projectionCandidateSessions.some((candidate) =>
        isOpenCandidateStatus(candidate.status),
      );
      const finishedAt = hasOpenCandidate
        ? undefined
        : latestTimestamp([
            ...projectionCandidateSessions.map((candidate) => candidate.finishedAt),
            ...orderedSummaries.map((summary) => summary.updatedAt),
          ]);

      return {
        parallelRunId: `task-session:${phaseId}`,
        phaseId,
        startedAt,
        ...(finishedAt ? { finishedAt } : {}),
        ...(parentSessionId ? { parentSessionId, executionSessionId: parentSessionId } : {}),
        ...(typeof winnerCandidateIndex === "number" ? { winnerCandidateIndex } : {}),
        candidateSessions: projectionCandidateSessions,
      } satisfies ProjectionRunRecord;
    })
    .filter((run): run is ProjectionRunRecord => run != null)
    .sort(
      (left, right) => (toTimestampMs(left.startedAt) ?? 0) - (toTimestampMs(right.startedAt) ?? 0),
    );
}
