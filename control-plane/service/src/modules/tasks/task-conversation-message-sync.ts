import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { conversationMessageParts, conversationMessages } from "../../db/schema";
import type { AppendTaskDomainEventArgs } from "./task-domain-projector";
import {
  buildConversationMessageId,
  buildConversationSessionId,
  extractPersistedEventRole,
  extractPersistedMessageCompletedAt,
  extractPersistedMessageCreatedAt,
  extractPersistedMessageId,
  extractPersistedMessageTokenUsage,
  extractPersistedSearchText,
  extractPersistedStandalonePart,
  extractPersistedToolResultText,
  normalizePersistedTimestamp,
} from "./task-session-read";

type TaskConversationMessageRecordArgs = {
  task: {
    id: string;
    projectId: string;
  };
  runtimeSessionId: string;
  message: Record<string, unknown>;
};

function normalizeConversationMessagePartType(part: Record<string, unknown>) {
  const rawType = typeof part.type === "string" ? part.type : "";
  if (rawType === "text") {
    return "text" as const;
  }
  if (rawType === "tool" || rawType === "tool_result" || rawType === "tool-result") {
    return "tool_result" as const;
  }
  if (rawType === "tool_call" || rawType === "tool-call") {
    return "tool_call" as const;
  }
  if (rawType === "thinking" || rawType === "reasoning") {
    return "thinking" as const;
  }
  if (rawType === "file" || rawType === "file_reference" || rawType === "file-reference") {
    return "file_reference" as const;
  }
  if (rawType === "diff") {
    return "diff" as const;
  }
  return "text" as const;
}

function extractConversationMessageParts(message: unknown) {
  if (!message || typeof message !== "object") {
    return [] as Array<Record<string, unknown>>;
  }

  const standalonePart = extractPersistedStandalonePart(message);
  if (standalonePart) {
    return [standalonePart];
  }

  return Array.isArray((message as { parts?: unknown }).parts)
    ? ((message as { parts: unknown[] }).parts as Array<Record<string, unknown>>).filter(
        (part): part is Record<string, unknown> => Boolean(part && typeof part === "object"),
      )
    : [];
}

function extractConversationMessagePartText(part: Record<string, unknown>) {
  if (typeof part.text === "string" && part.text.trim()) {
    return part.text;
  }

  if (part.type === "tool") {
    const state =
      typeof part.state === "object" && part.state
        ? (part.state as Record<string, unknown>)
        : undefined;
    const candidates = [state?.output, state?.error, state?.raw];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
  }

  return undefined;
}

function asConversationPartRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function truncateConversationPartPreview(value: string, maxLength = 160) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function previewConversationPartValue(value: unknown, maxLength = 160): string | null {
  if (typeof value === "string") {
    return truncateConversationPartPreview(value, maxLength);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => previewConversationPartValue(item, Math.max(24, Math.floor(maxLength / 2))))
      .filter((item): item is string => Boolean(item));
    if (items.length === 0) {
      return null;
    }
    return truncateConversationPartPreview(items.join(", "), maxLength);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const pairs = Object.entries(record)
      .slice(0, 4)
      .map(([key, nested]) => {
        const preview = previewConversationPartValue(nested, 48);
        return preview ? `${key}: ${preview}` : null;
      })
      .filter((entry): entry is string => Boolean(entry));
    if (pairs.length === 0) {
      return null;
    }
    return truncateConversationPartPreview(pairs.join(" | "), maxLength);
  }
  return null;
}

function buildConversationToolInputSummary(input: Record<string, unknown>) {
  const parts: string[] = [];

  const command = previewConversationPartValue(input.command, 180);
  if (command) {
    parts.push(`command: ${command}`);
  }

  const query = previewConversationPartValue(input.query, 120);
  if (query) {
    parts.push(`query: ${query}`);
  }

  const pattern = previewConversationPartValue(input.pattern, 120);
  if (pattern) {
    parts.push(`pattern: ${pattern}`);
  }

  const includePattern = previewConversationPartValue(input.includePattern, 120);
  if (includePattern) {
    parts.push(`includePattern: ${includePattern}`);
  }

  const filePath = previewConversationPartValue(input.filePath ?? input.path ?? input.dirPath, 120);
  if (filePath) {
    parts.push(`path: ${filePath}`);
  }

  const url = previewConversationPartValue(input.url ?? input.urls, 120);
  if (url) {
    parts.push(`url: ${url}`);
  }

  const args = previewConversationPartValue(input.args, 120);
  if (args) {
    parts.push(`args: ${args}`);
  }

  const reason = previewConversationPartValue(input.reason, 120);
  if (reason) {
    parts.push(`reason: ${reason}`);
  }

  const goal = previewConversationPartValue(input.goal, 120);
  if (goal) {
    parts.push(`goal: ${goal}`);
  }

  if (parts.length > 0) {
    return parts.join(" | ");
  }

  return previewConversationPartValue(input, 180);
}

function extractConversationPartFilePath(part: Record<string, unknown>) {
  const candidates = [
    part.filePath,
    part.path,
    part.uri,
    part.name,
    asConversationPartRecord(part.input)?.filePath,
    asConversationPartRecord(part.input)?.path,
    asConversationPartRecord(part.state)?.filePath,
    asConversationPartRecord(part.state)?.path,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function buildConversationFileReferenceSummary(part: Record<string, unknown>) {
  const filePath = extractConversationPartFilePath(part);
  const startLine =
    typeof part.startLine === "number"
      ? part.startLine
      : typeof part.line === "number"
        ? part.line
        : null;
  const endLine = typeof part.endLine === "number" ? part.endLine : null;

  if (!filePath) {
    return previewConversationPartValue(part, 160);
  }

  if (startLine !== null && endLine !== null && endLine > startLine) {
    return `${filePath}:${startLine}-${endLine}`;
  }
  if (startLine !== null) {
    return `${filePath}:${startLine}`;
  }
  return filePath;
}

function extractConversationNumericStat(
  part: Record<string, unknown>,
  stats: Record<string, unknown> | null,
  key: "additions" | "deletions" | "filesChanged",
) {
  const directValue = part[key];
  if (typeof directValue === "number") {
    return directValue;
  }

  const statsValue = stats?.[key];
  return typeof statsValue === "number" ? statsValue : null;
}

function findConversationTrimmedString(candidates: unknown[]) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function extractConversationToolName(part: Record<string, unknown>) {
  return findConversationTrimmedString([part.name, part.toolName, part.tool, part.callID]);
}

function buildConversationToolPartMetadata(part: Record<string, unknown>) {
  const input =
    asConversationPartRecord(part.input) ??
    asConversationPartRecord(asConversationPartRecord(part.state)?.input);
  const state = asConversationPartRecord(part.state);
  const outputSummary =
    previewConversationPartValue(state?.output, 180) ??
    previewConversationPartValue(state?.error, 180) ??
    previewConversationPartValue(state?.raw, 180) ??
    extractConversationMessagePartText(part) ??
    null;

  return {
    toolName: extractConversationToolName(part),
    callId: findConversationTrimmedString([part.callID]),
    status: findConversationTrimmedString([state?.status, part.state]),
    argumentsSummary: input ? buildConversationToolInputSummary(input) : null,
    outputSummary,
  };
}

function buildConversationFileReferenceMetadata(part: Record<string, unknown>) {
  return {
    filePath: extractConversationPartFilePath(part),
    locationSummary: buildConversationFileReferenceSummary(part),
    startLine:
      typeof part.startLine === "number"
        ? part.startLine
        : typeof part.line === "number"
          ? part.line
          : null,
    endLine: typeof part.endLine === "number" ? part.endLine : null,
  };
}

function buildConversationDiffMetadata(part: Record<string, unknown>) {
  const stats = asConversationPartRecord(part.stats);

  return {
    filePath: extractConversationPartFilePath(part),
    diffSummary: buildConversationDiffSummary(part),
    additions: extractConversationNumericStat(part, stats, "additions"),
    deletions: extractConversationNumericStat(part, stats, "deletions"),
    filesChanged: extractConversationNumericStat(part, stats, "filesChanged"),
  };
}

function buildConversationToolPartTitle(part: Record<string, unknown>, label: string) {
  const toolName = extractConversationToolName(part);
  return toolName ? `${label} ${toolName}` : label;
}

function buildConversationFileReferenceTitle(part: Record<string, unknown>) {
  const filePath = extractConversationPartFilePath(part);
  return filePath ? `文件引用 ${filePath}` : "文件引用";
}

function buildConversationDiffSummary(part: Record<string, unknown>) {
  const stats = asConversationPartRecord(part.stats);
  const filePath = extractConversationPartFilePath(part);
  const additions = extractConversationNumericStat(part, stats, "additions");
  const deletions = extractConversationNumericStat(part, stats, "deletions");
  const filesChanged = extractConversationNumericStat(part, stats, "filesChanged");
  const summaryParts: string[] = [];

  if (filePath) {
    summaryParts.push(filePath);
  }
  if (filesChanged !== null) {
    summaryParts.push(`${filesChanged} files`);
  }
  if (additions !== null || deletions !== null) {
    summaryParts.push(`+${additions ?? 0} -${deletions ?? 0}`);
  }

  if (summaryParts.length > 0) {
    return summaryParts.join(" | ");
  }

  return (
    previewConversationPartValue(part.patch, 180) ??
    previewConversationPartValue(part.diff, 180) ??
    previewConversationPartValue(part.hunks, 180)
  );
}

function extractConversationMessagePartMetadata(part: Record<string, unknown>) {
  const partType = normalizeConversationMessagePartType(part);

  if (partType === "tool_call" || partType === "tool_result") {
    return buildConversationToolPartMetadata(part);
  }

  if (partType === "file_reference") {
    return buildConversationFileReferenceMetadata(part);
  }

  if (partType === "diff") {
    return buildConversationDiffMetadata(part);
  }

  return null;
}

function extractConversationMessagePartTitle(part: Record<string, unknown>) {
  const partType = normalizeConversationMessagePartType(part);
  if (partType === "tool_call") {
    return buildConversationToolPartTitle(part, "工具调用");
  }

  if (partType === "tool_result") {
    return buildConversationToolPartTitle(part, "工具结果");
  }

  if (partType === "thinking") {
    return "思考过程";
  }

  if (partType === "file_reference") {
    return buildConversationFileReferenceTitle(part);
  }

  if (partType === "diff") {
    return "变更 Diff";
  }

  return undefined;
}

function buildConversationMessagePartSummaries(parts: Array<Record<string, unknown>>) {
  return parts.map((part, index) => ({
    partIndex: index,
    partType: normalizeConversationMessagePartType(part),
    textContent: extractConversationMessagePartText(part) ?? null,
    title: extractConversationMessagePartTitle(part) ?? null,
    metadata: extractConversationMessagePartMetadata(part),
  }));
}

export function createTaskConversationMessageSyncApi(deps: {
  appendTaskDomainEvent: (args: AppendTaskDomainEventArgs) => Promise<{ seq: number }>;
}) {
  async function upsertConversationMessageRecord(args: TaskConversationMessageRecordArgs) {
    const sessionId = buildConversationSessionId(args.task.id, args.runtimeSessionId);
    const runtimeMessageId =
      extractPersistedMessageId(args.message) ?? `anonymous-${crypto.randomUUID()}`;
    const messageId = buildConversationMessageId(sessionId, runtimeMessageId);
    const existing = await db.query.conversationMessages.findFirst({
      where: eq(conversationMessages.id, messageId),
    });
    const latestMessage = await db.query.conversationMessages.findFirst({
      where: eq(conversationMessages.sessionId, sessionId),
      orderBy: [desc(conversationMessages.messageIndex)],
    });
    const messageIndex = existing?.messageIndex ?? (latestMessage?.messageIndex ?? -1) + 1;
    const role = (extractPersistedEventRole(args.message) ??
      "assistant") as typeof conversationMessages.role._.data;
    const searchText = extractPersistedSearchText(args.message) ?? null;
    const resultText = extractPersistedToolResultText(args.message) ?? null;
    const createdAt = extractPersistedMessageCreatedAt(args.message) ?? new Date().toISOString();
    const completedAt =
      normalizePersistedTimestamp(extractPersistedMessageCompletedAt(args.message)) ?? null;
    const updatedAt = new Date().toISOString();
    const parts = extractConversationMessageParts(args.message);
    const partSummaries = buildConversationMessagePartSummaries(parts);

    await db
      .insert(conversationMessages)
      .values({
        id: messageId,
        sessionId,
        taskId: args.task.id,
        runId: null,
        runNodeId: null,
        projectId: args.task.projectId,
        runtimeMessageId,
        role,
        messageIndex,
        textContent: searchText ?? resultText,
        summaryText: searchText ?? resultText,
        rawPayload: args.message,
        tokenUsed: extractPersistedMessageTokenUsage(args.message),
        startedAt: createdAt,
        completedAt,
        createdAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: conversationMessages.id,
        set: {
          role,
          textContent: searchText ?? resultText,
          summaryText: searchText ?? resultText,
          rawPayload: args.message,
          tokenUsed: extractPersistedMessageTokenUsage(args.message),
          startedAt: createdAt,
          completedAt,
          updatedAt,
        },
      });

    if (parts.length > 0) {
      await db
        .delete(conversationMessageParts)
        .where(eq(conversationMessageParts.messageId, messageId));
      await db.insert(conversationMessageParts).values(
        parts.map((part, index) => ({
          id: `${messageId}:${index}`,
          messageId,
          partIndex: index,
          partType: normalizeConversationMessagePartType(part),
          textContent: extractConversationMessagePartText(part) ?? null,
          jsonPayload: part,
          createdAt,
        })),
      );
    }

    const domainEvent = await deps.appendTaskDomainEvent({
      projectId: args.task.projectId,
      taskId: args.task.id,
      sessionId,
      eventType: "conversation.message.upserted",
      payload: {
        messageId,
        runtimeMessageId,
        runtimeSessionId: args.runtimeSessionId,
        role,
        textContent: searchText ?? resultText,
        tokenUsed: extractPersistedMessageTokenUsage(args.message),
        completedAt,
        partTypes: partSummaries.map((part) => part.partType),
        partSummaries,
      },
      createdAt,
    });

    return { messageId, sessionId, seq: domainEvent.seq };
  }

  return { upsertConversationMessageRecord };
}
