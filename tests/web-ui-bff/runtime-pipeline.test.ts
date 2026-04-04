import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  PersistedTaskStrategy,
  RuntimePlan,
} from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import {
  expectNoPublicTraceRequests,
  expectSessionMessageReaderCalls,
} from "./session-message-compatibility-test-helpers";

const cpFetchMock = mock(async (_url: string, _options?: { authorization?: string }) => ({
  ok: false,
  data: undefined,
}));
mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: mock(() => "Bearer test"),
  cpFetch: cpFetchMock,
  createInternalAuthorization: mock(async () => "Bearer internal"),
  setControlPlaneFetchHandler: mock(() => undefined),
}));

const getSessionMessagesMock = mock(async (_sessionId: string) => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));
const extractAssistantResultFromMessagesMock = mock(() => ({
  completed: false,
  failed: false,
  error: undefined as string | undefined,
  tokenUsed: 0,
}));
const getAgentRunMock = mock(() => undefined);
const listSessionsMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));
const recoverAgentRunMock = mock(() => undefined);

function buildOpencodeAdapterMock() {
  return {
    continueSession: mock(async () => ({ ok: true })),
    createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
    ensureAgentRunForSession: mock(() => "run-1"),
    extractAssistantResultFromMessages: extractAssistantResultFromMessagesMock,
    findAgentRunBySessionId: mock(() => undefined),
    forkSession: mock(async () => ({ ok: true, sessionId: "session-2" })),
    getAgentMessages: mock(async () => ({ ok: true, data: [] })),
    getAgentRun: getAgentRunMock,
    getSessionMessages: getSessionMessagesMock,
    injectGuidance: mock(async () => ({ ok: true })),
    listAgentRuns: mock(() => []),
    listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
    listSessions: listSessionsMock,
    pauseAgent: mock(async () => ({ ok: true })),
    recoverAgentRun: recoverAgentRunMock,
    registerAgentRun: mock(() => undefined),
    replyRuntimePermission: mock(async () => ({ ok: true })),
    resumeAgent: mock(async () => ({ ok: true })),
    runDetachedPrompt: mock(async () => ({
      ok: true,
      text: "judge result",
      sessionId: "judge-ses",
    })),
    terminateAgent: mock(async () => ({ ok: true })),
    updateAgentRunStatus: mock(() => undefined),
  };
}

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter",
  buildOpencodeAdapterMock,
);

async function loadRuntimePipelineModule() {
  return import("../../control-plane/web-ui-bff/src/lib/runtime-pipeline?runtime-pipeline-test");
}

function createRuntimePlan(overrides: Partial<RuntimePlan> = {}): RuntimePlan {
  return {
    templateId: "parallel-template",
    mode: "parallel",
    steps: [
      { id: "exec-1", type: "execution", status: "running", dependsOn: ["pre-1"] },
      { id: "judge-1", type: "judge", status: "pending", dependsOn: ["exec-1"] },
    ],
    candidates: [
      {
        label: "候选 A",
        agent: "default-executor",
        model: "gpt-5.4",
        sessionId: "ses-branch-1",
        status: "running",
        result: "正在生成实现",
        startedAt: "2026-03-12T10:00:00.000Z",
      },
      {
        label: "候选 B",
        agent: "reviewer",
        model: "gpt-5.4",
        sessionId: "ses-branch-2",
        status: "completed",
        result: "已给出替代方案",
        startedAt: "2026-03-12T09:59:00.000Z",
        finishedAt: "2026-03-12T10:01:00.000Z",
      },
    ],
    judgeResult: {
      status: "pending",
      reasoning: "等待所有候选完成后再裁决",
      completedAt: "2026-03-12T10:02:00.000Z",
      sessionId: "ses-judge",
    },
    ...overrides,
  };
}

function createStrategy(overrides: Partial<PersistedTaskStrategy> = {}): PersistedTaskStrategy {
  return {
    selectedAgent: "default-executor",
    executionMode: "parallel",
    hookExecutions: [
      {
        hookId: "pre-credential-check",
        trigger: "pre-execution",
        status: "completed",
        agent: "reviewer",
        model: "gpt-5.4",
        prompt: "检查凭据",
        result: "凭据可用",
        sessionId: "ses-branch-1",
        completedAt: "2026-03-12T09:58:00.000Z",
      },
      {
        hookId: "post-review",
        trigger: "post-execution",
        status: "skipped",
        agent: "reviewer",
        prompt: "执行后审查",
        sessionId: "ses-branch-1",
        completedAt: "2026-03-12T10:05:00.000Z",
      },
    ],
    followupExecutions: [
      {
        templateId: "post-review-followup",
        triggerHookId: "post-review",
        status: "completed",
        agent: "oracle-enterprise",
        model: "github-copilot:gpt-5.4",
        prompt: "Summarize remaining risks",
        result: "建议补一轮回归验证。",
        sessionId: "ses-followup",
        completedAt: "2026-03-12T10:06:00.000Z",
      },
    ],
    ...overrides,
  };
}

function createParallelDomainRuns(overrides: Partial<Array<Record<string, unknown>>> = []) {
  const defaultRun = {
    id: "run-parallel-1",
    taskId: "task-1",
    projectId: "proj-1",
    orchestrationKind: "parallel",
    status: "running",
    rootSessionId: "ses-root",
    createdAt: "2026-03-12T09:59:00.000Z",
    updatedAt: "2026-03-12T10:02:00.000Z",
    startedAt: "2026-03-12T09:59:00.000Z",
    finishedAt: null,
  };

  return (overrides.length ? overrides : [defaultRun]) as Array<Record<string, unknown>>;
}

function createParallelDomainRunDetail(overrides?: Partial<Record<string, unknown>>) {
  return {
    run: {
      id: "run-parallel-1",
      taskId: "task-1",
      projectId: "proj-1",
      orchestrationKind: "parallel",
      status: "running",
      rootSessionId: "ses-root",
      createdAt: "2026-03-12T09:59:00.000Z",
      updatedAt: "2026-03-12T10:02:00.000Z",
    },
    nodes: [],
    candidateNodes: [
      {
        id: "candidate-node-1",
        runId: "run-parallel-1",
        taskId: "task-1",
        projectId: "proj-1",
        nodeKind: "candidate",
        nodeKey: "candidate:0",
        title: "候选 A",
        candidateIndex: 0,
        agentType: "default-executor",
        modelUsed: "gpt-5.4",
        sessionId: "ses-branch-1",
        status: "running",
        resultText: "正在生成实现",
        startedAt: "2026-03-12T10:00:00.000Z",
        finishedAt: null,
      },
      {
        id: "candidate-node-2",
        runId: "run-parallel-1",
        taskId: "task-1",
        projectId: "proj-1",
        nodeKind: "candidate",
        nodeKey: "candidate:1",
        title: "候选 B",
        candidateIndex: 1,
        agentType: "reviewer",
        modelUsed: "gpt-5.4",
        sessionId: "ses-branch-2",
        status: "completed",
        resultText: "已给出替代方案",
        startedAt: "2026-03-12T09:59:00.000Z",
        finishedAt: "2026-03-12T10:01:00.000Z",
      },
    ],
    judgeNode: {
      id: "judge-node-1",
      runId: "run-parallel-1",
      taskId: "task-1",
      projectId: "proj-1",
      nodeKind: "judge",
      nodeKey: "judge",
      title: "评判 / 聚合",
      agentType: null,
      modelUsed: null,
      sessionId: "ses-judge",
      status: "pending",
      resultText: "等待所有候选完成后再裁决",
      startedAt: null,
      finishedAt: "2026-03-12T10:02:00.000Z",
    },
    winnerCandidateIndex: null,
    ...overrides,
  };
}

beforeEach(() => {
  cpFetchMock.mockReset();
  getSessionMessagesMock.mockReset();
  extractAssistantResultFromMessagesMock.mockReset();
  getAgentRunMock.mockReset();
  listSessionsMock.mockReset();
  recoverAgentRunMock.mockReset();
  extractAssistantResultFromMessagesMock.mockReturnValue({
    completed: false,
    failed: false,
    error: undefined,
    tokenUsed: 0,
  });
  getAgentRunMock.mockReturnValue(undefined);
  listSessionsMock.mockResolvedValue({ ok: true, data: [] });
  recoverAgentRunMock.mockReturnValue(undefined);
});

describe("buildRuntimePipeline", () => {
  test("appends follow-up executions as dedicated stages", async () => {
    const strategy = createStrategy();

    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-followup") {
        return {
          ok: true,
          data: {
            id: "task-followup",
            status: "completed",
            orchestrationKind: "single",
            currentRunId: null,
            result: "主任务已完成",
            sessionId: "ses-root",
            createdAt: "2026-03-12T09:50:00.000Z",
            finishedAt: "2026-03-12T10:06:00.000Z",
            strategy: JSON.stringify(strategy),
          },
        };
      }

      if (url === "/api/tasks/task-followup/sessions") {
        return {
          ok: true,
          data: {
            data: [{ id: "ts-root", runtimeSessionId: "ses-root", branchName: "main", isActive: true }],
          },
        };
      }

      return { ok: false, data: undefined };
    });
    getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });

    const { buildRuntimePipeline } = await loadRuntimePipelineModule();
    const pipeline = await buildRuntimePipeline({
      taskId: "task-followup",
      sessionId: "ses-root",
      authorization: "Bearer test",
    });

    const followupStage = pipeline.stages.find((stage) => stage.type === "follow-up");
    expect(followupStage).toBeTruthy();
    expect(followupStage?.label).toContain("Follow-up");
    expect(followupStage?.sessionId).toBe("ses-followup");
    expect(followupStage?.output).toContain("回归验证");
  });

  test("parallel tasks expose lineage metadata without synthesizing candidate stages", async () => {
    const strategy = createStrategy({
      parallelCandidates: [
        { label: "候选 A", model: "gpt-5.4" },
        { label: "候选 B", model: "claude-opus-4.6" },
      ],
    });

    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-parallel") {
        return {
          ok: true,
          data: {
            id: "task-parallel",
            status: "running",
            orchestrationKind: "parallel",
            currentRunId: "run-parallel-1",
            sessionId: "ses-root",
            createdAt: "2026-03-12T09:50:00.000Z",
            strategy: JSON.stringify(strategy),
          },
        };
      }

      if (url === "/api/tasks/task-parallel/sessions") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "ses-root",
                branchName: "main",
                executionStatus: "running",
                archivedAt: null,
              },
            ],
            meta: {
              currentSessionId: "ts-root",
            },
          },
        };
      }

      throw new Error(`Unexpected cpFetch url: ${url}`);
    });

    getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });

    const { buildRuntimePipeline } = await loadRuntimePipelineModule();
    const pipeline = await buildRuntimePipeline({
      taskId: "task-parallel",
      sessionId: "ses-root",
      authorization: "Bearer test",
    });

    expectSessionMessageReaderCalls(getSessionMessagesMock, ["ses-root"]);
    expectNoPublicTraceRequests(cpFetchMock.mock.calls.map(([url]) => String(url)));
    expect(pipeline.taskId).toBe("task-parallel");
    expect(pipeline.sessionId).toBe("ses-root");
    expect(pipeline.branchName).toBe("main");
    expect(pipeline.status).toBe("running");
    expect(pipeline.stages.map((stage) => stage.type)).toEqual([
      "hook",
      "post-hook",
      "follow-up",
    ]);
    expect(pipeline.stages.some((stage) => stage.type === "execution")).toBe(false);
    expect(pipeline.stages.some((stage) => stage.type === "judge")).toBe(false);
    expect(pipeline.summary).toMatchObject({
      totalStages: 3,
      completedStages: 2,
      failedStages: 0,
      currentStageId: null,
    });
  });

  test("returns an empty idle pipeline when the requested session does not belong to the task", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-2") {
        return {
          ok: true,
          data: {
            id: "task-2",
            status: "running",
            sessionId: "ses-root",
            createdAt: "2026-03-12T11:00:00.000Z",
            strategy: JSON.stringify(createStrategy()),
          },
        };
      }

      if (url === "/api/tasks/task-2/sessions") {
        return {
          ok: true,
          data: {
            data: [
              { id: "ts-root", runtimeSessionId: "ses-root", branchName: "main", isActive: true },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-2/graph") {
        return {
          ok: true,
          data: { taskId: "task-2", nodes: [], edges: [] },
        };
      }

      throw new Error(`Unexpected cpFetch url: ${url}`);
    });

    const { buildRuntimePipeline } = await loadRuntimePipelineModule();
    const pipeline = await buildRuntimePipeline({
      taskId: "task-2",
      sessionId: "ses-not-owned",
      authorization: "Bearer test",
    });

    expect(pipeline).toMatchObject({
      taskId: "task-2",
      sessionId: "ses-not-owned",
      branchName: null,
      status: "idle",
      stages: [],
      summary: {
        totalStages: 0,
        completedStages: 0,
        failedStages: 0,
        currentStageId: null,
        totalTokens: { input: 0, output: 0 },
        totalDurationMs: 0,
        replanCount: 0,
      },
    });
    expectSessionMessageReaderCalls(getSessionMessagesMock, ["ses-not-owned"]);
    expectNoPublicTraceRequests(cpFetchMock.mock.calls.map(([url]) => String(url)));
  });

  test("ignores legacy runtime plan and falls back to planning stages for non-parallel tasks", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-3") {
        return {
          ok: true,
          data: {
            id: "task-3",
            status: "completed",
            orchestrationKind: "single",
            sessionId: "ses-root",
            createdAt: "2026-03-12T12:00:00.000Z",
            executionPlan: JSON.stringify(createRuntimePlan()),
            strategy: JSON.stringify({
              selectedAgent: "default-executor",
            } satisfies PersistedTaskStrategy),
          },
        };
      }

      if (url === "/api/tasks/task-3/sessions") {
        return {
          ok: true,
          data: {
            data: [
              { id: "ts-root", runtimeSessionId: "ses-root", branchName: "main", isActive: true },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-3/graph") {
        return {
          ok: true,
          data: { taskId: "task-3", nodes: [], edges: [] },
        };
      }

      throw new Error(`Unexpected cpFetch url: ${url}`);
    });

    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          info: {
            id: "msg-plan-only",
            role: "assistant",
            agent: "momus-enterprise",
            modelID: "gpt-5.4",
            tokens: { input: 30, output: 25 },
            time: {
              created: Date.parse("2026-03-12T12:00:10.000Z"),
              completed: Date.parse("2026-03-12T12:00:12.000Z"),
            },
          },
          parts: [{ type: "text", text: "给出风险清单" }],
        },
      ],
    });

    const { buildRuntimePipeline } = await loadRuntimePipelineModule();
    const pipeline = await buildRuntimePipeline({
      taskId: "task-3",
      authorization: "Bearer test",
    });

    expect(pipeline.status).toBe("completed");
    expect(pipeline.branchName).toBe("main");
    expect(pipeline.stages).toHaveLength(1);
    expect(pipeline.stages[0]).toMatchObject({
      type: "planning",
      label: "规划 · momus",
      status: "completed",
      messageCount: 1,
      output: "给出风险清单",
    });
    expect(pipeline.summary).toMatchObject({
      totalStages: 1,
      completedStages: 1,
      totalTokens: { input: 30, output: 25 },
      currentStageId: null,
    });
  });

  
});
