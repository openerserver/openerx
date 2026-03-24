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
  test("finalizes unfinished stages when the task has already failed", async () => {
    const plan = createRuntimePlan();
    const strategy = createStrategy();

    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-failed") {
        return {
          ok: true,
          data: {
            id: "task-failed",
            status: "failed",
            orchestrationKind: "parallel",
            currentRunId: "run-parallel-failed",
            result: "Recovered from failed assistant session: The operation was aborted.",
            sessionId: "ses-root",
            createdAt: "2026-03-12T09:50:00.000Z",
            finishedAt: "2026-03-12T10:06:00.000Z",
            strategy: JSON.stringify(strategy),
          },
        };
      }

      if (url === "/api/tasks/task-failed/branches") {
        return {
          ok: true,
          data: {
            data: [
              { id: "ts-root", runtimeSessionId: "ses-root", branchName: "main", isActive: true },
              {
                id: "ts-branch-1",
                runtimeSessionId: "ses-branch-1",
                branchName: "候选 A",
                isActive: false,
              },
              {
                id: "ts-branch-2",
                runtimeSessionId: "ses-branch-2",
                branchName: "候选 B",
                isActive: false,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-failed/domain-runs") {
        return {
          ok: true,
          data: {
            data: createParallelDomainRuns([
              {
                id: "run-parallel-failed",
                taskId: "task-failed",
                projectId: "proj-1",
                orchestrationKind: "parallel",
                status: "running",
                rootSessionId: "ses-root",
                createdAt: "2026-03-12T09:59:00.000Z",
                updatedAt: "2026-03-12T10:02:00.000Z",
              },
            ]),
          },
        };
      }

      if (url === "/api/tasks/task-failed/domain-runs/run-parallel-failed") {
        return {
          ok: true,
          data: {
            data: createParallelDomainRunDetail({
              run: {
                id: "run-parallel-failed",
                taskId: "task-failed",
                projectId: "proj-1",
                orchestrationKind: "parallel",
                status: "running",
                rootSessionId: "ses-root",
                createdAt: "2026-03-12T09:59:00.000Z",
                updatedAt: "2026-03-12T10:02:00.000Z",
              },
            }),
          },
        };
      }

      if (url === "/api/tasks/task-failed/graph") {
        return {
          ok: true,
          data: { taskId: "task-failed", nodes: [], edges: [] },
        };
      }

      throw new Error(`Unexpected cpFetch url: ${url}`);
    });

    getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });

    const { buildRuntimePipeline } = await loadRuntimePipelineModule();
    const pipeline = await buildRuntimePipeline({
      taskId: "task-failed",
      authorization: "Bearer test",
    });

    expect(pipeline.status).toBe("failed");
    expect(pipeline.stages.find((stage) => stage.id === "candidate:0:ses-branch-1")).toMatchObject({
      status: "failed",
      error: "Recovered from failed assistant session: The operation was aborted.",
      finishedAt: "2026-03-12T10:06:00.000Z",
    });
    expect(pipeline.stages.find((stage) => stage.id === "judge:judge-node-1")).toMatchObject({
      status: "skipped",
      finishedAt: "2026-03-12T10:02:00.000Z",
    });
    expect(pipeline.summary).toMatchObject({
      failedStages: 1,
      currentStageId: null,
    });
  });

  test("aggregates hooks, planning and runtime plan stages for the selected branch", async () => {
    const plan = createRuntimePlan();
    const strategy = createStrategy();

    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            status: "running",
            orchestrationKind: "parallel",
            currentRunId: "run-parallel-1",
            sessionId: "ses-root",
            createdAt: "2026-03-12T09:50:00.000Z",
            strategy: JSON.stringify(strategy),
          },
        };
      }

      if (url === "/api/tasks/task-1/branches") {
        return {
          ok: true,
          data: {
            data: [
              { id: "ts-root", runtimeSessionId: "ses-root", branchName: "main", isActive: false },
              {
                id: "ts-1",
                runtimeSessionId: "ses-branch-1",
                branchName: "feature/runtime",
                isActive: true,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/domain-runs") {
        return {
          ok: true,
          data: {
            data: createParallelDomainRuns(),
          },
        };
      }

      if (url === "/api/tasks/task-1/domain-runs/run-parallel-1") {
        return {
          ok: true,
          data: {
            data: createParallelDomainRunDetail(),
          },
        };
      }

      if (url === "/api/tasks/task-1/graph") {
        return {
          ok: true,
          data: {
            taskId: "task-1",
            nodes: [
              {
                id: "node-1",
                subject: "编写实现",
                status: "in_progress",
                agentType: "default-executor",
                sessionId: "ses-branch-1",
                output: "正在写实现",
                error: null,
                tokenUsed: 321,
                startedAt: "2026-03-12T10:00:30.000Z",
                finishedAt: null,
              },
              {
                id: "node-other",
                subject: "其他分支节点",
                status: "completed",
                agentType: "reviewer",
                sessionId: "ses-branch-2",
                output: "不应进入当前分支视图",
                error: null,
                tokenUsed: 111,
                startedAt: "2026-03-12T09:55:00.000Z",
                finishedAt: "2026-03-12T09:56:00.000Z",
              },
            ],
            edges: [],
          },
        };
      }

      throw new Error(`Unexpected cpFetch url: ${url}`);
    });

    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          info: {
            id: "msg-plan-1",
            role: "assistant",
            agent: "prometheus-enterprise",
            modelID: "gpt-5.4",
            tokens: { input: 120, output: 80 },
            time: {
              created: Date.parse("2026-03-12T09:58:10.000Z"),
              completed: Date.parse("2026-03-12T09:58:12.000Z"),
            },
          },
          parts: [{ type: "text", text: "先分析问题边界" }],
        },
        {
          info: {
            id: "msg-plan-2",
            role: "assistant",
            agent: "metis-enterprise",
            model: "gpt-5.4",
            tokens: { input: 90, output: 60 },
            time: {
              created: Date.parse("2026-03-12T09:58:20.000Z"),
              completed: Date.parse("2026-03-12T09:58:21.000Z"),
            },
          },
          parts: [{ type: "text", text: "再补执行计划" }],
        },
        {
          info: {
            id: "msg-ignore",
            role: "assistant",
            agent: "other-agent",
          },
          parts: [{ type: "text", text: "忽略" }],
        },
      ],
    });

    const { buildRuntimePipeline } = await loadRuntimePipelineModule();
    const pipeline = await buildRuntimePipeline({
      taskId: "task-1",
      sessionId: "ses-branch-1",
      authorization: "Bearer test",
    });

    expectSessionMessageReaderCalls(getSessionMessagesMock, ["ses-branch-1"]);
    expectNoPublicTraceRequests(cpFetchMock.mock.calls.map(([url]) => String(url)));
    expect(pipeline.taskId).toBe("task-1");
    expect(pipeline.sessionId).toBe("ses-branch-1");
    expect(pipeline.branchName).toBe("feature/runtime");
    expect(pipeline.status).toBe("running");

    expect(pipeline.stages.map((stage) => stage.type)).toEqual([
      "hook",
      "planning",
      "planning",
      "execution",
      "execution",
      "judge",
      "post-hook",
    ]);

    expect(pipeline.stages.map((stage) => stage.label)).toEqual([
      "执行前 Hook · reviewer",
      "规划 · prometheus",
      "规划 · metis",
      "候选 A",
      "候选 B",
      "评判 / 聚合",
      "执行后 Hook · reviewer",
    ]);

    const runningCandidate = pipeline.stages.find(
      (stage) => stage.id === "candidate:0:ses-branch-1",
    );
    expect(runningCandidate).toMatchObject({
      status: "running",
      graphNodeId: "candidate-node-1",
      sessionId: "ses-branch-1",
      output: "正在生成实现",
      sourceType: "taskRun.node",
    });

    expect(pipeline.stages.find((stage) => stage.id === "graph:node-other")).toBeUndefined();
    expect(pipeline.summary).toMatchObject({
      totalStages: 7,
      completedStages: 4,
      failedStages: 0,
      currentStageId: "candidate:0:ses-branch-1",
      totalTokens: { input: 210, output: 140 },
      replanCount: 0,
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

      if (url === "/api/tasks/task-2/branches") {
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

      if (url === "/api/tasks/task-3/branches") {
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

  test("keeps duplicate-session candidates distinct without graph-node enrichment", async () => {
    const plan = createRuntimePlan({
      candidates: [
        {
          label: "候选 A1",
          agent: "default-executor",
          sessionId: "ses-shared",
          status: "running",
          startedAt: "2026-03-12T13:00:00.000Z",
        },
        {
          label: "候选 A2",
          agent: "reviewer",
          sessionId: "ses-shared",
          status: "pending",
        },
      ],
    });

    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/project-tree/tasks/task-4") {
        return {
          ok: true,
          data: {
            id: "task-4",
            status: "running",
            orchestrationKind: "parallel",
            currentRunId: "run-shared-1",
            sessionId: "ses-root",
            createdAt: "2026-03-12T13:00:00.000Z",
            strategy: JSON.stringify(createStrategy({ hookExecutions: [] })),
          },
        };
      }

      if (url === "/api/tasks/task-4/branches") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-shared",
                runtimeSessionId: "ses-shared",
                branchName: "shared",
                isActive: true,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-4/domain-runs") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "run-shared-1",
                taskId: "task-4",
                projectId: "proj-1",
                orchestrationKind: "parallel",
                status: "running",
                rootSessionId: "ses-root",
                createdAt: "2026-03-12T13:00:00.000Z",
                updatedAt: "2026-03-12T13:00:10.000Z",
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-4/domain-runs/run-shared-1") {
        return {
          ok: true,
          data: {
            data: {
              run: {
                id: "run-shared-1",
                taskId: "task-4",
                projectId: "proj-1",
                orchestrationKind: "parallel",
                status: "running",
                rootSessionId: "ses-root",
                createdAt: "2026-03-12T13:00:00.000Z",
                updatedAt: "2026-03-12T13:00:10.000Z",
              },
              nodes: [],
              candidateNodes: [
                {
                  id: "shared-node-1",
                  runId: "run-shared-1",
                  taskId: "task-4",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:0",
                  title: "候选 A1",
                  candidateIndex: 0,
                  agentType: "default-executor",
                  sessionId: "ses-shared",
                  status: "running",
                  startedAt: "2026-03-12T13:00:00.000Z",
                },
                {
                  id: "shared-node-2",
                  runId: "run-shared-1",
                  taskId: "task-4",
                  projectId: "proj-1",
                  nodeKind: "candidate",
                  nodeKey: "candidate:1",
                  title: "候选 A2",
                  candidateIndex: 1,
                  agentType: "reviewer",
                  sessionId: "ses-shared",
                  status: "pending",
                },
              ],
              judgeNode: null,
              winnerCandidateIndex: null,
            },
          },
        };
      }

      if (url === "/api/tasks/task-4/graph") {
        return {
          ok: true,
          data: {
            taskId: "task-4",
            nodes: [
              {
                id: "node-shared-1",
                subject: "共享分支节点一",
                status: "in_progress",
                agentType: "default-executor",
                sessionId: "ses-shared",
                output: "节点一输出",
                error: null,
                tokenUsed: 10,
                startedAt: "2026-03-12T13:00:10.000Z",
                finishedAt: null,
              },
              {
                id: "node-shared-2",
                subject: "共享分支节点二",
                status: "pending",
                agentType: "reviewer",
                sessionId: "ses-shared",
                output: null,
                error: null,
                tokenUsed: 0,
                startedAt: null,
                finishedAt: null,
              },
              {
                id: "node-no-session",
                subject: "公共节点",
                status: "completed",
                agentType: "system",
                sessionId: null,
                output: "公共输出",
                error: null,
                tokenUsed: 7,
                startedAt: "2026-03-12T13:00:05.000Z",
                finishedAt: "2026-03-12T13:00:06.000Z",
              },
            ],
            edges: [],
          },
        };
      }

      throw new Error(`Unexpected cpFetch url: ${url}`);
    });

    getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });

    const { buildRuntimePipeline } = await loadRuntimePipelineModule();
    const pipeline = await buildRuntimePipeline({
      taskId: "task-4",
      sessionId: "ses-shared",
      authorization: "Bearer test",
    });

    const firstCandidate = pipeline.stages.find((stage) => stage.id === "candidate:0:ses-shared");
    const secondCandidate = pipeline.stages.find((stage) => stage.id === "candidate:1:ses-shared");
    expectSessionMessageReaderCalls(getSessionMessagesMock, ["ses-shared"]);
    expectNoPublicTraceRequests(cpFetchMock.mock.calls.map(([url]) => String(url)));
    expect(firstCandidate).toMatchObject({
      graphNodeId: "shared-node-1",
      sessionId: "ses-shared",
    });
    expect(secondCandidate).toMatchObject({
      graphNodeId: "shared-node-2",
      sessionId: "ses-shared",
    });
    expect(pipeline.stages.find((stage) => stage.id === "graph:node-no-session")).toBeUndefined();
  });
});
