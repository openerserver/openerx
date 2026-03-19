/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
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

type RouteFetchOptions = { method?: string; body?: unknown; authorization?: string };

async function loadTaskRoutes() {
  return import("../../control-plane/web-ui-bff/src/modules/tasks/routes");
}

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
  runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "session-detached", text: "{}" })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
}));

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

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () => ({
  sseAggregator: {
    registerParallelTask: mock(() => undefined),
    registerSequentialChainTask: mock(() => undefined),
  },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: {
    broadcast: wsBroadcastMock,
  },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/reconcile", () => ({
  reconcileRunningTasksOnStartup: mock(async () => ({
    scanned: 0,
    repaired: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    runtimeAvailable: true,
  })),
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
    buildStageArtifactSummaryMock.mockClear();
    persistWorkflowStageExecutionOutcomeMock.mockReset();
    wsBroadcastMock.mockReset();

    authHeaderMock.mockReturnValue("Bearer test");
    createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
    persistWorkflowStageExecutionOutcomeMock.mockResolvedValue({
      updated: true,
      advanced: true,
      nextStageKey: "design",
      spawnedTaskId: "task-next",
    });
  });

  test("POST /:taskId/complete marks the task completed and persists current stage summary", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/tasks/task-1") {
        return {
          ok: true,
          data: {
            id: "task-1",
            title: "Clarify task",
            projectId: "proj-1",
            prompt: "Clarify scope",
            status: "running",
            result: "范围已确认。\n[STAGE_COMPLETE]",
          },
        };
      }

      if (!options?.method && url === "/api/tasks/task-1/workflow") {
        return {
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
        };
      }

      if (options?.method === "PATCH" && url === "/api/tasks/task-1") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      if (options?.method === "POST" && url === "/api/tasks/task-1/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

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
    const broadcastCalls = wsBroadcastMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
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
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/tasks/task-1b") {
        return {
          ok: true,
          data: {
            id: "task-1b",
            title: "Clarify task",
            projectId: "proj-1",
            prompt: "Clarify scope",
            status: "running",
            result: "系统生成摘要。\n[STAGE_COMPLETE]",
          },
        };
      }

      if (!options?.method && url === "/api/tasks/task-1b/workflow") {
        return {
          ok: true,
          data: {
            data: {
              workflowRun: { currentStage: "clarify" },
              stages: [{ stageKey: "clarify" }],
            },
          },
        };
      }

      if (options?.method === "PATCH" && url === "/api/tasks/task-1b") {
        return { ok: true, data: { ok: true } };
      }

      if (options?.method === "POST" && url === "/api/tasks/task-1b/workflow/advance") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

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
      if (!options?.method && url === "/api/tasks/task-1c") {
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
    const cpFetchCalls = cpFetchMock.mock.calls as unknown as Array<[string, RouteFetchOptions | undefined]>;
    expect(
      cpFetchCalls.some(
        ([path, options]) => path === "/api/tasks/task-1c/workflow/advance" && options?.method === "POST",
      ),
    ).toBe(false);
  });

  test("POST /:taskId/complete returns 404 when task does not exist", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/tasks/task-missing") {
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
      if (!options?.method && url === "/api/tasks/task-2") {
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
      if (!options?.method && url === "/api/tasks/task-2b") {
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
      if (!options?.method && url === "/api/tasks/task-3") {
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
      if (!options?.method && url === "/api/tasks/task-404") {
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
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/tasks/task-adopt-1") {
        return {
          ok: true,
          data: {
            id: "task-adopt-1",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            executionPlan: JSON.stringify({
              templateId: "tmpl-1",
              mode: "parallel",
              steps: [],
              candidates: [
                {
                  label: "Claude",
                  agent: "executor",
                  status: "completed",
                  result: "候选结果 A\n[STAGE_COMPLETE]",
                },
                {
                  label: "GPT",
                  agent: "executor",
                  status: "completed",
                  result: "候选结果 B",
                },
              ],
            }),
          },
        };
      }

      if (options?.method === "PATCH" && url === "/api/tasks/task-adopt-1") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

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
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-adopt-1", {
      method: "PATCH",
      authorization: "Bearer test",
      body: {
        status: "completed",
        executionPlan: JSON.stringify({
          templateId: "tmpl-1",
          mode: "parallel",
          steps: [],
          candidates: [
            {
              label: "Claude",
              agent: "executor",
              status: "completed",
              result: "候选结果 A\n[STAGE_COMPLETE]",
            },
            {
              label: "GPT",
              agent: "executor",
              status: "completed",
              result: "候选结果 B",
            },
          ],
          winnerCandidateIndex: 0,
        }),
        result: "候选结果 A\n[STAGE_COMPLETE]",
      },
    });
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    const broadcastCalls = wsBroadcastMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
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
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/tasks/task-adopt-2") {
        return {
          ok: true,
          data: {
            id: "task-adopt-2",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            executionPlan: JSON.stringify({
              templateId: "tmpl-1",
              mode: "parallel",
              steps: [],
              candidates: [{ label: "Claude", agent: "executor", status: "completed" }],
            }),
          },
        };
      }

      if (options?.method === "PATCH" && url === "/api/tasks/task-adopt-2") {
        return { ok: true, data: { ok: true, body: options.body } };
      }

      return { ok: true, data: {} };
    });

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
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-adopt-2", {
      method: "PATCH",
      authorization: "Bearer test",
      body: {
        status: "completed",
        executionPlan: JSON.stringify({
          templateId: "tmpl-1",
          mode: "parallel",
          steps: [],
          candidates: [{ label: "Claude", agent: "executor", status: "completed" }],
          winnerCandidateIndex: 0,
        }),
      },
    });
  });

  test("POST /:taskId/candidates/:index/adopt returns 400 for invalid candidate index", async () => {
    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-adopt-invalid/candidates/not-a-number/adopt", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid candidate index" });
  });

  test("POST /:taskId/candidates/:index/adopt returns 400 when task has no execution plan", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/tasks/task-adopt-no-plan") {
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

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-adopt-no-plan/candidates/0/adopt", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Task has no execution plan" });
  });

  test("POST /:taskId/candidates/:index/adopt returns 400 when execution plan is not parallel", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/tasks/task-adopt-single") {
        return {
          ok: true,
          data: {
            id: "task-adopt-single",
            title: "Single clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            executionPlan: JSON.stringify({
              templateId: "tmpl-1",
              mode: "single",
              steps: [],
              candidates: [{ label: "Claude", agent: "executor", status: "completed" }],
            }),
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-adopt-single/candidates/0/adopt", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Candidate adoption is only available for parallel execution",
    });
  });

  test("POST /:taskId/candidates/:index/adopt returns 404 when candidate does not exist", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/tasks/task-adopt-missing-candidate") {
        return {
          ok: true,
          data: {
            id: "task-adopt-missing-candidate",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            executionPlan: JSON.stringify({
              templateId: "tmpl-1",
              mode: "parallel",
              steps: [],
              candidates: [{ label: "Claude", agent: "executor", status: "completed" }],
            }),
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
      if (!options?.method && url === "/api/tasks/task-adopt-pending") {
        return {
          ok: true,
          data: {
            id: "task-adopt-pending",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "running",
            executionPlan: JSON.stringify({
              templateId: "tmpl-1",
              mode: "parallel",
              steps: [],
              candidates: [{ label: "Claude", agent: "executor", status: "running" }],
            }),
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-adopt-pending/candidates/0/adopt", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Candidate 0 is not completed (status: running)",
    });
  });
});
