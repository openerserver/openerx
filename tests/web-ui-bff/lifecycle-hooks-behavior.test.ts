import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as strategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import {
  type OrchestrationStrategy,
  normalizeOrchestrationStrategy,
} from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";

mock.restore();

const originalAllowPaidExecution = process.env.ALLOW_PAID_MODEL_EXECUTION;
const originalLowCostExecutionModel = process.env.LOW_COST_EXECUTION_MODEL;

async function loadLifecycleHooksModule() {
  return import(
    "../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks?lifecycle-hooks-behavior-test"
  );
}

async function loadAgentControlRoutesModule() {
  return import(
    "../../control-plane/web-ui-bff/src/modules/agent-control/routes?lifecycle-hooks-behavior-test"
  );
}

async function loadTaskRoutesModule() {
  return import(
    "../../control-plane/web-ui-bff/src/modules/tasks/routes?lifecycle-hooks-behavior-test"
  );
}

const runDetachedPromptMock = mock(async () => ({
  ok: true,
  completed: true,
  text: "",
  sessionId: "session-test",
}));
const continueSessionMock = mock(async () => ({ ok: true }));
const createSessionMock = mock(async () => ({
  ok: true,
  sessionId: "session-test",
  agentRunId: "run-test",
}));
const getAgentRunMock = mock(() => ({
  taskId: "task-1",
  projectId: "proj-1",
  status: "paused",
}));
const injectGuidanceMock = mock(async () => ({ ok: true }));
const resumeAgentMock = mock(async () => ({ ok: true }));
const registerParallelTaskMock = mock(() => undefined);
const authHeaderMock = mock(() => "Bearer test");
const readDefaultExecutionModelMock = mock(() => undefined as string | undefined);
const resolveModelRouteMock = mock((raw: string) => {
  const value = raw.trim();
  const colonIndex = value.indexOf(":");
  if (colonIndex > 0) {
    return { providerId: value.slice(0, colonIndex), modelId: value.slice(colonIndex + 1) };
  }

  const slashIndex = value.indexOf("/");
  if (slashIndex > 0) {
    return { providerId: value.slice(0, slashIndex), modelId: value.slice(slashIndex + 1) };
  }

  return { providerId: "github-copilot", modelId: value };
});
const formatModelRouteMock = mock(
  (resolvedModel: { providerId: string; modelId: string }) =>
    `${resolvedModel.providerId}:${resolvedModel.modelId}`,
);
const validateModelProviderMock = mock(() => ({ valid: true as const }));
const diagnoseModelReadinessMock = mock(
  async () => undefined as undefined | Record<string, unknown>,
);
const executeLifecycleHooksMock = mock(async () => ({
  hookExecutions: [] as Array<Record<string, unknown>>,
  combinedResultText: undefined as string | undefined,
  rewrittenPrompt: undefined as string | undefined,
}));
let currentStrategy = strategyModule.normalizeOrchestrationStrategy({
  hooks: [
    {
      id: "pre-resume-1",
      trigger: "pre-resume",
      enabled: true,
      agent: "reviewer",
      promptTemplate: "Resume {{taskPrompt}}",
      timeoutMs: 1000,
      order: 0,
    },
  ],
});
let currentTask = {
  id: "task-1",
  title: "Paused task",
  prompt: "Original paused prompt",
  projectId: "proj-1",
  sessionId: "session-existing",
  strategy: "{}",
  status: "pending",
};
const cpFetchMock = mock(async (_url: string, options?: { method?: string }) => {
  if (!options?.method) {
    return {
      ok: true,
      data: currentTask,
    };
  }

  return { ok: true, data: {} };
});
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const broadcastMock = mock(() => undefined);

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
  createSession: createSessionMock,
  continueSession: continueSessionMock,
  ensureAgentRunForSession: mock(() => "run-test"),
  extractAssistantResultFromMessages: mock(() => ({
    completed: false,
    failed: false,
    error: undefined,
    tokenUsed: 0,
  })),
  findAgentRunBySessionId: mock(() => undefined),
  forkSession: mock(async () => ({ ok: true, sessionId: "forked-session" })),
  getSessionMessages: mock(async () => ({ ok: true, data: [] })),
  runDetachedPrompt: runDetachedPromptMock,
  getAgentMessages: mock(async () => ({ ok: true, data: [] })),
  getAgentRun: getAgentRunMock,
  injectGuidance: injectGuidanceMock,
  listAgentRuns: mock(() => []),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  pauseAgent: mock(async () => ({ ok: true })),
  recoverAgentRun: mock(() => undefined),
  resumeAgent: resumeAgentMock,
  terminateAgent: mock(async () => ({ ok: true })),
  updateAgentRunStatus: mock(() => undefined),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/opencode-config", () => ({
  formatModelRoute: formatModelRouteMock,
  readDefaultExecutionModel: readDefaultExecutionModelMock,
  resolveModelRoute: resolveModelRouteMock,
  validateModelProvider: validateModelProviderMock,
  diagnoseModelReadiness: diagnoseModelReadinessMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...strategyModule,
  readOrchestrationStrategy: () => currentStrategy,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: executeLifecycleHooksMock,
  parseStageHooks: (raw: unknown) => (Array.isArray(raw) ? raw : []),
  mergeStageAndStrategyHooks: (_stage: unknown[], strategy: unknown[]) => strategy ?? [],
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: { broadcast: broadcastMock },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator", () => ({
  sseAggregator: { registerParallelTask: registerParallelTaskMock },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/dag-sync", () => ({
  syncGraphsForSessionTask: mock(async () => undefined),
  syncGraphsForTask: mock(async () => undefined),
}));

function buildStrategy(overrides: Partial<OrchestrationStrategy> = {}): OrchestrationStrategy {
  return normalizeOrchestrationStrategy(overrides);
}

beforeEach(() => {
  runDetachedPromptMock.mockReset();
  continueSessionMock.mockReset();
  createSessionMock.mockReset();
  getAgentRunMock.mockReset();
  injectGuidanceMock.mockReset();
  resumeAgentMock.mockReset();
  registerParallelTaskMock.mockReset();
  authHeaderMock.mockReset();
  readDefaultExecutionModelMock.mockReset();
  formatModelRouteMock.mockReset();
  resolveModelRouteMock.mockClear();
  validateModelProviderMock.mockReset();
  diagnoseModelReadinessMock.mockReset();
  executeLifecycleHooksMock.mockReset();
  cpFetchMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  broadcastMock.mockReset();

  currentStrategy = buildStrategy({
    hooks: [
      {
        id: "pre-resume-1",
        trigger: "pre-resume",
        enabled: true,
        agent: "reviewer",
        promptTemplate: "Resume {{taskPrompt}}",
        timeoutMs: 1000,
        order: 0,
      },
    ],
  });
  currentTask = {
    id: "task-1",
    title: "Paused task",
    prompt: "Original paused prompt",
    projectId: "proj-1",
    sessionId: "session-existing",
    strategy: "{}",
    status: "pending",
  };

  getAgentRunMock.mockImplementation(() => ({
    taskId: "task-1",
    projectId: "proj-1",
    status: "paused",
  }));
  injectGuidanceMock.mockResolvedValue({ ok: true });
  resumeAgentMock.mockResolvedValue({ ok: true });
  createSessionMock.mockResolvedValue({
    ok: true,
    sessionId: "session-test",
    agentRunId: "run-test",
  });
  continueSessionMock.mockResolvedValue({ ok: true });
  authHeaderMock.mockReturnValue("Bearer test");
  readDefaultExecutionModelMock.mockReturnValue(undefined);
  formatModelRouteMock.mockImplementation(
    (resolvedModel: { providerId: string; modelId: string }) =>
      `${resolvedModel.providerId}:${resolvedModel.modelId}`,
  );
  validateModelProviderMock.mockReturnValue({ valid: true });
  diagnoseModelReadinessMock.mockResolvedValue(undefined);
  executeLifecycleHooksMock.mockResolvedValue({
    hookExecutions: [],
    combinedResultText: undefined,
    rewrittenPrompt: undefined,
  });
  cpFetchMock.mockImplementation(
    async (url: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method) {
        if (url.includes("/paid-execution-lease")) {
          return {
            ok: true,
            data: {
              projectId: "proj-1",
              activeLease: null,
              now: "2026-03-10T00:00:00.000Z",
            },
          };
        }

        if (url.includes("/api/projects/")) {
          return { ok: true, data: { settings: {} } };
        }

        return {
          ok: true,
          data: currentTask,
        };
      }

      return { ok: true, data: { body: options.body } };
    },
  );
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal");

  if (originalAllowPaidExecution === undefined) {
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;
  } else {
    process.env.ALLOW_PAID_MODEL_EXECUTION = originalAllowPaidExecution;
  }

  if (originalLowCostExecutionModel === undefined) {
    process.env.LOW_COST_EXECUTION_MODEL = undefined;
  } else {
    process.env.LOW_COST_EXECUTION_MODEL = originalLowCostExecutionModel;
  }
});

afterEach(() => {
  runDetachedPromptMock.mockReset();
  continueSessionMock.mockReset();
  createSessionMock.mockReset();
  getAgentRunMock.mockReset();
  injectGuidanceMock.mockReset();
  resumeAgentMock.mockReset();
  registerParallelTaskMock.mockReset();
  authHeaderMock.mockReset();
  formatModelRouteMock.mockReset();
  diagnoseModelReadinessMock.mockReset();
  executeLifecycleHooksMock.mockReset();
  cpFetchMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  broadcastMock.mockReset();

  if (originalAllowPaidExecution === undefined) {
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;
  } else {
    process.env.ALLOW_PAID_MODEL_EXECUTION = originalAllowPaidExecution;
  }

  if (originalLowCostExecutionModel === undefined) {
    process.env.LOW_COST_EXECUTION_MODEL = undefined;
  } else {
    process.env.LOW_COST_EXECUTION_MODEL = originalLowCostExecutionModel;
  }
});

afterAll(() => {
  mock.restore();
});

function getPatchCalls() {
  return cpFetchMock.mock.calls.filter(
    (call) =>
      call[1] && typeof call[1] === "object" && (call[1] as { method?: string }).method === "PATCH",
  );
}

describe("executeLifecycleHooks behavior", () => {
  test("rewrite-prompt hook returns rewritten prompt and decision record", async () => {
    runDetachedPromptMock.mockResolvedValueOnce({
      ok: true,
      completed: true,
      text: JSON.stringify({
        action: "rewrite-prompt",
        reason: "Reduce scope",
        rewrittenPrompt: "Only update the API client and related tests.",
      }),
      sessionId: "session-rewrite",
    });

    const { executeLifecycleHooks } = await loadLifecycleHooksModule();

    const strategy = buildStrategy({
      hooks: [
        {
          id: "rewrite-1",
          trigger: "pre-execution",
          enabled: true,
          agent: "reviewer",
          promptTemplate: "Review {{taskPrompt}}",
          timeoutMs: 1000,
          order: 0,
        },
      ],
    });

    const result = await executeLifecycleHooks({
      strategy,
      trigger: "pre-execution",
      taskId: "task-1",
      projectId: "proj-1",
      taskTitle: "Test task",
      taskPrompt: "Implement feature A",
      titlePrefix: "Preflight",
      context: { taskPrompt: "Implement feature A" },
    });

    expect(result.rewrittenPrompt).toBe("Only update the API client and related tests.");
    expect(result.hookExecutions).toHaveLength(1);
    expect(result.hookExecutions[0]?.decision?.action).toBe("rewrite-prompt");
    expect(result.hookExecutions[0]?.decision?.reason).toBe("Reduce scope");
  });

  test("on-failure trigger executes only matching hooks and records result text", async () => {
    runDetachedPromptMock.mockResolvedValueOnce({
      ok: true,
      completed: true,
      text: "Retry with safer repo credentials.",
      sessionId: "session-failure",
    });

    const { executeLifecycleHooks } = await loadLifecycleHooksModule();

    const strategy = buildStrategy({
      hooks: [
        {
          id: "failure-1",
          trigger: "on-failure",
          enabled: true,
          agent: "auditor",
          promptTemplate: "Handle {{errorMessage}}",
          timeoutMs: 1000,
          order: 1,
        },
        {
          id: "pre-1",
          trigger: "pre-execution",
          enabled: true,
          agent: "reviewer",
          promptTemplate: "Review",
          timeoutMs: 1000,
          order: 0,
        },
      ],
    });

    const result = await executeLifecycleHooks({
      strategy,
      trigger: "on-failure",
      taskId: "task-2",
      projectId: "proj-2",
      taskTitle: "Broken task",
      taskPrompt: "Do something risky",
      titlePrefix: "on-failure",
      context: { errorMessage: "provider auth failed" },
    });

    expect(runDetachedPromptMock).toHaveBeenCalledTimes(1);
    expect(result.hookExecutions).toHaveLength(1);
    expect(result.hookExecutions[0]?.trigger).toBe("on-failure");
    expect(result.combinedResultText).toBe("Retry with safer repo credentials.");
  });

  test("pre-resume route injects rewritten guidance before resume", async () => {
    const callOrder: string[] = [];

    executeLifecycleHooksMock.mockResolvedValueOnce({
      hookExecutions: [{ hookId: "pre-resume-1" }],
      combinedResultText: undefined,
      rewrittenPrompt: "Resume with stricter validation and avoid touching auth.",
    });

    injectGuidanceMock.mockImplementation(async () => {
      callOrder.push("inject");
      return { ok: true };
    });
    resumeAgentMock.mockImplementation(async () => {
      callOrder.push("resume");
      return { ok: true };
    });

    const { agentControlRoutes } = await loadAgentControlRoutesModule();

    const response = await agentControlRoutes.request("http://localhost/run-1/resume", {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(callOrder).toEqual(["inject", "resume"]);

    const injectArgs = injectGuidanceMock.mock.calls[0];
    expect(injectArgs?.[0]).toBe("run-1");
    expect(String(injectArgs?.[1] ?? "")).toContain(
      "Resume with stricter validation and avoid touching auth.",
    );
    expect(injectArgs?.[2]).toBe("noReply");
  });

  test("execute route returns 502 and marks task failed when all parallel candidates fail to start", async () => {
    currentStrategy = buildStrategy({
      hooks: [],
      templates: [
        {
          id: "parallel-template",
          name: "Parallel Template",
          mode: "parallel",
          agents: ["agent-a", "agent-b"],
          enabled: true,
        },
      ],
    });
    currentTask = {
      ...currentTask,
      title: "Parallel task",
      prompt: "Compare two implementation strategies.",
    };

    createSessionMock
      .mockResolvedValueOnce({ ok: false, error: "candidate A failed" })
      .mockResolvedValueOnce({ ok: false, error: "candidate B failed" });

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "All parallel candidates failed to start" });
    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(registerParallelTaskMock).not.toHaveBeenCalled();
    expect(broadcastMock).not.toHaveBeenCalled();

    const patchCalls = getPatchCalls();
    expect(patchCalls).toHaveLength(1);
    expect((patchCalls[0]?.[1] as { body?: { status?: string } }).body?.status).toBe("failed");
  });

  test("execute route returns runtime error payload and marks task failed when single execution cannot send the initial prompt", async () => {
    currentStrategy = buildStrategy({
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
    currentTask = {
      ...currentTask,
      title: "Single task",
      prompt: "Implement a direct fix.",
    };

    createSessionMock.mockResolvedValueOnce({
      ok: false,
      error: "provider timeout while sending prompt",
      sessionId: "session-runtime",
      agentRunId: "run-runtime",
    });

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: "provider timeout while sending prompt",
      code: "MODEL_RUNTIME_ERROR",
      sessionId: "session-runtime",
      taskId: "task-1",
    });
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(registerParallelTaskMock).not.toHaveBeenCalled();
    expect(broadcastMock).not.toHaveBeenCalled();

    const patchCalls = getPatchCalls();
    expect(patchCalls).toHaveLength(1);
    expect((patchCalls[0]?.[1] as { body?: { status?: string } }).body?.status).toBe("failed");
  });

  test("execute route hot-loads the system default execution model for new tasks", async () => {
    currentStrategy = buildStrategy({ hooks: [] });
    currentTask = {
      ...currentTask,
      title: "System default model task",
      prompt: "Run with the configured default model.",
      selectedModel: undefined,
    };

    process.env.ALLOW_PAID_MODEL_EXECUTION = "1";

    const { taskRoutes } = await loadTaskRoutesModule();

    readDefaultExecutionModelMock.mockReturnValueOnce("github-copilot:gemini-3-flash-preview");
    let response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });
    expect(response.status).toBe(200);
    expect(createSessionMock.mock.calls[0]?.[3]).toMatchObject({
      model: {
        providerId: "github-copilot",
        modelId: "gemini-3-flash-preview",
      },
    });

    createSessionMock.mockClear();
    readDefaultExecutionModelMock.mockReturnValueOnce("qwen-local:qwen/qwen3.5-35b-a3b");
    response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });
    expect(response.status).toBe(200);
    expect(createSessionMock.mock.calls[0]?.[3]).toMatchObject({
      model: {
        providerId: "qwen-local",
        modelId: "qwen/qwen3.5-35b-a3b",
      },
    });
  });

  test("preflight endpoint returns a structured deny estimate for paid models without the explicit gate", async () => {
    currentStrategy = buildStrategy({ hooks: [] });
    currentTask = {
      ...currentTask,
      title: "Premium model task",
      prompt: "Ship the full feature with GPT-5.4.",
      selectedModel: "github-copilot:gpt-5.4",
    };
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/execute/preflight", {
      method: "GET",
      headers: { Authorization: "Bearer test" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      taskId: "task-1",
      allowed: false,
      effectiveModel: "github-copilot:gpt-5.4",
      requirements: {
        allowPaidExecution: true,
        leaseRequired: true,
        hasAllowPaidExecution: false,
        hasLease: false,
      },
      preflight: {
        providerId: "github-copilot",
        modelId: "gpt-5.4",
        guardDecision: "deny",
      },
    });
    expect(body.preflight.guardReason).toContain("ALLOW_PAID_MODEL_EXECUTION=1");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  test("execute route rejects paid execution before creating a runtime session when the explicit gate is missing", async () => {
    currentStrategy = buildStrategy({ hooks: [] });
    currentTask = {
      ...currentTask,
      title: "Premium model task",
      prompt: "Ship the full feature with GPT-5.4.",
      selectedModel: "github-copilot:gpt-5.4",
    };
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      code: "PAID_EXECUTION_GATE_REQUIRED",
      taskId: "task-1",
      allowed: false,
      effectiveModel: "github-copilot:gpt-5.4",
      guardDecision: "deny",
    });
    expect(body.guardReason).toContain("ALLOW_PAID_MODEL_EXECUTION=1");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  test("execute route requires a lease for premium paid models even after the explicit gate is enabled", async () => {
    currentStrategy = buildStrategy({ hooks: [] });
    currentTask = {
      ...currentTask,
      title: "Premium model task",
      prompt: "Ship the full feature with GPT-5.4.",
      selectedModel: "github-copilot:gpt-5.4",
    };
    process.env.ALLOW_PAID_MODEL_EXECUTION = "1";

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      code: "PAID_EXECUTION_LEASE_REQUIRED",
      taskId: "task-1",
      allowed: false,
      guardDecision: "require-approval",
      requirements: {
        allowPaidExecution: true,
        leaseRequired: true,
        hasAllowPaidExecution: true,
        hasLease: false,
      },
    });
    expect(body.guardReason).toContain("active paid execution lease");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  test("continue route rejects paid execution before sending follow-up prompts when the explicit gate is missing", async () => {
    currentStrategy = buildStrategy({ hooks: [] });
    currentTask = {
      ...currentTask,
      title: "Premium continuation task",
      prompt: "Continue the premium task",
      selectedModel: "github-copilot:gpt-5.4",
    };
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/continue", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "Please continue" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      code: "PAID_EXECUTION_GATE_REQUIRED",
      taskId: "task-1",
      allowed: false,
      guardDecision: "deny",
    });
    expect(body.guardReason).toContain("ALLOW_PAID_MODEL_EXECUTION=1");
    expect(continueSessionMock).not.toHaveBeenCalled();
  });

  test("continue route falls back to strategy candidates when stored parallel executionPlan is incomplete", async () => {
    currentStrategy = buildStrategy({ hooks: [] });
    process.env.ALLOW_PAID_MODEL_EXECUTION = "1";
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method) {
        if (url.includes("/paid-execution-lease")) {
          return {
            ok: true,
            data: {
              projectId: "proj-1",
              activeLease: { id: "lease-test" },
              now: "2026-03-10T00:00:00.000Z",
            },
          };
        }

        if (url.includes("/api/projects/")) {
          return { ok: true, data: { settings: {} } };
        }

        return {
          ok: true,
          data: currentTask,
        };
      }

      return { ok: true, data: { body: options.body } };
    });

    currentTask = {
      ...currentTask,
      title: "Parallel continuation task",
      prompt: "Compare responses and continue the task",
      sessionId: undefined,
      executionMode: "parallel",
      strategy: JSON.stringify({
        executionMode: "parallel",
        parallelCandidates: [
          { model: "github-copilot:gpt-5-mini", label: "候选 A" },
          { model: "github-copilot:gpt-4o", label: "候选 B" },
        ],
      }),
      executionPlan: JSON.stringify({
        templateId: "tpl-ops-parallel",
        mode: "parallel",
        steps: [{ id: "exec-parallel", type: "execution", status: "completed" }],
        candidates: [
          {
            label: "候选 1",
            agent: "oracle-enterprise",
            role: "executor",
            status: "completed",
            sessionId: "session-existing",
          },
        ],
      }),
    };

    createSessionMock
      .mockResolvedValueOnce({ ok: true, sessionId: "session-a", agentRunId: "run-a" })
      .mockResolvedValueOnce({ ok: true, sessionId: "session-b", agentRunId: "run-b" });

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/continue", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "Please continue" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      executionMode: "parallel",
      candidates: [
        { sessionId: "session-a", status: "running" },
        { sessionId: "session-b", status: "running" },
      ],
    });
    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(continueSessionMock).not.toHaveBeenCalled();

    const patchCalls = getPatchCalls();
    const runningPatch = patchCalls.find(
      (call) =>
        (call[0] as string) === "/api/tasks/task-1" &&
        (call[1] as { body?: { status?: string } })?.body?.status === "running",
    );
    expect(runningPatch).toBeDefined();

    const patchedBody = (runningPatch?.[1] as {
      body?: { executionPlan?: string; strategy?: string };
    })?.body;
    const patchedPlan = JSON.parse(patchedBody?.executionPlan || "null") as {
      candidates?: Array<{ sessionId?: string }>;
    } | null;
    const patchedStrategy = JSON.parse(patchedBody?.strategy || "{}") as {
      parallelCandidates?: Array<{ model: string }>;
    };

    expect(patchedPlan?.candidates).toHaveLength(2);
    expect(patchedStrategy.parallelCandidates).toHaveLength(2);
    expect(registerParallelTaskMock).toHaveBeenCalledTimes(1);

    const lineageWrites = cpFetchMock.mock.calls.filter(
      ([url, options]) =>
        url === "/api/tasks/task-1/task-sessions" &&
        (options as { method?: string } | undefined)?.method === "POST",
    );
    expect(lineageWrites).toHaveLength(2);
    expect((lineageWrites[0]?.[1] as { body?: Record<string, unknown> })?.body).toMatchObject({
      runtimeSessionId: "session-a",
      branchName: "候选 A",
      sourceType: "root",
    });
    expect((lineageWrites[1]?.[1] as { body?: Record<string, unknown> })?.body).toMatchObject({
      runtimeSessionId: "session-b",
      parentRuntimeSessionId: "session-a",
      branchName: "候选 B",
      sourceType: "fork",
    });
  });

  test("continue route resets stale parallel candidate state after manual adoption before starting a new round", async () => {
    currentStrategy = buildStrategy({ hooks: [] });
    process.env.ALLOW_PAID_MODEL_EXECUTION = "1";
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method) {
        if (url.includes("/paid-execution-lease")) {
          return {
            ok: true,
            data: {
              projectId: "proj-1",
              activeLease: { id: "lease-test" },
              now: "2026-03-10T00:00:00.000Z",
            },
          };
        }

        if (url.includes("/api/projects/")) {
          return { ok: true, data: { settings: {} } };
        }

        return {
          ok: true,
          data: currentTask,
        };
      }

      return { ok: true, data: { body: options.body } };
    });

    currentTask = {
      ...currentTask,
      title: "Parallel task after manual adoption",
      prompt: "Run the comparison again",
      sessionId: "session-existing-a",
      status: "completed",
      executionMode: "parallel",
      strategy: JSON.stringify({
        executionMode: "parallel",
        parallelCandidates: [
          { model: "github-copilot:gpt-5-mini", label: "候选 A" },
          { model: "github-copilot:gpt-4o", label: "候选 B" },
        ],
      }),
      executionPlan: JSON.stringify({
        templateId: "tpl-ops-parallel",
        mode: "parallel",
        steps: [{ id: "exec-parallel", type: "execution", status: "completed" }],
        candidates: [
          {
            label: "候选 A",
            agent: "default-executor",
            role: "executor",
            model: "github-copilot:gpt-5-mini",
            status: "completed",
            sessionId: "session-existing-a",
            agentRunId: "run-existing-a",
            result: "old result a",
          },
          {
            label: "候选 B",
            agent: "default-executor",
            role: "executor",
            model: "github-copilot:gpt-4o",
            status: "stopped",
            sessionId: "session-existing-b",
            agentRunId: "run-existing-b",
            result: "old result b",
          },
        ],
        judgeResult: {
          status: "completed",
          winnerIndex: 0,
          reasoning: "old judge decision",
          completedAt: "2026-03-20T00:00:00.000Z",
        },
        winnerCandidateIndex: 0,
      }),
    };

    createSessionMock
      .mockResolvedValueOnce({ ok: true, sessionId: "session-new-a", agentRunId: "run-new-a" })
      .mockResolvedValueOnce({ ok: true, sessionId: "session-new-b", agentRunId: "run-new-b" });

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/continue", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "Please continue" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      executionMode: "parallel",
      candidates: [
        { sessionId: "session-new-a", status: "running" },
        { sessionId: "session-new-b", status: "running" },
      ],
    });
    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(continueSessionMock).not.toHaveBeenCalled();

    const patchCalls = getPatchCalls();
    const runningPatch = patchCalls.find(
      (call) =>
        (call[0] as string) === "/api/tasks/task-1" &&
        (call[1] as { body?: { status?: string } })?.body?.status === "running",
    );
    expect(runningPatch).toBeDefined();

    const patchedBody = (runningPatch?.[1] as {
      body?: { executionPlan?: string };
    })?.body;
    const patchedPlan = JSON.parse(patchedBody?.executionPlan || "null") as {
      candidates?: Array<{
        agent?: string;
        label?: string;
        model?: string;
        role?: string;
        status?: string;
        sessionId?: string;
        agentRunId?: string;
        result?: string;
        startedAt?: string;
      }>;
      judgeResult?: unknown;
      winnerCandidateIndex?: number;
    } | null;

    expect(patchedPlan?.winnerCandidateIndex).toBeUndefined();
    expect(patchedPlan?.judgeResult).toBeUndefined();
    expect(patchedPlan?.candidates).toHaveLength(2);
    expect(patchedPlan?.candidates?.[0]).toMatchObject({
      label: "候选 A",
      agent: "default-executor",
      model: "github-copilot:gpt-5-mini",
      role: "executor",
      status: "running",
      sessionId: "session-new-a",
      agentRunId: "run-new-a",
    });
    expect(patchedPlan?.candidates?.[1]).toMatchObject({
      label: "候选 B",
      agent: "default-executor",
      model: "github-copilot:gpt-4o",
      role: "executor",
      status: "running",
      sessionId: "session-new-b",
      agentRunId: "run-new-b",
    });
    expect(patchedPlan?.candidates?.every((candidate) => !candidate.result)).toBe(true);
    expect(patchedPlan?.candidates?.every((candidate) => Boolean(candidate.startedAt))).toBe(true);
    expect(registerParallelTaskMock).toHaveBeenCalledTimes(1);

    const lineageWrites = cpFetchMock.mock.calls.filter(
      ([url, options]) =>
        url === "/api/tasks/task-1/task-sessions" &&
        (options as { method?: string } | undefined)?.method === "POST",
    );
    expect(lineageWrites).toHaveLength(3);
    expect((lineageWrites[0]?.[1] as { body?: Record<string, unknown> })?.body).toMatchObject({
      runtimeSessionId: "session-existing-a",
      branchName: "Parallel task after manual adoption",
      sourceType: "root",
    });
    expect((lineageWrites[1]?.[1] as { body?: Record<string, unknown> })?.body).toMatchObject({
      runtimeSessionId: "session-new-a",
      parentRuntimeSessionId: "session-existing-a",
      branchName: "候选 A",
      sourceType: "fork",
    });
    expect((lineageWrites[2]?.[1] as { body?: Record<string, unknown> })?.body).toMatchObject({
      runtimeSessionId: "session-new-b",
      parentRuntimeSessionId: "session-existing-a",
      branchName: "候选 B",
      sourceType: "fork",
    });
  });

  test("execute route registers parallel candidates under the current task session lineage", async () => {
    currentTask = {
      ...currentTask,
      title: "Parallel execute task",
      prompt: "Please execute again",
      sessionId: "session-existing-parent",
      strategy: JSON.stringify({ executionMode: "parallel" }),
    };

    createSessionMock
      .mockResolvedValueOnce({ ok: true, sessionId: "session-new-a", agentRunId: "run-new-a" })
      .mockResolvedValueOnce({ ok: true, sessionId: "session-new-b", agentRunId: "run-new-b" });

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "parallel",
        candidates: [
          { model: "local:test-model-a", label: "候选 A" },
          { model: "local:test-model-b", label: "候选 B" },
        ],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      executionMode: "parallel",
      candidates: [
        { sessionId: "session-new-a", status: "running" },
        { sessionId: "session-new-b", status: "running" },
      ],
    });

    const lineageWrites = cpFetchMock.mock.calls.filter(
      ([url, options]) =>
        url === "/api/tasks/task-1/task-sessions" &&
        (options as { method?: string } | undefined)?.method === "POST",
    );
    expect(lineageWrites).toHaveLength(3);
    expect((lineageWrites[0]?.[1] as { body?: Record<string, unknown> })?.body).toMatchObject({
      runtimeSessionId: "session-existing-parent",
      sourceType: "root",
      isActive: false,
    });
    expect((lineageWrites[1]?.[1] as { body?: Record<string, unknown> })?.body).toMatchObject({
      runtimeSessionId: "session-new-a",
      parentRuntimeSessionId: "session-existing-parent",
      branchName: "候选 A",
      sourceType: "fork",
    });
    expect((lineageWrites[2]?.[1] as { body?: Record<string, unknown> })?.body).toMatchObject({
      runtimeSessionId: "session-new-b",
      parentRuntimeSessionId: "session-existing-parent",
      branchName: "候选 B",
      sourceType: "fork",
    });
  });

  test("execute route registers single execution under the current task session lineage", async () => {
    currentTask = {
      ...currentTask,
      title: "Single execute task",
      prompt: "Please execute single",
      sessionId: "session-existing-parent",
    };

    createSessionMock.mockResolvedValueOnce({
      ok: true,
      sessionId: "session-new-single",
      agentRunId: "run-new-single",
    });

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      executionMode: "single",
      sessionId: "session-new-single",
      agentRunId: "run-new-single",
    });

    const lineageWrites = cpFetchMock.mock.calls.filter(
      ([url, options]) =>
        url === "/api/tasks/task-1/task-sessions" &&
        (options as { method?: string } | undefined)?.method === "POST",
    );
    expect(lineageWrites).toHaveLength(2);
    expect((lineageWrites[0]?.[1] as { body?: Record<string, unknown> })?.body).toMatchObject({
      runtimeSessionId: "session-existing-parent",
      sourceType: "root",
      isActive: false,
    });
    expect((lineageWrites[1]?.[1] as { body?: Record<string, unknown> })?.body).toMatchObject({
      runtimeSessionId: "session-new-single",
      parentRuntimeSessionId: "session-existing-parent",
      branchName: "Single execute task",
      sourceType: "fork",
      isActive: true,
    });
  });

  test("execute route stops before runtime start when pre-execution hook trips the paid execution breaker", async () => {
    currentStrategy = buildStrategy({
      hooks: [
        {
          id: "pre-execution-budget",
          trigger: "pre-execution",
          enabled: true,
          agent: "reviewer",
          model: "github-copilot:claude-sonnet-4",
          promptTemplate: "Review {{taskPrompt}}",
          timeoutMs: 1000,
          order: 0,
        },
      ],
    });
    currentTask = {
      ...currentTask,
      title: "Budgeted pre-execution task",
      prompt: "Do the minimal change.",
      selectedModel: "github-copilot:claude-sonnet-4",
    };
    process.env.ALLOW_PAID_MODEL_EXECUTION = "1";

    cpFetchMock.mockImplementation(
      async (url: string, options?: { method?: string; body?: { strategy?: string } }) => {
        if (!options?.method) {
          if (url.includes("/paid-execution-lease")) {
            return {
              ok: true,
              data: {
                projectId: "proj-1",
                activeLease: null,
                now: "2026-03-10T00:00:00.000Z",
              },
            };
          }

          if (url.includes("/api/projects/")) {
            return { ok: true, data: { settings: {} } };
          }

          return { ok: true, data: currentTask };
        }

        if (options.method === "PATCH" && options.body?.strategy) {
          currentTask = {
            ...currentTask,
            strategy: options.body.strategy,
          };
        }

        return { ok: true, data: { body: options.body } };
      },
    );

    runDetachedPromptMock.mockResolvedValueOnce({
      ok: true,
      completed: true,
      text: "Preflight review result",
      sessionId: "session-pre-execution",
      tokenUsed: 40000,
      model: {
        providerId: "github-copilot",
        modelId: "claude-sonnet-4",
      },
    });
    executeLifecycleHooksMock.mockImplementationOnce(
      async (options?: {
        onHookExecuted?: (
          execution: Record<string, unknown>,
        ) => Promise<{ stop?: boolean; reason?: string } | undefined>;
      }) => {
        const execution = {
          hookId: "pre-execution-budget",
          trigger: "pre-execution",
          status: "completed",
          agent: "reviewer",
          model: "github-copilot:claude-sonnet-4",
          prompt: "Review Do the minimal change.",
          result: "Preflight review result",
          sessionId: "session-pre-execution",
          tokenUsed: 40000,
          completedAt: "2026-03-17T00:00:00.000Z",
        };
        await options?.onHookExecuted?.(execution);
        return {
          hookExecutions: [execution],
          combinedResultText: execution.result,
          rewrittenPrompt: undefined,
        };
      },
    );

    const { taskRoutes } = await loadTaskRoutesModule();
    const response = await taskRoutes.request("http://localhost/task-1/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "PAID_EXECUTION_BREAKER_TRIPPED",
      taskId: "task-1",
      allowed: false,
    });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  test("resume route stops when pre-resume hook trips the paid execution breaker", async () => {
    currentStrategy = buildStrategy({
      hooks: [
        {
          id: "pre-resume-budget",
          trigger: "pre-resume",
          enabled: true,
          agent: "reviewer",
          model: "github-copilot:claude-sonnet-4",
          promptTemplate: "Resume {{taskPrompt}}",
          timeoutMs: 1000,
          order: 0,
        },
      ],
    });
    currentTask = {
      ...currentTask,
      strategy: JSON.stringify({
        paidExecutionGuard: {
          enabled: true,
          providerId: "github-copilot",
          modelId: "claude-sonnet-4",
          modelRoute: "github-copilot:claude-sonnet-4",
          leaseId: null,
          guardDecision: "allow",
          guardReason: "approved",
          estimatedRequestUpperBound: 2,
          estimatedTokenUpperBound: 4000,
          estimatedCostUpperBound: 0.75,
          actualRequests: 0,
          actualTokenUsage: 0,
          actualCost: 0,
          maxRequestsPerRun: 6,
          maxEstimatedCostUsdPerRun: 0.75,
          overridesApplied: [],
          postHooksDisabled: false,
        },
      }),
    };
    process.env.ALLOW_PAID_MODEL_EXECUTION = "1";

    runDetachedPromptMock.mockResolvedValueOnce({
      ok: true,
      completed: true,
      text: "Resume review result",
      sessionId: "session-pre-resume",
      tokenUsed: 40000,
      model: {
        providerId: "github-copilot",
        modelId: "claude-sonnet-4",
      },
    });
    executeLifecycleHooksMock.mockImplementationOnce(
      async (options?: {
        onHookExecuted?: (
          execution: Record<string, unknown>,
        ) => Promise<{ stop?: boolean; reason?: string } | undefined>;
      }) => {
        const execution = {
          hookId: "pre-resume-budget",
          trigger: "pre-resume",
          status: "completed",
          agent: "reviewer",
          model: "github-copilot:claude-sonnet-4",
          prompt: "Resume Continue the premium task",
          result: "Resume review result",
          sessionId: "session-pre-resume",
          tokenUsed: 40000,
          completedAt: "2026-03-17T00:00:00.000Z",
        };
        await options?.onHookExecuted?.(execution);
        return {
          hookExecutions: [execution],
          combinedResultText: execution.result,
          rewrittenPrompt: undefined,
        };
      },
    );

    const { agentControlRoutes } = await loadAgentControlRoutesModule();
    const response = await agentControlRoutes.request("http://localhost/run-1/resume", {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(String(body.error || "")).toContain("exceeded");
    expect(resumeAgentMock).not.toHaveBeenCalled();
  });
});
