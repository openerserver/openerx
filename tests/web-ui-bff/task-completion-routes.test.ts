/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const terminateAgentMock = mock(async () => ({ ok: true }));
const buildStageArtifactSummaryMock = mock((resultText?: string) => ({
  summary: resultText ? resultText.replace(/\n\[STAGE_COMPLETE\]$/, "") : "",
  excerpt: resultText ?? "",
  completionMarked: typeof resultText === "string" && resultText.includes("[STAGE_COMPLETE]"),
  capturedAt: "2026-03-19T10:00:00.000Z",
  source: "assistant-output",
}));
const persistWorkflowStageExecutionOutcomeMock = mock(async () => ({
  updated: true,
  advanced: true,
  nextStageKey: "design",
  spawnedTaskId: "task-next",
}));
const wsBroadcastMock = mock(() => undefined);

function buildOpencodeAdapterMock() {
  return {
    continueSession: mock(async () => ({ ok: true })),
    createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
    ensureAgentRunForSession: mock(() => "run-1"),
    extractAssistantResultFromMessages: mock(() => ({
      completed: false,
      failed: false,
      error: undefined,
      tokenUsed: 0,
    })),
    findAgentRunBySessionId: mock(() => undefined),
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
    runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "session-detached", text: "{}" })),
    terminateAgent: terminateAgentMock,
    updateAgentRunStatus: mock(() => undefined),
  };
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
  "../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter",
  buildOpencodeAdapterMock,
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
  fetchCurrentStageHooks: mock(async () => []),
  persistWorkflowStageExecutionOutcome: persistWorkflowStageExecutionOutcomeMock,
}));

describe("task completion routes", () => {
  beforeEach(() => {
    cpFetchMock.mockReset();
    authHeaderMock.mockReset();
    createInternalAuthorizationMock.mockReset();
    terminateAgentMock.mockReset();
    buildStageArtifactSummaryMock.mockClear();
    persistWorkflowStageExecutionOutcomeMock.mockReset();
    wsBroadcastMock.mockReset();

    authHeaderMock.mockReturnValue("Bearer test");
    createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
    terminateAgentMock.mockResolvedValue({ ok: true });
    persistWorkflowStageExecutionOutcomeMock.mockResolvedValue({
      updated: true,
      advanced: true,
      nextStageKey: "design",
      spawnedTaskId: "task-next",
    });
  });

  test("POST /:taskId/complete marks the task completed and persists current stage summary", async () => {
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
        url: "/api/tasks/task-1/workflow",
        response: {
          ok: true,
          data: {
            data: {
              workflowRun: { currentStage: "clarify" },
              stages: [
                {
                  stageKey: "clarify",
                  artifactsSummaryJson: {
                    summary: "保留现有阶段摘要",
                    excerpt: "保留现有阶段摘要",
                    completionMarked: true,
                    capturedAt: "2026-03-19T10:00:00.000Z",
                    source: "assistant-output",
                  },
                },
              ],
            },
          },
        },
      },
      {
        url: "/api/tasks/task-1",
        method: "PATCH",
        response: (options) => ({ ok: true, data: { ok: true, body: options?.body } }),
      },
      {
        url: "/api/tasks/task-1/workflow/advance",
        method: "POST",
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
    expect(buildStageArtifactSummaryMock).toHaveBeenCalledWith("范围已确认。\n[STAGE_COMPLETE]");
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "clarify",
        status: "completed",
        artifactsSummaryJson: {
          summary: "保留现有阶段摘要",
          excerpt: "保留现有阶段摘要",
          completionMarked: true,
          capturedAt: "2026-03-19T10:00:00.000Z",
          source: "assistant-output",
        },
      },
    });
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

  test("POST /:taskId/complete falls back to generated stage summary when no persisted summary exists", async () => {
    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-1b",
        response: {
          ok: true,
          data: {
            id: "task-1b",
            title: "Clarify task",
            projectId: "proj-1",
            prompt: "Clarify scope",
            status: "running",
            result: "系统生成摘要。\n[STAGE_COMPLETE]",
          },
        },
      },
      {
        url: "/api/tasks/task-1b/workflow",
        response: {
          ok: true,
          data: {
            data: {
              workflowRun: { currentStage: "clarify" },
              stages: [{ stageKey: "clarify" }],
            },
          },
        },
      },
      {
        url: "/api/tasks/task-1b",
        method: "PATCH",
        response: { ok: true, data: { ok: true } },
      },
      {
        url: "/api/tasks/task-1b/workflow/advance",
        method: "POST",
        response: (options) => ({ ok: true, data: { ok: true, body: options?.body } }),
      },
    ]);

    const generatedSummary = {
      summary: "系统生成摘要。",
      excerpt: "系统生成摘要。\n[STAGE_COMPLETE]",
      completionMarked: true,
      capturedAt: "2026-03-19T10:00:00.000Z",
      source: "assistant-output",
    };
    buildStageArtifactSummaryMock.mockReturnValueOnce(generatedSummary);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-1b/complete", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1b/workflow/advance", {
      method: "POST",
      authorization: "Bearer test",
      body: {
        fromStage: "clarify",
        status: "completed",
        artifactsSummaryJson: generatedSummary,
      },
    });
  });

  test("POST /:taskId/complete skips workflow advance when there is no current stage", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-1c") {
        return {
          ok: true,
          data: {
            id: "task-1c",
            title: "Standalone task",
            projectId: "proj-standalone",
            prompt: "Do work",
            status: "running",
            result: "已完成。",
          },
        };
      }

      if (!options?.method && url === "/api/tasks/task-1c/workflow") {
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

      if (options?.method === "PATCH" && url === "/api/tasks/task-1c") {
        return { ok: true, data: { ok: true } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-1c/complete", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    const cpFetchCalls = cpFetchMock.mock.calls as unknown as Array<
      [string, RouteFetchOptions | undefined]
    >;
    expect(
      cpFetchCalls.some(
        ([path, options]) =>
          path === "/api/tasks/task-1c/workflow/advance" && options?.method === "POST",
      ),
    ).toBe(false);
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

  test("POST /:taskId/workflow/advance forces workflow advancement and returns spawned task info", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-2") {
        return {
          ok: true,
          data: {
            id: "task-2",
            title: "Design task",
            projectId: "proj-2",
            prompt: "Produce design",
            status: "running",
            result: "设计完成。\n[STAGE_COMPLETE]",
          },
        };
      }

      if (options?.method === "PATCH" && url === "/api/tasks/task-2") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

    persistWorkflowStageExecutionOutcomeMock.mockResolvedValueOnce({
      updated: true,
      advanced: true,
      nextStageKey: "verify",
      spawnedTaskId: "task-verify-1",
    });

    const { taskRoutes } = await loadTaskRoutes();

    const response = await taskRoutes.request("http://localhost/task-2/workflow/advance", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      nextStageKey: "verify",
      spawnedTaskId: "task-verify-1",
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-2", {
      method: "PATCH",
      authorization: "Bearer test",
      body: { status: "completed" },
    });
    expect(persistWorkflowStageExecutionOutcomeMock).toHaveBeenCalledWith({
      taskId: "task-2",
      authorization: "Bearer test",
      resultText: "设计完成。\n[STAGE_COMPLETE]",
      source: "assistant-output",
      forceAdvance: true,
    });
  });

  test("POST /:taskId/workflow/advance falls back to [STAGE_COMPLETE] when task result is empty", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-2b") {
        return {
          ok: true,
          data: {
            id: "task-2b",
            title: "Design task",
            projectId: "proj-2",
            prompt: "Produce design",
            status: "running",
            result: undefined,
          },
        };
      }

      if (options?.method === "PATCH" && url === "/api/tasks/task-2b") {
        return { ok: true, data: { ok: true } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-2b/workflow/advance", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    expect(persistWorkflowStageExecutionOutcomeMock).toHaveBeenCalledWith({
      taskId: "task-2b",
      authorization: "Bearer test",
      resultText: "[STAGE_COMPLETE]",
      source: "assistant-output",
      forceAdvance: true,
    });
  });

  test("POST /:taskId/workflow/advance returns 404 when workflow outcome is not updated", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-3") {
        return {
          ok: true,
          data: {
            id: "task-3",
            title: "Verify task",
            projectId: "proj-3",
            prompt: "Verify release",
            status: "running",
            result: "验证完成。",
          },
        };
      }

      if (options?.method === "PATCH" && url === "/api/tasks/task-3") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

    persistWorkflowStageExecutionOutcomeMock.mockResolvedValueOnce({
      updated: false,
      advanced: false,
      nextStageKey: undefined,
      spawnedTaskId: undefined,
    } as never);

    const { taskRoutes } = await loadTaskRoutes();

    const response = await taskRoutes.request("http://localhost/task-3/workflow/advance", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Workflow stage not found or not updated",
    });
  });

  test("POST /:taskId/workflow/advance returns 404 when task does not exist", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-404") {
        return { ok: false, status: 404, data: { error: "Task not found" } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-404/workflow/advance", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Task not found" });
  });

  test("POST /:taskId/candidates/:index/adopt marks the winner, persists summary, and broadcasts completion", async () => {
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
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-1/domain-runs",
        response: {
          ok: true,
          data: { data: [{ id: "run-adopt-1", orchestrationKind: "parallel" }] },
        },
      },
      {
        url: "/api/tasks/task-adopt-1/domain-runs/run-adopt-1",
        response: {
          ok: true,
          data: {
            data: {
              run: { id: "run-adopt-1", orchestrationKind: "parallel", winnerNodeId: null },
              nodes: [],
              candidateNodes: [
                {
                  id: "node-a",
                  nodeKind: "candidate",
                  title: "Claude",
                  candidateIndex: 0,
                  agentType: "executor",
                  sessionId: null,
                  agentRunId: null,
                  status: "completed",
                  resultText: "候选结果 A\n[STAGE_COMPLETE]",
                },
                {
                  id: "node-b",
                  nodeKind: "candidate",
                  title: "GPT",
                  candidateIndex: 1,
                  agentType: "executor",
                  sessionId: null,
                  agentRunId: null,
                  status: "completed",
                  resultText: "候选结果 B",
                },
              ],
              judgeNode: null,
              winnerCandidateIndex: null,
            },
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-1/domain-runs/run-adopt-1/candidates/0/adopt",
        method: "POST",
        response: {
          ok: true,
          data: { data: { winnerCandidateIndex: 0, result: "候选结果 A\n[STAGE_COMPLETE]" } },
        },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-adopt-1/candidates/0/adopt", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, winnerCandidateIndex: 0 });
    expect(persistWorkflowStageExecutionOutcomeMock).toHaveBeenCalledWith({
      taskId: "task-adopt-1",
      authorization: "Bearer test",
      resultText: "候选结果 A\n[STAGE_COMPLETE]",
      source: "manual-adopt",
    });
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-adopt-1/domain-runs/run-adopt-1/candidates/0/adopt",
      {
        method: "POST",
        authorization: "Bearer test",
        body: { stoppedCandidates: [] },
      },
    );
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    const broadcastCalls = wsBroadcastMock.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    expect(broadcastCalls[0]?.[0]).toMatchObject({
      type: "task.completed",
      taskId: "task-adopt-1",
      projectId: "proj-adopt",
      data: {
        status: "completed",
        executionMode: "parallel",
        winnerCandidateIndex: 0,
        adoptedManually: true,
        result: "候选结果 A\n[STAGE_COMPLETE]",
      },
    });
  });

  test("POST /:taskId/candidates/:index/adopt allows adopting a completed candidate without result text", async () => {
    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-adopt-2",
        response: {
          ok: true,
          data: {
            id: "task-adopt-2",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            orchestrationKind: "parallel",
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-2/domain-runs",
        response: {
          ok: true,
          data: { data: [{ id: "run-adopt-2", orchestrationKind: "parallel" }] },
        },
      },
      {
        url: "/api/tasks/task-adopt-2/domain-runs/run-adopt-2",
        response: {
          ok: true,
          data: {
            data: {
              run: { id: "run-adopt-2", orchestrationKind: "parallel", winnerNodeId: null },
              nodes: [],
              candidateNodes: [
                {
                  id: "node-a",
                  nodeKind: "candidate",
                  title: "Claude",
                  candidateIndex: 0,
                  agentType: "executor",
                  sessionId: null,
                  agentRunId: null,
                  status: "completed",
                  resultText: null,
                },
              ],
              judgeNode: null,
              winnerCandidateIndex: null,
            },
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-2/domain-runs/run-adopt-2/candidates/0/adopt",
        method: "POST",
        response: { ok: true, data: { data: { winnerCandidateIndex: 0, result: null } } },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-adopt-2/candidates/0/adopt", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    expect(persistWorkflowStageExecutionOutcomeMock).toHaveBeenCalledWith({
      taskId: "task-adopt-2",
      authorization: "Bearer test",
      resultText: undefined,
      source: "manual-adopt",
    });
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-adopt-2/domain-runs/run-adopt-2/candidates/0/adopt",
      {
        method: "POST",
        authorization: "Bearer test",
        body: { stoppedCandidates: [] },
      },
    );
  });

  test("POST /:taskId/candidates/:index/adopt stops unfinished losing candidates", async () => {
    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-adopt-running",
        response: {
          ok: true,
          data: {
            id: "task-adopt-running",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            orchestrationKind: "parallel",
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-running/domain-runs",
        response: {
          ok: true,
          data: { data: [{ id: "run-adopt-running", orchestrationKind: "parallel" }] },
        },
      },
      {
        url: "/api/tasks/task-adopt-running/domain-runs/run-adopt-running",
        response: {
          ok: true,
          data: {
            data: {
              run: { id: "run-adopt-running", orchestrationKind: "parallel", winnerNodeId: null },
              nodes: [],
              candidateNodes: [
                {
                  id: "node-a",
                  nodeKind: "candidate",
                  title: "Claude",
                  candidateIndex: 0,
                  agentType: "executor",
                  sessionId: "ses-a",
                  agentRunId: "run-a",
                  status: "completed",
                  resultText: "候选结果 A",
                },
                {
                  id: "node-b",
                  nodeKind: "candidate",
                  title: "GPT",
                  candidateIndex: 1,
                  agentType: "executor",
                  sessionId: "ses-b",
                  agentRunId: "run-b",
                  status: "running",
                  resultText: null,
                },
              ],
              judgeNode: null,
              winnerCandidateIndex: null,
            },
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-running/branches",
        response: {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "ses-root",
                branchName: "main",
                isActive: true,
              },
              {
                id: "ts-a",
                runtimeSessionId: "ses-a",
                branchName: "winner",
                isActive: false,
              },
              {
                id: "ts-b",
                runtimeSessionId: "ses-b",
                branchName: "loser",
                isActive: false,
              },
            ],
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-running/branches/ts-a/activate",
        method: "POST",
        response: { ok: true, data: { ok: true } },
      },
      {
        url: "/api/tasks/task-adopt-running/domain-runs/run-adopt-running/candidates/0/adopt",
        method: "POST",
        response: { ok: true, data: { data: { winnerCandidateIndex: 0, result: "候选结果 A" } } },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-running/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(200);
    expect(terminateAgentMock).toHaveBeenCalledWith("run-b");
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-adopt-running/branches/ts-a/activate",
      {
        method: "POST",
        authorization: "Bearer test",
      },
    );
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-adopt-running/domain-runs/run-adopt-running/candidates/0/adopt",
      {
        method: "POST",
        authorization: "Bearer test",
        body: {
          stoppedCandidates: [
            {
              candidateIndex: 1,
              status: "cancelled",
              resultText:
                "[STOPPED] Manual candidate adoption ended this parallel run before the candidate completed.",
            },
          ],
        },
      },
    );

    const broadcasts = wsBroadcastMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(broadcasts[0]?.[0]).toMatchObject({
      type: "session.activated",
      taskId: "task-adopt-running",
      projectId: "proj-adopt",
      data: {
        sessionId: "ses-a",
        branchName: "winner",
        source: "candidate-adopt",
      },
    });
    expect(broadcasts[1]?.[0]).toMatchObject({
      type: "task.completed",
      taskId: "task-adopt-running",
      projectId: "proj-adopt",
      data: {
        status: "completed",
        winnerCandidateIndex: 0,
        adoptedManually: true,
        result: "候选结果 A",
      },
    });
  });

  test("POST /:taskId/candidates/:index/adopt activates the winner task session lineage", async () => {
    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-adopt-activate",
        response: {
          ok: true,
          data: {
            id: "task-adopt-activate",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            sessionId: "ses-root",
            orchestrationKind: "parallel",
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-activate/domain-runs",
        response: {
          ok: true,
          data: { data: [{ id: "run-adopt-activate", orchestrationKind: "parallel" }] },
        },
      },
      {
        url: "/api/tasks/task-adopt-activate/domain-runs/run-adopt-activate",
        response: {
          ok: true,
          data: {
            data: {
              run: { id: "run-adopt-activate", orchestrationKind: "parallel", winnerNodeId: null },
              nodes: [],
              candidateNodes: [
                {
                  id: "node-a",
                  nodeKind: "candidate",
                  title: "Claude",
                  candidateIndex: 0,
                  agentType: "executor",
                  sessionId: "ses-winner",
                  agentRunId: "run-a",
                  status: "completed",
                  resultText: "候选结果 A",
                },
                {
                  id: "node-b",
                  nodeKind: "candidate",
                  title: "GPT",
                  candidateIndex: 1,
                  agentType: "executor",
                  sessionId: "ses-other",
                  agentRunId: "run-b",
                  status: "completed",
                  resultText: "候选结果 B",
                },
              ],
              judgeNode: null,
              winnerCandidateIndex: null,
            },
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-activate/branches",
        response: {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "ses-root",
                branchName: "main",
                isActive: true,
              },
              {
                id: "ts-winner",
                runtimeSessionId: "ses-winner",
                branchName: "winner",
                isActive: false,
              },
            ],
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-activate/domain-runs/run-adopt-activate/candidates/0/adopt",
        method: "POST",
        response: { ok: true, data: { data: { winnerCandidateIndex: 0, result: "候选结果 A" } } },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-activate/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(200);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-adopt-activate/branches/ts-winner/activate",
      {
        method: "POST",
        authorization: "Bearer test",
      },
    );

    const broadcasts = wsBroadcastMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[0]?.[0]).toMatchObject({
      type: "session.activated",
      taskId: "task-adopt-activate",
      projectId: "proj-adopt",
      data: {
        sessionId: "ses-winner",
        branchName: "winner",
        source: "candidate-adopt",
      },
    });
    expect(broadcasts[1]?.[0]).toMatchObject({
      type: "task.completed",
      taskId: "task-adopt-activate",
      projectId: "proj-adopt",
      data: {
        status: "completed",
        winnerCandidateIndex: 0,
        adoptedManually: true,
        result: "候选结果 A",
      },
    });
  });

  test("POST /:taskId/candidates/:index/adopt repairs missing candidate lineage before activation", async () => {
    let lineageReadCount = 0;

    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-adopt-repair",
        response: {
          ok: true,
          data: {
            id: "task-adopt-repair",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            sessionId: "ses-root",
            orchestrationKind: "parallel",
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-repair/domain-runs",
        response: {
          ok: true,
          data: { data: [{ id: "run-adopt-repair", orchestrationKind: "parallel" }] },
        },
      },
      {
        url: "/api/tasks/task-adopt-repair/domain-runs/run-adopt-repair",
        response: {
          ok: true,
          data: {
            data: {
              run: { id: "run-adopt-repair", orchestrationKind: "parallel", winnerNodeId: null },
              nodes: [],
              candidateNodes: [
                {
                  id: "node-a",
                  nodeKind: "candidate",
                  title: "Claude",
                  candidateIndex: 0,
                  agentType: "executor",
                  sessionId: "ses-winner",
                  agentRunId: "run-a",
                  status: "completed",
                  resultText: "候选结果 A",
                },
                {
                  id: "node-b",
                  nodeKind: "candidate",
                  title: "GPT",
                  candidateIndex: 1,
                  agentType: "executor",
                  sessionId: "ses-other",
                  agentRunId: "run-b",
                  status: "completed",
                  resultText: "候选结果 B",
                },
              ],
              judgeNode: null,
              winnerCandidateIndex: null,
            },
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-repair/branches",
        response: () => {
          lineageReadCount += 1;
          return {
            ok: true,
            data: {
              data:
                lineageReadCount === 1
                  ? [
                      {
                        id: "ts-root",
                        runtimeSessionId: "ses-root",
                        branchName: "main",
                        sourceType: "root",
                        isActive: true,
                        archivedAt: null,
                      },
                    ]
                  : [
                      {
                        id: "ts-root",
                        runtimeSessionId: "ses-root",
                        branchName: "main",
                        sourceType: "root",
                        isActive: true,
                        archivedAt: null,
                      },
                      {
                        id: "ts-winner",
                        runtimeSessionId: "ses-winner",
                        branchName: "Claude",
                        sourceType: "fork",
                        isActive: false,
                        archivedAt: null,
                      },
                      {
                        id: "ts-other",
                        runtimeSessionId: "ses-other",
                        branchName: "GPT",
                        sourceType: "fork",
                        isActive: false,
                        archivedAt: null,
                      },
                    ],
            },
          };
        },
      },
      {
        url: "/api/tasks/task-adopt-repair/branches",
        method: "POST",
        response: { ok: true, data: { ok: true } },
      },
      {
        url: "/api/tasks/task-adopt-repair/branches/ts-winner/activate",
        method: "POST",
        response: { ok: true, data: { ok: true } },
      },
      {
        url: "/api/tasks/task-adopt-repair",
        method: "PATCH",
        response: (options) => ({ ok: true, data: { ok: true, body: options?.body } }),
      },
      {
        url: "/api/tasks/task-adopt-repair/domain-runs/run-adopt-repair/candidates/0/adopt",
        method: "POST",
        response: { ok: true, data: { data: { winnerCandidateIndex: 0, result: "候选结果 A" } } },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-repair/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(200);

    const lineageWrites = (cpFetchMock.mock.calls as unknown as Array<[string, RouteFetchOptions]>)
      .filter(
        ([url, options]) =>
          url === "/api/tasks/task-adopt-repair/branches" && options?.method === "POST",
      )
      .map(([, options]) => options.body as Record<string, unknown>);

    expect(lineageWrites).toEqual([
      expect.objectContaining({
        runtimeSessionId: "ses-winner",
        parentRuntimeSessionId: "ses-root",
        branchName: "Claude",
        sourceType: "fork",
      }),
      expect.objectContaining({
        runtimeSessionId: "ses-other",
        parentRuntimeSessionId: "ses-root",
        branchName: "GPT",
        sourceType: "fork",
      }),
    ]);

    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-adopt-repair/branches/ts-winner/activate",
      {
        method: "POST",
        authorization: "Bearer test",
      },
    );
  });

  test("POST /:taskId/candidates/:index/adopt prefers domain runs and skips legacy task patch for projection-backed tasks", async () => {
    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-adopt-domain",
        response: {
          ok: true,
          data: {
            id: "task-adopt-domain",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            sessionId: "ses-root",
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-domain/domain-runs",
        response: {
          ok: true,
          data: {
            data: [{ id: "run-domain-1", orchestrationKind: "parallel" }],
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-domain/domain-runs/run-domain-1",
        response: {
          ok: true,
          data: {
            data: {
              run: { id: "run-domain-1", orchestrationKind: "parallel", winnerNodeId: null },
              nodes: [],
              candidateNodes: [
                {
                  id: "node-a",
                  nodeKind: "candidate",
                  title: "Claude",
                  candidateIndex: 0,
                  agentType: "executor",
                  modelUsed: "claude-3-7-sonnet",
                  sessionId: "ses-a",
                  agentRunId: "run-a",
                  status: "completed",
                  resultText: "候选结果 A",
                },
                {
                  id: "node-b",
                  nodeKind: "candidate",
                  title: "GPT",
                  candidateIndex: 1,
                  agentType: "executor",
                  modelUsed: "gpt-4.1",
                  sessionId: "ses-b",
                  agentRunId: "run-b",
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
        url: "/api/tasks/task-adopt-domain/branches",
        response: {
          ok: true,
          data: {
            data: [
              {
                id: "ts-root",
                runtimeSessionId: "ses-root",
                branchName: "main",
                sourceType: "root",
                isActive: true,
                archivedAt: null,
              },
              {
                id: "ts-a",
                runtimeSessionId: "ses-a",
                branchName: "Claude",
                sourceType: "fork",
                isActive: false,
                archivedAt: null,
              },
              {
                id: "ts-b",
                runtimeSessionId: "ses-b",
                branchName: "GPT",
                sourceType: "fork",
                isActive: false,
                archivedAt: null,
              },
            ],
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-domain/branches/ts-a/activate",
        method: "POST",
        response: { ok: true, data: { ok: true } },
      },
      {
        url: "/api/tasks/task-adopt-domain/domain-runs/run-domain-1/candidates/0/adopt",
        method: "POST",
        response: {
          ok: true,
          data: {
            data: {
              winnerCandidateIndex: 0,
              result: "候选结果 A",
            },
          },
        },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-domain/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(200);
    expect(terminateAgentMock).toHaveBeenCalledWith("run-b");
    expect(persistWorkflowStageExecutionOutcomeMock).toHaveBeenCalledWith({
      taskId: "task-adopt-domain",
      authorization: "Bearer test",
      resultText: "候选结果 A",
      source: "manual-adopt",
    });

    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-adopt-domain/domain-runs/run-domain-1/candidates/0/adopt",
      {
        method: "POST",
        authorization: "Bearer test",
        body: {
          stoppedCandidates: [
            {
              candidateIndex: 1,
              status: "cancelled",
              resultText:
                "[STOPPED] Manual candidate adoption ended this parallel run before the candidate completed.",
            },
          ],
        },
      },
    );

    const legacyPatchCall = (
      cpFetchMock.mock.calls as unknown as Array<[string, RouteFetchOptions]>
    ).find(
      ([url, options]) => url === "/api/tasks/task-adopt-domain" && options?.method === "PATCH",
    );
    expect(legacyPatchCall).toBeUndefined();
  });

  test("POST /:taskId/candidates/:index/adopt returns 404 when only legacy compat payload remains and no parallel domain run exists", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-adopt-backfill") {
        return {
          ok: true,
          data: {
            id: "task-adopt-backfill",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "completed",
            sessionId: "ses-root",
            executionPlan: JSON.stringify({
              parallelRunId: "legacy-prun-current",
              templateId: "tmpl-1",
              mode: "parallel",
              steps: [],
              candidates: [
                {
                  label: "Claude",
                  agent: "executor",
                  status: "completed",
                  result: "候选结果 A",
                  sessionId: "ses-a",
                  agentRunId: "run-a",
                },
                {
                  label: "GPT",
                  agent: "executor",
                  status: "completed",
                  result: "候选结果 B",
                  sessionId: "ses-b",
                  agentRunId: "run-b",
                },
              ],
            }),
            parallelRunHistory: JSON.stringify([
              {
                parallelRunId: "legacy-prun-history",
                startedAt: "2026-03-20T00:00:00.000Z",
                finishedAt: "2026-03-20T00:10:00.000Z",
                candidateSessions: [
                  { label: "Claude", agent: "executor", status: "completed", result: "旧结果 A" },
                  { label: "GPT", agent: "executor", status: "failed", result: "旧结果 B" },
                ],
              },
            ]),
          },
        };
      }

      if (!options?.method && url === "/api/tasks/task-adopt-backfill/domain-runs") {
        return { ok: true, data: { data: [] } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-backfill/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Task domain run not found" });
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

  test("POST /:taskId/candidates/:index/adopt returns 404 when task has no parallel domain run", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-adopt-no-plan") {
        return {
          ok: true,
          data: {
            id: "task-adopt-no-plan",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
          },
        };
      }

      if (!options?.method && url === "/api/tasks/task-adopt-no-plan/domain-runs") {
        return { ok: true, data: { data: [] } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-no-plan/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Task domain run not found" });
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

  test("POST /:taskId/candidates/:index/adopt returns 404 when candidate does not exist", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-adopt-missing-candidate") {
        return {
          ok: true,
          data: {
            id: "task-adopt-missing-candidate",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            orchestrationKind: "parallel",
          },
        };
      }

      if (!options?.method && url === "/api/tasks/task-adopt-missing-candidate/domain-runs") {
        return {
          ok: true,
          data: { data: [{ id: "run-missing-candidate", orchestrationKind: "parallel" }] },
        };
      }

      if (
        !options?.method &&
        url === "/api/tasks/task-adopt-missing-candidate/domain-runs/run-missing-candidate"
      ) {
        return {
          ok: true,
          data: {
            data: {
              run: { id: "run-missing-candidate", orchestrationKind: "parallel" },
              nodes: [],
              candidateNodes: [
                {
                  id: "node-a",
                  nodeKind: "candidate",
                  title: "Claude",
                  candidateIndex: 0,
                  agentType: "executor",
                  sessionId: "ses-a",
                  agentRunId: null,
                  status: "completed",
                  resultText: "候选结果 A",
                },
              ],
              judgeNode: null,
              winnerCandidateIndex: null,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-missing-candidate/candidates/3/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Candidate 3 not found" });
  });

  test("POST /:taskId/candidates/:index/adopt returns 400 when candidate is not completed", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-adopt-pending") {
        return {
          ok: true,
          data: {
            id: "task-adopt-pending",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            orchestrationKind: "parallel",
          },
        };
      }

      if (!options?.method && url === "/api/tasks/task-adopt-pending/domain-runs") {
        return {
          ok: true,
          data: { data: [{ id: "run-pending", orchestrationKind: "parallel" }] },
        };
      }

      if (!options?.method && url === "/api/tasks/task-adopt-pending/domain-runs/run-pending") {
        return {
          ok: true,
          data: {
            data: {
              run: { id: "run-pending", orchestrationKind: "parallel" },
              nodes: [],
              candidateNodes: [
                {
                  id: "node-a",
                  nodeKind: "candidate",
                  title: "Claude",
                  candidateIndex: 0,
                  agentType: "executor",
                  sessionId: "ses-a",
                  agentRunId: null,
                  status: "running",
                  resultText: null,
                },
              ],
              judgeNode: null,
              winnerCandidateIndex: null,
            },
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-pending/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Candidate 0 is not completed (status: running)",
    });
  });
});
