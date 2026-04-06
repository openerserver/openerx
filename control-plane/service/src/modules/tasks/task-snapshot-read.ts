import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { taskSessions, taskSnapshots, tasks } from "../../db/schema";
import type { TaskTreeRecord } from "../project-tree/task-view";
import { fromStoredTaskExecutionMode } from "./task-execution-mode";

function mapSnapshotLifecycleStatusToTaskStatus(lifecycleStatus?: string | null) {
  if (lifecycleStatus === "done") {
    return "completed";
  }
  if (lifecycleStatus === "active") {
    return "running";
  }
  if (lifecycleStatus === "archived") {
    return "cancelled";
  }

  return "pending" as const;
}

function mapSnapshotCurrentStatus(snapshot: typeof taskSnapshots.$inferSelect) {
  return (
    snapshot.currentExecutionStatus ??
    mapSnapshotLifecycleStatusToTaskStatus(snapshot.lifecycleStatus)
  );
}

async function loadSnapshotRuntimeSessionIds(rows: Array<typeof taskSnapshots.$inferSelect>) {
  const sessionIds = Array.from(
    new Set(
      rows
        .flatMap((row) => [row.currentSessionId, row.latestSessionId])
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ),
  );

  if (sessionIds.length === 0) {
    return new Map<string, string>();
  }

  const sessionRows = await db.query.taskSessions.findMany({
    where: inArray(taskSessions.id, sessionIds),
    columns: { id: true, runtimeSessionId: true },
  });

  return new Map(sessionRows.map((row) => [row.id, row.runtimeSessionId ?? row.id] as const));
}

async function loadAggregateRuntimeSessionIds(rows: Array<typeof taskSnapshots.$inferSelect>) {
  const taskIds = Array.from(new Set(rows.map((row) => row.taskId).filter(Boolean)));

  if (taskIds.length === 0) {
    return new Map<string, string>();
  }

  const taskRows = await db.query.tasks.findMany({
    where: inArray(tasks.id, taskIds),
    columns: { id: true, currentSessionId: true },
  });

  return new Map(
    taskRows
      .filter((row): row is { id: string; currentSessionId: string } =>
        Boolean(row.currentSessionId),
      )
      .map((row) => [row.id, row.currentSessionId] as const),
  );
}

function resolveSnapshotRuntimeSessionId(args: {
  snapshot: typeof taskSnapshots.$inferSelect;
  runtimeSessionIdById: Map<string, string>;
  aggregateRuntimeSessionIdByTaskId: Map<string, string>;
}) {
  const aggregateRuntimeSessionId =
    args.aggregateRuntimeSessionIdByTaskId.get(args.snapshot.taskId) ?? null;
  const snapshotSessionId = args.snapshot.currentSessionId;

  if (!snapshotSessionId) {
    return aggregateRuntimeSessionId;
  }

  const mappedRuntimeSessionId = args.runtimeSessionIdById.get(snapshotSessionId);
  if (mappedRuntimeSessionId) {
    return mappedRuntimeSessionId;
  }

  if (snapshotSessionId.startsWith("task-session:")) {
    return aggregateRuntimeSessionId;
  }

  return snapshotSessionId;
}

function mapTaskSnapshotForRead(
  snapshot: typeof taskSnapshots.$inferSelect,
  runtimeSessionIdById: Map<string, string>,
  aggregateRuntimeSessionIdByTaskId: Map<string, string>,
) {
  return {
    taskId: snapshot.taskId,
    projectId: snapshot.projectId,
    currentStatus: mapSnapshotCurrentStatus(snapshot),
    orchestrationKind: fromStoredTaskExecutionMode(snapshot.currentExecutionMode),
    currentRunId: null,
    currentSessionId: resolveSnapshotRuntimeSessionId({
      snapshot,
      runtimeSessionIdById,
      aggregateRuntimeSessionIdByTaskId,
    }),
    latestResult: snapshot.latestResultSummary,
    latestResultSummary: snapshot.latestResultSummary,
    latestErrorText: snapshot.latestErrorText,
    activeCandidateCount: snapshot.activeCandidateCount ?? 0,
    completedCandidateCount: 0,
    failedCandidateCount: 0,
    totalChainSteps: snapshot.totalChainSteps ?? 0,
    completedChainSteps: snapshot.completedChainSteps ?? 0,
    winnerNodeId: null,
    lastActivityAt: snapshot.lastActivityAt,
    updatedAt: snapshot.updatedAt,
  };
}

export function createTaskSnapshotReadApi(deps: {
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
}) {
  async function listTaskSnapshots(args: {
    projectId?: string;
    status?: string;
    limit?: number;
  }) {
    const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(500, args.limit ?? 200)) : 200;
    const filters = [] as Array<ReturnType<typeof eq>>;

    if (args.projectId) {
      filters.push(eq(taskSnapshots.projectId, args.projectId));
    }

    const query = db.select().from(taskSnapshots).orderBy(desc(taskSnapshots.updatedAt));
    const rows = filters.length > 0 ? await query.where(and(...filters)) : await query;
    const [runtimeSessionIdById, aggregateRuntimeSessionIdByTaskId] = await Promise.all([
      loadSnapshotRuntimeSessionIds(rows),
      loadAggregateRuntimeSessionIds(rows),
    ]);

    const data = rows
      .map((row) =>
        mapTaskSnapshotForRead(row, runtimeSessionIdById, aggregateRuntimeSessionIdByTaskId),
      )
      .filter((row) => (args.status ? row.currentStatus === args.status : true))
      .slice(0, limit);

    return { data };
  }

  async function getTaskSnapshot(taskId: string) {
    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const snapshot = await db.query.taskSnapshots.findFirst({
      where: eq(taskSnapshots.taskId, taskId),
    });
    const runtimeSessionIdById = snapshot
      ? await loadSnapshotRuntimeSessionIds([snapshot])
      : new Map<string, string>();
    const aggregateRuntimeSessionIdByTaskId = task.sessionId
      ? new Map([[task.id, task.sessionId]])
      : new Map<string, string>();

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: snapshot
          ? mapTaskSnapshotForRead(
              snapshot,
              runtimeSessionIdById,
              aggregateRuntimeSessionIdByTaskId,
            )
          : null,
        meta: {
          readSource: "task-domain-projection" as const,
          complete: Boolean(snapshot),
        },
      },
    };
  }

  return {
    listTaskSnapshots,
    getTaskSnapshot,
  };
}
