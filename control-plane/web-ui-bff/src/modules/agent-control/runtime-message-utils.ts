function getAssistantMessageInfo(message: unknown): Record<string, unknown> | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  return "info" in message && typeof message.info === "object" && message.info
    ? (message.info as Record<string, unknown>)
    : undefined;
}

function getMessageParts(message: unknown): Record<string, unknown>[] {
  if (!message || typeof message !== "object") {
    return [];
  }

  return Array.isArray((message as { parts?: unknown }).parts)
    ? ((message as { parts: unknown[] }).parts as Record<string, unknown>[])
    : [];
}

function normalizeAssistantToolPartType(
  part: Record<string, unknown>,
): "tool_call" | "tool_result" | null {
  const rawType = typeof part.type === "string" ? part.type : "";
  if (rawType === "tool-call" || rawType === "tool_call") {
    return "tool_call";
  }
  if (rawType === "tool" || rawType === "tool-result" || rawType === "tool_result") {
    return "tool_result";
  }
  return null;
}

function readAssistantToolPartStatus(
  part: Record<string, unknown>,
  partType: "tool_call" | "tool_result",
): string | null {
  const rawState = part.state;
  const state =
    typeof rawState === "string" && rawState.trim()
      ? { status: rawState }
      : typeof rawState === "object" && rawState
        ? (rawState as Record<string, unknown>)
        : undefined;
  const rawStatus = typeof state?.status === "string" ? state.status.trim().toLowerCase() : "";
  if (rawStatus) {
    return rawStatus;
  }
  return partType === "tool_call" ? "running" : null;
}

function hasPendingAssistantToolContinuation(
  info: Record<string, unknown> | undefined,
  parts: Record<string, unknown>[],
): boolean {
  const finish = typeof info?.finish === "string" ? info.finish.trim().toLowerCase() : "";
  if (
    finish === "tool-calls" ||
    finish === "tool_calls" ||
    finish === "tool-call" ||
    finish === "tool_call"
  ) {
    return true;
  }

  return parts.some((part) => {
    const partType = normalizeAssistantToolPartType(part);
    if (!partType) {
      return false;
    }

    const status = readAssistantToolPartStatus(part, partType);
    if (partType === "tool_call") {
      return (
        status !== "completed" &&
        status !== "complete" &&
        status !== "failed" &&
        status !== "error" &&
        status !== "cancelled" &&
        status !== "stopped" &&
        status !== "terminated"
      );
    }

    return (
      status === "running" ||
      status === "queued" ||
      status === "pending" ||
      status === "streaming"
    );
  });
}

function readAssistantText(parts: Record<string, unknown>[]): string | undefined {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text).trim())
    .filter(Boolean)
    .join("\n\n");

  return text || undefined;
}

function isCompletedAssistantMessage(info: Record<string, unknown> | undefined): boolean {
  const time =
    typeof info?.time === "object" && info.time
      ? (info.time as Record<string, unknown>)
      : undefined;
  const completed = time?.completed;
  return typeof completed === "number" || typeof completed === "string";
}

function readAssistantTraceId(info: Record<string, unknown> | undefined): string | undefined {
  const id = info?.id;
  if (typeof id !== "string") {
    return undefined;
  }

  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readAssistantCompletedAt(info: Record<string, unknown> | undefined): number | undefined {
  const time =
    typeof info?.time === "object" && info.time
      ? (info.time as Record<string, unknown>)
      : undefined;
  const completed = time?.completed;

  if (typeof completed === "number" && Number.isFinite(completed)) {
    return completed;
  }

  if (typeof completed === "string") {
    const numeric = Number(completed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }

    const parsed = Date.parse(completed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function extractAssistantErrorMessage(
  info: Record<string, unknown> | undefined,
): string | undefined {
  const rawError = info?.error;
  if (typeof rawError === "string") {
    const trimmed = rawError.trim();
    return trimmed || undefined;
  }

  if (typeof rawError !== "object" || !rawError) {
    return undefined;
  }

  const error = rawError as Record<string, unknown>;
  const data =
    typeof error.data === "object" && error.data
      ? (error.data as Record<string, unknown>)
      : undefined;
  const message = data?.message ?? error.message ?? error.name;
  return typeof message === "string" && message.trim() ? message.trim() : undefined;
}

function readTokenMetric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function extractAssistantTokenUsage(info: Record<string, unknown> | undefined): number {
  const tokens =
    typeof info?.tokens === "object" && info.tokens
      ? (info.tokens as Record<string, unknown>)
      : undefined;
  if (!tokens) {
    return 0;
  }

  const total = readTokenMetric(tokens.total);
  if (total > 0) {
    return total;
  }

  const cache =
    typeof tokens.cache === "object" && tokens.cache
      ? (tokens.cache as Record<string, unknown>)
      : undefined;

  return (
    readTokenMetric(tokens.input) +
    readTokenMetric(tokens.output) +
    readTokenMetric(tokens.reasoning) +
    readTokenMetric(cache?.read) +
    readTokenMetric(cache?.write)
  );
}

function collectAssistantTokenUsage(messages: unknown[]) {
  let tokenUsed = 0;

  for (const message of messages) {
    const info = getAssistantMessageInfo(message);
    if (info?.role !== "assistant") {
      continue;
    }
    tokenUsed += extractAssistantTokenUsage(info);
  }

  return tokenUsed;
}

function shouldSkipAssistantMessage(
  info: Record<string, unknown> | undefined,
  options?: { minCompletedAt?: number },
) {
  if (info?.role !== "assistant") {
    return true;
  }

  const completedAt = readAssistantCompletedAt(info);
  return (
    options?.minCompletedAt !== undefined &&
    completedAt !== undefined &&
    completedAt < options.minCompletedAt
  );
}

function resolveAssistantResultState(messages: unknown[], options?: { minCompletedAt?: number }) {
  let fallbackText: string | undefined;
  let fallbackTraceId: string | undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const info = getAssistantMessageInfo(message);
    if (shouldSkipAssistantMessage(info, options)) {
      continue;
    }

    const traceId = readAssistantTraceId(info);
    const parts = getMessageParts(message);
    const text = readAssistantText(parts);
    if (text) {
      fallbackText = text;
      fallbackTraceId = traceId ?? fallbackTraceId;
    }

    const errorMessage = extractAssistantErrorMessage(info);
    if (errorMessage) {
      return {
        text: fallbackText ?? text,
        completed: false,
        failed: true,
        error: errorMessage,
        traceId: traceId ?? fallbackTraceId,
      };
    }

    if (text && isCompletedAssistantMessage(info) && !hasPendingAssistantToolContinuation(info, parts)) {
      return { text, completed: true, failed: false, error: undefined, traceId };
    }

    break;
  }

  return {
    text: fallbackText,
    completed: false,
    failed: false,
    error: undefined,
    traceId: fallbackTraceId,
  };
}

export function extractAssistantResultFromMessages(
  messages: unknown,
  options?: { minCompletedAt?: number },
): {
  text?: string;
  traceId?: string;
  completed: boolean;
  failed: boolean;
  error?: string;
  tokenUsed: number;
} {
  if (!Array.isArray(messages)) {
    return { completed: false, failed: false, tokenUsed: 0 };
  }

  const tokenUsed = collectAssistantTokenUsage(messages);
  const resolved = resolveAssistantResultState(messages, options);
  return {
    text: resolved.text,
    traceId: resolved.traceId,
    completed: resolved.completed,
    failed: resolved.failed,
    error: resolved.error,
    tokenUsed,
  };
}
