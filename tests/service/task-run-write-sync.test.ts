/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { taskOperations, taskSessionRuns } from "../../control-plane/service/src/db/schema";

let importCounter = 0;

function createInsertChain(recorder: (payload: unknown) => void) {
  return {
    values(payload: unknown) {
      recorder(payload);
      return {
        onConflictDoUpdate: async () => undefined,
      };
    },
  };
}

function resolveTableName(table: unknown) {
  if (table === taskOperations) return "task_operations";
  if (table === taskSessionRuns) return "task_session_runs";
  return "unknown";
}

async function loadTaskOperationWriteModule(args?: {
  taskOperationFindResults?: unknown[];
}) {
  importCounter += 1;

  const insertCalls: Array<{ table: string; payload: unknown }> = [];
  const taskOperationFindResults = [...(args?.taskOperationFindResults ?? [])];

  const fakeDb = {
    query: {
      taskOperations: {
        findFirst: mock(async () => taskOperationFindResults.shift() ?? null),
      },
    },
    insert: mock((table: unknown) =>
      createInsertChain((payload) => {
        insertCalls.push({ table: resolveTableName(table), payload });
      }),
    ),
  };

  mock.module("../../control-plane/service/src/db", () => ({
    db: fakeDb,
  }));
  mock.module("../../control-plane/service/src/modules/tasks/task-session-write-api", () => ({
    buildTaskSessionDefaultRunId: (sessionId: string) => `run_${sessionId}`,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/session-operation-write-api.ts?task-operation-write-api-test=${importCounter}`
  );

  return {
    ...module,
    insertCalls,
  };
}

function createTaskRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    projectId: "project-1",
    userId: null,
    title: "Task title",
    prompt: "Task prompt",
    status: "running",
    sessionId: "task-session-root",
    agentRunId: null,
    result: "existing result",
    category: null,
    strategy: null,
    repoId: null,
    workspaceRoot: null,
    baseRevision: null,
    workingBranch: null,
    selectedModel: "github-copilot:gpt-5.4",
    executionMode: "parallel",
    autoAdvanceStages: false,
    credentialId: null,
    gitAuthorName: null,
    gitAuthorEmail: null,
    gitCommitterName: null,
    gitCommitterEmail: null,
    finalCommitSha: null,
    finalBranchName: null,
    changesSummary: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    startedAt: "2025-01-01T00:00:10.000Z",
    finishedAt: null,
    orchestrationKind: null,
    currentRunId: null,
    currentRunStatus: null,
    currentRunStartedAt: null,
    currentRunFinishedAt: null,
    currentRunCandidateCount: null,
    currentRunPipelineStepCount: null,
    latestResultSummary: null,
    latestErrorText: null,
    activeCandidateCount: 0,
    completedCandidateCount: 0,
    failedCandidateCount: 0,
    totalChainSteps: 0,
    completedChainSteps: 0,
    winnerNodeId: null,
    lastActivityAt: null,
    repoName: null,
    remoteUrl: null,
    credentialLabel: null,
    ...overrides,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task operation write api", () => {
  test("syncs agent runs into canonical task session runs, operations, usage entries, and aggregate snapshots", async () => {
    const { createTaskOperationWriteApi, insertCalls } = await loadTaskOperationWriteModule({
      taskOperationFindResults: [null, null],
    });

    const upsertTaskSessionRecord = mock(async () => "task-session:task-1:runtime-session-1");
    const appendTaskUsageLedgerEntry = mock(async () => ({ id: "ledger-1" }));
    const snapshot = { id: "snapshot-1" } as never;
    const buildTaskTreeSnapshotFromRecord = mock(() => snapshot);
    const syncTaskAggregateFromSnapshot = mock(async () => undefined);

    const api = createTaskOperationWriteApi({
      upsertTaskSessionRecord,
      buildTaskTreeSnapshotFromRecord,
      syncTaskAggregateFromSnapshot,
      appendTaskUsageLedgerEntry,
    });

    const result = await api.syncExecutionFactsForAgentRun({
      task: createTaskRecord(),
      agentRunId: "agent-run-1",
      sessionId: "runtime-session-1",
      agentType: "builder",
      status: "terminated",
      modelUsed: "github-copilot:gpt-5-mini",
      tokenUsed: 13,
      result: "candidate stopped",
      error: "manually stopped",
      candidateIndex: 1,
      startedAt: "2025-01-01T00:01:00.000Z",
      finishedAt: "2025-01-01T00:01:30.000Z",
    });

    expect(result).toEqual({
      taskSessionId: "task-session:task-1:runtime-session-1",
      taskOperationId: "session-operation:task-1:agent-run-1",
    });
    expect(upsertTaskSessionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSessionId: "runtime-session-1",
        sourceType: "root",
        operationId: "session-operation:task-1:agent-run-1",
        isActive: false,
        archivedAt: "2025-01-01T00:01:30.000Z",
      }),
    );

    const insertedRun = insertCalls.find((call) => call.table === "task_session_runs")?.payload;
    expect(insertedRun).toMatchObject({
      id: "run_task-session:task-1:runtime-session-1",
      taskId: "task-1",
      sessionId: "task-session:task-1:runtime-session-1",
      runtimeSessionId: "runtime-session-1",
      candidateIndex: 1,
      executionKind: "single",
      laneRole: "primary",
      executorKind: "builder",
      modelRoute: "github-copilot:gpt-5-mini",
      status: "cancelled",
      outputTokens: 13,
      totalTokens: 13,
      resultSummary: "candidate stopped",
      errorText: "manually stopped",
    });

    const insertedOperation = insertCalls.find((call) => call.table === "task_operations")?.payload;
    expect(insertedOperation).toMatchObject({
      id: "session-operation:task-1:agent-run-1",
      taskId: "task-1",
      sessionId: "task-session:task-1:runtime-session-1",
      runId: "run_task-session:task-1:runtime-session-1",
      runtimeOperationId: "agent-run:agent-run-1",
      operationKind: "model_request",
      status: "cancelled",
      summaryJson: expect.objectContaining({
        agentRunId: "agent-run-1",
        candidateIndex: 1,
        modelUsed: "github-copilot:gpt-5-mini",
        tokenUsed: 13,
        resultText: "candidate stopped",
        errorText: "manually stopped",
        status: "terminated",
      }),
    });

    expect(appendTaskUsageLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        projectId: "project-1",
        sessionId: "task-session:task-1:runtime-session-1",
        operationId: "session-operation:task-1:agent-run-1",
        entryKind: "model_request",
        modelId: "github-copilot:gpt-5-mini",
        outputTokens: 13,
      }),
    );
    expect(buildTaskTreeSnapshotFromRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
      expect.objectContaining({
        status: "cancelled",
        sessionId: "runtime-session-1",
        agentRunId: "agent-run-1",
        result: "candidate stopped",
        selectedModel: "github-copilot:gpt-5-mini",
      }),
    );
    expect(syncTaskAggregateFromSnapshot).toHaveBeenCalledWith(snapshot);
  });

  test("normalizes canonical session ids and maps judge agent runs to judge semantics", async () => {
    const { createTaskOperationWriteApi, insertCalls } = await loadTaskOperationWriteModule({
      taskOperationFindResults: [null, null],
    });

    const upsertTaskSessionRecord = mock(async () => "task-session:task-1:judge-session");
    const appendTaskUsageLedgerEntry = mock(async () => ({ id: "ledger-judge" }));

    const api = createTaskOperationWriteApi({
      upsertTaskSessionRecord,
      appendTaskUsageLedgerEntry,
    });

    await api.syncExecutionFactsForAgentRun({
      task: createTaskRecord({ executionMode: "single" }),
      agentRunId: "judge-run-1",
      sessionId: "task-session:task-1:judge-session",
      agentType: "Judge",
      status: "completed",
      result: "picked candidate 2",
    });

    expect(upsertTaskSessionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSessionId: "judge-session",
      }),
    );

    const insertedRun = insertCalls.find((call) => call.table === "task_session_runs")?.payload;
    expect(insertedRun).toMatchObject({
      sessionId: "task-session:task-1:judge-session",
      runtimeSessionId: "judge-session",
      executionKind: "judge",
      laneRole: "judge",
      status: "completed",
    });

    const insertedOperation = insertCalls.find((call) => call.table === "task_operations")?.payload;
    expect(insertedOperation).toMatchObject({
      operationKind: "judge",
      status: "completed",
      summaryJson: expect.objectContaining({
        agentRunId: "judge-run-1",
        status: "completed",
      }),
    });

    expect(appendTaskUsageLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "task-session:task-1:judge-session",
        entryKind: "judge_request",
      }),
    );
  });
});
