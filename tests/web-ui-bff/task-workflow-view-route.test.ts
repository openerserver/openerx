/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
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
  getAgentRun: mock(() => undefined),
  getSessionMessages: mock(async () => ({ ok: true, data: [] })),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  recoverAgentRun: mock(() => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => ({
    hookExecutions: [],
    combinedResultText: undefined,
    rewrittenPrompt: undefined,
  })),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/dag-sync", () => ({
  syncGraphsForSessionTask: mock(async () => undefined),
  syncGraphsForTask: mock(async () => undefined),
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

describe("task workflow view route", () => {
  beforeEach(() => {
    cpFetchMock.mockReset();
    authHeaderMock.mockReset();
    createInternalAuthorizationMock.mockReset();

    authHeaderMock.mockReturnValue("Bearer test");
    createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  });

  test("falls back to completed task status when workflow run is missing", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "project-1",
            status: "completed",
          },
        };
      }

      if (url === "/api/tasks/task-1/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: null,
              stages: [],
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/role-conclusions") {
        return { ok: true, data: { data: [] } };
      }

      if (url === "/api/tasks/task-1/developer-change-requests") {
        return { ok: true, data: { data: [] } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-workflow-view-route-completed"
    );

    const response = await taskRoutes.request("http://localhost/task-1/workflow-view", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      taskId: "task-1",
      workflow: {
        currentStage: "done",
        status: "completed",
        stages: [],
      },
      roleConclusions: [],
      developerChangeRequests: [],
    });
  });

  test("falls back to failed task status when workflow run is missing", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-2") {
        return {
          ok: true,
          data: {
            id: "task-2",
            projectId: "project-1",
            status: "failed",
          },
        };
      }

      if (url === "/api/tasks/task-2/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: null,
              stages: [],
            },
          },
        };
      }

      if (url === "/api/tasks/task-2/role-conclusions") {
        return { ok: true, data: { data: [] } };
      }

      if (url === "/api/tasks/task-2/developer-change-requests") {
        return { ok: true, data: { data: [] } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-workflow-view-route-failed"
    );

    const response = await taskRoutes.request("http://localhost/task-2/workflow-view", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      taskId: "task-2",
      workflow: {
        currentStage: "unknown",
        status: "failed",
        stages: [],
      },
      roleConclusions: [],
      developerChangeRequests: [],
    });
  });
});