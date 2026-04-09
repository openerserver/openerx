export type PublicTaskSessionSourceType = "root" | "fork" | "sub_session" | "parallel";

type TaskSessionSourceTypeLike = {
  sourceType?: string | null;
  sessionKind?: string | null;
  parentSessionId?: string | null;
  parentRuntimeSessionId?: string | null;
  forkedFromMessageId?: string | null;
  candidateIndex?: number | null;
  executionModeSnapshot?: string | null;
  phaseId?: string | null;
};

function hasNonEmptyString(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isParallelTaskSessionCandidate(session?: TaskSessionSourceTypeLike | null) {
  if (!session) {
    return false;
  }

  if (session.sessionKind === "candidate") {
    return true;
  }

  if (typeof session.candidateIndex === "number") {
    return true;
  }

  return session.executionModeSnapshot === "parallel" && hasNonEmptyString(session.phaseId);
}

export function resolvePublicTaskSessionSourceType(
  session?: TaskSessionSourceTypeLike | null,
): PublicTaskSessionSourceType {
  if (isParallelTaskSessionCandidate(session)) {
    return "parallel";
  }

  if (session?.sessionKind === "resume" || session?.sourceType === "sub_session") {
    return "sub_session";
  }

  if (
    session?.sessionKind === "manual_branch" ||
    session?.sourceType === "fork" ||
    hasNonEmptyString(session?.forkedFromMessageId)
  ) {
    return "fork";
  }

  return "root";
}