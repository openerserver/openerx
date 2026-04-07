/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as strategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import { normalizeOrchestrationStrategy } from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import { createRuntimeProviderModuleMock } from "./runtime-provider-mock";
import { createSseAggregatorModuleMock } from "./sse-aggregator-mock";

const createSessionMock = mock(async () => ({
  ok: true,
  sessionId: "session-test",
  agentRunId: "run-test",
}));
const authHeaderMock = mock(() => "Bearer test");
const executeLifecycleHooksMock = mock(async () => ({
  hookExecutions: [],
  combinedResultText: undefined,
  rewrittenPrompt: undefined,
}));
const cpFetchMock = mock(async () => ({ ok: true, data: {} }));

let currentTask = {
  id: "task-1",
  title: "Implement workflow runtime",
  prompt: "Connect workflow execution to stage dispatcher.",
  projectId: "proj-1",
  strategy: "{}",
  status: "pending",
  selectedModel: undefined,
};

let currentStrategy = normalizeOrchestrationStrategy({
  hooks: [],
  templates: [
    {
      id: "single-template",
      name: "Single Template",
      mode: "single",
      agents: ["default-executor"],
      enabled: true,
    },
  ],
});
let workflowInitialized = false;

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider", () =>
  createRuntimeProviderModuleMock({
    buildExecutionContext: mock(() => ""),
    continueSession: mock(async () => ({ ok: true })),
    createSession: createSessionMock,
    ensureAgentRunForSession: mock(() => "run-test"),
    extractAssistantResultFromMessages: mock(() => ({
      completed: false,
      failed: false,
      error: undefined,
      tokenUsed: 0,
    })),
    forkSession: mock(async () => ({ ok: true, sessionId: "forked-session" })),
    findAgentRunBySessionId: mock(() => undefined),
    getAgentRun: mock(() => undefined),
    getAgentMessages: mock(async () => ({ ok: true, data: [] })),
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
    runDetachedPrompt: mock(async () => ({ ok: true, sessionId: "detached", text: "{}" })),
    terminateAgent: mock(async () => ({ ok: true })),
    updateAgentRunStatus: mock(() => undefined),
  }),
);

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: mock(async () => "Bearer internal"),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/intent-classifier", () => ({
  classifyIntent: mock(() => ({
    category: "implementation",
    complexity: "medium",
    suggestedAgents: ["default-executor"],
    requiresPlan: false,
    confidence: 0.9,
  })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/model-config", () => ({
  formatModelRoute: mock((value: { providerId?: string; modelId?: string } | string) =>
    typeof value === "string"
      ? value
      : `${value.providerId || "github-copilot"}:${value.modelId || "gpt-5.4"}`,
  ),
  readDefaultExecutionModel: mock(() => undefined),
  resolveModelRoute: mock((raw: string) => ({ providerId: "github-copilot", modelId: raw })),
  validateModelProvider: mock(() => ({ valid: true })),
  diagnoseModelReadiness: mock(async () => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...strategyModule,
  readOrchestrationStrategy: () => currentStrategy,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: executeLifecycleHooksMock,
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
  wsBroadcaster: { broadcast: mock(() => undefined) },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/stage-intervention", () => ({
  dispatchStageIntervention: mock(async () => undefined),
}));

function getTaskExecuteWorkflowResponse() {
  if (workflowInitialized) {
    return {
      ok: true,
      data: {
        data: {
          workflowRun: {
            id: "wf-1",
            currentStage: "clarify",
            status: "running",
            templateId: "tpl-1",
          },
          stages: [
            {
              id: "run-clarify",
              stageKey: "clarify",
              status: "running",
              approvalState: "not-required",
            },
            {
              id: "run-design",
              stageKey: "design",
              status: "pending",
              approvalState: "not-required",
            },
            {
              id: "run-implement",
              stageKey: "implement",
              status: "pending",
              approvalState: "not-required",
            },
          ],
        },
      },
    };
  }

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

function getTaskExecuteReadResponse(url: string) {
  if (url === "/api/project-tree/tasks/task-1") {
    return { ok: true, data: currentTask };
  }

  if (url === "/api/projects/proj-1") {
    return {
      ok: true,
      data: {
        settings: {
          workflowTemplateId: "tpl-1",
        },
      },
    };
  }

  if (url === "/api/tasks/task-1/workflow") {
    return getTaskExecuteWorkflowResponse();
  }

  if (url === "/api/workflow-templates/tpl-1/stages") {
    return {
      ok: true,
      data: {
        data: [
          { id: "stage-clarify", stageKey: "clarify", orderIndex: 0, enabled: true },
          { id: "stage-design", stageKey: "design", orderIndex: 1, enabled: true },
          { id: "stage-implement", stageKey: "implement", orderIndex: 2, enabled: true },
        ],
      },
    };
  }

  return null;
}

function getTaskExecuteWriteResponse(url: string, method: string, body?: unknown) {
  if (method === "PATCH" && url === "/api/tasks/task-1") {
    return { ok: true, data: { ok: true, body } };
  }

  if (method === "POST" && url === "/api/tasks/task-1/workflow/initialize") {
    workflowInitialized = true;
    return { ok: true, data: { ok: true, body } };
  }

  if (method === "POST" && url === "/api/tasks/task-1/workflow/advance") {
    return { ok: true, data: { ok: true, body } };
  }

  return null;
}

beforeEach(() => {
  createSessionMock.mockReset();
  authHeaderMock.mockReset();

  executeLifecycleHooksMock.mockReset();
  cpFetchMock.mockReset();

  currentTask = {
    id: "task-1",
    title: "Implement workflow runtime",
    prompt: "Connect workflow execution to stage dispatcher.",
    projectId: "proj-1",
    strategy: "{}",
    status: "pending",
    selectedModel: undefined,
  };
  currentStrategy = normalizeOrchestrationStrategy({
    hooks: [],
    templates: [
      {
        id: "single-template",
        name: "Single Template",
        mode: "single",
        agents: ["default-executor"],
        enabled: true,
      },
    ],
  });
  workflowInitialized = false;

  createSessionMock.mockResolvedValue({
    ok: true,
    sessionId: "session-test",
    agentRunId: "run-test",
  });
  authHeaderMock.mockReturnValue("Bearer test");
  executeLifecycleHooksMock.mockResolvedValue({
    hookExecutions: [],
    combinedResultText: undefined,
    rewrittenPrompt: undefined,
  });

  cpFetchMock.mockImplementation(
    async (url: string, options?: { method?: string; body?: unknown }) => {
      const method = options?.method;
      if (!method) {
        return getTaskExecuteReadResponse(url) || { ok: true, data: { ok: true } };
      }

      return (
        getTaskExecuteWriteResponse(url, method, options?.body) || {
          ok: true,
          data: { ok: true },
        }
      );
    },
  );
});

describe("task execute route stage dispatch", () => {
  test("registers the started session with the resolved model route", async () => {
    currentTask.selectedModel = "gpt-5-mini";

    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-execute-stage-dispatch-model-route"
    );

    const response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
      },
    });

    expect(response.status).toBe(200);

    const taskPatchCall = cpFetchMock.mock.calls.find(
      ([path, options]) => path === "/api/tasks/task-1" && options?.method === "PATCH",
    );
    expect(taskPatchCall?.[1]).toMatchObject({
      body: expect.objectContaining({
        strategy: expect.stringContaining('"effectiveModel":"github-copilot:gpt-5-mini"'),
      }),
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/sessions", {
      method: "POST",
      authorization: "Bearer test",
      body: expect.objectContaining({
        runtimeSessionId: "session-test",
        branchName: "Implement workflow runtime",
        sourceType: "root",
      }),
    });
  });

  test("execute route no longer triggers workflow startup stage dispatch", async () => {
    const { taskRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/tasks/routes?task-execute-stage-dispatch-route"
    );

    const response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
      },
    });
    const body = await response.json();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      taskId: "task-1",
      sessionId: "session-test",
      agentRunId: "run-test",
      status: "running",
    });

    const taskPatchCall = cpFetchMock.mock.calls.find(
      ([path, options]) => path === "/api/tasks/task-1" && options?.method === "PATCH",
    );
    expect(taskPatchCall?.[1]).toMatchObject({
      body: expect.objectContaining({
        strategy: expect.stringContaining('"workflowTemplateId":"tpl-1"'),
      }),
    });
    const cpFetchCalls = cpFetchMock.mock.calls as Array<
      [string, { method?: string; body?: unknown } | undefined]
    >;
    expect(
      cpFetchCalls.some(
        ([path, options]) =>
          path === "/api/tasks/task-1/workflow/initialize" && options?.method === "POST",
      ),
    ).toBe(false);
    expect(
      cpFetchCalls.some(
        ([path, options]) =>
          path === "/api/tasks/task-1/workflow/advance" && options?.method === "POST",
      ),
    ).toBe(false);
  });
});
