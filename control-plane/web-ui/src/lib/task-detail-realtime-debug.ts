import type { LiveAssistantState } from "./message-normalize";
import type { TaskDetailRefreshRequest } from "./task-detail-refresh-policy";
import type { TaskMessagePatchEffects } from "./task-message-patch-effects";
import type { TaskMessagePatchEvent } from "./task-message-patch-event";
import type { RealtimeEvent } from "../stores/realtime";
import { asRecord, asString } from "./message-normalize";

const TASK_REALTIME_DEBUG_STORAGE_KEY = "openerx:debug:task-realtime";

type TaskRealtimeDebugLevel = "info" | "warn" | "error";

function stringifyTaskRealtimeDetails(details: Record<string, unknown> | undefined) {
  if (!details) {
    return "";
  }

  try {
    return JSON.stringify(details);
  } catch {
    return "";
  }
}

function readTaskRealtimeDebugSetting() {
  if (typeof window === "undefined") {
    return import.meta.env.DEV ? "all" : "off";
  }

  try {
    return window.localStorage.getItem(TASK_REALTIME_DEBUG_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

function shouldEnableTaskRealtimeDebug(taskId?: string) {
  const rawSetting = readTaskRealtimeDebugSetting();
  const normalizedSetting = rawSetting.toLowerCase();

  if (normalizedSetting === "0" || normalizedSetting === "false" || normalizedSetting === "off") {
    return false;
  }

  if (
    normalizedSetting === "1" ||
    normalizedSetting === "true" ||
    normalizedSetting === "all" ||
    normalizedSetting === "*"
  ) {
    return true;
  }

  if (rawSetting) {
    return !taskId || rawSetting === taskId;
  }

  return import.meta.env.DEV;
}

function toTextPreview(text: string | undefined, maxLength = 80) {
  if (!text) {
    return undefined;
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

export function summarizeRealtimeEvent(event: RealtimeEvent | null | undefined) {
  if (!event) {
    return null;
  }

  const data = asRecord(event.data);
  const info = asRecord(data?.info);
  const part = asRecord(data?.part);
  const time = asRecord(info?.time);

  return {
    id: event.id,
    type: event.type,
    rawType: asString(data?.rawType),
    taskId: event.taskId,
    sessionId: event.sessionId,
    phaseId: event.phaseId,
    ts: event.ts,
    reason: asString(data?.reason),
    role: asString(info?.role) ?? asString(data?.role),
    messageId: asString(info?.id) ?? asString(data?.messageId),
    createdAt: asString(time?.created),
    completedAt: asString(time?.completed),
    partType: asString(part?.type),
    partMessageId: asString(part?.messageID),
    deltaPreview:
      typeof data?.delta === "string" ? toTextPreview(data.delta) : toTextPreview(asString(part?.text)),
    roundId: asString(data?.roundId),
    taskSessionId: asString(data?.taskSessionId),
    dataKeys: Object.keys(event.data ?? {}),
  };
}

export function summarizeTaskPatchEvent(event: TaskMessagePatchEvent | null | undefined) {
  if (!event) {
    return null;
  }

  return {
    eventId: event.eventId,
    kind: event.kind,
    rawEventKind: event.rawEventKind,
    taskId: event.taskId,
    sessionId: event.sessionId,
    phaseId: event.phaseId,
    messageId: "messageId" in event ? event.messageId : undefined,
    roundId: "roundId" in event ? event.roundId : undefined,
    taskSessionId: "taskSessionId" in event ? event.taskSessionId : undefined,
    reason: "reason" in event ? event.reason : undefined,
    snapshotVersion: "snapshotVersion" in event ? event.snapshotVersion : undefined,
    persistedThroughRevision:
      "persistedThroughRevision" in event ? event.persistedThroughRevision : undefined,
    expectedRevision: "expectedRevision" in event ? event.expectedRevision : undefined,
    initialTextPreview:
      "initialText" in event ? toTextPreview(event.initialText) : undefined,
    initialThinkingTextPreview:
      "initialThinkingText" in event ? toTextPreview(event.initialThinkingText) : undefined,
    partType: "partType" in event ? event.partType : undefined,
    textDeltaPreview: "textDelta" in event ? toTextPreview(event.textDelta) : undefined,
  };
}

export function summarizeTaskPatchEvents(events: TaskMessagePatchEvent[]) {
  return events.map((event) => summarizeTaskPatchEvent(event));
}

export function summarizeLiveAssistantState(state: LiveAssistantState | null | undefined) {
  if (!state) {
    return null;
  }

  return {
    orderedAssistantMessageIds: [...state.orderedAssistantMessageIds],
    incompleteIds: [...state.incompleteIds],
    textLengths: state.orderedAssistantMessageIds.reduce<Record<string, number>>((result, id) => {
      const text = state.textById.get(id);
      if (typeof text === "string") {
        result[id] = text.length;
      }
      return result;
    }, {}),
    thinkingLengths: state.orderedAssistantMessageIds.reduce<Record<string, number>>((result, id) => {
      const thinkingText = state.thinkingById.get(id);
      if (typeof thinkingText === "string") {
        result[id] = thinkingText.length;
      }
      return result;
    }, {}),
    previews: state.orderedAssistantMessageIds.reduce<Record<string, string | undefined>>(
      (result, id) => {
        result[id] = toTextPreview(state.textById.get(id));
        return result;
      },
      {},
    ),
    thinkingPreviews: state.orderedAssistantMessageIds.reduce<
      Record<string, string | undefined>
    >((result, id) => {
      result[id] = toTextPreview(state.thinkingById.get(id));
      return result;
    }, {}),
  };
}

export function summarizeTaskRefreshRequest(
  request: TaskDetailRefreshRequest | null | undefined,
) {
  if (!request) {
    return null;
  }

  return {
    eventId: request.eventId,
    reason: request.reason,
    targets: request.targets,
    shouldBumpTraceRefreshKey: request.shouldBumpTraceRefreshKey,
  };
}

export function summarizeTaskPatchEffects(
  effects: TaskMessagePatchEffects | null | undefined,
) {
  if (!effects) {
    return null;
  }

  return {
    updatesLiveAssistantState: effects.updatesLiveAssistantState,
    shouldRefreshCanonicalMessages: effects.shouldRefreshCanonicalMessages,
    shouldRefreshTaskDetailMessages: effects.shouldRefreshTaskDetailMessages,
    shouldScheduleTaskDetailRefresh: effects.shouldScheduleTaskDetailRefresh,
    shouldBumpTaskDetailTraceRefreshKey: effects.shouldBumpTaskDetailTraceRefreshKey,
    shouldRefreshMonitorSummary: effects.shouldRefreshMonitorSummary,
  };
}

export function traceTaskDetailRealtime(
  stage: string,
  details?: Record<string, unknown>,
  options?: { level?: TaskRealtimeDebugLevel; taskId?: string },
) {
  const taskId = options?.taskId ?? (typeof details?.taskId === "string" ? details.taskId : undefined);
  if (!shouldEnableTaskRealtimeDebug(taskId)) {
    return;
  }

  const level = options?.level ?? "info";
  const method =
    level === "warn" ? console.warn : level === "error" ? console.error : console.info;
  const serializedDetails = stringifyTaskRealtimeDetails(details);

  if (serializedDetails) {
    method(`[task-realtime] ${stage} ${serializedDetails}`);
    return;
  }

  method(`[task-realtime] ${stage}`, details ?? {});
}

export function measureTaskRealtimeDuration(startedAt: number) {
  const duration = performance.now() - startedAt;
  return Math.round(duration * 10) / 10;
}
