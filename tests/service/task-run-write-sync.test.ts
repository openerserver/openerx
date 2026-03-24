/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  conversationSessions,
  tasks as taskAggregates,
  taskRunNodes,
  taskRuns,
} from "../../control-plane/service/src/db/schema";

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

async function loadTaskRunWriteSyncModule(args?: {
  conversationSessionRecord?: { id: string } | null;
}) {
  importCounter += 1;

  const insertedRuns: unknown[] = [];
  const insertedRunNodes: unknown[] = [];
  const updatedAggregates: unknown[] = [];

  const fakeDb = {
    query: {
      conversationSessions: {
        findFirst: mock(async () => args?.conversationSessionRecord ?? null),
      },
    },
    insert: mock((table: unknown) => {
      if (table === taskRuns) {
        return createInsertChain((payload) => {
          insertedRuns.push(payload);
        });
      }

      if (table === taskRunNodes) {
        return createInsertChain((payload) => {
          insertedRunNodes.push(payload);
        });
      }

      return createInsertChain(() => undefined);
    }),
    update: mock((table: unknown) => {
      if (table === taskAggregates) {
        return createUpdateChain((payload) => {
          updatedAggregates.push(payload);
        });
      }

      return createUpdateChain(() => undefined);
    }),
  };

  mock.module("../../control-plane/service/src/db", () => ({
    db: fakeDb,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-run-write-sync.ts?task-run-write-sync-test=${importCounter}`
  );

  return {
    ...module,
    fakeDb,
    insertedRuns,
    insertedRunNodes,
    updatedAggregates,
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

describe("task run write sync", () => {
  test("maps parallel candidate agent runs into task run, node, aggregate, and domain event updates", async () => {
    const { createTaskRunWriteSyncApi, insertedRuns, insertedRunNodes, updatedAggregates } =
      await loadTaskRunWriteSyncModule({
        conversationSessionRecord: { id: "task_session:task-1:runtime-session-1" },
      });

    const appendTaskDomainEvent = mock(async () => undefined);
    const api = createTaskRunWriteSyncApi({ appendTaskDomainEvent });

    const result = await api.syncExecutionFactsForAgentRun({
      task: createTaskRecord(),
      agentRunId: "agent-run-1",
      linkAgentRun: false,
      sessionId: "runtime-session-1",
      agentType: "executor",
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
      taskRunId: "task_run:task-1:runtime-session-1",
      taskRunNodeId: "task_run:task-1:runtime-session-1:node:agent-run-1",
    });
    expect(insertedRuns[0]).toMatchObject({
      id: "task_run:task-1:runtime-session-1",
      taskId: "task-1",
      orchestrationKind: "parallel",
      sourceType: "executor",
      status: "cancelled",
      rootSessionId: "runtime-session-1",
      effectiveModel: "github-copilot:gpt-5-mini",
      candidateCount: 2,
      resultText: "candidate stopped",
      errorText: "manually stopped",
      startedAt: "2025-01-01T00:01:00.000Z",
      finishedAt: "2025-01-01T00:01:30.000Z",
    });
    expect(insertedRunNodes[0]).toMatchObject({
      id: "task_run:task-1:runtime-session-1:node:agent-run-1",
      runId: "task_run:task-1:runtime-session-1",
      nodeKind: "candidate",
      nodeKey: "candidate:1:agent-run-1",
      sessionId: "runtime-session-1",
      agentRunId: null,
      status: "cancelled",
      tokenUsed: 13,
    });
    expect(updatedAggregates[0]).toMatchObject({
      currentRunId: "task_run:task-1:runtime-session-1",
      currentSessionId: "runtime-session-1",
      currentAgentRunId: "agent-run-1",
      status: "cancelled",
      latestResult: "candidate stopped",
      latestResultSummary: "candidate stopped",
      finishedAt: "2025-01-01T00:01:30.000Z",
    });
    expect(appendTaskDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        taskId: "task-1",
        runId: "task_run:task-1:runtime-session-1",
        runNodeId: "task_run:task-1:runtime-session-1:node:agent-run-1",
        sessionId: "task_session:task-1:runtime-session-1",
        eventType: "task.run-node.upserted",
        payload: expect.objectContaining({
          nodeKind: "candidate",
          status: "cancelled",
          runtimeSessionId: "runtime-session-1",
          candidateIndex: 1,
        }),
      }),
    );
  });

  test("resolves conversation timeline session ids and maps judge agent types", async () => {
    const { createTaskRunWriteSyncApi, insertedRunNodes } = await loadTaskRunWriteSyncModule({
      conversationSessionRecord: { id: "task_session:task-1:judge-session" },
    });

    const appendTaskDomainEvent = mock(async () => undefined);
    const api = createTaskRunWriteSyncApi({ appendTaskDomainEvent });

    expect(await api.resolveConversationTimelineSessionId("task-1", null)).toBeNull();
    expect(await api.resolveConversationTimelineSessionId("task-1", "judge-session")).toBe(
      "task_session:task-1:judge-session",
    );

    await api.syncExecutionFactsForAgentRun({
      task: createTaskRecord({ executionMode: "single" }),
      agentRunId: "judge-run-1",
      sessionId: "judge-session",
      agentType: "Judge",
      status: "completed",
      result: "picked candidate 2",
    });

    expect(insertedRunNodes[0]).toMatchObject({
      nodeKind: "judge",
      nodeKey: "judge:judge-run-1",
      status: "completed",
    });
  });
});
