import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (url: string, options?: { method?: string }) => {
  if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1") {
    return {
      ok: true,
      status: 200,
      data: {
        id: "task-1",
        title: "Runtime pipeline task",
        prompt: "Summarize progress",
        projectId: "proj-1",
        sessionId: "ses-task-main",
        agentRunId: "run-1",
        result: "Done",
        strategy: null,
        selectedModel: "gpt-5.4",
        startedAt: "2026-03-12T10:00:00.000Z",
        executionPlan: JSON.stringify({
          templateId: "single-default",
          mode: "single",
          steps: [{ id: "exec-1", type: "execution", status: "running" }],
          candidates: [
            {
              label: "Default executor",
              agent: "default-executor",
              sessionId: "ses-1",
              agentRunId: "run-1",
              status: "running",
              startedAt: "2026-03-12T10:00:00.000Z",
            },
          ],
        }),
      },
    };
  }

  if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/branches") {
    return {
      ok: true,
      status: 200,
      data: {
        data: [
          {
            runtimeSessionId: "ses-1",
            isActive: true,
            archivedAt: null,
          },
        ],
      },
    };
  }

  return { ok: true, status: 200, data: {} };
});

const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const extractAssistantResultFromMessagesMock = mock(() => ({
  completed: true,
  failed: false,
  error: undefined as string | undefined,
  tokenUsed: 0,
  text: "Final answer",
}));
const findAgentRunBySessionIdMock = mock(() => undefined);
const getAgentRunMock = mock(() => undefined);
const getSessionMessagesMock = mock(async () => ({
  ok: true,
  data: [] as Array<Record<string, unknown>>,
}));
const listSessionsMock = mock(async () => ({ ok: true, data: [{ id: "ses-1" }] }));
const recoverAgentRunMock = mock(() => undefined);
const terminateAgentMock = mock(async () => ({ ok: true }));
const updateAgentRunStatusMock = mock(() => undefined);
const runDetachedPromptMock = mock(async () => ({
  ok: true,
  text: "judge result",
  sessionId: "judge-ses",
}));
const collectChangesFromSessionMock = mock(async () => undefined);
const executeLifecycleHooksMock = mock(async () => ({
  hookExecutions: [] as Array<Record<string, unknown>>,
}));
const onGraphToolExecutedMock = mock(async () => undefined);
const buildPipelineStageUpdatedEventsMock = mock(async () => [] as Array<Record<string, unknown>>);

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: () => "Bearer test",
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
  continueSession: mock(async () => ({ ok: true })),
  createSession: mock(async () => ({ ok: true, sessionId: "ses-1", agentRunId: "run-1" })),
  ensureAgentRunForSession: mock(() => "run-1"),
  extractAssistantResultFromMessages: extractAssistantResultFromMessagesMock,
  findAgentRunBySessionId: findAgentRunBySessionIdMock,
  forkSession: mock(async () => ({ ok: true, sessionId: "ses-fork-1" })),
  getAgentRun: getAgentRunMock,
  getSessionMessages: getSessionMessagesMock,
  listSessions: listSessionsMock,
  recoverAgentRun: recoverAgentRunMock,
  runDetachedPrompt: runDetachedPromptMock,
  terminateAgent: terminateAgentMock,
  updateAgentRunStatus: updateAgentRunStatusMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/code-changes/change-collector", () => ({
  collectChangesFromSession: collectChangesFromSessionMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: executeLifecycleHooksMock,
  mergeStageAndStrategyHooks: (_stage: unknown[], strategy: unknown[]) => strategy ?? [],
  parseStageHooks: (raw: unknown) => (Array.isArray(raw) ? raw : []),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/dag-sync", () => ({
  observeGraphWorkspaceDir: mock(() => undefined),
  onGraphToolExecuted: onGraphToolExecutedMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/pipeline-events", () => ({
  buildPipelineStageUpdatedEvents: buildPipelineStageUpdatedEventsMock,
}));

const { sseAggregator } = await import(
  "../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator"
);

function resetAggregatorState() {
  const aggregator = sseAggregator as unknown as {
    finalizedAgentRuns: Set<string>;
    finalizingAgentRuns: Set<string>;
    parallelTaskSessions: Map<string, Set<string>>;
    parallelCandidateResults: Map<string, Map<number, { sessionId: string; result?: string }>>;
    sessionToCandidateMap: Map<string, { taskId: string; candidateIndex: number }>;
    judgingTasks: Set<string>;
    paidExecutionRuntime: Map<string, { tripped: boolean; reason?: string }>;
  };

  aggregator.finalizedAgentRuns.clear();
  aggregator.finalizingAgentRuns.clear();
  aggregator.parallelTaskSessions.clear();
  aggregator.parallelCandidateResults.clear();
  aggregator.sessionToCandidateMap.clear();
  aggregator.judgingTasks.clear();
  aggregator.paidExecutionRuntime.clear();
}

beforeEach(() => {
  cpFetchMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  extractAssistantResultFromMessagesMock.mockReset();
  findAgentRunBySessionIdMock.mockReset();
  getAgentRunMock.mockReset();
  getSessionMessagesMock.mockReset();
  listSessionsMock.mockReset();
  recoverAgentRunMock.mockReset();
  terminateAgentMock.mockReset();
  updateAgentRunStatusMock.mockReset();
  runDetachedPromptMock.mockReset();
  collectChangesFromSessionMock.mockReset();
  executeLifecycleHooksMock.mockReset();
  onGraphToolExecutedMock.mockReset();
  buildPipelineStageUpdatedEventsMock.mockReset();

  cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
    if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1") {
      return {
        ok: true,
        status: 200,
        data: {
          id: "task-1",
          title: "Runtime pipeline task",
          prompt: "Summarize progress",
          projectId: "proj-1",
          sessionId: "ses-task-main",
          agentRunId: "run-1",
          result: "Done",
          strategy: null,
          selectedModel: "gpt-5.4",
          startedAt: "2026-03-12T10:00:00.000Z",
          executionPlan: JSON.stringify({
            templateId: "single-default",
            mode: "single",
            steps: [{ id: "exec-1", type: "execution", status: "running" }],
            candidates: [
              {
                label: "Default executor",
                agent: "default-executor",
                sessionId: "ses-1",
                agentRunId: "run-1",
                status: "running",
                startedAt: "2026-03-12T10:00:00.000Z",
              },
            ],
          }),
        },
      };
    }

    if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/branches") {
      return {
        ok: true,
        status: 200,
        data: {
          data: [
            {
              runtimeSessionId: "ses-1",
              isActive: true,
              archivedAt: null,
            },
          ],
        },
      };
    }

    return { ok: true, status: 200, data: {} };
  });

  createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  extractAssistantResultFromMessagesMock.mockReturnValue({
    completed: true,
    failed: false,
    error: undefined,
    tokenUsed: 0,
    text: "Final answer",
  });
  findAgentRunBySessionIdMock.mockReturnValue(undefined);
  getAgentRunMock.mockReturnValue(undefined);
  getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });
  listSessionsMock.mockResolvedValue({ ok: true, data: [{ id: "ses-1" }] });
  recoverAgentRunMock.mockImplementation(() => undefined);
  terminateAgentMock.mockResolvedValue({ ok: true });
  updateAgentRunStatusMock.mockImplementation(() => undefined);
  runDetachedPromptMock.mockResolvedValue({
    ok: true,
    text: "judge result",
    sessionId: "judge-ses",
  });
  collectChangesFromSessionMock.mockResolvedValue(undefined);
  executeLifecycleHooksMock.mockResolvedValue({ hookExecutions: [] });
  onGraphToolExecutedMock.mockResolvedValue(undefined);
  buildPipelineStageUpdatedEventsMock.mockResolvedValue([]);

  resetAggregatorState();
});

describe("SSEAggregator pipeline emitters", () => {
  test("session.status events are forwarded with runtime burst metadata", async () => {
    findAgentRunBySessionIdMock.mockReturnValue({
      subSessionId: "ses-1",
      taskId: "task-1",
      projectId: "proj-1",
      agentRunId: "run-1",
      status: "paused",
    });

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      await sseAggregator.ingestParsedEvent("session.status", {
        info: {
          id: "ses-1",
          type: "paused-approval",
          until: "2026-03-12T10:06:00.000Z",
          metadata: {
            source: "runtime_burst_guard",
            decision: "paused-approval",
            permission: "model_burst_resume",
            ratio: 1.42,
            window: { seconds: 300 },
            limits: {
              requests: 20,
              tokens: 100000,
              cost: 5,
            },
          },
          requests: 28,
          tokens: 120000,
          cost: 6.1,
        },
      });

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        type: "session.status",
        sessionId: "ses-1",
        taskId: "task-1",
        projectId: "proj-1",
        agentRunId: "run-1",
        data: {
          info: {
            type: "paused-approval",
            metadata: {
              source: "runtime_burst_guard",
              permission: "model_burst_resume",
            },
          },
        },
      });
    } finally {
      unsubscribe();
    }
  });

  test("post-execution hooks emit task.hooks.updated followed by pipeline.stage.updated", async () => {
    executeLifecycleHooksMock.mockResolvedValue({
      hookExecutions: [
        {
          hookId: "post-review",
          trigger: "post-execution",
          status: "completed",
          agent: "reviewer",
          sessionId: "ses-hook",
          completedAt: "2026-03-12T10:05:00.000Z",
          result: "Looks good.",
        },
      ],
    });
    buildPipelineStageUpdatedEventsMock.mockResolvedValue([
      {
        id: "evt-pipeline-hook",
        type: "pipeline.stage.updated",
        ts: "2026-03-12T10:05:01.000Z",
        taskId: "task-1",
        sessionId: "ses-hook",
        projectId: "proj-1",
        data: {
          patch: { type: "upsert", stage: { id: "post-hook-1" } },
          summary: { totalStages: 1, completedStages: 1 },
          reason: "task.hooks.updated",
          status: "completed",
          branchName: "main",
        },
      },
    ]);

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      await (
        sseAggregator as unknown as {
          triggerPostExecutionHooks: (
            taskId: string,
            resultText: string | undefined,
            authorization: string,
          ) => Promise<void>;
        }
      ).triggerPostExecutionHooks("task-1", "Done", "Bearer internal");

      expect(emitted.map((event) => event.type)).toEqual([
        "task.hooks.updated",
        "pipeline.stage.updated",
      ]);
      expect(buildPipelineStageUpdatedEventsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          sessionId: "ses-task-main",
          projectId: "proj-1",
          reason: "task.hooks.updated",
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  test("post-execution hooks are skipped when paid execution guard disables them", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            title: "Runtime pipeline task",
            prompt: "Summarize progress",
            projectId: "proj-1",
            sessionId: "ses-task-main",
            agentRunId: "run-1",
            result: "Done",
            strategy: JSON.stringify({
              paidExecutionGuard: {
                enabled: true,
                providerId: "github-copilot",
                modelId: "gpt-5.4",
                modelRoute: "github-copilot:gpt-5.4",
                guardDecision: "allow",
                guardReason: "safe overlay applied",
                estimatedRequestUpperBound: 1,
                estimatedTokenUpperBound: 2000,
                estimatedCostUpperBound: 1.2,
                actualRequests: 1,
                actualTokenUsage: 1200,
                actualCost: 0.8,
                maxRequestsPerRun: 2,
                maxEstimatedCostUsdPerRun: 5,
                overridesApplied: ["post-hook-disabled"],
                postHooksDisabled: true,
              },
            }),
            selectedModel: "gpt-5.4",
          },
        };
      }

      return { ok: true, status: 200, data: {} };
    });

    await (
      sseAggregator as unknown as {
        triggerPostExecutionHooks: (
          taskId: string,
          resultText: string | undefined,
          authorization: string,
        ) => Promise<void>;
      }
    ).triggerPostExecutionHooks("task-1", "Done", "Bearer internal");

    expect(executeLifecycleHooksMock).not.toHaveBeenCalled();
  });

  test("post-execution hook usage is recorded once and remaining hooks stop after breaker trips", async () => {
    cpFetchMock.mockImplementation(
      async (url: string, options?: { method?: string; body?: unknown }) => {
        if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1") {
          return {
            ok: true,
            status: 200,
            data: {
              id: "task-1",
              title: "Runtime pipeline task",
              prompt: "Summarize progress",
              projectId: "proj-1",
              sessionId: "ses-task-main",
              agentRunId: "run-1",
              result: "Done",
              strategy: JSON.stringify({
                effectiveModel: "github-copilot:gpt-5.4",
                paidExecutionGuard: {
                  enabled: true,
                  providerId: "github-copilot",
                  modelId: "gpt-5.4",
                  modelRoute: "github-copilot:gpt-5.4",
                  guardDecision: "allow",
                  guardReason: "safe overlay applied",
                  estimatedRequestUpperBound: 1,
                  estimatedTokenUpperBound: 4000,
                  estimatedCostUpperBound: 2,
                  actualRequests: 1,
                  actualTokenUsage: 1200,
                  actualCost: 0.8,
                  maxRequestsPerRun: 1,
                  maxEstimatedCostUsdPerRun: 5,
                  overridesApplied: [],
                  postHooksDisabled: false,
                },
              }),
              selectedModel: "github-copilot:gpt-5.4",
            },
          };
        }

        return { ok: true, status: 200, data: { body: options?.body } };
      },
    );

    executeLifecycleHooksMock.mockImplementation(
      async (options?: {
        onHookExecuted?: (
          execution: Record<string, unknown>,
        ) => Promise<{ stop?: boolean; reason?: string } | undefined>;
      }) => {
        const firstExecution = {
          hookId: "post-review-1",
          trigger: "post-execution",
          status: "completed",
          agent: "reviewer",
          model: "github-copilot:gpt-5.4",
          prompt: "Review result",
          result: "Looks good.",
          sessionId: "ses-hook-1",
          tokenUsed: 2400,
          completedAt: "2026-03-12T10:05:00.000Z",
        };
        const continuation = await options?.onHookExecuted?.(firstExecution);
        return {
          hookExecutions: [
            firstExecution,
            {
              hookId: "post-review-2",
              trigger: "post-execution",
              status: "skipped",
              agent: "reviewer",
              model: "github-copilot:gpt-5.4",
              prompt: "Review result again",
              error:
                continuation && "reason" in continuation && typeof continuation.reason === "string"
                  ? continuation.reason
                  : "skipped",
              sessionId: undefined,
              tokenUsed: 0,
              completedAt: "2026-03-12T10:05:01.000Z",
            },
          ],
        };
      },
    );

    await (
      sseAggregator as unknown as {
        triggerPostExecutionHooks: (
          taskId: string,
          resultText: string | undefined,
          authorization: string,
        ) => Promise<void>;
      }
    ).triggerPostExecutionHooks("task-1", "Done", "Bearer internal");

    const costRecordCalls = cpFetchMock.mock.calls.filter(
      (call) =>
        call[0] === "/api/cost/records" && (call[1] as { method?: string })?.method === "POST",
    );
    const auditCalls = cpFetchMock.mock.calls.filter(
      (call) => call[0] === "/api/audit" && (call[1] as { method?: string })?.method === "POST",
    );

    expect(costRecordCalls).toHaveLength(1);
    expect(
      auditCalls.some(
        (call) =>
          (call[1] as { body?: { action?: string } }).body?.action === "hook_usage_recorded",
      ),
    ).toBe(true);
    expect(
      auditCalls.some(
        (call) => (call[1] as { body?: { action?: string } }).body?.action === "breaker_tripped",
      ),
    ).toBe(true);
  });

  test("completion finalization emits task.completed and pipeline.stage.updated for single-mode runs", async () => {
    findAgentRunBySessionIdMock.mockReturnValue({
      subSessionId: "ses-1",
      status: "running",
      taskId: "task-1",
      projectId: "proj-1",
    });
    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          info: {
            role: "assistant",
            time: { completed: Date.parse("2026-03-12T10:03:00.000Z") },
          },
          parts: [{ type: "text", text: "Final answer" }],
        },
      ],
    });
    buildPipelineStageUpdatedEventsMock.mockResolvedValue([
      {
        id: "evt-pipeline-completed",
        type: "pipeline.stage.updated",
        ts: "2026-03-12T10:03:01.000Z",
        taskId: "task-1",
        sessionId: "ses-1",
        projectId: "proj-1",
        agentRunId: "run-1",
        data: {
          patch: { type: "upsert", stage: { id: "execution-1" } },
          summary: { totalStages: 1, completedStages: 1 },
          reason: "task.completed",
          status: "completed",
          branchName: "main",
        },
      },
    ]);

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      await (
        sseAggregator as unknown as {
          maybeFinalizeRun: (event: Record<string, unknown>) => Promise<void>;
        }
      ).maybeFinalizeRun({
        id: "evt-session-idle",
        type: "session.idle",
        ts: "2026-03-12T10:03:00.000Z",
        sessionId: "ses-1",
        taskId: "task-1",
        projectId: "proj-1",
        agentRunId: "run-1",
        data: {},
      });

      expect(emitted.some((event) => event.type === "task.completed")).toBe(true);
      expect(emitted.some((event) => event.type === "pipeline.stage.updated")).toBe(true);
      expect(buildPipelineStageUpdatedEventsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          sessionId: "ses-1",
          projectId: "proj-1",
          agentRunId: "run-1",
          reason: "task.completed",
        }),
      );
      expect(cpFetchMock).toHaveBeenCalledWith(
        "/api/tasks/task-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({
            status: "completed",
            executionPlan: expect.stringContaining('"status":"completed"'),
          }),
        }),
      );
      expect(cpFetchMock).toHaveBeenCalledWith(
        "/api/tasks/task-1/branches",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            runtimeSessionId: "ses-1",
            isActive: false,
          }),
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  test("parallel finalization keeps winner selection manual", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: unknown }) => {
      if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            title: "Runtime pipeline task",
            prompt: "Summarize progress",
            projectId: "proj-1",
            sessionId: "ses-main",
            agentRunId: "run-main",
            result: null,
            strategy: null,
            selectedModel: "gpt-5.4",
            executionPlan: JSON.stringify({
              templateId: "parallel-default",
              mode: "parallel",
              steps: [{ id: "exec-parallel", type: "execution", status: "completed" }],
              candidates: [
                {
                  label: "Candidate A",
                  agent: "executor",
                  sessionId: "ses-1",
                  agentRunId: "run-1",
                  status: "completed",
                  result: "Answer A",
                },
                {
                  label: "Candidate B",
                  agent: "executor",
                  sessionId: "ses-2",
                  agentRunId: "run-2",
                  status: "completed",
                  result: "Answer B",
                },
              ],
            }),
          },
        };
      }

      return { ok: true, status: 200, data: { ok: true, body: options?.body } };
    });

    const aggregator = sseAggregator as unknown as {
      parallelCandidateResults: Map<string, Map<number, { sessionId: string; result?: string }>>;
      parallelTaskSessions: Map<string, Set<string>>;
      finalizeParallelTask: (taskId: string, projectId: string, authorization: string) => Promise<void>;
    };
    aggregator.parallelCandidateResults.set(
      "task-1",
      new Map([
        [0, { sessionId: "ses-1", result: "Answer A" }],
        [1, { sessionId: "ses-2", result: "Answer B" }],
      ]),
    );
    aggregator.parallelTaskSessions.set("task-1", new Set(["ses-1", "ses-2"]));

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      await aggregator.finalizeParallelTask("task-1", "proj-1", "Bearer internal");

      const taskPatchCall = (
        cpFetchMock.mock.calls as unknown as Array<
          [string, { method?: string; authorization?: string; body?: Record<string, unknown> }]
        >
      ).find(([url, options]) => url === "/api/tasks/task-1" && options?.method === "PATCH");
      expect(taskPatchCall).toBeDefined();
      expect(taskPatchCall?.[1]?.body?.status).toBeUndefined();
      expect(taskPatchCall?.[1]?.body?.result).toBeUndefined();
      const patchedPlan = JSON.parse(String(taskPatchCall?.[1]?.body?.executionPlan)) as {
        winnerCandidateIndex?: number;
        judgeResult?: { winnerIndex?: number };
        candidates: Array<{ result?: string; status?: string; finishedAt?: string }>;
      };
      expect(patchedPlan.winnerCandidateIndex).toBeUndefined();
      expect(patchedPlan.judgeResult?.winnerIndex).toBe(0);
      expect(patchedPlan.candidates).toEqual([
        expect.objectContaining({
          status: "completed",
          result: "Answer A",
          finishedAt: expect.any(String),
        }),
        expect.objectContaining({
          status: "completed",
          result: "Answer B",
          finishedAt: expect.any(String),
        }),
      ]);
      expect(emitted.some((event) => event.type === "task.completed")).toBe(false);
      expect(buildPipelineStageUpdatedEventsMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ reason: "task.completed" }),
      );
    } finally {
      unsubscribe();
    }
  });

  test("dag sync waits for graph persistence before emitting task.node.updated and pipeline.stage.updated", async () => {
    let releaseGraphSync: (() => void) | undefined;
    onGraphToolExecutedMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseGraphSync = resolve;
        }),
    );
    findAgentRunBySessionIdMock.mockReturnValue({
      subSessionId: "ses-1",
      status: "running",
      taskId: "task-1",
      projectId: "proj-1",
      agentRunId: "run-1",
    });
    buildPipelineStageUpdatedEventsMock.mockResolvedValue([
      {
        id: "evt-pipeline-node",
        type: "pipeline.stage.updated",
        ts: "2026-03-12T10:04:01.000Z",
        taskId: "task-1",
        sessionId: "ses-1",
        projectId: "proj-1",
        agentRunId: "run-1",
        data: {
          patch: { type: "upsert", stage: { id: "graph-node-1" } },
          summary: { totalStages: 1, completedStages: 0 },
          reason: "task.node.updated",
          status: "running",
          branchName: "main",
        },
      },
    ]);

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      const syncPromise = (
        sseAggregator as unknown as {
          maybeSyncDag: (
            type: string,
            payload: Record<string, unknown> | null,
            parsed: Record<string, unknown>,
            workspaceDirectory?: string,
          ) => Promise<void>;
        }
      ).maybeSyncDag(
        "tool.execute.after",
        {
          type: "tool.execute.after",
          sessionId: "ses-1",
          properties: {
            toolName: "task_graph_create",
            result: "{}",
          },
        },
        {},
        "/tmp/workspace",
      );

      await Promise.resolve();
      expect(emitted).toHaveLength(0);

      releaseGraphSync?.();
      await syncPromise;

      expect(emitted.map((event) => event.type)).toEqual([
        "task.node.updated",
        "pipeline.stage.updated",
      ]);
      expect(buildPipelineStageUpdatedEventsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          sessionId: "ses-1",
          projectId: "proj-1",
          agentRunId: "run-1",
          reason: "task.node.updated",
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  test("ingestParsedEvent reuses the same dag sync path as live SSE handling", async () => {
    findAgentRunBySessionIdMock.mockReturnValue({
      subSessionId: "ses-1",
      status: "running",
      taskId: "task-1",
      projectId: "proj-1",
      agentRunId: "run-1",
    });
    buildPipelineStageUpdatedEventsMock.mockResolvedValue([
      {
        id: "evt-pipeline-node",
        type: "pipeline.stage.updated",
        ts: "2026-03-12T10:04:01.000Z",
        taskId: "task-1",
        sessionId: "ses-1",
        projectId: "proj-1",
        agentRunId: "run-1",
        data: {
          patch: { type: "upsert", stage: { id: "graph-node-1" } },
          summary: { totalStages: 1, completedStages: 0 },
          reason: "task.node.updated",
          status: "running",
          branchName: "main",
        },
      },
    ]);

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      await (
        sseAggregator as unknown as {
          ingestParsedEvent: (type: string, parsed: Record<string, unknown>) => Promise<void>;
        }
      ).ingestParsedEvent("tool.execute.after", {
        directory: "/tmp/workspace",
        payload: {
          type: "tool.execute.after",
          sessionId: "ses-1",
          properties: {
            toolName: "task_graph_create",
            result: JSON.stringify({ graphId: "graph-1" }),
          },
        },
      });

      expect(emitted.map((event) => event.type)).toEqual([
        "tool.execute.after",
        "task.node.updated",
        "pipeline.stage.updated",
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("parallel question tools are failed instead of staying running forever", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: unknown }) => {
      if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "task-1",
            title: "Runtime pipeline task",
            prompt: "Summarize progress",
            projectId: "proj-1",
            sessionId: "ses-task-main",
            agentRunId: "run-1",
            result: "Done",
            strategy: null,
            selectedModel: "gpt-5.4",
            executionPlan: JSON.stringify({
              templateId: "parallel-default",
              mode: "parallel",
              steps: [],
              candidates: [
                {
                  label: "Candidate A",
                  agent: "executor",
                  sessionId: "ses-1",
                  agentRunId: "run-1",
                  status: "running",
                },
                {
                  label: "Candidate B",
                  agent: "executor",
                  sessionId: "ses-2",
                  agentRunId: "run-2",
                  status: "running",
                },
              ],
            }),
          },
        };
      }

      return { ok: true, status: 200, data: { ok: true, body: options?.body } };
    });

    findAgentRunBySessionIdMock.mockImplementation((sessionId?: string) => {
      if (sessionId === "ses-1") {
        return {
          subSessionId: "ses-1",
          taskId: "task-1",
          projectId: "proj-1",
          agentRunId: "run-1",
          status: "running",
        };
      }

      return undefined;
    });
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: true,
      failed: false,
      error: undefined,
      tokenUsed: 42,
      text: "Need clarification",
    });

    const aggregator = sseAggregator as unknown as {
      parallelTaskSessions: Map<string, Set<string>>;
      parallelCandidateResults: Map<string, Map<number, { sessionId: string; result?: string }>>;
      sessionToCandidateMap: Map<string, { taskId: string; candidateIndex: number }>;
    };
    aggregator.parallelTaskSessions.set("task-1", new Set(["ses-1", "ses-2"]));
    aggregator.parallelCandidateResults.set("task-1", new Map());
    aggregator.sessionToCandidateMap.set("ses-1", { taskId: "task-1", candidateIndex: 0 });

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      await (
        sseAggregator as unknown as {
          maybeFailParallelQuestionTool: (event: Record<string, unknown>) => Promise<void>;
        }
      ).maybeFailParallelQuestionTool({
        type: "tool.execute.before",
        sessionId: "ses-1",
        taskId: "task-1",
        projectId: "proj-1",
        agentRunId: "run-1",
        data: {
          tool: "question",
        },
      });

      expect(terminateAgentMock).toHaveBeenCalledWith("run-1");
      expect(updateAgentRunStatusMock).toHaveBeenCalledWith("run-1", "failed");
      const taskPatchCall = (
        cpFetchMock.mock.calls as unknown as Array<
          [string, { method?: string; authorization?: string; body?: { executionPlan?: string } }]
        >
      ).find(
        ([url, options]) => url === "/api/tasks/task-1" && options?.method === "PATCH",
      );
      expect(taskPatchCall).toBeDefined();
      expect(taskPatchCall?.[1]?.authorization).toBe("Bearer internal");
      expect(JSON.parse(String(taskPatchCall?.[1]?.body?.executionPlan))).toEqual({
        templateId: "parallel-default",
        mode: "parallel",
        steps: [],
        candidates: [
          {
            label: "Candidate A",
            agent: "executor",
            sessionId: "ses-1",
            agentRunId: "run-1",
            status: "failed",
            result:
              "[FAILED] Parallel candidate requested interactive clarification via question tool, which is not supported in unattended parallel execution.",
            finishedAt: expect.any(String),
          },
          {
            label: "Candidate B",
            agent: "executor",
            sessionId: "ses-2",
            agentRunId: "run-2",
            status: "running",
          },
        ],
      });
      expect(emitted.map((event) => event.type)).toContain("agent.completed");
    } finally {
      unsubscribe();
    }
  });
});
