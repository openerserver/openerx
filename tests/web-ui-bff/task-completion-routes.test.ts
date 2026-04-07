/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createRuntimeProviderModuleMock } from "./runtime-provider-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const extractAssistantResultFromMessagesMock = mock(() => ({
  completed: false,
  failed: false,
  error: undefined,
  text: undefined,
  tokenUsed: 0,
}));
const getSessionMessagesMock = mock(async () => ({ ok: true, data: [] }));
const terminateAgentMock = mock(async () => ({ ok: true }));
const buildStageArtifactSummaryMock = mock((resultText?: string) => ({
  summary: resultText ? resultText.replace(/\n\[STAGE_COMPLETE\]$/, "") : "",
  excerpt: resultText ?? "",
  completionMarked: typeof resultText === "string" && resultText.includes("[STAGE_COMPLETE]"),
  capturedAt: "2026-03-19T10:00:00.000Z",
  source: "assistant-output",
}));
const wsBroadcastMock = mock(() => undefined);

function buildRuntimeProviderMock() {
  return createRuntimeProviderModuleMock({
    buildExecutionContext: mock(() => ""),
    continueSession: mock(async () => ({ ok: true })),
    createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
    ensureAgentRunForSession: mock(() => "run-1"),
    extractAssistantResultFromMessages: extractAssistantResultFromMessagesMock,
    findAgentRunBySessionId: mock(() => undefined),
    forkSession: mock(async () => ({ ok: true, sessionId: "session-2" })),
    getAgentMessages: mock(async () => ({ ok: true, data: [] })),
    getAgentRun: mock(() => undefined),
    getSessionMessages: getSessionMessagesMock,
    injectGuidance: mock(async () => ({ ok: true })),
    listAgentRuns: mock(() => []),
    listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
    listSessions: mock(async () => ({ ok: true, data: [] })),
    pauseAgent: mock(async () => ({ ok: true })),
    recoverAgentRun: mock(() => undefined),
    registerAgentRun: mock(() => undefined),
    replyRuntimePermission: mock(async () => ({ ok: true })),
    resumeAgent: mock(async () => ({ ok: true })),
    runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "session-detached", text: "{}" })),
    terminateAgent: terminateAgentMock,
    updateAgentRunStatus: mock(() => undefined),
  });
}

type RouteFetchOptions = { method?: string; body?: unknown; authorization?: string };

type MockRouteResponse = { ok: boolean; data: unknown };
type MockRouteHandler = {
  url: string;
  method?: string;
  response:
    | MockRouteResponse
    | ((options: RouteFetchOptions | undefined) => MockRouteResponse | Promise<MockRouteResponse>);
};

function mockCpFetchRoutes(handlers: MockRouteHandler[]) {
  cpFetchMock.mockImplementation(async (...args: unknown[]) => {
    const [url, options] = args as [string, RouteFetchOptions | undefined];
    const matchedHandler = handlers.find(
      (handler) =>
        handler.url === url && (handler.method ?? undefined) === (options?.method ?? undefined),
    );

    if (!matchedHandler) {
      return { ok: true, data: {} };
    }

    return typeof matchedHandler.response === "function"
      ? await matchedHandler.response(options)
      : matchedHandler.response;
  });
}

async function loadTaskRoutes() {
  return import("../../control-plane/web-ui-bff/src/modules/tasks/routes");
}

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider",
  buildRuntimeProviderMock,
);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: mock(async () => undefined),
  patchAgentRunRecord: mock(async () => undefined),
  recordAgentAudit: mock(async () => undefined),
  recordModelUsage: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => ({
    hookExecutions: [],
    combinedResultText: undefined,
    rewrittenPrompt: undefined,
  })),
  mergeStageAndStrategyHooks: (_stage: unknown[], strategy: unknown[]) => strategy ?? [],
  parseStageHooks: (raw: unknown) => (Array.isArray(raw) ? raw : []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events", () => ({
  buildPipelineStageUpdatedEvents: mock(() => []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () =>
  createSseAggregatorModuleMock({
    registerParallelTask: mock(() => undefined),
    registerSequentialChainTask: mock(() => undefined),
  }),
);

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: {
    broadcast: wsBroadcastMock,
  },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/workflow-stage-execution", () => ({
  buildStageArtifactSummary: buildStageArtifactSummaryMock,
  buildWorkflowExecutionPromptSnapshot: mock(async () => null),
}));

describe("task completion routes", () => {
  beforeEach(() => {
    cpFetchMock.mockReset();
    authHeaderMock.mockReset();
    createInternalAuthorizationMock.mockReset();
    extractAssistantResultFromMessagesMock.mockReset();
    getSessionMessagesMock.mockReset();
    terminateAgentMock.mockReset();
    buildStageArtifactSummaryMock.mockClear();
    wsBroadcastMock.mockReset();

    authHeaderMock.mockReturnValue("Bearer test");
    createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: false,
      failed: false,
      error: undefined,
      text: undefined,
      tokenUsed: 0,
    });
    getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });
    terminateAgentMock.mockResolvedValue({ ok: true });
  });

  test("POST /:taskId/complete marks the task completed without advancing workflow state", async () => {
    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-1",
        response: {
          ok: true,
          data: {
            id: "task-1",
            title: "Clarify task",
            projectId: "proj-1",
            prompt: "Clarify scope",
            status: "running",
            result: "范围已确认。\n[STAGE_COMPLETE]",
          },
        },
      },
      {
        url: "/api/tasks/task-1",
        method: "PATCH",
        response: (options) => ({ ok: true, data: { ok: true, body: options?.body } }),
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();

    const response = await taskRoutes.request("http://localhost/task-1/complete", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1", {
      method: "PATCH",
      authorization: "Bearer test",
      body: { status: "completed" },
    });
    const cpFetchCalls = cpFetchMock.mock.calls as unknown as Array<
      [string, RouteFetchOptions | undefined]
    >;
    expect(
      cpFetchCalls.some(
        ([path, options]) =>
          path === "/api/tasks/task-1/workflow/advance" && options?.method === "POST",
      ),
    ).toBe(false);
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    const broadcastCalls = wsBroadcastMock.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const broadcastEvent = broadcastCalls[0]?.[0];
    expect(broadcastEvent).toMatchObject({
      type: "task.completed",
      taskId: "task-1",
      projectId: "proj-1",
      data: {
        status: "completed",
        explicitCompletion: true,
        result: "范围已确认。\n[STAGE_COMPLETE]",
      },
    });
  });

  test("POST /:taskId/complete returns 404 when task does not exist", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-missing") {
        return { ok: false, status: 404, data: { error: "Task not found" } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-missing/complete", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Task not found" });
  });

  test("POST /:taskId/workflow/advance is no longer exposed", async () => {
    const { taskRoutes } = await loadTaskRoutes();

    const response = await taskRoutes.request("http://localhost/task-1/workflow/advance", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("404 Not Found");
  });

  test("GET /:taskId/domain-runs returns an empty list when the upstream route is unavailable", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/tasks/task-domain-runs-404/domain-runs") {
        return { ok: false, status: 404, data: { error: "Not found" } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-domain-runs-404/domain-runs", {
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
  });

  test("POST /:taskId/candidates/:index/adopt completes session-first winner adoption", async () => {
    getSessionMessagesMock.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: "msg-1",
          info: {
            role: "assistant",
            created: Date.parse("2026-03-19T10:00:10.000Z"),
            completed: Date.parse("2026-03-19T10:00:12.000Z"),
          },
          parts: [{ type: "text", text: "候选 A 结果" }],
        },
      ],
    } as never);
    extractAssistantResultFromMessagesMock.mockReturnValueOnce({
      text: "候选 A 结果",
      completed: true,
      failed: false,
      error: undefined,
      tokenUsed: 0,
    });

    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-adopt-1",
        response: {
          ok: true,
          data: {
            id: "task-adopt-1",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            orchestrationKind: "parallel",
            sessionId: "root-session",
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-1/sessions",
        response: {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-adopt-1:root-session",
                taskId: "task-adopt-1",
                runtimeSessionId: "root-session",
                parentRuntimeSessionId: null,
                branchName: "main",
                sourceType: "root",
                isActive: true,
                createdAt: "2026-03-19T10:00:00.000Z",
                updatedAt: "2026-03-19T10:00:00.000Z",
                archivedAt: null,
              },
              {
                id: "task-session:task-adopt-1:session-a",
                taskId: "task-adopt-1",
                runtimeSessionId: "session-a",
                parentRuntimeSessionId: "root-session",
                branchName: "Candidate 1",
                sourceType: "fork",
                isActive: false,
                createdAt: "2026-03-19T10:00:01.000Z",
                updatedAt: "2026-03-19T10:00:12.000Z",
                archivedAt: null,
              },
              {
                id: "task-session:task-adopt-1:session-b",
                taskId: "task-adopt-1",
                runtimeSessionId: "session-b",
                parentRuntimeSessionId: "root-session",
                branchName: "Candidate 2",
                sourceType: "fork",
                isActive: false,
                createdAt: "2026-03-19T10:00:02.000Z",
                updatedAt: "2026-03-19T10:00:09.000Z",
                archivedAt: null,
              },
            ],
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-1/domain-runs",
        response: {
          ok: true,
          data: {
            data: [
              {
                id: "parallel-run-1",
                orchestrationKind: "parallel",
              },
            ],
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-1/domain-runs/parallel-run-1",
        response: {
          ok: true,
          data: {
            data: {
              run: {
                id: "parallel-run-1",
                orchestrationKind: "parallel",
              },
              nodes: [],
              candidateNodes: [
                {
                  id: "candidate-a",
                  nodeKind: "candidate",
                  candidateIndex: 0,
                  sessionId: "session-a",
                  status: "completed",
                  resultText: "候选 A 结果",
                },
                {
                  id: "candidate-b",
                  nodeKind: "candidate",
                  candidateIndex: 1,
                  sessionId: "session-b",
                  agentRunId: "agent-run-2",
                  status: "running",
                },
              ],
              judgeNode: null,
              winnerCandidateIndex: null,
            },
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-1/domain-runs/parallel-run-1/candidates/0/adopt",
        method: "POST",
        response: (options) => ({ ok: true, data: { ok: true, body: options?.body } }),
      },
      {
        url: "/api/tasks/task-adopt-1/sessions/task-session%3Atask-adopt-1%3Asession-a/activate",
        method: "POST",
        response: { ok: true, data: { ok: true } },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-adopt-1/candidates/0/adopt", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, winnerCandidateIndex: 0 });
    expect(terminateAgentMock).toHaveBeenCalledWith("agent-run-2");
    expect(wsBroadcastMock).toHaveBeenCalledTimes(2);

    const cpFetchCalls = cpFetchMock.mock.calls as unknown as Array<
      [string, RouteFetchOptions | undefined]
    >;
    const adoptCall = cpFetchCalls.find(
      ([url, options]) =>
        url === "/api/tasks/task-adopt-1/domain-runs/parallel-run-1/candidates/0/adopt" &&
        options?.method === "POST",
    );
    expect(adoptCall).toBeDefined();
    expect((adoptCall?.[1] as RouteFetchOptions | undefined)?.body).toMatchObject({
      stoppedCandidates: [
        {
          candidateIndex: 1,
          status: "cancelled",
        },
      ],
    });
    expect(
      cpFetchCalls.some(
        ([url, options]) => url === "/api/tasks/task-adopt-1" && options?.method === "PATCH",
      ),
    ).toBe(false);
  });

  test("POST /:taskId/candidates/:index/adopt returns 400 for invalid candidate index", async () => {
    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-invalid/candidates/not-a-number/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid candidate index" });
  });

  test("POST /:taskId/candidates/:index/adopt returns 404 when task does not exist", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-adopt-missing") {
        return { ok: false, status: 404, data: { error: "Task not found" } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-missing/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Task not found" });
  });

  test("POST /:taskId/candidates/:index/adopt returns 400 when task orchestration is not parallel", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-adopt-single") {
        return {
          ok: true,
          data: {
            id: "task-adopt-single",
            title: "Single clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            orchestrationKind: "single",
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-single/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Candidate adoption is only available for parallel execution",
    });
  });
});
