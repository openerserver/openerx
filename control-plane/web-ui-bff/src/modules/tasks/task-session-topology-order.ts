type TaskSessionTopologyOrderRecord = {
  id?: string;
  runtimeSessionId: string;
  parentRuntimeSessionId?: string | null;
  sourceType?: string | null;
  sessionKind?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
};

function compareOptionalNumber(left?: number | null, right?: number | null) {
  const normalizedLeft = typeof left === "number" ? left : Number.MAX_SAFE_INTEGER;
  const normalizedRight = typeof right === "number" ? right : Number.MAX_SAFE_INTEGER;
  return normalizedLeft - normalizedRight;
}

function resolveTaskSessionTopologyBucket(record: TaskSessionTopologyOrderRecord) {
  if (!record.parentRuntimeSessionId) {
    return 0;
  }

  if (
    record.sourceType === "sub_session" ||
    record.sessionKind === "resume" ||
    record.sessionKind === "sequential_step"
  ) {
    return 0;
  }

  if (record.sourceType === "parallel" || record.sessionKind === "candidate") {
    return 1;
  }

  if (record.sessionKind === "judge") {
    return 2;
  }

  if (record.sourceType === "fork" || record.sessionKind === "manual_branch") {
    return 3;
  }

  if (record.sessionKind === "hook") {
    return 4;
  }

  return 5;
}

export function orderTaskSessionLineageRecords<
  TRecord extends TaskSessionTopologyOrderRecord,
>(records: TRecord[]) {
  const byRuntimeSessionId = new Map(
    records.map((record) => [record.runtimeSessionId, record] as const),
  );
  const originalOrder = new Map<string, number>();
  const childrenByParent = new Map<string | null, TRecord[]>();

  for (const [index, record] of records.entries()) {
    if (!originalOrder.has(record.runtimeSessionId)) {
      originalOrder.set(record.runtimeSessionId, index);
    }

    const normalizedParentId =
      record.parentRuntimeSessionId && byRuntimeSessionId.has(record.parentRuntimeSessionId)
        ? record.parentRuntimeSessionId
        : null;
    const siblings = childrenByParent.get(normalizedParentId) ?? [];
    siblings.push(record);
    childrenByParent.set(normalizedParentId, siblings);
  }

  const compareSiblings = (left: TRecord, right: TRecord) => {
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

    const leftOriginalOrder =
      originalOrder.get(left.runtimeSessionId) ?? Number.MAX_SAFE_INTEGER;
    const rightOriginalOrder =
      originalOrder.get(right.runtimeSessionId) ?? Number.MAX_SAFE_INTEGER;
    if (leftOriginalOrder !== rightOriginalOrder) {
      return leftOriginalOrder - rightOriginalOrder;
    }

    return String(left.id ?? left.runtimeSessionId).localeCompare(
      String(right.id ?? right.runtimeSessionId),
      "zh-CN",
    );
  };

  const ordered: TRecord[] = [];
  const visited = new Set<string>();

  const visitChildren = (parentRuntimeSessionId: string | null) => {
    const siblings = [...(childrenByParent.get(parentRuntimeSessionId) ?? [])].sort(compareSiblings);
    for (const record of siblings) {
      if (visited.has(record.runtimeSessionId)) {
        continue;
      }

      visited.add(record.runtimeSessionId);
      ordered.push(record);
      visitChildren(record.runtimeSessionId);
    }
  };

  visitChildren(null);

  const danglingRecords = records
    .filter((record) => !visited.has(record.runtimeSessionId))
    .sort(compareSiblings);
  for (const record of danglingRecords) {
    if (visited.has(record.runtimeSessionId)) {
      continue;
    }

    visited.add(record.runtimeSessionId);
    ordered.push(record);
    visitChildren(record.runtimeSessionId);
  }

  return ordered;
}