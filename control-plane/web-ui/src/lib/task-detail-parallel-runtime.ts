import type { ProjectionRunRecord, TaskSessionRecord } from "./api";
import type { TaskConversationListItem } from "./message-normalize";
import type { TreeTask } from "../composables/useProjectTreeTask";
import type { TreeSessionNodeRecord } from "../composables/useTreeBranches";
import { resolveExplicitParallelPhaseId } from "./task-session-parallel-groups";

export type ParallelRunRecord = ProjectionRunRecord;

type ConfiguredParallelCandidate = {
  label?: string;
  model?: string;
};

type ParallelSelectionContext = {
  selectedSessionId?: string;
  selectedSessionNode?: TreeSessionNodeRecord | null;
  flatNodes: TreeSessionNodeRecord[];
  task?: TreeTask | null | undefined;
};

export function toTimestampMs(value?: string | null) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function matchesSummarySessionId(summary: TaskSessionRecord, sessionId: string) {
  return summary.id === sessionId || summary.taskSessionId === sessionId;
}

function hasSessionNode(flatNodes: TreeSessionNodeRecord[], sessionId?: string | null) {
  return Boolean(
    typeof sessionId === "string" &&
      flatNodes.some((node) => node.runtimeSessionId === sessionId),
  );
}

function buildSessionLineageRuntimeSessionIds(
  flatNodes: TreeSessionNodeRecord[],
  sessionId?: string | null,
) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return new Set<string>();
  }

  const nodeById = new Map(
    flatNodes
      .filter(
        (node): node is TreeSessionNodeRecord & { id: string } =>
          typeof node.id === "string" && node.id.length > 0,
      )
      .map((node) => [node.id, node] as const),
  );
  const currentNode = flatNodes.find((node) => node.runtimeSessionId === sessionId);
  const lineageSessionIds = new Set<string>();

  let cursor: TreeSessionNodeRecord | undefined = currentNode;
  while (cursor) {
    if (typeof cursor.runtimeSessionId === "string" && cursor.runtimeSessionId.length > 0) {
      lineageSessionIds.add(cursor.runtimeSessionId);
    }
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }

  return lineageSessionIds;
}

function runReferencesAnySession(run: ParallelRunRecord, sessionIds: Set<string>) {
  if (sessionIds.size === 0) {
    return false;
  }

  if (
    (typeof run.executionSessionId === "string" && sessionIds.has(run.executionSessionId)) ||
    (typeof run.parentSessionId === "string" && sessionIds.has(run.parentSessionId))
  ) {
    return true;
  }

  return run.candidateSessions.some(
    (candidate) =>
      typeof candidate.sessionId === "string" && sessionIds.has(candidate.sessionId),
  );
}

function mergeParallelRuns(runs: ParallelRunRecord[]) {
  return runs
    .reduce<ParallelRunRecord[]>((entries, run) => {
      if (entries.some((entry) => entry.parallelRunId === run.parallelRunId)) {
        return entries;
      }
      entries.push(run);
      return entries;
    }, [])
    .sort(
      (left, right) =>
        (toTimestampMs(left.startedAt) ?? 0) - (toTimestampMs(right.startedAt) ?? 0),
    );
}

export function resolveSessionSummaryWinnerCandidateIndex(
  run: ParallelRunRecord,
  taskSessionSummaries: TaskSessionRecord[],
) {
  const candidateSessionIds = run.candidateSessions
    .map((candidate) => candidate.sessionId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (candidateSessionIds.length < 2) {
    return undefined;
  }

  const candidateSummaries = taskSessionSummaries.filter((summary) =>
    candidateSessionIds.some((sessionId) => matchesSummarySessionId(summary, sessionId)),
  );
  if (candidateSummaries.length < 2) {
    return undefined;
  }

  const phaseIds = new Set(
    candidateSummaries
      .map((summary) => resolveExplicitParallelPhaseId(summary))
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  if (phaseIds.size > 1) {
    return undefined;
  }

  const winnerSessionIds = Array.from(
    new Set(
      candidateSummaries
        .map((summary) => summary.winnerSessionId)
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            candidateSummaries.some((summary) => matchesSummarySessionId(summary, value)),
        ),
    ),
  );
  if (winnerSessionIds.length !== 1) {
    return undefined;
  }

  const winnerSummary = candidateSummaries.find((summary) =>
    matchesSummarySessionId(summary, winnerSessionIds[0]),
  );
  if (!winnerSummary) {
    return undefined;
  }

  const winnerCandidateIndex = run.candidateSessions.findIndex(
    (candidate) =>
      typeof candidate.sessionId === "string" &&
      matchesSummarySessionId(winnerSummary, candidate.sessionId),
  );
  return winnerCandidateIndex >= 0 ? winnerCandidateIndex : undefined;
}

function filterFallbackCandidateNodes(
  nodes: TreeSessionNodeRecord[],
  expectedCandidateCount: number,
) {
  if (expectedCandidateCount <= 0) {
    return [] as TreeSessionNodeRecord[];
  }

  const activeNodes = nodes.filter((node) => !node.archivedAt);
  return activeNodes.length === expectedCandidateCount ? activeNodes : [];
}

function resolveSessionTreeFallbackRootNode(
  sessionNodes: TreeSessionNodeRecord[],
  taskNodeId: string,
  sessionId?: string | null,
) {
  const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalizedSessionId) {
    return null;
  }

  const currentNode = sessionNodes.find((node) => node.runtimeSessionId === normalizedSessionId);
  if (!currentNode) {
    return null;
  }

  const parentNode = currentNode.parentId
    ? sessionNodes.find((node) => node.id === currentNode.parentId)
    : undefined;
  if (parentNode && parentNode.id !== taskNodeId) {
    return parentNode;
  }

  const childCandidates = sessionNodes.filter(
    (node) =>
      node.parentId === currentNode.id &&
      node.runtimeSessionId !== currentNode.runtimeSessionId &&
      !node.archivedAt,
  );
  return childCandidates.length >= 2 ? currentNode : null;
}

export function resolveBaseSessionId(args: ParallelSelectionContext) {
  return (
    args.selectedSessionNode?.runtimeSessionId ??
    args.flatNodes.find((node) => node.isActive)?.runtimeSessionId ??
    args.task?.sessionId ??
    undefined
  );
}

export function resolveScopedSessionId(args: ParallelSelectionContext) {
  return args.selectedSessionId ?? resolveBaseSessionId(args);
}

export function resolveSessionTreeFallbackCandidateNodes(
  args: ParallelSelectionContext & {
    configuredCandidates: ConfiguredParallelCandidate[];
    taskNodeId: string;
  },
) {
  if (args.configuredCandidates.length < 2) {
    return {
      rootSessionId: null,
      candidateNodes: [] as TreeSessionNodeRecord[],
    };
  }

  const sessionNodes = args.flatNodes.filter(
    (node): node is TreeSessionNodeRecord =>
      typeof node.runtimeSessionId === "string" && node.runtimeSessionId.trim().length > 0,
  );
  if (sessionNodes.length < 2) {
    return {
      rootSessionId: null,
      candidateNodes: [] as TreeSessionNodeRecord[],
    };
  }

  const candidateRoots = Array.from(
    new Set(
      [resolveScopedSessionId(args), args.task?.sessionId ?? null, resolveBaseSessionId(args)]
        .map((sessionId) =>
          resolveSessionTreeFallbackRootNode(sessionNodes, args.taskNodeId, sessionId),
        )
        .filter(
          (node): node is TreeSessionNodeRecord =>
            Boolean(
              node &&
                typeof node.runtimeSessionId === "string" &&
                node.runtimeSessionId.length > 0,
            ),
        )
        .map((node) => node.runtimeSessionId),
    ),
  )
    .map((runtimeSessionId) =>
      sessionNodes.find((node) => node.runtimeSessionId === runtimeSessionId),
    )
    .filter((node): node is TreeSessionNodeRecord => Boolean(node));

  for (const rootNode of candidateRoots) {
    const candidateNodes = filterFallbackCandidateNodes(
      sessionNodes.filter(
        (node) =>
          node.parentId === rootNode.id &&
          node.runtimeSessionId !== rootNode.runtimeSessionId,
      ),
      args.configuredCandidates.length,
    );
    if (candidateNodes.length >= 2) {
      return {
        rootSessionId: rootNode.runtimeSessionId,
        candidateNodes,
      };
    }
  }

  return {
    rootSessionId: null,
    candidateNodes: [] as TreeSessionNodeRecord[],
  };
}

function parallelRunMatchesFallbackCandidates(
  run: ParallelRunRecord,
  candidateSessionIds: string[],
) {
  if (candidateSessionIds.length < 2) {
    return false;
  }

  const runSessionIds = run.candidateSessions
    .map((candidate) => candidate.sessionId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (runSessionIds.length !== candidateSessionIds.length) {
    return false;
  }

  return candidateSessionIds.every((sessionId) => runSessionIds.includes(sessionId));
}

function hasParallelRunBoundToRootSession(
  parallelRuns: ParallelRunRecord[],
  rootSessionId: string | null,
) {
  if (!rootSessionId) {
    return false;
  }

  return parallelRuns.some(
    (run) =>
      run.candidateSessions.length >= 2 &&
      (run.executionSessionId === rootSessionId || run.parentSessionId === rootSessionId),
  );
}

function resolveSharedFallbackAnchorMessageId(candidateNodes: TreeSessionNodeRecord[]) {
  const anchorMessageIds = Array.from(
    new Set(
      candidateNodes
        .map((node) =>
          typeof node.forkedFromMessageId === "string" ? node.forkedFromMessageId.trim() : "",
        )
        .filter((value): value is string => value.length > 0),
    ),
  );

  return anchorMessageIds.length === 1 ? anchorMessageIds[0] : null;
}

export function buildSessionTreeFallbackParallelRun(
  args: ParallelSelectionContext & {
    configuredCandidates: ConfiguredParallelCandidate[];
    existingRuns: ParallelRunRecord[];
    taskNodeId: string;
  },
) {
  const allowsSessionTreeParallelFallback =
    args.task?.status === "running" ||
    args.task?.executionMode === "parallel" ||
    args.task?.orchestrationKind === "parallel";
  if (args.existingRuns.length === 0 && !allowsSessionTreeParallelFallback) {
    return null;
  }

  const fallbackGroup = resolveSessionTreeFallbackCandidateNodes(args);
  const candidateNodes = fallbackGroup.candidateNodes;
  if (args.configuredCandidates.length < 2 || candidateNodes.length < 2) {
    return null;
  }

  const candidateSessionIds = candidateNodes
    .map((node) => node.runtimeSessionId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (
    args.existingRuns.some((run) =>
      parallelRunMatchesFallbackCandidates(run, candidateSessionIds),
    )
  ) {
    return null;
  }

  const rootSessionId = fallbackGroup.rootSessionId;
  if (hasParallelRunBoundToRootSession(args.existingRuns, rootSessionId)) {
    return null;
  }

  const rootNode = rootSessionId
    ? args.flatNodes.find((node) => node.runtimeSessionId === rootSessionId)
    : undefined;
  const anchorMessageId = resolveSharedFallbackAnchorMessageId(candidateNodes);
  const startedAt =
    candidateNodes[0]?.createdAt ??
    rootNode?.createdAt ??
    args.task?.startedAt ??
    args.task?.createdAt;
  const finishedAt =
    args.task?.status === "running"
      ? undefined
      : (args.task?.finishedAt ??
        candidateNodes
          .map((node) => node.updatedAt ?? node.createdAt)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .sort((left, right) => (toTimestampMs(right) ?? 0) - (toTimestampMs(left) ?? 0))[0]);

  const fallbackStatus =
    args.task?.status === "failed" || args.task?.status === "cancelled"
      ? "failed"
      : args.task?.status === "running"
        ? "running"
        : "completed";
  const fallbackExecutionSessionId =
    typeof args.task?.sessionId === "string" && candidateSessionIds.includes(args.task.sessionId)
      ? args.task.sessionId
      : (rootSessionId ?? undefined);

  return {
    parallelRunId: `tree-fallback:${rootSessionId || args.task?.id || "current"}`,
    phaseId: undefined,
    startedAt: startedAt ?? "",
    finishedAt,
    ...(anchorMessageId ? { anchorMessageId } : {}),
    parentSessionId: fallbackExecutionSessionId,
    executionSessionId: fallbackExecutionSessionId,
    winnerCandidateIndex: undefined,
    candidateSessions: candidateNodes.map(
      (node, index) =>
        ({
          label: args.configuredCandidates[index]?.label || `候选 ${index + 1}`,
          model: args.configuredCandidates[index]?.model,
          status: fallbackStatus,
          sessionId: node.runtimeSessionId ?? undefined,
          startedAt: node.createdAt ?? undefined,
          finishedAt: node.updatedAt ?? undefined,
        }) satisfies ParallelRunRecord["candidateSessions"][number],
    ),
  } satisfies ParallelRunRecord;
}

export function isSessionTreeFallbackParallelRun(run: ParallelRunRecord | null | undefined) {
  return Boolean(run?.parallelRunId?.startsWith("tree-fallback:"));
}

export function hasLaterSingleConversationAfterFallback(
  run: ParallelRunRecord,
  baseConversationItems: TaskConversationListItem[],
) {
  if (!isSessionTreeFallbackParallelRun(run)) {
    return false;
  }

  const latestCandidateStartedAt = run.candidateSessions
    .map((candidate) => candidate.startedAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => (toTimestampMs(right) ?? 0) - (toTimestampMs(left) ?? 0))[0];

  const latestCandidateStartedAtMs = toTimestampMs(latestCandidateStartedAt);
  if (latestCandidateStartedAtMs == null) {
    return false;
  }

  return baseConversationItems.some((item) => {
    if (item.role !== "user") {
      return false;
    }
    const itemCreatedAtMs = toTimestampMs(item.createdAt);
    return itemCreatedAtMs != null && itemCreatedAtMs > latestCandidateStartedAtMs;
  });
}

export function runReferencesSession(run: ParallelRunRecord, sessionId: string) {
  if (!sessionId) {
    return false;
  }

  if (run.executionSessionId === sessionId || run.parentSessionId === sessionId) {
    return true;
  }

  return run.candidateSessions.some((candidate) => candidate.sessionId === sessionId);
}

export function resolveRunSessionReferenceKind(
  run: ParallelRunRecord,
  sessionId: string,
): "direct" | "candidate" | null {
  if (!sessionId) {
    return null;
  }

  if (run.executionSessionId === sessionId || run.parentSessionId === sessionId) {
    return "direct";
  }

  if (run.candidateSessions.some((candidate) => candidate.sessionId === sessionId)) {
    return "candidate";
  }

  return null;
}

export function findLatestComparableRunForSession(
  runs: ParallelRunRecord[],
  sessionId?: string | null,
) {
  if (!sessionId) {
    return null;
  }

  return (
    runs
      .slice()
      .reverse()
      .find((run) => run.candidateSessions.length >= 2 && runReferencesSession(run, sessionId)) ??
    null
  );
}

export function isRunStartedAfter(left: ParallelRunRecord, right: ParallelRunRecord) {
  return (toTimestampMs(left.startedAt) ?? 0) > (toTimestampMs(right.startedAt) ?? 0);
}

export function buildSessionScopedParallelRuns(
  args: ParallelSelectionContext & { resolvedParallelRuns: ParallelRunRecord[] },
) {
  const scopedSessionId = resolveScopedSessionId(args);
  if (!scopedSessionId) {
    return [] as ParallelRunRecord[];
  }

  const matchedRuns = args.resolvedParallelRuns
    .map((run) => ({
      run,
      referenceKind: resolveRunSessionReferenceKind(run, scopedSessionId),
    }))
    .filter(
      (
        entry,
      ): entry is {
        run: ParallelRunRecord;
        referenceKind: "direct" | "candidate";
      } => entry.referenceKind != null,
    );

  const hasDirectComparableRun = matchedRuns.some(
    ({ run, referenceKind }) => referenceKind === "direct" && run.candidateSessions.length >= 2,
  );

  return matchedRuns
    .filter(({ referenceKind }) => !hasDirectComparableRun || referenceKind === "direct")
    .map(({ run }) => run);
}

export function buildVisibleParallelRunSet(
  args: ParallelSelectionContext & {
    resolvedParallelRuns: ParallelRunRecord[];
    sessionScopedParallelRuns: ParallelRunRecord[];
  },
) {
  if (args.sessionScopedParallelRuns.length === 0) {
    return args.resolvedParallelRuns;
  }

  const scopedSessionId = resolveScopedSessionId(args);
  const lineageSessionIds = buildSessionLineageRuntimeSessionIds(args.flatNodes, scopedSessionId);
  const lineageHistoricalRuns = args.resolvedParallelRuns.filter(
    (run) =>
      !isSessionTreeFallbackParallelRun(run) &&
      !args.sessionScopedParallelRuns.some(
        (scopedRun) => scopedRun.parallelRunId === run.parallelRunId,
      ) && runReferencesAnySession(run, lineageSessionIds),
  );
  const taskSessionId =
    typeof args.task?.sessionId === "string" && args.task.sessionId.length > 0
      ? args.task.sessionId
      : null;

  if (!scopedSessionId || !taskSessionId || scopedSessionId !== taskSessionId) {
    return mergeParallelRuns([...lineageHistoricalRuns, ...args.sessionScopedParallelRuns]);
  }

  const adoptedHistoricalRuns = args.resolvedParallelRuns.filter(
    (run) =>
      typeof run.winnerCandidateIndex === "number" &&
      !args.sessionScopedParallelRuns.some(
        (scopedRun) => scopedRun.parallelRunId === run.parallelRunId,
      ),
  );

  return mergeParallelRuns([
    ...adoptedHistoricalRuns,
    ...lineageHistoricalRuns,
    ...args.sessionScopedParallelRuns,
  ]);
}

export function resolvePreferredConversationSessionId(
  args: ParallelSelectionContext & {
    currentParallelRun?: ParallelRunRecord | null;
    isCurrentParallelRunPendingAdoption: boolean;
  },
) {
  if (!args.isCurrentParallelRunPendingAdoption) {
    return undefined;
  }

  const currentSessionId = resolveScopedSessionId(args);
  const currentRun = args.currentParallelRun;
  const taskSessionId =
    typeof args.task?.sessionId === "string" && args.task.sessionId.length > 0
      ? args.task.sessionId
      : undefined;
  const taskSessionIsCurrentCandidate = Boolean(
    taskSessionId &&
      currentRun?.candidateSessions.some((candidate) => candidate.sessionId === taskSessionId),
  );

  if (taskSessionIsCurrentCandidate && hasSessionNode(args.flatNodes, taskSessionId)) {
    return taskSessionId;
  }

  const mainlineSessionId =
    currentRun?.executionSessionId ?? currentRun?.parentSessionId ?? args.task?.sessionId;

  if (
    currentSessionId &&
    currentSessionId !== mainlineSessionId &&
    (!currentRun ||
      (!isSessionTreeFallbackParallelRun(currentRun) &&
        !runReferencesSession(currentRun, currentSessionId)))
  ) {
    return undefined;
  }

  if (hasSessionNode(args.flatNodes, mainlineSessionId)) {
    return mainlineSessionId ?? undefined;
  }

  return undefined;
}

export function resolveNextSelectedSessionId(
  args: ParallelSelectionContext & {
    currentParallelRun?: ParallelRunRecord | null;
    adoptedCandidateSessionId?: string;
    isCurrentParallelRunPendingAdoption: boolean;
  },
) {
  const preferredSessionId = resolvePreferredConversationSessionId(args);
  if (preferredSessionId) {
    return preferredSessionId;
  }

  const selectedSessionId =
    typeof args.selectedSessionId === "string" && args.selectedSessionId.length > 0
      ? args.selectedSessionId
      : undefined;
  if (
    selectedSessionId &&
    !hasSessionNode(args.flatNodes, selectedSessionId) &&
    args.task?.status === "running"
  ) {
    return selectedSessionId;
  }

  if (!selectedSessionId && !args.currentParallelRun && !args.adoptedCandidateSessionId) {
    return undefined;
  }

  const baseSessionId = resolveBaseSessionId(args);
  const currentRun = args.currentParallelRun;
  const baseSessionParticipatesInCurrentRun = Boolean(
    baseSessionId && currentRun && runReferencesSession(currentRun, baseSessionId),
  );
  const baseSessionIsHistoricalRoot = Boolean(
    baseSessionId && args.task?.sessionId && baseSessionId !== args.task.sessionId,
  );
  if (
    hasSessionNode(args.flatNodes, baseSessionId) &&
    (baseSessionIsHistoricalRoot ||
      !args.adoptedCandidateSessionId ||
      !baseSessionParticipatesInCurrentRun)
  ) {
    return baseSessionId ?? undefined;
  }

  if (hasSessionNode(args.flatNodes, args.adoptedCandidateSessionId)) {
    return args.adoptedCandidateSessionId;
  }

  if (hasSessionNode(args.flatNodes, args.selectedSessionId)) {
    return args.selectedSessionId;
  }

  return baseSessionId ?? args.flatNodes[0]?.runtimeSessionId ?? undefined;
}