import { cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import { finalizeTaskState } from "./finalize";
import {
  extractAssistantResultFromMessages,
  getAgentRun,
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
  finishedAt?: string | null;
  executionPlan?: string | null;
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

async function markTaskFailed(
  authorization: string,
  task: RunningTaskRecord,
  reason: string,
): Promise<boolean> {
  return finalizeTaskState({
    authorization,
    taskId: task.id,
    status: "failed",
    sessionId: task.sessionId ?? undefined,
    agentRunId: task.agentRunId ?? undefined,
    result: reason,
  });
}

async function markTaskCompleted(
  authorization: string,
  task: RunningTaskRecord,
  resultText?: string,
): Promise<boolean> {
  return finalizeTaskState({
    authorization,
    taskId: task.id,
    status: "completed",
    sessionId: task.sessionId ?? undefined,
    agentRunId: task.agentRunId ?? undefined,
    result: resultText,
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

async function loadRecentTasks(authorization: string) {
  const tasksResult = await cpFetch<{ data?: RunningTaskRecord[] }>(
    `/api/tasks?limit=${DEFAULT_RUNNING_TASK_LIMIT}`,
    { authorization },
  );

  if (!tasksResult.ok || !Array.isArray(tasksResult.data?.data)) {
    return null;
  }

  return tasksResult.data.data;
}

function mergeUniqueTasks(...taskLists: Array<RunningTaskRecord[] | null>) {
  const merged = new Map<string, RunningTaskRecord>();
  for (const taskList of taskLists) {
    for (const task of taskList || []) {
      if (!merged.has(task.id)) {
        merged.set(task.id, task);
      }
    }
  }
  return Array.from(merged.values());
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

interface TaskSessionRecord {
  runtimeSessionId: string;
  isActive: boolean;
  archivedAt?: string | null;
}

interface ParsedExecutionPlanCandidate {
  status?: string;
  finishedAt?: string;
}

interface ParsedExecutionPlanStep {
  type?: string;
  status?: string;
}

interface ParsedExecutionPlan {
  candidates?: ParsedExecutionPlanCandidate[];
  steps?: ParsedExecutionPlanStep[];
}

function parseExecutionPlan(raw: string | null | undefined): ParsedExecutionPlan | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ParsedExecutionPlan;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isTerminalStatus(status: string | null | undefined) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function inferTerminalStatus(task: RunningTaskRecord): "completed" | "failed" | "cancelled" | null {
  if (isTerminalStatus(task.status)) {
    return task.status as "completed" | "failed" | "cancelled";
  }

  if (typeof task.result === "string" && /^\s*\[FAILED\]/.test(task.result)) {
    return "failed";
  }

  if (task.finishedAt || task.result) {
    return "completed";
  }

  return null;
}

function planNeedsTerminalRepair(task: RunningTaskRecord): boolean {
  const plan = parseExecutionPlan(task.executionPlan);
  if (!plan) {
    return false;
  }

  const candidateNeedsRepair = (plan.candidates || []).some((candidate) => {
    if (candidate.status === "running" || candidate.status === "pending") {
      return true;
    }
    return Boolean(task.finishedAt && !candidate.finishedAt);
  });

  const stepNeedsRepair = (plan.steps || []).some((step) => {
    if (step.type !== "execution") {
      return false;
    }
    return step.status === "running" || step.status === "pending";
  });

  return candidateNeedsRepair || stepNeedsRepair;
}

function taskLooksHistoricallyInconsistent(task: RunningTaskRecord) {
  return Boolean(inferTerminalStatus(task) && (planNeedsTerminalRepair(task) || task.status === "running"));
}

async function loadTaskSessions(authorization: string, taskId: string) {
  const lineageResult = await cpFetch<{ data?: TaskSessionRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/task-sessions`,
    { authorization },
  );

  if (!lineageResult.ok || !Array.isArray(lineageResult.data?.data)) {
    return [] as TaskSessionRecord[];
  }

  return lineageResult.data.data;
}

async function reconcileHistoricallyInconsistentTask(
  task: RunningTaskRecord,
  context: ReconcileTaskContext,
): Promise<ReconcileTaskOutcome> {
  const terminalStatus = inferTerminalStatus(task);
  if (!terminalStatus) {
    return "skipped";
  }

  const lineageRecords = await loadTaskSessions(context.authorization, task.id);
  const hasActiveSession = lineageRecords.some((record) => !record.archivedAt && record.isActive);

  if (!hasActiveSession && !planNeedsTerminalRepair(task) && isTerminalStatus(task.status)) {
    return "skipped";
  }

  const updated = await finalizeTaskState({
    authorization: context.authorization,
    taskId: task.id,
    status: terminalStatus,
    sessionId: task.sessionId ?? undefined,
    agentRunId: task.agentRunId ?? undefined,
    result: task.result ?? undefined,
    task,
  });

  if (!updated) {
    return "skipped";
  }

  return terminalStatus === "failed" ? "failed" : "completed";
}

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
  if (assistantResult.failed) {
    return failTaskWithReason(
      task,
      context,
      `Recovered from failed assistant session: ${assistantResult.error || "Assistant message ended with an error."}`,
    );
  }

  if (assistantResult.completed) {
    const updated = await markTaskCompleted(context.authorization, task, assistantResult.text);
    return updated ? "completed" : "skipped";
  }

  const existingRun = getAgentRun(task.agentRunId);
  if (existingRun) {
    return "skipped";
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
  const [runningTasks, recentTasks] = await Promise.all([
    loadRunningTasks(authorization),
    loadRecentTasks(authorization),
  ]);
  if (!runningTasks || !recentTasks) {
    console.warn("[reconcile] failed to load running tasks from control plane");
    return emptyReconcileSummary();
  }

  const reconcileCandidates = mergeUniqueTasks(runningTasks, recentTasks);
  const historicalTasks = reconcileCandidates.filter((task) => taskLooksHistoricallyInconsistent(task));
  const runningOnlyTasks = reconcileCandidates.filter(
    (task) => task.status === "running" && !historicalTasks.some((candidate) => candidate.id === task.id),
  );

  if (runningOnlyTasks.length === 0 && historicalTasks.length === 0) {
    console.log("[reconcile] no running tasks to reconcile");
    return emptyReconcileSummary();
  }

  const offlineThresholdMs = getOfflineStaleThresholdMs();
  const { runtimeAvailable, runtimeSessionIds } = await getRuntimeSessionIds(
    DEFAULT_RUNNING_TASK_LIMIT,
  );
  const summary: RunningTaskReconcileSummary = {
    ...emptyReconcileSummary(runtimeAvailable),
    scanned: runningOnlyTasks.length + historicalTasks.length,
  };
  const context: ReconcileTaskContext = {
    authorization,
    offlineThresholdMs,
    runtimeAvailable,
    runtimeSessionIds,
  };

  for (const task of runningOnlyTasks) {
    const outcome = await reconcileSingleRunningTask(task, context);
    summarizeOutcome(summary, outcome);
  }

  for (const task of historicalTasks) {
    const outcome = await reconcileHistoricallyInconsistentTask(task, context);
    summarizeOutcome(summary, outcome);
  }

  console.log(
    `[reconcile] scanned=${summary.scanned} completed=${summary.completed} failed=${summary.failed} recovered=${summary.recovered} skipped=${summary.skipped} runtimeAvailable=${summary.runtimeAvailable}`,
  );

  return summary;
}
