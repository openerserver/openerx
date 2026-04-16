import type { RealtimeEvent } from "../../types/events";

const MAX_STRING_LENGTH = 180;
const MAX_ARRAY_ITEMS = 10;
const MAX_RECORD_ENTRIES = 20;

function isRealtimeDebugEnabled() {
  const raw = process.env.OPENERX_REALTIME_DEBUG?.trim().toLowerCase();
  if (!raw) {
    return process.env.NODE_ENV !== "production";
  }

  return !(raw === "0" || raw === "false" || raw === "off");
}

const realtimeDebugEnabled = isRealtimeDebugEnabled();
const realtimeDebugTaskId = process.env.OPENERX_REALTIME_DEBUG_TASK_ID?.trim();
const realtimeDebugSessionId = process.env.OPENERX_REALTIME_DEBUG_SESSION_ID?.trim();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function summarizeString(value: string) {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH)}…(${value.length})`;
}

function summarizeValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return summarizeString(value);
  }

  if (Array.isArray(value)) {
    if (depth >= 2) {
      return `[array:${value.length}]`;
    }

    return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => summarizeValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= 2) {
      const record = value as Record<string, unknown>;
      return `[object:${Object.keys(record).length}]`;
    }

    const record = value as Record<string, unknown>;
    const summaryEntries = Object.entries(record)
      .filter(([, entry]) => entry !== undefined)
      .slice(0, MAX_RECORD_ENTRIES)
      .map(([key, entry]) => [key, summarizeValue(entry, depth + 1)]);
    return Object.fromEntries(summaryEntries);
  }

  return String(value);
}

function readMessageId(data: Record<string, unknown>) {
  const info = asRecord(data.info);
  const part = asRecord(data.part);
  const message = asRecord(data.message);
  const messageInfo = asRecord(message?.info);

  const candidates = [
    data.messageId,
    data.messageID,
    data.id,
    info?.id,
    part?.messageID,
    part?.messageId,
    message?.id,
    messageInfo?.id,
  ];

  for (const candidate of candidates) {
    const resolved = asString(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function readRole(data: Record<string, unknown>) {
  const info = asRecord(data.info);
  const message = asRecord(data.message);
  const messageInfo = asRecord(message?.info);
  return (
    asString(data.role) ??
    asString(info?.role) ??
    asString(message?.role) ??
    asString(messageInfo?.role)
  );
}

function readPartType(data: Record<string, unknown>) {
  const part = asRecord(data.part);
  return asString(data.partType) ?? asString(part?.type);
}

function readDeltaPreview(data: Record<string, unknown>) {
  const part = asRecord(data.part);
  const delta = asString(data.delta) ?? asString(part?.text) ?? asString(part?.content);
  return delta ? summarizeString(delta) : undefined;
}

function shouldTrace(detail: Record<string, unknown>) {
  if (!realtimeDebugEnabled) {
    return false;
  }

  if (!realtimeDebugTaskId && !realtimeDebugSessionId) {
    return true;
  }

  const taskId = asString(detail.taskId);
  const sessionId = asString(detail.sessionId);
  if (realtimeDebugTaskId && taskId === realtimeDebugTaskId) {
    return true;
  }
  if (realtimeDebugSessionId && sessionId === realtimeDebugSessionId) {
    return true;
  }

  return false;
}

export function summarizeRealtimeEvent(event: RealtimeEvent): Record<string, unknown> {
  return {
    eventId: event.id,
    eventType: event.type,
    rawType: asString(event.data.rawType),
    taskId: event.taskId,
    projectId: event.projectId,
    phaseId: event.phaseId,
    sessionId: event.sessionId,
    agentRunId: event.agentRunId,
    ts: event.ts,
    role: readRole(event.data),
    messageId: readMessageId(event.data),
    partType: readPartType(event.data),
    deltaPreview: readDeltaPreview(event.data),
    dataKeys: Object.keys(event.data).slice(0, MAX_RECORD_ENTRIES),
  };
}

export function traceServerRealtime(stage: string, detail: Record<string, unknown>) {
  if (!shouldTrace(detail)) {
    return;
  }

  console.log(`[task-realtime/server] ${stage} ${JSON.stringify(summarizeValue(detail))}`);
}
