/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as orchestrationStrategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import { createRuntimeProviderModuleMock } from "./runtime-provider-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer tree-token");
const createInternalAuthorizationMock = mock(async () => "Bearer internal-token");
const setControlPlaneFetchHandlerMock = mock(() => undefined);

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
  setControlPlaneFetchHandler: setControlPlaneFetchHandlerMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/model-config", () => ({
  diagnoseModelReadiness: mock(() => ({ ready: true })),
  formatModelRoute: mock((value: string) => value),
  readDefaultExecutionModel: mock(() => "github-copilot:gpt-5.4"),
  resolveModelRoute: mock((value: string) => ({
    providerId: value.split(":")[0] || "github-copilot",
    modelId: value.split(":").slice(1).join(":") || value,
  })),
  validateModelProvider: mock(() => true),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...orchestrationStrategyModule,
  readOrchestrationStrategy: mock(() => ({ hooks: [], templates: [], judge: { enabled: false } })),
}));

const runtimeProviderModule = createRuntimeProviderModuleMock({
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
  getAgentMessages: mock(async () => ({ ok: true, data: [] })),
  getSessionMessages: mock(async () => ({ ok: true, data: [] })),
  injectGuidance: mock(async () => ({ ok: true })),
  listAgentRuns: mock(() => []),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  pauseAgent: mock(async () => ({ ok: true })),
  registerAgentRun: mock(() => undefined),
  recoverAgentRun: mock(() => undefined),
  resumeAgent: mock(async () => ({ ok: true })),
  runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "detached", text: "{}" })),
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
});

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider", () =>
  runtimeProviderModule,
);

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  authHeaderMock.mockReturnValue("Bearer tree-token");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal-token");
  cpFetchMock.mockResolvedValue({ ok: true, status: 200, data: {} });
});

describe("project tree proxy routes", () => {
  test("forwards tree query params to control plane", async () => {
    cpFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: [{ id: "root", path: "proj_default", depth: 0, nodeType: "project_root" }],
      },
    });

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );
    const response = await projectRoutes.request(
      "http://localhost/proj-1/tree?depth=2&nodeType=task",
      {
        headers: { Authorization: "Bearer tree-token" },
      },
    );

    expect(response.status).toBe(200);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/projects/proj-1/tree?depth=2&nodeType=task", {
      authorization: "Bearer tree-token",
    });
    expect(await response.json()).toEqual({
      data: [{ id: "root", path: "proj_default", depth: 0, nodeType: "project_root" }],
    });
  });

  test("forwards branch updates with body payload", async () => {
    cpFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: "branch-1",
        projectId: "proj-1",
        branchName: "main",
        headNodeId: "node-2",
        isDefault: true,
      },
    });

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );
    const response = await projectRoutes.request("http://localhost/proj-1/branches/branch-1", {
      method: "PUT",
      headers: {
        Authorization: "Bearer tree-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ headNodeId: "node-2", isDefault: true }),
    });

    expect(response.status).toBe(200);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/projects/proj-1/branches/branch-1", {
      method: "PUT",
      body: { headNodeId: "node-2", isDefault: true },
      authorization: "Bearer tree-token",
    });
    expect(await response.json()).toMatchObject({ headNodeId: "node-2", isDefault: true });
  });

  test("forwards node links lookup", async () => {
    cpFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: [
          {
            id: "link-1",
            sourceNodeId: "node-1",
            targetNodeId: "node-2",
            sourceProjectId: "proj-1",
            targetProjectId: "proj-1",
            linkType: "cites",
            direction: "outgoing",
          },
        ],
      },
    });

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );
    const response = await projectRoutes.request("http://localhost/proj-1/tree/node-1/links", {
      headers: { Authorization: "Bearer tree-token" },
    });

    expect(response.status).toBe(200);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/projects/proj-1/tree/node-1/links", {
      authorization: "Bearer tree-token",
    });
    expect(await response.json()).toEqual({
      data: [
        expect.objectContaining({
          id: "link-1",
          linkType: "cites",
          direction: "outgoing",
        }),
      ],
    });
  });
});
