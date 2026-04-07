import { cpFetch } from "../../lib/control-plane-client";
import {
  filterPendingParallelTaskConversationCompatMessages,
} from "./task-session-parallel-compat";
import {
  type TaskSessionLineageRecord,
  type TaskSessionTimelineMeta,
  fetchTaskSessionLineageRecords,
  normalizeTaskSessionTimelineMeta,
  toCanonicalTaskSessionId,
} from "./task-session-store";
import {
  buildTaskSessionLineageCompatRecordLookup,
  shouldPreserveWorkflowExecutionContextCompatMessage,
  synthesizeWorkflowGroupCompatMessages,
} from "./task-session-workflow-group-compat";

export { resolvePendingParallelCompatSuppressedSessionIds } from "./task-session-parallel-compat";

// Compatibility-only session-read helpers for cached messages, workflow-context
// shaping, and lineage fan-in over legacy/session-first read semantics.

interface ServiceTaskSessionMessagePart {
  id: string;
  partType?: string | null;
  textContent?: string | null;
  jsonPayload?: Record<string, unknown> | null;
  createdAt?: string;
}

interface ServiceTaskSessionMessageRecord {
  id: string;
  sessionId?: string | null;
  runtimeMessageId?: string | null;
  role?: string | null;
  status?: string | null;
  clientMessageId?: string | null;
  providerMessageId?: string | null;
  textContent?: string | null;
  rawPayload?: Record<string, unknown> | null;
  tokenUsed?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorText?: string | null;
  createdAt?: string;
  parts?: ServiceTaskSessionMessagePart[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function mapServiceMessagePart(part: ServiceTaskSessionMessagePart, index: number) {
  const payload = asRecord(part.jsonPayload) ?? {};
  const partType = asString(payload.type) ?? asString(part.partType) ?? "text";
  const text =
    asString(payload.text) ?? asString(payload.content) ?? asString(part.textContent) ?? undefined;

  return {
    ...payload,
    id: asString(payload.id) ?? part.id ?? `${partType}-${index}`,
    type: partType,
    ...(text ? { text } : {}),
    ...(partType === "text" && text && !asString(payload.content) ? { content: text } : {}),
  } satisfies Record<string, unknown>;
}

function buildLegacySessionMessageParts(message: ServiceTaskSessionMessageRecord) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  if (parts.length > 0) {
    return parts.map((part, index) => mapServiceMessagePart(part, index));
  }

  const rawPayload = asRecord(message.rawPayload);
  const rawParts = Array.isArray(rawPayload?.parts)
    ? rawPayload.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
  if (rawParts.length > 0) {
    return rawParts;
  }

  const text = asString(message.textContent);
  return text ? [{ type: "text", text, content: text }] : [];
}

function buildLegacySessionMessage(message: ServiceTaskSessionMessageRecord) {
  const rawPayload = asRecord(message.rawPayload) ?? {};
  const rawInfo = asRecord(rawPayload.info) ?? {};
  const rawTime = asRecord(rawInfo.time) ?? {};
  const id = asString(rawInfo.id) ?? asString(message.runtimeMessageId) ?? message.id;
  const role = asString(rawInfo.role) ?? asString(message.role) ?? "assistant";
  const text = asString(message.textContent) ?? asString(rawPayload.text);
  const createdAt = asString(message.createdAt) ?? asString(rawTime.created);
  const completedAt = asString(message.completedAt) ?? asString(rawTime.completed);
  const parts = buildLegacySessionMessageParts(message);

  return {
    ...rawPayload,
    id: asString(rawPayload.id) ?? id,
    role,
    ...(text ? { text } : {}),
    ...(createdAt ? { createdAt } : {}),
    info: {
      ...rawInfo,
      id,
      role,
      ...(text && !asString(rawInfo.preview) ? { preview: text } : {}),
      ...(message.status ? { status: message.status } : {}),
      ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
      ...(message.providerMessageId ? { providerMessageId: message.providerMessageId } : {}),
      ...(message.errorText && rawInfo.error === undefined ? { error: message.errorText } : {}),
      time: {
        ...rawTime,
        ...(createdAt ? { created: createdAt } : {}),
        ...(completedAt ? { completed: completedAt } : {}),
      },
    },
    parts,
  } satisfies Record<string, unknown>;
}

function mapServiceTaskSessionMessages(messages: ServiceTaskSessionMessageRecord[]) {
  return messages.map((message) => buildLegacySessionMessage(message));
}

function extractServiceTaskSessionMessageSourceSessionId(message: ServiceTaskSessionMessageRecord) {
  const topLevelSessionId = asString(message.sessionId);
  if (topLevelSessionId) {
    return topLevelSessionId;
  }

  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  return (
    asString(rawInfo?.sessionID) ??
    asString(rawInfo?.sessionId) ??
    asString(rawPayload?.sessionID) ??
    asString(rawPayload?.sessionId)
  );
}

function extractServiceTaskSessionMessageRole(message: ServiceTaskSessionMessageRecord) {
  const topLevelRole = asString(message.role);
  if (topLevelRole) {
    return topLevelRole;
  }

  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  return asString(rawInfo?.role);
}

function extractServiceTaskSessionMessageText(message: ServiceTaskSessionMessageRecord) {
  const topLevelText = asString(message.textContent);
  if (topLevelText) {
    return topLevelText;
  }

  const rawPayload = asRecord(message.rawPayload);
  const rawText =
    asString(rawPayload?.textContent) ??
    asString(rawPayload?.text) ??
    asString(rawPayload?.summaryText) ??
    asString(rawPayload?.content);
  if (rawText) {
    return rawText;
  }

  const rawParts = Array.isArray(rawPayload?.parts)
    ? rawPayload.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
  const text = rawParts
    .map((part) => asString(part.text) ?? asString(part.content) ?? "")
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function isExecutionContextUserMessage(message: ServiceTaskSessionMessageRecord) {
  if (extractServiceTaskSessionMessageRole(message) !== "user") {
    return false;
  }

  const text = extractServiceTaskSessionMessageText(message);
  return typeof text === "string" && text.startsWith("Execution context:");
}

function extractLegacySessionMessageId(message: unknown) {
  const record = asRecord(message);
  const info = asRecord(record?.info);
  return asString(info?.id) ?? asString(record?.id);
}

function dedupeLegacySessionMessages(messages: unknown[]) {
  const seen = new Set<string>();
  let anonymousIndex = 0;

  return messages.filter((message) => {
    const messageId = extractLegacySessionMessageId(message) ?? `anonymous-${anonymousIndex++}`;
    if (seen.has(messageId)) {
      return false;
    }
    seen.add(messageId);
    return true;
  });
}

function sliceLegacyMessagesForLineageBoundary(
  messages: unknown[],
  childRecord: TaskSessionLineageRecord | undefined,
) {
  if (!childRecord?.forkedFromMessageId) {
    return messages;
  }

  const boundaryIndex = messages.findIndex(
    (message) => extractLegacySessionMessageId(message) === childRecord.forkedFromMessageId,
  );
  if (boundaryIndex < 0) {
    return messages;
  }

  return messages.slice(0, boundaryIndex + 1);
}

function buildTaskSessionMessageLineagePath(
  records: TaskSessionLineageRecord[],
  sessionId: string,
) {
  const byRuntimeSessionId = new Map(
    records.map((record) => [record.runtimeSessionId, record] as const),
  );
  const selected = records.find(
    (record) => record.id === sessionId || record.runtimeSessionId === sessionId,
  );
  const path: TaskSessionLineageRecord[] = [];
  const visited = new Set<string>();
  let current = selected ?? byRuntimeSessionId.get(sessionId);

  while (current && !visited.has(current.runtimeSessionId)) {
    path.unshift(current);
    visited.add(current.runtimeSessionId);
    current = current.parentRuntimeSessionId
      ? byRuntimeSessionId.get(current.parentRuntimeSessionId)
      : undefined;
  }

  return path;
}

function deriveTaskSessionMessageCacheState(
  meta: TaskSessionTimelineMeta | undefined,
  messageCount: number,
): NonNullable<TaskSessionTimelineMeta["cacheState"]> {
  if (
    meta?.cacheState === "complete" ||
    meta?.cacheState === "partial" ||
    meta?.cacheState === "none"
  ) {
    return meta.cacheState;
  }

  if (meta?.complete === true) {
    return messageCount > 0 ? "complete" : "none";
  }

  return messageCount > 0 ? "partial" : "none";
}

function isTaskSessionMessageCacheComplete(
  meta: TaskSessionTimelineMeta | undefined,
  messageCount: number,
) {
  if (typeof meta?.complete === "boolean") {
    return meta.complete;
  }

  return deriveTaskSessionMessageCacheState(meta, messageCount) === "complete";
}

type ServiceTaskSessionMessagesResponse = {
  data?: ServiceTaskSessionMessageRecord[];
  meta?: TaskSessionTimelineMeta & {
    sessionId?: string;
    messageCount?: number;
  };
};

type TaskSessionCachedMessagesResponseData = {
  data: unknown[];
  meta:
    | (TaskSessionTimelineMeta & {
        sessionId?: string;
        messageCount?: number;
      })
    | undefined;
};

type TaskSessionCachedMessagesResult = {
  ok: boolean;
  status: number;
  data?: TaskSessionCachedMessagesResponseData;
  error?: string;
};

async function resolvePersistedTaskSessionId(
  taskId: string,
  sessionId: string,
  authorization: string,
) {
  const canonicalSessionId = toCanonicalTaskSessionId(taskId, sessionId);
  if (!canonicalSessionId) {
    return null;
  }

  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  if (lineageResult.ok) {
    const record = lineageResult.records.find(
      (item) => item.id === sessionId || item.runtimeSessionId === sessionId,
    );
    if (record?.id) {
      return record.id;
    }
  }

  return canonicalSessionId;
}

export async function fetchTaskSessionCachedCompatMessages(
  taskId: string,
  sessionId: string,
  authorization: string,
  options?: { includeLineage?: boolean },
): Promise<TaskSessionCachedMessagesResult> {
  if (options?.includeLineage) {
    const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
    const lineagePath = lineageResult.ok
      ? buildTaskSessionMessageLineagePath(lineageResult.activeRecords, sessionId)
      : [];

    if (lineagePath.length > 0) {
      const messageSets: Array<{
        ok: boolean;
        data: unknown[];
        meta: TaskSessionTimelineMeta | undefined;
      }> = await Promise.all(
        lineagePath.map(async (record) => {
          const result = await fetchTaskSessionCachedCompatMessages(
            taskId,
            record.runtimeSessionId,
            authorization,
            { includeLineage: false },
          );
          return {
            ok: result.ok,
            data: Array.isArray(result.data?.data) ? result.data.data : [],
            meta: result.data?.meta,
          };
        }),
      );

      const mergedMessages = dedupeLegacySessionMessages(
        messageSets.flatMap((result, index) =>
          sliceLegacyMessagesForLineageBoundary(result.data, lineagePath[index + 1]),
        ),
      );
      const cachedSessionCount = messageSets.filter((result) => result.data.length > 0).length;
      const complete =
        messageSets.length > 0 &&
        messageSets.every(
          (result) =>
            result.ok && isTaskSessionMessageCacheComplete(result.meta, result.data.length),
        );

      return {
        ok: true as const,
        status: 200,
        data: {
          data: mergedMessages,
          meta: {
            readSource: "task-session-first",
            includeLineage: true,
            lineagePath: lineagePath.map((record) => record.runtimeSessionId),
            cachedSessionCount,
            cacheState: complete ? "complete" : cachedSessionCount > 0 ? "partial" : "none",
            complete,
            itemCount: mergedMessages.length,
            sessionId,
            messageCount: mergedMessages.length,
          },
        },
      };
    }
  }

  const persistedSessionId = await resolvePersistedTaskSessionId(taskId, sessionId, authorization);
  if (!persistedSessionId) {
    return {
      ok: false as const,
      status: 404,
      data: undefined,
      error: "Task session not found",
    };
  }

  const result = await cpFetch<ServiceTaskSessionMessagesResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/query/normalized-conversation?sessionId=${encodeURIComponent(persistedSessionId)}&includeLineage=false`,
    { authorization },
  );
  const messages = Array.isArray(result.data?.data)
    ? mapServiceTaskSessionMessages(result.data.data)
    : [];
  const normalizedMeta = normalizeTaskSessionTimelineMeta(result.data?.meta);
  const cacheState = deriveTaskSessionMessageCacheState(normalizedMeta, messages.length);
  const complete = isTaskSessionMessageCacheComplete(normalizedMeta, messages.length);

  return {
    ...result,
    data: result.data
      ? {
          data: messages,
          meta: {
            ...normalizedMeta,
            cacheState,
            complete,
            itemCount: messages.length,
            sessionId: result.data.meta?.sessionId ?? persistedSessionId,
            messageCount: messages.length,
          },
        }
      : undefined,
  };
}

export async function fetchTaskConversationCompatMessages(
  taskId: string,
  authorization: string,
  options?: { sessionId?: string; includeLineage?: boolean },
) {
  const params = new URLSearchParams();
  if (options?.sessionId) {
    const persistedSessionId = await resolvePersistedTaskSessionId(
      taskId,
      options.sessionId,
      authorization,
    );
    if (!persistedSessionId) {
      return {
        ok: false as const,
        status: 404,
        data: undefined,
        error: "Task session not found",
      };
    }
    params.set("sessionId", persistedSessionId);
  }
  if (options?.includeLineage === false) {
    params.set("includeLineage", "false");
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const result = await cpFetch<ServiceTaskSessionMessagesResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/query/normalized-conversation${suffix}`,
    { authorization },
  );
  const serviceMessages = Array.isArray(result.data?.data) ? result.data.data : [];
  const lineageResult =
    !options?.sessionId && options?.includeLineage !== false
      ? await fetchTaskSessionLineageRecords(taskId, authorization)
      : null;
  const lineageRecordLookup =
    lineageResult?.ok && lineageResult.activeRecords.length > 0
      ? buildTaskSessionLineageCompatRecordLookup(lineageResult.activeRecords)
      : null;
  const filteredServiceMessages =
    lineageResult?.ok && lineageResult.activeRecords.length > 0
      ? filterPendingParallelTaskConversationCompatMessages({
          messages: serviceMessages,
          records: lineageResult.activeRecords,
          extractSourceSessionId: extractServiceTaskSessionMessageSourceSessionId,
          extractRole: extractServiceTaskSessionMessageRole,
          isExecutionContextUserMessage,
          shouldPreserveWorkflowExecutionContextMessage: (sessionId) =>
            shouldPreserveWorkflowExecutionContextCompatMessage(
              sessionId,
              lineageRecordLookup!,
            ),
        })
      : serviceMessages;
  const messages =
    lineageResult?.ok && lineageResult.activeRecords.length > 0
      ? await synthesizeWorkflowGroupCompatMessages({
          taskId,
          authorization,
          messages: filteredServiceMessages,
          records: lineageResult.activeRecords,
          isExecutionContextUserMessage,
          extractSourceSessionId: extractServiceTaskSessionMessageSourceSessionId,
          extractText: extractServiceTaskSessionMessageText,
          extractCreatedAt: (message) => asString(message.createdAt),
          buildLegacyMessage: buildLegacySessionMessage,
          mapRegularMessages: mapServiceTaskSessionMessages,
        })
      : mapServiceTaskSessionMessages(filteredServiceMessages);
  const normalizedMeta = normalizeTaskSessionTimelineMeta(result.data?.meta);
  const cacheState = deriveTaskSessionMessageCacheState(normalizedMeta, messages.length);
  const complete = isTaskSessionMessageCacheComplete(normalizedMeta, messages.length);

  return {
    ...result,
    data: result.data
      ? {
          data: messages,
          meta: {
            ...normalizedMeta,
            cacheState,
            complete,
            itemCount: messages.length,
            sessionId: result.data.meta?.sessionId,
            messageCount: messages.length,
          },
        }
      : undefined,
  };
}
