import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import {
  agentRuns,
  projectTreeEvents,
  projectTreeNodes,
  repositories,
  repositoryCredentials,
} from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { recordAuditEvent } from "../audit/routes";
import {
  archiveTaskSessionTreeNode,
  getTaskSessionNodeId,
  type TaskTreeSnapshot,
  syncTaskRelationLinks,
  upsertTaskTreeNode,
  upsertTaskSessionTreeNode,
} from "../project-tree/storage";
import { loadTaskTreeRecord, loadTaskTreeRecordMap } from "../project-tree/task-view";
import {
  collectLinkedTaskIdsFromCreateInput,
  expandCreateTaskRelations,
} from "./relation-protocol";

function toProjectTreeLinkType(type: "depends-on" | "blocks" | "spawned-from") {
  if (type === "spawned-from") {
    return "spawned" as const;
  }

  return type;
}

function extractPersistedMessageId(message: unknown) {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;
  const info =
    typeof record.info === "object" && record.info
      ? (record.info as Record<string, unknown>)
      : undefined;
  const infoId = info?.id;
  if (typeof infoId === "string" && infoId.trim()) {
    return infoId;
  }

  const directId = record.id;
  return typeof directId === "string" && directId.trim() ? directId : undefined;
}

function buildPersistedSessionMessages(events: Array<{ seq: number; payload: Record<string, unknown> }>) {
  const order: string[] = [];
  const latestById = new Map<string, unknown>();

  for (const event of events) {
    const message = event.payload.message;
    const messageId = extractPersistedMessageId(message) || `anonymous-${event.seq}`;
    if (!latestById.has(messageId)) {
      order.push(messageId);
    }
    latestById.set(messageId, message);
  }

  return order
    .map((messageId) => latestById.get(messageId))
    .filter((message): message is Record<string, unknown> => Boolean(message));
}

function extractPersistedMessageInfo(message: unknown) {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;
  return typeof record.info === "object" && record.info
    ? (record.info as Record<string, unknown>)
    : undefined;
}

function extractPersistedMessageRole(message: unknown) {
  const info = extractPersistedMessageInfo(message);
  return typeof info?.role === "string" ? info.role : undefined;
}

function extractPersistedMessageCompletedAt(message: unknown) {
  const info = extractPersistedMessageInfo(message);
  const time =
    typeof info?.time === "object" && info.time ? (info.time as Record<string, unknown>) : undefined;
  const completed = time?.completed;

  if (typeof completed === "number" && Number.isFinite(completed)) {
    return completed;
  }
  if (typeof completed === "string") {
    const parsedNumeric = Number(completed);
    if (Number.isFinite(parsedNumeric)) {
      return parsedNumeric;
    }
    const parsedTime = Date.parse(completed);
    return Number.isFinite(parsedTime) ? parsedTime : undefined;
  }

  return undefined;
}

function normalizePersistedTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string") {
    const parsedNumeric = Number(value);
    if (Number.isFinite(parsedNumeric)) {
      return new Date(parsedNumeric).toISOString();
    }

    const parsedTime = Date.parse(value);
    if (!Number.isNaN(parsedTime)) {
      return new Date(parsedTime).toISOString();
    }
  }

  return undefined;
}

function extractPersistedMessageCreatedAt(message: unknown) {
  const info = extractPersistedMessageInfo(message);
  const time =
    typeof info?.time === "object" && info.time ? (info.time as Record<string, unknown>) : undefined;
  return normalizePersistedTimestamp(time?.created);
}

function extractPersistedMessageText(message: unknown) {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const parts = Array.isArray((message as { parts?: unknown }).parts)
    ? ((message as { parts: unknown[] }).parts as Array<Record<string, unknown>>)
    : [];
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text).trim())
    .filter(Boolean)
    .join("\n\n");

  return text || undefined;
}

function extractPersistedMessagePartTypes(message: unknown) {
  if (!message || typeof message !== "object") {
    return [] as string[];
  }

  const parts = Array.isArray((message as { parts?: unknown }).parts)
    ? ((message as { parts: unknown[] }).parts as Array<Record<string, unknown>>)
    : [];
  return parts
    .map((part) => (typeof part.type === "string" ? part.type : ""))
    .filter((partType): partType is string => Boolean(partType));
}

function extractPersistedMessageTokenUsage(message: unknown) {
  const info = extractPersistedMessageInfo(message);
  const tokens =
    typeof info?.tokens === "object" && info.tokens
      ? (info.tokens as Record<string, unknown>)
      : undefined;
  if (!tokens) {
    return 0;
  }

  const tokenValues = [tokens.total, tokens.input, tokens.output, tokens.reasoning]
    .map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0))
    .filter((value) => value > 0);
  return tokenValues[0] ?? 0;
}

function isSnapshotEventType(eventType: string) {
  return eventType === "session.message.snapshot" || eventType === "session.message.updated";
}

function isSessionMessageEventType(eventType: string) {
  return eventType.startsWith("session.message.");
}

function extractPersistedEventMessageId(event: {
  seq: number;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const payloadMessageId = event.payload.messageId;
  if (typeof payloadMessageId === "string" && payloadMessageId.trim()) {
    return payloadMessageId;
  }

  return extractPersistedMessageId(event.payload.message) ?? `anonymous-${event.seq}`;
}

type PersistedSessionEvent = {
  seq: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type PersistedSessionEventGroup = {
  id: string;
  events: PersistedSessionEvent[];
};

function buildPersistedSessionEventGroups(events: PersistedSessionEvent[]) {
  const groups: PersistedSessionEventGroup[] = [];
  const groupById = new Map<string, PersistedSessionEventGroup>();

  for (const event of events) {
    const messageId = extractPersistedEventMessageId(event);
    const existing = groupById.get(messageId);
    if (existing) {
      existing.events.push(event);
      continue;
    }

    const group = { id: messageId, events: [event] } satisfies PersistedSessionEventGroup;
    groupById.set(messageId, group);
    groups.push(group);
  }

  return groups;
}

function flattenPersistedSessionEventGroups(groups: PersistedSessionEventGroup[]) {
  return groups.flatMap((group) => group.events);
}

function sliceEventGroupsForLineageBoundary(
  groups: PersistedSessionEventGroup[],
  childRecord?: TaskSessionLineageRecord,
) {
  if (!childRecord?.forkedFromMessageId) {
    return groups;
  }

  const boundaryIndex = groups.findIndex((group) => group.id === childRecord.forkedFromMessageId);
  if (boundaryIndex < 0) {
    return groups;
  }

  return groups.slice(0, boundaryIndex + 1);
}

function buildPersistedSessionTimeline(groups: PersistedSessionEventGroup[]) {
  return groups.map((group) => {
    const messages = buildPersistedSessionMessages(
      group.events.map((event) => ({ seq: event.seq, payload: event.payload })),
    );
    const latestMessage = messages.at(-1) ?? null;
    const completedAt = latestMessage ? extractPersistedMessageCompletedAt(latestMessage) : undefined;
    const createdAt = latestMessage ? extractPersistedMessageCreatedAt(latestMessage) : undefined;

    return {
      id: group.id,
      role: latestMessage ? (extractPersistedMessageRole(latestMessage) ?? "unknown") : "unknown",
      text: latestMessage ? (extractPersistedMessageText(latestMessage) ?? "") : "",
      createdAt,
      completedAt: normalizePersistedTimestamp(completedAt) ?? null,
      raw: latestMessage,
      sourceEventTypes: Array.from(new Set(group.events.map((event) => event.eventType))),
    };
  });
}

function dedupeMergedLineageTimeline(
  items: Array<{
    id: string;
    role: string;
    text: string;
    createdAt?: string;
    completedAt: string | null;
    raw: Record<string, unknown> | null;
    sourceEventTypes: string[];
  }>,
) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function deriveCacheState(totalSessionCount: number, cachedSessionCount: number) {
  if (cachedSessionCount <= 0 || totalSessionCount <= 0) {
    return "none" as const;
  }

  if (cachedSessionCount >= totalSessionCount) {
    return "complete" as const;
  }

  return "partial" as const;
}

type TaskSessionLineageRecord = {
  id: string;
  taskId: string;
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  branchName: string | null;
  sourceType: "root" | "fork" | "sub_session";
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
};

async function loadPersistedSessionEventsForNode(projectId: string, nodeId: string) {
  const events = await db
    .select({
      seq: projectTreeEvents.seq,
      eventType: projectTreeEvents.eventType,
      payload: projectTreeEvents.payload,
      createdAt: projectTreeEvents.createdAt,
    })
    .from(projectTreeEvents)
    .where(
      and(
        eq(projectTreeEvents.nodeId, nodeId),
        eq(projectTreeEvents.projectId, projectId),
      ),
    )
    .orderBy(asc(projectTreeEvents.seq), asc(projectTreeEvents.createdAt));

  return events.filter((event) => isSessionMessageEventType(event.eventType));
}

function sliceMessagesForLineageBoundary(
  messages: Record<string, unknown>[],
  childRecord?: TaskSessionLineageRecord,
) {
  if (!childRecord?.forkedFromMessageId) {
    return messages;
  }

  const boundaryIndex = messages.findIndex(
    (message) => extractPersistedMessageId(message) === childRecord.forkedFromMessageId,
  );
  if (boundaryIndex < 0) {
    return messages;
  }

  return messages.slice(0, boundaryIndex + 1);
}

function dedupeMergedLineageMessages(messages: Record<string, unknown>[]) {
  const seen = new Set<string>();
  let anonymousIndex = 0;

  return messages.filter((message) => {
    const messageId = extractPersistedMessageId(message) || `anonymous-${anonymousIndex++}`;
    if (seen.has(messageId)) {
      return false;
    }
    seen.add(messageId);
    return true;
  });
}

function compareTaskSessionLineageTime(left?: string | null, right?: string | null) {
  const leftTime = left ? Date.parse(left) : Number.POSITIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}

function dedupeTaskSessionLineageRecords(records: TaskSessionLineageRecord[]) {
  const byRuntimeSessionId = new Map<string, TaskSessionLineageRecord>();

  for (const record of records) {
    const existing = byRuntimeSessionId.get(record.runtimeSessionId);
    if (!existing) {
      byRuntimeSessionId.set(record.runtimeSessionId, record);
      continue;
    }

    const existingScore =
      Number(Boolean(existing.parentRuntimeSessionId)) + Number(Boolean(existing.forkedFromMessageId));
    const nextScore =
      Number(Boolean(record.parentRuntimeSessionId)) + Number(Boolean(record.forkedFromMessageId));
    const existingUpdated = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    const nextUpdated = record.updatedAt ? Date.parse(record.updatedAt) : 0;

    if (nextScore > existingScore || nextUpdated > existingUpdated) {
      byRuntimeSessionId.set(record.runtimeSessionId, record);
    }
  }

  return Array.from(byRuntimeSessionId.values()).sort((left, right) =>
    compareTaskSessionLineageTime(left.createdAt, right.createdAt),
  );
}

function findTaskSessionLineageRoot(records: TaskSessionLineageRecord[]) {
  return (
    records.find((record) => record.sourceType === "root") ??
    records
      .slice()
      .sort((left, right) => compareTaskSessionLineageTime(left.createdAt, right.createdAt))[0]
  );
}

function repairTaskSessionLineageRecord(
  record: TaskSessionLineageRecord,
  rootRuntimeSessionId: string,
) {
  if (record.runtimeSessionId === rootRuntimeSessionId) {
    record.parentRuntimeSessionId = null;
    record.sourceType = "root";
    return;
  }

  if (!record.parentRuntimeSessionId) {
    record.parentRuntimeSessionId = rootRuntimeSessionId;
    if (record.sourceType !== "sub_session") {
      record.sourceType = "fork";
    }
    return;
  }

  if (record.sourceType === "root") {
    record.sourceType = "fork";
  }
}

function normalizeTaskSessionLineageRecords(records: TaskSessionLineageRecord[]) {
  const normalized = dedupeTaskSessionLineageRecords(records).map((record) => ({ ...record }));
  if (normalized.length <= 1) {
    return normalized;
  }

  const rootRecord = findTaskSessionLineageRoot(normalized);
  if (!rootRecord) {
    return normalized;
  }

  for (const record of normalized) {
    repairTaskSessionLineageRecord(record, rootRecord.runtimeSessionId);
  }

  return normalized;
}

function buildTaskSessionLineagePath(
  records: TaskSessionLineageRecord[],
  runtimeSessionId: string,
) {
  const recordMap = new Map(records.map((record) => [record.runtimeSessionId, record] as const));
  const path: TaskSessionLineageRecord[] = [];
  const visited = new Set<string>();

  let current = recordMap.get(runtimeSessionId);
  while (current && !visited.has(current.runtimeSessionId)) {
    path.push(current);
    visited.add(current.runtimeSessionId);
    current = current.parentRuntimeSessionId
      ? recordMap.get(current.parentRuntimeSessionId)
      : undefined;
  }

  return path.reverse();
}

function parseTaskSessionTreeContent(content: unknown): {
  sourceType: "root" | "fork" | "sub_session";
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
} {
  if (!content || typeof content !== "object") {
    return {
      sourceType: "root" as const,
      parentRuntimeSessionId: null,
      forkedFromMessageId: null,
    };
  }

  const record = content as Record<string, unknown>;

  const sourceType =
    record.sourceType === "root" || record.sourceType === "fork" || record.sourceType === "sub_session"
      ? record.sourceType
      : "root";

  return {
    sourceType,
    parentRuntimeSessionId:
      typeof record.parentRuntimeSessionId === "string" && record.parentRuntimeSessionId.length > 0
        ? record.parentRuntimeSessionId
        : null,
    forkedFromMessageId:
      typeof record.forkedFromMessageId === "string" && record.forkedFromMessageId.length > 0
        ? record.forkedFromMessageId
        : null,
  };
}

function mapTreeNodeToTaskSessionRecord(
  taskId: string,
  node: typeof projectTreeNodes.$inferSelect,
): TaskSessionLineageRecord {
  const content = parseTaskSessionTreeContent(node.contentJson);

  return {
    id: node.id,
    taskId,
    runtimeSessionId: node.runtimeSessionId ?? node.branchName ?? node.contentText ?? node.id,
    parentRuntimeSessionId: content.parentRuntimeSessionId,
    forkedFromMessageId: content.forkedFromMessageId,
    branchName: node.branchName ?? node.contentText,
    sourceType: content.sourceType,
    isActive: node.isActive ?? false,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    archivedAt: node.archivedAt,
  };
}

async function listTaskSessionTreeRecords(
  taskId: string,
  projectId: string,
  options?: { includeArchived?: boolean },
) {
  const conditions = [
    eq(projectTreeNodes.projectId, projectId),
    eq(projectTreeNodes.nodeType, "session"),
    sql`${projectTreeNodes.id} like ${`task_session:${taskId}:%`}`,
  ];
  if (!options?.includeArchived) {
    conditions.push(isNull(projectTreeNodes.archivedAt));
  }

  const treeRows = await db
    .select()
    .from(projectTreeNodes)
    .where(and(...conditions))
    .orderBy(projectTreeNodes.createdAt);

  return treeRows.map((node) => mapTreeNodeToTaskSessionRecord(taskId, node));
}

async function resolveTaskSessionRecord(taskId: string, projectId: string, sessionId: string) {
  const treeRecord = await db.query.projectTreeNodes.findFirst({
    where: and(
      eq(projectTreeNodes.projectId, projectId),
      eq(projectTreeNodes.id, sessionId),
      eq(projectTreeNodes.nodeType, "session"),
    ),
  });
  if (treeRecord) {
    return mapTreeNodeToTaskSessionRecord(taskId, treeRecord);
  }

  return null;
}

async function resolveTaskSessionRecordByRuntimeSessionId(
  taskId: string,
  projectId: string,
  runtimeSessionId: string,
) {
  const nodeId = getTaskSessionNodeId(taskId, runtimeSessionId);
  const treeRecord = await db.query.projectTreeNodes.findFirst({
    where: and(
      eq(projectTreeNodes.projectId, projectId),
      eq(projectTreeNodes.id, nodeId),
      eq(projectTreeNodes.nodeType, "session"),
    ),
  });
  if (treeRecord) {
    return mapTreeNodeToTaskSessionRecord(taskId, treeRecord);
  }

  return null;
}

async function loadTaskTreeBackedRecord(taskId: string) {
  return loadTaskTreeRecord(taskId);
}

function buildTaskTreeSnapshotFromCreateInput(
  userId: string,
  taskId: string,
  body: CreateTaskInput,
): TaskTreeSnapshot {
  const now = new Date().toISOString();

  return {
    id: taskId,
    projectId: body.projectId,
    userId,
    title: body.title,
    prompt: body.prompt,
    status: "pending",
    sessionId: null,
    agentRunId: null,
    result: null,
    category: null,
    strategy: null,
    repoId: body.repoId ?? null,
    workspaceRoot: null,
    baseRevision: null,
    workingBranch: body.workingBranch ?? null,
    selectedModel: body.selectedModel ?? null,
    executionMode: null,
    executionPlan: null,
    autoAdvanceStages: false,
    credentialId: body.credentialId ?? null,
    gitAuthorName: body.gitAuthorName ?? null,
    gitAuthorEmail: body.gitAuthorEmail ?? null,
    gitCommitterName: body.gitCommitterName ?? null,
    gitCommitterEmail: body.gitCommitterEmail ?? null,
    finalCommitSha: null,
    finalBranchName: null,
    changesSummary: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
}

function buildTaskTreeSnapshotFromRecord(
  task: NonNullable<Awaited<ReturnType<typeof loadTaskTreeRecord>>>,
  updates: Record<string, unknown>,
): TaskTreeSnapshot {
  return {
    id: task.id,
    projectId: task.projectId,
    userId: task.userId,
    title: task.title,
    prompt: task.prompt,
    status: (updates.status as TaskTreeSnapshot["status"] | undefined) ?? task.status,
    sessionId: (updates.sessionId as string | undefined) ?? task.sessionId,
    agentRunId: (updates.agentRunId as string | undefined) ?? task.agentRunId,
    result: (updates.result as string | undefined) ?? task.result,
    category: (updates.category as TaskTreeSnapshot["category"] | undefined) ?? task.category,
    strategy:
      typeof updates.strategy === "string" || updates.strategy === null
        ? updates.strategy
        : typeof task.strategy === "string" || task.strategy === null
          ? task.strategy
          : null,
    repoId: task.repoId,
    workspaceRoot: (updates.workspaceRoot as string | undefined) ?? task.workspaceRoot,
    baseRevision: (updates.baseRevision as string | undefined) ?? task.baseRevision,
    workingBranch: (updates.workingBranch as string | undefined) ?? task.workingBranch,
    selectedModel: (updates.selectedModel as string | null | undefined) ?? task.selectedModel,
    executionMode:
      (updates.executionMode as TaskTreeSnapshot["executionMode"] | undefined) ?? task.executionMode,
    executionPlan: (updates.executionPlan as string | undefined) ?? task.executionPlan,
    autoAdvanceStages:
      (updates.autoAdvanceStages as boolean | undefined) ?? task.autoAdvanceStages,
    credentialId: (updates.credentialId as string | undefined) ?? task.credentialId,
    gitAuthorName: (updates.gitAuthorName as string | undefined) ?? task.gitAuthorName,
    gitAuthorEmail: (updates.gitAuthorEmail as string | undefined) ?? task.gitAuthorEmail,
    gitCommitterName:
      (updates.gitCommitterName as string | undefined) ?? task.gitCommitterName,
    gitCommitterEmail:
      (updates.gitCommitterEmail as string | undefined) ?? task.gitCommitterEmail,
    finalCommitSha: (updates.finalCommitSha as string | undefined) ?? task.finalCommitSha,
    finalBranchName: (updates.finalBranchName as string | undefined) ?? task.finalBranchName,
    changesSummary:
      (updates.changesSummary as TaskTreeSnapshot["changesSummary"] | undefined) ??
      task.changesSummary,
    createdAt: task.createdAt,
    startedAt: (updates.startedAt as string | undefined) ?? task.startedAt,
    finishedAt: (updates.finishedAt as string | undefined) ?? task.finishedAt,
  };
}

async function loadPersistedMessagesForSessionNode(projectId: string, nodeId: string) {
  const events = await db
    .select({
      seq: projectTreeEvents.seq,
      eventType: projectTreeEvents.eventType,
      payload: projectTreeEvents.payload,
      createdAt: projectTreeEvents.createdAt,
    })
    .from(projectTreeEvents)
    .where(
      and(
        eq(projectTreeEvents.nodeId, nodeId),
        eq(projectTreeEvents.projectId, projectId),
        inArray(projectTreeEvents.eventType, ["session.message.snapshot", "session.message.updated"]),
      ),
    )
    .orderBy(asc(projectTreeEvents.seq), asc(projectTreeEvents.createdAt));

  return buildPersistedSessionMessages(events);
}

async function buildTaskSessionMessagesResponse(args: {
  taskId: string;
  projectId: string;
  runtimeSessionId: string;
  includeLineage: boolean;
}) {
  if (!args.includeLineage) {
    const data = await loadPersistedMessagesForSessionNode(
      args.projectId,
      getTaskSessionNodeId(args.taskId, args.runtimeSessionId),
    );
    const cacheState = deriveCacheState(1, data.length > 0 ? 1 : 0);
    return {
      data,
      meta: {
        includeLineage: false,
        cacheState,
        complete: cacheState === "complete",
        lineagePath: [args.runtimeSessionId],
        cachedSessionCount: data.length > 0 ? 1 : 0,
      },
    };
  }

  const rows = await listTaskSessionTreeRecords(args.taskId, args.projectId);

  const lineagePath = buildTaskSessionLineagePath(
    normalizeTaskSessionLineageRecords(rows),
    args.runtimeSessionId,
  );

  if (lineagePath.length === 0) {
    return {
      data: [] as Record<string, unknown>[],
      meta: {
        includeLineage: true,
        cacheState: "none" as const,
        complete: false,
        lineagePath: [] as string[],
        cachedSessionCount: 0,
      },
    };
  }

  const messageSets = await Promise.all(
    lineagePath.map(async (record) => ({
      record,
      messages: await loadPersistedMessagesForSessionNode(
        args.projectId,
        getTaskSessionNodeId(args.taskId, record.runtimeSessionId),
      ),
    })),
  );

  const cachedSessionCount = messageSets.filter(({ messages }) => messages.length > 0).length;
  const cacheState = deriveCacheState(lineagePath.length, cachedSessionCount);
  const merged = messageSets.flatMap(({ messages }, index) =>
    sliceMessagesForLineageBoundary(messages, lineagePath[index + 1]),
  );

  return {
    data: dedupeMergedLineageMessages(merged),
    meta: {
      includeLineage: true,
      cacheState,
      complete: cacheState === "complete",
      lineagePath: lineagePath.map((record) => record.runtimeSessionId),
      cachedSessionCount,
    },
  };
}

async function buildTaskSessionEventsResponse(args: {
  taskId: string;
  projectId: string;
  runtimeSessionId: string;
  includeLineage: boolean;
}) {
  if (!args.includeLineage) {
    const events = await loadPersistedSessionEventsForNode(
      args.projectId,
      getTaskSessionNodeId(args.taskId, args.runtimeSessionId),
    );
    const cacheState = deriveCacheState(1, events.length > 0 ? 1 : 0);
    return {
      data: events,
      meta: {
        includeLineage: false,
        cacheState,
        complete: cacheState === "complete",
        lineagePath: [args.runtimeSessionId],
        cachedSessionCount: events.length > 0 ? 1 : 0,
        eventCount: events.length,
      },
    };
  }

  const rows = await listTaskSessionTreeRecords(args.taskId, args.projectId);

  const lineagePath = buildTaskSessionLineagePath(
    normalizeTaskSessionLineageRecords(rows),
    args.runtimeSessionId,
  );

  if (lineagePath.length === 0) {
    return {
      data: [] as Array<{ seq: number; eventType: string; payload: Record<string, unknown>; createdAt: string }>,
      meta: {
        includeLineage: true,
        cacheState: "none" as const,
        complete: false,
        lineagePath: [] as string[],
        cachedSessionCount: 0,
        eventCount: 0,
      },
    };
  }

  const eventSets = await Promise.all(
    lineagePath.map(async (record) => ({
      record,
      groups: buildPersistedSessionEventGroups(
        await loadPersistedSessionEventsForNode(
          args.projectId,
          getTaskSessionNodeId(args.taskId, record.runtimeSessionId),
        ),
      ),
    })),
  );

  const cachedSessionCount = eventSets.filter(({ groups }) => groups.length > 0).length;
  const cacheState = deriveCacheState(lineagePath.length, cachedSessionCount);
  const flattened = eventSets.flatMap(({ groups }, index) =>
    flattenPersistedSessionEventGroups(sliceEventGroupsForLineageBoundary(groups, lineagePath[index + 1])),
  );

  return {
    data: flattened,
    meta: {
      includeLineage: true,
      cacheState,
      complete: cacheState === "complete",
      lineagePath: lineagePath.map((record) => record.runtimeSessionId),
      cachedSessionCount,
      eventCount: flattened.length,
    },
  };
}

async function buildTaskSessionTimelineResponse(args: {
  taskId: string;
  projectId: string;
  runtimeSessionId: string;
  includeLineage: boolean;
}) {
  if (!args.includeLineage) {
    const groups = buildPersistedSessionEventGroups(
      await loadPersistedSessionEventsForNode(
        args.projectId,
        getTaskSessionNodeId(args.taskId, args.runtimeSessionId),
      ),
    );
    const data = buildPersistedSessionTimeline(groups);
    const cacheState = deriveCacheState(1, data.length > 0 ? 1 : 0);
    return {
      data,
      meta: {
        includeLineage: false,
        cacheState,
        complete: cacheState === "complete",
        lineagePath: [args.runtimeSessionId],
        cachedSessionCount: data.length > 0 ? 1 : 0,
        itemCount: data.length,
      },
    };
  }

  const rows = await listTaskSessionTreeRecords(args.taskId, args.projectId);

  const lineagePath = buildTaskSessionLineagePath(
    normalizeTaskSessionLineageRecords(rows),
    args.runtimeSessionId,
  );

  if (lineagePath.length === 0) {
    return {
      data: [] as Array<{
        id: string;
        role: string;
        text: string;
        createdAt?: string;
        completedAt: string | null;
        raw: Record<string, unknown> | null;
        sourceEventTypes: string[];
      }>,
      meta: {
        includeLineage: true,
        cacheState: "none" as const,
        complete: false,
        lineagePath: [] as string[],
        cachedSessionCount: 0,
        itemCount: 0,
      },
    };
  }

  const timelineSets = await Promise.all(
    lineagePath.map(async (record) => ({
      record,
      groups: buildPersistedSessionEventGroups(
        await loadPersistedSessionEventsForNode(
          args.projectId,
          getTaskSessionNodeId(args.taskId, record.runtimeSessionId),
        ),
      ),
    })),
  );

  const cachedSessionCount = timelineSets.filter(({ groups }) => groups.length > 0).length;
  const cacheState = deriveCacheState(lineagePath.length, cachedSessionCount);
  const merged = timelineSets.flatMap(({ groups }, index) =>
    buildPersistedSessionTimeline(sliceEventGroupsForLineageBoundary(groups, lineagePath[index + 1])),
  );
  const data = dedupeMergedLineageTimeline(merged);

  return {
    data,
    meta: {
      includeLineage: true,
      cacheState,
      complete: cacheState === "complete",
      lineagePath: lineagePath.map((record) => record.runtimeSessionId),
      cachedSessionCount,
      itemCount: data.length,
    },
  };
}

export const taskRoutes = new Hono<AppEnv>();

taskRoutes.use("*", authMiddleware);
taskRoutes.use("*", requireRole("developer"));

// ── Create Task ────────────────────────────────────────────────────

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  prompt: z.string().min(1).max(50000),
  projectId: z.string().min(1),
  repoId: z.string().min(1).optional(),
  workingBranch: z.string().min(1).max(100).optional(),
  credentialId: z.string().min(1).optional(),
  selectedModel: z.string().max(200).optional(),
  gitAuthorName: z.string().max(200).optional(),
  gitAuthorEmail: z.string().email().max(200).optional(),
  gitCommitterName: z.string().max(200).optional(),
  gitCommitterEmail: z.string().email().max(200).optional(),
  relations: z
    .array(
      z.object({
        sourceTaskId: z.string().min(1).optional(),
        targetTaskId: z.string().min(1).optional(),
        type: z.enum(["depends-on", "blocks", "spawned-from"]),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
  relationContext: z
    .object({
      spawnedFromTaskId: z.string().min(1).optional(),
      dependsOnTaskIds: z.array(z.string().min(1)).optional(),
      blockedByTaskIds: z.array(z.string().min(1)).optional(),
      blocksTaskIds: z.array(z.string().min(1)).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .optional(),
});

type CreateTaskInput = z.infer<typeof createTaskSchema>;

async function validateTaskRepository(projectId: string, repoId?: string) {
  if (!repoId) {
    return null;
  }

  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.projectId, projectId)),
  });

  if (!repo) {
    return { error: "Repository not found in this project" as const };
  }

  if (repo.status !== "active") {
    return { error: "Repository is not active" as const };
  }

  return null;
}

async function validateTaskCredential(projectId: string, credentialId?: string) {
  if (!credentialId) {
    return null;
  }

  const credential = await db.query.repositoryCredentials.findFirst({
    where: and(
      eq(repositoryCredentials.id, credentialId),
      eq(repositoryCredentials.projectId, projectId),
      eq(repositoryCredentials.status, "active"),
    ),
  });

  if (!credential) {
    return { error: "Credential not found or inactive in this project" as const };
  }

  return null;
}

async function validateTaskCreateInput(body: CreateTaskInput) {
  const repoValidation = await validateTaskRepository(body.projectId, body.repoId);
  if (repoValidation) {
    return repoValidation;
  }

  const credentialValidation = await validateTaskCredential(body.projectId, body.credentialId);
  if (credentialValidation) {
    return credentialValidation;
  }

  const linkedTaskIds = collectLinkedTaskIdsFromCreateInput({
    relations: body.relations,
    relationContext: body.relationContext,
  });

  if (linkedTaskIds.length) {
    const linkedTaskMap = await loadTaskTreeRecordMap(linkedTaskIds);

    for (const linkedTaskId of linkedTaskIds) {
      const linkedTask = linkedTaskMap.get(linkedTaskId);
      if (!linkedTask || linkedTask.projectId !== body.projectId) {
        return { error: `Related task ${linkedTaskId} not found in this project` as const };
      }
    }
  }

  return null;
}

async function insertTask(userId: string, body: CreateTaskInput) {
  const taskId = crypto.randomUUID();
  const snapshot = buildTaskTreeSnapshotFromCreateInput(userId, taskId, body);

  await upsertTaskTreeNode(snapshot);

  const normalizedRelations = expandCreateTaskRelations({
    taskId,
    relations: body.relations,
    relationContext: body.relationContext,
  });

  if (normalizedRelations.length > 0) {
    await syncTaskRelationLinks(
      body.projectId,
      normalizedRelations.map((relation) => ({
        sourceTaskId: relation.sourceTaskId,
        targetTaskId: relation.targetTaskId,
        type: toProjectTreeLinkType(relation.type),
        relationSource: "task-create",
        metadata: relation.metadata ?? null,
      })),
    );
  }
  return taskId;
}

async function recordTaskCreatedAudit(userId: string, taskId: string, body: CreateTaskInput) {
  const normalizedRelations = expandCreateTaskRelations({
    taskId,
    relations: body.relations,
    relationContext: body.relationContext,
  });

  await recordAuditEvent({
    userId,
    projectId: body.projectId,
    taskId,
    eventType: "task.created",
    action: "create_task",
    target: body.title,
    detail: {
      prompt: body.prompt.slice(0, 200),
      relationContext: body.relationContext ?? null,
      relations: normalizedRelations,
      relationCount: normalizedRelations.length,
    },
  });
}

taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const validationError = await validateTaskCreateInput(body);
  if (validationError) {
    return c.json(validationError, 400);
  }

  const taskId = await insertTask(user.sub, body);
  await recordTaskCreatedAudit(user.sub, taskId, body);

  return c.json({ id: taskId, nodeId: taskId, status: "pending" }, 201);
});

// ── Update Task Status ─────────────────────────────────────────────

const updateStatusSchema = z.object({
  status: z.enum(["running", "paused", "completed", "failed", "cancelled"]).optional(),
  sessionId: z.string().optional(),
  agentRunId: z.string().optional(),
  result: z.string().optional(),
  selectedModel: z.string().max(200).nullable().optional(),
  category: z.enum(["quick", "deep", "ops", "security", "architecture"]).optional(),
  strategy: z.string().optional(),
  executionMode: z.enum(["single", "parallel", "sequential-chain"]).optional(),
  executionPlan: z.string().optional(),
  autoAdvanceStages: z.boolean().optional(),
  workspaceRoot: z.string().optional(),
  baseRevision: z.string().optional(),
  workingBranch: z.string().optional(),
  // Identity snapshot (frozen at execution start)
  credentialId: z.string().optional(),
  gitAuthorName: z.string().max(200).optional(),
  gitAuthorEmail: z.string().email().max(200).optional(),
  gitCommitterName: z.string().max(200).optional(),
  gitCommitterEmail: z.string().email().max(200).optional(),
  // Post-execution facts
  finalCommitSha: z.string().max(200).optional(),
  finalBranchName: z.string().max(200).optional(),
  changesSummary: z
    .object({
      filesAdded: z.number().int().optional(),
      filesModified: z.number().int().optional(),
      filesDeleted: z.number().int().optional(),
      totalInsertions: z.number().int().optional(),
      totalDeletions: z.number().int().optional(),
    })
    .optional(),
});

type TaskStatusUpdate = z.infer<typeof updateStatusSchema>;

const directTaskUpdateKeys = [
  "sessionId",
  "agentRunId",
  "result",
  "selectedModel",
  "category",
  "strategy",
  "executionMode",
  "executionPlan",
  "autoAdvanceStages",
  "workspaceRoot",
  "baseRevision",
  "workingBranch",
  "credentialId",
  "gitAuthorName",
  "gitAuthorEmail",
  "gitCommitterName",
  "gitCommitterEmail",
  "finalCommitSha",
  "finalBranchName",
  "changesSummary",
] as const;

function shouldSetFinishedAt(status: TaskStatusUpdate["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function buildTaskUpdates(body: TaskStatusUpdate, existing: { startedAt: string | null }) {
  const updates: Record<string, unknown> = {};

  if (body.status !== undefined) {
    updates.status = body.status;
  }

  for (const key of directTaskUpdateKeys) {
    const value = body[key];
    if (value !== undefined) {
      updates[key] = value;
    }
  }

  if (body.status === "running" && !existing.startedAt) {
    updates.startedAt = new Date().toISOString();
  }

  if (shouldSetFinishedAt(body.status)) {
    updates.finishedAt = new Date().toISOString();
  }

  return updates;
}

taskRoutes.patch("/:taskId", zValidator("json", updateStatusSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");

  const existing = await loadTaskTreeBackedRecord(taskId);
  if (!existing) return c.json({ error: "Task not found" }, 404);

  const updates = buildTaskUpdates(body, existing);
  const snapshot = buildTaskTreeSnapshotFromRecord(existing, updates);

  await upsertTaskTreeNode(snapshot);

  return c.json({ id: taskId, ...updates });
});

// ── Agent Runs ─────────────────────────────────────────────────────

taskRoutes.get("/:taskId/runs", async (c) => {
  const taskId = c.req.param("taskId");

  const runs = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.taskId, taskId))
    .orderBy(desc(agentRuns.createdAt));

  return c.json({ data: runs });
});

const createRunSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  agentType: z.string().min(1),
  status: z
    .enum(["pending", "running", "paused", "completed", "failed", "stopped", "terminated"])
    .optional(),
  modelUsed: z.string().optional(),
  tokenUsed: z.number().int().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
  candidateIndex: z.number().int().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});

taskRoutes.post("/:taskId/runs", zValidator("json", createRunSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");

  const task = await loadTaskTreeBackedRecord(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);

  const runId = body.id || crypto.randomUUID();
  const existing = await db.query.agentRuns.findFirst({ where: eq(agentRuns.id, runId) });
  if (existing) {
    return c.json(existing, 200);
  }

  const status = body.status ?? "pending";
  await db.insert(agentRuns).values({
    id: runId,
    taskId,
    sessionId: body.sessionId ?? null,
    agentType: body.agentType,
    status,
    modelUsed: body.modelUsed ?? null,
    tokenUsed: body.tokenUsed ?? 0,
    result: body.result ?? null,
    error: body.error ?? null,
    candidateIndex: body.candidateIndex ?? null,
    startedAt: body.startedAt ?? (status === "running" ? new Date().toISOString() : null),
    finishedAt:
      body.finishedAt ??
      (["completed", "failed", "stopped", "terminated"].includes(status)
        ? new Date().toISOString()
        : null),
  });

  return c.json({ id: runId, status }, 201);
});

const updateRunSchema = z.object({
  status: z.enum(["running", "paused", "completed", "failed", "stopped", "terminated"]),
  modelUsed: z.string().optional(),
  tokenUsed: z.number().int().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});

taskRoutes.patch("/:taskId/runs/:runId", zValidator("json", updateRunSchema), async (c) => {
  const runId = c.req.param("runId");
  const body = c.req.valid("json");

  const existing = await db.query.agentRuns.findFirst({ where: eq(agentRuns.id, runId) });
  if (!existing) return c.json({ error: "Agent run not found" }, 404);

  const updates: Record<string, unknown> = { status: body.status };
  if (body.modelUsed) updates.modelUsed = body.modelUsed;
  if (body.tokenUsed !== undefined) updates.tokenUsed = body.tokenUsed;
  if (body.result) updates.result = body.result;
  if (body.error) updates.error = body.error;
  if (body.startedAt) {
    updates.startedAt = body.startedAt;
  } else if (body.status === "running" && !existing.startedAt) {
    updates.startedAt = new Date().toISOString();
  }
  if (body.finishedAt) {
    updates.finishedAt = body.finishedAt;
  } else if (["completed", "failed", "stopped", "terminated"].includes(body.status)) {
    updates.finishedAt = new Date().toISOString();
  }

  await db.update(agentRuns).set(updates).where(eq(agentRuns.id, runId));

  return c.json({ id: runId, ...updates });
});

// ── Task Sessions (branch lineage) ─────────────────────────────────

// GET /api/tasks/:taskId/branches — List all branch lineage records for a task
taskRoutes.get("/:taskId/branches", async (c) => {
  const taskId = c.req.param("taskId");

  const task = await loadTaskTreeBackedRecord(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);

  const rows = await listTaskSessionTreeRecords(taskId, task.projectId, { includeArchived: true });

  return c.json({ data: rows });
});

// POST /api/tasks/:taskId/branches — Create or update a branch lineage record (root or fork)
const createTaskSessionSchema = z.object({
  runtimeSessionId: z.string().min(1),
  parentRuntimeSessionId: z.string().optional(),
  forkedFromMessageId: z.string().optional(),
  branchName: z.string().max(200).optional(),
  sourceType: z.enum(["root", "fork", "sub_session"]).optional(),
  isActive: z.boolean().optional(),
});

const persistTaskSessionMessageSchema = z.object({
  runtimeSessionId: z.string().min(1),
  message: z.record(z.unknown()),
});

taskRoutes.post(
  "/:taskId/branches",
  zValidator("json", createTaskSessionSchema),
  async (c) => {
    const taskId = c.req.param("taskId");
    const body = c.req.valid("json");

    const task = await loadTaskTreeBackedRecord(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);
    const existingRecord = await resolveTaskSessionRecordByRuntimeSessionId(
      taskId,
      task.projectId,
      body.runtimeSessionId,
    );

    const nodeId = await upsertTaskSessionTreeNode({
      taskId,
      runtimeSessionId: body.runtimeSessionId,
      parentRuntimeSessionId:
        body.parentRuntimeSessionId ?? existingRecord?.parentRuntimeSessionId ?? null,
      forkedFromMessageId: body.forkedFromMessageId ?? existingRecord?.forkedFromMessageId ?? null,
      branchName: body.branchName ?? existingRecord?.branchName ?? null,
      sourceType: body.sourceType ?? existingRecord?.sourceType,
      isActive: body.isActive ?? existingRecord?.isActive ?? false,
      archivedAt: null,
    });

    if (existingRecord) {
      return c.json({
        id: nodeId,
        taskId,
        runtimeSessionId: body.runtimeSessionId,
        updated: true,
      });
    }

    return c.json({ id: nodeId, taskId, runtimeSessionId: body.runtimeSessionId }, 201);
  },
);

taskRoutes.post(
  "/:taskId/branches/messages",
  zValidator("json", persistTaskSessionMessageSchema),
  async (c) => {
    const taskId = c.req.param("taskId");
    const body = c.req.valid("json");

    const task = await loadTaskTreeBackedRecord(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);
    const now = new Date().toISOString();

    const existingRecord = await resolveTaskSessionRecordByRuntimeSessionId(
      taskId,
      task.projectId,
      body.runtimeSessionId,
    );
    const isActive = task.sessionId === body.runtimeSessionId;
    await upsertTaskSessionTreeNode({
      taskId,
      runtimeSessionId: body.runtimeSessionId,
      parentRuntimeSessionId: existingRecord?.parentRuntimeSessionId ?? null,
      forkedFromMessageId: existingRecord?.forkedFromMessageId ?? null,
      branchName: existingRecord?.branchName ?? body.runtimeSessionId,
      sourceType: existingRecord?.sourceType ?? "root",
      isActive,
      archivedAt: null,
    });

    const nodeId = getTaskSessionNodeId(taskId, body.runtimeSessionId);
    const latestEvent = await db.query.projectTreeEvents.findFirst({
      where: and(
        eq(projectTreeEvents.nodeId, nodeId),
        eq(projectTreeEvents.projectId, task.projectId),
      ),
      orderBy: [desc(projectTreeEvents.seq)],
    });

    const messageId = extractPersistedMessageId(body.message) ?? `anonymous-${crypto.randomUUID()}`;
    const existingSessionEvents = await loadPersistedSessionEventsForNode(task.projectId, nodeId);
    const existingMessageEvents = existingSessionEvents.filter(
      (event) => extractPersistedEventMessageId(event) === messageId,
    );
    const existingSnapshots = existingMessageEvents.filter((event) => isSnapshotEventType(event.eventType));
    const completedAt = extractPersistedMessageCompletedAt(body.message);
    const eventSummary = {
      runtimeSessionId: body.runtimeSessionId,
      messageId,
      role: extractPersistedMessageRole(body.message) ?? null,
      text: extractPersistedMessageText(body.message) ?? null,
      partTypes: extractPersistedMessagePartTypes(body.message),
      tokenUsed: extractPersistedMessageTokenUsage(body.message),
      completedAt: completedAt ?? null,
    };

    let nextSeq = (latestEvent?.seq ?? 0) + 1;
    const eventsToInsert: Array<{
      id: string;
      nodeId: string;
      projectId: string;
      eventType: string;
      payload: Record<string, unknown>;
      seq: number;
      createdAt: string;
    }> = [];

    eventsToInsert.push({
      id: crypto.randomUUID(),
      nodeId,
      projectId: task.projectId,
      eventType: existingSnapshots.length === 0 ? "session.message.created" : "session.message.updated",
      payload: eventSummary,
      seq: nextSeq++,
      createdAt: now,
    });

    const messagePreviouslyCompleted = existingMessageEvents.some(
      (event) => event.eventType === "session.message.completed",
    );
    if (completedAt && !messagePreviouslyCompleted) {
      eventsToInsert.push({
        id: crypto.randomUUID(),
        nodeId,
        projectId: task.projectId,
        eventType: "session.message.completed",
        payload: eventSummary,
        seq: nextSeq++,
        createdAt: now,
      });
    }

    eventsToInsert.push({
      id: crypto.randomUUID(),
      nodeId,
      projectId: task.projectId,
      eventType: "session.message.snapshot",
      payload: {
        ...eventSummary,
        message: body.message,
      },
      seq: nextSeq++,
      createdAt: now,
    });

    await db.insert(projectTreeEvents).values(eventsToInsert);

    return c.json(
      { ok: true, seq: eventsToInsert[eventsToInsert.length - 1]?.seq ?? nextSeq - 1 },
      201,
    );
  },
);

taskRoutes.get("/:taskId/branches/:runtimeSessionId/messages", async (c) => {
  const taskId = c.req.param("taskId");
  const runtimeSessionId = c.req.param("runtimeSessionId");
  const includeLineage = c.req.query("includeLineage") === "true";

  const task = await loadTaskTreeBackedRecord(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);

  const response = await buildTaskSessionMessagesResponse({
    taskId,
    projectId: task.projectId,
    runtimeSessionId,
    includeLineage,
  });

  return c.json(response);
});

taskRoutes.get("/:taskId/branches/:runtimeSessionId/events", async (c) => {
  const taskId = c.req.param("taskId");
  const runtimeSessionId = c.req.param("runtimeSessionId");
  const includeLineage = c.req.query("includeLineage") === "true";

  const task = await loadTaskTreeBackedRecord(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);

  const response = await buildTaskSessionEventsResponse({
    taskId,
    projectId: task.projectId,
    runtimeSessionId,
    includeLineage,
  });

  return c.json(response);
});

taskRoutes.get("/:taskId/branches/:runtimeSessionId/timeline", async (c) => {
  const taskId = c.req.param("taskId");
  const runtimeSessionId = c.req.param("runtimeSessionId");
  const includeLineage = c.req.query("includeLineage") === "true";

  const task = await loadTaskTreeBackedRecord(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);

  const response = await buildTaskSessionTimelineResponse({
    taskId,
    projectId: task.projectId,
    runtimeSessionId,
    includeLineage,
  });

  return c.json(response);
});

// POST /api/tasks/:taskId/branches/:sessionId/activate — Set a branch as active
taskRoutes.post("/:taskId/branches/:tsId/activate", async (c) => {
  const taskId = c.req.param("taskId");
  const tsId = c.req.param("tsId");

  const task = await loadTaskTreeBackedRecord(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);

  const record = await resolveTaskSessionRecord(taskId, task.projectId, tsId);
  if (!record) return c.json({ error: "Task session not found" }, 404);

  await upsertTaskSessionTreeNode({
    taskId,
    runtimeSessionId: record.runtimeSessionId,
    parentRuntimeSessionId: record.parentRuntimeSessionId ?? null,
    forkedFromMessageId: record.forkedFromMessageId ?? null,
    branchName: record.branchName ?? null,
    sourceType: record.sourceType,
    isActive: true,
    archivedAt: null,
  });

  const taskSnapshot = buildTaskTreeSnapshotFromRecord(task, { sessionId: record.runtimeSessionId });
  await upsertTaskTreeNode(taskSnapshot);

  return c.json({ ok: true, activatedSessionId: record.runtimeSessionId });
});

// POST /api/tasks/:taskId/branches/:sessionId/archive — Archive a branch
taskRoutes.post("/:taskId/branches/:tsId/archive", async (c) => {
  const taskId = c.req.param("taskId");
  const tsId = c.req.param("tsId");

  const task = await loadTaskTreeBackedRecord(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);

  const record = await resolveTaskSessionRecord(taskId, task.projectId, tsId);
  if (!record) return c.json({ error: "Task session not found" }, 404);

  await archiveTaskSessionTreeNode(taskId, record.runtimeSessionId);

  return c.json({ ok: true });
});
