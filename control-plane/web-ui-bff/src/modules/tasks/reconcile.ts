import { cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import {
  extractAssistantResultFromMessages,
  getSessionMessages,
  listSessions,
  recoverAgentRun,
} from "../agent-control/opencode-adapter";

interface RunningTaskRecord {
  id: string;
  projectId: string;
  title: string;
  status: string;
  sessionId?: string | null;
  agentRunId?: string | null;
  result?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
}

interface SessionListEntry {
  id?: string;
  sessionID?: string;
}

export interface RunningTaskReconcileSummary {
  scanned: number;
  completed: number;
  failed: number;
  recovered: number;
  skipped: number;
  runtimeAvailable: boolean;
}

const DEFAULT_RUNNING_TASK_LIMIT = 200;
const DEFAULT_STALE_RUNNING_OFFLINE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_PERIODIC_RECONCILE_MS = 5 * 60 * 1000; // 5 minutes

function parseTimestamp(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getTaskAgeMs(task: RunningTaskRecord): number {
  const referenceTs =
    parseTimestamp(task.startedAt) || parseTimestamp(task.createdAt) || Date.now();
  return Math.max(0, Date.now() - referenceTs);
}

function getOfflineStaleThresholdMs(): number {
  const configured = Number(process.env.STALE_RUNNING_TASK_OFFLINE_MS || "");
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_STALE_RUNNING_OFFLINE_MS;
}

function sessionIdFromEntry(entry: SessionListEntry): string | undefined {
  if (typeof entry.id === "string" && entry.id) return entry.id;
  if (typeof entry.sessionID === "string" && entry.sessionID) return entry.sessionID;
  return undefined;
}

async function patchTask(
  authorization: string,
  taskId: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    authorization,
    body,
  });
  return result.ok;
}

async function markTaskFailed(
  authorization: string,
  task: RunningTaskRecord,
  reason: string,
): Promise<boolean> {
  return patchTask(authorization, task.id, {
    status: "failed",
    result: reason,
  });
}

async function markTaskCompleted(
  authorization: string,
  task: RunningTaskRecord,
  resultText?: string,
): Promise<boolean> {
  return patchTask(authorization, task.id, {
    status: "completed",
    sessionId: task.sessionId ?? undefined,
    agentRunId: task.agentRunId ?? undefined,
    ...(resultText ? { result: resultText } : {}),
  });
}

function emptyReconcileSummary(runtimeAvailable = false): RunningTaskReconcileSummary {
  return {
    scanned: 0,
    completed: 0,
    failed: 0,
    recovered: 0,
    skipped: 0,
    runtimeAvailable,
  };
}

async function loadRunningTasks(authorization: string) {
  const runningTasksResult = await cpFetch<{ data?: RunningTaskRecord[] }>(
    `/api/tasks?status=running&limit=${DEFAULT_RUNNING_TASK_LIMIT}`,
    { authorization },
  );

  if (!runningTasksResult.ok || !Array.isArray(runningTasksResult.data?.data)) {
    return null;
  }

  return runningTasksResult.data.data;
}

async function getRuntimeSessionIds(limit: number) {
  const sessionListResult = await listSessions(limit);
  const runtimeAvailable = sessionListResult.ok && Array.isArray(sessionListResult.data);
  const runtimeSessionIds = new Set(
    runtimeAvailable
      ? (sessionListResult.data as SessionListEntry[])
          .map((entry) => sessionIdFromEntry(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
  );

  return { runtimeAvailable, runtimeSessionIds };
}

interface ReconcileTaskContext {
  authorization: string;
  offlineThresholdMs: number;
  runtimeAvailable: boolean;
  runtimeSessionIds: Set<string>;
}

type ReconcileTaskOutcome = "completed" | "failed" | "recovered" | "skipped";

function summarizeOutcome(summary: RunningTaskReconcileSummary, outcome: ReconcileTaskOutcome) {
  if (outcome === "completed") summary.completed += 1;
  if (outcome === "failed") summary.failed += 1;
  if (outcome === "recovered") summary.recovered += 1;
  if (outcome === "skipped") summary.skipped += 1;
}

async function failTaskWithReason(
  task: RunningTaskRecord,
  context: ReconcileTaskContext,
  reason: string,
): Promise<ReconcileTaskOutcome> {
  const updated = await markTaskFailed(context.authorization, task, reason);
  return updated ? "failed" : "skipped";
}

async function reconcileTaskWithoutRuntime(
  task: RunningTaskRecord,
  context: ReconcileTaskContext,
): Promise<ReconcileTaskOutcome> {
  if (getTaskAgeMs(task) < context.offlineThresholdMs) {
    return "skipped";
  }

  return failTaskWithReason(
    task,
    context,
    "Recovered from stale running state: OpenCode runtime unavailable at startup and task exceeded stale timeout.",
  );
}

async function reconcileTaskWithUnreadableSession(
  task: RunningTaskRecord,
  context: ReconcileTaskContext,
): Promise<ReconcileTaskOutcome> {
  const sessionKnown = task.sessionId ? context.runtimeSessionIds.has(task.sessionId) : false;
  if (sessionKnown && getTaskAgeMs(task) < context.offlineThresholdMs) {
    return "skipped";
  }

  return failTaskWithReason(
    task,
    context,
    "Recovered from stale running state: OpenCode session missing or unreadable during startup reconcile.",
  );
}

async function reconcileSingleRunningTask(
  task: RunningTaskRecord,
  context: ReconcileTaskContext,
): Promise<ReconcileTaskOutcome> {
  if (!task.sessionId || !task.agentRunId) {
    return failTaskWithReason(
      task,
      context,
      "Recovered from stale running state: missing sessionId or agentRunId.",
    );
  }

  if (!context.runtimeAvailable) {
    return reconcileTaskWithoutRuntime(task, context);
  }

  const messagesResult = await getSessionMessages(task.sessionId);
  if (!messagesResult.ok) {
    return reconcileTaskWithUnreadableSession(task, context);
  }

  const assistantResult = extractAssistantResultFromMessages(messagesResult.data);
  if (assistantResult.completed) {
    const updated = await markTaskCompleted(context.authorization, task, assistantResult.text);
    return updated ? "completed" : "skipped";
  }

  recoverAgentRun(
    task.agentRunId,
    task.sessionId,
    task.id,
    task.projectId,
    task.startedAt ?? task.createdAt ?? undefined,
  );
  return "recovered";
}

/**
 * Start a periodic timer that reconciles running tasks at a fixed interval.
 * This catches zombie tasks that slip through the real-time SSE sync.
 */
export function startPeriodicReconcile(): void {
  const intervalMs = (() => {
    const configured = Number(process.env.PERIODIC_RECONCILE_MS || "");
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_PERIODIC_RECONCILE_MS;
  })();

  console.log(`[reconcile] periodic reconcile enabled, interval=${intervalMs}ms`);

  setInterval(async () => {
    try {
      const summary = await reconcileRunningTasksOnStartup();
      if (summary.completed > 0 || summary.failed > 0) {
        console.log(
          `[reconcile/periodic] cleaned up: completed=${summary.completed} failed=${summary.failed}`,
        );
      }
    } catch (err) {
      console.error("[reconcile/periodic] error:", err);
    }
  }, intervalMs);
}

export async function reconcileRunningTasksOnStartup(): Promise<RunningTaskReconcileSummary> {
  const authorization = await createInternalAuthorization();
  const runningTasks = await loadRunningTasks(authorization);
  if (!runningTasks) {
    console.warn("[reconcile] failed to load running tasks from control plane");
    return emptyReconcileSummary();
  }

  if (runningTasks.length === 0) {
    console.log("[reconcile] no running tasks to reconcile");
    return emptyReconcileSummary();
  }

  const offlineThresholdMs = getOfflineStaleThresholdMs();
  const { runtimeAvailable, runtimeSessionIds } = await getRuntimeSessionIds(
    DEFAULT_RUNNING_TASK_LIMIT,
  );
  const summary: RunningTaskReconcileSummary = {
    ...emptyReconcileSummary(runtimeAvailable),
    scanned: runningTasks.length,
  };
  const context: ReconcileTaskContext = {
    authorization,
    offlineThresholdMs,
    runtimeAvailable,
    runtimeSessionIds,
  };

  for (const task of runningTasks) {
    const outcome = await reconcileSingleRunningTask(task, context);
    summarizeOutcome(summary, outcome);
  }

  console.log(
    `[reconcile] scanned=${summary.scanned} completed=${summary.completed} failed=${summary.failed} recovered=${summary.recovered} skipped=${summary.skipped} runtimeAvailable=${summary.runtimeAvailable}`,
  );

  return summary;
}
