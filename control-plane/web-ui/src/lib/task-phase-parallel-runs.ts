import type {
  ProjectionRunCandidate,
  ProjectionRunRecord,
  TaskAgentRunRecord,
  TaskPhaseRecord,
  TaskPhaseViewRecord,
  TaskSessionRecord,
} from "./api";
import {
  normalizeSessionConversationItems,
  type TaskConversationMessageItem,
} from "./message-normalize";
import { condenseParallelCandidateToolItems } from "./task-detail-parallel-tool-condense";
import { resolveParallelCandidateTraceStateFromTimelineMeta } from "./task-detail-parallel-card-builder";
import {
  hasDisplayableParallelCandidateItems,
  type ParallelCandidateSessionState,
} from "./task-detail-parallel-source-policy";

export type PhaseParallelCandidateBaseline = ParallelCandidateSessionState;

type ConfiguredParallelCandidate = {
  label?: string;
  model?: string;
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

function resolvePhaseBaselineCandidateStatus(args: {
  session: TaskSessionRecord;
  messageGroup: TaskPhaseViewRecord["messageGroups"][number];
}) {
  return normalizeCandidateStatus(
    args.messageGroup.executionStatus ?? args.session.executionStatus,
  );
}

function buildPhaseBaselineTraceState(status?: string | null) {
  if (status === "paused") {
    return {
      state: "stale" as const,
      note: "当前候选已暂停，当前展示的是最近一次阶段视图快照。",
    };
  }

  if (status === "running") {
    return {
      state: "incomplete" as const,
      note: "当前候选仍在执行，阶段视图里的候选内容可能还不完整。",
    };
  }

  if (status === "pending" || status === "queued") {
    return {
      state: "incomplete" as const,
      note: "当前候选尚未完成，阶段视图里的候选内容可能还不完整。",
    };
  }

  return {};
}

function resolvePhaseBaselineTraceState(args: {
  status?: string | null;
  messageGroup: TaskPhaseViewRecord["messageGroups"][number];
}) {
  if (args.status === "paused") {
    return buildPhaseBaselineTraceState(args.status);
  }

  const timelineState = resolveParallelCandidateTraceStateFromTimelineMeta(
    args.messageGroup.timelineMeta,
  );
  if (timelineState.state || timelineState.note) {
    return timelineState;
  }

  if (args.status === "running") {
    return {
      state: "incomplete" as const,
      note: "当前候选仍在执行，阶段视图里的候选内容可能还不完整。",
    };
  }

  if (args.status === "pending" || args.status === "queued") {
    return {
      state: "incomplete" as const,
      note: "当前候选尚未完成，阶段视图里的候选内容可能还不完整。",
    };
  }

  return {};
}

function isOpenCandidateStatus(status?: string | null) {
  return status === "running" || status === "pending" || status === "paused";
}

function compareCandidateSessions(left: TaskSessionRecord, right: TaskSessionRecord) {
  const leftIndex =
    typeof left.candidateIndex === "number"
      ? left.candidateIndex
      : typeof left.phaseItemIndex === "number"
        ? left.phaseItemIndex
        : Number.MAX_SAFE_INTEGER;
  const rightIndex =
    typeof right.candidateIndex === "number"
      ? right.candidateIndex
      : typeof right.phaseItemIndex === "number"
        ? right.phaseItemIndex
        : Number.MAX_SAFE_INTEGER;
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

function resolveWinnerCandidateIndex(phase: TaskPhaseRecord, sessions: TaskSessionRecord[]) {
  if (typeof phase.winnerSessionId !== "string" || phase.winnerSessionId.length === 0) {
    return undefined;
  }

  const winnerCandidateIndex = sessions.findIndex(
    (session) =>
      session.id === phase.winnerSessionId || session.taskSessionId === phase.winnerSessionId,
  );
  return winnerCandidateIndex >= 0 ? winnerCandidateIndex : undefined;
}

function buildCandidateSession(
  session: TaskSessionRecord,
  candidateIndex: number,
  agentRun: TaskAgentRunRecord | null,
  configuredCandidate?: ConfiguredParallelCandidate,
): ProjectionRunCandidate {
  const status = normalizeCandidateStatus(agentRun?.status ?? session.executionStatus);
  return {
    label: configuredCandidate?.label || session.title || `候选 ${candidateIndex + 1}`,
    agent: agentRun?.agentType,
    model: configuredCandidate?.model || agentRun?.modelUsed || session.selectedModel || undefined,
    status,
    sessionId: session.id,
    agentRunId: agentRun?.id,
    result: agentRun?.result || undefined,
    startedAt: agentRun?.startedAt ?? session.createdAt ?? undefined,
    finishedAt:
      agentRun?.finishedAt ??
      (isOpenCandidateStatus(status)
        ? undefined
        : (session.updatedAt ?? session.createdAt ?? undefined)),
  } satisfies ProjectionRunCandidate;
}

function findPhaseView(phaseId: string, phaseViews: TaskPhaseViewRecord[]) {
  return phaseViews.find((phaseView) => phaseView.phase.id === phaseId) ?? null;
}

function findCandidateMessageGroup(
  phaseView: TaskPhaseViewRecord,
  session: TaskSessionRecord,
) {
  const runtimeSessionId =
    typeof session.runtimeSessionId === "string" && session.runtimeSessionId.length > 0
      ? session.runtimeSessionId
      : null;

  return (
    phaseView.messageGroups.find(
      (group) =>
        group.taskSessionId === session.id ||
        (runtimeSessionId != null && group.runtimeSessionId === runtimeSessionId),
    ) ?? null
  );
}

function buildCandidateMessageItems(messageGroup: TaskPhaseViewRecord["messageGroups"][number]) {
  return condenseParallelCandidateToolItems(
    normalizeSessionConversationItems(Array.isArray(messageGroup.messages) ? messageGroup.messages : []),
  );
}

export function buildPhaseParallelCandidateBaselines(args: {
  phaseViews: TaskPhaseViewRecord[];
}) {
  const baselines: Record<string, PhaseParallelCandidateBaseline> = {};

  for (const phaseView of args.phaseViews) {
    const candidateSessions = phaseView.sessions.filter(
      (session) => session.phaseRole === "candidate",
    );

    for (const candidateSession of candidateSessions) {
      const messageGroup = findCandidateMessageGroup(phaseView, candidateSession);
      if (!messageGroup) {
        continue;
      }

      const items = buildCandidateMessageItems(messageGroup);
      if (!hasDisplayableParallelCandidateItems(items)) {
        continue;
      }

      const candidateStatus = resolvePhaseBaselineCandidateStatus({
        session: candidateSession,
        messageGroup,
      });

      baselines[candidateSession.id] = {
        items,
        hasSettledReply: true,
        traceState: resolvePhaseBaselineTraceState({
          status: candidateStatus,
          messageGroup,
        }),
        skipTraceLoad: !isOpenCandidateStatus(candidateStatus),
      };
    }
  }

  return baselines;
}

export function buildPhaseParallelCandidateStates(args: {
  phaseViews: TaskPhaseViewRecord[];
}) {
  return buildPhaseParallelCandidateBaselines(args);
}

export function buildPhaseParallelRuns(args: {
  phases: TaskPhaseRecord[];
  phaseViews: TaskPhaseViewRecord[];
  agentRuns: TaskAgentRunRecord[];
  configuredCandidates?: ConfiguredParallelCandidate[];
}): ProjectionRunRecord[] {
  return args.phases
    .filter((phase) => phase.phaseKind === "parallel")
    .map((phase): ProjectionRunRecord | null => {
      const phaseView = findPhaseView(phase.id, args.phaseViews);
      if (!phaseView) {
        return null;
      }

      const orderedCandidateSessions = phaseView.sessions
        .filter((session) => session.phaseRole === "candidate")
        .slice()
        .sort(compareCandidateSessions);
      if (orderedCandidateSessions.length < 2) {
        return null;
      }

      const candidateSessions = orderedCandidateSessions.map((session, index) =>
        buildCandidateSession(
          session,
          index,
          resolveCandidateAgentRun(session.id, index, args.agentRuns),
          args.configuredCandidates?.[index],
        ),
      );

      const startedAt =
        phase.startedAt ??
        earliestTimestamp([
          ...candidateSessions.map((candidate) => candidate.startedAt),
          ...orderedCandidateSessions.map((session) => session.createdAt),
          phase.createdAt,
        ]) ??
        latestTimestamp([
          ...orderedCandidateSessions.map((session) => session.createdAt),
          ...orderedCandidateSessions.map((session) => session.updatedAt),
          phase.createdAt,
        ]) ??
        "";

      const hasOpenCandidate = candidateSessions.some((candidate) =>
        isOpenCandidateStatus(candidate.status),
      );
      const finishedAt =
        phase.finishedAt ??
        (hasOpenCandidate
          ? undefined
          : latestTimestamp([
              ...candidateSessions.map((candidate) => candidate.finishedAt),
              ...orderedCandidateSessions.map((session) => session.updatedAt),
              phase.updatedAt,
            ]));

      const winnerCandidateIndex = resolveWinnerCandidateIndex(phase, orderedCandidateSessions);

      return {
        parallelRunId: `task-phase:${phase.id}`,
        phaseId: phase.id,
        startedAt,
        ...(finishedAt ? { finishedAt } : {}),
        ...(phase.anchorSessionId
          ? {
              parentSessionId: phase.anchorSessionId,
              executionSessionId: phase.anchorSessionId,
            }
          : {}),
        ...(typeof winnerCandidateIndex === "number" ? { winnerCandidateIndex } : {}),
        candidateSessions,
      } satisfies ProjectionRunRecord;
    })
    .filter((run): run is ProjectionRunRecord => run != null)
    .sort(
      (left, right) => (toTimestampMs(left.startedAt) ?? 0) - (toTimestampMs(right.startedAt) ?? 0),
    );
}
