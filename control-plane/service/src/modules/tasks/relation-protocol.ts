export type ProjectTaskRelationType = "depends-on" | "blocks" | "spawned-from";

export interface CreateTaskRawRelationInput {
  sourceTaskId?: string;
  targetTaskId?: string;
  type: ProjectTaskRelationType;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskRelationContext {
  spawnedFromTaskId?: string;
  dependsOnTaskIds?: string[];
  blockedByTaskIds?: string[];
  blocksTaskIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface NormalizedTaskRelation {
  sourceTaskId: string;
  targetTaskId: string;
  type: ProjectTaskRelationType;
  metadata: Record<string, unknown> | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => nonEmptyString(item)).filter((item): item is string => Boolean(item))));
}

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mergeMetadata(...values: Array<Record<string, unknown> | null | undefined>) {
  const merged = Object.assign({}, ...values.filter((value): value is Record<string, unknown> => Boolean(value)));
  return Object.keys(merged).length > 0 ? merged : null;
}

export function collectLinkedTaskIdsFromCreateInput(args: {
  relations?: CreateTaskRawRelationInput[];
  relationContext?: CreateTaskRelationContext;
}) {
  const linkedIds = new Set<string>();

  for (const relation of args.relations || []) {
    const sourceTaskId = nonEmptyString(relation.sourceTaskId);
    const targetTaskId = nonEmptyString(relation.targetTaskId);
    if (sourceTaskId) {
      linkedIds.add(sourceTaskId);
    }
    if (targetTaskId) {
      linkedIds.add(targetTaskId);
    }
  }

  const relationContext = args.relationContext;
  if (!relationContext) {
    return Array.from(linkedIds);
  }

  const spawnedFromTaskId = nonEmptyString(relationContext.spawnedFromTaskId);
  if (spawnedFromTaskId) {
    linkedIds.add(spawnedFromTaskId);
  }

  for (const taskId of normalizeStringList(relationContext.dependsOnTaskIds)) {
    linkedIds.add(taskId);
  }
  for (const taskId of normalizeStringList(relationContext.blockedByTaskIds)) {
    linkedIds.add(taskId);
  }
  for (const taskId of normalizeStringList(relationContext.blocksTaskIds)) {
    linkedIds.add(taskId);
  }

  return Array.from(linkedIds);
}

export function expandCreateTaskRelations(args: {
  taskId: string;
  relations?: CreateTaskRawRelationInput[];
  relationContext?: CreateTaskRelationContext;
}) {
  const normalized: NormalizedTaskRelation[] = [];
  const seen = new Set<string>();

  const push = (relation: NormalizedTaskRelation) => {
    if (!relation.sourceTaskId || !relation.targetTaskId || relation.sourceTaskId === relation.targetTaskId) {
      return;
    }
    const dedupeKey = `${relation.sourceTaskId}:${relation.targetTaskId}:${relation.type}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    normalized.push(relation);
  };

  for (const relation of args.relations || []) {
    push({
      sourceTaskId: nonEmptyString(relation.sourceTaskId) || args.taskId,
      targetTaskId: nonEmptyString(relation.targetTaskId) || args.taskId,
      type: relation.type,
      metadata: normalizeMetadata(relation.metadata),
    });
  }

  const relationContext = args.relationContext;
  if (!relationContext) {
    return normalized;
  }

  const baseMetadata = mergeMetadata(normalizeMetadata(relationContext.metadata), {
    protocol: "relation-context-v1",
  });

  const spawnedFromTaskId = nonEmptyString(relationContext.spawnedFromTaskId);
  if (spawnedFromTaskId) {
    push({
      sourceTaskId: spawnedFromTaskId,
      targetTaskId: args.taskId,
      type: "spawned-from",
      metadata: mergeMetadata(baseMetadata, { field: "spawnedFromTaskId" }),
    });
  }

  for (const sourceTaskId of normalizeStringList(relationContext.dependsOnTaskIds)) {
    push({
      sourceTaskId,
      targetTaskId: args.taskId,
      type: "depends-on",
      metadata: mergeMetadata(baseMetadata, { field: "dependsOnTaskIds" }),
    });
  }

  for (const sourceTaskId of normalizeStringList(relationContext.blockedByTaskIds)) {
    push({
      sourceTaskId,
      targetTaskId: args.taskId,
      type: "blocks",
      metadata: mergeMetadata(baseMetadata, { field: "blockedByTaskIds" }),
    });
  }

  for (const targetTaskId of normalizeStringList(relationContext.blocksTaskIds)) {
    push({
      sourceTaskId: args.taskId,
      targetTaskId,
      type: "blocks",
      metadata: mergeMetadata(baseMetadata, { field: "blocksTaskIds" }),
    });
  }

  return normalized;
}

export function parseStoredRelationContext(value: unknown): CreateTaskRelationContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const relationContext: CreateTaskRelationContext = {
    spawnedFromTaskId: nonEmptyString(record.spawnedFromTaskId) || undefined,
    dependsOnTaskIds: normalizeStringList(record.dependsOnTaskIds),
    blockedByTaskIds: normalizeStringList(record.blockedByTaskIds),
    blocksTaskIds: normalizeStringList(record.blocksTaskIds),
    metadata: normalizeMetadata(record.metadata) || undefined,
  };

  if (
    !relationContext.spawnedFromTaskId
    && relationContext.dependsOnTaskIds?.length === 0
    && relationContext.blockedByTaskIds?.length === 0
    && relationContext.blocksTaskIds?.length === 0
    && !relationContext.metadata
  ) {
    return null;
  }

  return relationContext;
}

export function parseStoredRawRelations(value: unknown): CreateTaskRawRelationInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const type = record.type;
    if (type !== "depends-on" && type !== "blocks" && type !== "spawned-from") {
      return [];
    }

    return [{
      sourceTaskId: nonEmptyString(record.sourceTaskId) || undefined,
      targetTaskId: nonEmptyString(record.targetTaskId) || undefined,
      type,
      metadata: normalizeMetadata(record.metadata) || undefined,
    } satisfies CreateTaskRawRelationInput];
  });
}

export function mergeRelationContexts(...contexts: Array<CreateTaskRelationContext | null | undefined>) {
  const merged: CreateTaskRelationContext = {};

  for (const context of contexts) {
    if (!context) {
      continue;
    }
    if (!merged.spawnedFromTaskId && context.spawnedFromTaskId) {
      merged.spawnedFromTaskId = context.spawnedFromTaskId;
    }
    merged.dependsOnTaskIds = Array.from(new Set([...(merged.dependsOnTaskIds || []), ...(context.dependsOnTaskIds || [])]));
    merged.blockedByTaskIds = Array.from(new Set([...(merged.blockedByTaskIds || []), ...(context.blockedByTaskIds || [])]));
    merged.blocksTaskIds = Array.from(new Set([...(merged.blocksTaskIds || []), ...(context.blocksTaskIds || [])]));
    merged.metadata = mergeMetadata(merged.metadata || null, context.metadata || null) || undefined;
  }

  return parseStoredRelationContext(merged);
}