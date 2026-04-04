import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  roleAggregateConclusions,
  taskArtifacts,
  taskMessageEvents,
  taskMessageParts,
  taskMessages,
  taskOperations,
  taskStageRuns,
  taskSessionRuns,
  taskSessions,
  taskSnapshots,
  taskTimelineViews,
  taskUsageLedgerEntries,
  taskWorkflowRuns,
} from "../../db/schema";
import type { TaskTreeRecord } from "../project-tree/task-view";
import { ensureLegacyRoleWorkflowMigrated } from "../task-workflows/legacy-role-workflow-storage";

type TaskSessionMessagePartRecord = {
  id: string | null;
  messageId: string | null;
  partIndex: number | null;
  partType: string | null;
  textContent: string | null;
  jsonPayload: Record<string, unknown> | null;
  createdAt: string | null;
};

type TaskSessionMessageRecord = {
  id: string;
  sessionId: string;
  taskId: string | null;
  projectId: string | null;
  runtimeMessageId: string | null;
  role: string | null;
  status: string | null;
  clientMessageId: string | null;
  providerMessageId: string | null;
  messageIndex: number | null;
  textContent: string | null;
  summaryText: string | null;
  rawPayload: Record<string, unknown> | null;
  tokenUsed: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorText: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  agent: string | null;
  model: string | null;
  userInputText: string | null;
  systemContextText: string | null;
  finalSentText: string | null;
  parts: TaskSessionMessagePartRecord[];
};

type TaskSessionMessageRecordInput = Omit<TaskSessionMessageRecord, "parts">;

type TaskSessionHydrationSnapshot = {
  latestResult?: string | null;
  latestResultSummary?: string | null;
} | null;

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractPersistedStandalonePart(message: unknown) {
  const record = asRecord(message);
  const part = record?.part;
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

export type TaskSessionLineageRecord = {
  id: string;
  parentSessionId: string | null;
};

export function buildTaskSessionLineagePath(
  records: TaskSessionLineageRecord[],
  sessionId: string,
) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(sessionId);

  while (current && !visited.has(current.id)) {
    path.unshift(current.id);
    visited.add(current.id);
    current = current.parentSessionId ? byId.get(current.parentSessionId) : undefined;
  }

  return path.length > 0 ? path : [sessionId];
}

export function buildTaskSessionIdAliases(sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return [] as string[];
  }

  if (normalizedSessionId.startsWith("task-session:")) {
    return [normalizedSessionId, normalizedSessionId.replace(/^task-session:/, "task_session:")];
  }

  if (normalizedSessionId.startsWith("task_session:")) {
    return [normalizedSessionId.replace(/^task_session:/, "task-session:"), normalizedSessionId];
  }

  return [normalizedSessionId];
}

export function resolveTaskSessionRecordId(
  sessions: Array<{ id: string; runtimeSessionId?: string | null }>,
  sessionId?: string | null,
) {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return null;
  }

  const normalizedSessionId = sessionId.trim();
  return (
    sessions.find((session) => session.id === normalizedSessionId)?.id ??
    sessions.find((session) => buildTaskSessionIdAliases(session.id).includes(normalizedSessionId))
      ?.id ??
    sessions.find((session) => session.runtimeSessionId === normalizedSessionId)?.id ??
    null
  );
}

function buildTaskSessionAliasPath(sessionIds: string[]) {
  return Array.from(new Set(sessionIds.flatMap((sessionId) => buildTaskSessionIdAliases(sessionId))));
}

async function loadTaskSnapshot(taskId: string) {
  return db.query.taskSnapshots.findFirst({
    where: eq(taskSnapshots.taskId, taskId),
  });
}

async function loadTaskSessionRecord(taskId: string, sessionId: string) {
  return db.query.taskSessions.findFirst({
    where: and(eq(taskSessions.taskId, taskId), eq(taskSessions.id, sessionId)),
  });
}

async function loadTaskSessionRecords(taskId: string) {
  return db
    .select()
    .from(taskSessions)
    .where(eq(taskSessions.taskId, taskId))
    .orderBy(asc(taskSessions.createdAt));
}

function collectMissingTaskSessionModelIds(
  sessions: Array<{ id: string; selectedModel?: string | null; effectiveModel?: string | null }>,
) {
  return Array.from(
    new Set(
      sessions
        .filter((session) => !asNonEmptyString(session.selectedModel ?? null))
        .filter((session) => !asNonEmptyString(session.effectiveModel ?? null))
        .map((session) => session.id)
        .filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.length > 0),
    ),
  );
}

async function loadTaskSessionSelectedModelFallbacks(taskId: string, sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return new Map<string, string>();
  }

  const operationRows = await db
    .select({
      sessionId: taskSessionRuns.sessionId,
      modelRoute: taskSessionRuns.modelRoute,
      createdAt: taskSessionRuns.createdAt,
    })
    .from(taskSessionRuns)
    .where(
      and(
        eq(taskSessionRuns.taskId, taskId),
        inArray(taskSessionRuns.sessionId, sessionIds),
      ),
    )
    .orderBy(asc(taskSessionRuns.createdAt));

  const selectedModelBySessionId = new Map<string, string>();
  for (const row of operationRows) {
    const sessionId = asNonEmptyString(row.sessionId);
    if (!sessionId || selectedModelBySessionId.has(sessionId)) {
      continue;
    }

    const formattedModel = asNonEmptyString(row.modelRoute);
    if (formattedModel) {
      selectedModelBySessionId.set(sessionId, formattedModel);
    }
  }

  return selectedModelBySessionId;
}

function hydrateTaskSessionSelectedModels<
  TSession extends { id: string; selectedModel?: string | null; effectiveModel?: string | null },
>(
  sessions: TSession[],
  selectedModelBySessionId: Map<string, string>,
) {
  return sessions.map((session) => ({
    ...session,
    selectedModel:
      session.selectedModel ??
      session.effectiveModel ??
      selectedModelBySessionId.get(session.id) ??
      null,
  }));
}

function resolveCurrentTaskSessionId(
  sessions: Array<{ id: string; runtimeSessionId?: string | null }>,
  currentSessionId?: string | null,
) {
  return resolveTaskSessionRecordId(sessions, currentSessionId);
}

function attachTaskSessionMessageParts(
  messages: TaskSessionMessageRecordInput[],
  parts: TaskSessionMessagePartRecord[],
) {
  const partsByMessageId = new Map<string, TaskSessionMessagePartRecord[]>();
  for (const part of parts) {
    const messageId = asNonEmptyString(part.messageId);
    if (!messageId) {
      continue;
    }

    const existing = partsByMessageId.get(messageId) ?? [];
    existing.push(part);
    partsByMessageId.set(messageId, existing);
  }

  return messages.map((message) => ({
    ...message,
    parts: partsByMessageId.get(message.id) ?? [],
  }));
}

function normalizeTaskSessionMessagePart(
  part: typeof taskMessageParts.$inferSelect,
): TaskSessionMessagePartRecord {
  return {
    id: part.id ?? null,
    messageId: part.messageId ?? null,
    partIndex: typeof part.partIndex === "number" ? part.partIndex : null,
    partType: part.partType ?? null,
    textContent: part.textContent ?? null,
    jsonPayload: part.jsonPayload ?? null,
    createdAt: part.createdAt ?? null,
  };
}

function normalizeTaskSessionMessageRecord(
  message: typeof taskMessages.$inferSelect,
): TaskSessionMessageRecordInput {
  const rawMessage = message as Record<string, unknown>;
  const rawPayload = asRecord(rawMessage.rawPayload) ?? null;
  const rawInfo = asRecord(rawPayload?.info) ?? null;
  const rawTime = asRecord(rawInfo?.time) ?? null;
  const createdAt =
    asNonEmptyString(rawMessage.createdAt) ??
    asNonEmptyString(rawTime?.created) ??
    null;
  const completedAt =
    asNonEmptyString(rawMessage.completedAt) ??
    asNonEmptyString(rawTime?.completed) ??
    null;
  const textContent =
    asNonEmptyString(rawMessage.textContent) ??
    asNonEmptyString(rawMessage.textPreview) ??
    asNonEmptyString(rawPayload?.textContent) ??
    asNonEmptyString(rawPayload?.text) ??
    asNonEmptyString(rawPayload?.content) ??
    null;

  return {
    id: message.id,
    sessionId: message.sessionId,
    taskId: asNonEmptyString(rawMessage.taskId),
    projectId: asNonEmptyString(rawMessage.projectId),
    runtimeMessageId:
      asNonEmptyString(rawMessage.runtimeMessageId) ??
      asNonEmptyString(rawPayload?.runtimeMessageId) ??
      asNonEmptyString(rawInfo?.id) ??
      null,
    role: message.role,
    status: asNonEmptyString(rawMessage.status),
    clientMessageId:
      asNonEmptyString(rawMessage.clientMessageId) ??
      asNonEmptyString(rawPayload?.clientMessageId) ??
      asNonEmptyString(rawPayload?.client_message_id) ??
      null,
    providerMessageId:
      asNonEmptyString(rawMessage.providerMessageId) ??
      asNonEmptyString(rawPayload?.providerMessageId) ??
      asNonEmptyString(rawPayload?.provider_message_id) ??
      asNonEmptyString(rawInfo?.id) ??
      null,
    messageIndex:
      typeof rawMessage.seq === "number"
        ? rawMessage.seq
        : typeof rawMessage.messageIndex === "number"
          ? rawMessage.messageIndex
          : null,
    textContent,
    summaryText:
      asNonEmptyString(rawMessage.summaryText) ??
      asNonEmptyString(rawMessage.textPreview) ??
      textContent,
    rawPayload,
    tokenUsed: typeof rawMessage.tokenUsed === "number" ? rawMessage.tokenUsed : null,
    startedAt: asNonEmptyString(rawMessage.startedAt) ?? createdAt,
    completedAt,
    errorText:
      asNonEmptyString(rawMessage.errorText) ??
      asNonEmptyString(rawPayload?.errorText) ??
      asNonEmptyString(rawPayload?.error_text) ??
      asNonEmptyString(rawInfo?.error) ??
      null,
    agent:
      asNonEmptyString(rawInfo?.agent) ??
      asNonEmptyString(rawPayload?.agent) ??
      null,
    model:
      asNonEmptyString(rawInfo?.model) ??
      asNonEmptyString(rawPayload?.model) ??
      null,
    userInputText: asNonEmptyString(asRecord(rawPayload?.promptDecomposition)?.userInputText) ?? null,
    systemContextText: asNonEmptyString(asRecord(rawPayload?.promptDecomposition)?.systemContextText) ?? null,
    finalSentText: asNonEmptyString(asRecord(rawPayload?.promptDecomposition)?.finalSentText) ?? null,
    createdAt,
    updatedAt: asNonEmptyString(rawMessage.updatedAt) ?? createdAt,
  };
}

async function loadTaskSessionMessagesInternal(
  taskId: string,
  sessionId: string,
): Promise<TaskSessionMessageRecord[]> {
  const sessionAliases = buildTaskSessionIdAliases(sessionId);

  const canonicalMessages = await db
    .select()
    .from(taskMessages)
    .where(and(eq(taskMessages.taskId, taskId), inArray(taskMessages.sessionId, sessionAliases)))
    .orderBy(asc(taskMessages.seq), asc(taskMessages.createdAt));

  const canonicalMessageIds = canonicalMessages.map((message) => message.id);
  const canonicalParts =
    canonicalMessageIds.length > 0
      ? await db
          .select()
          .from(taskMessageParts)
          .where(inArray(taskMessageParts.messageId, canonicalMessageIds))
          .orderBy(asc(taskMessageParts.partIndex))
      : [];

  if (canonicalMessages.length > 0) {
    return sortSingleTaskSessionMessageRecords(
      attachTaskSessionMessageParts(
        canonicalMessages.map((message) => normalizeTaskSessionMessageRecord(message)),
        canonicalParts.map((part) => normalizeTaskSessionMessagePart(part)),
      ),
    );
  }

  return [];
}

async function loadTaskMessageEventsInternal(taskId: string) {
  return db
    .select({
      id: taskMessageEvents.id,
      taskId: taskMessageEvents.taskId,
      sessionId: taskMessageEvents.sessionId,
      eventType: taskMessageEvents.eventType,
      runtimeMessageId: taskMessageEvents.runtimeMessageId,
      payload: taskMessageEvents.payload,
      projected: taskMessageEvents.projected,
      createdAt: taskMessageEvents.createdAt,
    })
    .from(taskMessageEvents)
    .where(eq(taskMessageEvents.taskId, taskId))
    .orderBy(asc(taskMessageEvents.createdAt), asc(taskMessageEvents.id));
}

type LoadedTaskSessionMessageRecord = TaskSessionMessageRecord;

function extractTaskSessionMessageRole(message: LoadedTaskSessionMessageRecord) {
  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  return asNonEmptyString(message.role) ?? asNonEmptyString(rawInfo?.role) ?? "assistant";
}

function extractTaskSessionMessageTextFromParts(
  parts: Array<{
    textContent?: string | null;
    jsonPayload?: Record<string, unknown> | null;
  }>,
) {
  return parts
    .map((part) => {
      const payload = asRecord(part.jsonPayload);
      return (
        asNonEmptyString(part.textContent) ??
        asNonEmptyString(payload?.text) ??
        asNonEmptyString(payload?.content) ??
        ""
      );
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractTaskSessionMessageText(message: LoadedTaskSessionMessageRecord) {
  const partText = extractTaskSessionMessageTextFromParts(
    Array.isArray(message.parts) ? message.parts : [],
  );
  if (partText) {
    return partText;
  }

  const rawPayload = asRecord(message.rawPayload);
  const rawParts = Array.isArray(rawPayload?.parts)
    ? rawPayload.parts
        .map((part) => asRecord(part))
        .filter(
          (part): part is Record<string, unknown> & {
            textContent?: string | null;
            jsonPayload?: Record<string, unknown> | null;
          } => Boolean(part),
        )
    : [];
  const rawPartText = extractTaskSessionMessageTextFromParts(rawParts);
  if (rawPartText) {
    return rawPartText;
  }

  return (
    asNonEmptyString(message.textContent) ??
    asNonEmptyString(rawPayload?.text) ??
    asNonEmptyString(rawPayload?.content) ??
    ""
  );
}

function hasDisplayableTaskSessionMessageContent(message: LoadedTaskSessionMessageRecord) {
  return extractTaskSessionMessageText(message).length > 0;
}

function hasStructuredTaskSessionMessageParts(message: LoadedTaskSessionMessageRecord) {
  if (Array.isArray(message.parts) && message.parts.some((part) => Boolean(part))) {
    return true;
  }

  const rawPayload = asRecord(message.rawPayload);
  return Array.isArray(rawPayload?.parts) && rawPayload.parts.some((part) => Boolean(part));
}

function isHydratableTaskSessionMessageShell(message: LoadedTaskSessionMessageRecord) {
  return !hasDisplayableTaskSessionMessageContent(message) && !hasStructuredTaskSessionMessageParts(message);
}

function buildSyntheticTaskSessionTextPart(
  message: LoadedTaskSessionMessageRecord,
  text: string,
): TaskSessionMessagePartRecord {
  return {
    id: `${message.id}:synthetic-text`,
    messageId: message.id,
    partIndex: Array.isArray(message.parts) ? message.parts.length : 0,
    partType: "text",
    textContent: text,
    jsonPayload: {
      type: "text",
      text,
      content: text,
    },
    createdAt:
      asNonEmptyString(message.createdAt) ??
      asNonEmptyString(message.completedAt) ??
      asNonEmptyString(message.startedAt) ??
      null,
  };
}

function hydrateTaskSessionMessageShell(
  message: LoadedTaskSessionMessageRecord,
  text: string,
) {
  const rawPayload = asRecord(message.rawPayload) ?? {};
  const rawInfo = asRecord(rawPayload.info) ?? {};
  const rawTime = asRecord(rawInfo.time) ?? {};
  const existingParts = Array.isArray(message.parts) ? message.parts : [];
  const nextParts =
    extractTaskSessionMessageTextFromParts(existingParts).length > 0
      ? existingParts
      : [...existingParts, buildSyntheticTaskSessionTextPart(message, text)];
  const rawParts = Array.isArray(rawPayload.parts)
    ? rawPayload.parts.filter((part) => Boolean(part))
    : [];

  return {
    ...message,
    textContent: asNonEmptyString(message.textContent) ?? text,
    rawPayload: {
      ...rawPayload,
      ...(asNonEmptyString(rawPayload.text) ? {} : { text }),
      info: {
        ...rawInfo,
        ...(asNonEmptyString(rawInfo.preview) ? {} : { preview: text }),
        time: {
          ...rawTime,
          ...(rawTime.created !== undefined || !asNonEmptyString(message.createdAt)
            ? {}
            : { created: message.createdAt }),
          ...(rawTime.completed !== undefined || !asNonEmptyString(message.completedAt)
            ? {}
            : { completed: message.completedAt }),
        },
      },
      parts:
        rawParts.length > 0
          ? rawParts
          : [
              {
                type: "text",
                text,
                content: text,
              },
            ],
    },
    parts: nextParts,
  } satisfies LoadedTaskSessionMessageRecord;
}

function findHydratableTaskSessionMessageIndex(
  messages: LoadedTaskSessionMessageRecord[],
  role: "user" | "assistant",
  fromEnd = false,
) {
  if (fromEnd) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) {
        continue;
      }

      if (extractTaskSessionMessageRole(message) === role && isHydratableTaskSessionMessageShell(message)) {
        return index;
      }
    }
    return -1;
  }

  return messages.findIndex(
    (message) => extractTaskSessionMessageRole(message) === role && isHydratableTaskSessionMessageShell(message),
  );
}

function hydrateTaskConversationShellMessages(args: {
  messages: LoadedTaskSessionMessageRecord[];
  promptText?: string | null;
  task: TaskTreeRecord;
  snapshot?: TaskSessionHydrationSnapshot;
}) {
  const hydrated = [...args.messages];
  const promptText = asNonEmptyString(args.promptText);
  if (promptText) {
    const userIndex = findHydratableTaskSessionMessageIndex(hydrated, "user");
    const userMessage = userIndex >= 0 ? hydrated[userIndex] : undefined;
    if (userMessage) {
      hydrated[userIndex] = hydrateTaskSessionMessageShell(userMessage, promptText);
    }
  }

  const latestResponseText =
    asNonEmptyString(args.snapshot?.latestResult) ??
    asNonEmptyString(args.snapshot?.latestResultSummary) ??
    asNonEmptyString(args.task.result) ??
    asNonEmptyString(args.task.latestResultSummary);
  if (latestResponseText) {
    const assistantIndex = findHydratableTaskSessionMessageIndex(
      hydrated,
      "assistant",
      true,
    );
    const assistantMessage = assistantIndex >= 0 ? hydrated[assistantIndex] : undefined;
    if (assistantMessage) {
      hydrated[assistantIndex] = hydrateTaskSessionMessageShell(
        assistantMessage,
        latestResponseText,
      );
    }
  }

  return hydrated;
}

function buildSyntheticRootPromptMessage(args: {
  taskId: string;
  sessionId: string;
  promptText: string;
  createdAt: string | null;
}) {
  const messageId = `${args.sessionId}:synthetic-root-prompt`;
  const textPart = buildSyntheticTaskSessionTextPart(
    {
      id: messageId,
      sessionId: args.sessionId,
      taskId: args.taskId,
      projectId: null,
      runtimeMessageId: `${messageId}:runtime`,
      role: "user",
      status: "completed",
      clientMessageId: null,
      providerMessageId: null,
      messageIndex: -1,
      textContent: args.promptText,
      summaryText: args.promptText,
      rawPayload: {
        info: {
          id: `${messageId}:runtime`,
          role: "user",
          preview: args.promptText,
          time: {
            created: args.createdAt,
          },
        },
      },
      tokenUsed: null,
      startedAt: args.createdAt,
      completedAt: args.createdAt,
      errorText: null,
      agent: null,
      model: null,
      userInputText: null,
      systemContextText: null,
      finalSentText: null,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
      parts: [],
    },
    args.promptText,
  );

  return {
    id: messageId,
    sessionId: args.sessionId,
    taskId: args.taskId,
    projectId: null,
    runtimeMessageId: `${messageId}:runtime`,
    role: "user",
    status: "completed",
    clientMessageId: null,
    providerMessageId: null,
    messageIndex: -1,
    textContent: args.promptText,
    summaryText: args.promptText,
    rawPayload: {
      info: {
        id: `${messageId}:runtime`,
        role: "user",
        preview: args.promptText,
        time: {
          created: args.createdAt,
        },
      },
      text: args.promptText,
      parts: [
        {
          type: "text",
          text: args.promptText,
          content: args.promptText,
        },
      ],
    },
    tokenUsed: null,
    startedAt: args.createdAt,
    completedAt: args.createdAt,
    errorText: null,
    agent: null,
    model: null,
    userInputText: null,
    systemContextText: null,
    finalSentText: null,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
    parts: [textPart],
  } satisfies LoadedTaskSessionMessageRecord;
}

function ensureRootPromptMessage(args: {
  messages: LoadedTaskSessionMessageRecord[];
  task: TaskTreeRecord;
  sessionId: string;
  isRootSession: boolean;
}) {
  if (!args.isRootSession) {
    return args.messages;
  }

  const promptText = asNonEmptyString(args.task.prompt);
  if (!promptText) {
    return args.messages;
  }

  const normalizePromptEquivalenceText = (value: string) => value.replace(/\s+/g, " ").trim();
  const normalizedPromptText = normalizePromptEquivalenceText(promptText);

  const hasPromptEquivalentUserMessage = args.messages.some((message) => {
    if (extractTaskSessionMessageRole(message) !== "user") {
      return false;
    }

    const messageText = extractTaskSessionMessageText(message);
    if (!messageText) {
      return false;
    }

    const normalizedMessageText = normalizePromptEquivalenceText(messageText);
    if (!normalizedPromptText) {
      return true;
    }

    if (messageText.trim().startsWith("Execution context:")) {
      return false;
    }

    return normalizedMessageText === normalizedPromptText;
  });
  if (hasPromptEquivalentUserMessage) {
    return args.messages;
  }

  const syntheticPrompt = buildSyntheticRootPromptMessage({
    taskId: args.task.id,
    sessionId: args.sessionId,
    promptText,
    createdAt: args.task.createdAt ?? null,
  });
  return sortSingleTaskSessionMessageRecords([syntheticPrompt, ...args.messages]);
}

function extractWorkflowTemplateId(task: TaskTreeRecord) {
  const strategy = asRecord(task.strategy);
  return (
    asNonEmptyString(strategy?.workflowTemplateId) ??
    asNonEmptyString(strategy?.selectedTemplateId) ??
    null
  );
}

function extractWorkflowStageKey(args: {
  selectedSessionId: string | null;
  scopedSessions: Array<{ id: string; workflowStageKey?: string | null; createdAt?: string | null }>;
  scopedRuns: Array<{ sessionId?: string | null; workflowStageKey?: string | null; createdAt?: string | null }>;
  task: TaskTreeRecord;
}) {
  const selectedSession = args.selectedSessionId
    ? args.scopedSessions.find((session) => session.id === args.selectedSessionId) ?? null
    : null;
  const latestRun = [...args.scopedRuns]
    .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))
    .at(-1);
  const strategy = asRecord(args.task.strategy);
  return (
    asNonEmptyString(selectedSession?.workflowStageKey) ??
    asNonEmptyString(latestRun?.workflowStageKey) ??
    asNonEmptyString(strategy?.currentStage) ??
    null
  );
}

function formatWorkflowStageLabel(stageKey: string | null) {
  if (!stageKey) {
    return null;
  }

  return stageKey
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function inferWorkflowApprovalState(taskStatus: TaskTreeRecord["status"]) {
  if (taskStatus === "paused" || taskStatus === "waiting-approval") {
    return "pending";
  }

  return "not-required";
}

function summarizeOperationPayload(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => summarizeOperationPayload(entry))
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join(" | ");
  }

  if (typeof value === "object") {
    const record = asRecord(value);
    if (!record) {
      return null;
    }

    return Object.entries(record)
      .map(([key, entry]) => {
        const summarized = summarizeOperationPayload(entry);
        return summarized ? `${key}: ${summarized}` : null;
      })
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .join(" | ");
  }

  return null;
}

function extractTaskTreeMessageParentId(message: LoadedTaskSessionMessageRecord) {
  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  return asNonEmptyString(rawPayload?.parentID) ?? asNonEmptyString(rawInfo?.parentID) ?? null;
}

function extractTaskTreeMessageRunId(
  message: LoadedTaskSessionMessageRecord,
  runs: Array<{ id: string; sessionId?: string | null }>,
) {
  if (extractTaskSessionMessageRole(message) === "user") {
    return null;
  }

  const sessionRuns = runs.filter((run) => run.sessionId === message.sessionId);
  return sessionRuns.at(-1)?.id ?? null;
}

function buildFallbackOperationsFromMessageParts(
  messages: LoadedTaskSessionMessageRecord[],
) {
  const fallbackOperations: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    const parts = Array.isArray(message.parts) ? message.parts : [];
    for (const part of parts) {
      if (!part?.id || (part.partType !== "tool_call" && part.partType !== "tool_result")) {
        continue;
      }

      const payload = asRecord(part.jsonPayload) ?? {};
      const toolName =
        asNonEmptyString(payload.name) ??
        asNonEmptyString(payload.tool) ??
        asNonEmptyString(asRecord(payload.toolCall)?.name) ??
        asNonEmptyString(asRecord(payload.toolCall)?.tool) ??
        asNonEmptyString(asRecord(payload.metadata)?.toolName) ??
        "tool";
      const operationKind = part.partType === "tool_call" ? "tool_call" : "tool_result";
      const executionStatus =
        operationKind === "tool_result"
          ? asNonEmptyString(asRecord(payload.state)?.status) ?? "complete"
          : "complete";
      const outputText =
        operationKind === "tool_result"
          ? asNonEmptyString(asRecord(payload.state)?.output) ??
            asNonEmptyString(payload.output) ??
            asNonEmptyString(payload.text) ??
            asNonEmptyString(part.textContent)
          : null;
      const argumentsSummary =
        operationKind === "tool_call"
          ? summarizeOperationPayload(payload.input ?? payload.arguments ?? payload.args)
          : null;

      fallbackOperations.push({
        id: `fallback-operation:${part.id}`,
        sessionId: message.sessionId,
        taskId: message.taskId,
        projectId: message.projectId,
        messageId: message.id,
        runtimeOperationId: asNonEmptyString(payload.callId) ?? asNonEmptyString(payload.id) ?? part.id,
        operationIndex: part.partIndex,
        operationKind,
        executorKey: toolName,
        executorLabel: toolName,
        providerId: null,
        modelId: null,
        executionStatus,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        outputText,
        errorText:
          operationKind === "tool_result"
            ? asNonEmptyString(asRecord(payload.state)?.error) ?? asNonEmptyString(payload.error)
            : null,
        metadataJson: {
          source: "message-part-fallback",
          messageId: message.id,
          partId: part.id,
          partType: part.partType,
          toolName,
          argumentsSummary,
          rawPart: payload,
        },
        summaryJson: {
          source: "message-part-fallback",
          messageId: message.id,
          partId: part.id,
          partType: part.partType,
        },
        startedAt: message.startedAt,
        finishedAt: message.completedAt ?? message.updatedAt,
        createdAt: part.createdAt ?? message.createdAt,
        updatedAt: message.updatedAt,
      });
    }
  }

  return fallbackOperations;
}

async function loadTaskWorkflowFacts(taskId: string) {
  await ensureLegacyRoleWorkflowMigrated(taskId);

  const workflowRuns = await db
    .select()
    .from(taskWorkflowRuns)
    .where(eq(taskWorkflowRuns.taskId, taskId))
    .orderBy(asc(taskWorkflowRuns.createdAt));

  const latestWorkflowRun = workflowRuns.at(-1) ?? null;
  if (!latestWorkflowRun) {
    return { workflowRun: null, stages: [], roleConclusions: [] };
  }

  const [stages, conclusions] = await Promise.all([
    db
      .select()
      .from(taskStageRuns)
      .where(eq(taskStageRuns.workflowRunId, latestWorkflowRun.id))
      .orderBy(asc(taskStageRuns.createdAt)),
    db
      .select()
      .from(roleAggregateConclusions)
      .where(eq(roleAggregateConclusions.taskId, taskId))
      .orderBy(asc(roleAggregateConclusions.createdAt)),
  ]);

  return {
    workflowRun: latestWorkflowRun,
    stages,
    roleConclusions: conclusions,
  };
}

function extractTaskSessionMessageIdentity(
  message: TaskSessionMessageRecord,
) {
  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  return (
    (typeof message.runtimeMessageId === "string" && message.runtimeMessageId.trim()) ||
    (typeof rawInfo?.id === "string" && rawInfo.id.trim()) ||
    message.id
  );
}

function dedupeTaskSessionMessageRecords(
  messages: TaskSessionMessageRecord[],
) {
  const seen = new Map<string, number>();
  const deduped: TaskSessionMessageRecord[] = [];

  for (const message of messages) {
    const identity = extractTaskSessionMessageIdentity(message);
    const existingIndex = seen.get(identity);
    if (existingIndex != null) {
      const existing = deduped[existingIndex];
      if (!existing) {
        deduped.push(message);
        seen.set(identity, deduped.length - 1);
        continue;
      }

      const existingText = extractTaskSessionMessageText(existing);
      const candidateText = extractTaskSessionMessageText(message);
      if (
        candidateText.length > 0 &&
        (existingText.length === 0 || candidateText.length > existingText.length)
      ) {
        deduped[existingIndex] = hydrateTaskSessionMessageShell(existing, candidateText);
      }
      continue;
    }
    seen.set(identity, deduped.length);
    deduped.push(message);
  }

  return deduped;
}

function resolveTaskSessionMessageSortTime(
  message: TaskSessionMessageRecord,
) {
  const rawPayload = asRecord(message.rawPayload);
  const rawInfo = asRecord(rawPayload?.info);
  const rawTime = asRecord(rawInfo?.time);
  const candidates = [
    message.createdAt,
    rawTime?.created,
    message.startedAt,
    rawTime?.started,
    message.completedAt,
    rawTime?.completed,
  ];

  for (const candidate of candidates) {
    const value = asNonEmptyString(candidate);
    if (!value) {
      continue;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function resolveTaskSessionMessageRolePriority(
  message: TaskSessionMessageRecord,
) {
  switch (extractTaskSessionMessageRole(message)) {
    case "user":
      return 0;
    case "assistant":
      return 1;
    case "tool":
      return 2;
    default:
      return 3;
  }
}

function sortSingleTaskSessionMessageRecords(
  messages: TaskSessionMessageRecord[],
) {
  return messages
    .map((message, index) => ({
      message,
      index,
      sortTime: resolveTaskSessionMessageSortTime(message),
      rolePriority: resolveTaskSessionMessageRolePriority(message),
      messageIndex:
        typeof message.messageIndex === "number" && Number.isFinite(message.messageIndex)
          ? message.messageIndex
          : Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => {
      if (left.sortTime != null && right.sortTime != null && left.sortTime !== right.sortTime) {
        return left.sortTime - right.sortTime;
      }

      if (left.sortTime != null && right.sortTime == null) {
        return -1;
      }

      if (left.sortTime == null && right.sortTime != null) {
        return 1;
      }

      if (left.rolePriority !== right.rolePriority) {
        return left.rolePriority - right.rolePriority;
      }

      if (left.messageIndex !== right.messageIndex) {
        return left.messageIndex - right.messageIndex;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.message);
}

function sortTaskSessionMessageRecordsChronologically(
  messages: TaskSessionMessageRecord[],
  sessionIds: string[],
) {
  const sessionOrder = new Map<string, number>();
  for (const [index, sessionId] of sessionIds.entries()) {
    for (const alias of buildTaskSessionIdAliases(sessionId)) {
      if (!sessionOrder.has(alias)) {
        sessionOrder.set(alias, index);
      }
    }
  }

  return messages
    .map((message, index) => ({
      message,
      index,
      sortTime: resolveTaskSessionMessageSortTime(message),
      rolePriority: resolveTaskSessionMessageRolePriority(message),
      sessionIndex: sessionOrder.get(message.sessionId ?? "") ?? Number.MAX_SAFE_INTEGER,
      messageIndex:
        typeof message.messageIndex === "number" && Number.isFinite(message.messageIndex)
          ? message.messageIndex
          : Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => {
      if (left.sortTime != null && right.sortTime != null && left.sortTime !== right.sortTime) {
        return left.sortTime - right.sortTime;
      }

      if (left.sortTime != null && right.sortTime == null) {
        return -1;
      }

      if (left.sortTime == null && right.sortTime != null) {
        return 1;
      }

      if (left.sessionIndex !== right.sessionIndex) {
        return left.sessionIndex - right.sessionIndex;
      }

      if (left.rolePriority !== right.rolePriority) {
        return left.rolePriority - right.rolePriority;
      }

      if (left.messageIndex !== right.messageIndex) {
        return left.messageIndex - right.messageIndex;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.message);
}

function sliceTaskSessionMessagesForLineageBoundary(
  messages: TaskSessionMessageRecord[],
  childRecord:
    | {
        forkedFromMessageId?: string | null;
      }
    | undefined,
) {
  if (!childRecord?.forkedFromMessageId) {
    return messages;
  }

  const boundaryIndex = messages.findIndex(
    (message) => extractTaskSessionMessageIdentity(message) === childRecord.forkedFromMessageId,
  );
  if (boundaryIndex < 0) {
    return messages;
  }

  return messages.slice(0, boundaryIndex + 1);
}

function resolveTaskSessionSelection(args: {
  sessions: Array<{
    id: string;
    parentSessionId: string | null;
    runtimeSessionId?: string | null;
  }>;
  currentSessionId?: string | null;
  requestedSessionId?: string | null;
  includeLineage: boolean;
}) {
  const latestSessionId = args.sessions.at(-1)?.id ?? null;
  const currentSessionId = resolveCurrentTaskSessionId(args.sessions, args.currentSessionId);
  const normalizedRequestedSessionId = resolveTaskSessionRecordId(
    args.sessions,
    args.requestedSessionId,
  );

  if (args.requestedSessionId && !normalizedRequestedSessionId) {
    return {
      ok: false as const,
      status: 404 as const,
      error: "Task session not found",
    };
  }

  const selectedSessionId =
    normalizedRequestedSessionId ?? currentSessionId ?? latestSessionId ?? null;
  const lineagePath = selectedSessionId
    ? args.includeLineage
      ? buildTaskSessionLineagePath(args.sessions, selectedSessionId)
      : [selectedSessionId]
    : [];

  return {
    ok: true as const,
    currentSessionId,
    latestSessionId,
    selectedSessionId,
    lineagePath,
  };
}

async function loadTaskSessionOperationsInternal(taskId: string, sessionId: string) {
  const operations = await db
    .select()
    .from(taskOperations)
    .where(and(eq(taskOperations.taskId, taskId), eq(taskOperations.sessionId, sessionId)))
    .orderBy(asc(taskOperations.operationIndex), asc(taskOperations.createdAt));

  return operations.map((operation) => ({
    id: operation.id,
    sessionId: operation.sessionId,
    taskId: operation.taskId,
    projectId: null,
    runtimeOperationId: operation.runtimeOperationId,
    operationIndex: operation.operationIndex,
    operationKind: operation.operationKind === "model_request" ? "executor" : operation.operationKind,
    executorKey: operation.title ?? operation.operationKind,
    executorLabel: operation.title ?? operation.operationKind,
    providerId: null,
    modelId: null,
    executionStatus:
      operation.status === "completed"
        ? "complete"
        : operation.status === "queued"
          ? "queued"
          : operation.status,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    outputText: null,
    errorText: null,
    metadataJson: operation.summaryJson,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  }));
}

async function loadTaskSessionArtifactsInternal(taskId: string, sessionId: string) {
  return db
    .select()
    .from(taskArtifacts)
    .where(and(eq(taskArtifacts.taskId, taskId), eq(taskArtifacts.sessionId, sessionId)))
    .orderBy(asc(taskArtifacts.createdAt));
}

async function loadTaskUsageLedgerEntriesInternal(taskId: string, sessionId?: string | null) {
  const filters = [eq(taskUsageLedgerEntries.taskId, taskId)];
  if (sessionId) {
    filters.push(eq(taskUsageLedgerEntries.sessionId, sessionId));
  }

  return db
    .select()
    .from(taskUsageLedgerEntries)
    .where(and(...filters))
    .orderBy(asc(taskUsageLedgerEntries.recordedAt), asc(taskUsageLedgerEntries.createdAt));
}

export function createTaskSessionReadApi(deps: {
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
}) {
  async function buildTaskTreeResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    const task = await ensureTask(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions, workflowFacts] = await Promise.all([
      loadTaskSnapshot(args.taskId),
      loadTaskSessionRecords(args.taskId),
      loadTaskWorkflowFacts(args.taskId),
    ]);

    const selection = resolveTaskSessionSelection({
      sessions,
      currentSessionId: snapshot?.currentSessionId,
      requestedSessionId: args.sessionId,
      includeLineage: args.includeLineage,
    });
    if (!selection.ok) {
      return selection;
    }

    const scopedSessionIds =
      args.sessionId || args.includeLineage === false
        ? selection.lineagePath
        : sessions.map((session) => session.id);

    const [runs, scopedSessionMessages, operations, artifacts] = await Promise.all([
      scopedSessionIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(taskSessionRuns)
            .where(
              and(
                eq(taskSessionRuns.taskId, args.taskId),
                inArray(taskSessionRuns.sessionId, scopedSessionIds),
              ),
            )
            .orderBy(asc(taskSessionRuns.createdAt)),
      scopedSessionIds.length === 0
        ? Promise.resolve([])
        : Promise.all(
            scopedSessionIds.map(async (sessionId) => {
              const session = sessions.find((record) => record.id === sessionId) ?? null;
              const loadedMessages = await loadTaskSessionMessagesInternal(args.taskId, sessionId);
              const promptReadyMessages = ensureRootPromptMessage({
                messages: loadedMessages,
                task,
                sessionId,
                isRootSession: session?.parentSessionId == null,
              });
              const hydratedMessages = hydrateTaskConversationShellMessages({
                messages: promptReadyMessages,
                promptText: session?.parentSessionId ? null : task.prompt,
                task,
                snapshot,
              });
              return sortSingleTaskSessionMessageRecords(hydratedMessages);
            }),
          ).then((records) => records.flat()),
      scopedSessionIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(taskOperations)
            .where(and(eq(taskOperations.taskId, args.taskId), inArray(taskOperations.sessionId, scopedSessionIds)))
            .orderBy(asc(taskOperations.createdAt), asc(taskOperations.operationIndex)),
      scopedSessionIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(taskArtifacts)
            .where(and(eq(taskArtifacts.taskId, args.taskId), inArray(taskArtifacts.sessionId, scopedSessionIds)))
            .orderBy(asc(taskArtifacts.createdAt)),
    ]);

    const messagesWithRootPrompt =
      scopedSessionMessages.length === 0
        ? ensureRootPromptMessage({
            messages: [],
            task,
            sessionId: `virtual-root-${args.taskId}`,
            isRootSession: true,
          })
        : scopedSessionMessages;
    const messages = sortSingleTaskSessionMessageRecords(messagesWithRootPrompt);
    const messageParts = messages.flatMap((message) => message.parts ?? []);
    const normalizedOperations =
      operations.length > 0 ? operations : buildFallbackOperationsFromMessageParts(messages);
    const scopedSessions = sessions.filter((session) => scopedSessionIds.includes(session.id));
    const workflowStageKey =
      asNonEmptyString(workflowFacts.workflowRun?.currentStage) ??
      extractWorkflowStageKey({
      selectedSessionId: selection.selectedSessionId,
      scopedSessions,
      scopedRuns: runs,
      task,
    });
    const workflowTemplateId =
      asNonEmptyString(workflowFacts.workflowRun?.templateId) ?? extractWorkflowTemplateId(task);
    const currentStageRun = workflowFacts.stages.find((stage) => stage.stageKey === workflowStageKey) ?? null;

    const rootSessionId =
      sessions.find((session) => session.parentSessionId == null)?.id ?? sessions[0]?.id ?? null;

    const parallelGroups = Array.from(
      runs
        .filter((run) => typeof run.coordinationKey === "string" && run.coordinationKey.length > 0)
        .reduce((groups, run) => {
          const key = run.coordinationKey as string;
          const existing = groups.get(key) ?? {
            coordinationKey: key,
            sessionId: run.sessionId,
            executionMode: run.executionKind,
            winnerRunId: null as string | null,
            runIds: [] as string[],
          };
          existing.runIds.push(run.id);
          groups.set(key, existing);
          return groups;
        }, new Map<string, { coordinationKey: string; sessionId: string; executionMode: string | null; winnerRunId: string | null; runIds: string[] }>()),
    ).map(([, value]) => value);

    const edges = {
      sessionParent: sessions
        .filter((session) => session.parentSessionId)
        .map((session) => ({ sessionId: session.id, parentSessionId: session.parentSessionId })),
      sessionSource: sessions
        .filter((session) => session.sourceMessageId)
        .map((session) => ({ sessionId: session.id, sourceMessageId: session.sourceMessageId })),
      sessionRun: runs.map((run) => ({ sessionId: run.sessionId, runId: run.id })),
      sessionMessage: messages.map((message) => ({ sessionId: message.sessionId, messageId: message.id })),
      messageParent: messages
        .map((message) => ({ messageId: message.id, parentMessageId: extractTaskTreeMessageParentId(message) }))
        .filter((message) => message.parentMessageId),
      messageReply: messages
        .map((message) => ({ messageId: message.id, replyToMessageId: extractTaskTreeMessageParentId(message) }))
        .filter((message) => message.replyToMessageId),
      runMessage: messages
        .map((message) => ({ runId: extractTaskTreeMessageRunId(message, runs), messageId: message.id }))
        .filter((message) => message.runId),
      messageOperation: normalizedOperations
        .filter((operation) => operation.messageId)
        .map((operation) => ({ messageId: operation.messageId, operationId: operation.id })),
      operationConsumes: normalizedOperations.flatMap((operation) => {
        const consumed = asRecord(operation.summaryJson)?.consumedOperationIds;
        const consumedIds = Array.isArray(consumed)
          ? consumed.filter((value): value is string => typeof value === "string" && value.length > 0)
          : [];
        return consumedIds.map((consumedOperationId) => ({
          operationId: operation.id,
          consumedOperationId,
        }));
      }),
    };

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        meta: {
          contractVersion: "2026-04-01.v2",
          taskId: args.taskId,
          currentSessionId: selection.selectedSessionId,
          rootSessionId,
          generatedAt: new Date().toISOString(),
          incomplete: false,
        },
        task: {
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          status: task.status,
          summary: task.latestResultSummary,
          currentSessionId: selection.selectedSessionId,
          rootSessionId,
          createdAt: task.createdAt,
          updatedAt: task.lastActivityAt ?? task.createdAt,
        },
        workflow: {
          templateId: workflowTemplateId,
          currentStageKey: workflowStageKey,
          currentStageLabel: formatWorkflowStageLabel(workflowStageKey),
          status: asNonEmptyString(workflowFacts.workflowRun?.status) ?? task.status,
          approvalState:
            asNonEmptyString(currentStageRun?.approvalState) ?? inferWorkflowApprovalState(task.status),
          workflowRun: workflowFacts.workflowRun,
          stages: workflowFacts.stages,
          roleConclusions: workflowFacts.roleConclusions,
        },
        parallelGroups,
        sessions: scopedSessions,
        runs,
        messages,
        messageParts,
        operations: normalizedOperations,
        artifacts,
        edges,
      },
    };
  }

  async function buildTaskTimelineResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    return buildTaskSessionTimelineViewResponse(args);
  }

  async function ensureTask(taskId: string) {
    return deps.loadTaskTreeBackedRecord(taskId);
  }

  async function listTaskSessions(taskId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions] = await Promise.all([
      loadTaskSnapshot(taskId),
      loadTaskSessionRecords(taskId),
    ]);
    const selectedModelBySessionId = await loadTaskSessionSelectedModelFallbacks(
      taskId,
      collectMissingTaskSessionModelIds(sessions),
    );
    const hydratedSessions = hydrateTaskSessionSelectedModels(sessions, selectedModelBySessionId);
    const latestSessionId = hydratedSessions.at(-1)?.id ?? null;
    const currentSessionId = resolveCurrentTaskSessionId(
      hydratedSessions,
      snapshot?.currentSessionId,
    );

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: hydratedSessions,
        meta: {
          readSource: "task-session-first" as const,
          currentSessionId,
          latestSessionId,
          sessionCount: hydratedSessions.length,
        },
      },
    };
  }

  async function getTaskSession(taskId: string, sessionId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions, session] = await Promise.all([
      loadTaskSnapshot(taskId),
      loadTaskSessionRecords(taskId),
      loadTaskSessionRecord(taskId, sessionId),
    ]);

    if (!session) {
      return { ok: false as const, status: 404 as const, error: "Task session not found" };
    }

    const selectedModelBySessionId = await loadTaskSessionSelectedModelFallbacks(
      taskId,
      collectMissingTaskSessionModelIds([...sessions, session]),
    );
    const hydratedSessions = hydrateTaskSessionSelectedModels(sessions, selectedModelBySessionId);
    const [hydratedSession] = hydrateTaskSessionSelectedModels([session], selectedModelBySessionId);
    const latestSessionId = hydratedSessions.at(-1)?.id ?? null;
    const currentSessionId = resolveCurrentTaskSessionId(
      hydratedSessions,
      snapshot?.currentSessionId,
    );

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: hydratedSession,
        meta: {
          readSource: "task-session-first" as const,
          lineagePath: buildTaskSessionLineagePath(hydratedSessions, sessionId),
          isCurrent: currentSessionId === sessionId,
          isLatest: latestSessionId === sessionId,
        },
      },
    };
  }

  async function listTaskSessionMessages(taskId: string, sessionId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const session = await loadTaskSessionRecord(taskId, sessionId);
    if (!session) {
      return { ok: false as const, status: 404 as const, error: "Task session not found" };
    }

    const [snapshot, rawData] = await Promise.all([
      loadTaskSnapshot(taskId),
      loadTaskSessionMessagesInternal(taskId, sessionId),
    ]);
    const data = hydrateTaskConversationShellMessages({
      messages: rawData,
      promptText: session.parentSessionId ? null : task.prompt,
      task,
      snapshot,
    });
    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-first" as const,
          sessionId,
          messageCount: data.length,
        },
      },
    };
  }

  async function buildTaskConversationMessagesResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    const task = await ensureTask(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions] = await Promise.all([
      loadTaskSnapshot(args.taskId),
      loadTaskSessionRecords(args.taskId),
    ]);
    const selection = resolveTaskSessionSelection({
      sessions,
      currentSessionId: snapshot?.currentSessionId,
      requestedSessionId: args.sessionId,
      includeLineage: args.includeLineage,
    });
    if (!selection.ok) {
      return selection;
    }

    const isTaskWideConversation = !args.sessionId && args.includeLineage;
    const sessionScopeIds = isTaskWideConversation
      ? sessions.map((session) => session.id)
      : selection.lineagePath;
    const sessionsById = new Map(sessions.map((session) => [session.id, session] as const));
    const scopeRecords = sessionScopeIds
      .map((sessionId) => sessionsById.get(sessionId))
      .filter((session): session is (typeof sessions)[number] => Boolean(session));
    const currentSessionRecordId =
      resolveCurrentTaskSessionId(sessions, snapshot?.currentSessionId) ??
      selection.selectedSessionId ??
      scopeRecords.at(-1)?.id ??
      null;
    const messageSets = await Promise.all(
      scopeRecords.map((record) => loadTaskSessionMessagesInternal(args.taskId, record.id)),
    );
    const normalizedMessageSets = isTaskWideConversation
      ? messageSets.map((messages, index) =>
          hydrateTaskConversationShellMessages({
            messages,
            promptText: scopeRecords[index]?.parentSessionId ? null : task.prompt,
            task,
            snapshot: scopeRecords[index]?.id === currentSessionRecordId ? snapshot : null,
          }),
        )
      : messageSets;
    const rawMessages = isTaskWideConversation
      ? sortTaskSessionMessageRecordsChronologically(normalizedMessageSets.flat(), sessionScopeIds)
      : normalizedMessageSets.flatMap((messages, index) =>
          sliceTaskSessionMessagesForLineageBoundary(messages, scopeRecords[index + 1]),
        );
    const dedupedMessages = dedupeTaskSessionMessageRecords(rawMessages);
    const data = isTaskWideConversation
      ? dedupedMessages
      : hydrateTaskConversationShellMessages({
          messages: dedupedMessages,
          promptText: scopeRecords.some((record) => record.parentSessionId == null)
            ? task.prompt
            : null,
          task,
          snapshot,
        });
    const hasSelectedSession = Boolean(selection.selectedSessionId);

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-first" as const,
          sessionId: selection.selectedSessionId,
          includeLineage: args.includeLineage,
          lineagePath: sessionScopeIds,
          cachedSessionCount: scopeRecords.length,
          cacheState: hasSelectedSession ? ("complete" as const) : ("none" as const),
          complete: hasSelectedSession,
          itemCount: data.length,
          messageCount: data.length,
        },
      },
    };
  }

  async function buildTaskNormalizedConversationQueryResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    const response = await buildTaskConversationMessagesResponse(args);
    if (!response.ok) {
      return response;
    }

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: response.data.data,
        meta: {
          ...response.data.meta,
          viewType: "normalized-conversation" as const,
          querySurface: "service-direct" as const,
          debugOnly: true,
          deprecated: true,
        },
      },
    };
  }

  async function buildTaskRawMessageEventViewResponse(taskId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [events, sessions] = await Promise.all([
      loadTaskMessageEventsInternal(taskId),
      loadTaskSessionRecords(taskId),
    ]);
    const canonicalSessionIdByRuntimeId = new Map(
      sessions
        .filter(
          (session): session is (typeof sessions)[number] & { runtimeSessionId: string } =>
            typeof session.runtimeSessionId === "string" && session.runtimeSessionId.length > 0,
        )
        .map((session) => [session.runtimeSessionId, session.id] as const),
    );
    const data = events.map((event) => ({
      id: event.id,
      taskId: event.taskId,
      runtimeSessionId: event.sessionId,
      canonicalSessionId: canonicalSessionIdByRuntimeId.get(event.sessionId) ?? null,
      eventType: event.eventType,
      runtimeMessageId: event.runtimeMessageId,
      payload: event.payload,
      projected: event.projected,
      createdAt: event.createdAt,
    }));

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-event-log" as const,
          viewType: "raw-message-events" as const,
          querySurface: "service-direct" as const,
          debugOnly: true,
          deprecated: true,
          taskId,
          eventCount: data.length,
          projectedCount: data.filter((event) => event.projected).length,
          unprojectedCount: data.filter((event) => !event.projected).length,
          sessionCount: sessions.length,
        },
      },
    };
  }

  async function listTaskSessionOperations(taskId: string, sessionId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const session = await loadTaskSessionRecord(taskId, sessionId);
    if (!session) {
      return { ok: false as const, status: 404 as const, error: "Task session not found" };
    }

    const data = await loadTaskSessionOperationsInternal(taskId, sessionId);
    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-first" as const,
          sessionId,
          operationCount: data.length,
        },
      },
    };
  }

  async function listTaskSessionArtifacts(taskId: string, sessionId: string) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const session = await loadTaskSessionRecord(taskId, sessionId);
    if (!session) {
      return { ok: false as const, status: 404 as const, error: "Task session not found" };
    }

    const data = await loadTaskSessionArtifactsInternal(taskId, sessionId);
    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-first" as const,
          sessionId,
          artifactCount: data.length,
        },
      },
    };
  }

  async function listTaskUsageLedgerEntries(taskId: string, sessionId?: string | null) {
    const task = await ensureTask(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    if (sessionId) {
      const session = await loadTaskSessionRecord(taskId, sessionId);
      if (!session) {
        return { ok: false as const, status: 404 as const, error: "Task session not found" };
      }
    }

    const data = await loadTaskUsageLedgerEntriesInternal(taskId, sessionId);
    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-first" as const,
          sessionId: sessionId ?? null,
          entryCount: data.length,
        },
      },
    };
  }

  async function buildTaskSessionTimelineViewResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    const task = await ensureTask(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions] = await Promise.all([
      loadTaskSnapshot(args.taskId),
      loadTaskSessionRecords(args.taskId),
    ]);
    const selection = resolveTaskSessionSelection({
      sessions,
      currentSessionId: snapshot?.currentSessionId,
      requestedSessionId: args.sessionId,
      includeLineage: args.includeLineage,
    });
    if (!selection.ok) {
      return selection;
    }

    const filters = [eq(taskTimelineViews.taskId, args.taskId)];
    if (selection.lineagePath.length > 0) {
      filters.push(inArray(taskTimelineViews.sessionId, buildTaskSessionAliasPath(selection.lineagePath)));
    }

    const data = await db
      .select({
        id: taskTimelineViews.id,
        taskId: taskTimelineViews.taskId,
        projectId: taskTimelineViews.projectId,
        sessionId: taskTimelineViews.sessionId,
        messageId: taskTimelineViews.messageId,
        operationId: taskTimelineViews.operationId,
        artifactId: taskTimelineViews.artifactId,
        itemKind: taskTimelineViews.itemKind,
        itemRole: taskTimelineViews.itemRole,
        title: taskTimelineViews.title,
        displayText: taskTimelineViews.displayText,
        metadataJson: taskTimelineViews.metadataJson,
        sortAt: taskTimelineViews.sortAt,
        createdAt: taskTimelineViews.createdAt,
        updatedAt: taskTimelineViews.updatedAt,
      })
      .from(taskTimelineViews)
      .where(and(...filters))
      .orderBy(asc(taskTimelineViews.sortAt), asc(taskTimelineViews.createdAt));

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data,
        meta: {
          readSource: "task-session-projection" as const,
          sessionId: selection.selectedSessionId,
          includeLineage: args.includeLineage,
          lineagePath: selection.lineagePath,
          itemCount: data.length,
          complete: data.length > 0,
        },
      },
    };
  }

  async function buildTaskExecutionTraceResponse(args: {
    taskId: string;
    sessionId?: string | null;
    includeLineage: boolean;
  }) {
    const task = await ensureTask(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const [snapshot, sessions] = await Promise.all([
      loadTaskSnapshot(args.taskId),
      loadTaskSessionRecords(args.taskId),
    ]);
    const selection = resolveTaskSessionSelection({
      sessions,
      currentSessionId: snapshot?.currentSessionId,
      requestedSessionId: args.sessionId,
      includeLineage: args.includeLineage,
    });
    if (!selection.ok) {
      return selection;
    }

    const selectedSessionId = selection.selectedSessionId;

    const selectedSession = selectedSessionId
      ? sessions.find((session) => session.id === selectedSessionId) ?? null
      : null;
    const [timeline, messages, operations, artifacts, usageLedger] = await Promise.all([
      buildTaskSessionTimelineViewResponse({
        taskId: args.taskId,
        sessionId: selectedSessionId,
        includeLineage: args.includeLineage,
      }),
      selectedSessionId
        ? loadTaskSessionMessagesInternal(args.taskId, selectedSessionId)
        : Promise.resolve([]),
      selectedSessionId
        ? loadTaskSessionOperationsInternal(args.taskId, selectedSessionId)
        : Promise.resolve([]),
      selectedSessionId
        ? loadTaskSessionArtifactsInternal(args.taskId, selectedSessionId)
        : Promise.resolve([]),
      loadTaskUsageLedgerEntriesInternal(args.taskId, selectedSessionId),
    ]);

    if (!timeline.ok) {
      return timeline;
    }

    const hydratedMessages = hydrateTaskConversationShellMessages({
      messages,
      promptText: selectedSession?.parentSessionId ? null : task.prompt,
      task,
      snapshot,
    });

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: {
          snapshot: snapshot ?? null,
          sessions,
          selectedSessionId,
          selectedSession,
          timeline: timeline.data.data,
          messages: hydratedMessages,
          operations,
          artifacts,
          usageLedger,
        },
        meta: {
          readSource: "task-session-first" as const,
          timelineReadSource: timeline.data.meta.readSource,
          includeLineage: args.includeLineage,
          lineagePath: timeline.data.meta.lineagePath,
          complete: Boolean(snapshot || sessions.length > 0),
          sessionCount: sessions.length,
          timelineItemCount: timeline.data.meta.itemCount,
        },
      },
    };
  }

  async function adoptTaskSessionWinner(args: {
    taskId: string;
    coordinationKey: string;
    winnerSessionId: string;
  }) {
    const task = await ensureTask(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const winnerSession = await loadTaskSessionRecord(args.taskId, args.winnerSessionId);
    if (!winnerSession) {
      return { ok: false as const, status: 404 as const, error: "Task session not found" };
    }

    if (winnerSession.coordinationKey !== args.coordinationKey) {
      return {
        ok: false as const,
        status: 400 as const,
        error: "winnerSessionId does not belong to the provided coordinationKey",
      };
    }

    const groupSessions = (await loadTaskSessionRecords(args.taskId)).filter(
      (session) => session.coordinationKey === args.coordinationKey,
    );
    if (groupSessions.length === 0) {
      return {
        ok: false as const,
        status: 404 as const,
        error: "Task session coordination group not found",
      };
    }

    const now = new Date().toISOString();

    await db
      .update(taskSessions)
      .set({
        winnerSessionId: winnerSession.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(taskSessions.taskId, args.taskId),
          eq(taskSessions.coordinationKey, args.coordinationKey),
        ),
      );

    await db
      .update(taskSnapshots)
      .set({
        currentSessionId: winnerSession.id,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(taskSnapshots.taskId, args.taskId));

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        taskId: args.taskId,
        coordinationKey: args.coordinationKey,
        winnerSessionId: winnerSession.id,
      },
    };
  }

  return {
    listTaskSessions,
    getTaskSession,
    buildTaskTreeResponse,
    buildTaskTimelineResponse,
    listTaskSessionMessages,
    buildTaskConversationMessagesResponse,
    buildTaskNormalizedConversationQueryResponse,
    buildTaskRawMessageEventViewResponse,
    listTaskSessionOperations,
    listTaskSessionArtifacts,
    listTaskUsageLedgerEntries,
    buildTaskSessionTimelineViewResponse,
    buildTaskExecutionTraceResponse,
    adoptTaskSessionWinner,
  };
}
