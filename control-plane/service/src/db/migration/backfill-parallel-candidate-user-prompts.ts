#!/usr/bin/env bun

import { getBooleanArg, parseCliArgs } from "./metadata";

type DbModule = typeof import("../index");

let dbModulePromise: Promise<DbModule> | null = null;

async function loadDbModule() {
  if (!dbModulePromise) {
    dbModulePromise = import("../index");
  }

  return dbModulePromise;
}

type SqlUnsafe = <TRow = Record<string, unknown>>(
  query: string,
  parameters?: readonly never[],
) => Promise<TRow[]>;

type SqlExecutor = {
  unsafe: SqlUnsafe;
};

function asSqlExecutor(transaction: unknown): SqlExecutor {
  return transaction as SqlExecutor;
}

type MessageRow = {
  messageId: string;
  sessionId: string;
  taskId: string;
  projectId: string;
  runtimeMessageId: string | null;
  role: string;
  status: string | null;
  clientMessageId: string | null;
  providerMessageId: string | null;
  messageIndex: number;
  textContent: string | null;
  summaryText: string | null;
  rawPayload: Record<string, unknown> | null;
  tokenUsed: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
};

type CandidateUserMessageRow = MessageRow & {
  childSessionId: string;
  parentSessionId: string;
  candidateIndex: number | null;
};

type MessagePartRow = {
  id: string;
  messageId: string;
  partIndex: number;
  partType: string;
  textContent: string | null;
  jsonPayload: Record<string, unknown> | null;
  createdAt: string;
};

type CanonicalMessagePlan = {
  messageId: string;
  sessionId: string;
  taskId: string;
  projectId: string;
  runtimeMessageId: string | null;
  role: string;
  status: string | null;
  clientMessageId: string | null;
  providerMessageId: string | null;
  messageIndex: number;
  textContent: string | null;
  summaryText: string | null;
  rawPayload: Record<string, unknown>;
  tokenUsed: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
};

type RepairPlan = {
  action: "reuse-parent" | "create-parent";
  taskId: string;
  projectId: string;
  childSessionId: string;
  parentSessionId: string;
  childMessageId: string;
  canonicalMessageId: string;
  hydrateCanonical: boolean;
  childPromptText: string;
  canonicalMessage: CanonicalMessagePlan;
};

type BackfillSummary = {
  taskId: string | null;
  projectId: string | null;
  all: boolean;
  dryRun: boolean;
  windowMs: number;
  candidateUserMessageCount: number;
  repairPlanCount: number;
  canonicalParentCreatedCount: number;
  canonicalParentReusedCount: number;
  canonicalParentHydratedCount: number;
  childMessageDeletedCount: number;
  artifactRefsUpdatedCount: number;
  usageRefsUpdatedCount: number;
  timelineRowsDeletedCount: number;
  affectedTaskIds: string[];
};

function getOptionalStringArg(args: Record<string, string | boolean>, key: string) {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getNumberArg(args: Record<string, string | boolean>, key: string, defaultValue: number) {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid --${key} value: ${value}`);
  }

  return Math.trunc(parsed);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function extractMessageText(message: {
  textContent?: string | null;
  summaryText?: string | null;
  rawPayload?: Record<string, unknown> | null;
}) {
  const directCandidates = [message.textContent, message.summaryText];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  const rawPayload = asRecord(message.rawPayload);
  if (!rawPayload) {
    return null;
  }

  const rawCandidates = [
    rawPayload.text,
    rawPayload.textContent,
    rawPayload.summaryText,
    rawPayload.content,
  ];
  for (const candidate of rawCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  const parts = Array.isArray(rawPayload.parts)
    ? rawPayload.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
  for (const part of parts) {
    const text = asString(part.text) ?? asString(part.content);
    if (text) {
      return text;
    }
  }

  return null;
}

function countMessageParts(message: {
  rawPayload?: Record<string, unknown> | null;
}) {
  const rawPayload = asRecord(message.rawPayload);
  return Array.isArray(rawPayload?.parts) ? rawPayload.parts.length : 0;
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function roleSortWeight(role: string) {
  if (role === "user") return 0;
  if (role === "assistant") return 1;
  if (role === "tool") return 2;
  if (role === "system") return 3;
  return 4;
}

function normalizeCanonicalMessageStatus(value: string | null | undefined) {
  if (
    value === "streaming" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return "completed" as const;
}

function mapCanonicalMessageKind(role: string) {
  if (role === "user") {
    return "prompt" as const;
  }
  if (role === "assistant") {
    return "reply" as const;
  }
  if (role === "tool") {
    return "tool_echo" as const;
  }

  return "note" as const;
}

function sortSessionMessages(left: MessageRow, right: MessageRow) {
  return left.messageIndex - right.messageIndex;
}

function isRecentSamePrompt(
  existingCreatedAt: string,
  incomingCreatedAt: string,
  windowMs: number,
) {
  const existingTime = parseTimestamp(existingCreatedAt);
  const incomingTime = parseTimestamp(incomingCreatedAt);
  if (existingTime === null || incomingTime === null) {
    return false;
  }

  return Math.abs(existingTime - incomingTime) <= windowMs;
}

function shouldHydrateCanonical(existing: MessageRow, incoming: CandidateUserMessageRow) {
  const existingText = extractMessageText(existing) ?? "";
  const incomingText = extractMessageText(incoming) ?? "";
  if (incomingText.length > existingText.length) {
    return true;
  }

  return countMessageParts(incoming) > countMessageParts(existing);
}

function buildTaskSessionMessageId(sessionId: string, runtimeMessageId: string) {
  return `task-session-message:${sessionId}:${runtimeMessageId}`;
}

function buildTaskTimelineMessageId(messageId: string) {
  return `task-timeline:message:${messageId}`;
}

function normalizePromptText(message: {
  textContent?: string | null;
  summaryText?: string | null;
  rawPayload?: Record<string, unknown> | null;
}) {
  const text = extractMessageText(message);
  return text ? text.trim() : null;
}

function buildCanonicalComparisonKey(text: string) {
  return text.trim();
}

function buildCanonicalMessagePlan(args: {
  candidate: CandidateUserMessageRow;
  parentSessionId: string;
  messageId: string;
  messageIndex: number;
}) {
  return {
    messageId: args.messageId,
    sessionId: args.parentSessionId,
    taskId: args.candidate.taskId,
    projectId: args.candidate.projectId,
    runtimeMessageId: args.candidate.runtimeMessageId,
    role: args.candidate.role,
    status: args.candidate.status,
    clientMessageId: args.candidate.clientMessageId,
    providerMessageId: args.candidate.providerMessageId,
    messageIndex: args.messageIndex,
    textContent: args.candidate.textContent,
    summaryText: args.candidate.summaryText,
    rawPayload: args.candidate.rawPayload ?? {},
    tokenUsed: args.candidate.tokenUsed,
    startedAt: args.candidate.startedAt,
    completedAt: args.candidate.completedAt,
    errorText: args.candidate.errorText,
    createdAt: args.candidate.createdAt,
    updatedAt: args.candidate.updatedAt,
  } satisfies CanonicalMessagePlan;
}

function findCanonicalParentMessage(args: {
  parentMessages: MessageRow[];
  promptText: string;
  createdAt: string;
  windowMs: number;
}) {
  return args.parentMessages
    .filter((message) => message.role === "user")
    .filter((message) => normalizePromptText(message) === args.promptText)
    .filter((message) => isRecentSamePrompt(message.createdAt, args.createdAt, args.windowMs))
    .sort((left, right) => {
      const leftTime = parseTimestamp(left.createdAt) ?? 0;
      const rightTime = parseTimestamp(right.createdAt) ?? 0;
      return (
        Math.abs(leftTime - (parseTimestamp(args.createdAt) ?? 0)) -
        Math.abs(rightTime - (parseTimestamp(args.createdAt) ?? 0))
      );
    })[0];
}

function resolveInsertionMessageIndex(
  parentMessages: MessageRow[],
  candidate: CandidateUserMessageRow,
) {
  const candidateCreatedAt = parseTimestamp(candidate.createdAt);
  const target = parentMessages.find((message) => {
    const messageCreatedAt = parseTimestamp(message.createdAt);
    if (candidateCreatedAt !== null && messageCreatedAt !== null) {
      if (messageCreatedAt > candidateCreatedAt) {
        return true;
      }
      if (messageCreatedAt < candidateCreatedAt) {
        return false;
      }
    }

    return roleSortWeight(message.role) > roleSortWeight(candidate.role);
  });

  if (target) {
    return target.messageIndex;
  }

  const maxIndex = parentMessages.reduce((currentMax, message) => {
    return Math.max(currentMax, message.messageIndex);
  }, -1);
  return maxIndex + 1;
}

function chooseCanonicalMessageId(args: {
  parentSessionId: string;
  candidate: CandidateUserMessageRow;
  parentMessages: MessageRow[];
}) {
  const takenIds = new Set(args.parentMessages.map((message) => message.messageId));
  const runtimeMessageId =
    args.candidate.runtimeMessageId ?? `backfill:${args.candidate.messageId}`;
  const preferredId = buildTaskSessionMessageId(args.parentSessionId, runtimeMessageId);
  if (!takenIds.has(preferredId)) {
    return preferredId;
  }

  return buildTaskSessionMessageId(args.parentSessionId, `backfill:${args.candidate.messageId}`);
}

function updateParentMessageCache(
  parentMessagesBySessionId: Map<string, MessageRow[]>,
  canonicalMessage: CanonicalMessagePlan,
) {
  const current = parentMessagesBySessionId.get(canonicalMessage.sessionId) ?? [];
  for (const message of current) {
    if (message.messageIndex >= canonicalMessage.messageIndex) {
      message.messageIndex += 1;
    }
  }

  current.push({
    messageId: canonicalMessage.messageId,
    sessionId: canonicalMessage.sessionId,
    taskId: canonicalMessage.taskId,
    projectId: canonicalMessage.projectId,
    runtimeMessageId: canonicalMessage.runtimeMessageId,
    role: canonicalMessage.role,
    status: canonicalMessage.status,
    clientMessageId: canonicalMessage.clientMessageId,
    providerMessageId: canonicalMessage.providerMessageId,
    messageIndex: canonicalMessage.messageIndex,
    textContent: canonicalMessage.textContent,
    summaryText: canonicalMessage.summaryText,
    rawPayload: canonicalMessage.rawPayload,
    tokenUsed: canonicalMessage.tokenUsed,
    startedAt: canonicalMessage.startedAt,
    completedAt: canonicalMessage.completedAt,
    errorText: canonicalMessage.errorText,
    createdAt: canonicalMessage.createdAt,
    updatedAt: canonicalMessage.updatedAt,
  });
  current.sort(sortSessionMessages);
  parentMessagesBySessionId.set(canonicalMessage.sessionId, current);
}

function hydrateParentMessageCache(
  parentMessagesBySessionId: Map<string, MessageRow[]>,
  plan: RepairPlan,
) {
  const current = parentMessagesBySessionId.get(plan.parentSessionId) ?? [];
  const target = current.find((message) => message.messageId === plan.canonicalMessageId);
  if (!target) {
    return;
  }

  target.textContent = plan.canonicalMessage.textContent;
  target.summaryText = plan.canonicalMessage.summaryText;
  target.rawPayload = plan.canonicalMessage.rawPayload;
  target.status = plan.canonicalMessage.status;
  target.clientMessageId = plan.canonicalMessage.clientMessageId;
  target.providerMessageId = plan.canonicalMessage.providerMessageId;
  target.tokenUsed = plan.canonicalMessage.tokenUsed;
  target.startedAt = plan.canonicalMessage.startedAt;
  target.completedAt = plan.canonicalMessage.completedAt;
  target.errorText = plan.canonicalMessage.errorText;
  target.updatedAt = plan.canonicalMessage.updatedAt;
}

async function loadCandidateUserMessages(args: {
  taskId?: string;
  projectId?: string;
  all: boolean;
}) {
  const clauses = [
    "sessions.session_kind = 'candidate'",
    "sessions.parent_session_id is not null",
    "messages.role = 'user'",
  ];
  const params: unknown[] = [];

  if (args.taskId) {
    params.push(args.taskId);
    clauses.push(`messages.task_id = $${params.length}`);
  }

  if (args.projectId) {
    params.push(args.projectId);
    clauses.push(`task.project_id = $${params.length}`);
  }

  if (!args.all && !args.taskId && !args.projectId) {
    throw new Error("Provide --task-id, --project-id, or --all.");
  }

  const { postgresSql } = await loadDbModule();
  return postgresSql.unsafe<CandidateUserMessageRow[]>(
    `
      select
        messages.id as "messageId",
        messages.session_id as "sessionId",
        messages.task_id as "taskId",
        task.project_id as "projectId",
        messages.runtime_message_id as "runtimeMessageId",
        messages.role,
        messages.status,
        messages.client_message_id as "clientMessageId",
        messages.provider_message_id as "providerMessageId",
        messages.seq as "messageIndex",
        messages.text_content as "textContent",
        messages.text_preview as "summaryText",
        messages.raw_payload as "rawPayload",
        messages.token_used as "tokenUsed",
        messages.started_at as "startedAt",
        messages.completed_at as "completedAt",
        messages.error_text as "errorText",
        messages.created_at as "createdAt",
        messages.updated_at as "updatedAt",
        sessions.id as "childSessionId",
        sessions.parent_session_id as "parentSessionId",
        sessions.candidate_index as "candidateIndex"
      from task_messages messages
      join task_sessions sessions on sessions.id = messages.session_id
      join tasks task on task.id = messages.task_id
      where ${clauses.join(" and ")}
      order by messages.task_id asc, sessions.parent_session_id asc, messages.created_at asc, sessions.candidate_index asc nulls last, messages.seq asc
    `,
    params as never[],
  );
}

async function loadParentSessionMessages(parentSessionIds: string[]) {
  if (parentSessionIds.length === 0) {
    return [] as MessageRow[];
  }

  const { postgresSql } = await loadDbModule();
  return postgresSql.unsafe<MessageRow[]>(
    `
      select
        messages.id as "messageId",
        messages.session_id as "sessionId",
        messages.task_id as "taskId",
        task.project_id as "projectId",
        messages.runtime_message_id as "runtimeMessageId",
        messages.role,
        messages.status,
        messages.client_message_id as "clientMessageId",
        messages.provider_message_id as "providerMessageId",
        messages.seq as "messageIndex",
        messages.text_content as "textContent",
        messages.text_preview as "summaryText",
        messages.raw_payload as "rawPayload",
        messages.token_used as "tokenUsed",
        messages.started_at as "startedAt",
        messages.completed_at as "completedAt",
        messages.error_text as "errorText",
        messages.created_at as "createdAt",
        messages.updated_at as "updatedAt"
      from task_messages messages
      join tasks task on task.id = messages.task_id
      where messages.session_id = any($1::text[])
      order by messages.session_id asc, messages.seq asc
    `,
    [parentSessionIds] as never[],
  );
}

async function loadMessageParts(messageIds: string[]) {
  if (messageIds.length === 0) {
    return [] as MessagePartRow[];
  }

  const { postgresSql } = await loadDbModule();
  return postgresSql.unsafe<MessagePartRow[]>(
    `
      select
        id,
        message_id as "messageId",
        part_index as "partIndex",
        part_type as "partType",
        text_content as "textContent",
        json_payload as "jsonPayload",
        created_at as "createdAt"
      from task_message_parts
      where message_id = any($1::text[])
      order by message_id asc, part_index asc
    `,
    [messageIds] as never[],
  );
}

function buildRepairPlans(args: {
  candidateMessages: CandidateUserMessageRow[];
  parentMessages: MessageRow[];
  windowMs: number;
}) {
  const parentMessagesBySessionId = new Map<string, MessageRow[]>();
  for (const message of args.parentMessages) {
    const current = parentMessagesBySessionId.get(message.sessionId) ?? [];
    current.push(message);
    current.sort(sortSessionMessages);
    parentMessagesBySessionId.set(message.sessionId, current);
  }

  const plans: RepairPlan[] = [];

  for (const candidate of args.candidateMessages) {
    const promptText = normalizePromptText(candidate);
    if (!promptText) {
      continue;
    }

    const parentMessages = parentMessagesBySessionId.get(candidate.parentSessionId) ?? [];
    const existingCanonical = findCanonicalParentMessage({
      parentMessages,
      promptText: buildCanonicalComparisonKey(promptText),
      createdAt: candidate.createdAt,
      windowMs: args.windowMs,
    });

    if (existingCanonical) {
      const hydrateCanonical = shouldHydrateCanonical(existingCanonical, candidate);
      const canonicalMessage: CanonicalMessagePlan = {
        messageId: existingCanonical.messageId,
        sessionId: existingCanonical.sessionId,
        taskId: existingCanonical.taskId,
        projectId: existingCanonical.projectId,
        runtimeMessageId: existingCanonical.runtimeMessageId,
        role: existingCanonical.role,
        status: hydrateCanonical ? candidate.status : existingCanonical.status,
        clientMessageId: hydrateCanonical
          ? candidate.clientMessageId
          : existingCanonical.clientMessageId,
        providerMessageId: hydrateCanonical
          ? candidate.providerMessageId
          : existingCanonical.providerMessageId,
        messageIndex: existingCanonical.messageIndex,
        textContent: hydrateCanonical ? candidate.textContent : existingCanonical.textContent,
        summaryText: hydrateCanonical ? candidate.summaryText : existingCanonical.summaryText,
        rawPayload: hydrateCanonical
          ? (candidate.rawPayload ?? {})
          : (existingCanonical.rawPayload ?? {}),
        tokenUsed: hydrateCanonical ? candidate.tokenUsed : existingCanonical.tokenUsed,
        startedAt: hydrateCanonical ? candidate.startedAt : existingCanonical.startedAt,
        completedAt: hydrateCanonical ? candidate.completedAt : existingCanonical.completedAt,
        errorText: hydrateCanonical ? candidate.errorText : existingCanonical.errorText,
        createdAt: existingCanonical.createdAt,
        updatedAt: hydrateCanonical ? candidate.updatedAt : existingCanonical.updatedAt,
      };

      plans.push({
        action: "reuse-parent",
        taskId: candidate.taskId,
        projectId: candidate.projectId,
        childSessionId: candidate.childSessionId,
        parentSessionId: candidate.parentSessionId,
        childMessageId: candidate.messageId,
        canonicalMessageId: existingCanonical.messageId,
        hydrateCanonical,
        childPromptText: promptText,
        canonicalMessage,
      });

      if (hydrateCanonical) {
        const latestPlan = plans.at(-1);
        if (latestPlan) {
          hydrateParentMessageCache(parentMessagesBySessionId, latestPlan);
        }
      }
      continue;
    }

    const messageIndex = resolveInsertionMessageIndex(parentMessages, candidate);
    const messageId = chooseCanonicalMessageId({
      parentSessionId: candidate.parentSessionId,
      candidate,
      parentMessages,
    });
    const canonicalMessage = buildCanonicalMessagePlan({
      candidate,
      parentSessionId: candidate.parentSessionId,
      messageId,
      messageIndex,
    });

    plans.push({
      action: "create-parent",
      taskId: candidate.taskId,
      projectId: candidate.projectId,
      childSessionId: candidate.childSessionId,
      parentSessionId: candidate.parentSessionId,
      childMessageId: candidate.messageId,
      canonicalMessageId: messageId,
      hydrateCanonical: false,
      childPromptText: promptText,
      canonicalMessage,
    });
    updateParentMessageCache(parentMessagesBySessionId, canonicalMessage);
  }

  return plans;
}

async function shiftParentMessageIndexes(
  transaction: SqlExecutor,
  parentSessionId: string,
  fromMessageIndex: number,
) {
  await transaction.unsafe(
    `
      update task_messages
      set seq = seq + 1000000,
          updated_at = current_timestamp
      where session_id = $1
        and seq >= $2
    `,
    [parentSessionId, fromMessageIndex] as never[],
  );

  await transaction.unsafe(
    `
      update task_messages
      set seq = seq - 999999,
          updated_at = current_timestamp
      where session_id = $1
        and seq >= $2
    `,
    [parentSessionId, fromMessageIndex + 1000000] as never[],
  );
}

async function insertCanonicalMessage(transaction: SqlExecutor, message: CanonicalMessagePlan) {
  await transaction.unsafe(
    `
      insert into task_messages (
        id,
        task_id,
        session_id,
        created_by_run_id,
        role,
        message_kind,
        parent_message_id,
        reply_to_message_id,
        runtime_message_id,
        client_message_id,
        provider_message_id,
        seq,
        text_content,
        text_preview,
        raw_payload,
        part_count,
        token_used,
        status,
        error_text,
        started_at,
        created_at,
        updated_at,
        completed_at,
      )
      values (
        $1, $2, $3, null, $4, $5, null, null, $6, $7,
        $8, $9, $10, $11, $12::jsonb, 0, $13, $14, $15, $16,
        $17, $18, $19
      )
    `,
    [
      message.messageId,
      message.taskId,
      message.sessionId,
      message.role,
      mapCanonicalMessageKind(message.role),
      message.runtimeMessageId,
      message.clientMessageId,
      message.providerMessageId,
      message.messageIndex,
      message.textContent,
      message.summaryText,
      JSON.stringify(message.rawPayload ?? {}),
      message.tokenUsed ?? 0,
      normalizeCanonicalMessageStatus(message.status),
      message.errorText,
      message.startedAt,
      message.createdAt,
      message.updatedAt,
      message.completedAt,
    ] as never[],
  );
}

async function updateCanonicalMessage(transaction: SqlExecutor, message: CanonicalMessagePlan) {
  await transaction.unsafe(
    `
      update task_messages
      set status = $2,
          client_message_id = $3,
          provider_message_id = $4,
          text_content = $5,
          text_preview = $6,
          raw_payload = $7::jsonb,
          token_used = $8,
          started_at = $9,
          completed_at = $10,
          error_text = $11,
          updated_at = $12
      where id = $1
    `,
    [
      message.messageId,
      normalizeCanonicalMessageStatus(message.status),
      message.clientMessageId,
      message.providerMessageId,
      message.textContent,
      message.summaryText,
      JSON.stringify(message.rawPayload ?? {}),
      message.tokenUsed ?? 0,
      message.startedAt,
      message.completedAt,
      message.errorText,
      message.updatedAt,
    ] as never[],
  );
}

async function replaceCanonicalParts(args: {
  transaction: SqlExecutor;
  canonicalMessageId: string;
  childParts: MessagePartRow[];
}) {
  await args.transaction.unsafe("delete from task_message_parts where message_id = $1", [
    args.canonicalMessageId,
  ] as never[]);

  for (const part of args.childParts) {
    await args.transaction.unsafe(
      `
        insert into task_message_parts (
          id,
          message_id,
          part_index,
          part_type,
          text_content,
          json_payload,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7)
      `,
      [
        `${args.canonicalMessageId}:${part.partIndex}`,
        args.canonicalMessageId,
        part.partIndex,
        part.partType,
        part.textContent,
        JSON.stringify(part.jsonPayload ?? {}),
        part.createdAt,
      ] as never[],
    );
  }
}

async function insertCanonicalParts(args: {
  transaction: SqlExecutor;
  canonicalMessageId: string;
  childParts: MessagePartRow[];
}) {
  for (const part of args.childParts) {
    await args.transaction.unsafe(
      `
        insert into task_message_parts (
          id,
          message_id,
          part_index,
          part_type,
          text_content,
          json_payload,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7)
      `,
      [
        `${args.canonicalMessageId}:${part.partIndex}`,
        args.canonicalMessageId,
        part.partIndex,
        part.partType,
        part.textContent,
        JSON.stringify(part.jsonPayload ?? {}),
        part.createdAt,
      ] as never[],
    );
  }
}

async function syncCanonicalMessagePartCount(transaction: SqlExecutor, canonicalMessageId: string) {
  await transaction.unsafe(
    `
      update task_messages
      set part_count = (
        select count(*)::integer
        from task_message_parts
        where message_id = $1
      )
      where id = $1
    `,
    [canonicalMessageId] as never[],
  );
}

async function ensureCanonicalTimelineRow(transaction: SqlExecutor, message: CanonicalMessagePlan) {
  await transaction.unsafe(
    `
      insert into task_timeline_views (
        id,
        project_id,
        task_id,
        session_id,
        message_id,
        operation_id,
        artifact_id,
        item_kind,
        item_role,
        title,
        display_text,
        metadata_json,
        sort_at,
        created_at,
        updated_at
      )
      values (
        $1, $2, $3, $4, $5, null, null,
        'message', $6, null, $7, $8::jsonb, $9, $10, $11
      )
      on conflict (id) do update
      set session_id = excluded.session_id,
          message_id = excluded.message_id,
          item_kind = excluded.item_kind,
          item_role = excluded.item_role,
          display_text = excluded.display_text,
          metadata_json = excluded.metadata_json,
          sort_at = excluded.sort_at,
          updated_at = excluded.updated_at
    `,
    [
      buildTaskTimelineMessageId(message.messageId),
      message.projectId,
      message.taskId,
      message.sessionId,
      message.messageId,
      message.role,
      extractMessageText(message) ?? message.textContent,
      JSON.stringify({
        runtimeMessageId: message.runtimeMessageId,
        role: message.role,
      }),
      message.completedAt ?? message.createdAt,
      message.createdAt,
      message.updatedAt,
    ] as never[],
  );
}

async function updateMessageReferences(args: {
  transaction: SqlExecutor;
  childMessageId: string;
  canonicalMessageId: string;
  parentSessionId: string;
}) {
  const artifactRows = await args.transaction.unsafe<Array<{ id: string }>>(
    `
      update task_artifacts
      set message_id = $2,
          session_id = $3,
          updated_at = current_timestamp
      where message_id = $1
      returning id
    `,
    [args.childMessageId, args.canonicalMessageId, args.parentSessionId] as never[],
  );

  const usageRows = await args.transaction.unsafe<Array<{ id: string }>>(
    `
      update task_usage_ledger_entries
      set message_id = $2,
          session_id = $3
      where message_id = $1
      returning id
    `,
    [args.childMessageId, args.canonicalMessageId, args.parentSessionId] as never[],
  );

  await args.transaction.unsafe(
    `
      update task_operations
      set message_id = $2,
          session_id = $3,
          updated_at = current_timestamp
      where message_id = $1
    `,
    [args.childMessageId, args.canonicalMessageId, args.parentSessionId] as never[],
  );

  return {
    artifactUpdatedCount: artifactRows.length,
    usageUpdatedCount: usageRows.length,
  };
}

async function deleteChildTimelineRows(transaction: SqlExecutor, childMessageId: string) {
  const rows = await transaction.unsafe<Array<{ id: string }>>(
    "delete from task_timeline_views where message_id = $1 returning id",
    [childMessageId] as never[],
  );
  return rows.length;
}

async function deleteChildMessage(transaction: SqlExecutor, childMessageId: string) {
  await transaction.unsafe(
    "update task_sessions set head_message_id = null, updated_at = current_timestamp where head_message_id = $1",
    [childMessageId] as never[],
  );
  await transaction.unsafe("delete from task_message_parts where message_id = $1", [
    childMessageId,
  ] as never[]);
  await transaction.unsafe("delete from task_messages where id = $1", [childMessageId] as never[]);
}

async function applyRepairPlan(args: {
  plan: RepairPlan;
  childPartsByMessageId: Map<string, MessagePartRow[]>;
  summary: BackfillSummary;
}) {
  const childParts = args.childPartsByMessageId.get(args.plan.childMessageId) ?? [];

  const { postgresSql } = await loadDbModule();
  await postgresSql.begin(async (transaction) => {
    const tx = asSqlExecutor(transaction);

    if (args.plan.action === "create-parent") {
      await shiftParentMessageIndexes(
        tx,
        args.plan.parentSessionId,
        args.plan.canonicalMessage.messageIndex,
      );
      await insertCanonicalMessage(tx, args.plan.canonicalMessage);
      await insertCanonicalParts({
        transaction: tx,
        canonicalMessageId: args.plan.canonicalMessageId,
        childParts,
      });
      await syncCanonicalMessagePartCount(tx, args.plan.canonicalMessageId);
      args.summary.canonicalParentCreatedCount += 1;
    } else {
      args.summary.canonicalParentReusedCount += 1;
      if (args.plan.hydrateCanonical) {
        await updateCanonicalMessage(tx, args.plan.canonicalMessage);
        await replaceCanonicalParts({
          transaction: tx,
          canonicalMessageId: args.plan.canonicalMessageId,
          childParts,
        });
        await syncCanonicalMessagePartCount(tx, args.plan.canonicalMessageId);
        args.summary.canonicalParentHydratedCount += 1;
      }
    }

    await ensureCanonicalTimelineRow(tx, args.plan.canonicalMessage);

    const { artifactUpdatedCount, usageUpdatedCount } = await updateMessageReferences({
      transaction: tx,
      childMessageId: args.plan.childMessageId,
      canonicalMessageId: args.plan.canonicalMessageId,
      parentSessionId: args.plan.parentSessionId,
    });
    args.summary.artifactRefsUpdatedCount += artifactUpdatedCount;
    args.summary.usageRefsUpdatedCount += usageUpdatedCount;

    args.summary.timelineRowsDeletedCount += await deleteChildTimelineRows(
      tx,
      args.plan.childMessageId,
    );
    await deleteChildMessage(tx, args.plan.childMessageId);
    args.summary.childMessageDeletedCount += 1;
  });
}

function printHelp() {
  console.log(
    "Usage: bun run src/db/migration/backfill-parallel-candidate-user-prompts.ts [--task-id <taskId> | --project-id <projectId> | --all] [--dry-run] [--window-ms <ms>]",
  );
  console.log(
    "Repairs historical duplicate user prompts persisted on parallel candidate child sessions by promoting or reusing a canonical parent-session message and deleting child duplicates.",
  );
}

function printSummary(summary: BackfillSummary) {
  console.log("Parallel candidate user prompt backfill summary");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.affectedTaskIds.length === 0) {
    console.log("No matching historical candidate prompt rows found.");
    return;
  }

  for (const taskId of summary.affectedTaskIds) {
    console.log(`- ${taskId}`);
  }
}

async function main() {
  const args = parseCliArgs();
  const help = getBooleanArg(args, "help", false);
  if (help) {
    printHelp();
    return;
  }

  const taskId = getOptionalStringArg(args, "task-id") ?? null;
  const projectId = getOptionalStringArg(args, "project-id") ?? null;
  const all = getBooleanArg(args, "all", false);
  const dryRun = getBooleanArg(args, "dry-run", false);
  const windowMs = getNumberArg(args, "window-ms", 15_000);

  if (!taskId && !projectId && !all) {
    throw new Error("Provide --task-id, --project-id, or --all.");
  }

  const candidateMessages = await loadCandidateUserMessages({
    taskId: taskId ?? undefined,
    projectId: projectId ?? undefined,
    all,
  });
  const candidateMessagesWithText = candidateMessages.filter((message) =>
    Boolean(normalizePromptText(message)),
  );
  const parentSessionIds = Array.from(
    new Set(candidateMessagesWithText.map((message) => message.parentSessionId)),
  );
  const parentMessages = await loadParentSessionMessages(parentSessionIds);
  const childParts = await loadMessageParts(
    candidateMessagesWithText.map((message) => message.messageId),
  );
  const childPartsByMessageId = new Map<string, MessagePartRow[]>();
  for (const part of childParts) {
    const current = childPartsByMessageId.get(part.messageId) ?? [];
    current.push(part);
    childPartsByMessageId.set(part.messageId, current);
  }

  const repairPlans = buildRepairPlans({
    candidateMessages: candidateMessagesWithText,
    parentMessages,
    windowMs,
  });
  const affectedTaskIds = Array.from(new Set(repairPlans.map((plan) => plan.taskId))).sort();
  const summary: BackfillSummary = {
    taskId,
    projectId,
    all,
    dryRun,
    windowMs,
    candidateUserMessageCount: candidateMessagesWithText.length,
    repairPlanCount: repairPlans.length,
    canonicalParentCreatedCount: dryRun
      ? repairPlans.filter((plan) => plan.action === "create-parent").length
      : 0,
    canonicalParentReusedCount: dryRun
      ? repairPlans.filter((plan) => plan.action === "reuse-parent").length
      : 0,
    canonicalParentHydratedCount: dryRun
      ? repairPlans.filter((plan) => plan.hydrateCanonical).length
      : 0,
    childMessageDeletedCount: dryRun ? repairPlans.length : 0,
    artifactRefsUpdatedCount: 0,
    usageRefsUpdatedCount: 0,
    timelineRowsDeletedCount: 0,
    affectedTaskIds,
  };

  if (!dryRun) {
    for (const plan of repairPlans) {
      await applyRepairPlan({
        plan,
        childPartsByMessageId,
        summary,
      });
    }
  }

  printSummary(summary);
}

try {
  await main();
} finally {
  if (dbModulePromise) {
    const { closeDatabase } = await loadDbModule();
    await closeDatabase();
  }
}
