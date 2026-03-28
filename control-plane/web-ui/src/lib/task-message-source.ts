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

interface MinimalExecutionTracePayload {
  messages?: MinimalExecutionTraceMessage[];
  timeline?: MinimalExecutionTraceTimelineItem[];
  timelineMeta?: MinimalExecutionTraceTimelineMeta;
}

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

function isNarrativeTimelineItem(item: MinimalExecutionTraceTimelineItem) {
  return NARRATIVE_TIMELINE_ROLES.has(item.role) && typeof item.text === "string" && item.text.trim().length > 0;
}

export function buildSessionMessagesFromExecutionTrace(
  trace: MinimalExecutionTracePayload,
  options?: { includeLineage?: boolean },
) {
  const includeLineage = options?.includeLineage === true;
  const timeline = Array.isArray(trace.timeline) ? trace.timeline : [];
  const narrativeTimeline = timeline.filter(isNarrativeTimelineItem);
  const messages = Array.isArray(trace.messages) ? trace.messages : [];

  if (includeLineage && narrativeTimeline.length > 0) {
    return narrativeTimeline.map((item) => buildLegacyMessageFromTimelineItem(item));
  }

  if (messages.length > 0) {
    return messages.map((item) => buildLegacyMessageFromExecutionTraceMessage(item));
  }

  if (narrativeTimeline.length > 0 && trace.timelineMeta?.cacheState === "complete") {
    return narrativeTimeline.map((item) => buildLegacyMessageFromTimelineItem(item));
  }

  return [];
}
