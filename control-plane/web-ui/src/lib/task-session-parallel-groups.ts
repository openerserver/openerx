import type { TaskSessionRecord } from "./api";

export type ExplicitParallelTaskSessionGroup = {
  phaseId: string;
  candidateSessions: TaskSessionRecord[];
};

function asNonEmptyString(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveExplicitParallelPhaseId(
  session: Pick<TaskSessionRecord, "phaseId">,
) {
  return asNonEmptyString(session.phaseId);
}

export function isExplicitParallelCandidateSession(
  session: Pick<TaskSessionRecord, "phaseId" | "executionModeSnapshot" | "sessionKind">,
) {
  return (
    session.sessionKind === "candidate" &&
    session.executionModeSnapshot === "parallel" &&
    resolveExplicitParallelPhaseId(session) != null
  );
}

export function resolveExplicitParallelParentRuntimeSessionId(sessions: TaskSessionRecord[]) {
  const parentSessionIds = Array.from(
    new Set(
      sessions
        .map((session) => asNonEmptyString(session.parentRuntimeSessionId))
        .filter((value): value is string => value != null),
    ),
  );

  return parentSessionIds.length === 1 ? parentSessionIds[0] : null;
}

export function buildExplicitParallelTaskSessionGroups(sessionSummaries: TaskSessionRecord[]) {
  const groups = new Map<string, TaskSessionRecord[]>();

  for (const summary of sessionSummaries) {
    if (!isExplicitParallelCandidateSession(summary)) {
      continue;
    }

    const phaseId = resolveExplicitParallelPhaseId(summary);
    if (!phaseId) {
      continue;
    }

    const existing = groups.get(phaseId) ?? [];
    existing.push(summary);
    groups.set(phaseId, existing);
  }

  return Array.from(groups.entries())
    .map(
      ([phaseId, candidateSessions]) =>
        ({
          phaseId,
          candidateSessions,
        }) satisfies ExplicitParallelTaskSessionGroup,
    )
    .filter((group) => group.candidateSessions.length >= 2);
}