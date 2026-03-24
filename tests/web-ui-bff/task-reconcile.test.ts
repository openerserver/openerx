/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  expectNoPublicTraceRequests,
  expectSessionMessageReaderCalls,
} from "./session-message-compatibility-test-helpers";

const cpFetchMock = mock((async (..._args: unknown[]) => ({ ok: true, data: {} })) as (
  ...args: unknown[]
) => Promise<{ ok: boolean; data: unknown }>);
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const authHeaderMock = mock(() => "Bearer test");
const extractAssistantResultFromMessagesMock = mock((() => ({
  completed: false,
  failed: false,
  error: undefined as string | undefined,
  tokenUsed: 0,
})) as () => { completed: boolean; failed: boolean; error?: string; tokenUsed: number });
const getAgentRunMock = mock(() => undefined);
const findAgentRunBySessionIdMock = mock(() => undefined);
const getSessionMessagesMock = mock(async () => ({ ok: true, data: [] }));
const listSessionsMock = mock(async () => ({ ok: true, data: [{ id: "session-1" }] }));
const recoverAgentRunMock = mock(() => undefined);
const runDetachedPromptMock = mock(async () => ({
  ok: true,
  text: "judge result",
  sessionId: "judge-ses",
}));
const updateAgentRunStatusMock = mock(() => undefined);
const persistWorkflowStageExecutionOutcomeMock = mock(async () => ({
  updated: true,
  advanced: false,
}));

type FetchOptions = { method?: string; body?: unknown };
type MockFetchResponse = { ok: boolean; data: unknown; status?: number };
type MockRouteMatcher = string | RegExp | ((url: string) => boolean);
type MockRouteHandler = {
  matcher: MockRouteMatcher;
  method?: string;
  response:
    | MockFetchResponse
    | ((
        options: FetchOptions | undefined,
        url: string,
      ) => MockFetchResponse | Promise<MockFetchResponse>);
};

function matchesMockRoute(matcher: MockRouteMatcher, url: string) {
  if (typeof matcher === "string") {
    return matcher === url;
  }

  if (matcher instanceof RegExp) {
    return matcher.test(url);
  }

  return matcher(url);
}

function mockCpFetchRoutes(handlers: MockRouteHandler[]) {
  cpFetchMock.mockImplementation(async (...args: unknown[]) => {
    const [url, options] = args as [string, FetchOptions | undefined];
    const matchedHandler = handlers.find(
      (handler) =>
        matchesMockRoute(handler.matcher, url) &&
        (handler.method ?? undefined) === (options?.method ?? undefined),
    );

    if (!matchedHandler) {
      return { ok: true, data: { body: options?.body } };
    }

    return typeof matchedHandler.response === "function"
      ? await matchedHandler.response(options, url)
      : matchedHandler.response;
  });
}

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
  extractAssistantResultFromMessages: extractAssistantResultFromMessagesMock,
  findAgentRunBySessionId: findAgentRunBySessionIdMock,
  getAgentRun: getAgentRunMock,
  getSessionMessages: getSessionMessagesMock,
  listSessions: listSessionsMock,
  recoverAgentRun: recoverAgentRunMock,
  runDetachedPrompt: runDetachedPromptMock,
  updateAgentRunStatus: updateAgentRunStatusMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution", () => ({
  persistWorkflowStageExecutionOutcome: persistWorkflowStageExecutionOutcomeMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  authHeaderMock.mockReset();
  extractAssistantResultFromMessagesMock.mockReset();
  getAgentRunMock.mockReset();
  findAgentRunBySessionIdMock.mockReset();
  getSessionMessagesMock.mockReset();
  listSessionsMock.mockReset();
  recoverAgentRunMock.mockReset();
  runDetachedPromptMock.mockReset();
  updateAgentRunStatusMock.mockReset();
  persistWorkflowStageExecutionOutcomeMock.mockReset();

  createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  authHeaderMock.mockReturnValue("Bearer test");
  listSessionsMock.mockResolvedValue({ ok: true, data: [{ id: "session-1" }] });
  getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });
  getAgentRunMock.mockReturnValue(undefined);
  findAgentRunBySessionIdMock.mockReturnValue(undefined);
  recoverAgentRunMock.mockReturnValue(undefined);
  runDetachedPromptMock.mockResolvedValue({
    ok: true,
    text: "judge result",
    sessionId: "judge-ses",
  });
  updateAgentRunStatusMock.mockImplementation(() => undefined);
  persistWorkflowStageExecutionOutcomeMock.mockResolvedValue({
    updated: true,
    advanced: false,
  });
  extractAssistantResultFromMessagesMock.mockReturnValue({
    completed: false,
    failed: true,
    error: "The operation was aborted.",
    tokenUsed: 0,
  });

  cpFetchMock.mockImplementation(async (...args: unknown[]) => {
    const [url, options] = args as [string, { method?: string; body?: unknown }?];
    if (!options?.method) {
      if (url.includes("/api/tasks/snapshots?status=running")) {
        return {
          ok: true,
          data: {
            data: [
              {
                taskId: "task-1",
                currentStatus: "running",
                currentSessionId: "session-1",
                lastActivityAt: "2026-03-13T12:56:03.000Z",
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/snapshots?limit=200") {
        return {
          ok: true,
          data: {
            data: [
              {
                taskId: "task-1",
                currentStatus: "running",
                currentSessionId: "session-1",
                lastActivityAt: "2026-03-13T12:56:03.000Z",
              },
            ],
          },
        };
      }

      if (url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "Stuck task",
            status: "running",
            sessionId: "session-1",
            agentRunId: "run-1",
            startedAt: "2026-03-13T12:56:03.000Z",
          },
        };
      }

      if (url === "/api/tasks/task-1/branches") {
        return {
          ok: true,
          data: {
            data: [
              {
                runtimeSessionId: "session-1",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        };
      }
    }

    return { ok: true, data: { body: options?.body } };
  });
});

describe("reconcileRunningTasksOnStartup", () => {
  test("marks tasks failed when assistant messages contain embedded runtime errors", async () => {
    const { reconcileRunningTasksOnStartup } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/reconcile"
    );

    const summary = await reconcileRunningTasksOnStartup();

    expect(summary.failed).toBe(1);
    expect(summary.completed).toBe(0);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          status: "failed",
          result: "Recovered from failed assistant session: The operation was aborted.",
        }),
      }),
    );
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/branches",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          runtimeSessionId: "session-1",
          isActive: false,
        }),
      }),
    );
  });

  test("marks single-candidate plans completed and closes active sessions during reconcile", async () => {
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: true,
      failed: false,
      error: undefined,
      tokenUsed: 42,
      text: "Final answer",
    });

    const { reconcileRunningTasksOnStartup } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/reconcile"
    );

    const summary = await reconcileRunningTasksOnStartup();

    expect(summary.completed).toBe(1);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          status: "completed",
          result: "Final answer",
        }),
      }),
    );
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/branches",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          runtimeSessionId: "session-1",
          isActive: false,
        }),
      }),
    );
  });

  test("does not rewrite legacy runtime plan for projection-backed completed single tasks", async () => {
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: true,
      failed: false,
      error: undefined,
      tokenUsed: 42,
      text: "Final answer",
    });

    mockCpFetchRoutes([
      {
        matcher: (url) => url.includes("/api/tasks/snapshots?status=running"),
        response: {
          ok: true,
          data: {
            data: [
              {
                taskId: "task-1",
                currentStatus: "running",
                orchestrationKind: "single",
                currentRunId: "task_run:task-1:session-1",
                currentSessionId: "session-1",
                lastActivityAt: "2026-03-13T12:56:03.000Z",
              },
            ],
          },
        },
      },
      {
        matcher: "/api/tasks/snapshots?limit=200",
        response: {
          ok: true,
          data: {
            data: [
              {
                taskId: "task-1",
                currentStatus: "running",
                orchestrationKind: "single",
                currentRunId: "task_run:task-1:session-1",
                currentSessionId: "session-1",
                lastActivityAt: "2026-03-13T12:56:03.000Z",
              },
            ],
          },
        },
      },
      {
        matcher: "/api/project-tree/tasks/task-1",
        response: {
          ok: true,
          data: {
            id: "task-1",
            projectId: "proj-1",
            title: "Projection-backed task",
            status: "running",
            sessionId: "session-1",
            agentRunId: "run-1",
            startedAt: "2026-03-13T12:56:03.000Z",
          },
        },
      },
      {
        matcher: "/api/tasks/task-1/branches",
        response: {
          ok: true,
          data: {
            data: [
              {
                runtimeSessionId: "session-1",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        },
      },
    ]);

    const { reconcileRunningTasksOnStartup } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/reconcile"
    );

    const summary = await reconcileRunningTasksOnStartup();

    expect(summary.completed).toBe(1);
    const patchCall = (
      cpFetchMock.mock.calls as unknown as Array<[string, { method?: string; body?: unknown }]>
    ).find(([url, options]) => url === "/api/tasks/task-1" && options?.method === "PATCH");
    const patchBody = patchCall?.[1]?.body as Record<string, unknown> | undefined;
    expect(patchBody.status).toBe("completed");
    expect(patchBody.result).toBe("Final answer");
    expect(patchBody).not.toHaveProperty("executionPlan");
  });

  test("repairs recently completed tasks with active sessions using the latest assistant output", async () => {
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: true,
      failed: false,
      error: undefined,
      tokenUsed: 12,
      text: "Verify stage complete\n[STAGE_COMPLETE]",
    });

    const recentFinishedAt = new Date().toISOString();

    mockCpFetchRoutes([
      {
        matcher: (url) => url.includes("/api/tasks/snapshots?status=running"),
        response: { ok: true, data: { data: [] } },
      },
      {
        matcher: "/api/tasks/snapshots?limit=200",
        response: {
          ok: true,
          data: {
            data: [
              {
                taskId: "task-completed-active",
                currentStatus: "completed",
                currentSessionId: "session-completed-active",
                latestResult: "Old result",
                lastActivityAt: recentFinishedAt,
              },
            ],
          },
        },
      },
      {
        matcher: "/api/project-tree/tasks/task-completed-active",
        response: {
          ok: true,
          data: {
            id: "task-completed-active",
            projectId: "proj-1",
            title: "Completed but active session",
            status: "completed",
            sessionId: "session-completed-active",
            agentRunId: "run-completed-active",
            result: "Old result",
            finishedAt: recentFinishedAt,
          },
        },
      },
      {
        matcher: "/api/tasks/task-completed-active/branches",
        response: {
          ok: true,
          data: {
            data: [
              {
                runtimeSessionId: "session-completed-active",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        },
      },
    ]);

    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [{ id: "msg-1" }],
    });

    const { reconcileRunningTasksOnStartup } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/reconcile"
    );

    const summary = await reconcileRunningTasksOnStartup();

    expect(summary.completed).toBe(1);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-completed-active",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          status: "completed",
          result: "Verify stage complete\n[STAGE_COMPLETE]",
        }),
      }),
    );
    expect(persistWorkflowStageExecutionOutcomeMock).toHaveBeenCalledWith({
      taskId: "task-completed-active",
      authorization: "Bearer internal",
      resultText: "Verify stage complete\n[STAGE_COMPLETE]",
      source: "assistant-output",
    });
    expectSessionMessageReaderCalls(getSessionMessagesMock, ["session-completed-active"]);
    expectNoPublicTraceRequests(cpFetchMock.mock.calls.map(([url]) => String(url)));
  });

  test("marks stale parallel tasks completed after all candidate sessions already finished", async () => {
    extractAssistantResultFromMessagesMock
      .mockReturnValueOnce({
        completed: true,
        failed: false,
        error: undefined,
        tokenUsed: 8,
        text: "候选 A 已完成",
      })
      .mockReturnValueOnce({
        completed: true,
        failed: false,
        error: undefined,
        tokenUsed: 9,
        text: "候选 B 已完成",
      });

    getSessionMessagesMock
      .mockResolvedValueOnce({ ok: true, data: [{ id: "msg-a" }] })
      .mockResolvedValueOnce({ ok: true, data: [{ id: "msg-b" }] });

    mockCpFetchRoutes([
      {
        matcher: (url) => url.includes("/api/tasks/snapshots?status=running"),
        response: {
          ok: true,
          data: {
            data: [
              {
                taskId: "task-parallel-stale",
                currentStatus: "running",
                lastActivityAt: "2026-03-13T12:56:03.000Z",
              },
            ],
          },
        },
      },
      {
        matcher: "/api/tasks/snapshots?limit=200",
        response: { ok: true, data: { data: [] } },
      },
      {
        matcher: "/api/project-tree/tasks/task-parallel-stale",
        response: {
          ok: true,
          data: {
            id: "task-parallel-stale",
            projectId: "proj-1",
            title: "Parallel stale task",
            status: "running",
            orchestrationKind: "parallel",
            currentRunId: "task_run:task-parallel-stale:root",
            createdAt: "2026-03-13T12:56:03.000Z",
            startedAt: "2026-03-13T12:56:03.000Z",
          },
        },
      },
      {
        matcher: "/api/tasks/task-parallel-stale/branches",
        response: {
          ok: true,
          data: {
            data: [
              {
                runtimeSessionId: "session-a",
                isActive: true,
                archivedAt: null,
              },
              {
                runtimeSessionId: "session-b",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        },
      },
      {
        matcher: (url) => url.startsWith("/api/tasks/task-parallel-stale/domain-runs/"),
        response: {
          ok: true,
          data: {
            data: {
              candidateNodes: [
                {
                  candidateIndex: 0,
                  sessionId: "session-a",
                  status: "running",
                },
                {
                  candidateIndex: 1,
                  sessionId: "session-b",
                  status: "running",
                },
              ],
            },
          },
        },
      },
    ]);

    const { reconcileRunningTasksOnStartup } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/reconcile"
    );

    const summary = await reconcileRunningTasksOnStartup();

    expect(summary.completed).toBe(1);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-parallel-stale",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          status: "completed",
        }),
      }),
    );
    const patchCall = (
      cpFetchMock.mock.calls as unknown as Array<[string, { method?: string; body?: unknown }]>
    ).find(
      ([url, options]) => url === "/api/tasks/task-parallel-stale" && options?.method === "PATCH",
    );
    const patchBody = patchCall?.[1]?.body as {
      status?: string;
    };
    expect(patchBody.status).toBe("completed");
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-parallel-stale/branches",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ runtimeSessionId: "session-a", isActive: false }),
      }),
    );
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-parallel-stale/branches",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ runtimeSessionId: "session-b", isActive: false }),
      }),
    );
    expect(persistWorkflowStageExecutionOutcomeMock).not.toHaveBeenCalled();
    expectSessionMessageReaderCalls(getSessionMessagesMock, ["session-a", "session-b"]);
    expectNoPublicTraceRequests(cpFetchMock.mock.calls.map(([url]) => String(url)));
  });

  test("does not rewrite legacy runtime plan for projection-backed stale parallel tasks", async () => {
    extractAssistantResultFromMessagesMock
      .mockReturnValueOnce({
        completed: true,
        failed: false,
        error: undefined,
        tokenUsed: 8,
        text: "候选 A 已完成",
      })
      .mockReturnValueOnce({
        completed: true,
        failed: false,
        error: undefined,
        tokenUsed: 9,
        text: "候选 B 已完成",
      });

    getSessionMessagesMock
      .mockResolvedValueOnce({ ok: true, data: [{ id: "msg-a" }] })
      .mockResolvedValueOnce({ ok: true, data: [{ id: "msg-b" }] });

    mockCpFetchRoutes([
      {
        matcher: (url) => url.includes("/api/tasks/snapshots?status=running"),
        response: {
          ok: true,
          data: {
            data: [
              {
                taskId: "task-parallel-projection",
                currentStatus: "running",
                orchestrationKind: "parallel",
                currentRunId: "task_run:task-parallel-projection:root",
                lastActivityAt: "2026-03-13T12:56:03.000Z",
              },
            ],
          },
        },
      },
      {
        matcher: "/api/tasks/snapshots?limit=200",
        response: { ok: true, data: { data: [] } },
      },
      {
        matcher: "/api/project-tree/tasks/task-parallel-projection",
        response: {
          ok: true,
          data: {
            id: "task-parallel-projection",
            projectId: "proj-1",
            title: "Projection parallel task",
            status: "running",
            orchestrationKind: "parallel",
            currentRunId: "task_run:task-parallel-projection:root",
            createdAt: "2026-03-13T12:56:03.000Z",
            startedAt: "2026-03-13T12:56:03.000Z",
          },
        },
      },
      {
        matcher: "/api/tasks/task-parallel-projection/branches",
        response: {
          ok: true,
          data: {
            data: [
              {
                runtimeSessionId: "session-a",
                isActive: true,
                archivedAt: null,
              },
              {
                runtimeSessionId: "session-b",
                isActive: true,
                archivedAt: null,
              },
            ],
          },
        },
      },
      {
        matcher: (url) => url.startsWith("/api/tasks/task-parallel-projection/domain-runs/"),
        response: {
          ok: true,
          data: {
            data: {
              candidateNodes: [
                {
                  candidateIndex: 0,
                  sessionId: "session-a",
                  status: "running",
                },
                {
                  candidateIndex: 1,
                  sessionId: "session-b",
                  status: "running",
                },
              ],
            },
          },
        },
      },
    ]);

    const { reconcileRunningTasksOnStartup } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/reconcile"
    );

    const summary = await reconcileRunningTasksOnStartup();

    expect(summary.completed).toBe(1);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-parallel-projection",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          status: "completed",
        }),
      }),
    );
    expectSessionMessageReaderCalls(getSessionMessagesMock, ["session-a", "session-b"]);
    expectNoPublicTraceRequests(cpFetchMock.mock.calls.map(([url]) => String(url)));
  });
});
