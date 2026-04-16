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

function collectMainlinePhaseMessages(groups: TaskPhaseMessageGroupRecord[]) {
  return groups
    .filter((group) => group.phaseRole !== "candidate" && group.phaseRole !== "judge")
    .flatMap((group) => (Array.isArray(group.messages) ? group.messages : []));
}

function buildParallelAnchorMessage(groups: TaskPhaseMessageGroupRecord[]) {
  const candidateMessages = groups
    .filter((group) => group.phaseRole === "candidate")
    .flatMap((group) =>
      (Array.isArray(group.messages) ? group.messages : []).map((message) => ({
        message,
        group,
      })),
    )
    .filter(({ message }) => asString(asRecord(message)?.role) === "user")
    .sort((left, right) => {
      const leftTime = toTimestampMs(asRecord(left.message)?.createdAt) ?? Number.MAX_SAFE_INTEGER;
      const rightTime = toTimestampMs(asRecord(right.message)?.createdAt) ?? Number.MAX_SAFE_INTEGER;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      const leftIndex =
        typeof left.group.phaseItemIndex === "number"
          ? left.group.phaseItemIndex
          : Number.MAX_SAFE_INTEGER;
      const rightIndex =
        typeof right.group.phaseItemIndex === "number"
          ? right.group.phaseItemIndex
          : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });

  return candidateMessages[0]?.message ?? null;
}

function sortMessages(messages: unknown[]) {
  return messages.slice().sort((left, right) => {
    const leftRecord = asRecord(left);
    const rightRecord = asRecord(right);
    const leftTime = toTimestampMs(leftRecord?.createdAt) ?? Number.MAX_SAFE_INTEGER;
    const rightTime = toTimestampMs(rightRecord?.createdAt) ?? Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    const leftRole = asString(leftRecord?.role) ?? "assistant";
    const rightRole = asString(rightRecord?.role) ?? "assistant";
    if (leftRole !== rightRole) {
      return leftRole === "user" ? -1 : 1;
    }

    const leftId = asString(leftRecord?.id) ?? "";
    const rightId = asString(rightRecord?.id) ?? "";
    return leftId.localeCompare(rightId);
  });
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

  return sortMessages(messages);
}

export function resolveTaskSnapshotPhaseAnchor(args: {
  phases: TaskPhaseRecord[];
  currentPhaseId?: string | null;
  requestedSessionId?: string;
}) {
  const explicitPhaseId = asString(args.currentPhaseId);
  if (explicitPhaseId) {
    return args.phases.find((phase) => phase.id === explicitPhaseId) ?? null;
  }

  const requestedSessionId = asString(args.requestedSessionId);
  if (requestedSessionId) {
    const matchingPhase = args.phases
      .slice()
      .reverse()
      .find((phase) =>
        Array.isArray(phase.sessionIds)
          ? phase.sessionIds.some((sessionId) => {
              const normalizedSessionId = asString(sessionId);
              return Boolean(
                normalizedSessionId &&
                  (normalizedSessionId === requestedSessionId ||
                    normalizedSessionId.endsWith(`:${requestedSessionId}`) ||
                    requestedSessionId.endsWith(`:${normalizedSessionId}`)),
              );
            })
          : false,
      );
    if (matchingPhase) {
      return matchingPhase;
    }
  }

  return args.phases.at(-1) ?? null;
}