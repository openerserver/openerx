type TaskSessionTopologyOrderRecord = {
  id: string;
  parentSessionId?: string | null;
  runtimeSessionId?: string | null;
  sessionKind?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  sortKey?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function compareOptionalNumber(left?: number | null, right?: number | null) {
  const normalizedLeft = typeof left === "number" ? left : Number.MAX_SAFE_INTEGER;
  const normalizedRight = typeof right === "number" ? right : Number.MAX_SAFE_INTEGER;
  return normalizedLeft - normalizedRight;
}

function resolveTaskSessionTopologyBucket(record: TaskSessionTopologyOrderRecord) {
  if (!record.parentSessionId) {
    return 0;
  }

  if (record.sessionKind === "resume" || record.sessionKind === "sequential_step") {
    return 0;
  }

  if (record.sessionKind === "candidate") {
    return 1;
  }

  if (record.sessionKind === "judge") {
    return 2;
  }

  if (record.sessionKind === "manual_branch") {
    return 3;
  }

  if (record.sessionKind === "hook") {
    return 4;
  }

  return 5;
}

function parseTaskSessionLifecycleTime(record: {
  createdAt?: string | null;
  updatedAt?: string | null;
}) {
  const createdAt = typeof record.createdAt === "string" ? Date.parse(record.createdAt) : Number.NaN;
  if (!Number.isNaN(createdAt)) {
    return createdAt;
  }

  const updatedAt = typeof record.updatedAt === "string" ? Date.parse(record.updatedAt) : Number.NaN;
  return Number.isNaN(updatedAt) ? Number.NEGATIVE_INFINITY : updatedAt;
}

export function resolveLatestTaskSessionId<
  TSession extends {
    id: string;
    createdAt?: string | null;
    updatedAt?: string | null;
  },
>(sessions: TSession[]) {
  let latestSessionId = sessions.at(-1)?.id ?? null;
  let latestLifecycleTime = Number.NEGATIVE_INFINITY;

  for (const session of sessions) {
    const lifecycleTime = parseTaskSessionLifecycleTime(session);
    if (lifecycleTime >= latestLifecycleTime) {
      latestLifecycleTime = lifecycleTime;
      latestSessionId = session.id;
    }
  }

  return latestSessionId;
}

export function orderTaskSessionsByTopology<TSession extends TaskSessionTopologyOrderRecord>(
  sessions: TSession[],
) {
  const byId = new Map(sessions.map((session) => [session.id, session] as const));
  const originalOrder = new Map<string, number>();
  const childrenByParent = new Map<string | null, TSession[]>();

  for (const [index, session] of sessions.entries()) {
    if (!originalOrder.has(session.id)) {
      originalOrder.set(session.id, index);
    }

    const normalizedParentId =
      session.parentSessionId && byId.has(session.parentSessionId) ? session.parentSessionId : null;
    const siblings = childrenByParent.get(normalizedParentId) ?? [];
    siblings.push(session);
    childrenByParent.set(normalizedParentId, siblings);
  }

  const compareSiblings = (left: TSession, right: TSession) => {
    const bucketDiff =
      resolveTaskSessionTopologyBucket(left) - resolveTaskSessionTopologyBucket(right);
    if (bucketDiff !== 0) {
      return bucketDiff;
    }

    const stepDiff = compareOptionalNumber(left.stepIndex, right.stepIndex);
    if (stepDiff !== 0) {
      return stepDiff;
    }

    const candidateDiff = compareOptionalNumber(left.candidateIndex, right.candidateIndex);
    if (candidateDiff !== 0) {
      return candidateDiff;
    }

    if (left.sortKey && right.sortKey && left.sortKey !== right.sortKey) {
      return left.sortKey.localeCompare(right.sortKey, "zh-CN");
    }

    const leftOriginalOrder = originalOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOriginalOrder = originalOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOriginalOrder !== rightOriginalOrder) {
      return leftOriginalOrder - rightOriginalOrder;
    }

    return String(left.runtimeSessionId ?? left.id).localeCompare(
      String(right.runtimeSessionId ?? right.id),
      "zh-CN",
    );
  };

  const ordered: TSession[] = [];
  const visited = new Set<string>();

  const visitChildren = (parentId: string | null) => {
    const siblings = [...(childrenByParent.get(parentId) ?? [])].sort(compareSiblings);
    for (const session of siblings) {
      if (visited.has(session.id)) {
        continue;
      }

      visited.add(session.id);
      ordered.push(session);
      visitChildren(session.id);
    }
  };

  visitChildren(null);

  const danglingSessions = sessions.filter((session) => !visited.has(session.id)).sort(compareSiblings);
  for (const session of danglingSessions) {
    if (visited.has(session.id)) {
      continue;
    }

    visited.add(session.id);
    ordered.push(session);
    visitChildren(session.id);
  }

  return ordered;
}