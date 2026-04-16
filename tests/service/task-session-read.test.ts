/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

let importCounter = 0;

function createSelectChain(resultResolver: (table: unknown) => unknown[]) {
  return {
    from(table: unknown) {
      return {
        where() {
          return {
            orderBy: mock(async () => resultResolver(table)),
          };
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

async function loadTaskSessionReadModule(args?: {
  sessionRows?: unknown[];
  phaseRows?: unknown[];
  taskDomainEventRows?: unknown[];
  sessionOperationRows?: unknown[];
  sessionRunRows?: unknown[];
  workflowRunRows?: unknown[];
  workflowRunRowsByCall?: unknown[][];
  taskStageRunRows?: unknown[];
  messageRows?: unknown[];
  messageRowsByCall?: unknown[][];
  partRows?: unknown[];
  partRowsByCall?: unknown[][];
  timelineRows?: unknown[];
  winnerSession?: Record<string, unknown> | null;
  snapshot?: Record<string, unknown> | null;
}) {
  importCounter += 1;

  const updatedTaskSessions: unknown[] = [];
  const updatedTaskSnapshots: unknown[] = [];
  let taskMessagesSelectCount = 0;
  let taskMessagePartsSelectCount = 0;
  let taskWorkflowRunsSelectCount = 0;
  const ensureTaskWorkflowFactsAvailable = mock(async () => null);

  const fakeTaskSessions = {
    id: "id",
    taskId: "taskId",
    parentSessionId: "parentSessionId",
    runtimeSessionId: "runtimeSessionId",
    coordinationKey: "coordinationKey",
    createdAt: "createdAt",
  };
  const fakeTaskSessionRuns = {
    sessionId: "sessionId",
    taskId: "taskId",
    modelRoute: "modelRoute",
    createdAt: "createdAt",
  };
  const fakeTaskWorkflowRuns = {
    id: "id",
    taskId: "taskId",
    templateId: "templateId",
    currentStage: "currentStage",
    status: "status",
    createdAt: "createdAt",
  };
  const fakeTaskStageRuns = {
    id: "id",
    workflowRunId: "workflowRunId",
    stageKey: "stageKey",
    approvalState: "approvalState",
    createdAt: "createdAt",
  };
  const fakeTaskExecutionPhases = {
    id: "id",
    taskId: "taskId",
    phaseIndex: "phaseIndex",
    createdAt: "createdAt",
  };
  const fakeTaskOperations = {
    id: "id",
    sessionId: "sessionId",
    taskId: "taskId",
    operationIndex: "operationIndex",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    status: "status",
    operationKind: "operationKind",
    title: "title",
    runtimeOperationId: "runtimeOperationId",
    summaryJson: "summaryJson",
    startedAt: "startedAt",
    finishedAt: "finishedAt",
  };
  const fakeTaskMessages = {
    id: "id",
    taskId: "taskId",
    sessionId: "sessionId",
    seq: "seq",
    createdAt: "createdAt",
  };
  const fakeTaskMessageParts = {
    messageId: "messageId",
    partIndex: "partIndex",
  };
  const fakeTaskSnapshots = {
    taskId: "taskId",
  };
  const fakeTaskDomainEvents = {
    taskId: "taskId",
    seq: "seq",
    createdAt: "createdAt",
  };
  const fakeTaskTimelineViews = {
    id: "id",
    taskId: "taskId",
    projectId: "projectId",
    sessionId: "sessionId",
    messageId: "messageId",
    operationId: "operationId",
    artifactId: "artifactId",
    itemKind: "itemKind",
    itemRole: "itemRole",
    title: "title",
    displayText: "displayText",
    metadataJson: "metadataJson",
    sortAt: "sortAt",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  };

  function resolveTableName(table: unknown) {
    if (table === fakeTaskSessions) return "task_sessions";
    if (table === fakeTaskSessionRuns) return "task_session_runs";
    if (table === fakeTaskWorkflowRuns) return "task_workflow_runs";
    if (table === fakeTaskStageRuns) return "task_stage_runs";
    if (table === fakeTaskOperations) return "task_operations";
    if (table === fakeTaskMessages) return "task_messages";
    if (table === fakeTaskMessageParts) return "task_message_parts";
    if (table === fakeTaskSnapshots) return "task_snapshots";
    if (table === fakeTaskDomainEvents) return "task_domain_events";
    if (table === fakeTaskTimelineViews) return "task_timeline_views";

    if (!table || typeof table !== "object") {
      return "";
    }

    const tableNameSymbol = Object.getOwnPropertySymbols(table).find((symbol) =>
      String(symbol).includes("drizzle:Name"),
    );
    const tableName = tableNameSymbol ? Reflect.get(table as object, tableNameSymbol) : undefined;

    return typeof tableName === "string" ? tableName : "";
  }

  mock.module("../../control-plane/service/src/db", () => ({
    db: {
      query: {
        taskExecutionPhases: {
          findMany: mock(async () => args?.phaseRows ?? []),
        },
        taskSessions: {
          findFirst: mock(async () => args?.winnerSession ?? null),
        },
        taskSnapshots: {
          findFirst: mock(async () => args?.snapshot ?? null),
        },
      },
      select: mock(() =>
        createSelectChain((table: unknown) => {
          const tableName = resolveTableName(table);

          if (tableName === "task_sessions") {
            return args?.sessionRows ?? [];
          }
          if (tableName === "task_session_runs") {
            return args?.sessionRunRows ?? [];
          }
          if (tableName === "task_workflow_runs") {
            if (args?.workflowRunRowsByCall) {
              const rows =
                args.workflowRunRowsByCall[taskWorkflowRunsSelectCount] ??
                args.workflowRunRowsByCall.at(-1) ??
                [];
              taskWorkflowRunsSelectCount += 1;
              return rows;
            }
            return args?.workflowRunRows ?? [];
          }
          if (tableName === "task_stage_runs") {
            return args?.taskStageRunRows ?? [];
          }
          if (tableName === "task_operations") {
            return args?.sessionOperationRows ?? [];
          }
          if (tableName === "task_messages") {
            if (args?.messageRowsByCall) {
              const rows =
                args.messageRowsByCall[taskMessagesSelectCount] ??
                args.messageRowsByCall.at(-1) ??
                [];
              taskMessagesSelectCount += 1;
              return rows;
            }
            return args?.messageRows ?? [];
          }
          if (tableName === "task_message_parts") {
            if (args?.partRowsByCall) {
              const rows =
                args.partRowsByCall[taskMessagePartsSelectCount] ??
                args.partRowsByCall.at(-1) ??
                [];
              taskMessagePartsSelectCount += 1;
              return rows;
            }
            return args?.partRows ?? [];
          }
          if (tableName === "task_timeline_views") {
            return args?.timelineRows ?? [];
          }
          if (tableName === "task_domain_events") {
            return args?.taskDomainEventRows ?? [];
          }
          return [];
        }),
      ),
      update: mock((table: unknown) => {
        if (table === fakeTaskSessions) {
          return createUpdateChain((payload) => {
            updatedTaskSessions.push(payload);
          });
        }

        if (table === fakeTaskSnapshots) {
          return createUpdateChain((payload) => {
            updatedTaskSnapshots.push(payload);
          });
        }

        return createUpdateChain(() => undefined);
      }),
    },
  }));

  mock.module("../../control-plane/service/src/db/schema", () => ({
    roleAggregateConclusions: {},
    taskArtifacts: {},
    taskDomainEvents: fakeTaskDomainEvents,
    taskExecutionPhases: fakeTaskExecutionPhases,
    taskMessageParts: fakeTaskMessageParts,
    taskMessages: fakeTaskMessages,
    taskOperations: fakeTaskOperations,
    taskStageRuns: fakeTaskStageRuns,
    taskSessionRuns: fakeTaskSessionRuns,
    taskSessions: fakeTaskSessions,
    taskSnapshots: fakeTaskSnapshots,
    taskTimelineViews: fakeTaskTimelineViews,
    taskUsageLedgerEntries: {},
    taskWorkflowRuns: fakeTaskWorkflowRuns,
  }));

  mock.module(
    "../../control-plane/service/src/modules/task-workflows/legacy-role-workflow-storage",
    () => ({
      ensureTaskWorkflowFactsAvailable,
    }),
  );

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-session-read.ts?task-session-read-test=${importCounter}`
  );

  return {
    ...module,
    ensureTaskWorkflowFactsAvailable,
    updatedTaskSessions,
    updatedTaskSnapshots,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task session read API", () => {
  test("prefers explicit snapshot currentPhaseId over deriving it from currentSessionId", async () => {
    const rootSessionId = "task-session:task-1:session-root";
    const candidateSessionId = "task-session:task-1:session-candidate";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-root",
          phaseId: "phase-root",
          coordinationKey: "phase-root",
          createdAt: "2026-04-16T10:00:00.000Z",
        },
        {
          id: candidateSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "session-candidate",
          phaseId: "phase-compare",
          coordinationKey: "phase-compare",
          sessionKind: "candidate",
          phaseRole: "candidate",
          phaseItemIndex: 0,
          candidateIndex: 0,
          executionModeSnapshot: "parallel",
          createdAt: "2026-04-16T10:01:00.000Z",
        },
      ],
      phaseRows: [
        {
          id: "phase-root",
          taskId: "task-1",
          phaseIndex: 1,
          createdAt: "2026-04-16T10:00:00.000Z",
        },
        {
          id: "phase-compare",
          taskId: "task-1",
          phaseIndex: 2,
          createdAt: "2026-04-16T10:01:00.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "session-root",
        currentPhaseId: "phase-compare",
        latestSessionId: "session-candidate",
        latestPhaseId: "phase-compare",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.listTaskSessions("task-1");

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.meta.currentSessionId).toBe(rootSessionId);
    expect(response.data.meta.currentPhaseId).toBe("phase-compare");
    expect(response.data.meta.latestPhaseId).toBe("phase-compare");
  });

  test("builds a phase-scoped view with ordered sessions and grouped messages", async () => {
    const candidateSessionA = "task-session:task-1:session-a";
    const candidateSessionB = "task-session:task-1:session-b";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: "task-session:task-1:session-root",
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-root",
          phaseId: "phase-root",
          coordinationKey: "phase-root",
          createdAt: "2026-04-16T10:00:00.000Z",
        },
        {
          id: candidateSessionA,
          taskId: "task-1",
          parentSessionId: "task-session:task-1:session-root",
          runtimeSessionId: "session-a",
          phaseId: "phase-compare",
          coordinationKey: "phase-compare",
          sessionKind: "candidate",
          phaseRole: "candidate",
          phaseItemIndex: 0,
          candidateIndex: 0,
          executionModeSnapshot: "parallel",
          executionStatus: "complete",
          title: "候选 A",
          selectedModel: "github-copilot:gpt-5-mini",
          createdAt: "2026-04-16T10:01:00.000Z",
          updatedAt: "2026-04-16T10:01:30.000Z",
        },
        {
          id: candidateSessionB,
          taskId: "task-1",
          parentSessionId: "task-session:task-1:session-root",
          runtimeSessionId: "session-b",
          phaseId: "phase-compare",
          coordinationKey: "phase-compare",
          sessionKind: "candidate",
          phaseRole: "candidate",
          phaseItemIndex: 1,
          candidateIndex: 1,
          executionModeSnapshot: "parallel",
          executionStatus: "complete",
          branchName: "候选 B",
          selectedModel: "openai:gpt-4o",
          createdAt: "2026-04-16T10:01:01.000Z",
          updatedAt: "2026-04-16T10:01:31.000Z",
        },
      ],
      phaseRows: [
        {
          id: "phase-root",
          taskId: "task-1",
          projectId: "project-1",
          phaseIndex: 1,
          phaseKind: "single",
          triggerType: "execute",
          status: "completed",
          createdAt: "2026-04-16T10:00:00.000Z",
          updatedAt: "2026-04-16T10:00:10.000Z",
        },
        {
          id: "phase-compare",
          taskId: "task-1",
          projectId: "project-1",
          parentPhaseId: "phase-root",
          phaseIndex: 2,
          phaseKind: "parallel",
          triggerType: "continue",
          status: "awaiting_adoption",
          candidateCount: 2,
          winnerSessionId: null,
          createdAt: "2026-04-16T10:01:00.000Z",
          updatedAt: "2026-04-16T10:01:40.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "session-root",
        currentPhaseId: "phase-compare",
        latestSessionId: "session-b",
        latestPhaseId: "phase-compare",
      },
      messageRowsByCall: [
        [
          {
            id: "msg-a-1",
            taskId: "task-1",
            sessionId: candidateSessionA,
            role: "assistant",
            status: "completed",
            seq: 1,
            textContent: "候选 A 回复",
            textPreview: "候选 A 回复",
            rawPayload: {},
            tokenUsed: 12,
            createdAt: "2026-04-16T10:01:10.000Z",
            updatedAt: "2026-04-16T10:01:10.000Z",
          },
        ],
        [
          {
            id: "msg-b-1",
            taskId: "task-1",
            sessionId: candidateSessionB,
            role: "assistant",
            status: "completed",
            seq: 1,
            textContent: "候选 B 回复",
            textPreview: "候选 B 回复",
            rawPayload: {},
            tokenUsed: 14,
            createdAt: "2026-04-16T10:01:11.000Z",
            updatedAt: "2026-04-16T10:01:11.000Z",
          },
        ],
      ],
      partRowsByCall: [[], []],
      timelineRows: [
        {
          id: "timeline-a-1",
          taskId: "task-1",
          projectId: "project-1",
          sessionId: candidateSessionA,
          messageId: "msg-a-1",
          operationId: null,
          artifactId: null,
          itemKind: "message",
          itemRole: "assistant",
          title: null,
          displayText: "候选 A 回复",
          metadataJson: null,
          sortAt: "2026-04-16T10:01:10.000Z",
          createdAt: "2026-04-16T10:01:10.000Z",
          updatedAt: "2026-04-16T10:01:10.000Z",
        },
      ],
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.getTaskPhaseView("task-1", "phase-compare");

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data.phase).toMatchObject({
      id: "phase-compare",
      phaseIndex: 2,
      phaseKind: "parallel",
      status: "awaiting_adoption",
      candidateCount: 2,
      sessionIds: [candidateSessionA, candidateSessionB],
    });
    expect(response.data.data.sessions.map((session) => session.id)).toEqual([
      candidateSessionA,
      candidateSessionB,
    ]);
    expect(response.data.data.messageGroups).toEqual([
      expect.objectContaining({
        taskSessionId: candidateSessionA,
        runtimeSessionId: "session-a",
        title: "候选 A",
        selectedModel: "github-copilot:gpt-5-mini",
        timelineMeta: {
          cacheState: "complete",
          complete: true,
          itemCount: 1,
        },
        messages: [expect.objectContaining({ id: "msg-a-1", textContent: "候选 A 回复" })],
      }),
      expect.objectContaining({
        taskSessionId: candidateSessionB,
        runtimeSessionId: "session-b",
        title: "候选 B",
        selectedModel: "openai:gpt-4o",
        timelineMeta: {
          cacheState: "none",
          complete: false,
          itemCount: 0,
        },
        messages: [expect.objectContaining({ id: "msg-b-1", textContent: "候选 B 回复" })],
      }),
    ]);
    expect(response.data.data.meta).toMatchObject({
      currentSessionId: "task-session:task-1:session-root",
      currentPhaseId: "phase-compare",
      latestSessionId: candidateSessionB,
      latestPhaseId: "phase-compare",
      messageGroupCount: 2,
      messageCount: 2,
    });
  });

  test("maps snapshot currentSessionId runtime ids back to canonical task-session ids", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          coordinationKey: sessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "session-1",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.listTaskSessions("task-1");

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.meta.currentSessionId).toBe(sessionId);
  });

  test("projects candidate sessions as parallel sourceType on public session reads", async () => {
    const rootSessionId = "task-session:task-1:root-session";
    const candidateSessionId = "task-session:task-1:candidate-session";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root-session",
          phaseId: rootSessionId,
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
        {
          id: candidateSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "candidate-session",
          phaseId: rootSessionId,
          coordinationKey: rootSessionId,
          sessionKind: "candidate",
          executionModeSnapshot: "parallel",
          candidateIndex: 0,
          createdAt: "2026-03-27T00:00:01.000Z",
        },
      ],
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.listTaskSessions("task-1");

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data).toContainEqual(
      expect.objectContaining({
        id: candidateSessionId,
        phaseId: rootSessionId,
        parentRuntimeSessionId: "root-session",
        sourceType: "parallel",
      }),
    );
  });

  test("normalizes stale executionStatus from legacy completed status on public session reads", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          status: "completed",
          executionStatus: "running",
          createdAt: "2026-03-27T00:00:00.000Z",
          updatedAt: "2026-03-27T00:00:05.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: sessionId,
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.listTaskSessions("task-1");

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data).toContainEqual(
      expect.objectContaining({
        id: sessionId,
        executionStatus: "complete",
      }),
    );
  });

  test("returns current/latest phase pointers alongside session meta", async () => {
    const rootSessionId = "task-session:task-1:root-session";
    const candidateSessionId = "task-session:task-1:candidate-session";
    const branchSessionId = "task-session:task-1:branch-session";
    const parallelPhaseId = "phase-parallel-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root-session",
          phaseId: parallelPhaseId,
          coordinationKey: parallelPhaseId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
        {
          id: candidateSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "candidate-session",
          phaseId: parallelPhaseId,
          coordinationKey: parallelPhaseId,
          sessionKind: "candidate",
          executionModeSnapshot: "parallel",
          candidateIndex: 0,
          createdAt: "2026-03-27T00:00:01.000Z",
        },
        {
          id: branchSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "branch-session",
          sessionKind: "manual_branch",
          createdAt: "2026-03-27T00:00:02.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: candidateSessionId,
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.listTaskSessions("task-1");

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.meta.currentSessionId).toBe(candidateSessionId);
    expect(response.data.meta.currentPhaseId).toBe(parallelPhaseId);
    expect(response.data.meta.latestSessionId).toBe(branchSessionId);
    expect(response.data.meta.latestPhaseId).toBe(branchSessionId);
    expect(response.data.meta.phaseCount).toBe(2);
  });

  test("orders task sessions by phase/lifecycle while keeping latestSessionId on lifecycle time", async () => {
    const rootSessionId = "task-session:task-1:root-session";
    const anchorSessionId = "task-session:task-1:anchor-session";
    const branchSessionId = "task-session:task-1:branch-session";
    const candidateSessionId = "task-session:task-1:candidate-session";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root-session",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
        {
          id: branchSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "branch-session",
          sessionKind: "manual_branch",
          createdAt: "2026-03-27T00:00:02.000Z",
        },
        {
          id: anchorSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "anchor-session",
          sessionKind: "resume",
          createdAt: "2026-03-27T00:00:01.000Z",
        },
        {
          id: candidateSessionId,
          taskId: "task-1",
          parentSessionId: anchorSessionId,
          runtimeSessionId: "candidate-session",
          sessionKind: "candidate",
          executionModeSnapshot: "parallel",
          candidateIndex: 0,
          createdAt: "2026-03-27T00:00:03.000Z",
        },
      ],
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.listTaskSessions("task-1");

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data.map((session) => session.id)).toEqual([
      rootSessionId,
      anchorSessionId,
      branchSessionId,
      candidateSessionId,
    ]);
    expect(response.data.meta.latestSessionId).toBe(candidateSessionId);
  });

  test("buildTaskTreeResponse defaults to the lifecycle-latest session when topology ends on another sibling", async () => {
    const rootSessionId = "task-session:task-1:root-session";
    const anchorSessionId = "task-session:task-1:anchor-session";
    const branchSessionId = "task-session:task-1:branch-session";
    const candidateSessionId = "task-session:task-1:candidate-session";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root-session",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
        {
          id: branchSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "branch-session",
          sessionKind: "manual_branch",
          createdAt: "2026-03-27T00:00:02.000Z",
        },
        {
          id: anchorSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "anchor-session",
          sessionKind: "resume",
          createdAt: "2026-03-27T00:00:01.000Z",
        },
        {
          id: candidateSessionId,
          taskId: "task-1",
          parentSessionId: anchorSessionId,
          runtimeSessionId: "candidate-session",
          sessionKind: "candidate",
          executionModeSnapshot: "parallel",
          candidateIndex: 0,
          createdAt: "2026-03-27T00:00:03.000Z",
        },
      ],
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "parallel task",
        prompt: "compare these candidate sessions",
        status: "running",
        latestResultSummary: null,
        strategy: null,
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: "2026-03-27T00:00:03.000Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.meta.currentSessionId).toBe(candidateSessionId);
    expect(response.data.task.currentSessionId).toBe(candidateSessionId);
    expect(response.data.sessions.map((session) => session.id)).toEqual([
      rootSessionId,
      anchorSessionId,
      candidateSessionId,
      branchSessionId,
    ]);
  });

  test("falls back to persisted session operation models when session selectedModel is empty", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          coordinationKey: sessionId,
          selectedModel: null,
          effectiveModel: null,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      sessionOperationRows: [
        {
          sessionId,
          taskId: "task-1",
          modelRoute: "github-copilot:gpt-5.4",
          createdAt: "2026-03-27T00:00:01.000Z",
        },
      ],
      sessionRunRows: [
        {
          sessionId,
          taskId: "task-1",
          modelRoute: "github-copilot:gpt-5.4",
          createdAt: "2026-03-27T00:00:01.000Z",
        },
      ],
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.listTaskSessions("task-1");

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data[0]).toMatchObject({
      id: sessionId,
      selectedModel: "github-copilot:gpt-5.4",
    });
  });

  test("buildTaskConversationMessagesResponse resolves the current task session and returns lineage-backed messages", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          coordinationKey: sessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: "db-message-1",
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-1",
          role: "user",
          status: "completed",
          clientMessageId: "cli-1",
          providerMessageId: null,
          seq: 0,
          textContent: "task-level prompt",
          textPreview: "task-level prompt",
          rawPayload: {
            info: {
              id: "runtime-message-1",
              role: "user",
            },
          },
          tokenUsed: 0,
          startedAt: "2026-03-27T00:00:00.000Z",
          errorText: null,
          createdAt: "2026-03-27T00:00:00.000Z",
          updatedAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      partRows: [
        {
          id: "db-part-1",
          messageId: "db-message-1",
          partIndex: 0,
          partType: "text",
          textContent: "task-level prompt",
          jsonPayload: { type: "text", text: "task-level prompt" },
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "session-1",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.buildTaskConversationMessagesResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data).toEqual({
      data: [
        expect.objectContaining({
          id: "db-message-1",
          runtimeMessageId: "runtime-message-1",
          clientMessageId: "cli-1",
          textContent: "task-level prompt",
          parts: [
            expect.objectContaining({
              messageId: "db-message-1",
              textContent: "task-level prompt",
            }),
          ],
        }),
      ],
      meta: expect.objectContaining({
        readSource: "task-session-first",
        sessionId,
        includeLineage: true,
        lineagePath: [sessionId],
        cacheState: "complete",
        complete: true,
        messageCount: 1,
        persistedThroughRevision: 0,
      }),
    });
  });

  test("buildTaskConversationMessagesResponse normalizes PG-style message and part timestamps", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          coordinationKey: sessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: "db-message-pg-1",
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-pg-1",
          role: "assistant",
          status: "completed",
          clientMessageId: "cli-pg-1",
          providerMessageId: "provider-pg-1",
          seq: 0,
          textContent: "pg timestamp body",
          textPreview: "pg timestamp body",
          rawPayload: { info: { role: "assistant" } },
          tokenUsed: 0,
          startedAt: "2026-03-27 00:00:00+00",
          completedAt: "2026-03-27 00:00:02+00",
          errorText: null,
          createdAt: "2026-03-27 00:00:01+00",
          updatedAt: "2026-03-27 00:00:03+00",
        },
      ],
      partRows: [
        {
          id: "db-part-pg-1",
          messageId: "db-message-pg-1",
          partIndex: 0,
          partType: "text",
          textContent: "pg timestamp body",
          jsonPayload: { type: "text", text: "pg timestamp body" },
          createdAt: "2026-03-27 00:00:01+00",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "session-1",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.buildTaskConversationMessagesResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data).toEqual([
      expect.objectContaining({
        id: "db-message-pg-1",
        startedAt: "2026-03-27T00:00:00.000Z",
        completedAt: "2026-03-27T00:00:02.000Z",
        createdAt: "2026-03-27T00:00:01.000Z",
        updatedAt: "2026-03-27T00:00:03.000Z",
        parts: [
          expect.objectContaining({
            id: "db-part-pg-1",
            createdAt: "2026-03-27T00:00:01.000Z",
          }),
        ],
      }),
    ]);
  });

  test("buildTaskConversationMessagesResponse returns an empty message set when canonical task messages are absent", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          coordinationKey: sessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "session-1",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.buildTaskConversationMessagesResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data).toEqual([]);
    expect(response.data.meta).toMatchObject({
      sessionId,
      cacheState: "complete",
      complete: true,
      messageCount: 0,
    });
  });

  test("buildTaskConversationMessagesResponse hydrates canonical shell messages with task prompt and latest result", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          coordinationKey: sessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: `${sessionId}:msg-user-1`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-user-1",
          role: "user",
          seq: 0,
          textContent: null,
          rawPayload: {
            info: {
              id: "runtime-message-user-1",
              role: "user",
            },
          },
          createdAt: "2026-03-27T00:00:00.000Z",
        },
        {
          id: `${sessionId}:msg-assistant-1`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-assistant-1",
          role: "assistant",
          seq: 1,
          textContent: null,
          rawPayload: {
            info: {
              id: "runtime-message-assistant-1",
              role: "assistant",
            },
          },
          createdAt: "2026-03-27T00:00:03.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "session-1",
        latestResult: "hydrated assistant response",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        prompt: "hydrated task prompt",
      })),
    });

    const response = await api.buildTaskConversationMessagesResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data).toEqual([
      expect.objectContaining({
        id: `${sessionId}:msg-user-1`,
        textContent: "hydrated task prompt",
        parts: [
          expect.objectContaining({
            messageId: `${sessionId}:msg-user-1`,
            textContent: "hydrated task prompt",
          }),
        ],
      }),
      expect.objectContaining({
        id: `${sessionId}:msg-assistant-1`,
        textContent: "hydrated assistant response",
        parts: [
          expect.objectContaining({
            messageId: `${sessionId}:msg-assistant-1`,
            textContent: "hydrated assistant response",
          }),
        ],
      }),
    ]);
  });

  test("buildTaskConversationMessagesResponse does not hydrate assistant tool-call shells with the latest result", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          coordinationKey: sessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: `${sessionId}:msg-user-1`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-user-1",
          role: "user",
          messageIndex: 0,
          textContent: "original prompt",
          rawPayload: {
            info: {
              id: "runtime-message-user-1",
              role: "user",
              time: { created: "2026-03-27T00:00:00.000Z" },
            },
            parts: [{ type: "text", text: "original prompt" }],
          },
          createdAt: "2026-03-27T00:00:00.000Z",
        },
        {
          id: `${sessionId}:msg-assistant-tool-call`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-assistant-tool-call",
          role: "assistant",
          messageIndex: 1,
          textContent: null,
          rawPayload: {
            info: {
              id: "runtime-message-assistant-tool-call",
              role: "assistant",
              finish: "tool-calls",
              time: {
                created: "2026-03-27T00:00:02.000Z",
                completed: "2026-03-27T00:00:03.000Z",
              },
            },
            parts: [
              { type: "step-start" },
              { type: "tool", tool: "webfetch" },
              { type: "step-finish", reason: "tool-calls" },
            ],
          },
          createdAt: "2026-03-27T00:00:02.000Z",
          completedAt: "2026-03-27T00:00:03.000Z",
        },
        {
          id: `${sessionId}:msg-assistant-final`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-assistant-final",
          role: "assistant",
          messageIndex: 2,
          textContent: "final answer",
          rawPayload: {
            info: {
              id: "runtime-message-assistant-final",
              role: "assistant",
              finish: "stop",
              time: {
                created: "2026-03-27T00:00:04.000Z",
                completed: "2026-03-27T00:00:05.000Z",
              },
            },
            parts: [{ type: "text", text: "final answer" }],
          },
          createdAt: "2026-03-27T00:00:04.000Z",
          completedAt: "2026-03-27T00:00:05.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "session-1",
        latestResult: "final answer",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        prompt: "original prompt",
      })),
    });

    const response = await api.buildTaskConversationMessagesResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data).toEqual([
      expect.objectContaining({
        runtimeMessageId: "runtime-message-user-1",
        textContent: "original prompt",
      }),
      expect.objectContaining({
        runtimeMessageId: "runtime-message-assistant-tool-call",
        textContent: null,
        parts: [],
      }),
      expect.objectContaining({
        runtimeMessageId: "runtime-message-assistant-final",
        textContent: "final answer",
      }),
    ]);
  });

  test("listTaskSessionMessages keeps user prompts ahead of same-timestamp assistant replies", async () => {
    const sessionId = "task-session:task-1:session-1";
    const sessionRecord = {
      id: sessionId,
      taskId: "task-1",
      parentSessionId: null,
      runtimeSessionId: "session-1",
      coordinationKey: sessionId,
      createdAt: "2026-03-27T00:00:00.000Z",
    };
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [sessionRecord],
      winnerSession: sessionRecord,
      messageRows: [
        {
          id: `${sessionId}:assistant`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-assistant-1",
          role: "assistant",
          messageIndex: 0,
          textContent: "assistant reply",
          rawPayload: {
            info: {
              id: "runtime-assistant-1",
              role: "assistant",
              time: { created: "2026-03-27T10:00:00.000Z" },
            },
          },
          createdAt: "2026-03-27T10:00:00.000Z",
        },
        {
          id: `${sessionId}:user`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-user-1",
          role: "user",
          messageIndex: 1,
          textContent: "user prompt",
          rawPayload: {
            info: {
              id: "runtime-user-1",
              role: "user",
              time: { created: "2026-03-27T10:00:00.000Z" },
            },
          },
          createdAt: "2026-03-27T10:00:00.000Z",
        },
      ],
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.listTaskSessionMessages("task-1", sessionId);

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(
      response.data.data.map((message) => ({
        runtimeMessageId: message.runtimeMessageId,
        role: message.role,
      })),
    ).toEqual([
      {
        runtimeMessageId: "runtime-user-1",
        role: "user",
      },
      {
        runtimeMessageId: "runtime-assistant-1",
        role: "assistant",
      },
    ]);
  });

  test("buildTaskConversationMessagesResponse aggregates task-wide conversation across child sessions when no session is requested", async () => {
    const rootSessionId = "task-session:task-1:root";
    const childSessionId = "task-session:task-1:child";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: childSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "child",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-29T09:17:52.100Z",
        },
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-29T09:17:52.200Z",
        },
      ],
      messageRowsByCall: [
        [
          {
            id: `${childSessionId}:msg-user-1`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-child-user-1",
            role: "user",
            seq: 3,
            textContent: "child follow-up",
            rawPayload: {
              info: {
                id: "runtime-child-user-1",
                role: "user",
                time: {
                  created: "2026-03-27T10:00:00.000Z",
                },
              },
            },
            createdAt: "2026-03-27T10:00:00.000Z",
          },
          {
            id: `${childSessionId}:msg-assistant-1`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-child-assistant-1",
            role: "assistant",
            seq: 4,
            textContent: "child answer",
            rawPayload: {
              info: {
                id: "runtime-child-assistant-1",
                role: "assistant",
                time: {
                  created: "2026-03-27T10:00:02.000Z",
                  completed: "2026-03-27T10:00:05.000Z",
                },
              },
            },
            createdAt: "2026-03-27T10:00:02.000Z",
            completedAt: "2026-03-27T10:00:05.000Z",
          },
        ],
        [
          {
            id: `${rootSessionId}:msg-user-1`,
            taskId: "task-1",
            sessionId: rootSessionId,
            runtimeMessageId: "runtime-root-user-1",
            role: "user",
            seq: 0,
            textContent: "root prompt",
            rawPayload: {
              info: {
                id: "runtime-root-user-1",
                role: "user",
                time: {
                  created: "2026-03-26T23:03:46.428Z",
                },
              },
            },
            createdAt: "2026-03-26T23:03:46.428Z",
          },
          {
            id: `${rootSessionId}:msg-assistant-1`,
            taskId: "task-1",
            sessionId: rootSessionId,
            runtimeMessageId: "runtime-root-assistant-1",
            role: "assistant",
            seq: 1,
            textContent: "root reply",
            rawPayload: {
              info: {
                id: "runtime-root-assistant-1",
                role: "assistant",
                time: {
                  created: "2026-03-26T23:03:46.453Z",
                  completed: "2026-03-26T23:04:45.911Z",
                },
              },
            },
            createdAt: "2026-03-26T23:03:46.453Z",
            completedAt: "2026-03-26T23:04:45.911Z",
          },
        ],
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "root",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.buildTaskConversationMessagesResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data).toEqual([
      expect.objectContaining({
        id: `${rootSessionId}:msg-user-1`,
        textContent: "root prompt",
      }),
      expect.objectContaining({
        id: `${rootSessionId}:msg-assistant-1`,
        textContent: "root reply",
      }),
      expect.objectContaining({
        id: `${childSessionId}:msg-user-1`,
        textContent: "child follow-up",
      }),
      expect.objectContaining({
        id: `${childSessionId}:msg-assistant-1`,
        textContent: "child answer",
      }),
    ]);
    expect(response.data.meta).toMatchObject({
      sessionId: rootSessionId,
      includeLineage: true,
      lineagePath: [rootSessionId, childSessionId],
      cachedSessionCount: 2,
      messageCount: 4,
    });
  });

  test("buildTaskConversationMessagesResponse keeps each session prompt before same-timestamp replies", async () => {
    const rootSessionId = "task-session:task-1:root";
    const childSessionId = "task-session:task-1:child";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
        {
          id: childSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "child",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:05:00.000Z",
        },
      ],
      messageRowsByCall: [
        [
          {
            id: `${rootSessionId}:user`,
            taskId: "task-1",
            sessionId: rootSessionId,
            runtimeMessageId: "runtime-root-user-1",
            role: "user",
            messageIndex: 0,
            textContent: "root prompt",
            rawPayload: {
              info: {
                id: "runtime-root-user-1",
                role: "user",
                time: { created: "2026-03-27T10:00:00.000Z" },
              },
            },
            createdAt: "2026-03-27T10:00:00.000Z",
          },
          {
            id: `${rootSessionId}:assistant`,
            taskId: "task-1",
            sessionId: rootSessionId,
            runtimeMessageId: "runtime-root-assistant-1",
            role: "assistant",
            messageIndex: 1,
            textContent: "root reply",
            rawPayload: {
              info: {
                id: "runtime-root-assistant-1",
                role: "assistant",
                time: { created: "2026-03-27T10:00:01.000Z" },
              },
            },
            createdAt: "2026-03-27T10:00:01.000Z",
          },
        ],
        [
          {
            id: `${childSessionId}:root-user`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-root-user-1",
            role: "user",
            messageIndex: 0,
            textContent: "root prompt",
            rawPayload: {
              info: {
                id: "runtime-root-user-1",
                role: "user",
                time: { created: "2026-03-27T10:00:00.000Z" },
              },
            },
            createdAt: "2026-03-27T10:00:00.000Z",
          },
          {
            id: `${childSessionId}:root-assistant`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-root-assistant-1",
            role: "assistant",
            messageIndex: 1,
            textContent: "root reply",
            rawPayload: {
              info: {
                id: "runtime-root-assistant-1",
                role: "assistant",
                time: { created: "2026-03-27T10:00:01.000Z" },
              },
            },
            createdAt: "2026-03-27T10:00:01.000Z",
          },
          {
            id: `${childSessionId}:assistant`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-child-assistant-1",
            role: "assistant",
            messageIndex: 2,
            textContent: "child reply",
            rawPayload: {
              info: {
                id: "runtime-child-assistant-1",
                role: "assistant",
                time: { created: "2026-03-27T10:05:00.000Z" },
              },
            },
            createdAt: "2026-03-27T10:05:00.000Z",
          },
          {
            id: `${childSessionId}:user`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-child-user-1",
            role: "user",
            messageIndex: 3,
            textContent: "child prompt",
            rawPayload: {
              info: {
                id: "runtime-child-user-1",
                role: "user",
                time: { created: "2026-03-27T10:05:00.000Z" },
              },
            },
            createdAt: "2026-03-27T10:05:00.000Z",
          },
        ],
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "child",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.buildTaskConversationMessagesResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(
      response.data.data.map((message) => ({
        runtimeMessageId: message.runtimeMessageId,
        role: message.role,
      })),
    ).toEqual([
      {
        runtimeMessageId: "runtime-root-user-1",
        role: "user",
      },
      {
        runtimeMessageId: "runtime-root-assistant-1",
        role: "assistant",
      },
      {
        runtimeMessageId: "runtime-child-user-1",
        role: "user",
      },
      {
        runtimeMessageId: "runtime-child-assistant-1",
        role: "assistant",
      },
    ]);
  });

  test("buildTaskConversationMessagesResponse hydrates task-wide shell history from per-session message sets before dedupe", async () => {
    const rootSessionId = "task-session:task-1:root";
    const childSessionId = "task-session:task-1:child";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-26T23:03:40.000Z",
        },
        {
          id: childSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "child",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T10:00:00.000Z",
        },
      ],
      messageRowsByCall: [
        [
          {
            id: `${rootSessionId}:msg-user-1`,
            taskId: "task-1",
            sessionId: rootSessionId,
            runtimeMessageId: "runtime-root-user-1",
            role: "user",
            messageIndex: 0,
            textContent: "root prompt",
            rawPayload: {
              info: {
                id: "runtime-root-user-1",
                role: "user",
                time: { created: "2026-03-26T23:03:46.428Z" },
              },
            },
            createdAt: "2026-03-26T23:03:46.428Z",
          },
          {
            id: `${rootSessionId}:msg-assistant-1`,
            taskId: "task-1",
            sessionId: rootSessionId,
            runtimeMessageId: "runtime-root-assistant-1",
            role: "assistant",
            messageIndex: 1,
            textContent: null,
            rawPayload: {
              info: {
                id: "runtime-root-assistant-1",
                role: "assistant",
                time: {
                  created: "2026-03-26T23:03:46.453Z",
                  completed: "2026-03-26T23:04:45.911Z",
                },
              },
            },
            createdAt: "2026-03-26T23:03:46.453Z",
            completedAt: "2026-03-26T23:04:45.911Z",
          },
        ],
        [
          {
            id: `${childSessionId}:msg-root-user-1`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-root-user-1",
            role: "user",
            messageIndex: 0,
            textContent: "root prompt",
            rawPayload: {
              info: {
                id: "runtime-root-user-1",
                role: "user",
                time: { created: "2026-03-26T23:03:46.428Z" },
              },
            },
            createdAt: "2026-03-26T23:03:46.428Z",
          },
          {
            id: `${childSessionId}:msg-root-assistant-1`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-root-assistant-1",
            role: "assistant",
            messageIndex: 1,
            textContent: null,
            rawPayload: {
              info: {
                id: "runtime-root-assistant-1",
                role: "assistant",
                time: {
                  created: "2026-03-26T23:03:46.453Z",
                  completed: "2026-03-26T23:04:45.911Z",
                },
              },
            },
            createdAt: "2026-03-26T23:03:46.453Z",
            completedAt: "2026-03-26T23:04:45.911Z",
          },
          {
            id: `${childSessionId}:msg-user-1`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-child-user-1",
            role: "user",
            messageIndex: 2,
            textContent: null,
            rawPayload: {
              info: {
                id: "runtime-child-user-1",
                role: "user",
                time: { created: "2026-03-27T10:00:00.000Z" },
              },
            },
            createdAt: "2026-03-27T10:00:00.000Z",
          },
          {
            id: `${childSessionId}:msg-assistant-1`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-child-assistant-1",
            role: "assistant",
            messageIndex: 3,
            textContent: "current final answer",
            rawPayload: {
              info: {
                id: "runtime-child-assistant-1",
                role: "assistant",
                time: {
                  created: "2026-03-27T10:00:02.000Z",
                  completed: "2026-03-27T10:00:05.000Z",
                },
              },
            },
            createdAt: "2026-03-27T10:00:02.000Z",
            completedAt: "2026-03-27T10:00:05.000Z",
          },
        ],
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "child",
        latestResult: "current final answer",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        prompt: "root prompt",
      })),
    });

    const response = await api.buildTaskConversationMessagesResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data).toEqual([
      expect.objectContaining({
        runtimeMessageId: "runtime-root-user-1",
        textContent: "root prompt",
      }),
      expect.objectContaining({
        runtimeMessageId: "runtime-root-assistant-1",
        textContent: "current final answer",
      }),
      expect.objectContaining({
        runtimeMessageId: "runtime-child-user-1",
        textContent: null,
      }),
      expect.objectContaining({
        runtimeMessageId: "runtime-child-assistant-1",
        textContent: "current final answer",
      }),
    ]);
  });

  test("buildTaskConversationMessagesResponse does not hydrate child user shells with the root task prompt", async () => {
    const rootSessionId = "task-session:task-1:root";
    const childSessionId = "task-session:task-1:child";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-26T23:03:40.000Z",
        },
        {
          id: childSessionId,
          taskId: "task-1",
          parentSessionId: rootSessionId,
          runtimeSessionId: "child",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T10:00:00.000Z",
        },
      ],
      messageRowsByCall: [
        [
          {
            id: `${rootSessionId}:msg-user-1`,
            taskId: "task-1",
            sessionId: rootSessionId,
            runtimeMessageId: "runtime-root-user-1",
            role: "user",
            messageIndex: 0,
            textContent: null,
            rawPayload: {
              info: {
                id: "runtime-root-user-1",
                role: "user",
                time: { created: "2026-03-26T23:03:46.428Z" },
              },
            },
            createdAt: "2026-03-26T23:03:46.428Z",
          },
        ],
        [
          {
            id: `${childSessionId}:msg-user-1`,
            taskId: "task-1",
            sessionId: childSessionId,
            runtimeMessageId: "runtime-child-user-1",
            role: "user",
            messageIndex: 0,
            textContent: null,
            rawPayload: {
              info: {
                id: "runtime-child-user-1",
                role: "user",
                time: { created: "2026-03-27T10:00:00.000Z" },
              },
            },
            createdAt: "2026-03-27T10:00:00.000Z",
          },
        ],
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: "child",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        prompt: "root prompt",
      })),
    });

    const response = await api.buildTaskConversationMessagesResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data).toEqual([
      expect.objectContaining({
        runtimeMessageId: "runtime-root-user-1",
        textContent: "root prompt",
      }),
      expect.objectContaining({
        runtimeMessageId: "runtime-child-user-1",
        textContent: null,
        parts: [],
      }),
    ]);
  });

  test("buildTaskExecutionTraceResponse reads canonical timeline session ids while sourcing canonical messages", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          coordinationKey: sessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: `${sessionId}:msg-1`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-1",
          role: "assistant",
          seq: 0,
          textContent: "legacy response",
          rawPayload: {
            info: {
              id: "runtime-message-1",
              role: "assistant",
            },
          },
          createdAt: "2026-03-27T00:00:01.000Z",
        },
      ],
      timelineRows: [
        {
          id: "timeline-1",
          taskId: "task-1",
          projectId: "project-1",
          sessionId,
          messageId: `${sessionId}:msg-1`,
          operationId: null,
          artifactId: null,
          itemKind: "assistant-output",
          itemRole: "assistant",
          title: null,
          displayText: "legacy response",
          metadataJson: null,
          sortAt: "2026-03-27T00:00:01.000Z",
          createdAt: "2026-03-27T00:00:01.000Z",
          updatedAt: "2026-03-27T00:00:01.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: sessionId,
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.buildTaskExecutionTraceResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.meta).toMatchObject({
      timelineReadSource: "task-session-projection",
      timelineItemCount: 1,
    });
    expect(response.data.data.selectedSessionId).toBe(sessionId);
    expect(response.data.data.timeline).toEqual([
      expect.objectContaining({
        id: "timeline-1",
        sessionId,
        displayText: "legacy response",
      }),
    ]);
    expect(response.data.data.messages).toEqual([
      expect.objectContaining({
        id: `${sessionId}:msg-1`,
        runtimeMessageId: "runtime-message-1",
        textContent: "legacy response",
      }),
    ]);
  });

  test("buildTaskTreeResponse hydrates root prompt messages from task prompt when no user message exists", async () => {
    const rootSessionId = "task-session:task-1:root";
    const { createTaskSessionReadApi, ensureTaskWorkflowFactsAvailable } =
      await loadTaskSessionReadModule({
        sessionRows: [
          {
            id: rootSessionId,
            taskId: "task-1",
            parentSessionId: null,
            runtimeSessionId: "root",
            coordinationKey: rootSessionId,
            createdAt: "2026-03-27T00:00:00.000Z",
            workflowStageKey: "design_review",
          },
        ],
        messageRows: [
          {
            id: `${rootSessionId}:msg-1`,
            taskId: "task-1",
            sessionId: rootSessionId,
            runtimeMessageId: "runtime-assistant-1",
            role: "assistant",
            messageIndex: 0,
            textContent: "assistant reply",
            summaryText: "assistant reply",
            rawPayload: {
              info: {
                id: "runtime-assistant-1",
                role: "assistant",
              },
            },
            createdAt: "2026-03-27T00:00:01.000Z",
            updatedAt: "2026-03-27T00:00:01.000Z",
          },
        ],
        snapshot: {
          taskId: "task-1",
          currentSessionId: rootSessionId,
        },
        workflowRunRows: [
          {
            id: "workflow-run-1",
            taskId: "task-1",
            templateId: "template-1",
            currentStage: "design_review",
            status: "running",
            createdAt: "2026-03-27T00:00:00.000Z",
          },
        ],
        taskStageRunRows: [
          {
            id: "stage-run-1",
            workflowRunId: "workflow-run-1",
            stageKey: "design_review",
            approvalState: "pending",
            createdAt: "2026-03-27T00:00:00.000Z",
          },
        ],
      });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "Task 1",
        prompt: "root prompt",
        status: "running",
        latestResultSummary: "assistant reply",
        strategy: {
          selectedTemplateId: "template-1",
          currentStage: "design_review",
        },
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: "2026-03-27T00:00:01.000Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.messages[0]).toEqual(
      expect.objectContaining({
        role: "user",
        textContent: "root prompt",
      }),
    );
    expect(response.data.workflow).toMatchObject({
      templateId: "template-1",
      currentStageKey: "design_review",
      currentStageLabel: "Design Review",
      status: "running",
      approvalState: "pending",
      roleConclusions: [],
      workflowRun: expect.objectContaining({
        id: "workflow-run-1",
        currentStage: "design_review",
      }),
      stages: [
        expect.objectContaining({
          id: "stage-run-1",
          stageKey: "design_review",
          approvalState: "pending",
        }),
      ],
    });
    expect(ensureTaskWorkflowFactsAvailable).toHaveBeenCalledTimes(0);
    expect(response.data.edges.sessionMessage).toEqual(
      expect.arrayContaining([expect.objectContaining({ sessionId: rootSessionId })]),
    );
  });

  test("buildTaskTreeResponse falls back to legacy workflow migration only when canonical workflow rows are absent", async () => {
    const rootSessionId = "task-session:task-1:root";
    const { createTaskSessionReadApi, ensureTaskWorkflowFactsAvailable } =
      await loadTaskSessionReadModule({
        sessionRows: [
          {
            id: rootSessionId,
            taskId: "task-1",
            parentSessionId: null,
            runtimeSessionId: "root",
            coordinationKey: rootSessionId,
            createdAt: "2026-03-27T00:00:00.000Z",
          },
        ],
        snapshot: {
          taskId: "task-1",
          currentSessionId: rootSessionId,
        },
        workflowRunRowsByCall: [
          [],
          [
            {
              id: "workflow-run-1",
              taskId: "task-1",
              templateId: "template-1",
              currentStage: "design",
              status: "running",
              createdAt: "2026-03-27T00:00:00.000Z",
            },
          ],
        ],
        taskStageRunRows: [
          {
            id: "stage-run-1",
            workflowRunId: "workflow-run-1",
            stageKey: "design",
            approvalState: "pending",
            createdAt: "2026-03-27T00:00:00.000Z",
          },
        ],
      });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "Task 1",
        prompt: "root prompt",
        status: "running",
        latestResultSummary: null,
        strategy: {
          selectedTemplateId: "template-1",
          currentStage: "design",
        },
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: "2026-03-27T00:00:01.000Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(ensureTaskWorkflowFactsAvailable).toHaveBeenCalledTimes(1);
    expect(ensureTaskWorkflowFactsAvailable).toHaveBeenCalledWith("task-1");
    expect(response.data.workflow).toEqual(
      expect.objectContaining({
        templateId: "template-1",
        currentStageKey: "design",
        status: "running",
        stages: [
          expect.objectContaining({
            id: "stage-run-1",
            stageKey: "design",
          }),
        ],
      }),
    );
  });

  test("buildTaskTreeResponse falls back approvalState=pending for waiting-approval workflows without stage runs", async () => {
    const rootSessionId = "task-session:task-1:root";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: rootSessionId,
      },
      workflowRunRows: [
        {
          id: "workflow-run-1",
          taskId: "task-1",
          templateId: "template-1",
          currentStage: "design",
          status: "waiting-approval",
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      taskStageRunRows: [],
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "Task 1",
        prompt: "root prompt",
        status: "waiting-approval",
        latestResultSummary: null,
        strategy: {
          selectedTemplateId: "template-1",
          currentStage: "design",
        },
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: "2026-03-27T00:00:01.000Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.workflow).toEqual(
      expect.objectContaining({
        currentStageKey: "design",
        status: "waiting-approval",
        approvalState: "pending",
        stages: [],
      }),
    );
  });

  test("buildTaskTreeResponse prepends root prompt when root user message is only execution context", async () => {
    const rootSessionId = "task-session:task-1:root";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: `${rootSessionId}:msg-user-1`,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "runtime-user-1",
          role: "user",
          messageIndex: 0,
          textContent:
            "Execution context:\n- task: task-1\n\n请只完成当前阶段的目标。\n\n/start-work 请先梳理需求和边界条件，再实现功能代码。",
          summaryText:
            "Execution context:\n- task: task-1\n\n请只完成当前阶段的目标。\n\n/start-work 请先梳理需求和边界条件，再实现功能代码。",
          rawPayload: {
            info: {
              id: "runtime-user-1",
              role: "user",
            },
          },
          createdAt: "2026-03-27T00:00:00.500Z",
          updatedAt: "2026-03-27T00:00:00.500Z",
        },
        {
          id: `${rootSessionId}:msg-assistant-1`,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "runtime-assistant-1",
          role: "assistant",
          messageIndex: 1,
          textContent: "assistant reply",
          summaryText: "assistant reply",
          rawPayload: {
            info: {
              id: "runtime-assistant-1",
              role: "assistant",
            },
          },
          createdAt: "2026-03-27T00:00:01.000Z",
          updatedAt: "2026-03-27T00:00:01.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: rootSessionId,
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "Task 1",
        prompt: "root prompt",
        status: "running",
        latestResultSummary: "assistant reply",
        strategy: null,
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: "2026-03-27T00:00:01.000Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.messages[0]).toEqual(
      expect.objectContaining({
        role: "user",
        textContent: "root prompt",
      }),
    );
    expect(response.data.messages[1]).toEqual(
      expect.objectContaining({
        role: "user",
        textContent: expect.stringContaining("Execution context:"),
      }),
    );
  });

  test("buildTaskTreeResponse prepends root prompt even when execution context embeds the original prompt", async () => {
    const rootSessionId = "task-session:task-1:root";
    const embeddedPrompt =
      "/start-work 请先梳理需求和边界条件，再实现功能代码。\n同时补充必要测试，并说明使用方式和影响范围。";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: `${rootSessionId}:msg-user-1`,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "runtime-user-1",
          role: "user",
          messageIndex: 0,
          textContent: `Execution context:\n- task: task-1\n\n请只完成当前阶段的目标。\n\n${embeddedPrompt}`,
          summaryText: `Execution context:\n- task: task-1\n\n请只完成当前阶段的目标。\n\n${embeddedPrompt}`,
          rawPayload: {
            info: {
              id: "runtime-user-1",
              role: "user",
            },
          },
          createdAt: "2026-03-27T00:00:00.500Z",
          updatedAt: "2026-03-27T00:00:00.500Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: rootSessionId,
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "Task 1",
        prompt: embeddedPrompt,
        status: "running",
        latestResultSummary: null,
        strategy: null,
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: "2026-03-27T00:00:01.000Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.messages[0]).toEqual(
      expect.objectContaining({
        role: "user",
        textContent: embeddedPrompt,
      }),
    );
    expect(response.data.messages[1]).toEqual(
      expect.objectContaining({
        role: "user",
        textContent: expect.stringContaining("Execution context:"),
      }),
    );
  });

  test("buildTaskTreeResponse does not prepend root prompt when root user message matches after whitespace normalization", async () => {
    const rootSessionId = "task-session:task-1:root";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: `${rootSessionId}:msg-user-1`,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "runtime-user-1",
          role: "user",
          messageIndex: 0,
          textContent: "  root\n\n prompt  ",
          summaryText: "  root\n\n prompt  ",
          rawPayload: {
            info: {
              id: "runtime-user-1",
              role: "user",
            },
          },
          createdAt: "2026-03-27T00:00:00.500Z",
          updatedAt: "2026-03-27T00:00:00.500Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: rootSessionId,
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "Task 1",
        prompt: "root prompt",
        status: "running",
        latestResultSummary: null,
        strategy: null,
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: "2026-03-27T00:00:01.000Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.messages).toHaveLength(1);
    expect(response.data.messages[0]).toEqual(
      expect.objectContaining({
        role: "user",
        textContent: "root\n\n prompt",
      }),
    );
  });

  test("buildTaskTreeResponse hydrates assistant shell content from snapshot summary", async () => {
    const rootSessionId = "task-session:task-1:root";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: `${rootSessionId}:msg-1`,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "runtime-assistant-1",
          role: "assistant",
          messageIndex: 0,
          textContent: null,
          summaryText: null,
          rawPayload: {
            info: {
              id: "runtime-assistant-1",
              role: "assistant",
            },
          },
          createdAt: "2026-03-27T00:00:01.000Z",
          updatedAt: "2026-03-27T00:00:01.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: rootSessionId,
        latestResultSummary: "hydrated assistant reply",
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "Task 1",
        prompt: "root prompt",
        status: "running",
        latestResultSummary: null,
        strategy: null,
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: "2026-03-27T00:00:01.000Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          textContent: "hydrated assistant reply",
        }),
      ]),
    );
    expect(response.data.messageParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          textContent: "hydrated assistant reply",
        }),
      ]),
    );
  });

  test("buildTaskTreeResponse prefers richer assistant rows when equivalent preview replies are duplicated", async () => {
    const rootSessionId = "task-session:task-1:root";
    const promptText = "请回复：页面任务执行正常。";
    const assistantCreatedAt = "2026-03-27T00:00:01.000Z";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: `${rootSessionId}:msg-user-1`,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "runtime-user-1",
          role: "user",
          messageIndex: 0,
          textContent: promptText,
          summaryText: promptText,
          rawPayload: {
            info: {
              id: "runtime-user-1",
              role: "user",
              time: { created: "2026-03-27T00:00:00.000Z" },
            },
            text: promptText,
            parts: [{ type: "text", text: promptText, content: promptText }],
          },
          createdAt: "2026-03-27T00:00:00.000Z",
          updatedAt: "2026-03-27T00:00:00.000Z",
        },
        {
          id: `${rootSessionId}:msg-assistant-preview`,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "runtime-assistant-preview",
          role: "assistant",
          messageIndex: 1,
          textContent: "页面任务执行正常。",
          summaryText: null,
          rawPayload: {
            info: {
              id: "runtime-assistant-preview",
              role: "assistant",
              preview: "页面任务执行正常。",
              time: {
                created: assistantCreatedAt,
                completed: assistantCreatedAt,
              },
              finish: "stop",
            },
            text: "页面任务执行正常。",
            parts: [{ type: "text", text: "页面任务执行正常。", content: "页面任务执行正常。" }],
          },
          createdAt: assistantCreatedAt,
          completedAt: assistantCreatedAt,
          updatedAt: assistantCreatedAt,
        },
        {
          id: `${rootSessionId}:msg-assistant-rich`,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "runtime-assistant-rich",
          role: "assistant",
          messageIndex: 2,
          textContent: "页面任务执行正常。",
          summaryText: "页面任务执行正常。",
          rawPayload: {
            info: {
              id: "runtime-assistant-rich",
              role: "assistant",
              time: {
                created: assistantCreatedAt,
                completed: assistantCreatedAt,
              },
              finish: "stop",
            },
            parts: [
              { type: "thinking", text: "**Confirming task execution**" },
              { type: "text", text: "页面任务执行正常。", content: "页面任务执行正常。" },
            ],
          },
          createdAt: assistantCreatedAt,
          completedAt: assistantCreatedAt,
          updatedAt: assistantCreatedAt,
        },
      ],
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "Task 1",
        prompt: promptText,
        status: "completed",
        latestResultSummary: null,
        strategy: null,
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: assistantCreatedAt,
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    const assistantMessages = response.data.messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toEqual(
      expect.objectContaining({
        id: `${rootSessionId}:msg-assistant-rich`,
        textContent: "页面任务执行正常。",
        summaryText: "页面任务执行正常。",
      }),
    );
  });

  test("buildTaskTreeResponse falls back tool message parts into operations when task operations are absent", async () => {
    const rootSessionId = "task-session:task-1:root";
    const assistantMessageId = `${rootSessionId}:msg-1`;
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "root",
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: assistantMessageId,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "runtime-assistant-1",
          role: "assistant",
          messageIndex: 0,
          textContent: "assistant reply",
          summaryText: "assistant reply",
          rawPayload: {
            info: {
              id: "runtime-assistant-1",
              role: "assistant",
            },
          },
          createdAt: "2026-03-27T00:00:01.000Z",
          updatedAt: "2026-03-27T00:00:02.000Z",
          completedAt: "2026-03-27T00:00:02.000Z",
        },
      ],
      partRows: [
        {
          id: `${assistantMessageId}:0`,
          messageId: assistantMessageId,
          partIndex: 0,
          partType: "tool_call",
          textContent: null,
          jsonPayload: {
            type: "tool_call",
            name: "search_code",
            input: {
              query: "task tree",
              includePattern: "src/**",
            },
          },
          createdAt: "2026-03-27T00:00:01.100Z",
        },
        {
          id: `${assistantMessageId}:1`,
          messageId: assistantMessageId,
          partIndex: 1,
          partType: "tool_result",
          textContent: "match found",
          jsonPayload: {
            type: "tool",
            tool: "search_code",
            state: {
              status: "completed",
              output: "match found",
            },
          },
          createdAt: "2026-03-27T00:00:01.200Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: rootSessionId,
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "Task 1",
        prompt: "root prompt",
        status: "completed",
        latestResultSummary: "assistant reply",
        strategy: null,
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: "2026-03-27T00:00:02.000Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: assistantMessageId,
          operationKind: "tool_call",
          executorLabel: "search_code",
          executionStatus: "complete",
        }),
        expect.objectContaining({
          messageId: assistantMessageId,
          operationKind: "tool_result",
          executorLabel: "search_code",
          executionStatus: "completed",
          outputText: "match found",
        }),
      ]),
    );
    expect(response.data.edges.messageOperation).toEqual(
      expect.arrayContaining([expect.objectContaining({ messageId: assistantMessageId })]),
    );
  });

  test("buildTaskTreeResponse collapses duplicated tool messages written with mixed runtime ids", async () => {
    const rootSessionId = "task-session:task-1:root";
    const runtimeSessionId = "root";
    const streamingToolMessageId = `${rootSessionId}:${runtimeSessionId}:tool:call-1`;
    const completedToolMessageId = `${rootSessionId}:tool:call-1`;
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId,
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: streamingToolMessageId,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: `${runtimeSessionId}:tool:call-1`,
          role: "tool",
          status: "streaming",
          messageIndex: 0,
          textContent: "match found",
          summaryText: "match found",
          rawPayload: {
            info: {
              id: `${runtimeSessionId}:tool:call-1`,
              role: "tool",
              sessionID: runtimeSessionId,
              tool: {
                callID: "call-1",
                toolName: "search_code",
              },
              time: {
                created: "2026-03-27T00:00:01.000Z",
              },
            },
            parts: [{ type: "text", text: "match found" }],
          },
          createdAt: "2026-03-27T00:00:01.000Z",
          updatedAt: "2026-03-27T00:00:01.000Z",
        },
        {
          id: completedToolMessageId,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "tool:call-1",
          role: "tool",
          status: "completed",
          messageIndex: 1,
          textContent: "match found",
          summaryText: "match found",
          rawPayload: {
            id: "tool:call-1",
            info: {
              id: "tool:call-1",
              role: "tool",
              sessionID: runtimeSessionId,
              time: {
                created: "2026-03-27T00:00:01.001Z",
                completed: "2026-03-27T00:00:01.001Z",
              },
            },
            part: {
              id: "tool-part:call-1",
              type: "tool",
              tool: "search_code",
              toolName: "search_code",
              callID: "call-1",
              messageID: "tool:call-1",
              sessionID: runtimeSessionId,
              state: {
                status: "completed",
                output: "match found",
              },
            },
          },
          createdAt: "2026-03-27T00:00:01.001Z",
          updatedAt: "2026-03-27T00:00:01.001Z",
          completedAt: "2026-03-27T00:00:01.001Z",
        },
      ],
      partRows: [
        {
          id: `${streamingToolMessageId}:0`,
          messageId: streamingToolMessageId,
          partIndex: 0,
          partType: "text",
          textContent: "match found",
          jsonPayload: {
            type: "text",
            text: "match found",
          },
          createdAt: "2026-03-27T00:00:01.000Z",
        },
        {
          id: `${completedToolMessageId}:0`,
          messageId: completedToolMessageId,
          partIndex: 0,
          partType: "tool_result",
          textContent: "match found",
          jsonPayload: {
            type: "tool",
            tool: "search_code",
            callID: "call-1",
            messageID: "tool:call-1",
            state: {
              status: "completed",
              output: "match found",
            },
          },
          createdAt: "2026-03-27T00:00:01.001Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: rootSessionId,
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "Task 1",
        prompt: "root prompt",
        status: "completed",
        latestResultSummary: "done",
        strategy: null,
        createdAt: "2026-03-27T00:00:00.000Z",
        lastActivityAt: "2026-03-27T00:00:02.000Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    const toolMessages = response.data.messages.filter((message) => message.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]).toEqual(
      expect.objectContaining({
        id: completedToolMessageId,
        runtimeMessageId: "tool:call-1",
        status: "completed",
        textContent: "match found",
      }),
    );
  });

  test("buildTaskSessionTimelineViewResponse collapses duplicated tool timeline rows written with mixed runtime ids", async () => {
    const rootSessionId = "task-session:task-1:root";
    const runtimeSessionId = "root";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: rootSessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId,
          coordinationKey: rootSessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: `${rootSessionId}:assistant-1`,
          taskId: "task-1",
          sessionId: rootSessionId,
          runtimeMessageId: "assistant-1",
          role: "assistant",
          status: "completed",
          clientMessageId: null,
          providerMessageId: null,
          seq: 6,
          textContent: "match found",
          textPreview: "match found",
          rawPayload: {
            info: {
              id: "assistant-1",
              role: "assistant",
              messageIndex: 6,
            },
          },
          tokenUsed: 0,
          startedAt: "2026-03-27T00:00:01.000Z",
          completedAt: "2026-03-27T00:00:01.100Z",
          errorText: null,
          createdAt: "2026-03-27T00:00:01.000Z",
          updatedAt: "2026-03-27T00:00:01.100Z",
        },
      ],
      timelineRows: [
        {
          id: "task-timeline:message:streaming-tool",
          taskId: "task-1",
          projectId: "project-1",
          sessionId: rootSessionId,
          messageId: `${rootSessionId}:${runtimeSessionId}:tool:call-1`,
          operationId: null,
          artifactId: null,
          itemKind: "message",
          itemRole: "tool",
          title: null,
          displayText: "match found",
          metadataJson: {
            role: "tool",
            runtimeMessageId: `${runtimeSessionId}:tool:call-1`,
          },
          sortAt: "2026-03-27T00:00:01.000Z",
          createdAt: "2026-03-27T00:00:01.000Z",
          updatedAt: "2026-03-27T00:00:01.100Z",
        },
        {
          id: "task-timeline:message:completed-tool",
          taskId: "task-1",
          projectId: "project-1",
          sessionId: rootSessionId,
          messageId: `${rootSessionId}:tool:call-1`,
          operationId: null,
          artifactId: null,
          itemKind: "message",
          itemRole: "tool",
          title: null,
          displayText: "match found",
          metadataJson: {
            role: "tool",
            runtimeMessageId: "tool:call-1",
          },
          sortAt: "2026-03-27T00:00:01.001Z",
          createdAt: "2026-03-27T00:00:01.001Z",
          updatedAt: "2026-03-27T00:00:01.100Z",
        },
      ],
      taskDomainEventRows: [
        {
          taskId: "task-1",
          seq: 23,
          createdAt: "2026-03-27T00:00:02.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: rootSessionId,
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.buildTaskSessionTimelineViewResponse({
      taskId: "task-1",
      sessionId: rootSessionId,
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.data).toHaveLength(1);
    expect(response.data.data[0]).toEqual(
      expect.objectContaining({
        id: "task-timeline:message:completed-tool",
        messageId: `${rootSessionId}:tool:call-1`,
        displayText: "match found",
        metadataJson: expect.objectContaining({
          runtimeMessageId: "tool:call-1",
        }),
      }),
    );
    expect(response.data.meta).toMatchObject({
      itemCount: 1,
      snapshotVersion: 23,
      persistedThroughRevision: 6,
    });
  });

  test("buildTaskNormalizedConversationQueryResponse annotates the service-direct normalized view", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          coordinationKey: sessionId,
          createdAt: "2026-03-27T00:00:00.000Z",
        },
      ],
      messageRows: [
        {
          id: `${sessionId}:msg-1`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-1",
          role: "assistant",
          messageIndex: 0,
          textContent: "normalized response",
          summaryText: "normalized response",
          rawPayload: {
            info: {
              id: "runtime-message-1",
              role: "assistant",
            },
          },
          createdAt: "2026-03-27T00:00:01.000Z",
          updatedAt: "2026-03-27T00:00:01.000Z",
        },
      ],
      taskDomainEventRows: [
        {
          taskId: "task-1",
          seq: 17,
          createdAt: "2026-03-27T00:00:02.000Z",
        },
      ],
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
    });

    const response = await api.buildTaskNormalizedConversationQueryResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.meta).toMatchObject({
      readSource: "task-session-first",
      viewType: "normalized-conversation",
      querySurface: "service-direct",
      messageCount: 1,
      snapshotVersion: 17,
      persistedThroughRevision: 0,
    });
    expect(response.data.data).toEqual([
      expect.objectContaining({
        id: `${sessionId}:msg-1`,
        textContent: "normalized response",
      }),
    ]);
  });

  test("buildTaskTreeResponse keeps root prompt and orders later user replies by runtime payload time", async () => {
    const sessionId = "task-session:task-1:session-1";
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [
        {
          id: sessionId,
          taskId: "task-1",
          parentSessionId: null,
          runtimeSessionId: "session-1",
          coordinationKey: sessionId,
          createdAt: "2026-04-02T10:38:23.525Z",
        },
      ],
      messageRows: [
        {
          id: `${sessionId}:msg-user`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-user",
          role: "user",
          messageIndex: 0,
          textContent: "简单的生成1个 C程序：print aa",
          summaryText: "简单的生成1个 C程序：print aa",
          rawPayload: {
            info: {
              id: "runtime-message-user",
              role: "user",
              time: {
                created: "2026-04-02T10:42:03.006Z",
              },
            },
          },
          createdAt: "2026-04-02T10:38:24.000Z",
          updatedAt: "2026-04-02T10:38:24.000Z",
        },
        {
          id: `${sessionId}:msg-assistant`,
          taskId: "task-1",
          sessionId,
          runtimeMessageId: "runtime-message-assistant",
          role: "assistant",
          messageIndex: 1,
          textContent: "请告诉我您希望我处理什么任务？",
          summaryText: "请告诉我您希望我处理什么任务？",
          rawPayload: {
            info: {
              id: "runtime-message-assistant",
              role: "assistant",
              time: {
                created: "2026-04-02T10:38:25.000Z",
              },
            },
          },
          createdAt: "2026-04-02T10:38:25.000Z",
          updatedAt: "2026-04-02T10:38:25.000Z",
        },
      ],
      snapshot: {
        taskId: "task-1",
        currentSessionId: sessionId,
      },
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "实现新功能",
        prompt: "请先梳理需求和边界条件，再实现功能代码。",
        status: "completed",
        latestResultSummary: "请告诉我您希望我处理什么任务？",
        strategy: null,
        createdAt: "2026-04-02T10:38:23.525Z",
        lastActivityAt: "2026-04-02T10:42:03.006Z",
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.messages.map((message) => message.textContent)).toEqual([
      "请先梳理需求和边界条件，再实现功能代码。",
      "请告诉我您希望我处理什么任务？",
      "简单的生成1个 C程序：print aa",
    ]);
    expect(response.data.messages.map((message) => message.createdAt)).toEqual([
      "2026-04-02T10:38:23.525Z",
      "2026-04-02T10:38:25.000Z",
      "2026-04-02T10:42:03.006Z",
    ]);
  });

  test("buildTaskTreeResponse synthesizes root prompt when task has no sessions", async () => {
    const { createTaskSessionReadApi } = await loadTaskSessionReadModule({
      sessionRows: [],
      messageRows: [],
      snapshot: null,
    });

    const api = createTaskSessionReadApi({
      loadTaskTreeBackedRecord: mock(async () => ({
        id: "task-1",
        projectId: "project-1",
        title: "开发macos上的语音输入的软件",
        prompt: "开发macos上的语音输入的软件",
        status: "pending",
        latestResultSummary: null,
        strategy: null,
        createdAt: "2026-04-02T10:38:23.525Z",
        lastActivityAt: null,
      })),
    });

    const response = await api.buildTaskTreeResponse({
      taskId: "task-1",
      includeLineage: true,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      return;
    }

    expect(response.data.sessions).toEqual([]);
    expect(response.data.messages.length).toBe(1);
    expect(response.data.messages[0]).toEqual(
      expect.objectContaining({
        role: "user",
        textContent: "开发macos上的语音输入的软件",
      }),
    );
    expect(response.data.messageParts.length).toBeGreaterThan(0);
    expect(response.data.messageParts[0]).toEqual(
      expect.objectContaining({
        partType: "text",
        textContent: "开发macos上的语音输入的软件",
      }),
    );
  });
});
