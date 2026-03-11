import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as strategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import {
  type OrchestrationStrategy,
  normalizeOrchestrationStrategy,
} from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";

const runDetachedPromptMock = mock(async () => ({
  ok: true,
  completed: true,
  text: "",
  sessionId: "session-test",
}));
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
  continueSession: mock(async () => ({ ok: true })),
  runDetachedPrompt: runDetachedPromptMock,
  getAgentMessages: mock(async () => ({ ok: true, data: [] })),
  getAgentRun: getAgentRunMock,
  injectGuidance: injectGuidanceMock,
  listAgentRuns: mock(() => []),
  listSessions: mock(async () => ({ ok: true, data: [] })),
  pauseAgent: mock(async () => ({ ok: true })),
  resumeAgent: resumeAgentMock,
  terminateAgent: mock(async () => ({ ok: true })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...strategyModule,
  readOrchestrationStrategy: () => currentStrategy,
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

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/reconcile", () => ({
  reconcileRunningTasksOnStartup: mock(async () => ({
    scanned: 0,
    completed: 0,
    failed: 0,
    recovered: 0,
    skipped: 0,
    runtimeAvailable: true,
  })),
}));

function buildStrategy(overrides: Partial<OrchestrationStrategy> = {}): OrchestrationStrategy {
  return normalizeOrchestrationStrategy(overrides);
}

beforeEach(() => {
  runDetachedPromptMock.mockReset();
  createSessionMock.mockReset();
  getAgentRunMock.mockReset();
  injectGuidanceMock.mockReset();
  resumeAgentMock.mockReset();
  registerParallelTaskMock.mockReset();
  authHeaderMock.mockReset();
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
  authHeaderMock.mockReturnValue("Bearer test");
  cpFetchMock.mockImplementation(
    async (url: string, options?: { method?: string; body?: unknown }) => {
      if (!options?.method) {
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
});

afterEach(() => {
  runDetachedPromptMock.mockReset();
  createSessionMock.mockReset();
  getAgentRunMock.mockReset();
  injectGuidanceMock.mockReset();
  resumeAgentMock.mockReset();
  registerParallelTaskMock.mockReset();
  authHeaderMock.mockReset();
  cpFetchMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  broadcastMock.mockReset();
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

    const { executeLifecycleHooks } = await import(
      "../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks"
    );

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

    const { executeLifecycleHooks } = await import(
      "../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks"
    );

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

    runDetachedPromptMock.mockResolvedValueOnce({
      ok: true,
      completed: true,
      text: JSON.stringify({
        action: "rewrite-prompt",
        rewrittenPrompt: "Resume with stricter validation and avoid touching auth.",
      }),
      sessionId: "session-pre-resume",
    });

    injectGuidanceMock.mockImplementation(async () => {
      callOrder.push("inject");
      return { ok: true };
    });
    resumeAgentMock.mockImplementation(async () => {
      callOrder.push("resume");
      return { ok: true };
    });

    const { agentControlRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/routes"
    );

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

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");
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
          agents: ["build"],
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

    const { taskRoutes } = await import("../../control-plane/web-ui-bff/src/modules/tasks/routes");
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
});
