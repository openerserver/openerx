interface MinimalExecutionTraceMessage {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  raw?: unknown;
}

interface MinimalExecutionTraceTimelineItem {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  completedAt?: string | null;
  raw?: unknown;
}

interface MinimalExecutionTraceTimelineMeta {
  cacheState?: "none" | "partial" | "complete";
}

interface MinimalExecutionTraceSnapshot {
  lastActivityAt?: string | null;
}

interface MinimalExecutionTracePayload {
  messages?: MinimalExecutionTraceMessage[];
  timeline?: MinimalExecutionTraceTimelineItem[];
  timelineMeta?: MinimalExecutionTraceTimelineMeta;
  finalPrompt?: string | null;
  latestResponse?: string | null;
  snapshot?: MinimalExecutionTraceSnapshot | null;
}

type TraceSourceItem = MinimalExecutionTraceMessage | MinimalExecutionTraceTimelineItem;

const NARRATIVE_TIMELINE_ROLES = new Set([
  "user",
  "assistant",
  "tool",
  "tool-request",
  "tool-result",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasLegacySessionMessageShape(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(record && Array.isArray(record.parts) && asRecord(record.info));
}

function toLegacyTimestamp(value?: string | null): number | string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : parsed;
}

function buildLegacySessionMessage(params: {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  completedAt?: string | null;
  raw?: unknown;
}) {
  const rawRecord = asRecord(params.raw);
  const syntheticInfo: Record<string, unknown> = {
    ...(asRecord(rawRecord?.info) ?? {}),
    id: params.id,
    role: params.role,
    time: {
      ...(asRecord(asRecord(rawRecord?.info)?.time) ?? {}),
      created: toLegacyTimestamp(params.createdAt),
      completed: toLegacyTimestamp(params.completedAt ?? undefined),
    },
    preview: params.text,
  };

  return {
    ...(rawRecord ?? {}),
    id: typeof rawRecord?.id === "string" ? rawRecord.id : params.id,
    role: params.role,
    text: params.text,
    createdAt: params.createdAt,
    info: syntheticInfo,
    parts:
      Array.isArray(rawRecord?.parts) && rawRecord.parts.length > 0
        ? rawRecord.parts
        : params.text
          ? [{ type: "text", text: params.text }]
          : [],
  };
}

function buildLegacyMessageFromTimelineItem(item: MinimalExecutionTraceTimelineItem) {
  if (hasLegacySessionMessageShape(item.raw)) {
    return item.raw;
  }

  return buildLegacySessionMessage({
    id: item.id,
    role: item.role,
    text: item.text,
    createdAt: item.createdAt,
    completedAt: item.completedAt,
    raw: item.raw,
  });
}

function buildLegacyMessageFromExecutionTraceMessage(item: MinimalExecutionTraceMessage) {
  if (hasLegacySessionMessageShape(item.raw)) {
    return item.raw;
  }

  return buildLegacySessionMessage({
    id: item.id,
    role: item.role,
    text: item.text,
    createdAt: item.createdAt,
    raw: item.raw,
  });
}

function resolveSyntheticAssistantCreatedAt(trace: MinimalExecutionTracePayload) {
  const timeline = Array.isArray(trace.timeline) ? trace.timeline : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.completedAt || item?.createdAt) {
      return item.completedAt ?? item.createdAt;
    }
  }

  return typeof trace.snapshot?.lastActivityAt === "string"
    ? trace.snapshot.lastActivityAt
    : undefined;
}

function resolveSyntheticUserCreatedAt(trace: MinimalExecutionTracePayload) {
  const timeline = Array.isArray(trace.timeline) ? trace.timeline : [];
  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index];
    if (item?.createdAt || item?.completedAt) {
      return item.createdAt ?? item.completedAt;
    }
  }

  const messages = Array.isArray(trace.messages) ? trace.messages : [];
  for (let index = 0; index < messages.length; index += 1) {
    const item = messages[index];
    if (item?.createdAt) {
      return item.createdAt;
    }
  }

  return undefined;
}

function buildSyntheticTraceMessage(params: {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
  completedAt?: string;
}) {
  return buildLegacySessionMessage({
    id: params.id,
    role: params.role,
    text: params.text,
    createdAt: params.createdAt,
    completedAt: params.completedAt,
    raw: {
      synthetic: true,
      info: {
        id: params.id,
        role: params.role,
        time: {
          created: params.createdAt,
          completed: params.completedAt,
        },
      },
      parts: [{ type: "text", text: params.text }],
    },
  });
}

function buildSyntheticUserMessage(trace: MinimalExecutionTracePayload) {
  const finalPrompt = typeof trace.finalPrompt === "string" ? trace.finalPrompt.trim() : "";
  if (!finalPrompt) {
    return null;
  }

  return buildSyntheticTraceMessage({
    id: "synthetic-final-prompt",
    role: "user",
    text: finalPrompt,
    createdAt: resolveSyntheticUserCreatedAt(trace) ?? undefined,
  });
}

function buildSyntheticAssistantMessage(trace: MinimalExecutionTracePayload) {
  const latestResponse =
    typeof trace.latestResponse === "string" ? trace.latestResponse.trim() : "";
  if (!latestResponse) {
    return null;
  }

  const completedAt = resolveSyntheticAssistantCreatedAt(trace);
  return buildSyntheticTraceMessage({
    id: "synthetic-latest-response",
    role: "assistant",
    text: latestResponse,
    createdAt: completedAt,
    completedAt,
  });
}

function buildLegacyMessageFromSourceItem(item: TraceSourceItem) {
  return "completedAt" in item
    ? buildLegacyMessageFromTimelineItem(item)
    : buildLegacyMessageFromExecutionTraceMessage(item);
}

function extractLegacyMessageRole(message: unknown) {
  const record = asRecord(message);
  if (typeof record?.role === "string" && record.role.trim().length > 0) {
    return record.role;
  }

  const info = asRecord(record?.info);
  return typeof info?.role === "string" ? info.role : "unknown";
}

function isNarrativeTimelineItem(item: MinimalExecutionTraceTimelineItem) {
  return (
    NARRATIVE_TIMELINE_ROLES.has(item.role) &&
    typeof item.text === "string" &&
    item.text.trim().length > 0
  );
}

export function buildSessionMessagesFromExecutionTrace(
  trace: MinimalExecutionTracePayload,
  options?: { includeLineage?: boolean },
) {
  const includeLineage = options?.includeLineage === true;
  const timeline = Array.isArray(trace.timeline) ? trace.timeline : [];
  const narrativeTimeline = timeline.filter(isNarrativeTimelineItem);
  const messages = Array.isArray(trace.messages) ? trace.messages : [];
  const sourceItems: TraceSourceItem[] =
    includeLineage && narrativeTimeline.length > 0
      ? narrativeTimeline
      : messages.length > 0
        ? messages
        : narrativeTimeline.length > 0 && trace.timelineMeta?.cacheState === "complete"
          ? narrativeTimeline
          : [];

  const legacyMessages = sourceItems.map((item) => buildLegacyMessageFromSourceItem(item));
  const hasUser = legacyMessages.some((message) => extractLegacyMessageRole(message) === "user");
  const hasAssistant = legacyMessages.some(
    (message) => extractLegacyMessageRole(message) === "assistant",
  );

  if (hasUser && hasAssistant) {
    return legacyMessages;
  }

  const syntheticUser = hasUser ? null : buildSyntheticUserMessage(trace);
  const syntheticAssistant = hasAssistant ? null : buildSyntheticAssistantMessage(trace);

  return [
    ...(syntheticUser ? [syntheticUser] : []),
    ...legacyMessages,
    ...(syntheticAssistant ? [syntheticAssistant] : []),
  ];
}
