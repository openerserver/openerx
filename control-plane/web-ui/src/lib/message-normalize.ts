import type { RealtimeEvent } from "../stores/realtime";
/**
 * Shared message normalization helpers for task conversation rendering.
 *
 * V3 consumes execution-trace directly and uses these helpers to normalise
 * reconstructed conversation items and apply live text overlays.
 */
import { normalizeWorkspaceFilePath } from "./workspace-file-path";

/* ------------------------------------------------------------------ */
/*  Type exports                                                       */
/* ------------------------------------------------------------------ */

export interface TaskConversationMessageItem {
  key: string;
  role: string;
  agent?: string;
  text?: string;
  toolCalls: TaskConversationToolCallItem[];
  createdAt?: string;
  raw: unknown;
  isStreaming?: boolean;
}

export interface TaskParallelComparisonCard {
  key: string;
  index: number;
  label: string;
  model?: string;
  status: string;
  traceState?: "incomplete" | "stale";
  traceNote?: string;
  meta?: string;
  loading: boolean;
  items: TaskConversationMessageItem[];
  canAdopt: boolean;
  isAdopted: boolean;
  isRecommended: boolean;
}

export interface TaskConversationParallelItem {
  key: string;
  role: "parallel";
  createdAt?: string;
  candidates: TaskParallelComparisonCard[];
  judgeSummary?: string;
  judgeReasoning?: string;
  raw: unknown;
  toolCalls: [];
}

export type TaskConversationListItem = TaskConversationMessageItem | TaskConversationParallelItem;

export interface TaskConversationToolCallItem {
  key: string;
  kind: string;
  label: string;
  stateLabel: string;
  stateColor: string;
  headline?: string;
  description?: string;
  command?: string;
  filePath?: string;
  fileContent?: string;
  inputPreview?: string;
  outputPreview?: string;
}

/* ------------------------------------------------------------------ */
/*  Live assistant state                                               */
/* ------------------------------------------------------------------ */

export type LiveAssistantMeta = {
  agent?: string;
  createdAt?: string;
};

export type LiveAssistantState = {
  orderedAssistantMessageIds: string[];
  metaById: Map<string, LiveAssistantMeta>;
  textById: Map<string, string>;
  incompleteIds: Set<string>;
};

/* ------------------------------------------------------------------ */
/*  Primitive helpers                                                   */
/* ------------------------------------------------------------------ */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function summarizeValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const entries = value
      .map((item) => summarizeValue(item))
      .filter((item): item is string => Boolean(item));
    return entries.length ? entries.join(", ") : undefined;
  }

  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return undefined;
}

export function parseTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return undefined;
}

export function hasCompletedTimestamp(value: unknown): boolean {
  return (typeof value === "string" && value.length > 0) || typeof value === "number";
}

/* ------------------------------------------------------------------ */
/*  Realtime event accessors                                           */
/* ------------------------------------------------------------------ */

export function getRealtimeRawType(event: RealtimeEvent): string {
  return typeof event.data.rawType === "string" ? event.data.rawType : event.type;
}

export function getRealtimeInfo(event: RealtimeEvent): Record<string, unknown> | null {
  return asRecord(event.data.info);
}

export function getRealtimePart(event: RealtimeEvent): Record<string, unknown> | null {
  return asRecord(event.data.part);
}

function mergeStreamingText(existing: string | undefined, incoming: string): string {
  const next = incoming.trim();
  if (!existing) {
    return next;
  }
  if (!next) {
    return existing;
  }
  if (next.startsWith(existing)) {
    return next;
  }
  if (existing === next || existing.endsWith(next)) {
    return existing;
  }
  return `${existing}${next}`;
}

/* ------------------------------------------------------------------ */
/*  Message structure accessors                                        */
/* ------------------------------------------------------------------ */

export function messageInfo(message: unknown) {
  return asRecord(asRecord(message)?.info);
}

function messageParts(message: unknown): Array<Record<string, unknown>> {
  const parts = asRecord(message)?.parts;
  return Array.isArray(parts)
    ? parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
}

function normalizeText(parts: Array<Record<string, unknown>>): string | undefined {
  const chunks = parts
    .filter((part) => {
      const partType = asString(part.type);
      return !partType || partType === "text";
    })
    .map((part) => asString(part.text) ?? asString(part.content))
    .filter((value): value is string => Boolean(value));

  if (chunks.length > 0) {
    return chunks.join("\n").trim() || undefined;
  }

  return undefined;
}

function normalizePreviewText(value: unknown, maxLength = 320): string | undefined {
  const text = summarizeValue(value)?.trim();
  if (!text) {
    return undefined;
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trimEnd()}\n...`;
}

/* ------------------------------------------------------------------ */
/*  Tool call builders                                                 */
/* ------------------------------------------------------------------ */

function toolState(part: Record<string, unknown>): Record<string, unknown> {
  return asRecord(part.state) ?? {};
}

function toolStatus(part: Record<string, unknown>): string | undefined {
  return asString(part.state) ?? summarizeValue(toolState(part).status);
}

function toolStateLabel(status?: string): string {
  if (status === "completed") return "完成";
  if (status === "running") return "执行中";
  if (status === "error" || status === "failed") return "失败";
  return status || "已触发";
}

function toolStateColor(status?: string): string {
  if (status === "completed") return "green";
  if (status === "running") return "processing";
  if (status === "error" || status === "failed") return "red";
  return "default";
}

function toolInput(part: Record<string, unknown>): Record<string, unknown> {
  return asRecord(part.input) ?? asRecord(toolState(part).input) ?? {};
}

function extractTaggedContent(source: string | undefined, tag: string): string | undefined {
  if (!source) {
    return undefined;
  }

  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() || undefined;
}

function buildReadPreview(output: unknown) {
  const outputText = summarizeValue(output);
  return {
    filePath: normalizeWorkspaceFilePath(extractTaggedContent(outputText, "path")),
    rawContent:
      extractTaggedContent(outputText, "content") ?? extractTaggedContent(outputText, "entries"),
    content: normalizePreviewText(
      extractTaggedContent(outputText, "content") ?? extractTaggedContent(outputText, "entries"),
      220,
    ),
  };
}

function extractPatchFilePaths(patchText: string | undefined): string[] {
  if (!patchText) {
    return [];
  }

  const matches = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gmu)];
  const paths = matches
    .map((match) => normalizeWorkspaceFilePath(match[1]?.trim()))
    .filter((value): value is string => Boolean(value));

  return [...new Set(paths)];
}

function extractToolOutputFilePaths(output: unknown): string[] {
  const outputText = summarizeValue(output);
  if (!outputText) {
    return [];
  }

  const lines = outputText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const paths = lines
    .map((line) => {
      const match = line.match(/^(?:[AMD]|R\d+|\+|-)\s+(.+)$/u);
      return normalizeWorkspaceFilePath(match?.[1]?.trim());
    })
    .filter((value): value is string => Boolean(value));

  return [...new Set(paths)];
}

function firstPatchFilePath(input: Record<string, unknown>): string | undefined {
  const patchText =
    typeof input.input === "string"
      ? input.input
      : typeof input.patch === "string"
        ? input.patch
        : undefined;

  return extractPatchFilePaths(patchText)[0];
}

function firstToolOutputFilePath(state: Record<string, unknown>): string | undefined {
  return extractToolOutputFilePaths(state.output ?? state.error)[0];
}

function buildToolFileContent(
  kind: string,
  input: Record<string, unknown>,
  state: Record<string, unknown>,
): string | undefined {
  if (kind === "create_file") {
    return typeof input.content === "string" && input.content.length > 0
      ? input.content
      : summarizeValue(input.content);
  }

  if (kind === "apply_patch") {
    return typeof input.input === "string"
      ? input.input
      : typeof input.patch === "string"
        ? input.patch
        : undefined;
  }

  if (kind === "read") {
    return buildReadPreview(state.output).rawContent;
  }

  return undefined;
}

function buildToolInputPreview(input: Record<string, unknown>): string | undefined {
  const lines: string[] = [];
  const appendLine = (label: string, value: unknown) => {
    const text = summarizeValue(value);
    if (text) {
      lines.push(`${label}: ${text}`);
    }
  };

  appendLine("path", input.filePath ?? input.path);
  appendLine("query", input.query ?? input.pattern ?? input.url ?? input.urls);

  const patchPaths = firstPatchFilePath(input);
  if (patchPaths) {
    lines.push(`path: ${patchPaths}`);
  }

  if (Array.isArray(input.args) && input.args.length) {
    const args = input.args
      .map((item) => summarizeValue(item))
      .filter((item): item is string => Boolean(item));
    if (args.length) {
      lines.push(`args: ${args.join(" ")}`);
    }
  }

  if (typeof input.prompt === "string" && input.prompt.trim()) {
    const promptPreview = normalizePreviewText(input.prompt, 180);
    if (promptPreview) {
      lines.push(`prompt: ${promptPreview}`);
    }
  }

  return lines.length ? lines.join("\n") : undefined;
}

function buildToolHeadline(label: string, input: Record<string, unknown>): string | undefined {
  if (label === "bash") {
    return summarizeValue(input.command);
  }

  if (label === "apply_patch") {
    const paths = extractPatchFilePaths(
      typeof input.input === "string"
        ? input.input
        : typeof input.patch === "string"
          ? input.patch
          : undefined,
    );
    if (paths.length === 1) {
      return paths[0];
    }
    if (paths.length > 1) {
      return `${paths[0]} 等 ${paths.length} 个文件`;
    }
  }

  return (
    summarizeValue(input.command) ??
    summarizeValue(input.filePath) ??
    summarizeValue(input.path) ??
    firstPatchFilePath(input) ??
    summarizeValue(input.query) ??
    summarizeValue(input.pattern) ??
    summarizeValue(input.url)
  );
}

function hasVisibleToolSignal(args: {
  headline?: string;
  description?: string;
  command?: string;
  filePath?: string;
  inputPreview?: string;
  outputPreview?: string;
}) {
  return Boolean(
    args.command ||
      args.headline ||
      args.description ||
      args.filePath ||
      args.inputPreview ||
      args.outputPreview,
  );
}

function buildToolCall(
  part: Record<string, unknown>,
  index: number,
): TaskConversationToolCallItem | null {
  if (asString(part.type) !== "tool") {
    return null;
  }

  const state = toolState(part);
  const status = toolStatus(part);
  const input = toolInput(part);
  const label = summarizeValue(part.toolName) ?? summarizeValue(part.tool) ?? "工具调用";
  const kind = asString(part.toolName) ?? asString(part.tool) ?? "tool";
  const readPreview = kind === "read" ? buildReadPreview(state.output) : undefined;
  const outputFilePath = firstToolOutputFilePath(state);
  const derivedFilePath =
    normalizeWorkspaceFilePath(summarizeValue(input.filePath)) ??
    normalizeWorkspaceFilePath(summarizeValue(input.path)) ??
    firstPatchFilePath(input) ??
    outputFilePath ??
    readPreview?.filePath;
  const headline = buildToolHeadline(kind, input) ?? derivedFilePath;
  const description = summarizeValue(input.description) ?? summarizeValue(input.explanation);
  const command = kind === "bash" ? summarizeValue(input.command) : undefined;
  const inputPreview = buildToolInputPreview(input);
  const outputPreview =
    normalizePreviewText(state.output ?? state.error, 220) ?? readPreview?.content;

  if (
    !hasVisibleToolSignal({
      headline,
      description,
      command,
      filePath: derivedFilePath,
      inputPreview,
      outputPreview,
    })
  ) {
    return null;
  }

  return {
    key: asString(part.id) ?? asString(part.callID) ?? `${kind}-${index}`,
    kind,
    label,
    stateLabel: toolStateLabel(status),
    stateColor: toolStateColor(status),
    headline,
    description,
    command,
    filePath: derivedFilePath,
    fileContent: buildToolFileContent(kind, input, state),
    inputPreview,
    outputPreview,
  };
}

function normalizeToolCalls(parts: Array<Record<string, unknown>>): TaskConversationToolCallItem[] {
  return parts
    .map((part, index) => buildToolCall(part, index))
    .filter((item): item is TaskConversationToolCallItem => Boolean(item));
}

/* ------------------------------------------------------------------ */
/*  Live assistant state collection                                    */
/* ------------------------------------------------------------------ */

export function collectLiveAssistantState(
  events: RealtimeEvent[],
  sessionId: string,
): LiveAssistantState {
  const orderedAssistantMessageIds: string[] = [];
  const knownAssistantIds = new Set<string>();
  const metaById = new Map<string, LiveAssistantMeta>();
  const textById = new Map<string, string>();
  const incompleteIds = new Set<string>();
  const sessionEvents = events
    .filter((item) => item.sessionId === sessionId)
    .slice()
    .reverse();

  const rememberMessageId = (messageId: string) => {
    if (!knownAssistantIds.has(messageId)) {
      orderedAssistantMessageIds.push(messageId);
      knownAssistantIds.add(messageId);
    }
  };

  const rememberAssistantMeta = (event: RealtimeEvent) => {
    const info = getRealtimeInfo(event);
    if (getRealtimeRawType(event) !== "message.updated" || !info) {
      return;
    }

    const messageId = asString(info.id);
    const role = asString(info.role);
    if (!messageId || role !== "assistant") {
      return;
    }

    metaById.set(messageId, {
      agent: asString(info.agent),
      createdAt:
        parseTimestamp(asRecord(info.time)?.created) ??
        parseTimestamp(asRecord(info.time)?.completed),
    });
    rememberMessageId(messageId);
    if (hasCompletedTimestamp(asRecord(info.time)?.completed)) {
      incompleteIds.delete(messageId);
      return;
    }
    incompleteIds.add(messageId);
  };

  const rememberAssistantText = (event: RealtimeEvent) => {
    const rawType = getRealtimeRawType(event);
    const part = getRealtimePart(event);

    if (rawType !== "message.updated" && rawType !== "message.part.updated") {
      return;
    }

    const messageId = asString(part?.messageID);
    if (!messageId || !knownAssistantIds.has(messageId)) {
      return;
    }
    const incomingText =
      typeof event.data.delta === "string" ? event.data.delta : asString(part?.text);
    if (asString(part?.type) !== "text" || typeof incomingText !== "string") {
      return;
    }

    textById.set(messageId, mergeStreamingText(textById.get(messageId), incomingText));
  };

  for (const event of sessionEvents) {
    rememberAssistantMeta(event);
  }

  for (const event of sessionEvents) {
    rememberAssistantText(event);
  }

  return {
    orderedAssistantMessageIds,
    metaById,
    textById,
    incompleteIds,
  };
}

export function createEmptyLiveAssistantState(): LiveAssistantState {
  return {
    orderedAssistantMessageIds: [],
    metaById: new Map<string, LiveAssistantMeta>(),
    textById: new Map<string, string>(),
    incompleteIds: new Set<string>(),
  };
}

/* ------------------------------------------------------------------ */
/*  Message normalization                                              */
/* ------------------------------------------------------------------ */

export function normalizeMessage(
  message: unknown,
  index: number,
  liveState: LiveAssistantState,
): TaskConversationMessageItem | null {
  const record = asRecord(message);
  const info = messageInfo(message);
  const parts = messageParts(message);
  const role = asString(info?.role) ?? asString(record?.role) ?? "system";
  const key = asString(info?.id) ?? asString(record?.id) ?? `${role}-${index}`;
  const toolCalls = normalizeToolCalls(parts);
  const persistedText =
    normalizeText(parts) ??
    asString(record?.text) ??
    asString(record?.content) ??
    asString(info?.preview);
  const liveText = liveState.textById.get(key);
  const text =
    liveText && liveText.length > (persistedText?.length ?? 0) ? liveText : persistedText;

  if (
    !text &&
    toolCalls.length === 0 &&
    !(role === "assistant" && liveState.incompleteIds.has(key))
  ) {
    return null;
  }

  return {
    key,
    role,
    agent: asString(info?.agent),
    text,
    toolCalls,
    createdAt:
      parseTimestamp(asRecord(info?.time)?.created) ??
      parseTimestamp(asRecord(info?.time)?.completed) ??
      parseTimestamp(record?.createdAt),
    raw: message,
    isStreaming: role === "assistant" && liveState.incompleteIds.has(key),
  };
}

/**
 * Normalize messages without live-state overlay (for static display, e.g. parallel candidates).
 */
export function normalizeSessionConversationItems(
  messages: unknown[],
): TaskConversationMessageItem[] {
  const liveState = createEmptyLiveAssistantState();

  return messages
    .map((message, index) => normalizeMessage(message, index, liveState))
    .filter((item): item is TaskConversationMessageItem => item != null)
    .filter((item) => item.role !== "system");
}
