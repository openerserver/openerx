import type {
  ProjectionRunCandidate,
  ProjectionRunRecord,
  TaskAgentRunRecord,
  TaskSessionRecord,
} from "./api";

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
  const matches = agentRuns.filter(
    (agentRun) =>
      agentRun.sessionId === runtimeSessionId || agentRun.candidateIndex === candidateIndex,
  );

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
      .map((summary) => summary.id)
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

  const winnerCandidateIndex = summaries.findIndex((summary) => summary.id === winnerSessionIds[0]);
  return winnerCandidateIndex >= 0 ? winnerCandidateIndex : undefined;
}

function resolveSharedParentRuntimeSessionId(
  summaries: TaskSessionRecord[],
  parentByRuntimeSessionId: Map<string, string | null>,
) {
  const parentSessionIds = Array.from(
    new Set(
      summaries
        .map((summary) => parentByRuntimeSessionId.get(summary.id) ?? null)
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

function resolveParallelCandidateSummaries(args: {
  summaries: TaskSessionRecord[];
  coordinationKey: string;
  sharedParentSessionId: string | null;
}) {
  const indexedCandidates = args.summaries.filter(
    (summary) => typeof summary.candidateIndex === "number",
  );
  if (indexedCandidates.length >= 2) {
    return indexedCandidates;
  }

  if (args.sharedParentSessionId) {
    return args.summaries.filter((summary) => summary.id !== args.sharedParentSessionId);
  }

  const withoutCoordinatorRoot = args.summaries.filter(
    (summary) => summary.id !== args.coordinationKey,
  );
  return withoutCoordinatorRoot.length >= 2 ? withoutCoordinatorRoot : args.summaries;
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
    model: agentRun?.modelUsed || summary.selectedModel || configuredCandidate?.model || undefined,
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
  const counts = new Map<string, number>();

  for (const summary of sessionSummaries) {
    if (
      typeof summary.coordinationKey !== "string" ||
      summary.coordinationKey.trim().length === 0
    ) {
      continue;
    }

    counts.set(summary.coordinationKey, (counts.get(summary.coordinationKey) ?? 0) + 1);
  }

  return Array.from(counts.values()).some((count) => count >= 2);
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
  const groups = new Map<string, TaskSessionRecord[]>();

  for (const summary of args.sessionSummaries) {
    if (
      typeof summary.coordinationKey !== "string" ||
      summary.coordinationKey.trim().length === 0
    ) {
      continue;
    }

    const existing = groups.get(summary.coordinationKey) ?? [];
    existing.push(summary);
    groups.set(summary.coordinationKey, existing);
  }

  return Array.from(groups.entries())
    .map(([coordinationKey, summaries]): ProjectionRunRecord | null => {
      const orderedSummaries = summaries.slice().sort(compareCandidateSummaries);
      if (orderedSummaries.length < 2) {
        return null;
      }

      const sharedParentSessionId = resolveSharedParentRuntimeSessionId(
        orderedSummaries,
        parentByRuntimeSessionId,
      );
      const candidateSummaries = resolveParallelCandidateSummaries({
        summaries: orderedSummaries,
        coordinationKey,
        sharedParentSessionId,
      });
      if (candidateSummaries.length < 2) {
        return null;
      }

      const parentSessionId = resolveParentRuntimeSessionId(
        orderedSummaries,
        parentByRuntimeSessionId,
        args.task,
      );
      const winnerCandidateIndex = resolveWinnerCandidateIndex(candidateSummaries);
      const candidateSessions = candidateSummaries.map((summary, index) =>
        buildCandidateSession(
          summary,
          index,
          resolveCandidateAgentRun(summary.id, index, args.agentRuns),
          args.configuredCandidates?.[index],
        ),
      );
      const startedAt =
        earliestTimestamp([
          ...candidateSessions.map((candidate) => candidate.startedAt),
          ...candidateSummaries.map((summary) => summary.createdAt),
        ]) ??
        latestTimestamp([
          ...candidateSummaries.map((summary) => summary.createdAt),
          ...candidateSummaries.map((summary) => summary.updatedAt),
        ]) ??
        args.task?.createdAt ??
        "";

      const hasOpenCandidate = candidateSessions.some((candidate) =>
        isOpenCandidateStatus(candidate.status),
      );
      const finishedAt = hasOpenCandidate
        ? undefined
        : latestTimestamp([
            ...candidateSessions.map((candidate) => candidate.finishedAt),
            ...candidateSummaries.map((summary) => summary.updatedAt),
          ]);

      return {
        parallelRunId: `task-session:${coordinationKey}`,
        startedAt,
        ...(finishedAt ? { finishedAt } : {}),
        ...(parentSessionId ? { parentSessionId, executionSessionId: parentSessionId } : {}),
        ...(typeof winnerCandidateIndex === "number" ? { winnerCandidateIndex } : {}),
        candidateSessions,
      } satisfies ProjectionRunRecord;
    })
    .filter((run): run is ProjectionRunRecord => run != null)
    .sort(
      (left, right) => (toTimestampMs(left.startedAt) ?? 0) - (toTimestampMs(right.startedAt) ?? 0),
    );
}
