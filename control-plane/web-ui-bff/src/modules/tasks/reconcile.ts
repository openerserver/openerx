import { cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import {
  extractAssistantResultFromMessages,
  getAgentRun,
  getSessionMessages,
  listSessions,
  recoverAgentRun,
} from "../agent-control/opencode-adapter";
import { finalizeTaskState } from "./finalize";
import {
  fetchTaskSessionLineageRecords,
  upsertTaskSessionLineageRecord,
} from "./task-session-compat";

interface RunningTaskRecord {
  id: string;
  projectId: string;
  title: string;
  status: string;
  orchestrationKind?: string | null;
  currentRunId?: string | null;
  sessionId?: string | null;
  agentRunId?: string | null;
  result?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface TaskDomainRunNodeRecord {
  candidateIndex?: number | null;
  sessionId?: string | null;
  status: string;
  resultText?: string | null;
  errorText?: string | null;
}

interface TaskDomainRunDetailRecord {
  candidateNodes: TaskDomainRunNodeRecord[];
}

interface TaskProjectionSnapshotRecord {
  taskId: string;
  currentStatus: string;
  orchestrationKind?: string | null;
  currentRunId?: string | null;
  currentSessionId?: string | null;
  latestResult?: string | null;
  lastActivityAt?: string | null;
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
const DEFAULT_RECENT_TERMINAL_SESSION_REPAIR_MS = 30 * 60 * 1000;
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

function getTaskTerminalAgeMs(task: RunningTaskRecord): number {
  const referenceTs =
    parseTimestamp(task.finishedAt) || parseTimestamp(task.createdAt) || Date.now();
  return Math.max(0, Date.now() - referenceTs);
}

function getOfflineStaleThresholdMs(): number {
  const configured = Number(process.env.STALE_RUNNING_TASK_OFFLINE_MS || "");
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_STALE_RUNNING_OFFLINE_MS;
}

function getRecentTerminalSessionRepairThresholdMs(): number {
  const configured = Number(process.env.RECENT_TERMINAL_SESSION_REPAIR_MS || "");
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_RECENT_TERMINAL_SESSION_REPAIR_MS;
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
    task,
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
    task,
    syncWorkflowTerminalState: false,
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
  return loadTasksFromSnapshots(authorization, {
    status: "running",
    limit: DEFAULT_RUNNING_TASK_LIMIT,
  });
}

async function loadRecentTasks(authorization: string) {
  return loadTasksFromSnapshots(authorization, { limit: DEFAULT_RUNNING_TASK_LIMIT });
}

function mergeTaskWithProjectionSnapshot(
  task: RunningTaskRecord,
  snapshot?: TaskProjectionSnapshotRecord,
): RunningTaskRecord {
  if (!snapshot) {
    return task;
  }

  return {
    ...task,
    status: snapshot.currentStatus || task.status,
    orchestrationKind: snapshot.orchestrationKind ?? task.orchestrationKind,
    currentRunId: snapshot.currentRunId ?? task.currentRunId,
    sessionId: snapshot.currentSessionId || task.sessionId,
    result: snapshot.latestResult ?? task.result,
    finishedAt:
      snapshot.currentStatus === "completed" ||
      snapshot.currentStatus === "failed" ||
      snapshot.currentStatus === "cancelled"
        ? snapshot.lastActivityAt || task.finishedAt
        : task.finishedAt,
  };
}

async function loadTasksFromSnapshots(
  authorization: string,
  options: { status?: string; limit: number },
) {
  const params = new URLSearchParams();
  if (options.status) {
    params.set("status", options.status);
  }
  params.set("limit", String(options.limit));

  const snapshotResult = await cpFetch<{ data?: TaskProjectionSnapshotRecord[] }>(
    `/api/tasks/snapshots?${params.toString()}`,
    { authorization },
  );

  if (!snapshotResult.ok || !Array.isArray(snapshotResult.data?.data)) {
    return null;
  }

  const snapshots = snapshotResult.data.data;
  const taskResults = await Promise.all(
    snapshots.map(async (snapshot) => {
      const taskResult = await cpFetch<RunningTaskRecord>(
        `/api/project-tree/tasks/${encodeURIComponent(snapshot.taskId)}`,
        { authorization },
      );
      if (!taskResult.ok) {
        return null;
      }

      return mergeTaskWithProjectionSnapshot(taskResult.data, snapshot);
    }),
  );

  return taskResults.filter((task): task is RunningTaskRecord => Boolean(task));
}

function mergeUniqueTasks(...taskLists: Array<RunningTaskRecord[] | null>) {
  const merged = new Map<string, RunningTaskRecord>();
  for (const taskList of taskLists) {
    for (const task of taskList || []) {
      const existing = merged.get(task.id);
      if (!existing) {
        merged.set(task.id, task);
        continue;
      }

      const next = { ...existing } as RunningTaskRecord;
      for (const [key, value] of Object.entries(task) as Array<
        [keyof RunningTaskRecord, RunningTaskRecord[keyof RunningTaskRecord]]
      >) {
        if (value !== undefined) {
          (next as unknown as Record<string, unknown>)[key] = value;
        }
      }
      merged.set(task.id, next);
    }
  }
  return Array.from(merged.values());
}

function isProjectionBackedParallelTask(
  task: Pick<RunningTaskRecord, "orchestrationKind" | "currentRunId">,
) {
  return (
    task.orchestrationKind === "parallel" &&
    typeof task.currentRunId === "string" &&
    task.currentRunId.length > 0
  );
}

async function loadProjectionBackedParallelRunDetail(
  authorization: string,
  task: Pick<RunningTaskRecord, "id" | "currentRunId" | "orchestrationKind">,
): Promise<TaskDomainRunDetailRecord | null> {
  void authorization;
  void task;
  return null;
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

async function deactivateActiveTaskSessions(
  authorization: string,
  taskId: string,
): Promise<void> {
  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  if (!lineageResult.ok) {
    return;
  }

  await Promise.all(
    lineageResult.records
      .filter((record) => !record.archivedAt && record.isActive)
      .map((record) =>
        upsertTaskSessionLineageRecord(taskId, authorization, {
          runtimeSessionId: record.runtimeSessionId,
          isActive: false,
        }),
      ),
  );
}

async function markParallelTaskTerminal(
  authorization: string,
  task: RunningTaskRecord,
  hasCompletedCandidate: boolean,
): Promise<ReconcileTaskOutcome> {
  const terminalStatus = hasCompletedCandidate ? "completed" : "failed";
  const patchResult = await cpFetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
    method: "PATCH",
    authorization,
    body: {
      status: terminalStatus,
    },
  });

  if (!patchResult.ok) {
    return "skipped";
  }

  await deactivateActiveTaskSessions(authorization, task.id);
  return terminalStatus === "completed" ? "completed" : "failed";
}

async function reconcileParallelRunningTask(
  task: RunningTaskRecord,
  context: ReconcileTaskContext,
): Promise<ReconcileTaskOutcome> {
  const detail = await loadProjectionBackedParallelRunDetail(context.authorization, task);
  if (!detail || detail.candidateNodes.length === 0) {
    return failTaskWithReason(
      task,
      context,
      "Recovered from stale running state: missing projection-backed parallel run detail.",
    );
  }

  const candidateStates = await reconcileParallelCandidateStates(task, context, detail);

  const allTerminal =
    candidateStates.length > 0 &&
    candidateStates.every(
      (candidate) =>
        candidate.status === "completed" ||
        candidate.status === "failed" ||
        candidate.status === "cancelled",
    );
  const hasCompleted = candidateStates.some((candidate) => candidate.status === "completed");

  if (allTerminal) {
    return markParallelTaskTerminal(context.authorization, task, hasCompleted);
  }

  if (!context.runtimeAvailable) {
    return reconcileTaskWithoutRuntime(task, context);
  }

  return "skipped";
}

async function reconcileParallelCandidateStates(
  task: RunningTaskRecord,
  context: ReconcileTaskContext,
  detail: NonNullable<Awaited<ReturnType<typeof loadProjectionBackedParallelRunDetail>>>,
) {
  const candidateStates = detail.candidateNodes.map((candidate) => ({
    status: candidate.status,
    sessionId: candidate.sessionId ?? undefined,
  }));

  for (const [index, candidate] of detail.candidateNodes.entries()) {
    const nextState = await resolveParallelCandidateState(task, context, candidate);
    if (nextState) {
      candidateStates[index] = nextState;
    }
  }

  return candidateStates;
}

async function resolveParallelCandidateState(
  task: RunningTaskRecord,
  context: ReconcileTaskContext,
  candidate: {
    sessionId?: string | null;
    status?: string | null;
  },
) {
  if (!candidate.sessionId || (candidate.status !== "running" && candidate.status !== "pending")) {
    return null;
  }

  const messagesResult = await getSessionMessages(candidate.sessionId, {
    taskId: task.id,
    authorization: context.authorization,
    includeLineage: false,
  });
  if (!messagesResult.ok) {
    return null;
  }

  const assistantResult = extractAssistantResultFromMessages(messagesResult.data);
  if (assistantResult.failed) {
    return {
      sessionId: candidate.sessionId,
      status: "failed",
    };
  }

  if (assistantResult.completed) {
    return {
      sessionId: candidate.sessionId,
      status: "completed",
    };
  }

  return null;
}

function taskNeedsRecentTerminalSessionRepair(task: RunningTaskRecord) {
  const terminalStatus = inferTerminalStatus(task);
  if (terminalStatus !== "completed" || !task.sessionId) {
    return false;
  }

  return getTaskTerminalAgeMs(task) <= getRecentTerminalSessionRepairThresholdMs();
}

async function loadTaskSessionLineageRecords(authorization: string, taskId: string) {
  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  return lineageResult.records;
}

async function reconcileHistoricallyInconsistentTask(
  task: RunningTaskRecord,
  context: ReconcileTaskContext,
): Promise<ReconcileTaskOutcome> {
  const terminalStatus = inferTerminalStatus(task);
  if (terminalStatus !== "completed") {
    return "skipped";
  }

  const lineageRecords = await loadTaskSessionLineageRecords(context.authorization, task.id);
  const hasActiveSession = lineageRecords.some((record) => !record.archivedAt && record.isActive);

  if (hasActiveSession && task.sessionId && context.runtimeAvailable) {
    return reconcileCompletedTaskWithActiveSession(task, context);
  }

  if (!hasActiveSession) {
    return "skipped";
  }

  return "skipped";
}

async function reconcileCompletedTaskWithActiveSession(
  task: RunningTaskRecord,
  context: ReconcileTaskContext,
): Promise<ReconcileTaskOutcome> {
  const messagesResult = await getSessionMessages(task.sessionId as string, {
    taskId: task.id,
    authorization: context.authorization,
  });
  if (!messagesResult.ok) {
    return "skipped";
  }

  const assistantResult = extractAssistantResultFromMessages(messagesResult.data);
  if (assistantResult.failed) {
    return failTaskWithReason(
      task,
      context,
      `Recovered from failed assistant session: ${assistantResult.error || "Assistant message ended with an error."}`,
    );
  }

  if (!assistantResult.completed) {
    return "skipped";
  }

  const updated = await markTaskCompleted(
    context.authorization,
    task,
    assistantResult.text ?? task.result ?? undefined,
  );

  return updated ? "completed" : "skipped";
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
  if (isProjectionBackedParallelTask(task)) {
    return reconcileParallelRunningTask(task, context);
  }

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

  const messagesResult = await getSessionMessages(task.sessionId, {
    taskId: task.id,
    authorization: context.authorization,
  });
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
  const historicalTasks = reconcileCandidates.filter(taskNeedsRecentTerminalSessionRepair);
  const runningOnlyTasks = reconcileCandidates.filter(
    (task) =>
      task.status === "running" && !historicalTasks.some((candidate) => candidate.id === task.id),
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
