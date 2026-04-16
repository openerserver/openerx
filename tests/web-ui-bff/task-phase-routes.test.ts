/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createRuntimeProviderModuleMock } from "./runtime-provider-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");

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
    broadcast: mock(() => undefined),
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
});