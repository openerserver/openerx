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
const agentRunRegistryMocks = {
  ensureAgentRunForSession: mock(() => "run-1"),
  findAgentRunBySessionId: mock(() => undefined as unknown),
  registerAgentRun: mock(() => undefined),
  recoverAgentRun: mock(() => undefined),
  getAgentRunState: mock(() => undefined),
  markAgentRunPromptSent: mock(() => undefined),
  setAgentRunPausedAt: mock(() => undefined),
  updateAgentRunStatus: mock(() => undefined),
  getAgentRun: mock(() => undefined),
  listAgentRuns: mock(() => []),
};
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

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/agent-run-registry", () => ({
  ensureAgentRunForSession: agentRunRegistryMocks.ensureAgentRunForSession,
  findAgentRunBySessionId: agentRunRegistryMocks.findAgentRunBySessionId,
  registerAgentRun: agentRunRegistryMocks.registerAgentRun,
  recoverAgentRun: agentRunRegistryMocks.recoverAgentRun,
  getAgentRunState: agentRunRegistryMocks.getAgentRunState,
  markAgentRunPromptSent: agentRunRegistryMocks.markAgentRunPromptSent,
  setAgentRunPausedAt: agentRunRegistryMocks.setAgentRunPausedAt,
  updateAgentRunStatus: agentRunRegistryMocks.updateAgentRunStatus,
  getAgentRun: agentRunRegistryMocks.getAgentRun,
  listAgentRuns: agentRunRegistryMocks.listAgentRuns,
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
    agentRunRegistryMocks.ensureAgentRunForSession.mockReset();
    agentRunRegistryMocks.findAgentRunBySessionId.mockReset();
    agentRunRegistryMocks.registerAgentRun.mockReset();
    agentRunRegistryMocks.recoverAgentRun.mockReset();
    agentRunRegistryMocks.getAgentRunState.mockReset();
    agentRunRegistryMocks.markAgentRunPromptSent.mockReset();
    agentRunRegistryMocks.setAgentRunPausedAt.mockReset();
    agentRunRegistryMocks.updateAgentRunStatus.mockReset();
    agentRunRegistryMocks.getAgentRun.mockReset();
    agentRunRegistryMocks.listAgentRuns.mockReset();
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
    agentRunRegistryMocks.ensureAgentRunForSession.mockReturnValue("run-1");
    agentRunRegistryMocks.findAgentRunBySessionId.mockReturnValue(undefined);
    agentRunRegistryMocks.registerAgentRun.mockReturnValue(undefined);
    agentRunRegistryMocks.recoverAgentRun.mockReturnValue(undefined);
    agentRunRegistryMocks.getAgentRunState.mockReturnValue(undefined);
    agentRunRegistryMocks.markAgentRunPromptSent.mockReturnValue(undefined);
    agentRunRegistryMocks.setAgentRunPausedAt.mockReturnValue(undefined);
    agentRunRegistryMocks.updateAgentRunStatus.mockReturnValue(undefined);
    agentRunRegistryMocks.getAgentRun.mockReturnValue(undefined);
    agentRunRegistryMocks.listAgentRuns.mockReturnValue([]);
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

  test("POST /:taskId/phases/:phaseId/candidates/:index/adopt completes phase-first winner adoption on the main path", async () => {
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
    agentRunRegistryMocks.findAgentRunBySessionId.mockImplementation((sessionId: string) =>
      sessionId === "session-b"
        ? ({ agentRunId: "agent-run-2", status: "running", subSessionId: "session-b" } as never)
        : undefined,
    );

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
                phaseId: "phase-parallel-1",
                phaseRole: "candidate",
                phaseItemIndex: 0,
                coordinationKey: "coord-1",
                candidateIndex: 0,
                executionStatus: "completed",
                sessionKind: "candidate",
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
                phaseId: "phase-parallel-1",
                phaseRole: "candidate",
                phaseItemIndex: 1,
                coordinationKey: "coord-1",
                candidateIndex: 1,
                executionStatus: "running",
                sessionKind: "candidate",
                createdAt: "2026-03-19T10:00:02.000Z",
                updatedAt: "2026-03-19T10:00:09.000Z",
                archivedAt: null,
              },
            ],
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-1/phases/phase-parallel-1/adopt",
        method: "POST",
        response: (options) => ({ ok: true, data: { ok: true, body: options?.body } }),
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-1/phases/phase-parallel-1/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      phaseId: "phase-parallel-1",
      winnerCandidateIndex: 0,
      execution: {
        action: "adopt",
        nextSessionId: "session-a",
        taskSessionId: "task-session:task-adopt-1:session-a",
        roundId: "task-session:task-adopt-1:session-a",
        acceptedRevision: null,
        phaseId: "phase-parallel-1",
        agentRunId: null,
        status: "completed",
        executionMode: "parallel",
        parentSessionId: null,
        parentTaskSessionId: null,
        refreshTargets: {
          workflow: true,
          flow: true,
          messages: true,
        },
      },
    });
    expect(terminateAgentMock).toHaveBeenCalledWith("agent-run-2");
    expect(wsBroadcastMock).toHaveBeenCalledTimes(3);

    const broadcastCalls = wsBroadcastMock.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    expect(broadcastCalls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            type: "task.phase.completed",
            taskId: "task-adopt-1",
            projectId: "proj-adopt",
            sessionId: "session-a",
            phaseId: "phase-parallel-1",
            data: expect.objectContaining({
              phaseId: "phase-parallel-1",
              status: "completed",
              terminalReason: "winner_adopted",
              winnerCandidateIndex: 0,
              winnerSessionId: "task-session:task-adopt-1:session-a",
              currentSessionId: "session-a",
              currentTaskSessionId: "task-session:task-adopt-1:session-a",
            }),
          }),
        ],
        [
          expect.objectContaining({
            type: "task.completed",
            taskId: "task-adopt-1",
            projectId: "proj-adopt",
            data: expect.objectContaining({
              phaseId: "phase-parallel-1",
              status: "completed",
              winnerCandidateIndex: 0,
            }),
          }),
        ],
        [
          expect.objectContaining({
            type: "session.activated",
            taskId: "task-adopt-1",
            projectId: "proj-adopt",
          }),
        ],
      ]),
    );

    const cpFetchCalls = cpFetchMock.mock.calls as unknown as Array<
      [string, RouteFetchOptions | undefined]
    >;
    const adoptCall = cpFetchCalls.find(
      ([url, options]) =>
        url === "/api/tasks/task-adopt-1/phases/phase-parallel-1/adopt" &&
        options?.method === "POST",
    );
    expect(adoptCall).toBeDefined();
    expect((adoptCall?.[1] as RouteFetchOptions | undefined)?.body).toEqual({
      winnerSessionId: "task-session:task-adopt-1:session-a",
    });
    const taskPatchCall = cpFetchCalls.find(
      ([url, options]) => url === "/api/tasks/task-adopt-1" && options?.method === "PATCH",
    );
    expect(taskPatchCall).toBeDefined();
    expect((taskPatchCall?.[1] as RouteFetchOptions | undefined)?.body).toEqual({
      status: "completed",
      sessionId: "session-a",
      result: "候选 A 结果",
    });
    const sessionDeactivateCalls = cpFetchCalls.filter(
      ([url, options]) => url === "/api/tasks/task-adopt-1/sessions" && options?.method === "POST",
    );
    expect(sessionDeactivateCalls.length).toBeGreaterThan(0);
    expect(
      sessionDeactivateCalls.some(([, options]) => {
        const body = options?.body as Record<string, unknown> | undefined;
        return typeof body?.runtimeSessionId === "string" && body.isActive === false;
      }),
    ).toBe(true);
    expect(
      cpFetchCalls.some(
        ([url, options]) =>
          url === "/api/tasks/task-adopt-1/sessions/task-session%3Atask-adopt-1%3Asession-a/activate" &&
          options?.method === "POST",
      ),
    ).toBe(false);
  });

  test("POST /:taskId/phases/:phaseId/candidates/:index/adopt returns 404 when the phase candidate group is missing", async () => {
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
            orchestrationKind: "parallel",
            sessionId: "root-session",
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-repair/sessions",
        response: {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-adopt-repair:root-session",
                taskId: "task-adopt-repair",
                runtimeSessionId: "root-session",
                parentRuntimeSessionId: null,
                branchName: "main",
                sourceType: "root",
                isActive: true,
                executionStatus: "completed",
                createdAt: "2026-03-19T10:00:00.000Z",
                updatedAt: "2026-03-19T10:00:00.000Z",
                archivedAt: null,
              },
              {
                id: "task-session:task-adopt-repair:session-a",
                taskId: "task-adopt-repair",
                runtimeSessionId: "session-a",
                parentRuntimeSessionId: "root-session",
                branchName: "Candidate 1",
                sourceType: "fork",
                isActive: false,
                phaseId: "phase-other",
                phaseRole: "candidate",
                phaseItemIndex: 0,
                candidateIndex: 0,
                executionStatus: "completed",
                sessionKind: "candidate",
                createdAt: "2026-03-19T10:00:01.000Z",
                updatedAt: "2026-03-19T10:00:12.000Z",
                archivedAt: null,
              },
              {
                id: "task-session:task-adopt-repair:session-b",
                taskId: "task-adopt-repair",
                runtimeSessionId: "session-b",
                parentRuntimeSessionId: "root-session",
                branchName: "Candidate 2",
                sourceType: "fork",
                isActive: false,
                phaseId: "phase-other",
                phaseRole: "candidate",
                phaseItemIndex: 1,
                candidateIndex: 1,
                executionStatus: "completed",
                sessionKind: "candidate",
                createdAt: "2026-03-19T10:00:02.000Z",
                updatedAt: "2026-03-19T10:00:13.000Z",
                archivedAt: null,
              },
            ],
          },
        },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-repair/phases/phase-missing/candidates/1/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Task phase candidate group not found",
    });
  });

  test("POST /:taskId/phases/:phaseId/candidates/:index/adopt allows stale running candidate status when task is awaiting adoption", async () => {
    getSessionMessagesMock.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: "msg-session-b-awaiting",
          info: {
            role: "assistant",
            created: Date.parse("2026-03-19T10:00:12.000Z"),
            completed: Date.parse("2026-03-19T10:00:13.000Z"),
          },
          parts: [{ type: "text", text: "候选 B 结果" }],
        },
      ],
    } as never);

    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-adopt-awaiting",
        response: {
          ok: true,
          data: {
            id: "task-adopt-awaiting",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "awaiting_adoption",
            orchestrationKind: "parallel",
            sessionId: "root-session",
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-awaiting/sessions",
        response: {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-adopt-awaiting:session-a",
                taskId: "task-adopt-awaiting",
                runtimeSessionId: "session-a",
                parentRuntimeSessionId: "root-session",
                branchName: "Candidate 1",
                sourceType: "fork",
                isActive: false,
                phaseId: "phase-awaiting-1",
                phaseRole: "candidate",
                phaseItemIndex: 0,
                candidateIndex: 0,
                executionStatus: "completed",
                sessionKind: "candidate",
                createdAt: "2026-03-19T10:00:01.000Z",
                updatedAt: "2026-03-19T10:00:12.000Z",
                archivedAt: null,
              },
              {
                id: "task-session:task-adopt-awaiting:session-b",
                taskId: "task-adopt-awaiting",
                runtimeSessionId: "session-b",
                parentRuntimeSessionId: "root-session",
                branchName: "Candidate 2",
                sourceType: "fork",
                isActive: false,
                phaseId: "phase-awaiting-1",
                phaseRole: "candidate",
                phaseItemIndex: 1,
                candidateIndex: 1,
                executionStatus: "running",
                sessionKind: "candidate",
                createdAt: "2026-03-19T10:00:02.000Z",
                updatedAt: "2026-03-19T10:00:13.000Z",
                archivedAt: null,
              },
            ],
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-awaiting/phases/phase-awaiting-1/adopt",
        method: "POST",
        response: (options) => ({ ok: true, data: { ok: true, body: options?.body } }),
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-awaiting/phases/phase-awaiting-1/candidates/1/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      phaseId: "phase-awaiting-1",
      winnerCandidateIndex: 1,
      execution: {
        action: "adopt",
        nextSessionId: "session-b",
        taskSessionId: "task-session:task-adopt-awaiting:session-b",
        roundId: "task-session:task-adopt-awaiting:session-b",
        acceptedRevision: null,
        phaseId: "phase-awaiting-1",
        agentRunId: null,
        status: "completed",
        executionMode: "parallel",
        parentSessionId: null,
        parentTaskSessionId: null,
        refreshTargets: {
          workflow: true,
          flow: true,
          messages: true,
        },
      },
    });

    const cpFetchCalls = cpFetchMock.mock.calls as unknown as Array<
      [string, RouteFetchOptions | undefined]
    >;
    expect(
      cpFetchCalls.some(
        ([url, options]) =>
          url === "/api/tasks/task-adopt-awaiting/phases/phase-awaiting-1/adopt" &&
          options?.method === "POST",
      ),
    ).toBe(true);
    expect(
      cpFetchCalls.some(
        ([url, options]) =>
          url ===
            "/api/tasks/task-adopt-awaiting/sessions/task-session%3Atask-adopt-awaiting%3Asession-b/activate" &&
          options?.method === "POST",
      ),
    ).toBe(false);
  });

  test("POST /:taskId/phases/:phaseId/candidates/:index/adopt rejects genuinely running candidate even when task is awaiting adoption", async () => {
    getSessionMessagesMock.mockResolvedValueOnce({ ok: true, data: [] } as never);
    agentRunRegistryMocks.findAgentRunBySessionId.mockImplementation((sessionId: string) =>
      sessionId === "session-b"
        ? ({ agentRunId: "agent-run-running", status: "running", subSessionId: "session-b" } as never)
        : undefined,
    );

    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-adopt-awaiting-running",
        response: {
          ok: true,
          data: {
            id: "task-adopt-awaiting-running",
            title: "Parallel clarify",
            projectId: "proj-adopt",
            prompt: "Clarify scope",
            status: "awaiting_adoption",
            orchestrationKind: "parallel",
            sessionId: "root-session",
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-awaiting-running/sessions",
        response: {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-adopt-awaiting-running:session-a",
                taskId: "task-adopt-awaiting-running",
                runtimeSessionId: "session-a",
                parentRuntimeSessionId: "root-session",
                branchName: "Candidate 1",
                sourceType: "fork",
                isActive: false,
                phaseId: "phase-awaiting-running-1",
                phaseRole: "candidate",
                phaseItemIndex: 0,
                candidateIndex: 0,
                executionStatus: "completed",
                sessionKind: "candidate",
                createdAt: "2026-03-19T10:00:01.000Z",
                updatedAt: "2026-03-19T10:00:12.000Z",
                archivedAt: null,
              },
              {
                id: "task-session:task-adopt-awaiting-running:session-b",
                taskId: "task-adopt-awaiting-running",
                runtimeSessionId: "session-b",
                parentRuntimeSessionId: "root-session",
                branchName: "Candidate 2",
                sourceType: "fork",
                isActive: true,
                phaseId: "phase-awaiting-running-1",
                phaseRole: "candidate",
                phaseItemIndex: 1,
                candidateIndex: 1,
                executionStatus: "running",
                sessionKind: "candidate",
                createdAt: "2026-03-19T10:00:02.000Z",
                updatedAt: "2026-03-19T10:00:13.000Z",
                archivedAt: null,
              },
            ],
          },
        },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-awaiting-running/phases/phase-awaiting-running-1/candidates/1/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Candidate 1 is not completed (status: running)",
    });

    const cpFetchCalls = cpFetchMock.mock.calls as unknown as Array<
      [string, RouteFetchOptions | undefined]
    >;
    expect(
      cpFetchCalls.some(
        ([url, options]) =>
          url === "/api/tasks/task-adopt-awaiting-running/phases/phase-awaiting-running-1/adopt" &&
          options?.method === "POST",
      ),
    ).toBe(false);
  });

  test("POST /:taskId/phases/:phaseId/candidates/:index/adopt treats legacy complete status as completed", async () => {
    getSessionMessagesMock.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: "msg-session-complete",
          info: {
            role: "assistant",
            created: Date.parse("2026-03-19T10:00:12.000Z"),
            completed: Date.parse("2026-03-19T10:00:13.000Z"),
          },
          parts: [{ type: "text", text: "候选 A 结果" }],
        },
      ],
    } as never);

    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-adopt-complete-status",
        response: {
          ok: true,
          data: {
            id: "task-adopt-complete-status",
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
        url: "/api/tasks/task-adopt-complete-status/sessions",
        response: {
          ok: true,
          data: {
            data: [
              {
                id: "task-session:task-adopt-complete-status:root-session",
                taskId: "task-adopt-complete-status",
                runtimeSessionId: "root-session",
                parentRuntimeSessionId: null,
                branchName: "main",
                sourceType: "root",
                isActive: true,
                coordinationKey: null,
                candidateIndex: null,
                executionStatus: "completed",
                createdAt: "2026-03-19T10:00:00.000Z",
                updatedAt: "2026-03-19T10:00:00.000Z",
                archivedAt: null,
              },
              {
                id: "task-session:task-adopt-complete-status:session-a",
                taskId: "task-adopt-complete-status",
                runtimeSessionId: "session-a",
                parentRuntimeSessionId: "root-session",
                branchName: "Candidate 1",
                sourceType: "fork",
                isActive: false,
                phaseId: "phase-parallel-complete",
                phaseRole: "candidate",
                phaseItemIndex: 0,
                coordinationKey: "coord-1",
                candidateIndex: 0,
                executionStatus: "complete",
                sessionKind: "candidate",
                createdAt: "2026-03-19T10:00:01.000Z",
                updatedAt: "2026-03-19T10:00:12.000Z",
                archivedAt: null,
              },
              {
                id: "task-session:task-adopt-complete-status:session-b",
                taskId: "task-adopt-complete-status",
                runtimeSessionId: "session-b",
                parentRuntimeSessionId: "root-session",
                branchName: "Candidate 2",
                sourceType: "fork",
                isActive: false,
                phaseId: "phase-parallel-complete",
                phaseRole: "candidate",
                phaseItemIndex: 1,
                coordinationKey: "coord-1",
                candidateIndex: 1,
                executionStatus: "running",
                sessionKind: "candidate",
                createdAt: "2026-03-19T10:00:02.000Z",
                updatedAt: "2026-03-19T10:00:09.000Z",
                archivedAt: null,
              },
            ],
          },
        },
      },
      {
        url: "/api/tasks/task-adopt-complete-status/phases/phase-parallel-complete/adopt",
        method: "POST",
        response: (options) => ({ ok: true, data: { ok: true, body: options?.body } }),
      },
      {
        url: "/api/tasks/task-adopt-complete-status/sessions/task-session%3Atask-adopt-complete-status%3Asession-a/activate",
        method: "POST",
        response: { ok: true, data: { ok: true } },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-complete-status/phases/phase-parallel-complete/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      phaseId: "phase-parallel-complete",
      winnerCandidateIndex: 0,
      execution: {
        action: "adopt",
        nextSessionId: "session-a",
        taskSessionId: "task-session:task-adopt-complete-status:session-a",
        roundId: "task-session:task-adopt-complete-status:session-a",
        acceptedRevision: null,
        phaseId: "phase-parallel-complete",
        agentRunId: null,
        status: "completed",
        executionMode: "parallel",
        parentSessionId: null,
        parentTaskSessionId: null,
        refreshTargets: {
          workflow: true,
          flow: true,
          messages: true,
        },
      },
    });
    const cpFetchCalls = cpFetchMock.mock.calls as unknown as Array<
      [string, RouteFetchOptions | undefined]
    >;
    const taskPatchCall = cpFetchCalls.find(
      ([url, options]) =>
        url === "/api/tasks/task-adopt-complete-status" && options?.method === "PATCH",
    );
    expect(taskPatchCall).toBeDefined();
    expect((taskPatchCall?.[1] as RouteFetchOptions | undefined)?.body).toEqual({
      status: "completed",
      sessionId: "session-a",
      result: "候选 A 结果",
    });
  });

  test("POST /:taskId/phases/:phaseId/candidates/:index/adopt returns 400 for invalid candidate index", async () => {
    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-invalid/phases/phase-invalid/candidates/not-a-number/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid candidate index" });
  });

  test("POST /:taskId/terminate returns the shared execution envelope for phase cancellation", async () => {
    mockCpFetchRoutes([
      {
        url: "/api/project-tree/tasks/task-stop-1",
        response: {
          ok: true,
          data: {
            id: "task-stop-1",
            title: "Stop execution",
            projectId: "proj-stop",
            prompt: "Stop the task",
            status: "running",
            sessionId: "session-live",
            executionMode: "single",
          },
        },
      },
      {
        url: "/api/tasks/task-stop-1/phases/phase-live-1/cancel",
        method: "POST",
        response: { ok: true, data: { ok: true, status: "cancelled" } },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-stop-1/terminate", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phaseId: "phase-live-1", sessionId: "session-live" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      phaseId: "phase-live-1",
      status: "cancelled",
      execution: {
        action: "terminate",
        nextSessionId: "session-live",
        taskSessionId: "task-session:task-stop-1:session-live",
        roundId: "task-session:task-stop-1:session-live",
        acceptedRevision: null,
        phaseId: "phase-live-1",
        agentRunId: null,
        status: "cancelled",
        executionMode: "single",
        parentSessionId: null,
        parentTaskSessionId: null,
        refreshTargets: {
          workflow: true,
          flow: true,
          messages: true,
        },
      },
    });
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    const broadcastCalls = wsBroadcastMock.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    expect(broadcastCalls[0]?.[0]).toMatchObject({
      type: "task.phase.cancelled",
      taskId: "task-stop-1",
      projectId: "proj-stop",
      sessionId: "session-live",
      phaseId: "phase-live-1",
      data: {
        phaseId: "phase-live-1",
        status: "cancelled",
        currentSessionId: "session-live",
      },
    });
  });

  test("POST /:taskId/phases/:phaseId/cancel broadcasts task.phase.cancelled on success", async () => {
    mockCpFetchRoutes([
      {
        url: "/api/tasks/task-cancel-1/phases/phase-cancel-1/cancel",
        method: "POST",
        response: {
          ok: true,
          data: {
            taskId: "task-cancel-1",
            phaseId: "phase-cancel-1",
            status: "cancelled",
            terminalReason: "user_cancelled",
            currentSessionId: "task-session:task-cancel-1:session-1",
          },
        },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-cancel-1/phases/phase-cancel-1/cancel",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "user_cancelled" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      taskId: "task-cancel-1",
      phaseId: "phase-cancel-1",
      status: "cancelled",
      terminalReason: "user_cancelled",
      currentSessionId: "task-session:task-cancel-1:session-1",
    });
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    const broadcastCalls = wsBroadcastMock.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    expect(broadcastCalls[0]?.[0]).toMatchObject({
      type: "task.phase.cancelled",
      taskId: "task-cancel-1",
      sessionId: "task-session:task-cancel-1:session-1",
      phaseId: "phase-cancel-1",
      data: {
        phaseId: "phase-cancel-1",
        status: "cancelled",
        terminalReason: "user_cancelled",
        currentSessionId: "task-session:task-cancel-1:session-1",
      },
    });
  });

  test("POST /:taskId/phases/:phaseId/resume broadcasts task.phase.resumed on success", async () => {
    mockCpFetchRoutes([
      {
        url: "/api/tasks/task-resume-1/phases/phase-resume-1/resume",
        method: "POST",
        response: {
          ok: true,
          data: {
            taskId: "task-resume-1",
            phaseId: "phase-resume-1",
            status: "running",
          },
        },
      },
    ]);

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-resume-1/phases/phase-resume-1/resume",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "reuse" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      taskId: "task-resume-1",
      phaseId: "phase-resume-1",
      status: "running",
    });
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    const broadcastCalls = wsBroadcastMock.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    expect(broadcastCalls[0]?.[0]).toMatchObject({
      type: "task.phase.resumed",
      taskId: "task-resume-1",
      phaseId: "phase-resume-1",
      data: {
        phaseId: "phase-resume-1",
        status: "running",
      },
    });
  });

  test("POST /:taskId/phases/:phaseId/candidates/:index/adopt returns 404 when task does not exist", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url, options] = args as [string, RouteFetchOptions | undefined];
      if (!options?.method && url === "/api/project-tree/tasks/task-adopt-missing") {
        return { ok: false, status: 404, data: { error: "Task not found" } };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request(
      "http://localhost/task-adopt-missing/phases/phase-missing/candidates/0/adopt",
      {
        method: "POST",
        headers: { Authorization: "Bearer test" },
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Task not found" });
  });

  test("POST /:taskId/phases/:phaseId/candidates/:index/adopt returns 400 when task orchestration is not parallel", async () => {
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
      "http://localhost/task-adopt-single/phases/phase-single/candidates/0/adopt",
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
