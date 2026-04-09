type TaskToolTimelineRow = {
  id: string;
  sessionId: string | null;
  messageId: string | null;
  itemKind: string | null;
  itemRole: string | null;
  title: string | null;
  displayText: string | null;
  metadataJson: Record<string, unknown> | null;
  sortAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type TaskToolTimelineSession = {
  id: string;
  runtimeSessionId?: string | null;
};

type TaskToolIdentitySource = Record<string, unknown> | null | undefined;

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeTaskToolIdentity(
  toolIdentity: string | null | undefined,
  runtimeSessionId: string | null,
) {
  let normalized = asNonEmptyString(toolIdentity);
  if (!normalized) {
    return null;
  }

  const sessionToolPrefix = runtimeSessionId ? `${runtimeSessionId}:tool:` : null;
  if (sessionToolPrefix && normalized.startsWith(sessionToolPrefix)) {
    normalized = normalized.slice(sessionToolPrefix.length);
  }
  if (normalized.startsWith("tool:")) {
    normalized = normalized.slice("tool:".length);
  }

  const sessionPrefix = runtimeSessionId ? `${runtimeSessionId}:` : null;
  if (sessionPrefix && normalized.startsWith(sessionPrefix)) {
    normalized = normalized.slice(sessionPrefix.length);
  }
  if (normalized.startsWith("tool:")) {
    normalized = normalized.slice("tool:".length);
  }

  return normalized.trim() || null;
}

function collectTaskToolIdentityCandidates(sources: TaskToolIdentitySource[]) {
  return sources.flatMap((source) => {
    const record = asRecord(source);
    if (!record) {
      return [];
    }

    return [
      asNonEmptyString(record.callID),
      asNonEmptyString(record.callId),
      asNonEmptyString(record.toolCallId),
      asNonEmptyString(record.id),
      asNonEmptyString(record.messageID),
      asNonEmptyString(record.messageId),
    ];
  });
}

export function resolveTaskToolIdentity(args: {
  runtimeSessionId: string | null;
  identitySources?: TaskToolIdentitySource[];
  runtimeCandidates?: Array<string | null | undefined>;
}) {
  const identityCandidates = collectTaskToolIdentityCandidates(args.identitySources ?? []);

  for (const candidate of [...identityCandidates, ...(args.runtimeCandidates ?? [])]) {
    const normalized = normalizeTaskToolIdentity(candidate, args.runtimeSessionId);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function resolveTaskToolTimelineRowSortTime(
  row: Pick<TaskToolTimelineRow, "sortAt" | "createdAt">,
) {
  const sortAt = Date.parse(row.sortAt ?? "");
  if (!Number.isNaN(sortAt)) {
    return sortAt;
  }

  const createdAt = Date.parse(row.createdAt ?? "");
  return Number.isNaN(createdAt) ? Number.MAX_SAFE_INTEGER : createdAt;
}

function resolveTaskToolTimelineRuntimeMessageId(
  row: Pick<TaskToolTimelineRow, "messageId" | "metadataJson">,
  sessionId: string,
) {
  const metadata = asRecord(row.metadataJson);
  const runtimeMessageId = asNonEmptyString(metadata?.runtimeMessageId);
  if (runtimeMessageId) {
    return runtimeMessageId;
  }

  const messageId = asNonEmptyString(row.messageId);
  if (!messageId) {
    return null;
  }

  const messagePrefix = `task-session-message:${sessionId}:`;
  if (messageId.startsWith(messagePrefix)) {
    return messageId.slice(messagePrefix.length).trim() || null;
  }

  return messageId;
}

function resolveTaskToolTimelineSemanticKey(
  row: Pick<TaskToolTimelineRow, "sessionId" | "messageId" | "itemKind" | "itemRole" | "metadataJson">,
  runtimeSessionIdBySessionId: Map<string, string>,
) {
  if (row.itemKind !== "message" || row.itemRole !== "tool") {
    return null;
  }

  const sessionId = asNonEmptyString(row.sessionId);
  if (!sessionId) {
    return null;
  }

  const runtimeMessageId = resolveTaskToolTimelineRuntimeMessageId(row, sessionId);
  const toolIdentity = resolveTaskToolIdentity({
    runtimeSessionId: runtimeSessionIdBySessionId.get(sessionId) ?? null,
    identitySources: [asRecord(row.metadataJson)],
    runtimeCandidates: [runtimeMessageId],
  });
  if (!toolIdentity) {
    return null;
  }

  return `${sessionId}::tool-timeline::${toolIdentity}`;
}

function mergeTaskToolTimelineDuplicateRows<TRow extends TaskToolTimelineRow>(
  existing: TRow,
  candidate: TRow,
) {
  const existingSortTime = resolveTaskToolTimelineRowSortTime(existing);
  const candidateSortTime = resolveTaskToolTimelineRowSortTime(candidate);
  const preferred =
    candidateSortTime === existingSortTime
      ? (candidate.displayText ?? "").length > (existing.displayText ?? "").length
        ? candidate
        : existing
      : candidateSortTime > existingSortTime
        ? candidate
        : existing;
  const fallback = preferred === candidate ? existing : candidate;

  return {
    ...preferred,
    title: preferred.title ?? fallback.title,
    displayText: preferred.displayText ?? fallback.displayText,
    metadataJson: preferred.metadataJson ?? fallback.metadataJson,
    createdAt: preferred.createdAt ?? fallback.createdAt,
    sortAt: preferred.sortAt ?? fallback.sortAt,
    updatedAt: preferred.updatedAt ?? fallback.updatedAt,
  } as TRow;
}

export function dedupeTaskToolTimelineRows<TRow extends TaskToolTimelineRow>(
  rows: TRow[],
  sessions: TaskToolTimelineSession[],
) {
  const runtimeSessionIdBySessionId = new Map(
    sessions.map((session) => [session.id, asNonEmptyString(session.runtimeSessionId) ?? session.id] as const),
  );
  const seenBySemanticKey = new Map<string, number>();
  const deduped: TRow[] = [];

  for (const row of rows) {
    const semanticKey = resolveTaskToolTimelineSemanticKey(
      row,
      runtimeSessionIdBySessionId,
    );
    const existingIndex = semanticKey ? seenBySemanticKey.get(semanticKey) : undefined;
    if (existingIndex == null) {
      deduped.push(row);
      if (semanticKey) {
        seenBySemanticKey.set(semanticKey, deduped.length - 1);
      }
      continue;
    }

    const existing = deduped[existingIndex];
    if (!existing) {
      deduped.push(row);
      if (semanticKey) {
        seenBySemanticKey.set(semanticKey, deduped.length - 1);
      }
      continue;
    }

    deduped[existingIndex] = mergeTaskToolTimelineDuplicateRows(existing, row);
  }

  return deduped.sort((left, right) => {
    const leftTime = resolveTaskToolTimelineRowSortTime(left);
    const rightTime = resolveTaskToolTimelineRowSortTime(right);
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    const leftId = asNonEmptyString(left.id) ?? "";
    const rightId = asNonEmptyString(right.id) ?? "";
    return leftId.localeCompare(rightId);
  });
}