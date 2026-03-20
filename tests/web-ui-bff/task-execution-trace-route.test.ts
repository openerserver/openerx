/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const getSessionMessagesMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));
const buildWorkflowExecutionPromptSnapshotMock = mock(async () => ({
  workflowStatus: "running",
  currentStageKey: "implement",
  currentStageLabel: "实现",
  currentStageStatus: "running",
  currentStageExitCriteria: ["输出实现结果"],
  completedStageOutputs: [],
  pendingStageLabels: ["验证"],
}));
const buildTaskWorkflowViewModelMock = mock(async () => ({
  workflow: {
    status: "running",
    currentStage: "implement",
    stages: [
      {
        stageKey: "implement",
        stageLabel: "实现",
        status: "running",
      },
    ],
  },
  roleConclusions: [],
  developerChangeRequests: [],
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/intent-classifier", () => ({
  classifyIntent: mock(() => ({ category: "implementation" })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/opencode-config", () => ({
  diagnoseModelReadiness: mock(() => ({ ready: true })),
  formatModelRoute: mock(() => "github-copilot:gpt-5.4"),
  readDefaultExecutionModel: mock(() => "github-copilot:gpt-5.4"),
  resolveModelRoute: mock(() => ({ providerId: "github-copilot", modelId: "gpt-5.4" })),
  validateModelProvider: mock(() => true),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  DEFAULT_EXECUTION_AGENT: "default-executor",
  buildExecutionPlan: mock(() => ({ mode: "single", candidates: [] })),
  mergeTaskStrategy: mock((value: unknown) => value),
  parseTaskStrategy: mock(() => ({ selectedAgent: "oracle-enterprise" })),
  readOrchestrationStrategy: mock(async () => ({ hooks: [], templates: [], judge: {} })),
  resolveWorkflowTemplate: mock(() => null),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/paid-execution-guard", () => ({
  buildPreflightOrchestrationFingerprint: mock(() => "fingerprint"),
  createPaidExecutionGuardState: mock(() => ({})),
  evaluatePaidExecutionPreflight: mock(async () => ({ allowed: true })),
  fetchProjectPaidExecutionLeaseState: mock(async () => null),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/paid-execution-runtime", () => ({
  recordPaidExecutionRuntimeUsage: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/runtime-pipeline", () => ({
  buildRuntimePipeline: mock(async () => ({ stages: [] })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/runtime-usage-ledger", () => ({
  fetchProjectRuntimeUsageBaseline: mock(async () => null),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
  continueSession: mock(async () => ({ ok: true })),
  createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
  ensureAgentRunForSession: mock(() => "run-1"),
  forkSession: mock(async () => ({ ok: true, sessionId: "session-2" })),
  getSessionMessages: getSessionMessagesMock,
  listSessions: mock(async () => ({ ok: true, data: [] })),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
  recordAgentAudit: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => []),
  mergeStageAndStrategyHooks: mock(() => []),
  parseStageHooks: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events", () => ({
  buildPipelineStageUpdatedEvents: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () => ({
  sseAggregator: {
    registerParallelTask: mock(() => undefined),
  },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: {
    broadcast: mock(() => undefined),
  },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/reconcile", () => ({
  reconcileRunningTasksOnStartup: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution", () => ({
  buildStageArtifactSummary: mock(() => null),
  buildWorkflowExecutionPromptSnapshot: buildWorkflowExecutionPromptSnapshotMock,
  fetchCurrentStageHooks: mock(async () => []),
  persistWorkflowStageExecutionOutcome: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/workflow-sync", () => ({
  ensureTaskWorkflowStarted: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/workflow-view", () => ({
  buildTaskWorkflowViewModel: buildTaskWorkflowViewModelMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  getSessionMessagesMock.mockReset();
  buildWorkflowExecutionPromptSnapshotMock.mockReset();
  buildTaskWorkflowViewModelMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test");
  buildWorkflowExecutionPromptSnapshotMock.mockResolvedValue({
    workflowStatus: "running",
    currentStageKey: "implement",
    currentStageLabel: "实现",
    currentStageStatus: "running",
    currentStageExitCriteria: ["输出实现结果"],
    completedStageOutputs: [],
    pendingStageLabels: ["验证"],
  });
  buildTaskWorkflowViewModelMock.mockResolvedValue({
    workflow: {
      status: "running",
      currentStage: "implement",
      stages: [
        {
          stageKey: "implement",
          stageLabel: "实现",
          status: "running",
        },
      ],
    },
    roleConclusions: [],
    developerChangeRequests: [],
  });

  cpFetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/tasks/task-1") {
      return {
        ok: true,
        data: {
          id: "task-1",
          projectId: "proj-1",
          title: "trace task",
          prompt: "第一轮用户输入",
          status: "running",
          sessionId: "ses-1",
          selectedModel: "github-copilot:gpt-5.4",
          strategy: JSON.stringify({
            selectedAgent: "oracle-enterprise",
            hookExecutions: [],
          }),
        },
      };
    }
    return { ok: true, data: {} };
  });

  getSessionMessagesMock.mockResolvedValue({
    ok: true,
    data: [
      {
        info: {
          id: "msg-1",
          role: "user",
          time: { created: Date.parse("2026-03-19T10:00:00.000Z") },
        },
        parts: [
          {
            type: "text",
            text: [
              "Execution context:",
              "",
              "Opener-X task ID: task-1",
              "Project ID: proj-1",
              "当前执行上下文",
              "任务：trace task",
              "请只完成当前阶段的目标。",
              "完成后请输出本阶段产出摘要。",
              "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
              "",
              "第一轮用户输入",
            ].join("\n"),
          },
        ],
      },
      {
        info: {
          id: "msg-2",
          role: "assistant",
          time: { created: Date.parse("2026-03-19T10:00:05.000Z") },
        },
        parts: [{ type: "text", text: "第一轮模型回复" }],
      },
      {
        info: {
          id: "msg-3",
          role: "user",
          time: { created: Date.parse("2026-03-19T10:01:00.000Z") },
        },
        parts: [
          {
            type: "text",
            text: [
              "Execution context:",
              "",
              "Opener-X task ID: task-1",
              "Project ID: proj-1",
              "当前执行上下文",
              "任务：trace task",
              "请只完成当前阶段的目标。",
              "完成后请输出本阶段产出摘要。",
              "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
              "",
              "第二轮用户输入",
            ].join("\n"),
          },
        ],
      },
      {
        info: {
          id: "msg-4",
          role: "assistant",
          time: { created: Date.parse("2026-03-19T10:01:08.000Z") },
        },
        parts: [{ type: "text", text: "第二轮模型回复" }],
      },
    ],
  });
});

describe("task execution trace route", () => {
  test("converts every user and assistant turn into trace segments in chronological order", async () => {
    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/execution-trace", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.finalPrompt).toContain("第二轮用户输入");
    expect(payload.finalPrompt).toContain("当前执行上下文");
    expect(payload.latestResponse).toBe("第二轮模型回复");
    expect(payload.segments).toEqual([
      expect.objectContaining({
        type: "workflow-context",
        label: "工作流注入上下文",
      }),
      {
        type: "user-input",
        label: "用户输入",
        content: "第一轮用户输入",
        timestamp: "2026-03-19T10:00:00.000Z",
      },
      {
        type: "final-prompt",
        label: "最终 Prompt",
        content: [
          "Execution context:",
          "",
          "Opener-X task ID: task-1",
          "Project ID: proj-1",
          "当前执行上下文",
          "任务：trace task",
          "请只完成当前阶段的目标。",
          "完成后请输出本阶段产出摘要。",
          "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
          "",
          "第一轮用户输入",
        ].join("\n"),
        timestamp: "2026-03-19T10:00:00.000Z",
      },
      {
        type: "model-response",
        label: "模型回复",
        content: "第一轮模型回复",
        timestamp: "2026-03-19T10:00:05.000Z",
      },
      {
        type: "user-input",
        label: "用户输入 2",
        content: "第二轮用户输入",
        timestamp: "2026-03-19T10:01:00.000Z",
      },
      {
        type: "final-prompt",
        label: "最终 Prompt 2",
        content: [
          "Execution context:",
          "",
          "Opener-X task ID: task-1",
          "Project ID: proj-1",
          "当前执行上下文",
          "任务：trace task",
          "请只完成当前阶段的目标。",
          "完成后请输出本阶段产出摘要。",
          "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
          "",
          "第二轮用户输入",
        ].join("\n"),
        timestamp: "2026-03-19T10:01:00.000Z",
      },
      {
        type: "model-response",
        label: "模型回复 2",
        content: "第二轮模型回复",
        timestamp: "2026-03-19T10:01:08.000Z",
      },
    ]);
  });
});