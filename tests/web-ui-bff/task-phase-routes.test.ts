/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createRuntimeProviderModuleMock } from "./runtime-provider-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const wsBroadcastMock = mock(() => undefined);

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider",
  () =>
    createRuntimeProviderModuleMock({
      buildExecutionContext: mock(() => ""),
      continueSession: mock(async () => ({ ok: true })),
      createSession: mock(async () => ({ ok: true, sessionId: "session-1", agentRunId: "run-1" })),
      ensureAgentRunForSession: mock(() => "run-1"),
      extractAssistantResultFromMessages: mock(() => ({
        completed: false,
        failed: false,
        error: undefined,
        text: undefined,
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
      terminateAgent: mock(async () => ({ ok: true })),
      updateAgentRunStatus: mock(() => undefined),
    }),
);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/agent-run-registry", () => ({
  ensureAgentRunForSession: mock(() => "run-1"),
  findAgentRunBySessionId: mock(() => undefined),
  registerAgentRun: mock(() => undefined),
  recoverAgentRun: mock(() => undefined),
  getAgentRunState: mock(() => undefined),
  markAgentRunPromptSent: mock(() => undefined),
  setAgentRunPausedAt: mock(() => undefined),
  updateAgentRunStatus: mock(() => undefined),
  getAgentRun: mock(() => undefined),
  listAgentRuns: mock(() => []),
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
  buildStageArtifactSummary: mock((resultText?: string) => ({
    summary: resultText ?? "",
    excerpt: resultText ?? "",
    completionMarked: false,
    capturedAt: "2026-04-16T10:00:00.000Z",
    source: "assistant-output",
  })),
  buildWorkflowExecutionPromptSnapshot: mock(async () => null),
}));

async function loadTaskRoutes() {
  return import("../../control-plane/web-ui-bff/src/modules/tasks/routes");
}

describe("task phase routes", () => {
  beforeEach(() => {
    cpFetchMock.mockReset();
    authHeaderMock.mockReset();
    createInternalAuthorizationMock.mockReset();
    wsBroadcastMock.mockReset();

    authHeaderMock.mockReturnValue("Bearer test");
    createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  });

  test("GET /:taskId/phases/:phaseId/view proxies the phase-first view contract", async () => {
    cpFetchMock.mockResolvedValue({
      ok: true,
      data: {
        data: {
          phase: {
            id: "phase-1",
            phaseIndex: 2,
            phaseKind: "parallel",
            status: "awaiting_adoption",
          },
          sessions: [
            {
              id: "task-session:task-1:session-a",
              runtimeSessionId: "session-a",
              phaseRole: "candidate",
              phaseItemIndex: 0,
            },
          ],
          messageGroups: [
            {
              taskSessionId: "task-session:task-1:session-a",
              runtimeSessionId: "session-a",
              phaseRole: "candidate",
              phaseItemIndex: 0,
              messages: [
                {
                  id: "msg-a-1",
                  textContent: "候选 A 回复",
                },
              ],
            },
          ],
          meta: {
            currentSessionId: "task-session:task-1:session-root",
            currentPhaseId: "phase-1",
          },
        },
      },
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-1/phases/phase-1/view", {
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        phase: {
          id: "phase-1",
          phaseIndex: 2,
          phaseKind: "parallel",
          status: "awaiting_adoption",
        },
        sessions: [
          {
            id: "task-session:task-1:session-a",
            runtimeSessionId: "session-a",
            phaseRole: "candidate",
            phaseItemIndex: 0,
          },
        ],
        messageGroups: [
          {
            taskSessionId: "task-session:task-1:session-a",
            runtimeSessionId: "session-a",
            phaseRole: "candidate",
            phaseItemIndex: 0,
            messages: [
              {
                id: "msg-a-1",
                textContent: "候选 A 回复",
              },
            ],
          },
        ],
        meta: {
          currentSessionId: "task-session:task-1:session-root",
          currentPhaseId: "phase-1",
        },
      },
    });
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/phases/phase-1/view",
      expect.objectContaining({ authorization: "Bearer test" }),
    );
  });

  test("POST /:taskId/phases broadcasts task.phase.created for new phases", async () => {
    cpFetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      data: {
        id: "phase-1",
        phaseIndex: 1,
        phaseKind: "single",
        triggerType: "execute",
        status: "running",
        parentPhaseId: null,
        resumedFromPhaseId: null,
        candidateCount: null,
        winnerSessionId: null,
        judgeSessionId: null,
        startedAt: "2026-04-16T10:00:00.000Z",
        finishedAt: null,
        createdAt: "2026-04-16T10:00:00.000Z",
        updatedAt: "2026-04-16T10:00:01.000Z",
      },
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-1/phases", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phaseKind: "single",
        triggerType: "execute",
        status: "running",
      }),
    });

    expect(response.status).toBe(201);
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    expect(wsBroadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.phase.created",
        taskId: "task-1",
        phaseId: "phase-1",
        data: expect.objectContaining({
          phaseId: "phase-1",
          status: "running",
          phaseKind: "single",
          triggerType: "execute",
        }),
      }),
    );
  });

  test("POST /:taskId/phases broadcasts task.phase.updated for running updates", async () => {
    cpFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: "phase-2",
        phaseIndex: 2,
        phaseKind: "parallel",
        triggerType: "continue",
        status: "running",
        parentPhaseId: "phase-1",
        resumedFromPhaseId: null,
        candidateCount: 3,
        winnerSessionId: null,
        judgeSessionId: null,
        startedAt: "2026-04-16T11:00:00.000Z",
        finishedAt: null,
        createdAt: "2026-04-16T11:00:00.000Z",
        updatedAt: "2026-04-16T11:00:05.000Z",
      },
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-1/phases", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "phase-2",
        phaseKind: "parallel",
        triggerType: "continue",
        status: "running",
      }),
    });

    expect(response.status).toBe(200);
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    expect(wsBroadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.phase.updated",
        taskId: "task-1",
        phaseId: "phase-2",
        data: expect.objectContaining({
          phaseId: "phase-2",
          status: "running",
          phaseKind: "parallel",
          triggerType: "continue",
          parentPhaseId: "phase-1",
          candidateCount: 3,
        }),
      }),
    );
  });

  test("POST /:taskId/phases broadcasts task.phase.failed for failed phase writes", async () => {
    cpFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: "phase-3",
        phaseIndex: 3,
        phaseKind: "parallel",
        triggerType: "execute",
        status: "failed",
        parentPhaseId: "phase-root",
        resumedFromPhaseId: null,
        candidateCount: 2,
        winnerSessionId: null,
        judgeSessionId: null,
        startedAt: "2026-04-16T12:00:00.000Z",
        finishedAt: "2026-04-16T12:00:07.000Z",
        createdAt: "2026-04-16T12:00:00.000Z",
        updatedAt: "2026-04-16T12:00:07.000Z",
      },
    });

    const { taskRoutes } = await loadTaskRoutes();
    const response = await taskRoutes.request("http://localhost/task-1/phases", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "phase-3",
        phaseKind: "parallel",
        triggerType: "execute",
        status: "failed",
      }),
    });

    expect(response.status).toBe(200);
    expect(wsBroadcastMock).toHaveBeenCalledTimes(1);
    expect(wsBroadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.phase.failed",
        taskId: "task-1",
        phaseId: "phase-3",
        data: expect.objectContaining({
          phaseId: "phase-3",
          status: "failed",
          phaseKind: "parallel",
          triggerType: "execute",
          parentPhaseId: "phase-root",
          candidateCount: 2,
          finishedAt: "2026-04-16T12:00:07.000Z",
        }),
      }),
    );
  });
});