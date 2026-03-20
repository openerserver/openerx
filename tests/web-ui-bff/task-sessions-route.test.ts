/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
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
  getSessionMessages: getSessionMessagesMock,
  listSessions: listSessionsMock,
  recoverAgentRun: mock(() => undefined),
  getAgentMessages: mock(async () => ({ ok: true, data: [] })),
  injectGuidance: mock(async () => ({ ok: true })),
  findAgentRunBySessionId: mock(() => undefined),
  listAgentRuns: mock(() => []),
  pauseAgent: mock(async () => ({ ok: true })),
  registerAgentRun: mock(() => undefined),
  resumeAgent: mock(async () => ({ ok: true })),
  runDetachedPrompt: mock(async () => ({ ok: true, data: {} })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => []),
  mergeStageAndStrategyHooks: mock((_stageHooks: unknown, strategyHooks: unknown) => strategyHooks ?? []),
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
    if (url === "/api/tasks/task-1") {
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

    const response = await taskRoutes.request("http://localhost/task-1/sessions", {
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

  test("includeLineage returns merged root and branch messages for selected session", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-1/task-sessions") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                taskId: "task-1",
                runtimeSessionId: "session-root",
                parentRuntimeSessionId: null,
                forkedFromMessageId: null,
                branchName: "root",
                sourceType: "root",
                isActive: false,
                createdAt: "2026-03-14T10:00:00.000Z",
                updatedAt: "2026-03-14T10:00:00.000Z",
                archivedAt: null,
              },
              {
                id: "ts-leaf",
                taskId: "task-1",
                runtimeSessionId: "session-leaf",
                parentRuntimeSessionId: "session-root",
                forkedFromMessageId: null,
                branchName: "leaf",
                sourceType: "fork",
                isActive: true,
                createdAt: "2026-03-14T10:01:00.000Z",
                updatedAt: "2026-03-14T10:01:00.000Z",
                archivedAt: null,
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            title: "finished task",
            status: "completed",
            sessionId: "session-leaf",
          },
        };
      }

      return { ok: true, data: {} };
    });

    getSessionMessagesMock.mockImplementation(async (sessionId: string) => {
      if (sessionId === "session-root") {
        return {
          ok: true,
          data: [
            { info: { id: "root-user", role: "user" }, parts: [{ type: "text", text: "历史提问" }] },
            { info: { id: "root-assistant", role: "assistant" }, parts: [{ type: "text", text: "历史回答" }] },
          ],
        };
      }

      if (sessionId === "session-leaf") {
        return {
          ok: true,
          data: [
            { info: { id: "leaf-user", role: "user" }, parts: [{ type: "text", text: "当前提问" }] },
            { info: { id: "leaf-assistant", role: "assistant" }, parts: [{ type: "text", text: "当前回答" }] },
          ],
        };
      }

      return { ok: true, data: [] };
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request(
      "http://localhost/task-1/sessions/session-leaf/messages?includeLineage=true",
      {
        headers: {
          Authorization: "Bearer test",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        { info: { id: "root-user", role: "user" }, parts: [{ type: "text", text: "历史提问" }] },
        { info: { id: "root-assistant", role: "assistant" }, parts: [{ type: "text", text: "历史回答" }] },
        { info: { id: "leaf-user", role: "user" }, parts: [{ type: "text", text: "当前提问" }] },
        { info: { id: "leaf-assistant", role: "assistant" }, parts: [{ type: "text", text: "当前回答" }] },
      ],
    });
  });

  test("session messages remain leaf-only when includeLineage is absent", async () => {
    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        { info: { id: "leaf-user", role: "user" }, parts: [{ type: "text", text: "当前提问" }] },
        { info: { id: "leaf-assistant", role: "assistant" }, parts: [{ type: "text", text: "当前回答" }] },
      ],
    });

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");

    const response = await taskRoutes.request("http://localhost/task-1/sessions/session-leaf/messages", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        { info: { id: "leaf-user", role: "user" }, parts: [{ type: "text", text: "当前提问" }] },
        { info: { id: "leaf-assistant", role: "assistant" }, parts: [{ type: "text", text: "当前回答" }] },
      ],
    });
  });
});
