/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createOpencodeAdapterModuleMock } from "./opencode-adapter-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const setControlPlaneFetchHandlerMock = mock(() => undefined);
const listSessionsMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));
const getSessionMessagesMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
  setControlPlaneFetchHandler: setControlPlaneFetchHandlerMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () =>
  createOpencodeAdapterModuleMock({
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
    getSessionMessages: getSessionMessagesMock,
    listSessions: listSessionsMock,
    recoverAgentRun: mock(() => undefined),
    getAgentMessages: mock(async () => ({ ok: true, data: [] })),
    injectGuidance: mock(async () => ({ ok: true })),
    findAgentRunBySessionId: mock(() => undefined),
    listAgentRuns: mock(() => []),
    listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
    pauseAgent: mock(async () => ({ ok: true })),
    registerAgentRun: mock(() => undefined),
    replyRuntimePermission: mock(async () => ({ ok: true })),
    resumeAgent: mock(async () => ({ ok: true })),
    runDetachedPrompt: mock(async () => ({ ok: true, data: {} })),
    terminateAgent: mock(async () => ({ ok: true })),
    updateAgentRunStatus: mock(() => undefined),
  }),
);

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => []),
  mergeStageAndStrategyHooks: mock(
    (_stageHooks: unknown, strategyHooks: unknown) => strategyHooks ?? [],
  ),
  parseStageHooks: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
  recordAgentAudit: mock(async () => undefined),
  recordModelUsage: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/dag-sync", () => ({
  syncGraphsForSessionTask: mock(async () => undefined),
  syncGraphsForTask: mock(async () => undefined),
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
  wsBroadcaster: {
    broadcast: mock(() => undefined),
  },
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  listSessionsMock.mockReset();
  getSessionMessagesMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  listSessionsMock.mockResolvedValue({
    ok: true,
    data: [
      {
        id: "session-1",
        title: "[Task task-1] finished session",
        summary: { additions: 1, deletions: 0, files: 1 },
        time: {
          created: Date.parse("2026-03-14T10:00:00.000Z"),
          updated: Date.parse("2026-03-14T10:05:00.000Z"),
        },
      },
    ],
  });
  getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });

  cpFetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/project-tree/tasks/task-1") {
      return {
        ok: true,
        data: {
          id: "task-1",
          title: "finished task",
          status: "completed",
          sessionId: "session-1",
        },
      };
    }
    return { ok: true, data: {} };
  });
});

describe("task sessions route", () => {
  test("marks the task session as active when it matches the persisted sessionId", async () => {
    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/branches", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "session-1",
          title: "[Task task-1] finished session",
          isActive: true,
          summary: { additions: 1, deletions: 0, files: 1 },
          createdAt: "2026-03-14T10:00:00.000Z",
          updatedAt: "2026-03-14T10:05:00.000Z",
        },
      ],
    });
  });

  test("activates task session by runtime session id via lineage record", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/tasks/task-1/branches" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                branchName: "main",
                isActive: true,
                archivedAt: null,
              },
              {
                id: "ts-leaf",
                runtimeSessionId: "session-leaf",
                branchName: "branch-leaf",
                isActive: false,
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/branches/ts-leaf/activate" && options?.method === "POST") {
        return { ok: true, data: { ok: true } };
      }

      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            title: "finished task",
            status: "completed",
            sessionId: "session-root",
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/branches/session-leaf/activate",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, sessionId: "session-leaf" });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/branches/ts-leaf/activate", {
      method: "POST",
      authorization: "Bearer test",
    });
  });

  test("archives task session by runtime session id via lineage record", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/tasks/task-1/branches" && !options?.method) {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                branchName: "main",
                isActive: true,
                archivedAt: null,
              },
              {
                id: "ts-leaf",
                runtimeSessionId: "session-leaf",
                branchName: "branch-leaf",
                isActive: false,
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/branches/ts-leaf/archive" && options?.method === "POST") {
        return { ok: true, data: { ok: true } };
      }

      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            title: "finished task",
            status: "completed",
            sessionId: "session-root",
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/branches/session-leaf/archive",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/branches/ts-leaf/archive", {
      method: "POST",
      authorization: "Bearer test",
    });
  });

  test("forks task branch via branch route", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "project-1",
            title: "finished task",
            status: "completed",
            sessionId: "session-root",
          },
        };
      }

      if (url === "/api/tasks/task-1/branches") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "session-root",
                branchName: "main",
                sourceType: "root",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/branches/upsert-lineage") {
        return {
          ok: true,
          data: {
            data: {
              id: "ts-branch",
              runtimeSessionId: "session-2",
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/branches/session-root/fork",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "新分支", messageId: "msg-1" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      sessionId: "session-2",
      title: "新分支",
      parentSessionId: "session-root",
      forkedFromMessageId: "msg-1",
    });
  });
});
