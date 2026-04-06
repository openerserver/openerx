/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as orchestrationStrategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import {
  createOpencodeAdapterModuleMock,
  createRuntimeProviderModuleMock,
} from "./opencode-adapter-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

type ControlPlaneFetchHandler = ((request: Request) => Promise<Response> | Response) | null;

let controlPlaneFetchHandler: ControlPlaneFetchHandler = null;

function setMockControlPlaneFetchHandler(fetchHandler: ControlPlaneFetchHandler) {
  controlPlaneFetchHandler = fetchHandler;
}

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: (c: { req: { header: (name: string) => string | undefined } }) =>
    c.req.header("Authorization") || "",
  cpFetch: async <T = unknown>(
    path: string,
    opts: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      authorization?: string;
    } = {},
  ) => {
    if (!controlPlaneFetchHandler) {
      return { ok: false, status: 502, data: { error: "Control plane unreachable" } as T };
    }

    const request = new Request(`http://internal-control-plane${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(opts.authorization ? { Authorization: opts.authorization } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const response = await controlPlaneFetchHandler(request);
    const text = await response.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    return { ok: response.ok, status: response.status, data };
  },
  createInternalAuthorization: mock(async () => "Bearer internal"),
  setControlPlaneFetchHandler: setMockControlPlaneFetchHandler,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...orchestrationStrategyModule,
  readOrchestrationStrategy: mock(() => ({ hooks: [], templates: [], judge: { enabled: false } })),
}));

const opencodeAdapterModule = createOpencodeAdapterModuleMock({
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
  getAgentMessages: mock(async () => ({ ok: true, data: [] })),
  getAgentRun: mock(() => undefined),
  getSessionMessages: mock(async () => ({ ok: true, data: [] })),
  injectGuidance: mock(async () => ({ ok: true })),
  listAgentRuns: mock(() => []),
  listRuntimePermissions: mock(async () => ({ ok: true, data: [] })),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  pauseAgent: mock(async () => ({ ok: true })),
  registerAgentRun: mock(() => undefined),
  recoverAgentRun: mock(() => undefined),
  replyRuntimePermission: mock(async () => ({ ok: true })),
  resumeAgent: mock(async () => ({ ok: true })),
  runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "session-detached", text: "{}" })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
});

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter",
  () => opencodeAdapterModule,
);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider", () =>
  createRuntimeProviderModuleMock(opencodeAdapterModule),
);

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: mock(async () => ({
    hookExecutions: [],
    combinedResultText: undefined,
    rewrittenPrompt: undefined,
  })),
  mergeStageAndStrategyHooks: mock(
    (_stageHooks: unknown, strategyHooks: unknown) => strategyHooks ?? [],
  ),
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

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () =>
  createSseAggregatorModuleMock({
    registerParallelTask: mock(() => undefined),
  }),
);

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: {
    broadcast: mock(() => undefined),
  },
}));

describe("task operating routes", () => {
  afterEach(() => {
    setMockControlPlaneFetchHandler(null);
  });

  beforeEach(() => {
    setMockControlPlaneFetchHandler(null);
  });

  test("returns operating state, operating mode, boss decisions and escalations from runtime storage", async () => {
    setMockControlPlaneFetchHandler((request) => {
      const url = new URL(request.url);

      if (url.pathname === "/api/tasks/task-1/operating-runtime/state") {
        return Response.json({
          collaborationMode: "team",
          autopilotLevel: "L1",
          bossParticipationMode: "advisory",
          operatingModeSource: "project-default",
          currentStageKey: "implementation",
          currentStageStatus: "running",
        });
      }

      if (url.pathname === "/api/tasks/task-1/operating-runtime/mode") {
        return Response.json({
          data: {
            collaborationMode: "team",
            autopilotLevel: "L1",
            bossParticipationMode: "advisory",
            selectedTemplateId: "tpl-1",
            scenarioKey: "release-guard",
            source: "task-override",
          },
        });
      }

      if (url.pathname === "/api/tasks/task-1/operating-runtime/boss-decisions") {
        return Response.json({
          data: [
            {
              id: "decision-1",
              ts: "2026-03-15T10:00:00.000Z",
              decisionType: "advance-stage",
              reason: "Implementation ready",
              stageKey: "implementation",
            },
          ],
        });
      }

      if (url.pathname === "/api/tasks/task-1/operating-runtime/escalations") {
        return Response.json({
          data: [
            {
              id: "escalation-1",
              ts: "2026-03-15T11:00:00.000Z",
              reason: "Need approval",
              status: "pending",
              requestedBy: "boss-agent",
            },
          ],
        });
      }

      return Response.json({});
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

  test("returns runtime storage errors directly when operating-state is unavailable", async () => {
    setMockControlPlaneFetchHandler((request) => {
      const url = new URL(request.url);

      if (url.pathname === "/api/tasks/task-legacy/operating-runtime/state") {
        return Response.json({ error: "Not found" }, { status: 404 });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    });

    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-operating-routes-legacy"
    );

    const response = await taskRoutes.request("http://localhost/task-legacy/operating-state", {
      headers: { Authorization: "Bearer test" },
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Not found" });
  });
});
