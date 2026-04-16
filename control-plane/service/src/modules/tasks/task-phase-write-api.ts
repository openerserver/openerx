import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  type ExecutionStatus,
  type TaskExecutionPhaseKind,
  type TaskExecutionPhaseStatus,
  type TaskExecutionPhaseTerminalReason,
  type TaskExecutionPhaseTriggerType,
  type TaskLifecycleStatus,
  type TaskSessionMode,
  type TaskSessionNodeStatus,
  taskExecutionPhases,
  taskMessages,
  taskSessionRuns,
  taskSessions,
  taskSnapshots,
} from "../../db/schema";
import type { TaskTreeRecord } from "../project-tree/task-view";
import { buildPublicTaskExecutionPhaseRecord } from "./task-phase-public-record";

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function mapPhaseKindToExecutionMode(phaseKind: TaskExecutionPhaseKind): TaskSessionMode {
  if (phaseKind === "parallel") {
    return "parallel";
  }
  if (phaseKind === "sequential_chain") {
    return "sequential_chain";
  }
  return "single";
}

function mapPhaseStatusToSnapshotExecutionStatus(status: TaskExecutionPhaseStatus): ExecutionStatus {
  if (status === "pending") {
    return "queued";
  }
  if (status === "awaiting_adoption") {
    return "awaiting_adoption";
  }
  if (status === "completed") {
    return "complete";
  }
  if (status === "failed" || status === "cancelled") {
    return status;
  }
  return "running";
}

function mapPhaseStatusToSnapshotLifecycleStatus(
  status: TaskExecutionPhaseStatus,
): TaskLifecycleStatus {
  if (status === "pending") {
    return "draft";
  }
  if (status === "completed") {
    return "done";
  }
  if (status === "cancelled") {
    return "archived";
  }
  return "active";
}

function mapTaskSessionStatusToExecutionStatus(
  status: TaskSessionNodeStatus | null | undefined,
): ExecutionStatus | null {
  if (status === "queued") {
    return "queued";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "completed") {
    return "complete";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled" || status === "interrupted" || status === "archived") {
    return "cancelled";
  }
  return null;
}

function mapExecutionStatusToTaskSessionStatus(
  executionStatus: ExecutionStatus | null | undefined,
): TaskSessionNodeStatus | null {
  if (executionStatus === "queued") {
    return "queued";
  }
  if (executionStatus === "running" || executionStatus === "awaiting_adoption") {
    return "running";
  }
  if (executionStatus === "complete") {
    return "completed";
  }
  if (executionStatus === "failed") {
    return "failed";
  }
  if (executionStatus === "cancelled") {
    return "cancelled";
  }
  return null;
}

function buildAdoptedTaskSessionUpdate(args: {
  session: typeof taskSessions.$inferSelect;
  winnerSessionId: string;
  updatedAt: string;
  winnerFinishedAt?: string | null;
}) {
  const statusDerivedExecution = mapTaskSessionStatusToExecutionStatus(args.session.status);
  const currentExecutionStatus =
    args.session.executionStatus && args.session.executionStatus.length > 0
      ? args.session.executionStatus
      : null;
  const nextExecutionStatus =
    args.session.id === args.winnerSessionId
      ? "complete"
      : (statusDerivedExecution ?? currentExecutionStatus);
  const nextStatus =
    args.session.id === args.winnerSessionId
      ? "completed"
      : (mapExecutionStatusToTaskSessionStatus(nextExecutionStatus) ?? args.session.status ?? null);
  const nextFinishedAt =
    args.session.id === args.winnerSessionId
      ? (args.session.finishedAt ?? args.winnerFinishedAt ?? args.updatedAt)
      : args.session.finishedAt;

  return {
    winnerSessionId: args.winnerSessionId,
    status: nextStatus ?? args.session.status,
    executionStatus: nextExecutionStatus ?? args.session.executionStatus,
    finishedAt: nextFinishedAt,
    updatedAt: args.updatedAt,
  } satisfies Partial<typeof taskSessions.$inferInsert>;
}

async function reconcileAdoptedWinnerLatestRun(args: {
  taskId: string;
  winnerSession: typeof taskSessions.$inferSelect;
  now: string;
}) {
  const latestRunId = asNonEmptyString(args.winnerSession.latestRunId);
  const headMessageId = asNonEmptyString(args.winnerSession.headMessageId);
  if (!latestRunId || !headMessageId) {
    return args.winnerSession.finishedAt ?? null;
  }

  const [latestRun, headMessage] = await Promise.all([
    db.query.taskSessionRuns.findFirst({
      where: and(
        eq(taskSessionRuns.taskId, args.taskId),
        eq(taskSessionRuns.sessionId, args.winnerSession.id),
        eq(taskSessionRuns.id, latestRunId),
      ),
    }),
    db.query.taskMessages.findFirst({
      where: and(
        eq(taskMessages.taskId, args.taskId),
        eq(taskMessages.sessionId, args.winnerSession.id),
        eq(taskMessages.id, headMessageId),
      ),
    }),
  ]);

  const completedAt = headMessage?.completedAt ?? latestRun?.finishedAt ?? args.winnerSession.finishedAt ?? args.now;
  if (!latestRun || !headMessage) {
    return completedAt;
  }

  if (
    headMessage.role !== "assistant" ||
    headMessage.status !== "completed" ||
    headMessage.createdByRunId !== latestRun.id
  ) {
    return completedAt;
  }

  if (latestRun.status !== "completed" || !latestRun.finishedAt) {
    await db
      .update(taskSessionRuns)
      .set({
        status: "completed",
        finishedAt: completedAt,
      })
      .where(
        and(
          eq(taskSessionRuns.taskId, args.taskId),
          eq(taskSessionRuns.sessionId, args.winnerSession.id),
          eq(taskSessionRuns.id, latestRun.id),
        ),
      );
  }

  return completedAt;
}

type UpsertTaskExecutionPhaseArgs = {
  id?: string;
  parentPhaseId?: string | null;
  phaseKind: TaskExecutionPhaseKind;
  triggerType: TaskExecutionPhaseTriggerType;
  status?: TaskExecutionPhaseStatus;
  resumedFromPhaseId?: string | null;
  anchorSessionId?: string | null;
  anchorMessageId?: string | null;
  candidateCount?: number | null;
  winnerSessionId?: string | null;
  judgeSessionId?: string | null;
  requestedModel?: string | null;
  effectiveModel?: string | null;
  resultSummary?: string | null;
  errorText?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  currentSessionId?: string | null;
  latestSessionId?: string | null;
};

type UpdateTaskExecutionPhaseRecordArgs = {
  taskId: string;
  phaseId: string;
  winnerSessionId: string;
};

type CancelTaskExecutionPhaseArgs = {
  taskId: string;
  phaseId: string;
  reason: TaskExecutionPhaseTerminalReason;
};

async function resolveNextTaskPhaseIndex(taskId: string) {
  const phases = await db
    .select({ phaseIndex: taskExecutionPhases.phaseIndex })
    .from(taskExecutionPhases)
    .where(eq(taskExecutionPhases.taskId, taskId))
    .orderBy(asc(taskExecutionPhases.phaseIndex));

  return (phases.at(-1)?.phaseIndex ?? 0) + 1;
}

async function loadTaskExecutionPhase(taskId: string, phaseId: string) {
  return (
    (await db.query.taskExecutionPhases.findFirst({
      where: and(eq(taskExecutionPhases.taskId, taskId), eq(taskExecutionPhases.id, phaseId)),
    })) ?? null
  );
}

async function loadTaskPhaseSessions(taskId: string, phaseId: string) {
  return db.query.taskSessions.findMany({
    where: and(eq(taskSessions.taskId, taskId), eq(taskSessions.phaseId, phaseId)),
    orderBy: [asc(taskSessions.createdAt)],
  });
}

async function upsertTaskSnapshotPhaseState(args: {
  taskId: string;
  projectId: string;
  phaseId: string;
  phaseKind: TaskExecutionPhaseKind;
  phaseStatus: TaskExecutionPhaseStatus;
  currentSessionId?: string | null;
  latestSessionId?: string | null;
  candidateCount?: number | null;
}) {
  const now = new Date().toISOString();
  const existing =
    (await db.query.taskSnapshots.findFirst({ where: eq(taskSnapshots.taskId, args.taskId) })) ?? null;

  const nextCurrentSessionId = args.currentSessionId ?? existing?.currentSessionId ?? null;
  const nextLatestSessionId = args.latestSessionId ?? existing?.latestSessionId ?? nextCurrentSessionId;

  const snapshotValues = {
    taskId: args.taskId,
    projectId: args.projectId,
    lifecycleStatus: mapPhaseStatusToSnapshotLifecycleStatus(args.phaseStatus),
    currentExecutionMode: mapPhaseKindToExecutionMode(args.phaseKind),
    currentExecutionStatus: mapPhaseStatusToSnapshotExecutionStatus(args.phaseStatus),
    currentPhaseId: args.phaseId,
    latestPhaseId: args.phaseId,
    currentSessionId: nextCurrentSessionId,
    latestSessionId: nextLatestSessionId,
    latestResultSummary: existing?.latestResultSummary ?? null,
    latestErrorText: existing?.latestErrorText ?? null,
    activeCandidateCount:
      args.phaseKind === "parallel"
        ? args.phaseStatus === "completed" || args.phaseStatus === "failed" || args.phaseStatus === "cancelled"
          ? 0
          : (args.candidateCount ?? existing?.activeCandidateCount ?? 0)
        : 0,
    totalChainSteps: existing?.totalChainSteps ?? 0,
    completedChainSteps: existing?.completedChainSteps ?? 0,
    lastActivityAt: now,
    updatedAt: now,
  };

  await db.insert(taskSnapshots).values(snapshotValues).onConflictDoUpdate({
    target: taskSnapshots.taskId,
    set: snapshotValues,
  });
}

export function createTaskPhaseWriteApi(deps: {
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
}) {
  async function listTaskPhases(taskId: string) {
    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const phases = await db.query.taskExecutionPhases.findMany({
      where: eq(taskExecutionPhases.taskId, taskId),
      orderBy: [asc(taskExecutionPhases.phaseIndex), asc(taskExecutionPhases.createdAt)],
    });
    const phaseIds = phases.map((phase) => phase.id);
    const phaseSessions = phaseIds.length
      ? await db.query.taskSessions.findMany({
          where: and(eq(taskSessions.taskId, taskId), inArray(taskSessions.phaseId, phaseIds)),
          columns: { id: true, phaseId: true },
          orderBy: [asc(taskSessions.createdAt)],
        })
      : [];

    const sessionIdsByPhaseId = new Map<string, string[]>();
    for (const session of phaseSessions) {
      const phaseId = asNonEmptyString(session.phaseId);
      if (!phaseId) {
        continue;
      }
      const existing = sessionIdsByPhaseId.get(phaseId) ?? [];
      existing.push(session.id);
      sessionIdsByPhaseId.set(phaseId, existing);
    }

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        data: phases.map((phase) =>
          buildPublicTaskExecutionPhaseRecord({
            phase,
            sessionIds: sessionIdsByPhaseId.get(phase.id) ?? [],
          }),
        ),
      },
    };
  }

  async function upsertTaskPhase(taskId: string, args: UpsertTaskExecutionPhaseArgs) {
    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const now = new Date().toISOString();
    const phaseId = asNonEmptyString(args.id) ?? `task-phase:${taskId}:${crypto.randomUUID()}`;
    const existing = await loadTaskExecutionPhase(taskId, phaseId);
    const phaseIndex = existing?.phaseIndex ?? (await resolveNextTaskPhaseIndex(taskId));
    const phaseStatus = args.status ?? existing?.status ?? "running";
    const phaseKind = args.phaseKind ?? existing?.phaseKind;
    const triggerType = args.triggerType ?? existing?.triggerType;
    const awaitingAdoptionSince =
      existing?.awaitingAdoptionSince ??
      (phaseStatus === "awaiting_adoption" ? now : null);

    const values = {
      id: phaseId,
      taskId,
      projectId: task.projectId,
      parentPhaseId:
        args.parentPhaseId !== undefined ? args.parentPhaseId : (existing?.parentPhaseId ?? null),
      phaseIndex,
      phaseKind,
      triggerType,
      status: phaseStatus,
      resumedFromPhaseId:
        args.resumedFromPhaseId !== undefined
          ? args.resumedFromPhaseId
          : (existing?.resumedFromPhaseId ?? null),
      awaitingAdoptionSince,
      cancelRequestedAt: existing?.cancelRequestedAt ?? null,
      cancelledAt: existing?.cancelledAt ?? null,
      terminalReason: existing?.terminalReason ?? null,
      lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
      anchorSessionId:
        args.anchorSessionId !== undefined ? args.anchorSessionId : (existing?.anchorSessionId ?? null),
      anchorMessageId:
        args.anchorMessageId !== undefined ? args.anchorMessageId : (existing?.anchorMessageId ?? null),
      candidateCount:
        args.candidateCount !== undefined ? args.candidateCount : (existing?.candidateCount ?? null),
      winnerSessionId:
        args.winnerSessionId !== undefined ? args.winnerSessionId : (existing?.winnerSessionId ?? null),
      judgeSessionId:
        args.judgeSessionId !== undefined ? args.judgeSessionId : (existing?.judgeSessionId ?? null),
      requestedModel:
        args.requestedModel !== undefined ? args.requestedModel : (existing?.requestedModel ?? null),
      effectiveModel:
        args.effectiveModel !== undefined ? args.effectiveModel : (existing?.effectiveModel ?? null),
      resultSummary:
        args.resultSummary !== undefined ? args.resultSummary : (existing?.resultSummary ?? null),
      errorText: args.errorText !== undefined ? args.errorText : (existing?.errorText ?? null),
      startedAt: args.startedAt !== undefined ? args.startedAt : (existing?.startedAt ?? now),
      finishedAt: args.finishedAt !== undefined ? args.finishedAt : (existing?.finishedAt ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await db.insert(taskExecutionPhases).values(values).onConflictDoUpdate({
      target: taskExecutionPhases.id,
      set: {
        parentPhaseId: values.parentPhaseId,
        phaseKind: values.phaseKind,
        triggerType: values.triggerType,
        status: values.status,
        resumedFromPhaseId: values.resumedFromPhaseId,
        awaitingAdoptionSince: values.awaitingAdoptionSince,
        anchorSessionId: values.anchorSessionId,
        anchorMessageId: values.anchorMessageId,
        candidateCount: values.candidateCount,
        winnerSessionId: values.winnerSessionId,
        judgeSessionId: values.judgeSessionId,
        requestedModel: values.requestedModel,
        effectiveModel: values.effectiveModel,
        resultSummary: values.resultSummary,
        errorText: values.errorText,
        startedAt: values.startedAt,
        finishedAt: values.finishedAt,
        updatedAt: now,
      },
    });

    await upsertTaskSnapshotPhaseState({
      taskId,
      projectId: task.projectId,
      phaseId,
      phaseKind: values.phaseKind,
      phaseStatus,
      currentSessionId: args.currentSessionId,
      latestSessionId: args.latestSessionId,
      candidateCount: values.candidateCount,
    });

    const phase = await loadTaskExecutionPhase(taskId, phaseId);
    if (!phase) {
      return { ok: false as const, status: 500 as const, error: "Task phase write failed" };
    }

    const sessions = await loadTaskPhaseSessions(taskId, phaseId);
    return {
      ok: true as const,
      status: existing ? (200 as const) : (201 as const),
      data: buildPublicTaskExecutionPhaseRecord({
        phase,
        sessionIds: sessions.map((session) => session.id),
      }),
    };
  }

  async function adoptTaskPhase(args: UpdateTaskExecutionPhaseRecordArgs) {
    const task = await deps.loadTaskTreeBackedRecord(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const phase = await loadTaskExecutionPhase(args.taskId, args.phaseId);
    if (!phase) {
      return { ok: false as const, status: 404 as const, error: "Task phase not found" };
    }

    const winnerSession = await db.query.taskSessions.findFirst({
      where: and(
        eq(taskSessions.taskId, args.taskId),
        eq(taskSessions.phaseId, args.phaseId),
        eq(taskSessions.id, args.winnerSessionId),
      ),
    });
    if (!winnerSession) {
      return { ok: false as const, status: 404 as const, error: "Winner session not found in phase" };
    }

    const sessions = await loadTaskPhaseSessions(args.taskId, args.phaseId);

    const now = new Date().toISOString();
    const winnerFinishedAt = await reconcileAdoptedWinnerLatestRun({
      taskId: args.taskId,
      winnerSession,
      now,
    });
    await db
      .update(taskExecutionPhases)
      .set({
        winnerSessionId: winnerSession.id,
        status: "completed",
        terminalReason: "winner_adopted",
        finishedAt: phase.finishedAt ?? now,
        updatedAt: now,
      })
      .where(and(eq(taskExecutionPhases.taskId, args.taskId), eq(taskExecutionPhases.id, args.phaseId)));

    for (const session of sessions) {
      await db
        .update(taskSessions)
        .set(
          buildAdoptedTaskSessionUpdate({
            session,
            winnerSessionId: winnerSession.id,
            updatedAt: now,
            winnerFinishedAt,
          }),
        )
        .where(and(eq(taskSessions.taskId, args.taskId), eq(taskSessions.id, session.id)));
    }

    await upsertTaskSnapshotPhaseState({
      taskId: args.taskId,
      projectId: task.projectId,
      phaseId: args.phaseId,
      phaseKind: phase.phaseKind,
      phaseStatus: "completed",
      currentSessionId: winnerSession.id,
      latestSessionId: winnerSession.id,
      candidateCount: phase.candidateCount,
    });

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        ...buildPublicTaskExecutionPhaseRecord({
          phase: {
            ...phase,
            winnerSessionId: winnerSession.id,
            status: "completed",
            terminalReason: "winner_adopted",
            finishedAt: phase.finishedAt ?? now,
            updatedAt: now,
          },
          sessionIds: sessions.map((session) => session.id),
        }),
        currentSessionId: winnerSession.id,
      },
    };
  }

  async function cancelTaskPhase(args: CancelTaskExecutionPhaseArgs) {
    const task = await deps.loadTaskTreeBackedRecord(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const phase = await loadTaskExecutionPhase(args.taskId, args.phaseId);
    if (!phase) {
      return { ok: false as const, status: 404 as const, error: "Task phase not found" };
    }

    if (!["pending", "running", "paused", "awaiting_adoption"].includes(phase.status)) {
      return { ok: false as const, status: 409 as const, error: "Task phase is not cancellable" };
    }

    const sessions = await loadTaskPhaseSessions(args.taskId, args.phaseId);
    const fallbackSessionId =
      phase.winnerSessionId ?? phase.anchorSessionId ?? sessions.at(0)?.id ?? null;
    const now = new Date().toISOString();

    await db
      .update(taskExecutionPhases)
      .set({
        status: "cancelled",
        cancelRequestedAt: phase.cancelRequestedAt ?? now,
        cancelledAt: now,
        terminalReason: args.reason,
        updatedAt: now,
      })
      .where(and(eq(taskExecutionPhases.taskId, args.taskId), eq(taskExecutionPhases.id, args.phaseId)));

    await db
      .update(taskSessions)
      .set({
        executionStatus: "cancelled",
        status: "cancelled",
        updatedAt: now,
        archivedAt: now,
      })
      .where(and(eq(taskSessions.taskId, args.taskId), eq(taskSessions.phaseId, args.phaseId)));

    await upsertTaskSnapshotPhaseState({
      taskId: args.taskId,
      projectId: task.projectId,
      phaseId: args.phaseId,
      phaseKind: phase.phaseKind,
      phaseStatus: "cancelled",
      currentSessionId: fallbackSessionId,
      latestSessionId: fallbackSessionId,
      candidateCount: phase.candidateCount,
    });

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        taskId: args.taskId,
        phaseId: args.phaseId,
        status: "cancelled",
        terminalReason: args.reason,
        currentSessionId: fallbackSessionId,
      },
    };
  }

  async function resumeTaskPhase(args: { taskId: string; phaseId: string }) {
    const task = await deps.loadTaskTreeBackedRecord(args.taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const phase = await loadTaskExecutionPhase(args.taskId, args.phaseId);
    if (!phase) {
      return { ok: false as const, status: 404 as const, error: "Task phase not found" };
    }
    if (phase.status !== "paused") {
      return { ok: false as const, status: 409 as const, error: "Task phase is not resumable" };
    }

    const now = new Date().toISOString();
    await db
      .update(taskExecutionPhases)
      .set({
        status: "running",
        lastHeartbeatAt: now,
        updatedAt: now,
      })
      .where(and(eq(taskExecutionPhases.taskId, args.taskId), eq(taskExecutionPhases.id, args.phaseId)));

    await db
      .update(taskSessions)
      .set({
        executionStatus: "running",
        status: "running",
        archivedAt: null,
        updatedAt: now,
      })
      .where(and(eq(taskSessions.taskId, args.taskId), eq(taskSessions.phaseId, args.phaseId)));

    const snapshot =
      (await db.query.taskSnapshots.findFirst({ where: eq(taskSnapshots.taskId, args.taskId) })) ?? null;
    const fallbackSessionId =
      snapshot?.currentSessionId ?? phase.winnerSessionId ?? phase.anchorSessionId ?? null;

    await upsertTaskSnapshotPhaseState({
      taskId: args.taskId,
      projectId: task.projectId,
      phaseId: args.phaseId,
      phaseKind: phase.phaseKind,
      phaseStatus: "running",
      currentSessionId: fallbackSessionId,
      latestSessionId: snapshot?.latestSessionId ?? fallbackSessionId,
      candidateCount: phase.candidateCount,
    });

    return {
      ok: true as const,
      status: 200 as const,
      data: {
        taskId: args.taskId,
        phaseId: args.phaseId,
        status: "running",
      },
    };
  }

  return {
    listTaskPhases,
    upsertTaskPhase,
    adoptTaskPhase,
    cancelTaskPhase,
    resumeTaskPhase,
  };
}