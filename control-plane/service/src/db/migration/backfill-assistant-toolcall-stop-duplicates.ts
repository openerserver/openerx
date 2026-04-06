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

type AssistantMessageRow = {
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

type MergedMessagePlan = {
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
  action: "merge-tool-calls-stop";
  taskId: string;
  projectId: string;
  sessionId: string;
  canonicalMessageId: string;
  duplicateMessageId: string;
  mergedMessage: MergedMessagePlan;
  mergedParts: Record<string, unknown>[];
};

type BackfillSummary = {
  taskId: string | null;
  projectId: string | null;
  all: boolean;
  dryRun: boolean;
  windowMs: number;
  assistantMessageCount: number;
  repairPlanCount: number;
  canonicalMessageUpdatedCount: number;
  duplicateMessageDeletedCount: number;
  forkRefsUpdatedCount: number;
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

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
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

function extractMessageInfoRecord(message: { rawPayload?: Record<string, unknown> | null }) {
  return asRecord(message.rawPayload?.info);
}

function extractMessageParts(message: { rawPayload?: Record<string, unknown> | null }) {
  const parts = Array.isArray(message.rawPayload?.parts) ? message.rawPayload.parts : [];
  return parts.filter((part): part is Record<string, unknown> =>
    Boolean(part && typeof part === "object"),
  );
}

function extractMessagePartText(part: Record<string, unknown>) {
  if (typeof part.text === "string" && part.text.trim()) {
    return part.text;
  }
  if (typeof part.content === "string" && part.content.trim()) {
    return part.content;
  }

  return null;
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

  for (const part of extractMessageParts(message)) {
    const text = extractMessagePartText(part);
    if (text) {
      return text;
    }
  }

  return null;
}

function normalizeComparableText(value: string | null) {
  return typeof value === "string" && value.trim().length > 0
    ? value.replace(/\r\n/g, "\n").trim()
    : null;
}

function extractMessageFinishReason(message: { rawPayload?: Record<string, unknown> | null }) {
  const info = extractMessageInfoRecord(message);
  return asString(message.rawPayload?.finish) ?? asString(info?.finish);
}

function extractMessageParentId(message: { rawPayload?: Record<string, unknown> | null }) {
  const payload = asRecord(message.rawPayload);
  const info = extractMessageInfoRecord(message);
  const raw =
    payload?.parentID ??
    payload?.parentId ??
    payload?.parent_id ??
    info?.parentID ??
    info?.parentId ??
    info?.parent_id;
  return asString(raw);
}

function extractMergedRuntimeMessageIds(message: { rawPayload?: Record<string, unknown> | null }) {
  const merged = message.rawPayload?.mergedRuntimeMessageIds;
  if (!Array.isArray(merged)) {
    return [];
  }

  return merged.filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function buildMergedRuntimeMessageIds(args: {
  canonical: AssistantMessageRow;
  duplicate: AssistantMessageRow;
}) {
  const merged = new Set<string>(extractMergedRuntimeMessageIds(args.canonical));
  const canonicalInfo = extractMessageInfoRecord(args.canonical);
  const canonicalInfoId = asString(canonicalInfo?.id);
  if (canonicalInfoId) {
    merged.add(canonicalInfoId);
  }
  if (args.canonical.runtimeMessageId) {
    merged.add(args.canonical.runtimeMessageId);
  }
  if (args.duplicate.runtimeMessageId) {
    merged.add(args.duplicate.runtimeMessageId);
  }
  return Array.from(merged);
}

function isMessagePartType(part: Record<string, unknown>, partType: string) {
  return asString(part.type) === partType;
}

function extractMessagePartIdentity(part: Record<string, unknown>) {
  return asString(part.id) ?? asString(part.callID) ?? asString(part.toolCallId);
}

function hasToolPart(message: { rawPayload?: Record<string, unknown> | null }) {
  return extractMessageParts(message).some((part) => isMessagePartType(part, "tool"));
}

function mergeAssistantToolCallFollowupParts(args: {
  canonical: AssistantMessageRow;
  duplicate: AssistantMessageRow;
}) {
  const canonicalParts = extractMessageParts(args.canonical);
  const duplicateParts = extractMessageParts(args.duplicate).map((part) => ({ ...part }));
  const duplicateToolIds = new Set(
    duplicateParts
      .filter((part) => isMessagePartType(part, "tool"))
      .map((part) => extractMessagePartIdentity(part))
      .filter((value): value is string => Boolean(value)),
  );
  const carryoverToolParts = canonicalParts
    .filter((part) => isMessagePartType(part, "tool"))
    .filter((part) => {
      const identity = extractMessagePartIdentity(part);
      return !identity || !duplicateToolIds.has(identity);
    })
    .map((part) => ({ ...part }));

  const mergedParts = [...duplicateParts];
  if (carryoverToolParts.length > 0) {
    const insertAt = mergedParts.findIndex(
      (part) => isMessagePartType(part, "text") || isMessagePartType(part, "step-finish"),
    );
    if (insertAt < 0) {
      mergedParts.push(...carryoverToolParts);
    } else {
      mergedParts.splice(insertAt, 0, ...carryoverToolParts);
    }
  }

  if (!mergedParts.some((part) => isMessagePartType(part, "text"))) {
    const fallbackTextParts = canonicalParts
      .filter((part) => isMessagePartType(part, "text"))
      .map((part) => ({ ...part }));
    if (fallbackTextParts.length > 0) {
      const insertAt = mergedParts.findIndex((part) => isMessagePartType(part, "step-finish"));
      if (insertAt < 0) {
        mergedParts.push(...fallbackTextParts);
      } else {
        mergedParts.splice(insertAt, 0, ...fallbackTextParts);
      }
    }
  }

  if (!mergedParts.some((part) => isMessagePartType(part, "step-start"))) {
    const fallbackStepStart = canonicalParts.find((part) => isMessagePartType(part, "step-start"));
    if (fallbackStepStart) {
      mergedParts.unshift({ ...fallbackStepStart });
    }
  }

  if (!mergedParts.some((part) => isMessagePartType(part, "step-finish"))) {
    const fallbackStepFinish = [...canonicalParts]
      .reverse()
      .find((part) => isMessagePartType(part, "step-finish"));
    if (fallbackStepFinish) {
      mergedParts.push({ ...fallbackStepFinish });
    }
  }

  return mergedParts;
}

function buildMergedPayload(args: {
  canonical: AssistantMessageRow;
  duplicate: AssistantMessageRow;
  mergedParts: Record<string, unknown>[];
}) {
  const canonicalPayload = args.canonical.rawPayload ?? {};
  const duplicatePayload = args.duplicate.rawPayload ?? {};
  const canonicalInfo = extractMessageInfoRecord(args.canonical) ?? {};
  const duplicateInfo = extractMessageInfoRecord(args.duplicate) ?? {};
  const canonicalTime = asRecord(canonicalInfo.time) ?? {};
  const duplicateTime = asRecord(duplicateInfo.time) ?? {};
  const preservedMessageId =
    asString(canonicalInfo.id) ??
    asString(canonicalPayload.id) ??
    args.canonical.runtimeMessageId ??
    args.duplicate.runtimeMessageId ??
    args.canonical.messageId;
  const preservedRuntimeMessageId =
    asString(canonicalPayload.runtimeMessageId) ??
    args.canonical.runtimeMessageId ??
    preservedMessageId;
  const mergedText = extractMessageText(args.duplicate) ?? extractMessageText(args.canonical);
  const mergedParentId =
    extractMessageParentId(args.duplicate) ?? extractMessageParentId(args.canonical);

  return {
    ...canonicalPayload,
    ...duplicatePayload,
    id: preservedMessageId,
    runtimeMessageId: preservedRuntimeMessageId,
    text: mergedText,
    textContent: mergedText,
    summaryText: mergedText,
    parts: args.mergedParts,
    mergedRuntimeMessageIds: buildMergedRuntimeMessageIds(args),
    info: {
      ...canonicalInfo,
      ...duplicateInfo,
      id: preservedMessageId,
      ...(mergedParentId ? { parentID: mergedParentId } : {}),
      time: {
        ...canonicalTime,
        ...duplicateTime,
        created:
          canonicalTime.created ??
          duplicateTime.created ??
          args.canonical.createdAt ??
          args.duplicate.createdAt,
        completed:
          duplicateTime.completed ??
          canonicalTime.completed ??
          args.duplicate.completedAt ??
          args.canonical.completedAt,
      },
    },
  } satisfies Record<string, unknown>;
}

function normalizePartType(part: Record<string, unknown>) {
  const rawType = typeof part.type === "string" ? part.type : "text";
  if (rawType === "tool" || rawType === "tool-result" || rawType === "tool_result") {
    return "tool_result";
  }
  if (rawType === "tool-call" || rawType === "tool_call") {
    return "tool_call";
  }
  if (rawType === "reasoning") {
    return "thinking";
  }
  if (rawType === "file" || rawType === "file-reference" || rawType === "file_reference") {
    return "file_reference";
  }
  if (rawType === "diff") {
    return "diff";
  }
  if (rawType === "thinking") {
    return "thinking";
  }

  return "text";
}

function buildMergedMessagePlan(args: {
  canonical: AssistantMessageRow;
  duplicate: AssistantMessageRow;
}) {
  const mergedParts = mergeAssistantToolCallFollowupParts(args);
  const rawPayload = buildMergedPayload({
    canonical: args.canonical,
    duplicate: args.duplicate,
    mergedParts,
  });
  const mergedText = extractMessageText({
    textContent: args.duplicate.textContent,
    summaryText: args.duplicate.summaryText,
    rawPayload,
  });

  return {
    action: "merge-tool-calls-stop",
    taskId: args.canonical.taskId,
    projectId: args.canonical.projectId,
    sessionId: args.canonical.sessionId,
    canonicalMessageId: args.canonical.messageId,
    duplicateMessageId: args.duplicate.messageId,
    mergedParts,
    mergedMessage: {
      messageId: args.canonical.messageId,
      sessionId: args.canonical.sessionId,
      taskId: args.canonical.taskId,
      projectId: args.canonical.projectId,
      runtimeMessageId: args.canonical.runtimeMessageId,
      role: args.canonical.role,
      status: args.duplicate.status ?? args.canonical.status,
      clientMessageId: args.duplicate.clientMessageId ?? args.canonical.clientMessageId,
      providerMessageId: args.duplicate.providerMessageId ?? args.canonical.providerMessageId,
      messageIndex: args.canonical.messageIndex,
      textContent: mergedText,
      summaryText: mergedText,
      rawPayload,
      tokenUsed: args.duplicate.tokenUsed ?? args.canonical.tokenUsed,
      startedAt: args.canonical.startedAt ?? args.canonical.createdAt,
      completedAt: args.duplicate.completedAt ?? args.canonical.completedAt,
      errorText: args.duplicate.errorText ?? args.canonical.errorText,
      createdAt: args.canonical.createdAt,
      updatedAt: args.duplicate.updatedAt,
    } satisfies MergedMessagePlan,
  } satisfies RepairPlan;
}

function shouldMergeHistoricalAssistantToolCallFollowup(args: {
  canonical: AssistantMessageRow;
  duplicate: AssistantMessageRow;
  windowMs: number;
}) {
  if (args.canonical.role !== "assistant" || args.duplicate.role !== "assistant") {
    return false;
  }

  if (args.canonical.sessionId !== args.duplicate.sessionId) {
    return false;
  }

  if (extractMessageFinishReason(args.canonical) !== "tool-calls") {
    return false;
  }

  if (extractMessageFinishReason(args.duplicate) !== "stop") {
    return false;
  }

  if (extractMergedRuntimeMessageIds(args.duplicate).length > 0) {
    return false;
  }

  if (!hasToolPart(args.canonical)) {
    return false;
  }

  const canonicalParentId = extractMessageParentId(args.canonical);
  const duplicateParentId = extractMessageParentId(args.duplicate);
  if (!canonicalParentId || canonicalParentId !== duplicateParentId) {
    return false;
  }

  const canonicalReferenceTime = parseTimestamp(
    args.canonical.completedAt ?? args.canonical.createdAt,
  );
  const duplicateCreatedAt = parseTimestamp(args.duplicate.createdAt);
  if (canonicalReferenceTime === null || duplicateCreatedAt === null) {
    return false;
  }
  if (Math.abs(duplicateCreatedAt - canonicalReferenceTime) > args.windowMs) {
    return false;
  }

  const canonicalText = normalizeComparableText(extractMessageText(args.canonical));
  const duplicateText = normalizeComparableText(extractMessageText(args.duplicate));
  if (!canonicalText && !duplicateText) {
    return false;
  }
  if (canonicalText && duplicateText && canonicalText !== duplicateText) {
    return false;
  }

  return true;
}

async function loadAssistantMessages(args: {
  taskId?: string;
  projectId?: string;
  all: boolean;
}) {
  const clauses = ["messages.role = 'assistant'"];
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
  return postgresSql.unsafe<AssistantMessageRow[]>(
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
      where ${clauses.join(" and ")}
      order by messages.task_id asc, messages.session_id asc, messages.seq asc, messages.created_at asc
    `,
    params as never[],
  );
}

function buildRepairPlans(args: {
  assistantMessages: AssistantMessageRow[];
  windowMs: number;
}) {
  const messagesBySession = new Map<string, AssistantMessageRow[]>();
  for (const message of args.assistantMessages) {
    const current = messagesBySession.get(message.sessionId) ?? [];
    current.push(message);
    messagesBySession.set(message.sessionId, current);
  }

  const plans: RepairPlan[] = [];

  for (const sessionMessages of messagesBySession.values()) {
    for (let index = 0; index < sessionMessages.length - 1; index += 1) {
      const canonical = sessionMessages[index];
      const duplicate = sessionMessages[index + 1];
      if (!canonical || !duplicate) {
        continue;
      }

      if (
        shouldMergeHistoricalAssistantToolCallFollowup({
          canonical,
          duplicate,
          windowMs: args.windowMs,
        })
      ) {
        plans.push(buildMergedMessagePlan({ canonical, duplicate }));
        index += 1;
      }
    }
  }

  return plans;
}

async function updateCanonicalMessage(transaction: SqlExecutor, mergedMessage: MergedMessagePlan) {
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
          updated_at = current_timestamp
      where id = $1
    `,
    [
      mergedMessage.messageId,
      normalizeCanonicalMessageStatus(mergedMessage.status),
      mergedMessage.clientMessageId,
      mergedMessage.providerMessageId,
      mergedMessage.textContent,
      mergedMessage.summaryText,
      JSON.stringify(mergedMessage.rawPayload ?? {}),
      mergedMessage.tokenUsed ?? 0,
      mergedMessage.startedAt,
      mergedMessage.completedAt,
      mergedMessage.errorText,
    ] as never[],
  );
}

async function replaceCanonicalParts(args: {
  transaction: SqlExecutor;
  canonicalMessageId: string;
  mergedParts: Record<string, unknown>[];
  createdAt: string;
}) {
  await args.transaction.unsafe("delete from task_message_parts where message_id = $1", [
    args.canonicalMessageId,
  ] as never[]);

  for (const [index, part] of args.mergedParts.entries()) {
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
        `${args.canonicalMessageId}:${index}`,
        args.canonicalMessageId,
        index,
        normalizePartType(part),
        extractMessagePartText(part),
        JSON.stringify(part),
        args.createdAt,
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

function buildTaskTimelineMessageId(messageId: string) {
  return `task-timeline:message:${messageId}`;
}

async function ensureCanonicalTimelineRow(
  transaction: SqlExecutor,
  mergedMessage: MergedMessagePlan,
) {
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
        $1,
        $2,
        $3,
        $4,
        $5,
        null,
        null,
        'message',
        $6,
        null,
        $7,
        $8::jsonb,
        $9,
        $10,
        current_timestamp
      )
      on conflict (id) do update
      set session_id = excluded.session_id,
          message_id = excluded.message_id,
          item_kind = excluded.item_kind,
          item_role = excluded.item_role,
          display_text = excluded.display_text,
          metadata_json = excluded.metadata_json,
          sort_at = excluded.sort_at,
          updated_at = current_timestamp
    `,
    [
      buildTaskTimelineMessageId(mergedMessage.messageId),
      mergedMessage.projectId,
      mergedMessage.taskId,
      mergedMessage.sessionId,
      mergedMessage.messageId,
      mergedMessage.role,
      mergedMessage.textContent,
      JSON.stringify({
        runtimeMessageId: mergedMessage.runtimeMessageId,
        role: mergedMessage.role,
      }),
      mergedMessage.completedAt ?? mergedMessage.createdAt,
      mergedMessage.createdAt,
    ] as never[],
  );
}

async function updateMessageReferences(args: {
  transaction: SqlExecutor;
  duplicateMessageId: string;
  canonicalMessageId: string;
  sessionId: string;
}) {
  const forkRows = await args.transaction.unsafe<Array<{ id: string }>>(
    `
      update task_sessions
      set forked_from_message_id = $2,
          updated_at = current_timestamp
      where forked_from_message_id = $1
      returning id
    `,
    [args.duplicateMessageId, args.canonicalMessageId] as never[],
  );

  const artifactRows = await args.transaction.unsafe<Array<{ id: string }>>(
    `
      update task_artifacts
      set message_id = $2,
          session_id = $3,
          updated_at = current_timestamp
      where message_id = $1
      returning id
    `,
    [args.duplicateMessageId, args.canonicalMessageId, args.sessionId] as never[],
  );

  const usageRows = await args.transaction.unsafe<Array<{ id: string }>>(
    `
      update task_usage_ledger_entries
      set message_id = $2,
          session_id = $3
      where message_id = $1
      returning id
    `,
    [args.duplicateMessageId, args.canonicalMessageId, args.sessionId] as never[],
  );

  await args.transaction.unsafe(
    `
      update task_operations
      set message_id = $2,
          updated_at = current_timestamp
      where message_id = $1
    `,
    [args.duplicateMessageId, args.canonicalMessageId] as never[],
  );

  await args.transaction.unsafe(
    `
      update task_sessions
      set head_message_id = $2,
          updated_at = current_timestamp
      where head_message_id = $1
    `,
    [args.duplicateMessageId, args.canonicalMessageId] as never[],
  );

  return {
    forkUpdatedCount: forkRows.length,
    artifactUpdatedCount: artifactRows.length,
    usageUpdatedCount: usageRows.length,
  };
}

async function deleteDuplicateTimelineRows(transaction: SqlExecutor, duplicateMessageId: string) {
  const rows = await transaction.unsafe<Array<{ id: string }>>(
    "delete from task_timeline_views where message_id = $1 returning id",
    [duplicateMessageId] as never[],
  );
  return rows.length;
}

async function deleteDuplicateMessage(transaction: SqlExecutor, duplicateMessageId: string) {
  await transaction.unsafe("delete from task_message_parts where message_id = $1", [
    duplicateMessageId,
  ] as never[]);
  await transaction.unsafe("delete from task_messages where id = $1", [
    duplicateMessageId,
  ] as never[]);
}

async function applyRepairPlan(args: {
  plan: RepairPlan;
  summary: BackfillSummary;
}) {
  const { postgresSql } = await loadDbModule();
  await postgresSql.begin(async (transaction) => {
    const tx = asSqlExecutor(transaction);

    await updateCanonicalMessage(tx, args.plan.mergedMessage);
    await replaceCanonicalParts({
      transaction: tx,
      canonicalMessageId: args.plan.canonicalMessageId,
      mergedParts: args.plan.mergedParts,
      createdAt: args.plan.mergedMessage.createdAt,
    });
    await syncCanonicalMessagePartCount(tx, args.plan.canonicalMessageId);
    await ensureCanonicalTimelineRow(tx, args.plan.mergedMessage);

    const { forkUpdatedCount, artifactUpdatedCount, usageUpdatedCount } =
      await updateMessageReferences({
        transaction: tx,
        duplicateMessageId: args.plan.duplicateMessageId,
        canonicalMessageId: args.plan.canonicalMessageId,
        sessionId: args.plan.sessionId,
      });
    args.summary.forkRefsUpdatedCount += forkUpdatedCount;
    args.summary.artifactRefsUpdatedCount += artifactUpdatedCount;
    args.summary.usageRefsUpdatedCount += usageUpdatedCount;

    args.summary.timelineRowsDeletedCount += await deleteDuplicateTimelineRows(
      tx,
      args.plan.duplicateMessageId,
    );
    await deleteDuplicateMessage(tx, args.plan.duplicateMessageId);
  });

  args.summary.canonicalMessageUpdatedCount += 1;
  args.summary.duplicateMessageDeletedCount += 1;
}

function printHelp() {
  console.log(
    "Usage: bun run src/db/migration/backfill-assistant-toolcall-stop-duplicates.ts [--task-id <taskId> | --project-id <projectId> | --all] [--dry-run] [--window-ms <ms>]",
  );
  console.log(
    "Merges historical assistant tool-calls rows with immediately-following final stop rows and deletes the duplicate stop message.",
  );
}

function printSummary(summary: BackfillSummary) {
  console.log("Assistant tool-calls/stop duplicate backfill summary");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.affectedTaskIds.length === 0) {
    console.log("No matching historical duplicate assistant rows found.");
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

  const assistantMessages = await loadAssistantMessages({
    taskId: taskId ?? undefined,
    projectId: projectId ?? undefined,
    all,
  });
  const repairPlans = buildRepairPlans({
    assistantMessages,
    windowMs,
  });
  const affectedTaskIds = Array.from(new Set(repairPlans.map((plan) => plan.taskId))).sort();

  const summary: BackfillSummary = {
    taskId,
    projectId,
    all,
    dryRun,
    windowMs,
    assistantMessageCount: assistantMessages.length,
    repairPlanCount: repairPlans.length,
    canonicalMessageUpdatedCount: dryRun ? repairPlans.length : 0,
    duplicateMessageDeletedCount: dryRun ? repairPlans.length : 0,
    forkRefsUpdatedCount: 0,
    artifactRefsUpdatedCount: 0,
    usageRefsUpdatedCount: 0,
    timelineRowsDeletedCount: 0,
    affectedTaskIds,
  };

  if (!dryRun) {
    for (const plan of repairPlans) {
      await applyRepairPlan({
        plan,
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
