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
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => []),
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
  test("does not mark completed task sessions as active", async () => {
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
          isActive: false,
          summary: { additions: 1, deletions: 0, files: 1 },
          createdAt: "2026-03-14T10:00:00.000Z",
          updatedAt: "2026-03-14T10:05:00.000Z",
        },
      ],
    });
  });
});
