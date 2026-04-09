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
  firstTaskDomainEventType?: string;
  firstTaskDomainEventAtMs?: number;
  firstTaskMessageEventType?: string;
  firstTaskMessageEventAtMs?: number;
};

const ACTIVE_TRACE_TTL_MS = 10 * 60_000;
const COMPLETED_TRACE_TTL_MS = 60_000;
const ASSISTANT_RUNTIME_EVENT_TYPES = new Set(["message_start", "message_update", "message_end"]);
const TASK_MESSAGE_EVENT_TYPES = new Set(["task.message.updated", "task.message.delta"]);
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
    firstTaskDomainEvent: trace.firstTaskDomainEventType,
    firstTaskMessageEvent: trace.firstTaskMessageEventType,
  });
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

export function noteContinueLatencyRuntimeEvent(sessionId: string, eventType: string) {
  const now = Date.now();
  const trace = continueLatencyTraces.get(sessionId);
  if (!trace) {
    return undefined;
  }

  trace.lastUpdatedAtMs = now;
  if (!trace.firstRawRuntimeEventAtMs) {
    trace.firstRawRuntimeEventAtMs = now;
    trace.firstRawRuntimeEventType = eventType;
    logContinueLatencyStage(trace, "first-raw-runtime-event", {
      eventType,
      elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
      sinceDispatchResolvedMs: diffMs(now, trace.stages["runtime-dispatch-resolved"]),
    });
  }

  if (!trace.firstAssistantRuntimeEventAtMs && ASSISTANT_RUNTIME_EVENT_TYPES.has(eventType)) {
    trace.firstAssistantRuntimeEventAtMs = now;
    trace.firstAssistantRuntimeEventType = eventType;
    logContinueLatencyStage(trace, "first-assistant-runtime-event", {
      eventType,
      elapsedMs: diffMs(now, trace.stages["route-received"] ?? trace.startedAtMs),
      sinceFirstRawRuntimeEventMs: diffMs(now, trace.firstRawRuntimeEventAtMs),
    });
  }

  return trace.traceId;
}

export function noteContinueLatencyTaskDomainEvent(sessionId: string, eventType: string) {
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

  if (!trace.firstTaskMessageEventAtMs && TASK_MESSAGE_EVENT_TYPES.has(eventType)) {
    trace.firstTaskMessageEventAtMs = now;
    trace.firstTaskMessageEventType = eventType;
    trace.completedAtMs = now;
    logContinueLatencyStage(trace, "first-task-message-event", {
      eventType,
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