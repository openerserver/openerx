import type { TaskPhaseRecord } from "./api";
import { asRecord, asString } from "./message-normalize";

export interface TaskPhaseMessageGroupRecord {
  taskSessionId?: string | null;
  runtimeSessionId?: string | null;
  phaseRole?: string | null;
  phaseItemIndex?: number | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  title?: string | null;
  selectedModel?: string | null;
  executionStatus?: string | null;
  messages: unknown[];
}

function toTimestampMs(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function resolveMessageGroupOrderIndex(group: TaskPhaseMessageGroupRecord) {
  if (typeof group.phaseItemIndex === "number") {
    return group.phaseItemIndex;
  }

  if (typeof group.candidateIndex === "number") {
    return group.candidateIndex;
  }

  if (typeof group.stepIndex === "number") {
    return group.stepIndex;
  }

  return Number.MAX_SAFE_INTEGER;
}

function compareMessageGroups(left: TaskPhaseMessageGroupRecord, right: TaskPhaseMessageGroupRecord) {
  const leftIndex = resolveMessageGroupOrderIndex(left);
  const rightIndex = resolveMessageGroupOrderIndex(right);
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  const leftTitle = left.title?.trim() ?? "";
  const rightTitle = right.title?.trim() ?? "";
  if (leftTitle !== rightTitle) {
    return leftTitle.localeCompare(rightTitle, "zh-CN");
  }

  return 0;
}

function collectMainlinePhaseMessages(groups: TaskPhaseMessageGroupRecord[]) {
  return groups
    .slice()
    .sort(compareMessageGroups)
    .filter((group) => group.phaseRole !== "candidate" && group.phaseRole !== "judge")
    .flatMap((group) => (Array.isArray(group.messages) ? group.messages : []));
}

function buildParallelAnchorMessage(groups: TaskPhaseMessageGroupRecord[]) {
  const orderedCandidateGroups = groups
    .filter((group) => group.phaseRole === "candidate")
    .slice()
    .sort(compareMessageGroups);

  for (const group of orderedCandidateGroups) {
    const candidateMessages = Array.isArray(group.messages) ? group.messages : [];
    const anchorMessage = candidateMessages.find(
      (message) => asString(asRecord(message)?.role) === "user",
    );
    if (anchorMessage) {
      return anchorMessage;
    }
  }

  return null;
}

export function buildTaskPhaseSnapshotMessages(args: {
  phases: Array<{
    phase: TaskPhaseRecord;
    messageGroups: TaskPhaseMessageGroupRecord[];
  }>;
}) {
  const messages: unknown[] = [];

  for (const entry of args.phases) {
    if (entry.phase.phaseKind === "parallel") {
      const anchorMessage = buildParallelAnchorMessage(entry.messageGroups);
      if (anchorMessage) {
        messages.push(anchorMessage);
      }
      continue;
    }

    messages.push(...collectMainlinePhaseMessages(entry.messageGroups));
  }

  return messages;
}

export function resolveTaskSnapshotPhaseAnchor(args: {
  phases: TaskPhaseRecord[];
  currentPhaseId?: string | null;
  requestedSessionId?: string;
}) {
  const explicitPhaseId = asString(args.currentPhaseId);
  if (explicitPhaseId) {
    const matchedByPhaseId = args.phases.find((phase) => phase.id === explicitPhaseId);
    if (matchedByPhaseId) return matchedByPhaseId;
    // explicitPhaseId present but no direct phase match — fall through to session-based lookup
    // (handles stale IDs and legacy composite key formats)
  }

  // Try session-based matching: first treat currentPhaseId as a session composite key (if set
  // but unmatched above), then try requestedSessionId explicitly.
  const sessionCandidates = [explicitPhaseId, asString(args.requestedSessionId)].filter(
    (c): c is string => Boolean(c),
  );
  for (const candidate of sessionCandidates) {
    const matchingPhase = args.phases
      .slice()
      .reverse()
      .find((phase) =>
        Array.isArray(phase.sessionIds)
          ? phase.sessionIds.some((sessionId) => {
              const normalizedSessionId = asString(sessionId);
              return Boolean(
                normalizedSessionId &&
                  (normalizedSessionId === candidate ||
                    normalizedSessionId.endsWith(`:${candidate}`) ||
                    candidate.endsWith(`:${normalizedSessionId}`)),
              );
            })
          : false,
      );
    if (matchingPhase) return matchingPhase;
  }

  return args.phases.at(-1) ?? null;
}