import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ContinueLatencyStage =
  | "route-received"
  | "runtime-continue-entered"
  | "runtime-handle-ready"
  | "runtime-model-ready"
  | "runtime-agent-run-ready"
  | "runtime-dispatch-begin"
  | "runtime-dispatch-resolved";

type ContinueLatencyTrace = {
  traceId: string;
  taskId?: string;
  sessionId: string;
  promptLength: number;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  completedAtMs?: number;
  wasRunning?: boolean;
  dispatchMode?: "prompt" | "followUp";
  stages: Partial<Record<ContinueLatencyStage, number>>;
  firstRawRuntimeEventType?: string;
  firstRawRuntimeEventAtMs?: number;
  firstAssistantRuntimeEventType?: string;
  firstAssistantRuntimeEventAtMs?: number;
  firstAssistantThinkingRuntimeEventType?: string;
  firstAssistantThinkingRuntimeEventAtMs?: number;
  firstAssistantTextRuntimeEventType?: string;
  firstAssistantTextRuntimeEventAtMs?: number;
  firstTaskDomainEventType?: string;
  firstTaskDomainEventAtMs?: number;
  firstTaskMessageEventType?: string;
  firstTaskMessageEventAtMs?: number;
  effectiveModelRoute?: string;
  effectiveThinkingLevel?: string;
  effectiveFollowUpMode?: string;
  effectiveSessionFile?: string;
  effectiveMessageCount?: number;
  effectivePendingMessageCount?: number;
  effectiveIsStreaming?: boolean;
  effectiveAutoCompactionEnabled?: boolean;
};

const ACTIVE_TRACE_TTL_MS = 10 * 60_000;
const COMPLETED_TRACE_TTL_MS = 60_000;
const ASSISTANT_RUNTIME_EVENT_TYPES = new Set(["message_start", "message_update", "message_end"]);
const TASK_MESSAGE_EVENT_TYPES = new Set(["task.message.updated", "task.message.delta"]);
const THINKING_PART_TYPES = new Set(["thinking", "reasoning"]);
const continueLatencyTraces = new Map<string, ContinueLatencyTrace>();
const DEFAULT_CONTINUE_LATENCY_LOG_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../tmp/continue-latency.log",
);

let didReportContinueLatencyLogWriteFailure = false;

function isTruthyEnvValue(value?: string) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isFalsyEnvValue(value?: string) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off";
}

function isContinueLatencyTracingEnabled() {
  const configured = process.env.OPENERX_CONTINUE_LATENCY_DEBUG;
  if (isTruthyEnvValue(configured)) {
    return true;
  }
  if (isFalsyEnvValue(configured)) {
    return false;
  }

  return process.env.NODE_ENV !== "production";
}

export function shouldTraceContinueLatency() {
  return isContinueLatencyTracingEnabled();
}

function resolveContinueLatencyLogFilePath() {
  const configured = process.env.OPENERX_CONTINUE_LATENCY_LOG_FILE?.trim();
  if (configured) {
    if (isFalsyEnvValue(configured)) {
      return undefined;
    }
    if (isTruthyEnvValue(configured)) {
      return DEFAULT_CONTINUE_LATENCY_LOG_FILE;
    }
    return resolve(process.cwd(), configured);
  }

  if (process.env.NODE_ENV === "test") {
    return undefined;
  }

  return DEFAULT_CONTINUE_LATENCY_LOG_FILE;
}

export function getContinueLatencyLogFilePath() {
  return resolveContinueLatencyLogFilePath();
}

function persistContinueLatencyLog(line: string) {
  const logFilePath = resolveContinueLatencyLogFilePath();
  if (!logFilePath) {
    return;
  }

  try {
    mkdirSync(dirname(logFilePath), { recursive: true });
    appendFileSync(logFilePath, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch (error) {
    if (didReportContinueLatencyLogWriteFailure) {
      return;
    }
    didReportContinueLatencyLogWriteFailure = true;
    console.warn(
      `[continue-latency] stage=file-log-write-failed path=${logFilePath} error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function cleanupExpiredContinueLatencyTraces(now = Date.now()) {
  for (const [sessionId, trace] of continueLatencyTraces.entries()) {
    const expiresAt = trace.completedAtMs
      ? trace.completedAtMs + COMPLETED_TRACE_TTL_MS
      : trace.startedAtMs + ACTIVE_TRACE_TTL_MS;
    if (expiresAt <= now) {
      continueLatencyTraces.delete(sessionId);
    }
  }
}

function diffMs(endAt?: number, startAt?: number) {
  if (!Number.isFinite(endAt) || !Number.isFinite(startAt)) {
    return undefined;
  }

  return Math.max(0, Math.round((endAt as number) - (startAt as number)));
}

function formatContinueLatencyLog(trace: ContinueLatencyTrace, stage: string, detail: Record<string, unknown>) {
  const parts = [
    `[continue-latency] trace=${trace.traceId}`,
    `session=${trace.sessionId}`,
    trace.taskId ? `task=${trace.taskId}` : undefined,
    `stage=${stage}`,
    ...Object.entries(detail).flatMap(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return [];
      }
      return `${key}=${String(value)}`;
    }),
  ].filter(Boolean);

  const line = parts.join(" ");
  console.log(line);
  persistContinueLatencyLog(line);
}

function logContinueLatencyStage(trace: ContinueLatencyTrace, stage: string, detail: Record<string, unknown> = {}) {
  if (!isContinueLatencyTracingEnabled()) {
    return;
  }

  formatContinueLatencyLog(trace, stage, detail);
}

function logContinueLatencySummary(trace: ContinueLatencyTrace) {
  if (!isContinueLatencyTracingEnabled()) {
    return;
  }

  formatContinueLatencyLog(trace, "summary", {
    promptLength: trace.promptLength,
    wasRunning: trace.wasRunning,
    dispatchMode: trace.dispatchMode,
    routeToRuntimeEnteredMs: diffMs(
      trace.stages["runtime-continue-entered"],
      trace.stages["route-received"],
    ),
    runtimeHandleReadyMs: diffMs(
      trace.stages["runtime-handle-ready"],
      trace.stages["runtime-continue-entered"],
    ),
    runtimeModelReadyMs: diffMs(
      trace.stages["runtime-model-ready"],
      trace.stages["runtime-handle-ready"],
    ),
    runtimeAgentRunReadyMs: diffMs(
      trace.stages["runtime-agent-run-ready"],
      trace.stages["runtime-model-ready"] ?? trace.stages["runtime-handle-ready"],
    ),
    runtimeDispatchCallMs: diffMs(
      trace.stages["runtime-dispatch-resolved"],
      trace.stages["runtime-dispatch-begin"],
    ),
    routeToDispatchResolvedMs: diffMs(
      trace.stages["runtime-dispatch-resolved"],
      trace.stages["route-received"],
    ),
    routeToFirstRawRuntimeEventMs: diffMs(
      trace.firstRawRuntimeEventAtMs,
      trace.stages["route-received"],
    ),
    dispatchResolvedToFirstRawRuntimeEventMs: diffMs(
      trace.firstRawRuntimeEventAtMs,
      trace.stages["runtime-dispatch-resolved"],
    ),
    routeToFirstAssistantRuntimeEventMs: diffMs(
      trace.firstAssistantRuntimeEventAtMs,
      trace.stages["route-received"],
    ),
    firstRawToFirstAssistantRuntimeEventMs: diffMs(
      trace.firstAssistantRuntimeEventAtMs,
      trace.firstRawRuntimeEventAtMs,
    ),
    routeToFirstAssistantThinkingRuntimeEventMs: diffMs(
      trace.firstAssistantThinkingRuntimeEventAtMs,
      trace.stages["route-received"],
    ),
    firstAssistantRuntimeToFirstAssistantThinkingRuntimeEventMs: diffMs(
      trace.firstAssistantThinkingRuntimeEventAtMs,
      trace.firstAssistantRuntimeEventAtMs,
    ),
    routeToFirstAssistantTextRuntimeEventMs: diffMs(
      trace.firstAssistantTextRuntimeEventAtMs,
      trace.stages["route-received"],
    ),
    firstAssistantRuntimeToFirstAssistantTextRuntimeEventMs: diffMs(
      trace.firstAssistantTextRuntimeEventAtMs,
      trace.firstAssistantRuntimeEventAtMs,
    ),
    routeToFirstTaskDomainEventMs: diffMs(
      trace.firstTaskDomainEventAtMs,
      trace.stages["route-received"],
    ),
    routeToFirstTaskMessageEventMs: diffMs(
      trace.firstTaskMessageEventAtMs,
      trace.stages["route-received"],
    ),
    firstAssistantToFirstTaskMessageEventMs: diffMs(
      trace.firstTaskMessageEventAtMs,
      trace.firstAssistantRuntimeEventAtMs,
    ),
    firstRawRuntimeEvent: trace.firstRawRuntimeEventType,
    firstAssistantRuntimeEvent: trace.firstAssistantRuntimeEventType,
    firstAssistantThinkingRuntimeEvent: trace.firstAssistantThinkingRuntimeEventType,
    firstAssistantTextRuntimeEvent: trace.firstAssistantTextRuntimeEventType,
    firstTaskDomainEvent: trace.firstTaskDomainEventType,
    firstTaskMessageEvent: trace.firstTaskMessageEventType,
    effectiveModel: trace.effectiveModelRoute,
    effectiveThinkingLevel: trace.effectiveThinkingLevel,
    effectiveFollowUpMode: trace.effectiveFollowUpMode,
    effectiveSessionFile: trace.effectiveSessionFile,
    effectiveMessageCount: trace.effectiveMessageCount,
    effectivePendingMessageCount: trace.effectivePendingMessageCount,
    effectiveIsStreaming: trace.effectiveIsStreaming,
    effectiveAutoCompactionEnabled: trace.effectiveAutoCompactionEnabled,
  });
}

function formatRuntimeEventLabel(eventType: string, assistantMessageType?: string) {
  if (!assistantMessageType || eventType !== "message_update") {
    return eventType;
  }

  return `${eventType}:${assistantMessageType}`;
}

function getOrCreateContinueLatencyTrace(args: {
  sessionId: string;
  taskId?: string;
  promptLength?: number;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  cleanupExpiredContinueLatencyTraces(now);

  const existing = continueLatencyTraces.get(args.sessionId);
  if (existing) {
    existing.lastUpdatedAtMs = now;
    if (args.taskId) {
      existing.taskId = args.taskId;
    }
    if (typeof args.promptLength === "number") {
      existing.promptLength = args.promptLength;
    }
    return existing;
  }

  const trace: ContinueLatencyTrace = {
    traceId: crypto.randomUUID(),
    taskId: args.taskId,
    sessionId: args.sessionId,
    promptLength: args.promptLength ?? 0,
    startedAtMs: now,
    lastUpdatedAtMs: now,
    stages: {},
  };
  continueLatencyTraces.set(args.sessionId, trace);
  return trace;
}

export function beginContinueLatencyTrace(args: {
  sessionId: string;
  taskId?: string;
  prompt: string;
}) {
  const now = Date.now();
  const trace: ContinueLatencyTrace = {
    traceId: crypto.randomUUID(),
    taskId: args.taskId,
    sessionId: args.sessionId,
    promptLength: args.prompt.length,
    startedAtMs: now,
    lastUpdatedAtMs: now,
    stages: {
      "route-received": now,
    },
  };

  cleanupExpiredContinueLatencyTraces(now);
  continueLatencyTraces.set(args.sessionId, trace);
  logContinueLatencyStage(trace, "route-received", {
    promptLength: trace.promptLength,
  });
  return trace.traceId;
}

export function handoffContinueLatencyTrace(args: {
  fromSessionId: string;
  toSessionId: string;
  taskId?: string;
  promptLength?: number;
}) {
  const now = Date.now();
  cleanupExpiredContinueLatencyTraces(now);

  const trace = continueLatencyTraces.get(args.fromSessionId);
  if (!trace) {
    return undefined;
  }

  continueLatencyTraces.delete(args.fromSessionId);
  trace.sessionId = args.toSessionId;
  trace.lastUpdatedAtMs = now;
  if (args.taskId) {
    trace.taskId = args.taskId;
  }
  if (typeof args.promptLength === "number") {
    trace.promptLength = args.promptLength;
  }
  continueLatencyTraces.set(args.toSessionId, trace);

  logContinueLatencyStage(trace, "session-handoff", {
    fromSessionId: args.fromSessionId,
    toSessionId: args.toSessionId,
    elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
  });

  return trace.traceId;
}

export function markContinueLatencyStage(
  sessionId: string,
  stage: ContinueLatencyStage,
  detail: {
    taskId?: string;
    promptLength?: number;
    wasRunning?: boolean;
    dispatchMode?: "prompt" | "followUp";
  } = {},
) {
  const now = Date.now();
  const trace = getOrCreateContinueLatencyTrace({
    sessionId,
    taskId: detail.taskId,
    promptLength: detail.promptLength,
    now,
  });

  if (trace.stages[stage]) {
    return trace.traceId;
  }

  trace.stages[stage] = now;
  trace.lastUpdatedAtMs = now;
  if (typeof detail.wasRunning === "boolean") {
    trace.wasRunning = detail.wasRunning;
  }
  if (detail.dispatchMode) {
    trace.dispatchMode = detail.dispatchMode;
  }

  logContinueLatencyStage(trace, stage, {
    elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
    sinceRuntimeEnteredMs: diffMs(now, trace.stages["runtime-continue-entered"]),
    wasRunning: trace.wasRunning,
    dispatchMode: trace.dispatchMode,
  });
  return trace.traceId;
}

export function noteContinueLatencyRuntimeEvent(
  sessionId: string,
  eventType: string,
  detail: {
    role?: string;
    assistantMessageType?: string;
  } = {},
) {
  const now = Date.now();
  const trace = continueLatencyTraces.get(sessionId);
  if (!trace) {
    return undefined;
  }

  trace.lastUpdatedAtMs = now;
  const runtimeEventLabel = formatRuntimeEventLabel(eventType, detail.assistantMessageType);
  if (!trace.firstRawRuntimeEventAtMs) {
    trace.firstRawRuntimeEventAtMs = now;
    trace.firstRawRuntimeEventType = runtimeEventLabel;
    logContinueLatencyStage(trace, "first-raw-runtime-event", {
      eventType: runtimeEventLabel,
      role: detail.role,
      elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
      sinceDispatchResolvedMs: diffMs(now, trace.stages["runtime-dispatch-resolved"]),
    });
  }

  const isAssistantRuntimeEvent =
    detail.role === "assistant" && ASSISTANT_RUNTIME_EVENT_TYPES.has(eventType);
  if (!trace.firstAssistantRuntimeEventAtMs && isAssistantRuntimeEvent) {
    trace.firstAssistantRuntimeEventAtMs = now;
    trace.firstAssistantRuntimeEventType = runtimeEventLabel;
    logContinueLatencyStage(trace, "first-assistant-runtime-event", {
      eventType: runtimeEventLabel,
      elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
      sinceFirstRawRuntimeEventMs: diffMs(now, trace.firstRawRuntimeEventAtMs),
    });
  }

  if (
    !trace.firstAssistantThinkingRuntimeEventAtMs &&
    detail.role === "assistant" &&
    detail.assistantMessageType === "thinking_delta"
  ) {
    trace.firstAssistantThinkingRuntimeEventAtMs = now;
    trace.firstAssistantThinkingRuntimeEventType = runtimeEventLabel;
    logContinueLatencyStage(trace, "first-assistant-thinking-runtime-event", {
      eventType: runtimeEventLabel,
      elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
      sinceFirstAssistantRuntimeEventMs: diffMs(now, trace.firstAssistantRuntimeEventAtMs),
    });
  }

  if (
    !trace.firstAssistantTextRuntimeEventAtMs &&
    detail.role === "assistant" &&
    detail.assistantMessageType === "text_delta"
  ) {
    trace.firstAssistantTextRuntimeEventAtMs = now;
    trace.firstAssistantTextRuntimeEventType = runtimeEventLabel;
    logContinueLatencyStage(trace, "first-assistant-text-runtime-event", {
      eventType: runtimeEventLabel,
      elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
      sinceFirstAssistantRuntimeEventMs: diffMs(now, trace.firstAssistantRuntimeEventAtMs),
    });
  }

  return trace.traceId;
}

export function noteContinueLatencyStateSnapshot(
  sessionId: string,
  stage:
    | "runtime-state-handle-ready"
    | "runtime-state-after-model-set"
    | "runtime-state-before-dispatch",
  detail: {
    modelRoute?: string;
    thinkingLevel?: string;
    followUpMode?: string;
    sessionFile?: string;
    messageCount?: number;
    pendingMessageCount?: number;
    isStreaming?: boolean;
    autoCompactionEnabled?: boolean;
    requestedModelRoute?: string;
  },
) {
  const now = Date.now();
  const trace = continueLatencyTraces.get(sessionId);
  if (!trace) {
    return undefined;
  }

  trace.lastUpdatedAtMs = now;
  if (detail.modelRoute) {
    trace.effectiveModelRoute = detail.modelRoute;
  }
  if (detail.thinkingLevel) {
    trace.effectiveThinkingLevel = detail.thinkingLevel;
  }
  if (detail.followUpMode) {
    trace.effectiveFollowUpMode = detail.followUpMode;
  }
  if (detail.sessionFile) {
    trace.effectiveSessionFile = detail.sessionFile;
  }
  if (typeof detail.messageCount === "number") {
    trace.effectiveMessageCount = detail.messageCount;
  }
  if (typeof detail.pendingMessageCount === "number") {
    trace.effectivePendingMessageCount = detail.pendingMessageCount;
  }
  if (typeof detail.isStreaming === "boolean") {
    trace.effectiveIsStreaming = detail.isStreaming;
  }
  if (typeof detail.autoCompactionEnabled === "boolean") {
    trace.effectiveAutoCompactionEnabled = detail.autoCompactionEnabled;
  }

  logContinueLatencyStage(trace, stage, {
    elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
    sinceRuntimeEnteredMs: diffMs(now, trace.stages["runtime-continue-entered"]),
    modelRoute: detail.modelRoute,
    requestedModelRoute: detail.requestedModelRoute,
    thinkingLevel: detail.thinkingLevel,
    followUpMode: detail.followUpMode,
    sessionFile: detail.sessionFile,
    messageCount: detail.messageCount,
    pendingMessageCount: detail.pendingMessageCount,
    isStreaming: detail.isStreaming,
    autoCompactionEnabled: detail.autoCompactionEnabled,
  });

  return trace.traceId;
}

export function noteContinueLatencyTaskDomainEvent(
  sessionId: string,
  eventType: string,
  detail: {
    role?: string;
    partType?: string;
  } = {},
) {
  const now = Date.now();
  const trace = continueLatencyTraces.get(sessionId);
  if (!trace) {
    return undefined;
  }

  trace.lastUpdatedAtMs = now;
  if (!trace.firstTaskDomainEventAtMs) {
    trace.firstTaskDomainEventAtMs = now;
    trace.firstTaskDomainEventType = eventType;
    logContinueLatencyStage(trace, "first-task-domain-event", {
      eventType,
      elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
      sinceFirstAssistantRuntimeEventMs: diffMs(now, trace.firstAssistantRuntimeEventAtMs),
    });
  }

  const isAssistantTaskMessageEvent =
    (eventType === "task.message.updated" && detail.role === "assistant") ||
    (eventType === "task.message.delta" && detail.partType === "text") ||
    (eventType === "task.message.delta" && THINKING_PART_TYPES.has(detail.partType ?? ""));

  if (
    !trace.firstTaskMessageEventAtMs &&
    TASK_MESSAGE_EVENT_TYPES.has(eventType) &&
    isAssistantTaskMessageEvent
  ) {
    trace.firstTaskMessageEventAtMs = now;
    trace.firstTaskMessageEventType =
      eventType === "task.message.delta" && detail.partType
        ? `${eventType}:${detail.partType}`
        : eventType;
    trace.completedAtMs = now;
    logContinueLatencyStage(trace, "first-task-message-event", {
      eventType: trace.firstTaskMessageEventType,
      role: detail.role,
      partType: detail.partType,
      elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
      sinceFirstAssistantRuntimeEventMs: diffMs(now, trace.firstAssistantRuntimeEventAtMs),
    });
    logContinueLatencySummary(trace);
  }

  return trace.traceId;
}

export function __peekContinueLatencyTraceForTests(sessionId: string) {
  const trace = continueLatencyTraces.get(sessionId);
  if (!trace) {
    return null;
  }

  return {
    ...trace,
    stages: { ...trace.stages },
  };
}

export function __resetContinueLatencyTracesForTests() {
  continueLatencyTraces.clear();
}