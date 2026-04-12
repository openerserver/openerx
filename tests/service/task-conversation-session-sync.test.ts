/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { taskSessionRuns, taskSessions } from "../../control-plane/service/src/db/schema";

let importCounter = 0;

function createInsertChain(
  insertRecorder: (payload: unknown) => void,
  conflictRecorder: (payload: unknown) => void,
) {
  return {
    values(payload: unknown) {
      insertRecorder(payload);
      return {
        onConflictDoUpdate: async (args?: { set?: unknown }) => {
          if (args?.set) {
            conflictRecorder(args.set);
          }
          return undefined;
        },
      };
    },
  };
}

function createUpdateChain(recorder: (payload: unknown) => void) {
  return {
    set(payload: unknown) {
      recorder(payload);
      return {
        where: async () => undefined,
      };
    },
  };
}

function resolveTableName(table: unknown) {
  if (table === taskSessions) return "task_sessions";
  if (table === taskSessionRuns) return "task_session_runs";
  return "unknown";
}

async function loadTaskSessionWriteModule(args?: {
  taskSessionFindResults?: unknown[];
  treeNodeRecord?: { id: string } | null;
}) {
  importCounter += 1;

  const insertCalls: Array<{ table: string; payload: unknown }> = [];
  const conflictUpdateCalls: Array<{ table: string; payload: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: unknown }> = [];
  const taskSessionFindResults = [...(args?.taskSessionFindResults ?? [])];

  const fakeDb = {
    query: {
      taskSessions: {
        findFirst: mock(async () => taskSessionFindResults.shift() ?? null),
      },
      projectTreeNodes: {
        findFirst: mock(async () => args?.treeNodeRecord ?? null),
      },
    },
    insert: mock((table: unknown) =>
      createInsertChain(
        (payload) => {
          insertCalls.push({ table: resolveTableName(table), payload });
        },
        (payload) => {
          conflictUpdateCalls.push({ table: resolveTableName(table), payload });
        },
      ),
    ),
    update: mock((table: unknown) =>
      createUpdateChain((payload) => {
        updateCalls.push({ table: resolveTableName(table), payload });
      }),
    ),
  };

  mock.module("../../control-plane/service/src/db", () => ({
    db: fakeDb,
  }));
  mock.module("../../control-plane/service/src/modules/project-tree/storage", () => ({
    getTaskBranchCompatNodeId: (taskId: string, runtimeSessionId: string) =>
      `task_session:${taskId}:${runtimeSessionId}`,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-session-write-api.ts?task-session-write-api-test=${importCounter}`
  );

  return {
    ...module,
    insertCalls,
    conflictUpdateCalls,
    updateCalls,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task session write api", () => {
  test("upserts an active root session into canonical task session tables", async () => {
    const { createTaskSessionWriteApi, insertCalls, updateCalls } =
      await loadTaskSessionWriteModule();

    const api = createTaskSessionWriteApi();

    const sessionId = await api.upsertTaskSessionRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "root-session-1",
      sourceType: "root",
      branchName: "main",
      isActive: true,
    });

    expect(sessionId).toBe("task-session:task-1:root-session-1");

    const insertedSession = insertCalls.find((call) => call.table === "task_sessions")?.payload;
    expect(insertedSession).toMatchObject({
      id: "task-session:task-1:root-session-1",
      taskId: "task-1",
      projectId: "project-1",
      treeNodeId: null,
      parentSessionId: null,
      rootSessionId: "task-session:task-1:root-session-1",
      sessionType: "root",
      sessionKind: "primary",
      triggerType: "execute",
      executionModeSnapshot: "single",
      executionStatus: "running",
      branchName: "main",
      runtimeSessionId: "root-session-1",
    });

    const insertedRun = insertCalls.find((call) => call.table === "task_session_runs")?.payload;
    expect(insertedRun).toMatchObject({
      id: "run_task-session:task-1:root-session-1",
      taskId: "task-1",
      sessionId: "task-session:task-1:root-session-1",
      runtimeSessionId: "root-session-1",
      triggerType: "user_prompt",
      executionKind: "single",
      laneRole: "primary",
      executorKind: "assistant",
      status: "running",
    });

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "task_sessions",
          payload: expect.objectContaining({
            latestRunId: "run_task-session:task-1:root-session-1",
          }),
        }),
      ]),
    );
  });

  test("maps explicit parallel sourceType to candidate follow-up sessions", async () => {
    const { createTaskSessionWriteApi, insertCalls } = await loadTaskSessionWriteModule({
      taskSessionFindResults: [
        null,
        {
          id: "task-session:task-1:root-session-1",
          rootSessionId: "task-session:task-1:root-session-1",
          depth: 0,
          sortKey: "task-session:task-1:root-session-1",
        },
      ],
    });

    const api = createTaskSessionWriteApi();

    const sessionId = await api.upsertTaskSessionRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "candidate-session-1",
      parentRuntimeSessionId: "root-session-1",
      branchName: "候选 A",
      sourceType: "parallel",
      sessionKind: "candidate",
      phaseId: "phase-parallel-1",
      candidateIndex: 0,
      executionModeSnapshot: "parallel",
      isActive: false,
    });

    expect(sessionId).toBe("task-session:task-1:candidate-session-1");

    const insertedSession = insertCalls.find((call) => call.table === "task_sessions")?.payload;
    expect(insertedSession).toMatchObject({
      id: "task-session:task-1:candidate-session-1",
      parentSessionId: "task-session:task-1:root-session-1",
      rootSessionId: "task-session:task-1:root-session-1",
      sessionType: "follow_up",
      sessionKind: "candidate",
      phaseId: "phase-parallel-1",
      triggerType: "execute",
      executionModeSnapshot: "parallel",
      candidateIndex: 0,
      branchName: "候选 A",
      runtimeSessionId: "candidate-session-1",
    });

    const insertedRun = insertCalls.find((call) => call.table === "task_session_runs")?.payload;
    expect(insertedRun).toMatchObject({
      id: "run_task-session:task-1:candidate-session-1",
      sessionId: "task-session:task-1:candidate-session-1",
      phaseId: "phase-parallel-1",
      runtimeSessionId: "candidate-session-1",
      triggerType: "user_prompt",
      executionKind: "parallel_candidate",
      laneRole: "candidate",
      status: "running",
    });
  });

  test("inherits parent/root ids and canonicalizes source messages for fork sessions", async () => {
    const { createTaskSessionWriteApi, insertCalls } = await loadTaskSessionWriteModule({
      taskSessionFindResults: [
        null,
        {
          id: "task-session:task-1:parent-session-1",
          rootSessionId: "task-session:task-1:root-session-1",
          depth: 0,
          sortKey: "task-session:task-1:root-session-1",
        },
      ],
    });

    const api = createTaskSessionWriteApi();

    const sessionId = await api.upsertTaskSessionRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "child-session-1",
      parentRuntimeSessionId: "parent-session-1",
      forkedFromMessageId: "msg-1",
      sourceType: "fork",
      isActive: false,
      archivedAt: "2025-01-01T00:03:00.000Z",
    });

    expect(sessionId).toBe("task-session:task-1:child-session-1");

    const insertedSession = insertCalls.find((call) => call.table === "task_sessions")?.payload;
    expect(insertedSession).toMatchObject({
      id: "task-session:task-1:child-session-1",
      parentSessionId: "task-session:task-1:parent-session-1",
      rootSessionId: "task-session:task-1:root-session-1",
      sourceMessageId: "task-session-message:task-session:task-1:parent-session-1:msg-1",
      sessionType: "manual_branch",
      sessionKind: "manual_branch",
      triggerType: "manual_branch",
      executionStatus: "cancelled",
      status: "archived",
      archivedAt: "2025-01-01T00:03:00.000Z",
      forkedFromMessageId: "msg-1",
      runtimeSessionId: "child-session-1",
    });

    const insertedRun = insertCalls.find((call) => call.table === "task_session_runs")?.payload;
    expect(insertedRun).toMatchObject({
      id: "run_task-session:task-1:child-session-1",
      sessionId: "task-session:task-1:child-session-1",
      runtimeSessionId: "child-session-1",
      triggerType: "manual_branch",
      executionKind: "single",
      laneRole: "primary",
      status: "archived",
    });
  });

  test("does not backfill task session treeNodeId from branch compat nodes", async () => {
    const { createTaskSessionWriteApi, insertCalls } = await loadTaskSessionWriteModule({
      treeNodeRecord: {
        id: "task_session:task-1:root-session-1",
      },
    });

    const api = createTaskSessionWriteApi();

    await api.upsertTaskSessionRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "root-session-1",
      sourceType: "root",
      branchName: "main",
      isActive: true,
    });

    const insertedSession = insertCalls.find((call) => call.table === "task_sessions")?.payload;
    expect(insertedSession).toMatchObject({
      id: "task-session:task-1:root-session-1",
      treeNodeId: null,
    });
  });

  test("passive conflict updates complete active candidates without rewriting lineage", async () => {
    const { createTaskSessionWriteApi, conflictUpdateCalls } = await loadTaskSessionWriteModule({
      taskSessionFindResults: [
        {
          id: "task-session:task-1:candidate-1",
          projectId: "project-1",
          taskId: "task-1",
          treeNodeId: null,
          parentSessionId: "task-session:task-1:root-session-1",
          rootSessionId: "task-session:task-1:root-session-1",
          sourceMessageId: null,
          sessionType: "follow_up",
          workflowStageKey: null,
          spawnTriggerType: "execute",
          spawnRuleKey: null,
          userPromptSummary: null,
          status: "running",
          headMessageId: null,
          latestRunId: "run_task-session:task-1:candidate-1",
          depth: 1,
          sortKey: "task-session:task-1:root-session-1.task-session:task-1:candidate-1",
          coordinationKey: "task-session:task-1:root-session-1",
          operationId: "operation-1",
          sessionKind: "candidate",
          triggerType: "execute",
          executionModeSnapshot: "parallel",
          executionStatus: "running",
          branchName: "候选 A",
          candidateIndex: 0,
          stepIndex: null,
          runtimeSessionId: "candidate-1",
          forkedFromMessageId: null,
          selectedModel: "github-copilot:gpt-4o",
          effectiveModel: null,
          winnerSessionId: null,
          judgeSessionId: null,
          resultText: null,
          resultSummary: null,
          errorText: null,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          lastActivityAt: "2026-03-24T00:00:00.000Z",
          startedAt: "2026-03-24T00:00:00.000Z",
          finishedAt: null,
          createdAt: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-24T00:00:00.000Z",
          archivedAt: null,
        },
      ],
    });

    const api = createTaskSessionWriteApi();

    await api.upsertTaskSessionRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "candidate-1",
      isActive: false,
    });

    const sessionConflictUpdate = conflictUpdateCalls.find(
      (call) => call.table === "task_sessions",
    )?.payload as Record<string, unknown>;
    expect(sessionConflictUpdate).toMatchObject({
      projectId: "project-1",
      status: "completed",
      executionStatus: "complete",
      runtimeSessionId: "candidate-1",
      finishedAt: expect.any(String),
    });
    expect(sessionConflictUpdate).not.toHaveProperty("parentSessionId");
    expect(sessionConflictUpdate).not.toHaveProperty("rootSessionId");
    expect(sessionConflictUpdate).not.toHaveProperty("sourceMessageId");
    expect(sessionConflictUpdate).not.toHaveProperty("sessionType");
    expect(sessionConflictUpdate).not.toHaveProperty("spawnTriggerType");
    expect(sessionConflictUpdate).not.toHaveProperty("depth");
    expect(sessionConflictUpdate).not.toHaveProperty("sortKey");
    expect(sessionConflictUpdate).not.toHaveProperty("coordinationKey");
    expect(sessionConflictUpdate).not.toHaveProperty("operationId");
    expect(sessionConflictUpdate).not.toHaveProperty("sessionKind");
    expect(sessionConflictUpdate).not.toHaveProperty("triggerType");
    expect(sessionConflictUpdate).not.toHaveProperty("executionModeSnapshot");
    expect(sessionConflictUpdate).not.toHaveProperty("branchName");
    expect(sessionConflictUpdate).not.toHaveProperty("candidateIndex");
    expect(sessionConflictUpdate).not.toHaveProperty("stepIndex");
    expect(sessionConflictUpdate).not.toHaveProperty("forkedFromMessageId");
    expect(sessionConflictUpdate).not.toHaveProperty("selectedModel");

    const runConflictUpdate = conflictUpdateCalls.find(
      (call) => call.table === "task_session_runs",
    )?.payload as Record<string, unknown>;
    expect(runConflictUpdate).toMatchObject({
      taskId: "task-1",
      sessionId: "task-session:task-1:candidate-1",
      runtimeSessionId: "candidate-1",
      status: "completed",
      finishedAt: expect.any(String),
    });
    expect(runConflictUpdate).not.toHaveProperty("triggerType");
    expect(runConflictUpdate).not.toHaveProperty("executionKind");
    expect(runConflictUpdate).not.toHaveProperty("coordinationKey");
    expect(runConflictUpdate).not.toHaveProperty("operationId");
    expect(runConflictUpdate).not.toHaveProperty("candidateIndex");
    expect(runConflictUpdate).not.toHaveProperty("laneRole");
    expect(runConflictUpdate).not.toHaveProperty("executorKind");
    expect(runConflictUpdate).not.toHaveProperty("modelRoute");
  });
});
