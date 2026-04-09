import type { TaskSessionLineageRecord } from "./task-session-store";

type PendingParallelMessageSuppressionGroup = {
  createdAtMs: number | null;
  suppressedSessionIds: Set<string>;
  anchorSessionIds: Set<string>;
};

type AdoptedParallelMessageSuppressionGroup = {
  suppressedSessionIds: Set<string>;
  winnerSessionIds: Set<string>;
  anchorSessionIds: Set<string>;
};

type FilterPendingParallelTaskConversationCompatMessagesArgs<TMessage> = {
  messages: TMessage[];
  records: TaskSessionLineageRecord[];
  extractSourceSessionId(message: TMessage): string | undefined;
  extractRole(message: TMessage): string | undefined;
  isExecutionContextUserMessage(message: TMessage): boolean;
  shouldPreserveWorkflowExecutionContextMessage(sessionId: string): boolean;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toTimestampMs(value?: string | null) {
  const rawValue = asString(value);
  if (!rawValue) {
    return null;
  }

  const parsed = Date.parse(rawValue);
  return Number.isNaN(parsed) ? null : parsed;
}

function isPendingParallelCandidateSession(record: TaskSessionLineageRecord) {
  return (
    typeof record.candidateIndex === "number" ||
    record.sessionKind === "candidate" ||
    record.sessionKind === "manual_branch" ||
    record.sessionKind === "judge"
  );
}

function isParallelAnchorSession(record: TaskSessionLineageRecord) {
  return !isPendingParallelCandidateSession(record) && record.sessionKind !== "primary";
}

function addTaskSessionLineageRecordIds(idSet: Set<string>, record: TaskSessionLineageRecord) {
  const recordId = asString(record.id);
  if (recordId) {
    idSet.add(recordId);
  }

  const runtimeSessionId = asString(record.runtimeSessionId);
  if (runtimeSessionId) {
    idSet.add(runtimeSessionId);
  }
}

function isSessionIdInSuppressionSet(sessionId: string, idSet: Set<string>): boolean {
  if (idSet.has(sessionId)) {
    return true;
  }

  if (sessionId.startsWith("task-session:")) {
    const lastColon = sessionId.lastIndexOf(":");
    if (lastColon > 0) {
      return idSet.has(sessionId.slice(lastColon + 1));
    }
  }

  return false;
}

function resolveParallelPhaseGroupKey(record: TaskSessionLineageRecord) {
  return asString(record.phaseId);
}

function resolveLatestPendingParallelMessageSuppressionGroup(
  records: TaskSessionLineageRecord[],
): PendingParallelMessageSuppressionGroup | null {
  const groups = new Map<string, TaskSessionLineageRecord[]>();

  for (const record of records) {
    const phaseId = resolveParallelPhaseGroupKey(record);
    if (!phaseId) {
      continue;
    }

    const existing = groups.get(phaseId) ?? [];
    existing.push(record);
    groups.set(phaseId, existing);
  }

  let selectedGroup: PendingParallelMessageSuppressionGroup | null = null;

  for (const group of groups.values()) {
    if (group.some((record) => asString(record.winnerSessionId))) {
      continue;
    }

    const candidateRecords = group.filter(isPendingParallelCandidateSession);
    if (candidateRecords.length < 2) {
      continue;
    }

    const createdAtValues = candidateRecords
      .map((record) => toTimestampMs(record.createdAt))
      .filter((value): value is number => value != null);
    const createdAtMs = createdAtValues.length > 0 ? Math.min(...createdAtValues) : null;
    const selectedCreatedAtMs = selectedGroup?.createdAtMs ?? Number.NEGATIVE_INFINITY;
    const candidateCreatedAtMs = createdAtMs ?? Number.NEGATIVE_INFINITY;
    if (selectedGroup && candidateCreatedAtMs < selectedCreatedAtMs) {
      continue;
    }

    const suppressedSessionIds = new Set<string>();
    for (const record of candidateRecords) {
      addTaskSessionLineageRecordIds(suppressedSessionIds, record);
    }

    if (suppressedSessionIds.size < 2) {
      continue;
    }

    const anchorSessionIds = new Set<string>();
    for (const record of group) {
      if (!isParallelAnchorSession(record)) {
        continue;
      }
      addTaskSessionLineageRecordIds(anchorSessionIds, record);
    }

    selectedGroup = {
      createdAtMs,
      suppressedSessionIds,
      anchorSessionIds,
    };
  }

  return selectedGroup;
}

function resolveAdoptedParallelMessageSuppressionGroups(
  records: TaskSessionLineageRecord[],
): AdoptedParallelMessageSuppressionGroup[] {
  const groups = new Map<string, TaskSessionLineageRecord[]>();

  for (const record of records) {
    const phaseId = resolveParallelPhaseGroupKey(record);
    if (!phaseId) {
      continue;
    }

    const existing = groups.get(phaseId) ?? [];
    existing.push(record);
    groups.set(phaseId, existing);
  }

  const suppressionGroups: AdoptedParallelMessageSuppressionGroup[] = [];

  for (const group of groups.values()) {
    const candidateRecords = group.filter(isPendingParallelCandidateSession);
    if (candidateRecords.length < 2) {
      continue;
    }

    const rawWinnerIds = Array.from(
      new Set(
        candidateRecords
          .map((record) => asString(record.winnerSessionId))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (rawWinnerIds.length === 0) {
      continue;
    }

    const winnerSessionIds = new Set<string>();
    const winnerRecords = group.filter((record) => {
      const recordId = asString(record.id);
      const runtimeSessionId = asString(record.runtimeSessionId);
      return rawWinnerIds.some(
        (winnerId) => winnerId === recordId || winnerId === runtimeSessionId,
      );
    });
    if (winnerRecords.length > 0) {
      for (const record of winnerRecords) {
        addTaskSessionLineageRecordIds(winnerSessionIds, record);
      }
    } else {
      for (const winnerId of rawWinnerIds) {
        winnerSessionIds.add(winnerId);
      }
    }

    const suppressedSessionIds = new Set<string>();
    for (const record of candidateRecords) {
      const recordId = asString(record.id);
      const runtimeSessionId = asString(record.runtimeSessionId);
      const isWinner =
        (recordId != null && isSessionIdInSuppressionSet(recordId, winnerSessionIds)) ||
        (runtimeSessionId != null &&
          isSessionIdInSuppressionSet(runtimeSessionId, winnerSessionIds));
      if (isWinner) {
        continue;
      }
      addTaskSessionLineageRecordIds(suppressedSessionIds, record);
    }

    const anchorSessionIds = new Set<string>();
    for (const record of group) {
      if (!isParallelAnchorSession(record)) {
        continue;
      }
      addTaskSessionLineageRecordIds(anchorSessionIds, record);
    }

    suppressionGroups.push({
      suppressedSessionIds,
      winnerSessionIds,
      anchorSessionIds,
    });
  }

  return suppressionGroups;
}

export function resolvePendingParallelCompatSuppressedSessionIds(
  records: TaskSessionLineageRecord[],
): Set<string> | null {
  const group = resolveLatestPendingParallelMessageSuppressionGroup(records);
  return group?.suppressedSessionIds ?? null;
}

export function filterPendingParallelTaskConversationCompatMessages<TMessage>(
  args: FilterPendingParallelTaskConversationCompatMessagesArgs<TMessage>,
): TMessage[] {
  const { messages, records } = args;
  if (messages.length === 0 || records.length === 0) {
    return messages;
  }

  const suppressionGroup = resolveLatestPendingParallelMessageSuppressionGroup(records);
  const adoptedSuppressionGroups = resolveAdoptedParallelMessageSuppressionGroups(records);
  const nonExecutionUserMessageCountBySession = new Map<string, number>();
  for (const message of messages) {
    const sourceSessionId = args.extractSourceSessionId(message);
    if (!sourceSessionId || args.extractRole(message) !== "user") {
      continue;
    }
    if (args.isExecutionContextUserMessage(message)) {
      continue;
    }
    nonExecutionUserMessageCountBySession.set(
      sourceSessionId,
      (nonExecutionUserMessageCountBySession.get(sourceSessionId) ?? 0) + 1,
    );
  }

  if (!suppressionGroup && adoptedSuppressionGroups.length === 0) {
    return messages.filter((message) => {
      const sourceSessionId = args.extractSourceSessionId(message);
      if (!sourceSessionId || !args.isExecutionContextUserMessage(message)) {
        return true;
      }

      if (args.shouldPreserveWorkflowExecutionContextMessage(sourceSessionId)) {
        return true;
      }

      return (nonExecutionUserMessageCountBySession.get(sourceSessionId) ?? 0) === 0;
    });
  }

  const seenFirstUserPerAnchor = new Set<string>();
  return messages.filter((message) => {
    const sourceSessionId = args.extractSourceSessionId(message);
    if (!sourceSessionId) {
      return true;
    }
    const role = args.extractRole(message);

    for (const adoptedGroup of adoptedSuppressionGroups) {
      if (isSessionIdInSuppressionSet(sourceSessionId, adoptedGroup.suppressedSessionIds)) {
        return false;
      }
      if (isSessionIdInSuppressionSet(sourceSessionId, adoptedGroup.anchorSessionIds)) {
        if (role === "user" && !seenFirstUserPerAnchor.has(sourceSessionId)) {
          seenFirstUserPerAnchor.add(sourceSessionId);
          return true;
        }
        return false;
      }
      if (isSessionIdInSuppressionSet(sourceSessionId, adoptedGroup.winnerSessionIds)) {
        if (role === "user") {
          return false;
        }
        break;
      }
    }

    if (
      suppressionGroup &&
      isSessionIdInSuppressionSet(sourceSessionId, suppressionGroup.suppressedSessionIds)
    ) {
      return false;
    }
    if (
      suppressionGroup &&
      isSessionIdInSuppressionSet(sourceSessionId, suppressionGroup.anchorSessionIds)
    ) {
      if (role === "user" && !seenFirstUserPerAnchor.has(sourceSessionId)) {
        seenFirstUserPerAnchor.add(sourceSessionId);
        return true;
      }
      return false;
    }

    if (
      role === "user" &&
      args.isExecutionContextUserMessage(message) &&
      (nonExecutionUserMessageCountBySession.get(sourceSessionId) ?? 0) > 0 &&
      !args.shouldPreserveWorkflowExecutionContextMessage(sourceSessionId)
    ) {
      return false;
    }

    return true;
  });
}