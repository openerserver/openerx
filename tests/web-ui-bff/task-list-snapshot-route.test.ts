/// <reference types="bun-types" />

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "../../control-plane/web-ui-bff/node_modules/hono";
import { createRuntimeProviderModuleMock } from "./runtime-provider-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

mock.restore();

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");
const createInternalAuthorizationMock = mock(async () => "Bearer internal-token");
const setControlPlaneFetchHandlerMock = mock(() => undefined);
const wsBroadcastMock = mock(() => undefined);
const getSessionMessagesMock = mock(async () => ({ ok: true, data: [] as Array<unknown> }));
const listSessionsMock = mock(async () => ({ ok: true, data: [] as Array<unknown> }));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
  setControlPlaneFetchHandler: setControlPlaneFetchHandlerMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/intent-classifier", () => ({
  classifyIntent: mock(() => ({ category: "implementation" })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/model-config", () => ({
  diagnoseModelReadiness: mock(() => ({ ready: true })),
  formatModelRoute: mock(() => "github-copilot:gpt-5.4"),
  readDefaultExecutionModel: mock(() => "github-copilot:gpt-5.4"),
  readOpencodeJson: mock(() => ({ models: { list: [] }, provider: {} })),
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

const runtimeProviderModule = createRuntimeProviderModuleMock({
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
  getSessionMessages: getSessionMessagesMock,
  injectGuidance: mock(async () => ({ ok: true })),
  listAgentRuns: mock(() => []),
  listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
  listSessions: listSessionsMock,
  pauseAgent: mock(async () => ({ ok: true })),
  recoverAgentRun: mock(() => undefined),
  registerAgentRun: mock(() => undefined),
  replyRuntimePermission: mock(async () => ({ ok: true })),
  resumeAgent: mock(async () => ({ ok: true })),
  runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "detached", text: "{}" })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
});

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider", () =>
  runtimeProviderModule,
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
  wsBroadcaster: { broadcast: wsBroadcastMock },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution", () => ({
  buildStageArtifactSummary: mock(() => null),
  buildWorkflowExecutionPromptSnapshot: mock(async () => null),
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  wsBroadcastMock.mockReset();
  getSessionMessagesMock.mockReset();
  listSessionsMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test-token");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal-token");
  wsBroadcastMock.mockImplementation(() => undefined);
  getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });
  listSessionsMock.mockResolvedValue({ ok: true, data: [] });
});

async function createAuthedTaskRoutesApp(role: string = "platform_admin") {
  const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", {
      sub: "user-1",
      org: "org-1",
      projects: [{ id: "proj-1", role: "owner" }],
      role,
    });
    await next();
  });
  app.route("/", taskRoutes);
  return app;
}

describe("task list snapshot routes", () => {
  test("merges task snapshots into list response", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks?projectId=proj-1&limit=200") {
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
            totalCount: 1,
            limit: 200,
            truncated: false,
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
    expect(payload.totalCount).toBe(1);
    expect(payload.limit).toBe(200);
    expect(payload.truncated).toBe(false);
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

  test("proxies DELETE /:taskId to the control plane", async () => {
    cpFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ok: true, id: "task-1" },
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");
    const response = await taskRoutes.request("http://localhost/task-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, id: "task-1" });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1", {
      method: "DELETE",
      authorization: "Bearer test-token",
    });
  });

  test("broadcasts task-wide reconcile events after manual running reconcile changes task state", async () => {
    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          info: { id: "runtime-user-1", role: "user" },
          parts: [{ type: "text", text: "prompt" }],
        },
        {
          info: {
            id: "runtime-assistant-1",
            role: "assistant",
            time: { completed: "2026-03-22T10:05:00.000Z" },
          },
          parts: [{ type: "text", text: "Recovered answer" }],
        },
      ],
    });
    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === "/api/tasks/snapshots?status=running&limit=200") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                taskId: "task-1",
                currentStatus: "running",
                currentSessionId: "session-1",
                lastActivityAt: "2026-03-22T10:00:00.000Z",
              },
            ],
          },
        };
      }

      if (path === "/api/tasks/snapshots?limit=200") {
        return { ok: true, status: 200, data: { data: [] } };
      }

      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "Task 1",
            status: "running",
            sessionId: "session-1",
            agentRunId: "run-1",
            startedAt: "2026-03-22T10:00:00.000Z",
          },
        };
      }

      if (path === "/api/tasks/task-1" && options?.method === "PATCH") {
        return { ok: true, status: 200, data: { id: "task-1", status: "completed" } };
      }

      if (path === "/api/tasks/task-1/sessions" && options?.method === "POST") {
        return { ok: true, status: 200, data: { ok: true } };
      }

      if (path === "/api/tasks/task-1/sessions/messages" && options?.method === "POST") {
        return { ok: true, status: 200, data: { ok: true } };
      }

      if (path === "/api/audit" && options?.method === "POST") {
        return { ok: true, status: 200, data: { ok: true } };
      }

      return { ok: true, status: 200, data: {} };
    });

    const app = await createAuthedTaskRoutesApp();
    const response = await app.request("/reconcile-running", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: expect.objectContaining({ completed: 1, failed: 0 }),
    });
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    expect(wsBroadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.reconcile.required",
        taskId: "task-1",
        projectId: "proj-1",
        data: expect.objectContaining({ scope: "task", reason: "internal_repair" }),
      }),
    );
  });

  test("broadcasts message reconcile after manual message repair persists assistant rows", async () => {
    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          info: { id: "user-1", role: "user" },
          parts: [{ type: "text", text: "prompt" }],
        },
        {
          info: { id: "assistant-1", role: "assistant" },
          parts: [{ type: "text", text: "answer" }],
        },
      ],
    });
    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "Task 1",
            status: "running",
          },
        };
      }

      if (path === "/api/tasks/task-1/sessions") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                id: "task-session:task-1:session-1",
                runtimeSessionId: "session-1",
                executionStatus: "running",
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (path === "/api/tasks/task-1/sessions/messages" && options?.method === "POST") {
        return { ok: true, status: 200, data: { ok: true } };
      }

      if (path === "/api/audit" && options?.method === "POST") {
        return { ok: true, status: 200, data: { ok: true } };
      }

      return { ok: true, status: 200, data: {} };
    });

    const app = await createAuthedTaskRoutesApp();
    const response = await app.request("/task-1/repair-messages", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ onlyActive: true }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    expect(wsBroadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.reconcile.required",
        taskId: "task-1",
        projectId: "proj-1",
        data: expect.objectContaining({ scope: "messages", reason: "internal_repair" }),
      }),
    );
  });

  test("does not broadcast message reconcile when manual message repair produces no persisted changes", async () => {
    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          info: { id: "user-1", role: "user" },
          parts: [{ type: "text", text: "prompt" }],
        },
      ],
    });
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "Task 1",
            status: "running",
          },
        };
      }

      if (path === "/api/tasks/task-1/sessions") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                id: "task-session:task-1:session-1",
                runtimeSessionId: "session-1",
                executionStatus: "running",
                archivedAt: null,
              },
            ],
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });

    const app = await createAuthedTaskRoutesApp();
    const response = await app.request("/task-1/repair-messages", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ onlyActive: true }),
    });

    expect(response.status).toBe(200);
    expect(wsBroadcastMock).not.toHaveBeenCalled();
  });

  test("broadcasts task-wide reconcile after task projection replay proxy succeeds", async () => {
    cpFetchMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === "/api/tasks/projections/replay" && options?.method === "POST") {
        return {
          ok: true,
          status: 200,
          data: {
            scope: "task",
            reason: "rebuild task projection after storage cleanup",
            replayedTaskId: "task-1",
          },
        };
      }

      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "Task 1",
            status: "running",
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });

    const app = await createAuthedTaskRoutesApp();
    const response = await app.request("/projections/replay", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: "task",
        taskId: "task-1",
        reason: "rebuild task projection after storage cleanup",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ replayedTaskId: "task-1" });
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    expect(wsBroadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.reconcile.required",
        taskId: "task-1",
        projectId: "proj-1",
        data: expect.objectContaining({ scope: "task", reason: "projection_rebuilt" }),
      }),
    );
  });

  test("broadcasts workflow reconcile after workflow-view read migrates legacy workflow resources", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            status: "running",
          },
        };
      }

      if (path === "/api/tasks/task-1/workflow") {
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              workflowRun: null,
              stages: [],
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/role-conclusions") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [],
            meta: {
              workflowMigrated: true,
            },
          },
        };
      }

      if (path === "/api/tasks/task-1/developer-change-requests") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [],
            meta: {
              workflowMigrated: false,
            },
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });

    const app = await createAuthedTaskRoutesApp();
    const response = await app.request("/task-1/workflow-view", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    expect(wsBroadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.reconcile.required",
        taskId: "task-1",
        projectId: "proj-1",
        data: expect.objectContaining({ scope: "workflow", reason: "internal_repair" }),
      }),
    );
  });

  test("broadcasts workflow reconcile after developer change request read migrates legacy workflow resources", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            projectId: "proj-1",
            status: "running",
          },
        };
      }

      if (path === "/api/tasks/task-1/developer-change-requests") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [],
            meta: {
              workflowMigrated: true,
            },
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });

    const app = await createAuthedTaskRoutesApp();
    const response = await app.request("/task-1/developer-change-requests", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    expect(wsBroadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.reconcile.required",
        taskId: "task-1",
        projectId: "proj-1",
        data: expect.objectContaining({ scope: "workflow", reason: "internal_repair" }),
      }),
    );
  });
});

afterAll(() => {
  mock.restore();
});
