/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const createInternalAuthorizationMock = mock(async () => "Bearer internal");

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
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => ({
    hookExecutions: [],
    combinedResultText: undefined,
    rewrittenPrompt: undefined,
  })),
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

describe("task operating routes", () => {
  beforeEach(() => {
    cpFetchMock.mockReset();
    authHeaderMock.mockReset();
    createInternalAuthorizationMock.mockReset();
    authHeaderMock.mockReturnValue("Bearer test");
    createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  });

  test("returns operating state, operating mode, boss decisions and escalations from runtime storage", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-1/operating-runtime/state") {
        return {
          ok: true,
          data: {
            collaborationMode: "team",
            autopilotLevel: "L1",
            bossParticipationMode: "advisory",
            operatingModeSource: "project-default",
            currentStageKey: "implementation",
            currentStageStatus: "running",
          },
        };
      }

      if (url === "/api/tasks/task-1/operating-runtime/mode") {
        return {
          ok: true,
          data: {
            data: {
              collaborationMode: "team",
              autopilotLevel: "L1",
              bossParticipationMode: "advisory",
              selectedTemplateId: "tpl-1",
              scenarioKey: "release-guard",
              source: "task-override",
            },
          },
        };
      }

      if (url === "/api/tasks/task-1/operating-runtime/boss-decisions") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "decision-1",
                ts: "2026-03-15T10:00:00.000Z",
                decisionType: "advance-stage",
                reason: "Implementation ready",
                stageKey: "implementation",
              },
            ],
          },
        };
      }

      if (url === "/api/tasks/task-1/operating-runtime/escalations") {
        return {
          ok: true,
          data: {
            data: [
              {
                id: "escalation-1",
                ts: "2026-03-15T11:00:00.000Z",
                reason: "Need approval",
                status: "pending",
                requestedBy: "boss-agent",
              },
            ],
          },
        };
      }

      return { ok: true, data: {} };
    });

    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-operating-routes"
    );

    const operatingStateResponse = await taskRoutes.request(
      "http://localhost/task-1/operating-state",
      {
        headers: { Authorization: "Bearer test" },
      },
    );
    expect(operatingStateResponse.status).toBe(200);
    await expect(operatingStateResponse.json()).resolves.toMatchObject({
      collaborationMode: "team",
      autopilotLevel: "L1",
      bossParticipationMode: "advisory",
      operatingModeSource: "project-default",
      currentStageKey: "implementation",
      currentStageStatus: "running",
    });

    const operatingModeResponse = await taskRoutes.request(
      "http://localhost/task-1/operating-mode",
      {
        headers: { Authorization: "Bearer test" },
      },
    );
    expect(operatingModeResponse.status).toBe(200);
    await expect(operatingModeResponse.json()).resolves.toMatchObject({
      data: {
        collaborationMode: "team",
        autopilotLevel: "L1",
        bossParticipationMode: "advisory",
        selectedTemplateId: "tpl-1",
        scenarioKey: "release-guard",
        source: "task-override",
      },
    });

    const bossDecisionsResponse = await taskRoutes.request(
      "http://localhost/task-1/boss-decisions",
      {
        headers: { Authorization: "Bearer test" },
      },
    );
    expect(bossDecisionsResponse.status).toBe(200);
    await expect(bossDecisionsResponse.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: "decision-1",
          decisionType: "advance-stage",
          reason: "Implementation ready",
        }),
      ],
    });

    const escalationsResponse = await taskRoutes.request("http://localhost/task-1/escalations", {
      headers: { Authorization: "Bearer test" },
    });
    expect(escalationsResponse.status).toBe(200);
    await expect(escalationsResponse.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: "escalation-1",
          reason: "Need approval",
          status: "pending",
        }),
      ],
    });
  });

  test("falls back to persisted task strategy when runtime route is unavailable", async () => {
    cpFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/tasks/task-legacy/operating-runtime/state") {
        return { ok: false, status: 404, data: { error: "Not found" } };
      }

      if (url === "/api/tasks/task-legacy") {
        return {
          ok: true,
          data: {
            id: "task-legacy",
            title: "Legacy Task",
            projectId: "project-1",
            status: "running",
            strategy: JSON.stringify({
              collaborationMode: "hybrid",
              autopilotLevel: "L2",
              bossParticipationMode: "full-manager",
              operatingModeSource: "boss-decision",
            }),
          },
        };
      }

      return { ok: false, status: 404, data: { error: "Not found" } };
    });

    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-operating-routes-legacy"
    );

    const response = await taskRoutes.request("http://localhost/task-legacy/operating-state", {
      headers: { Authorization: "Bearer test" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      collaborationMode: "hybrid",
      autopilotLevel: "L2",
      bossParticipationMode: "full-manager",
      operatingModeSource: "boss-decision",
    });
  });
});
