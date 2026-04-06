/// <reference types="bun-types" />

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createOpencodeAdapterModuleMock,
  createRuntimeProviderModuleMock,
} from "./opencode-adapter-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

mock.restore();

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");
const createInternalAuthorizationMock = mock(async () => "Bearer internal-token");
const setControlPlaneFetchHandlerMock = mock(() => undefined);

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
  setControlPlaneFetchHandler: setControlPlaneFetchHandlerMock,
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
  DEFAULT_EXECUTION_AGENT: "builder",
  buildRuntimePlan: mock(() => ({
    templateId: "mock-template",
    mode: "single",
    steps: [],
    candidates: [{ label: "主执行", agent: "builder", status: "pending" }],
  })),
  buildJudgeStrategy: mock(() => null),
  mergeTaskStrategy: mock(() => "{}"),
  parseTaskStrategy: mock(() => ({ selectedAgent: "builder", hookExecutions: [] })),
  readOrchestrationStrategy: mock(() => ({ hooks: [], templates: [], judge: {} })),
  resolveWorkflowTemplate: mock(() => null),
}));

const opencodeAdapterModule = createOpencodeAdapterModuleMock({
  continueSession: mock(async () => ({ ok: true })),
  createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
  ensureAgentRunForSession: mock(() => "run-1"),
  extractAssistantResultFromMessages: mock(() => ({
    completed: false,
    failed: false,
    error: undefined,
    tokenUsed: 0,
  })),
  forkSession: mock(async () => ({ ok: true, sessionId: "session-2" })),
  getAgentMessages: mock(async () => ({ ok: true, data: [] })),
  getAgentRun: mock(() => undefined),
  getSessionMessages: mock(async () => ({ ok: true, data: [] })),
  injectGuidance: mock(async () => ({ ok: true })),
  listAgentRuns: mock(() => []),
  listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  pauseAgent: mock(async () => ({ ok: true })),
  recoverAgentRun: mock(() => undefined),
  registerAgentRun: mock(() => undefined),
  replyRuntimePermission: mock(async () => ({ ok: true })),
  resumeAgent: mock(async () => ({ ok: true })),
  runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "detached", text: "{}" })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
});

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter",
  () => opencodeAdapterModule,
);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider", () =>
  createRuntimeProviderModuleMock(opencodeAdapterModule),
);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
  patchAgentRunRecord: mock(async () => undefined),
  recordAgentAudit: mock(async () => undefined),
  recordModelUsage: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => []),
  getLifecycleHooksForTrigger: mock(() => []),
  mergeStageAndStrategyHooks: mock(() => []),
  parseStageHooks: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events", () => ({
  buildPipelineStageUpdatedEvents: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () =>
  createSseAggregatorModuleMock({
    registerParallelTask: mock(() => undefined),
  }),
);

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: { broadcast: mock(() => undefined) },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/reconcile", () => ({
  reconcileRunningTasksOnStartup: mock(async () => ({
    scanned: 0,
    completed: 0,
    failed: 0,
    recovered: 0,
    skipped: 0,
    runtimeAvailable: false,
  })),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution", () => ({
  buildStageArtifactSummary: mock(() => null),
  buildWorkflowExecutionPromptSnapshot: mock(async () => null),
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test-token");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal-token");
});

describe("task list snapshot routes", () => {
  test("merges task snapshots into list response", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks?projectId=proj-1") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                id: "task-1",
                projectId: "proj-1",
                userId: "user-1",
                title: "Task 1",
                prompt: "prompt-1",
                status: "running",
                sessionId: "old-session",
                result: null,
                createdAt: "2026-03-22T09:00:00.000Z",
              },
            ],
          },
        };
      }

      if (path === "/api/tasks/snapshots?projectId=proj-1&limit=200") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                taskId: "task-1",
                projectId: "proj-1",
                currentStatus: "completed",
                orchestrationKind: "parallel",
                currentRunId: "run-1",
                currentSessionId: "snapshot-session",
                latestResult: "snapshot result",
                latestResultSummary: "snapshot result",
                activeCandidateCount: 0,
                completedCandidateCount: 1,
                failedCandidateCount: 0,
                totalChainSteps: 0,
                completedChainSteps: 0,
                winnerNodeId: "node-winner-1",
                updatedAt: "2026-03-22T10:00:00.000Z",
                lastActivityAt: "2026-03-22T10:00:00.000Z",
              },
            ],
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");
    const response = await taskRoutes.request("http://localhost/?projectId=proj-1&limit=200", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual([
      expect.objectContaining({
        id: "task-1",
        status: "completed",
        orchestrationKind: "parallel",
        currentRunId: "run-1",
        sessionId: "snapshot-session",
        result: "snapshot result",
        latestResultSummary: "snapshot result",
        completedCandidateCount: 1,
        winnerNodeId: "node-winner-1",
        lastActivityAt: "2026-03-22T10:00:00.000Z",
        snapshot: expect.objectContaining({
          currentStatus: "completed",
          latestResult: "snapshot result",
        }),
      }),
    ]);
  });

  test("merges task snapshot into detail response", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            userId: "user-1",
            title: "Task 1",
            prompt: "prompt-1",
            status: "running",
            sessionId: "old-session",
            result: null,
            createdAt: "2026-03-22T09:00:00.000Z",
          },
        };
      }

      if (path === "/api/tasks/task-1/snapshot") {
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              taskId: "task-1",
              projectId: "proj-1",
              currentStatus: "failed",
              orchestrationKind: "parallel",
              currentRunId: "run-detail-1",
              currentSessionId: "snapshot-session-detail",
              latestResult: "snapshot detail result",
              latestResultSummary: "snapshot detail result",
              latestErrorText: "snapshot detail result",
              activeCandidateCount: 0,
              completedCandidateCount: 0,
              failedCandidateCount: 1,
              totalChainSteps: 0,
              completedChainSteps: 0,
              winnerNodeId: "winner-node-detail",
              updatedAt: "2026-03-22T10:05:00.000Z",
              lastActivityAt: "2026-03-22T10:05:00.000Z",
            },
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");
    const response = await taskRoutes.request("http://localhost/task-1", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      id: "task-1",
      status: "failed",
      orchestrationKind: "parallel",
      currentRunId: "run-detail-1",
      sessionId: "snapshot-session-detail",
      result: "snapshot detail result",
      latestResultSummary: "snapshot detail result",
      latestErrorText: "snapshot detail result",
      failedCandidateCount: 1,
      winnerNodeId: "winner-node-detail",
      lastActivityAt: "2026-03-22T10:05:00.000Z",
      snapshot: {
        currentStatus: "failed",
        latestResult: "snapshot detail result",
      },
    });
  });
});

afterAll(() => {
  mock.restore();
});
