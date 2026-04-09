import type { TaskSessionRecord } from "./api";

export type ExplicitParallelTaskSessionGroup = {
  coordinationKey: string;
  candidateSessions: TaskSessionRecord[];
};

function asNonEmptyString(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function isExplicitParallelCandidateSession(
  session: Pick<
    TaskSessionRecord,
    "coordinationKey" | "executionModeSnapshot" | "sessionKind"
  >,
) {
  return (
    session.sessionKind === "candidate" &&
    session.executionModeSnapshot === "parallel" &&
    asNonEmptyString(session.coordinationKey) != null
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

    const coordinationKey = asNonEmptyString(summary.coordinationKey);
    if (!coordinationKey) {
      continue;
    }

    const existing = groups.get(coordinationKey) ?? [];
    existing.push(summary);
    groups.set(coordinationKey, existing);
  }

  return Array.from(groups.entries())
    .map(
      ([coordinationKey, candidateSessions]) =>
        ({
          coordinationKey,
          candidateSessions,
        }) satisfies ExplicitParallelTaskSessionGroup,
    )
    .filter((group) => group.candidateSessions.length >= 2);
}