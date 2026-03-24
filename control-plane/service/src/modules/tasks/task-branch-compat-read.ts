import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  conversationMessages,
  conversationSessions,
  projectTreeNodes,
  taskDomainEvents,
} from "../../db/schema";
import { getTaskBranchCompatNodeId } from "../project-tree/storage";

export function extractPersistedMessageId(message: unknown) {
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

function synthesizePersistedMessageFromEventPayload(
  payload: Record<string, unknown>,
  fallbackId: string,
) {
  const messageId =
    typeof payload.messageId === "string" && payload.messageId.trim()
      ? payload.messageId
      : fallbackId;
  const role = typeof payload.role === "string" && payload.role.trim() ? payload.role : undefined;
  const text = [payload.searchText, payload.resultText, payload.text].find(
    (value) => typeof value === "string" && value.trim(),
  ) as string | undefined;
  const createdAt = normalizePersistedTimestamp(payload.createdAt);
  const completedAt = normalizePersistedTimestamp(payload.completedAt);

  if (!role && !text && !createdAt && !completedAt) {
    return undefined;
  }

  const info: Record<string, unknown> = { id: messageId };
  if (role) {
    info.role = role;
  }
  if (createdAt || completedAt) {
    info.time = {
      ...(createdAt ? { created: createdAt } : {}),
      ...(completedAt ? { completed: completedAt } : {}),
    };
  }

  return {
    info,
    ...(text ? { parts: [{ type: "text", text }] } : {}),
  } satisfies Record<string, unknown>;
}

function asOptionalRecord(value: unknown) {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : undefined;
}

function extractPersistedMessageInfoRecord(message: Record<string, unknown>) {
  return asOptionalRecord(message.info);
}

function extractPersistedMessageTimeRecord(info: Record<string, unknown> | undefined) {
  return asOptionalRecord(info?.time);
}

function mergePersistedMessageInfo(
  previousInfo: Record<string, unknown> | undefined,
  nextInfo: Record<string, unknown> | undefined,
) {
  const previousTime = extractPersistedMessageTimeRecord(previousInfo);
  const nextTime = extractPersistedMessageTimeRecord(nextInfo);

  return {
    ...(previousInfo ?? {}),
    ...(nextInfo ?? {}),
    ...(previousTime || nextTime
      ? {
          time: {
            ...(previousTime ?? {}),
            ...(nextTime ?? {}),
          },
        }
      : {}),
  };
}

function resolvePersistedMessageParts(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  const nextParts = Array.isArray(next.parts) ? next.parts : undefined;
  if (nextParts && nextParts.length > 0) {
    return { parts: nextParts };
  }

  return Array.isArray(previous.parts) ? { parts: previous.parts } : {};
}

function resolvePersistedStandalonePart(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  if (next.part !== undefined) {
    return { part: next.part };
  }

  return previous.part !== undefined ? { part: previous.part } : {};
}

function mergePersistedMessageState(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
) {
  if (!previous) {
    return next;
  }

  const previousInfo = extractPersistedMessageInfoRecord(previous);
  const nextInfo = extractPersistedMessageInfoRecord(next);

  return {
    ...previous,
    ...next,
    info: mergePersistedMessageInfo(previousInfo, nextInfo),
    ...resolvePersistedMessageParts(previous, next),
    ...resolvePersistedStandalonePart(previous, next),
  } satisfies Record<string, unknown>;
}

function buildPersistedSessionMessages(
  events: Array<{ seq: number; payload: Record<string, unknown> }>,
) {
  const order: string[] = [];
  const latestById = new Map<string, Record<string, unknown>>();

  for (const event of events) {
    const message =
      (event.payload.message && typeof event.payload.message === "object"
        ? (event.payload.message as Record<string, unknown>)
        : synthesizePersistedMessageFromEventPayload(event.payload, `anonymous-${event.seq}`)) ??
      null;
    const messageId = extractPersistedMessageId(message) || `anonymous-${event.seq}`;
    if (!message) {
      continue;
    }
    if (!latestById.has(messageId)) {
      order.push(messageId);
    }
    latestById.set(messageId, mergePersistedMessageState(latestById.get(messageId), message));
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

export function extractPersistedMessageRole(message: unknown) {
  const info = extractPersistedMessageInfo(message);
  return typeof info?.role === "string" ? info.role : undefined;
}

export function extractPersistedMessageCompletedAt(message: unknown) {
  const info = extractPersistedMessageInfo(message);
  const time =
    typeof info?.time === "object" && info.time
      ? (info.time as Record<string, unknown>)
      : undefined;
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

export function normalizePersistedTimestamp(value: unknown) {
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

export function extractPersistedMessageCreatedAt(message: unknown) {
  const info = extractPersistedMessageInfo(message);
  const time =
    typeof info?.time === "object" && info.time
      ? (info.time as Record<string, unknown>)
      : undefined;
  return normalizePersistedTimestamp(time?.created);
}

export function extractPersistedMessageText(message: unknown) {
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

export function extractPersistedStandalonePart(message: unknown) {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const part = (message as { part?: unknown }).part;
  return part && typeof part === "object" ? (part as Record<string, unknown>) : undefined;
}

function extractPersistedStandalonePartType(message: unknown) {
  const part = extractPersistedStandalonePart(message);
  return typeof part?.type === "string" ? part.type : undefined;
}

function extractPersistedStandalonePartStatus(message: unknown) {
  const part = extractPersistedStandalonePart(message);
  const state = part?.state;
  if (!state || typeof state !== "object") {
    return undefined;
  }

  return typeof (state as Record<string, unknown>).status === "string"
    ? ((state as Record<string, unknown>).status as string)
    : undefined;
}

export function shouldPersistStandalonePartEvent(message: unknown) {
  const partType = extractPersistedStandalonePartType(message);
  if (partType === "step-start") {
    return false;
  }

  if (partType === "tool" || partType === "tool-result") {
    return true;
  }

  if (partType === "source") {
    const status = extractPersistedStandalonePartStatus(message);
    return status === "completed" || status === "error";
  }

  return false;
}

export function extractPersistedEventRole(message: unknown) {
  const role = extractPersistedMessageRole(message);
  if (role) {
    return role;
  }

  const partType = extractPersistedStandalonePartType(message);
  if (partType === "tool" || partType === "tool-result") {
    return "tool";
  }

  return undefined;
}

export function extractPersistedToolResultText(message: unknown) {
  const part = extractPersistedStandalonePart(message);
  if (!part) {
    return undefined;
  }

  const state = part.state;
  if (!state || typeof state !== "object") {
    return undefined;
  }

  const value = (state as Record<string, unknown>).output;
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (value && typeof value === "object") {
    const output = value as Record<string, unknown>;
    if (typeof output.text === "string" && output.text.trim()) {
      return output.text;
    }

    if (typeof output.summary === "string" && output.summary.trim()) {
      return output.summary;
    }
  }

  return undefined;
}

export function extractPersistedSearchText(
  message: unknown,
  options?: { userPromptFallback?: string },
) {
  const explicitText = extractPersistedMessageText(message)?.trim();
  if (explicitText) {
    return explicitText;
  }

  const toolResultText = extractPersistedToolResultText(message)?.trim();
  if (toolResultText) {
    return toolResultText;
  }

  return options?.userPromptFallback?.trim() || undefined;
}

export function extractPersistedMessageTokenUsage(message: unknown) {
  const info = extractPersistedMessageInfo(message);
  const tokenUsage = info?.tokens;
  if (typeof tokenUsage === "number" && Number.isFinite(tokenUsage)) {
    return tokenUsage;
  }

  if (tokenUsage && typeof tokenUsage === "object") {
    const record = tokenUsage as Record<string, unknown>;
    const total = record.total;
    if (typeof total === "number" && Number.isFinite(total)) {
      return total;
    }
  }

  return 0;
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
  childRecord?: TaskBranchLineageRecord,
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

type PersistedLineageTimelineItem = {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  completedAt: string | null;
  raw: Record<string, unknown> | null;
  sourceEventTypes: string[];
};

function dedupeMergedLineageTimeline(items: PersistedLineageTimelineItem[]) {
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

type ConversationDomainMessageEvent = {
  seq: number;
  payload: Record<string, unknown>;
  createdAt: string;
};

function extractConversationDomainRuntimeMessageId(
  payload: Record<string, unknown>,
  fallbackSeq: number,
) {
  const runtimeMessageId = payload.runtimeMessageId;
  if (typeof runtimeMessageId === "string" && runtimeMessageId.trim()) {
    return runtimeMessageId;
  }

  const payloadMessageId = payload.messageId;
  if (typeof payloadMessageId === "string" && payloadMessageId.trim()) {
    const parts = payloadMessageId.split(":");
    return parts[parts.length - 1] || `anonymous-${fallbackSeq}`;
  }

  return `anonymous-${fallbackSeq}`;
}

function toSessionMessageCompletedTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function buildSyntheticSessionMessagePayload(
  event: ConversationDomainMessageEvent,
  messageId: string,
): Record<string, unknown> {
  return {
    runtimeSessionId:
      typeof event.payload.runtimeSessionId === "string" ? event.payload.runtimeSessionId : null,
    messageId,
    role: typeof event.payload.role === "string" ? event.payload.role : null,
    text: typeof event.payload.textContent === "string" ? event.payload.textContent : null,
    searchText: typeof event.payload.textContent === "string" ? event.payload.textContent : null,
    resultText: typeof event.payload.textContent === "string" ? event.payload.textContent : null,
    partTypes: Array.isArray(event.payload.partTypes) ? event.payload.partTypes : [],
    tokenUsed:
      typeof event.payload.tokenUsed === "number" && Number.isFinite(event.payload.tokenUsed)
        ? event.payload.tokenUsed
        : 0,
    createdAt: event.createdAt,
    completedAt: toSessionMessageCompletedTimestamp(event.payload.completedAt),
  } satisfies Record<string, unknown>;
}

function groupConversationDomainEventsByMessageId(events: ConversationDomainMessageEvent[]) {
  const grouped = new Map<string, ConversationDomainMessageEvent[]>();

  for (const event of events) {
    const messageId = extractConversationDomainRuntimeMessageId(event.payload, event.seq);
    const bucket = grouped.get(messageId);
    if (bucket) {
      bucket.push(event);
      continue;
    }

    grouped.set(messageId, [event]);
  }

  return grouped;
}

function buildSyntheticCreatedEvents(args: {
  event: ConversationDomainMessageEvent;
  payload: Record<string, unknown>;
  baseSeq: number;
  completedAt: unknown;
}) {
  const events: PersistedSessionEvent[] = [
    {
      seq: args.baseSeq,
      eventType: "session.message.created",
      payload: args.payload,
      createdAt: args.event.createdAt,
    },
  ];

  if (args.completedAt !== null) {
    events.push({
      seq: args.baseSeq + 1,
      eventType: "session.message.completed",
      payload: args.payload,
      createdAt: args.event.createdAt,
    });
  }

  events.push({
    seq: args.baseSeq + 2,
    eventType: "session.message.snapshot",
    payload: args.payload,
    createdAt: args.event.createdAt,
  });

  return events;
}

function buildSyntheticUpdatedEvents(args: {
  event: ConversationDomainMessageEvent;
  payload: Record<string, unknown>;
  baseSeq: number;
  completedAt: unknown;
  completedSeen: boolean;
}) {
  const events: PersistedSessionEvent[] = [
    {
      seq: args.baseSeq,
      eventType: "session.message.updated",
      payload: args.payload,
      createdAt: args.event.createdAt,
    },
  ];

  if (args.completedAt !== null && !args.completedSeen) {
    events.push({
      seq: args.baseSeq + 1,
      eventType: "session.message.completed",
      payload: args.payload,
      createdAt: args.event.createdAt,
    });
  }

  return events;
}

function buildSyntheticSessionEventsForMessage(
  messageId: string,
  messageEvents: ConversationDomainMessageEvent[],
) {
  const output: PersistedSessionEvent[] = [];
  let completedSeen = false;

  for (const [index, event] of messageEvents.entries()) {
    const payload = buildSyntheticSessionMessagePayload(event, messageId);
    const completedAt = payload.completedAt;
    const baseSeq = event.seq * 10;
    const syntheticEvents =
      index === 0
        ? buildSyntheticCreatedEvents({ event, payload, baseSeq, completedAt })
        : buildSyntheticUpdatedEvents({
            event,
            payload,
            baseSeq,
            completedAt,
            completedSeen,
          });

    output.push(...syntheticEvents);
    if (completedAt !== null) {
      completedSeen = true;
    }
  }

  return output;
}

function buildSyntheticSessionEventsFromConversationDomainEvents(
  events: ConversationDomainMessageEvent[],
) {
  const grouped = groupConversationDomainEventsByMessageId(events);
  const output = [...grouped.entries()].flatMap(([messageId, messageEvents]) =>
    buildSyntheticSessionEventsForMessage(messageId, messageEvents),
  );

  return output.sort((left, right) => {
    if (left.seq !== right.seq) {
      return left.seq - right.seq;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function buildFallbackSourceEventTypesFromMessage(message: Record<string, unknown>) {
  const eventTypes = ["session.message.created"];
  if (extractPersistedMessageCompletedAt(message) !== undefined) {
    eventTypes.push("session.message.completed");
  }
  eventTypes.push("session.message.snapshot");
  return eventTypes;
}

async function loadConversationMessageDomainEventsForSessionId(sessionId: string) {
  const rows = await db
    .select({
      seq: taskDomainEvents.seq,
      payload: taskDomainEvents.payload,
      createdAt: taskDomainEvents.createdAt,
    })
    .from(taskDomainEvents)
    .where(
      and(
        eq(taskDomainEvents.sessionId, sessionId),
        eq(taskDomainEvents.eventType, "conversation.message.upserted"),
      ),
    )
    .orderBy(asc(taskDomainEvents.seq), asc(taskDomainEvents.createdAt));

  return rows.filter((row): row is ConversationDomainMessageEvent =>
    Boolean(row.payload && typeof row.payload === "object"),
  );
}

export type TaskBranchLineageRecord = {
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

function sliceItemsForLineageBoundary<T>(
  items: T[],
  childRecord: TaskBranchLineageRecord | undefined,
  getItemId: (item: T) => string | null | undefined,
) {
  if (!childRecord?.forkedFromMessageId) {
    return items;
  }

  const boundaryIndex = items.findIndex(
    (item) => getItemId(item) === childRecord.forkedFromMessageId,
  );
  if (boundaryIndex < 0) {
    return items;
  }

  return items.slice(0, boundaryIndex + 1);
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

function compareTaskBranchLineageTime(left?: string | null, right?: string | null) {
  const leftTime = left ? Date.parse(left) : Number.POSITIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}

function dedupeTaskBranchLineageRecords(records: TaskBranchLineageRecord[]) {
  const byRuntimeSessionId = new Map<string, TaskBranchLineageRecord>();

  for (const record of records) {
    const existing = byRuntimeSessionId.get(record.runtimeSessionId);
    if (!existing) {
      byRuntimeSessionId.set(record.runtimeSessionId, record);
      continue;
    }

    const existingScore =
      Number(Boolean(existing.parentRuntimeSessionId)) +
      Number(Boolean(existing.forkedFromMessageId));
    const nextScore =
      Number(Boolean(record.parentRuntimeSessionId)) + Number(Boolean(record.forkedFromMessageId));
    const existingUpdated = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    const nextUpdated = record.updatedAt ? Date.parse(record.updatedAt) : 0;

    if (nextScore > existingScore || nextUpdated > existingUpdated) {
      byRuntimeSessionId.set(record.runtimeSessionId, record);
    }
  }

  return Array.from(byRuntimeSessionId.values()).sort((left, right) =>
    compareTaskBranchLineageTime(left.createdAt, right.createdAt),
  );
}

function findTaskBranchLineageRoot(records: TaskBranchLineageRecord[]) {
  return (
    records.find((record) => record.sourceType === "root") ??
    records
      .slice()
      .sort((left, right) => compareTaskBranchLineageTime(left.createdAt, right.createdAt))[0]
  );
}

function repairTaskBranchLineageRecord(
  record: TaskBranchLineageRecord,
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

export function normalizeTaskBranchLineageRecords(records: TaskBranchLineageRecord[]) {
  const normalized = dedupeTaskBranchLineageRecords(records).map((record) => ({ ...record }));
  if (normalized.length <= 1) {
    return normalized;
  }

  const rootRecord = findTaskBranchLineageRoot(normalized);
  if (!rootRecord) {
    return normalized;
  }

  for (const record of normalized) {
    repairTaskBranchLineageRecord(record, rootRecord.runtimeSessionId);
  }

  return normalized;
}

export function buildTaskBranchLineagePath(
  records: TaskBranchLineageRecord[],
  runtimeSessionId: string,
) {
  const recordMap = new Map(records.map((record) => [record.runtimeSessionId, record] as const));
  const path: TaskBranchLineageRecord[] = [];
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

function parseTaskBranchCompatTreeContent(content: unknown): {
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
    record.sourceType === "root" ||
    record.sourceType === "fork" ||
    record.sourceType === "sub_session"
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

function mapTreeNodeToTaskBranchCompatRecord(
  taskId: string,
  node: typeof projectTreeNodes.$inferSelect,
): TaskBranchLineageRecord {
  const content = parseTaskBranchCompatTreeContent(node.contentJson);

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

export async function listTaskBranchCompatTreeRecords(
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

  return treeRows.map((node) => mapTreeNodeToTaskBranchCompatRecord(taskId, node));
}

// Conversation persistence remains a shared source of truth for branch compat
// reads and write-side sync helpers.
async function listConversationSessionRecords(
  taskId: string,
  options?: { includeArchived?: boolean },
) {
  const conditions = [eq(conversationSessions.taskId, taskId)];
  if (!options?.includeArchived) {
    conditions.push(isNull(conversationSessions.archivedAt));
  }

  const rows = await db
    .select({
      id: conversationSessions.id,
      taskId: conversationSessions.taskId,
      runtimeSessionId: conversationSessions.runtimeSessionId,
      parentSessionId: conversationSessions.parentSessionId,
      forkedFromMessageId: conversationSessions.forkedFromMessageId,
      branchName: conversationSessions.branchName,
      sourceType: conversationSessions.sourceType,
      isActive: conversationSessions.isActive,
      createdAt: conversationSessions.createdAt,
      updatedAt: conversationSessions.updatedAt,
      archivedAt: conversationSessions.archivedAt,
    })
    .from(conversationSessions)
    .where(and(...conditions))
    .orderBy(asc(conversationSessions.createdAt));

  const runtimeSessionIdBySessionId = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.runtimeSessionId === "string" && row.runtimeSessionId.length > 0) {
      runtimeSessionIdBySessionId.set(row.id, row.runtimeSessionId);
    }
  }

  return rows
    .filter(
      (row): row is typeof row & { runtimeSessionId: string } =>
        typeof row.runtimeSessionId === "string" && row.runtimeSessionId.length > 0,
    )
    .map((row) => ({
      id: row.id,
      taskId: row.taskId ?? taskId,
      runtimeSessionId: row.runtimeSessionId,
      parentRuntimeSessionId: row.parentSessionId
        ? (runtimeSessionIdBySessionId.get(row.parentSessionId) ?? null)
        : null,
      forkedFromMessageId: row.forkedFromMessageId ?? null,
      branchName: row.branchName ?? null,
      sourceType:
        row.sourceType === "fork" || row.sourceType === "sub_session" ? row.sourceType : "root",
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    })) satisfies TaskBranchLineageRecord[];
}

export async function resolveTaskBranchCompatRecord(
  taskId: string,
  projectId: string,
  sessionId: string,
) {
  const treeRecord = await db.query.projectTreeNodes.findFirst({
    where: and(
      eq(projectTreeNodes.projectId, projectId),
      eq(projectTreeNodes.id, sessionId),
      eq(projectTreeNodes.nodeType, "session"),
    ),
  });
  if (treeRecord) {
    return mapTreeNodeToTaskBranchCompatRecord(taskId, treeRecord);
  }

  return null;
}

export async function resolveTaskBranchCompatRecordByRuntimeSessionId(
  taskId: string,
  projectId: string,
  runtimeSessionId: string,
) {
  const nodeId = getTaskBranchCompatNodeId(taskId, runtimeSessionId);
  const treeRecord = await db.query.projectTreeNodes.findFirst({
    where: and(
      eq(projectTreeNodes.projectId, projectId),
      eq(projectTreeNodes.id, nodeId),
      eq(projectTreeNodes.nodeType, "session"),
    ),
  });
  if (treeRecord) {
    return mapTreeNodeToTaskBranchCompatRecord(taskId, treeRecord);
  }

  return null;
}

// These exports are generic conversation persistence helpers, even though this
// file also hosts the branch compat readers built on top of them.
export function buildConversationSessionId(taskId: string, runtimeSessionId: string) {
  return getTaskBranchCompatNodeId(taskId, runtimeSessionId);
}

export function mapSourceTypeToConversationSessionKind(
  sourceType: "root" | "fork" | "sub_session" | null | undefined,
) {
  if (sourceType === "root") {
    return "task-root" as const;
  }
  if (sourceType === "sub_session") {
    return "resume" as const;
  }
  return "manual-branch" as const;
}

export function buildConversationMessageId(sessionId: string, messageId: string) {
  return `${sessionId}:${messageId}`;
}

async function loadConversationMessagesForSessionId(sessionId: string) {
  const rows = await db
    .select({
      rawPayload: conversationMessages.rawPayload,
      messageIndex: conversationMessages.messageIndex,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.sessionId, sessionId))
    .orderBy(asc(conversationMessages.messageIndex), asc(conversationMessages.createdAt));

  return rows
    .map((row) => row.rawPayload)
    .filter((payload): payload is Record<string, unknown> =>
      Boolean(payload && typeof payload === "object"),
    );
}

async function loadConversationSessionSyntheticEvents(args: {
  taskId: string;
  runtimeSessionId: string;
}) {
  const sessionId = buildConversationSessionId(args.taskId, args.runtimeSessionId);
  const domainEvents = await loadConversationMessageDomainEventsForSessionId(sessionId);
  return buildSyntheticSessionEventsFromConversationDomainEvents(domainEvents);
}

async function loadConversationMessagesFromDomainEvents(args: {
  taskId: string;
  runtimeSessionId: string;
}) {
  return buildPersistedSessionMessages(await loadConversationSessionSyntheticEvents(args));
}

type TaskBranchCompatMessagesReadSource =
  | "conversation-table"
  | "task-domain-events"
  | "conversation-table+task-domain-events";

async function loadTaskBranchCompatMessagesPreferConversation(args: {
  taskId: string;
  runtimeSessionId: string;
}) {
  const sessionId = buildConversationSessionId(args.taskId, args.runtimeSessionId);
  const conversationData = await loadConversationMessagesForSessionId(sessionId);
  if (conversationData.length > 0) {
    return {
      data: conversationData,
      readSource: "conversation-table" as const,
    };
  }

  const domainEventData = await loadConversationMessagesFromDomainEvents({
    taskId: args.taskId,
    runtimeSessionId: args.runtimeSessionId,
  });

  return {
    data: domainEventData,
    readSource: "task-domain-events" as const,
  };
}

function resolveTaskBranchCompatLineagePath(
  preferredRecords: TaskBranchLineageRecord[],
  legacyRecords: TaskBranchLineageRecord[],
  runtimeSessionId: string,
) {
  const preferredPath = buildTaskBranchLineagePath(
    normalizeTaskBranchLineageRecords(preferredRecords),
    runtimeSessionId,
  );
  if (preferredPath.length > 0) {
    return preferredPath;
  }

  return buildTaskBranchLineagePath(
    normalizeTaskBranchLineageRecords(legacyRecords),
    runtimeSessionId,
  );
}

function mergeTaskBranchCompatMessageReadSource(
  sources: TaskBranchCompatMessagesReadSource[],
): TaskBranchCompatMessagesReadSource {
  const uniqueSources = Array.from(new Set(sources));
  if (uniqueSources.every((source) => source === "conversation-table")) {
    return "conversation-table";
  }
  if (uniqueSources.every((source) => source === "task-domain-events")) {
    return "task-domain-events";
  }
  return "conversation-table+task-domain-events";
}

// Branch compat builders back the lineage/history compatibility routes. Public trace
// contract stays projection-first and only reaches this file via controlled
// secondary-source reads.
async function buildTaskBranchCompatMessagesResponseInternal(args: {
  taskId: string;
  projectId: string;
  runtimeSessionId: string;
  includeLineage: boolean;
}) {
  if (!args.includeLineage) {
    const singleBranchCompatResult = await loadTaskBranchCompatMessagesPreferConversation(args);
    if (singleBranchCompatResult.data.length > 0) {
      return {
        data: singleBranchCompatResult.data,
        meta: {
          includeLineage: false,
          cacheState: "complete" as const,
          complete: true,
          lineagePath: [args.runtimeSessionId],
          cachedSessionCount: 1,
          readSource: singleBranchCompatResult.readSource,
        },
      };
    }

    const cacheState = deriveCacheState(1, 0);
    return {
      data: [],
      meta: {
        includeLineage: false,
        cacheState,
        complete: cacheState === "complete",
        lineagePath: [args.runtimeSessionId],
        cachedSessionCount: 0,
        readSource: singleBranchCompatResult.readSource,
      },
    };
  }

  const conversationRows = await listConversationSessionRecords(args.taskId);
  const treeRows = await listTaskBranchCompatTreeRecords(args.taskId, args.projectId);

  const lineagePath = resolveTaskBranchCompatLineagePath(
    conversationRows,
    treeRows,
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
      ...(await loadTaskBranchCompatMessagesPreferConversation({
        taskId: args.taskId,
        runtimeSessionId: record.runtimeSessionId,
      })),
    })),
  );

  const cachedSessionCount = messageSets.filter(({ data }) => data.length > 0).length;
  const cacheState = deriveCacheState(lineagePath.length, cachedSessionCount);
  const merged = messageSets.flatMap(({ data }, index) =>
    sliceItemsForLineageBoundary(data, lineagePath[index + 1], (message) =>
      extractPersistedMessageId(message),
    ),
  );
  const readSource = mergeTaskBranchCompatMessageReadSource(
    messageSets.filter(({ data }) => data.length > 0).map(({ readSource: source }) => source),
  );

  return {
    data: dedupeMergedLineageMessages(merged),
    meta: {
      includeLineage: true,
      cacheState,
      complete: cacheState === "complete",
      lineagePath: lineagePath.map((record) => record.runtimeSessionId),
      cachedSessionCount,
      readSource,
    },
  };
}

async function buildTaskBranchCompatEventsResponseInternal(args: {
  taskId: string;
  projectId: string;
  runtimeSessionId: string;
  includeLineage: boolean;
}) {
  if (!args.includeLineage) {
    const events = await loadConversationSessionSyntheticEvents({
      taskId: args.taskId,
      runtimeSessionId: args.runtimeSessionId,
    });
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

  const conversationRows = await listConversationSessionRecords(args.taskId);
  const treeRows = await listTaskBranchCompatTreeRecords(args.taskId, args.projectId);

  const lineagePath = resolveTaskBranchCompatLineagePath(
    conversationRows,
    treeRows,
    args.runtimeSessionId,
  );

  if (lineagePath.length === 0) {
    return {
      data: [] as Array<{
        seq: number;
        eventType: string;
        payload: Record<string, unknown>;
        createdAt: string;
      }>,
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
        await loadConversationSessionSyntheticEvents({
          taskId: args.taskId,
          runtimeSessionId: record.runtimeSessionId,
        }),
      ),
    })),
  );

  const cachedSessionCount = eventSets.filter(({ groups }) => groups.length > 0).length;
  const cacheState = deriveCacheState(lineagePath.length, cachedSessionCount);
  const flattened = eventSets.flatMap(({ groups }, index) =>
    flattenPersistedSessionEventGroups(
      sliceEventGroupsForLineageBoundary(groups, lineagePath[index + 1]),
    ),
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

async function buildTaskBranchCompatTimelineResponseInternal(args: {
  taskId: string;
  projectId: string;
  runtimeSessionId: string;
  includeLineage: boolean;
}) {
  if (!args.includeLineage) {
    const messages = await loadConversationMessagesForSessionId(
      buildConversationSessionId(args.taskId, args.runtimeSessionId),
    );
    const sourceEvents = buildPersistedSessionEventGroups(
      await loadConversationSessionSyntheticEvents({
        taskId: args.taskId,
        runtimeSessionId: args.runtimeSessionId,
      }),
    );
    const sourceTypesByMessageId = new Map(
      sourceEvents.map(
        (group) =>
          [group.id, Array.from(new Set(group.events.map((event) => event.eventType)))] as const,
      ),
    );
    const data = messages.map((message) => {
      const id = extractPersistedMessageId(message) || crypto.randomUUID();
      const completedAt = extractPersistedMessageCompletedAt(message);
      const createdAt = extractPersistedMessageCreatedAt(message);
      return {
        id,
        role: extractPersistedMessageRole(message) ?? "unknown",
        text: extractPersistedMessageText(message) ?? "",
        createdAt,
        completedAt: normalizePersistedTimestamp(completedAt) ?? null,
        raw: message,
        sourceEventTypes:
          sourceTypesByMessageId.get(id) ?? buildFallbackSourceEventTypesFromMessage(message),
      };
    });
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

  const conversationRows = await listConversationSessionRecords(args.taskId);
  const treeRows = await listTaskBranchCompatTreeRecords(args.taskId, args.projectId);

  const lineagePath = resolveTaskBranchCompatLineagePath(
    conversationRows,
    treeRows,
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
    lineagePath.map(async (record) => {
      const sessionId = buildConversationSessionId(args.taskId, record.runtimeSessionId);
      const [messages, syntheticEvents] = await Promise.all([
        loadConversationMessagesForSessionId(sessionId),
        loadConversationSessionSyntheticEvents({
          taskId: args.taskId,
          runtimeSessionId: record.runtimeSessionId,
        }),
      ]);
      const groups = buildPersistedSessionEventGroups(syntheticEvents);
      const sourceTypesByMessageId = new Map(
        groups.map(
          (group) =>
            [group.id, Array.from(new Set(group.events.map((event) => event.eventType)))] as const,
        ),
      );

      const items: PersistedLineageTimelineItem[] = messages.map((message) => {
        const id = extractPersistedMessageId(message) || crypto.randomUUID();
        const completedAt = extractPersistedMessageCompletedAt(message);
        const createdAt = extractPersistedMessageCreatedAt(message);
        return {
          id,
          role: extractPersistedMessageRole(message) ?? "unknown",
          text: extractPersistedMessageText(message) ?? "",
          createdAt,
          completedAt: normalizePersistedTimestamp(completedAt) ?? null,
          raw: message,
          sourceEventTypes:
            sourceTypesByMessageId.get(id) ?? buildFallbackSourceEventTypesFromMessage(message),
        };
      });

      return {
        record,
        items,
      };
    }),
  );

  const cachedSessionCount = timelineSets.filter(({ items }) => items.length > 0).length;
  const cacheState = deriveCacheState(lineagePath.length, cachedSessionCount);
  const merged = timelineSets.flatMap(({ items }, index) =>
    sliceItemsForLineageBoundary(items, lineagePath[index + 1], (item) => item.id),
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

// These builders serve branch lineage/history compatibility routes only.
export const buildTaskBranchCompatMessagesResponse =
  buildTaskBranchCompatMessagesResponseInternal;
export const buildTaskBranchCompatEventsResponse =
  buildTaskBranchCompatEventsResponseInternal;
export const buildTaskBranchCompatTimelineResponse =
  buildTaskBranchCompatTimelineResponseInternal;
