import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "../../db";
import { taskExecutionPhases, taskSessions, taskSnapshots } from "../../db/schema";
import type { TaskTreeRecord } from "../project-tree/task-view";
import { fromStoredTaskExecutionMode } from "./task-execution-mode";
import {
  normalizeAuthoritativeTaskStatusValue,
  resolvePublicTaskStatus,
} from "./public-task-status";

type TaskSnapshotPhaseRow = Pick<
  typeof taskExecutionPhases.$inferSelect,
  "id" | "status" | "winnerSessionId" | "finishedAt" | "terminalReason"
>;

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveRelevantSnapshotPhase(
  snapshot: typeof taskSnapshots.$inferSelect,
  phaseById: Map<string, TaskSnapshotPhaseRow>,
) {
  const currentPhase = snapshot.currentPhaseId ? phaseById.get(snapshot.currentPhaseId) : undefined;
  if (currentPhase) {
    return currentPhase;
  }

  return snapshot.latestPhaseId ? phaseById.get(snapshot.latestPhaseId) : undefined;
}

function resolveSnapshotAuthoritativeStatus(
  snapshot: typeof taskSnapshots.$inferSelect,
  phaseById: Map<string, TaskSnapshotPhaseRow>,
) {
  return normalizeAuthoritativeTaskStatusValue(
    resolveRelevantSnapshotPhase(snapshot, phaseById)?.status,
  );
}

function resolveAuthoritativeSnapshotSessionId(
  snapshot: typeof taskSnapshots.$inferSelect,
  phaseById: Map<string, TaskSnapshotPhaseRow>,
) {
  const phase = resolveRelevantSnapshotPhase(snapshot, phaseById);
  const authoritativeStatus = normalizeAuthoritativeTaskStatusValue(phase?.status);
  if (authoritativeStatus === "completed" && phase?.winnerSessionId) {
    return phase.winnerSessionId;
  }

  return snapshot.currentSessionId;
}

function mapSnapshotCurrentStatus(
  snapshot: typeof taskSnapshots.$inferSelect,
  phaseById: Map<string, TaskSnapshotPhaseRow>,
) {
  return resolvePublicTaskStatus({
    authoritativeStatus: resolveSnapshotAuthoritativeStatus(snapshot, phaseById),
    currentExecutionStatus: snapshot.currentExecutionStatus,
    lifecycleStatus: snapshot.lifecycleStatus,
  });
}

async function loadSnapshotSessionLookups(rows: Array<typeof taskSnapshots.$inferSelect>) {
  const phaseIds = Array.from(
    new Set(
      rows
        .flatMap((row) => [row.currentPhaseId, row.latestPhaseId])
        .filter((phaseId): phaseId is string => Boolean(phaseId)),
    ),
  );
  const phaseRows =
    phaseIds.length > 0
      ? await db
          .select({
            id: taskExecutionPhases.id,
            status: taskExecutionPhases.status,
            winnerSessionId: taskExecutionPhases.winnerSessionId,
            finishedAt: taskExecutionPhases.finishedAt,
            terminalReason: taskExecutionPhases.terminalReason,
          })
          .from(taskExecutionPhases)
          .where(inArray(taskExecutionPhases.id, phaseIds))
      : [];
  const sessionIds = Array.from(
    new Set(
      rows
        .flatMap((row) => [row.currentSessionId, row.latestSessionId])
        .concat(phaseRows.map((row) => row.winnerSessionId))
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ),
  );

  if (sessionIds.length === 0) {
    return {
      runtimeSessionIdById: new Map<string, string>(),
      phaseIdByIdentifier: new Map<string, string>(),
      phaseById: new Map<string, TaskSnapshotPhaseRow>(phaseRows.map((row) => [row.id, row] as const)),
    };
  }

  const sessionRows = await db.query.taskSessions.findMany({
    where: or(
      inArray(taskSessions.id, sessionIds),
      inArray(taskSessions.runtimeSessionId, sessionIds),
    ),
    columns: { id: true, runtimeSessionId: true, phaseId: true },
  });

  const runtimeSessionIdById = new Map<string, string>();
  const phaseIdByIdentifier = new Map<string, string>();

  for (const row of sessionRows) {
    const runtimeSessionId = row.runtimeSessionId ?? row.id;
    const phaseId = asNonEmptyString(row.phaseId);

    runtimeSessionIdById.set(row.id, runtimeSessionId);

    if (!phaseId) {
      continue;
    }

    for (const identifier of [row.id, row.runtimeSessionId]) {
      const normalizedIdentifier = asNonEmptyString(identifier);
      if (normalizedIdentifier) {
        phaseIdByIdentifier.set(normalizedIdentifier, phaseId);
      }
    }
  }

  return {
    runtimeSessionIdById,
    phaseIdByIdentifier,
    phaseById: new Map<string, TaskSnapshotPhaseRow>(phaseRows.map((row) => [row.id, row] as const)),
  };
}

async function loadAggregateRuntimeSessionIds(
  _rows: Array<typeof taskSnapshots.$inferSelect>,
) {
  // Legacy: tasks.currentSessionId has been retired in migration 0034.
  // Snapshot's currentSessionId is now the sole source.
  return new Map<string, string>();
}

function resolveSnapshotRuntimeSessionId(args: {
  snapshot: typeof taskSnapshots.$inferSelect;
  snapshotSessionId?: string | null;
  runtimeSessionIdById: Map<string, string>;
  aggregateRuntimeSessionIdByTaskId: Map<string, string>;
}) {
  const aggregateRuntimeSessionId =
    args.aggregateRuntimeSessionIdByTaskId.get(args.snapshot.taskId) ?? null;
  const snapshotSessionId = args.snapshotSessionId ?? args.snapshot.currentSessionId;

  if (!snapshotSessionId) {
    return aggregateRuntimeSessionId;
  }

  const mappedRuntimeSessionId = args.runtimeSessionIdById.get(snapshotSessionId);
  if (mappedRuntimeSessionId) {
    return mappedRuntimeSessionId;
  }

  const canonicalPrefix = `task-session:${args.snapshot.taskId}:`;
  if (snapshotSessionId.startsWith(canonicalPrefix)) {
    return snapshotSessionId.slice(canonicalPrefix.length) || aggregateRuntimeSessionId;
  }

  return snapshotSessionId;
}

function resolveSnapshotPhaseId(args: {
  snapshot: typeof taskSnapshots.$inferSelect;
  snapshotSessionId?: string | null;
  phaseIdByIdentifier: Map<string, string>;
}) {
  const explicitSnapshotPhaseId = asNonEmptyString(args.snapshot.currentPhaseId);
  if (args.snapshotSessionId === args.snapshot.currentSessionId && explicitSnapshotPhaseId) {
    return explicitSnapshotPhaseId;
  }

  const explicitLatestPhaseId = asNonEmptyString(args.snapshot.latestPhaseId);
  if (args.snapshotSessionId === args.snapshot.latestSessionId && explicitLatestPhaseId) {
    return explicitLatestPhaseId;
  }

  const snapshotSessionId = asNonEmptyString(args.snapshotSessionId);
  if (!snapshotSessionId) {
    return null;
  }

  const mappedPhaseId = args.phaseIdByIdentifier.get(snapshotSessionId);
  if (mappedPhaseId) {
    return mappedPhaseId;
  }

  return null;
}

function mapTaskSnapshotForRead(
  snapshot: typeof taskSnapshots.$inferSelect,
  runtimeSessionIdById: Map<string, string>,
  aggregateRuntimeSessionIdByTaskId: Map<string, string>,
  phaseIdByIdentifier: Map<string, string>,
  phaseById: Map<string, TaskSnapshotPhaseRow>,
) {
  const authoritativeSessionId = resolveAuthoritativeSnapshotSessionId(snapshot, phaseById);
  return {
    taskId: snapshot.taskId,
    projectId: snapshot.projectId,
    currentStatus: mapSnapshotCurrentStatus(snapshot, phaseById),
    orchestrationKind: fromStoredTaskExecutionMode(snapshot.currentExecutionMode),
    currentRunId: null,
    currentSessionId: resolveSnapshotRuntimeSessionId({
      snapshot,
      snapshotSessionId: authoritativeSessionId,
      runtimeSessionIdById,
      aggregateRuntimeSessionIdByTaskId,
    }),
    currentPhaseId: resolveSnapshotPhaseId({
      snapshot,
      snapshotSessionId: snapshot.currentSessionId,
      phaseIdByIdentifier,
    }),
    latestPhaseId: resolveSnapshotPhaseId({
      snapshot,
      snapshotSessionId: snapshot.latestSessionId,
      phaseIdByIdentifier,
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
    const [{ runtimeSessionIdById, phaseIdByIdentifier, phaseById }, aggregateRuntimeSessionIdByTaskId] =
      await Promise.all([
        loadSnapshotSessionLookups(rows),
        loadAggregateRuntimeSessionIds(rows),
      ]);

    const data = rows
      .map((row) =>
        mapTaskSnapshotForRead(
          row,
          runtimeSessionIdById,
          aggregateRuntimeSessionIdByTaskId,
          phaseIdByIdentifier,
          phaseById,
        ),
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
    const { runtimeSessionIdById, phaseIdByIdentifier, phaseById } = snapshot
      ? await loadSnapshotSessionLookups([snapshot])
      : {
          runtimeSessionIdById: new Map<string, string>(),
          phaseIdByIdentifier: new Map<string, string>(),
          phaseById: new Map<string, TaskSnapshotPhaseRow>(),
        };
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
              phaseIdByIdentifier,
              phaseById,
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
