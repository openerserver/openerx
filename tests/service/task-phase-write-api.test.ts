/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

let importCounter = 0;

const fakeTaskExecutionPhases = {
  id: "id",
  taskId: "taskId",
  phaseIndex: "phaseIndex",
  createdAt: "createdAt",
};

const fakeTaskSessions = {
  id: "id",
  taskId: "taskId",
  phaseId: "phaseId",
  createdAt: "createdAt",
  status: "status",
  executionStatus: "executionStatus",
  latestRunId: "latestRunId",
  headMessageId: "headMessageId",
  finishedAt: "finishedAt",
};

const fakeTaskSessionRuns = {
  id: "id",
  taskId: "taskId",
  sessionId: "sessionId",
  status: "status",
  finishedAt: "finishedAt",
};

const fakeTaskMessages = {
  id: "id",
  taskId: "taskId",
  sessionId: "sessionId",
  role: "role",
  status: "status",
  createdByRunId: "createdByRunId",
  completedAt: "completedAt",
};

const fakeTaskOperations = {
  id: "id",
};

const fakeTaskSnapshots = {
  taskId: "taskId",
};

function createInsertChain(recorder: (payload: unknown, conflictSet?: unknown) => void) {
  return {
    values(payload: unknown) {
      return {
        onConflictDoUpdate: async (config?: { set?: unknown }) => {
          recorder(payload, config?.set);
        },
      };
    },
  };
}

function resolveTableName(table: unknown) {
  if (table === fakeTaskExecutionPhases) {
    return "task_execution_phases";
  }
  if (table === fakeTaskSessions) {
    return "task_sessions";
  }
  if (table === fakeTaskSnapshots) {
    return "task_snapshots";
  }
  if (table === fakeTaskSessionRuns) {
    return "task_session_runs";
  }
  if (table === fakeTaskMessages) {
    return "task_messages";
  }
  if (table === fakeTaskOperations) {
    return "task_operations";
  }

  return "unknown";
}

async function loadTaskPhaseWriteModule(options?: {
  phaseFindFirstResults?: Array<Record<string, unknown> | null>;
  phaseSessions?: Array<Record<string, unknown>>;
  winnerSession?: Record<string, unknown> | null;
  existingSnapshot?: Record<string, unknown> | null;
  winnerLatestRun?: Record<string, unknown> | null;
  winnerHeadMessage?: Record<string, unknown> | null;
}) {
  importCounter += 1;

  let insertedPhase: Record<string, unknown> | null = null;
  const insertCalls: Array<{ table: string; payload: unknown; conflictSet?: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: unknown }> = [];
  let phaseLookupCount = 0;
  const phaseFindFirstResults = options?.phaseFindFirstResults ?? null;

  const fakeDb = {
    query: {
      taskExecutionPhases: {
        findFirst: mock(async () => {
          if (phaseFindFirstResults && phaseLookupCount < phaseFindFirstResults.length) {
            const result = phaseFindFirstResults[phaseLookupCount] ?? null;
            phaseLookupCount += 1;
            return result;
          }
          phaseLookupCount += 1;
          return phaseLookupCount === 1 ? null : insertedPhase;
        }),
        findMany: mock(async () => []),
      },
      taskSessions: {
        findMany: mock(async () => options?.phaseSessions ?? []),
        findFirst: mock(async () => options?.winnerSession ?? null),
      },
      taskSessionRuns: {
        findFirst: mock(async () => options?.winnerLatestRun ?? null),
      },
      taskMessages: {
        findFirst: mock(async () => options?.winnerHeadMessage ?? null),
      },
      taskSnapshots: {
        findFirst: mock(async () => options?.existingSnapshot ?? null),
      },
    },
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(async () => []),
        })),
      })),
    })),
    insert: mock((table: unknown) =>
      createInsertChain((payload, conflictSet) => {
        insertCalls.push({ table: resolveTableName(table), payload, conflictSet });
        if (table === fakeTaskExecutionPhases) {
          insertedPhase = payload as Record<string, unknown>;
        }
      })),
    update: mock((table: unknown) => ({
      set: mock((payload: unknown) => ({
        where: mock(async () => {
          updateCalls.push({ table: resolveTableName(table), payload });
        }),
      })),
    })),
  };

  mock.module("../../control-plane/service/src/db", () => ({
    db: fakeDb,
  }));
  mock.module("../../control-plane/service/src/db/schema", () => ({
    taskExecutionPhases: fakeTaskExecutionPhases,
    taskMessages: fakeTaskMessages,
    taskOperations: fakeTaskOperations,
    taskSessionRuns: fakeTaskSessionRuns,
    taskSessions: fakeTaskSessions,
    taskSnapshots: fakeTaskSnapshots,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-phase-write-api.ts?task-phase-write-api-test=${importCounter}`
  );

  return {
    ...module,
    insertCalls,
    updateCalls,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task phase write api", () => {
  test("persists awaiting_adoption into task snapshot execution status", async () => {
    const { createTaskPhaseWriteApi, insertCalls } = await loadTaskPhaseWriteModule();
    const api = createTaskPhaseWriteApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
      } as never)),
    });

    const result = await api.upsertTaskPhase("task-1", {
      id: "phase-1",
      phaseKind: "parallel",
      triggerType: "execute",
      status: "awaiting_adoption",
      candidateCount: 2,
    });

    expect(result.ok).toBe(true);

    const snapshotInsert = insertCalls.find((call) => call.table === "task_snapshots")?.payload;
    expect(snapshotInsert).toMatchObject({
      taskId: "task-1",
      currentExecutionMode: "parallel",
      currentExecutionStatus: "awaiting_adoption",
      lifecycleStatus: "active",
      activeCandidateCount: 2,
    });
  });

  test("persists completed phases as done lifecycle snapshots", async () => {
    const { createTaskPhaseWriteApi, insertCalls } = await loadTaskPhaseWriteModule();
    const api = createTaskPhaseWriteApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
      } as never)),
    });

    const result = await api.upsertTaskPhase("task-1", {
      id: "phase-1",
      phaseKind: "parallel",
      triggerType: "execute",
      status: "completed",
      candidateCount: 2,
    });

    expect(result.ok).toBe(true);

    const snapshotInsert = insertCalls.find((call) => call.table === "task_snapshots")?.payload;
    expect(snapshotInsert).toMatchObject({
      taskId: "task-1",
      lifecycleStatus: "done",
      currentExecutionStatus: "complete",
      activeCandidateCount: 0,
    });
  });

  test("stamps awaitingAdoptionSince when an existing phase enters awaiting_adoption", async () => {
    const { createTaskPhaseWriteApi, insertCalls } = await loadTaskPhaseWriteModule();
    const api = createTaskPhaseWriteApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
      } as never)),
    });

    const initial = await api.upsertTaskPhase("task-1", {
      id: "phase-1",
      phaseKind: "parallel",
      triggerType: "execute",
      status: "running",
      candidateCount: 2,
    });

    expect(initial.ok).toBe(true);
    expect(initial.data.awaitingAdoptionSince).toBeNull();

    const transitioned = await api.upsertTaskPhase("task-1", {
      id: "phase-1",
      phaseKind: "parallel",
      triggerType: "execute",
      status: "awaiting_adoption",
      candidateCount: 2,
    });

    expect(transitioned.ok).toBe(true);
    expect(typeof transitioned.data.awaitingAdoptionSince).toBe("string");

    const phaseWrites = insertCalls.filter((call) => call.table === "task_execution_phases");
    const latestPhaseWrite = phaseWrites.at(-1);

    expect(latestPhaseWrite?.payload).toMatchObject({
      id: "phase-1",
    });
    expect(latestPhaseWrite?.conflictSet).toMatchObject({
      awaitingAdoptionSince: expect.any(String),
    });
  });

  test("adoptTaskPhase reconciles session execution status and snapshot lifecycle", async () => {
    const phase = {
      id: "phase-1",
      taskId: "task-1",
      projectId: "project-1",
      parentPhaseId: null,
      phaseIndex: 1,
      phaseKind: "parallel",
      triggerType: "execute",
      status: "awaiting_adoption",
      resumedFromPhaseId: null,
      awaitingAdoptionSince: "2026-04-09T10:00:00.000Z",
      cancelRequestedAt: null,
      cancelledAt: null,
      terminalReason: null,
      lastHeartbeatAt: null,
      anchorSessionId: null,
      anchorMessageId: null,
      coordinationKey: null,
      candidateCount: 2,
      winnerSessionId: null,
      judgeSessionId: null,
      requestedModel: null,
      effectiveModel: null,
      resultSummary: null,
      errorText: null,
      startedAt: "2026-04-09T09:59:00.000Z",
      finishedAt: null,
      createdAt: "2026-04-09T09:59:00.000Z",
      updatedAt: "2026-04-09T10:00:00.000Z",
    };
    const candidateA = {
      id: "session-a",
      taskId: "task-1",
      phaseId: "phase-1",
      createdAt: "2026-04-09T09:59:01.000Z",
      status: "completed",
      executionStatus: "running",
      latestRunId: "run-a",
      headMessageId: "msg-a",
      finishedAt: "2026-04-09T10:00:01.000Z",
    };
    const candidateB = {
      id: "session-b",
      taskId: "task-1",
      phaseId: "phase-1",
      createdAt: "2026-04-09T09:59:02.000Z",
      status: "completed",
      executionStatus: "complete",
      latestRunId: "run-b",
      headMessageId: "msg-b",
      finishedAt: null,
    };

    const { createTaskPhaseWriteApi, insertCalls, updateCalls } = await loadTaskPhaseWriteModule({
      phaseFindFirstResults: [phase],
      phaseSessions: [candidateA, candidateB],
      winnerSession: candidateB,
      winnerLatestRun: {
        id: "run-b",
        taskId: "task-1",
        sessionId: "session-b",
        status: "running",
        finishedAt: null,
      },
      winnerHeadMessage: {
        id: "msg-b",
        taskId: "task-1",
        sessionId: "session-b",
        role: "assistant",
        status: "completed",
        createdByRunId: "run-b",
        completedAt: "2026-04-09T10:00:02.500Z",
      },
      existingSnapshot: {
        taskId: "task-1",
        lifecycleStatus: "active",
        currentExecutionStatus: "awaiting_adoption",
        currentSessionId: "session-a",
        latestSessionId: "session-b",
        latestResultSummary: null,
        latestErrorText: null,
        activeCandidateCount: 2,
        totalChainSteps: 0,
        completedChainSteps: 0,
      },
    });
    const api = createTaskPhaseWriteApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
      } as never)),
    });

    const result = await api.adoptTaskPhase({
      taskId: "task-1",
      phaseId: "phase-1",
      winnerSessionId: "session-b",
    });

    expect(result.ok).toBe(true);

    const sessionUpdates = updateCalls.filter((call) => call.table === "task_sessions");
    expect(sessionUpdates).toHaveLength(2);
    const runUpdates = updateCalls.filter((call) => call.table === "task_session_runs");
    expect(runUpdates).toHaveLength(1);
    expect(runUpdates[0]?.payload).toMatchObject({
      status: "completed",
      finishedAt: "2026-04-09T10:00:02.500Z",
    });
    expect(sessionUpdates[0]?.payload).toMatchObject({
      winnerSessionId: "session-b",
      status: "completed",
      executionStatus: "complete",
      updatedAt: expect.any(String),
    });
    expect(sessionUpdates[1]?.payload).toMatchObject({
      winnerSessionId: "session-b",
      status: "completed",
      executionStatus: "complete",
      finishedAt: "2026-04-09T10:00:02.500Z",
      updatedAt: expect.any(String),
    });

    const snapshotInsert = insertCalls.filter((call) => call.table === "task_snapshots").at(-1)?.payload;
    expect(snapshotInsert).toMatchObject({
      taskId: "task-1",
      lifecycleStatus: "done",
      currentExecutionStatus: "complete",
      currentSessionId: "session-b",
      latestSessionId: "session-b",
      activeCandidateCount: 0,
    });
  });

  test("pauseTaskPhase marks phase, sessions, and snapshot as paused", async () => {
    const phase = {
      id: "phase-1",
      taskId: "task-1",
      projectId: "project-1",
      parentPhaseId: null,
      phaseIndex: 1,
      phaseKind: "single",
      triggerType: "execute",
      status: "running",
      resumedFromPhaseId: null,
      awaitingAdoptionSince: null,
      cancelRequestedAt: null,
      cancelledAt: null,
      terminalReason: null,
      lastHeartbeatAt: null,
      anchorSessionId: "task-session:task-1:session-1",
      anchorMessageId: null,
      coordinationKey: null,
      candidateCount: 1,
      winnerSessionId: null,
      judgeSessionId: null,
      requestedModel: null,
      effectiveModel: null,
      resultSummary: null,
      errorText: null,
      startedAt: "2026-04-17T09:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-04-17T09:00:00.000Z",
      updatedAt: "2026-04-17T09:00:00.000Z",
    };

    const { createTaskPhaseWriteApi, insertCalls, updateCalls } = await loadTaskPhaseWriteModule({
      phaseFindFirstResults: [phase],
      phaseSessions: [
        {
          id: "task-session:task-1:session-1",
          taskId: "task-1",
          phaseId: "phase-1",
          createdAt: "2026-04-17T09:00:00.000Z",
          status: "running",
          executionStatus: "running",
          latestRunId: "run-1",
          headMessageId: "msg-1",
          finishedAt: null,
        },
      ],
      existingSnapshot: {
        taskId: "task-1",
        lifecycleStatus: "active",
        currentExecutionStatus: "running",
        currentSessionId: "task-session:task-1:session-1",
        latestSessionId: "task-session:task-1:session-1",
        latestResultSummary: null,
        latestErrorText: null,
        activeCandidateCount: 1,
        totalChainSteps: 0,
        completedChainSteps: 0,
      },
    });
    const api = createTaskPhaseWriteApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
      } as never)),
    });

    const result = await api.pauseTaskPhase({
      taskId: "task-1",
      phaseId: "phase-1",
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      taskId: "task-1",
      phaseId: "phase-1",
      status: "paused",
      currentSessionId: "task-session:task-1:session-1",
    });

    const phaseUpdate = updateCalls.find((call) => call.table === "task_execution_phases");
    expect(phaseUpdate?.payload).toMatchObject({
      status: "paused",
      updatedAt: expect.any(String),
      lastHeartbeatAt: expect.any(String),
    });
    const sessionUpdate = updateCalls.find((call) => call.table === "task_sessions");
    expect(sessionUpdate?.payload).toMatchObject({
      status: "paused",
      executionStatus: "paused",
      updatedAt: expect.any(String),
    });

    const snapshotInsert = insertCalls.filter((call) => call.table === "task_snapshots").at(-1)?.payload;
    expect(snapshotInsert).toMatchObject({
      taskId: "task-1",
      currentExecutionMode: "single",
      currentExecutionStatus: "running",
      currentPhaseId: "phase-1",
      currentSessionId: "task-session:task-1:session-1",
      latestSessionId: "task-session:task-1:session-1",
      activeCandidateCount: 0,
    });
  });
});