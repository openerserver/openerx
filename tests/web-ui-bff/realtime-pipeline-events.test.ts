import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createControlPlaneClientModuleMock } from "./control-plane-client-mock";
import { createRuntimeProviderModuleMock } from "./runtime-provider-mock";
import {
  expectNoPublicTraceRequests,
  expectSessionMessageReaderCalls,
} from "./session-message-compatibility-test-helpers";

function isTaskDetailGet(url: string, options?: { method?: string }) {
  return (
    (options?.method || "GET") === "GET" &&
    (url === "/api/tasks/task-1" || url === "/api/project-tree/tasks/task-1")
  );
}

function createTaskDetailRecord(overrides?: Record<string, unknown>) {
  return {
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
    ...overrides,
  };
}

const cpFetchMock = mock(async (url: string, options?: { method?: string }) => {
  if (isTaskDetailGet(url, options)) {
    return {
      ok: true,
      status: 200,
      data: createTaskDetailRecord(),
    };
  }

  if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/sessions") {
    return {
      ok: true,
      status: 200,
      data: {
        data: [
          {
            id: "task-session:task-1:ses-1",
            runtimeSessionId: "ses-1",
            isActive: true,
            archivedAt: null,
          },
        ],
        meta: {
          currentSessionId: "task-session:task-1:ses-1",
        },
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

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () =>
  createControlPlaneClientModuleMock({
    authHeader: () => "Bearer test",
    cpFetch: cpFetchMock,
    createInternalAuthorization: createInternalAuthorizationMock,
  }),
);

const runtimeProviderModule = createRuntimeProviderModuleMock({
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
});

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/agent-run-registry", () => ({
  ensureAgentRunForSession: mock(() => "run-1"),
  findAgentRunBySessionId: findAgentRunBySessionIdMock,
  getAgentRun: getAgentRunMock,
  listAgentRuns: mock(() => []),
  recoverAgentRun: recoverAgentRunMock,
  registerAgentRun: mock(() => undefined),
  updateAgentRunStatus: updateAgentRunStatusMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/runtime-message-utils", () => ({
  extractAssistantResultFromMessages: extractAssistantResultFromMessagesMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/runtime-provider", () =>
  runtimeProviderModule,
);

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

mock.module(
  "../../control-plane/web-ui-bff/src/lib/orchestration-strategy",
  async () =>
    import(
      "../../control-plane/web-ui-bff/src/lib/orchestration-strategy?realtime-pipeline-events-test"
    ),
);

mock.module(
  "../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence",
  async () =>
    import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence?realtime-pipeline-events-test"
    ),
);

mock.module(
  "../../control-plane/web-ui-bff/src/modules/tasks/finalize",
  async () =>
    import(
      "../../control-plane/web-ui-bff/src/modules/tasks/finalize?realtime-pipeline-events-test"
    ),
);

const { sseAggregator } = await import(
  "../../control-plane/web-ui-bff/src/modules/realtime/sse-aggregator?realtime-pipeline-events-test"
);

function resetAggregatorState() {
  const aggregator = sseAggregator as unknown as {
    finalizedAgentRuns: Set<string>;
    finalizingAgentRuns: Set<string>;
    parallelTaskSessions: Map<string, Set<string>>;
    parallelTaskPhaseIds: Map<string, string>;
    parallelCandidateResults: Map<string, Map<number, { sessionId: string; result?: string }>>;
    sessionToCandidateMap: Map<string, { taskId: string; candidateIndex: number }>;
    sequentialChainTasks: Map<string, unknown>;
    sessionToChainStepMap: Map<string, unknown>;
    judgingTasks: Set<string>;
    paidExecutionRuntime: Map<string, { tripped: boolean; reason?: string }>;
  };

  aggregator.finalizedAgentRuns.clear();
  aggregator.finalizingAgentRuns.clear();
  aggregator.parallelTaskSessions.clear();
  aggregator.parallelTaskPhaseIds.clear();
  aggregator.parallelCandidateResults.clear();
  aggregator.sessionToCandidateMap.clear();
  aggregator.sequentialChainTasks.clear();
  aggregator.sessionToChainStepMap.clear();
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
    if (isTaskDetailGet(url, options)) {
      return {
        ok: true,
        status: 200,
        data: createTaskDetailRecord(),
      };
    }

    if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/sessions") {
      return {
        ok: true,
        status: 200,
        data: {
          data: [
            {
              id: "task-session:task-1:ses-1",
              runtimeSessionId: "ses-1",
              isActive: true,
              archivedAt: null,
            },
          ],
          meta: {
            currentSessionId: "task-session:task-1:ses-1",
          },
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

  test("message.updated emits a task-domain message patch before the legacy event", async () => {
    findAgentRunBySessionIdMock.mockReturnValue({
      subSessionId: "ses-1",
      taskId: "task-1",
      projectId: "proj-1",
      agentRunId: "run-1",
      status: "running",
    });

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      await sseAggregator.ingestParsedEvent("message.updated", {
        sessionId: "ses-1",
        info: {
          id: "msg-1",
          role: "assistant",
          agent: "planner",
          time: {
            created: "2026-03-12T10:05:00.000Z",
          },
        },
      });

      expect(emitted.map((event) => event.type)).toEqual([
        "task.message.updated",
        "message.updated",
      ]);
      expect(emitted[0]).toMatchObject({
        sessionId: "ses-1",
        taskId: "task-1",
        projectId: "proj-1",
        agentRunId: "run-1",
        data: {
          message: {
            id: "msg-1",
            role: "assistant",
            agent: "planner",
          },
          reason: "message.updated",
        },
      });
    } finally {
      unsubscribe();
    }
  });

  test("message.part.updated and session.updated emit task-domain delta and snapshot patches", async () => {
    findAgentRunBySessionIdMock.mockReturnValue({
      subSessionId: "ses-1",
      taskId: "task-1",
      projectId: "proj-1",
      agentRunId: "run-1",
      status: "running",
    });

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      await sseAggregator.ingestParsedEvent("message.part.updated", {
        sessionId: "ses-1",
        part: {
          messageID: "msg-1",
          type: "text",
          text: "正在输出",
        },
      });

      await sseAggregator.ingestParsedEvent("session.updated", {
        sessionId: "ses-1",
      });

      expect(emitted.map((event) => event.type)).toEqual([
        "task.message.delta",
        "message.updated",
        "task.snapshot.updated",
        "session.updated",
      ]);
      expect(emitted[0]).toMatchObject({
        taskId: "task-1",
        sessionId: "ses-1",
        data: {
          messageId: "msg-1",
          partType: "text",
          delta: "正在输出",
          reason: "message.part.updated",
        },
      });
      expect(emitted[2]).toMatchObject({
        taskId: "task-1",
        sessionId: "ses-1",
        data: {
          reason: "session.updated",
          scope: "session",
        },
      });
    } finally {
      unsubscribe();
    }
  });

  test("metadata-only user message.updated persists the full runtime message payload", async () => {
    findAgentRunBySessionIdMock.mockReturnValue({
      subSessionId: "ses-1",
      taskId: "task-1",
      projectId: "proj-1",
      agentRunId: "run-1",
      status: "running",
    });
    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          info: {
            id: "msg-1",
            role: "user",
            time: {
              created: 1774794038540,
            },
          },
          parts: [
            {
              type: "text",
              text: "真实用户输入",
            },
          ],
        },
      ],
    });

    await sseAggregator.ingestParsedEvent("message.updated", {
      sessionId: "ses-1",
      info: {
        id: "msg-1",
        role: "user",
        time: {
          created: 1774794038540,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSessionMessagesMock).toHaveBeenCalledWith("ses-1", {
      includeLineage: false,
      bypassCircuitBreaker: true,
    });
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/sessions/messages",
      expect.objectContaining({
        method: "POST",
        authorization: "Bearer internal",
        body: expect.objectContaining({
          runtimeSessionId: "ses-1",
          message: expect.objectContaining({
            info: expect.objectContaining({ id: "ses-1:user-prompt", role: "user" }),
            parts: [expect.objectContaining({ type: "text", text: "真实用户输入" })],
            promptDecomposition: expect.objectContaining({
              finalSentText: "真实用户输入",
            }),
          }),
        }),
      }),
    );
  });

  test("parallel candidate user message snapshots are persisted for each runtime session", async () => {
    findAgentRunBySessionIdMock.mockImplementation((sessionId: string) => ({
      subSessionId: sessionId,
      taskId: "task-1",
      projectId: "proj-1",
      agentRunId: `run-${sessionId}`,
      status: "running",
    }));
    getSessionMessagesMock.mockImplementation(async (sessionId: string) => ({
      ok: true,
      data: [
        {
          info: {
            id: `msg-${sessionId}`,
            role: "user",
            time: {
              created: 1774794038540,
            },
          },
          parts: [
            {
              type: "text",
              text: "给两个初步定义",
            },
          ],
        },
      ] as Array<Record<string, unknown>>,
    }));

    sseAggregator.registerParallelTask("task-1", [
      { sessionId: "ses-a" } as { sessionId: string },
      { sessionId: "ses-b" } as { sessionId: string },
    ]);

    await sseAggregator.ingestParsedEvent("message.updated", {
      sessionId: "ses-a",
      info: {
        id: "msg-ses-a",
        role: "user",
        time: {
          created: 1774794038540,
        },
      },
    });

    await sseAggregator.ingestParsedEvent("message.updated", {
      sessionId: "ses-b",
      info: {
        id: "msg-ses-b",
        role: "user",
        time: {
          created: 1774794039040,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expectSessionMessageReaderCalls(getSessionMessagesMock, ["ses-a", "ses-b"]);

    const persistCalls = cpFetchMock.mock.calls.filter(
      ([url, options]) =>
        url === "/api/tasks/task-1/sessions/messages" &&
        (options as { method?: string } | undefined)?.method === "POST",
    );

    expect(persistCalls).toHaveLength(2);
    expect(persistCalls).toEqual([
      [
        "/api/tasks/task-1/sessions/messages",
        expect.objectContaining({
          method: "POST",
          authorization: "Bearer internal",
          body: expect.objectContaining({
            runtimeSessionId: "ses-a",
            message: expect.objectContaining({
              info: expect.objectContaining({ id: "ses-a:user-prompt", role: "user" }),
              parts: [expect.objectContaining({ type: "text", text: "给两个初步定义" })],
              promptDecomposition: expect.objectContaining({
                finalSentText: "给两个初步定义",
              }),
            }),
          }),
        }),
      ],
      [
        "/api/tasks/task-1/sessions/messages",
        expect.objectContaining({
          method: "POST",
          authorization: "Bearer internal",
          body: expect.objectContaining({
            runtimeSessionId: "ses-b",
            message: expect.objectContaining({
              info: expect.objectContaining({ id: "ses-b:user-prompt", role: "user" }),
              parts: [expect.objectContaining({ type: "text", text: "给两个初步定义" })],
              promptDecomposition: expect.objectContaining({
                finalSentText: "给两个初步定义",
              }),
            }),
          }),
        }),
      ],
    ]);
    expectNoPublicTraceRequests(cpFetchMock.mock.calls.map(([url]) => String(url)));
  });

  test("message.part.updated persists the matching full runtime message instead of the standalone part payload", async () => {
    findAgentRunBySessionIdMock.mockReturnValue({
      subSessionId: "ses-1",
      taskId: "task-1",
      projectId: "proj-1",
      agentRunId: "run-1",
      status: "running",
    });
    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          info: {
            id: "msg-2",
            role: "assistant",
            time: {
              created: 1774794038542,
              completed: 1774794043128,
            },
          },
          parts: [
            {
              type: "text",
              text: "完整 assistant 回复",
            },
          ],
        },
      ],
    });

    await sseAggregator.ingestParsedEvent("message.part.updated", {
      sessionId: "ses-1",
      part: {
        messageID: "msg-2",
        type: "text",
        text: "片段",
      },
      delta: "片段",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/sessions/messages",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          runtimeSessionId: "ses-1",
          message: expect.objectContaining({
            info: expect.objectContaining({ id: "msg-2", role: "assistant" }),
            parts: [expect.objectContaining({ type: "text", text: "完整 assistant 回复" })],
          }),
        }),
      }),
    );
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

  test("post-execution hooks can spawn follow-up execution and emit follow-up events", async () => {
    const orchestrationStrategyModule = await import(
      "../../control-plane/web-ui-bff/src/lib/orchestration-strategy?realtime-pipeline-events-test"
    );
    const originalStrategy = orchestrationStrategyModule.readOrchestrationStrategy();
    orchestrationStrategyModule.writeOrchestrationStrategy({
      ...originalStrategy,
      followups: [
        {
          id: "post-review-followup",
          enabled: true,
          agent: "oracle-enterprise",
          model: "github-copilot:gpt-5.4",
          promptTemplate: [
            "Continue summary for Opener-X task.",
            "Task title: {{taskTitle}}",
            "Continue goal: {{continueGoal}}",
            "Task result:",
            "{{taskResult}}",
            "Hook result:",
            "{{hookResult}}",
          ].join("\n"),
          timeoutMs: 15000,
          resultMode: "advisory",
        },
      ],
    });

    executeLifecycleHooksMock.mockResolvedValue({
      hookExecutions: [
        {
          hookId: "post-review",
          trigger: "post-execution",
          status: "completed",
          agent: "reviewer",
          sessionId: "ses-hook",
          completedAt: "2026-03-12T10:05:00.000Z",
          result: "Need a final verification summary.",
          decision: {
            action: "spawn-followup",
            reason: "Need final verification",
            followupTemplateId: "post-review-followup",
            followupGoal: "Summarize remaining risks",
            targetAgent: "oracle-enterprise",
            targetModel: "github-copilot:gpt-5.4",
          },
        },
      ],
    });
    runDetachedPromptMock.mockResolvedValue({
      ok: true,
      completed: true,
      text: "Continue summary",
      sessionId: "ses-followup",
      tokenUsed: 321,
      model: {
        providerId: "github-copilot",
        modelId: "gpt-5.4",
      },
    });
    cpFetchMock.mockImplementation(
      async (url: string, options?: { method?: string; body?: unknown }) => {
        if (isTaskDetailGet(url, options)) {
          return {
            ok: true,
            status: 200,
            data: createTaskDetailRecord({
              strategy: JSON.stringify({
                effectiveModel: "github-copilot:gpt-5.4",
              }),
            }),
          };
        }

        if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/sessions") {
          return {
            ok: true,
            status: 200,
            data: {
              data: [
                {
                  runtimeSessionId: "ses-task-main",
                  isActive: true,
                  archivedAt: null,
                },
              ],
            },
          };
        }

        return { ok: true, status: 200, data: { body: options?.body } };
      },
    );
    buildPipelineStageUpdatedEventsMock
      .mockResolvedValueOnce([
        {
          id: "evt-pipeline-hook",
          type: "pipeline.stage.updated",
          ts: "2026-03-12T10:05:01.000Z",
          taskId: "task-1",
          sessionId: "ses-task-main",
          projectId: "proj-1",
          data: {
            patch: { type: "upsert", stage: { id: "post-hook-1" } },
            summary: { totalStages: 1, completedStages: 1 },
            reason: "task.hooks.updated",
            status: "completed",
            branchName: "main",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "evt-pipeline-followup-started",
          type: "pipeline.stage.updated",
          ts: "2026-03-12T10:05:02.000Z",
          taskId: "task-1",
          sessionId: "ses-task-main",
          projectId: "proj-1",
          data: {
            patch: { type: "upsert", stage: { id: "follow-up-start" } },
            summary: { totalStages: 2, completedStages: 1 },
            reason: "task.followup.started",
            status: "completed",
            branchName: "main",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "evt-pipeline-followup-completed",
          type: "pipeline.stage.updated",
          ts: "2026-03-12T10:05:03.000Z",
          taskId: "task-1",
          sessionId: "ses-task-main",
          projectId: "proj-1",
          data: {
            patch: { type: "upsert", stage: { id: "follow-up-1" } },
            summary: { totalStages: 3, completedStages: 2 },
            reason: "task.followup.completed",
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
        "task.followup.started",
        "pipeline.stage.updated",
        "task.followup.completed",
        "pipeline.stage.updated",
      ]);
      expect(runDetachedPromptMock).toHaveBeenCalledWith(
        expect.stringContaining("[Continue task-1]"),
        expect.stringContaining("Summarize remaining risks"),
        expect.objectContaining({
          agent: "oracle-enterprise",
          model: {
            providerId: "github-copilot",
            modelId: "gpt-5.4",
          },
        }),
      );

      const taskPatchCalls = cpFetchMock.mock.calls.filter(
        (call) =>
          call[0] === "/api/tasks/task-1" && (call[1] as { method?: string })?.method === "PATCH",
      );
      expect(taskPatchCalls).toHaveLength(2);
      expect(
        taskPatchCalls.some((call) => {
          const body = (call[1] as { body?: { strategy?: string } }).body;
          if (!body?.strategy || typeof body.strategy !== "string") {
            return false;
          }
          const parsed = JSON.parse(body.strategy) as {
            followupExecutions?: Array<{
              templateId?: string;
              triggerHookId?: string;
              result?: string;
            }>;
          };
          return (
            parsed.followupExecutions?.some(
              (execution) =>
                execution.templateId === "post-review-followup" &&
                execution.triggerHookId === "post-review" &&
                execution.result === "Continue summary",
            ) === true
          );
        }),
      ).toBe(true);
    } finally {
      unsubscribe();
      orchestrationStrategyModule.writeOrchestrationStrategy(originalStrategy);
    }
  });

  test("post-execution hooks are skipped when paid execution guard disables them", async () => {
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (isTaskDetailGet(url, options)) {
        return {
          ok: true,
          status: 200,
          data: createTaskDetailRecord({
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
          }),
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
        if (isTaskDetailGet(url, options)) {
          return {
            ok: true,
            status: 200,
            data: createTaskDetailRecord({
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
            }),
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
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: true,
      failed: false,
      error: undefined,
      tokenUsed: 0,
      text: "Final answer",
      traceId: "trace-final-1",
    });
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
            result: "Final answer",
          }),
        }),
      );
      expect(cpFetchMock).toHaveBeenCalledWith(
        "/api/tasks/task-1/sessions",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            runtimeSessionId: "ses-1",
            isActive: false,
          }),
        }),
      );
      expect(cpFetchMock).toHaveBeenCalledWith(
        "/api/audit",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            action: "completed",
            traceId: "trace-final-1",
          }),
        }),
      );
      expectSessionMessageReaderCalls(getSessionMessagesMock, ["ses-1"]);
      expectNoPublicTraceRequests(cpFetchMock.mock.calls.map(([url]) => String(url)));
    } finally {
      unsubscribe();
    }
  });

  test("unmapped completion signals do not route parallel tasks through single finalization", async () => {
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: true,
      failed: false,
      error: undefined,
      tokenUsed: 0,
      text: "Late answer",
      traceId: "trace-late-1",
    });
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
          parts: [{ type: "text", text: "Late answer" }],
        },
      ],
    });
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if ((options?.method || "GET") === "GET" && url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: createTaskDetailRecord({
            status: "running",
            orchestrationKind: "parallel",
            sessionId: "ses-main",
            agentRunId: "run-main",
          }),
        };
      }

      if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/sessions") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                id: "task-session:task-1:ses-1",
                runtimeSessionId: "ses-1",
                isActive: true,
                archivedAt: null,
              },
            ],
            meta: {
              currentSessionId: "task-session:task-1:ses-1",
            },
          },
        };
      }

      return { ok: true, status: 200, data: { ok: true } };
    });

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
        id: "evt-session-idle-late",
        type: "session.idle",
        ts: "2026-03-12T10:03:00.000Z",
        sessionId: "ses-1",
        taskId: "task-1",
        projectId: "proj-1",
        agentRunId: "run-1",
        data: {},
      });

      expect(updateAgentRunStatusMock).toHaveBeenCalledWith("run-1", "completed");
      expect(emitted.some((event) => event.type === "task.completed")).toBe(false);
      expect(buildPipelineStageUpdatedEventsMock).not.toHaveBeenCalled();
      expect(cpFetchMock).not.toHaveBeenCalledWith(
        "/api/tasks/task-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({ status: "completed" }),
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  test("completion signals recover parallel candidate tracking from task-session lineage", async () => {
    extractAssistantResultFromMessagesMock.mockReturnValue({
      completed: true,
      failed: false,
      error: undefined,
      tokenUsed: 0,
      text: "Recovered answer",
      traceId: "trace-recovered-1",
    });
    findAgentRunBySessionIdMock.mockImplementation((sessionId?: string) => {
      if (sessionId === "ses-2") {
        return {
          agentRunId: "run-2",
          subSessionId: "ses-2",
          status: "running",
          taskId: "task-1",
          projectId: "proj-1",
        };
      }
      return undefined;
    });
    getSessionMessagesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          info: {
            role: "assistant",
            time: { completed: Date.parse("2026-03-12T10:04:00.000Z") },
          },
          parts: [{ type: "text", text: "Recovered answer" }],
        },
      ],
    });
    cpFetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: any }) => {
      if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/sessions") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              {
                id: "task-session:task-1:ses-1",
                taskId: "task-1",
                runtimeSessionId: "ses-1",
                phaseId: "phase-1",
                phaseRole: "candidate",
                phaseItemIndex: 0,
                sessionKind: "candidate",
                candidateIndex: 0,
                executionModeSnapshot: "parallel",
                executionStatus: "completed",
                archivedAt: null,
              },
              {
                id: "task-session:task-1:ses-2",
                taskId: "task-1",
                runtimeSessionId: "ses-2",
                phaseId: "phase-1",
                phaseRole: "candidate",
                phaseItemIndex: 1,
                sessionKind: "candidate",
                candidateIndex: 1,
                executionModeSnapshot: "parallel",
                executionStatus: "running",
                archivedAt: null,
              },
            ],
            meta: {
              currentSessionId: "task-session:task-1:ses-2",
            },
          },
        };
      }

      if ((options?.method || "GET") === "GET" && url === "/api/project-tree/tasks/task-1") {
        return {
          ok: true,
          status: 200,
          data: createTaskDetailRecord({
            status: "running",
            orchestrationKind: null,
            sessionId: "ses-main",
            agentRunId: "run-main",
            result: null,
          }),
        };
      }

      if (options?.method === "POST" && url === "/api/tasks/task-1/phases") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "phase-1",
            status: "awaiting_adoption",
            awaitingAdoptionSince: "2026-04-08T03:18:24.437Z",
          },
        };
      }

      return { ok: true, status: 200, data: { ok: true, body: options?.body } };
    });

    const aggregator = sseAggregator as unknown as {
      maybeFinalizeRun: (event: Record<string, unknown>) => Promise<void>;
      parallelCandidateResults: Map<string, Map<number, { sessionId: string; result?: string }>>;
    };
    aggregator.parallelCandidateResults.set(
      "task-1",
      new Map([[0, { sessionId: "ses-1", result: "Answer A" }]]),
    );

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      await aggregator.maybeFinalizeRun({
        id: "evt-session-idle-recovered",
        type: "session.idle",
        ts: "2026-03-12T10:04:00.000Z",
        sessionId: "ses-2",
        taskId: "task-1",
        projectId: "proj-1",
        agentRunId: "run-2",
        data: {},
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const calls = cpFetchMock.mock.calls as unknown as Array<
        [string, { method?: string; authorization?: string; body?: Record<string, unknown> }]
      >;
      const completedPatchCall = calls.find(
        ([url, options]) =>
          url === "/api/tasks/task-1" &&
          options?.method === "PATCH" &&
          options.body?.status === "completed",
      );
      const awaitingPatchCall = calls.find(
        ([url, options]) =>
          url === "/api/tasks/task-1" &&
          options?.method === "PATCH" &&
          options.body?.status === "awaiting_adoption",
      );

      expect(completedPatchCall).toBeUndefined();
      expect(awaitingPatchCall).toBeDefined();
      expect(emitted).toContainEqual(
        expect.objectContaining({
          type: "agent.completed",
          taskId: "task-1",
          sessionId: "ses-2",
          data: expect.objectContaining({
            candidateIndex: 1,
            executionMode: "parallel",
          }),
        }),
      );
      expect(emitted).toContainEqual(
        expect.objectContaining({
          type: "task.phase.awaiting_adoption",
          taskId: "task-1",
          phaseId: "phase-1",
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  test("parallel finalization keeps winner selection manual", async () => {
    cpFetchMock.mockImplementation(
      async (url: string, options?: { method?: string; body?: unknown }) => {
        if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/sessions") {
          return {
            ok: true,
            status: 200,
            data: {
              data: [
                {
                  id: "task-session:task-1:ses-1",
                  taskId: "task-1",
                  runtimeSessionId: "ses-1",
                  phaseId: "phase-1",
                  phaseRole: "candidate",
                  phaseItemIndex: 0,
                  sessionKind: "candidate",
                  candidateIndex: 0,
                  executionModeSnapshot: "parallel",
                  executionStatus: "complete",
                  archivedAt: null,
                },
                {
                  id: "task-session:task-1:ses-2",
                  taskId: "task-1",
                  runtimeSessionId: "ses-2",
                  phaseId: "phase-1",
                  phaseRole: "candidate",
                  phaseItemIndex: 1,
                  sessionKind: "candidate",
                  candidateIndex: 1,
                  executionModeSnapshot: "parallel",
                  executionStatus: "complete",
                  archivedAt: null,
                },
              ],
              meta: {
                currentSessionId: "task-session:task-1:ses-2",
              },
            },
          };
        }

        if ((options?.method || "GET") === "GET" && url === "/api/project-tree/tasks/task-1") {
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
            },
          };
        }

        if (options?.method === "POST" && url === "/api/tasks/task-1/phases") {
          return {
            ok: true,
            status: 200,
            data: {
              id: "phase-1",
              status: "awaiting_adoption",
              awaitingAdoptionSince: "2026-04-08T03:18:24.437Z",
            },
          };
        }

        return { ok: true, status: 200, data: { ok: true, body: options?.body } };
      },
    );

    const aggregator = sseAggregator as unknown as {
      parallelCandidateResults: Map<string, Map<number, { sessionId: string; result?: string }>>;
      parallelTaskSessions: Map<string, Set<string>>;
      parallelTaskPhaseIds: Map<string, string>;
      finalizeParallelTask: (
        taskId: string,
        projectId: string,
        authorization: string,
      ) => Promise<void>;
    };
    aggregator.parallelCandidateResults.set(
      "task-1",
      new Map([
        [0, { sessionId: "ses-1", result: "Answer A" }],
        [1, { sessionId: "ses-2", result: "Answer B" }],
      ]),
    );
    aggregator.parallelTaskSessions.set("task-1", new Set(["ses-1", "ses-2"]));
    aggregator.parallelTaskPhaseIds.set("task-1", "phase-1");

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
      expect(taskPatchCall?.[1]?.body?.status).toBe("awaiting_adoption");
      expect(taskPatchCall?.[1]?.body?.result).toBeUndefined();
      expect(taskPatchCall?.[1]?.body).not.toHaveProperty("executionPlan");

      const phaseUpsertCall = (
        cpFetchMock.mock.calls as unknown as Array<
          [string, { method?: string; authorization?: string; body?: Record<string, unknown> }]
        >
      ).find(([url, options]) => url === "/api/tasks/task-1/phases" && options?.method === "POST");
      expect(phaseUpsertCall).toBeDefined();
      expect(phaseUpsertCall?.[1]?.body).toMatchObject({
        id: "phase-1",
        phaseKind: "parallel",
        status: "awaiting_adoption",
        candidateCount: 2,
      });

      expect(emitted).toContainEqual(
        expect.objectContaining({
          type: "task.phase.awaiting_adoption",
          taskId: "task-1",
          projectId: "proj-1",
          phaseId: "phase-1",
          data: expect.objectContaining({
            phaseId: "phase-1",
            status: "awaiting_adoption",
            candidateCount: 2,
            awaitingAdoptionSince: "2026-04-08T03:18:24.437Z",
          }),
        }),
      );
      expect(buildPipelineStageUpdatedEventsMock).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "task.phase.awaiting_adoption" }),
      );
    } finally {
      unsubscribe();
    }
  });

  test("parallel finalization waits for all tracked candidates to settle before awaiting adoption", async () => {
    findAgentRunBySessionIdMock.mockImplementation((sessionId?: string) => {
      if (sessionId === "ses-2") {
        return {
          agentRunId: "run-2",
          subSessionId: "ses-2",
          status: "running",
          taskId: "task-1",
          projectId: "proj-1",
        };
      }
      return undefined;
    });
    getSessionMessagesMock.mockResolvedValue({ ok: true, data: [] });
    cpFetchMock.mockImplementation(
      async (url: string, options?: { method?: string; body?: unknown }) => {
        if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/sessions") {
          return {
            ok: true,
            status: 200,
            data: {
              data: [
                {
                  id: "task-session:task-1:ses-1",
                  taskId: "task-1",
                  runtimeSessionId: "ses-1",
                  phaseId: "phase-1",
                  phaseRole: "candidate",
                  phaseItemIndex: 0,
                  sessionKind: "candidate",
                  candidateIndex: 0,
                  executionModeSnapshot: "parallel",
                  executionStatus: "complete",
                  archivedAt: null,
                },
                {
                  id: "task-session:task-1:ses-2",
                  taskId: "task-1",
                  runtimeSessionId: "ses-2",
                  phaseId: "phase-1",
                  phaseRole: "candidate",
                  phaseItemIndex: 1,
                  sessionKind: "candidate",
                  candidateIndex: 1,
                  executionModeSnapshot: "parallel",
                  executionStatus: "running",
                  archivedAt: null,
                },
              ],
              meta: {
                currentSessionId: "task-session:task-1:ses-2",
              },
            },
          };
        }

        if ((options?.method || "GET") === "GET" && url === "/api/project-tree/tasks/task-1") {
          return {
            ok: true,
            status: 200,
            data: createTaskDetailRecord({
              status: "running",
              orchestrationKind: "parallel",
              sessionId: "ses-main",
              agentRunId: "run-main",
              result: null,
            }),
          };
        }

        return { ok: true, status: 200, data: { ok: true, body: options?.body } };
      },
    );

    const aggregator = sseAggregator as unknown as {
      parallelCandidateResults: Map<string, Map<number, { sessionId: string; result?: string }>>;
      parallelTaskSessions: Map<string, Set<string>>;
      parallelTaskPhaseIds: Map<string, string>;
      judgingTasks: Set<string>;
      finalizeParallelTask: (
        taskId: string,
        projectId: string,
        authorization: string,
      ) => Promise<void>;
    };
    aggregator.parallelCandidateResults.set(
      "task-1",
      new Map([
        [0, { sessionId: "ses-1", result: "Answer A" }],
        [1, { sessionId: "ses-2", result: "Answer B" }],
      ]),
    );
    aggregator.parallelTaskSessions.set("task-1", new Set(["ses-1", "ses-2"]));
    aggregator.parallelTaskPhaseIds.set("task-1", "phase-1");

    const emitted: Array<Record<string, unknown>> = [];
    const unsubscribe = sseAggregator.onEvent((event) => {
      emitted.push(event as unknown as Record<string, unknown>);
    });

    try {
      await aggregator.finalizeParallelTask("task-1", "proj-1", "Bearer internal");

      const awaitingPatchCall = (
        cpFetchMock.mock.calls as unknown as Array<
          [string, { method?: string; authorization?: string; body?: Record<string, unknown> }]
        >
      ).find(
        ([url, options]) =>
          url === "/api/tasks/task-1" &&
          options?.method === "PATCH" &&
          options.body?.status === "awaiting_adoption",
      );
      expect(awaitingPatchCall).toBeUndefined();
      expect(
        (cpFetchMock.mock.calls as unknown as Array<[string, { method?: string } | undefined]>).some(
          ([url, options]) => url === "/api/tasks/task-1/phases" && options?.method === "POST",
        ),
      ).toBe(false);
      expect(emitted.some((event) => event.type === "task.phase.awaiting_adoption")).toBe(false);
      expect(buildPipelineStageUpdatedEventsMock).not.toHaveBeenCalled();
      expect(aggregator.parallelTaskSessions.get("task-1")?.size).toBe(2);
      expect(aggregator.parallelCandidateResults.get("task-1")?.size).toBe(2);
      expect(aggregator.judgingTasks.has("task-1")).toBe(false);
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

  test("tool execute events are persisted to control-plane as standalone tool parts", async () => {
    findAgentRunBySessionIdMock.mockReturnValue({
      subSessionId: "ses-1",
      status: "running",
      taskId: "task-1",
      projectId: "proj-1",
      agentRunId: "run-1",
    });

    await (
      sseAggregator as unknown as {
        ingestParsedEvent: (type: string, parsed: Record<string, unknown>) => Promise<void>;
      }
    ).ingestParsedEvent("tool.execute.before", {
      payload: {
        type: "tool.execute.before",
        sessionId: "ses-1",
        toolName: "search_code",
        callID: "call-1",
        input: { query: "task tree" },
      },
    });

    await (
      sseAggregator as unknown as {
        ingestParsedEvent: (type: string, parsed: Record<string, unknown>) => Promise<void>;
      }
    ).ingestParsedEvent("tool.execute.after", {
      payload: {
        type: "tool.execute.after",
        sessionId: "ses-1",
        toolName: "search_code",
        callID: "call-1",
        properties: {
          toolName: "search_code",
          result: "match found",
        },
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    const persistCalls = (
      cpFetchMock.mock.calls as unknown as Array<
        [string, { method?: string; authorization?: string; body?: Record<string, unknown> }]
      >
    ).filter(
      ([url, options]) =>
        url === "/api/tasks/task-1/sessions/messages" && (options?.method || "GET") === "POST",
    );

    expect(persistCalls).toHaveLength(2);
    expect(persistCalls[0]?.[1]?.body).toEqual(
      expect.objectContaining({
        runtimeSessionId: "ses-1",
        message: expect.objectContaining({
          id: "ses-1:tool:call-1",
          role: "tool",
          part: expect.objectContaining({
            type: "tool",
            tool: "search_code",
            callID: "call-1",
            messageID: "ses-1:tool:call-1",
            state: expect.objectContaining({
              status: "running",
            }),
          }),
        }),
      }),
    );
    expect(persistCalls[1]?.[1]?.body).toEqual(
      expect.objectContaining({
        runtimeSessionId: "ses-1",
        message: expect.objectContaining({
          role: "tool",
          id: "ses-1:tool:call-1",
          part: expect.objectContaining({
            type: "tool",
            tool: "search_code",
            callID: "call-1",
            messageID: "ses-1:tool:call-1",
            state: expect.objectContaining({
              status: "completed",
              output: "match found",
            }),
          }),
        }),
      }),
    );
  });

  test("parallel question tools are failed instead of staying running forever", async () => {
    cpFetchMock.mockImplementation(
      async (url: string, options?: { method?: string; body?: unknown }) => {
        if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/sessions") {
          return {
            ok: true,
            status: 200,
            data: {
              data: [
                {
                  id: "task-session:task-1:ses-1",
                  taskId: "task-1",
                  runtimeSessionId: "ses-1",
                  phaseId: "phase-1",
                  phaseRole: "candidate",
                  phaseItemIndex: 0,
                  sessionKind: "candidate",
                  candidateIndex: 0,
                  executionModeSnapshot: "parallel",
                  executionStatus: "complete",
                  archivedAt: null,
                },
                {
                  id: "task-session:task-1:ses-2",
                  taskId: "task-1",
                  runtimeSessionId: "ses-2",
                  phaseId: "phase-1",
                  phaseRole: "candidate",
                  phaseItemIndex: 1,
                  sessionKind: "candidate",
                  candidateIndex: 1,
                  executionModeSnapshot: "parallel",
                  executionStatus: "complete",
                  archivedAt: null,
                },
              ],
              meta: {
                currentSessionId: "task-session:task-1:ses-2",
              },
            },
          };
        }

        if ((options?.method || "GET") === "GET" && url === "/api/project-tree/tasks/task-1") {
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
            },
          };
        }

        return { ok: true, status: 200, data: { ok: true, body: options?.body } };
      },
    );

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
          [string, { method?: string; authorization?: string; body?: Record<string, unknown> }]
        >
      ).find(([url, options]) => url === "/api/tasks/task-1" && options?.method === "PATCH");
      expect(taskPatchCall).toBeUndefined();
      expect(emitted.map((event) => event.type)).toContain("agent.completed");
    } finally {
      unsubscribe();
    }
  });

  test("parallel candidate question failures stop patching legacy runtime plan once run projection is available", async () => {
    cpFetchMock.mockImplementation(
      async (url: string, options?: { method?: string; body?: unknown }) => {
        if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/sessions") {
          return {
            ok: true,
            status: 200,
            data: {
              data: [
                {
                  id: "task-session:task-1:ses-1",
                  taskId: "task-1",
                  runtimeSessionId: "ses-1",
                  phaseId: "phase-1",
                  phaseRole: "candidate",
                  phaseItemIndex: 0,
                  sessionKind: "candidate",
                  candidateIndex: 0,
                  executionModeSnapshot: "parallel",
                  executionStatus: "complete",
                  archivedAt: null,
                },
                {
                  id: "task-session:task-1:ses-2",
                  taskId: "task-1",
                  runtimeSessionId: "ses-2",
                  phaseId: "phase-1",
                  phaseRole: "candidate",
                  phaseItemIndex: 1,
                  sessionKind: "candidate",
                  candidateIndex: 1,
                  executionModeSnapshot: "parallel",
                  executionStatus: "complete",
                  archivedAt: null,
                },
              ],
              meta: {
                currentSessionId: "task-session:task-1:ses-2",
              },
            },
          };
        }

        if ((options?.method || "GET") === "GET" && url === "/api/project-tree/tasks/task-1") {
          return {
            ok: true,
            status: 200,
            data: {
              id: "task-1",
              title: "Projection-backed parallel task",
              prompt: "Summarize progress",
              projectId: "proj-1",
              sessionId: "ses-task-main",
              currentRunId: "task_run:task-1:ses-task-main",
              orchestrationKind: "parallel",
            },
          };
        }

        return { ok: true, status: 200, data: { ok: true, body: options?.body } };
      },
    );

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

    const taskPatchCall = (
      cpFetchMock.mock.calls as unknown as Array<
        [string, { method?: string; authorization?: string; body?: Record<string, unknown> }]
      >
    ).find(([url, options]) => url === "/api/tasks/task-1" && options?.method === "PATCH");
    expect(taskPatchCall).toBeUndefined();
  });

  test("projection-backed parallel finalization stops patching legacy runtime plan", async () => {
    cpFetchMock.mockImplementation(
      async (url: string, options?: { method?: string; body?: unknown }) => {
        if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/sessions") {
          return {
            ok: true,
            status: 200,
            data: {
              data: [
                {
                  id: "task-session:task-1:ses-1",
                  taskId: "task-1",
                  runtimeSessionId: "ses-1",
                  phaseId: "phase-1",
                  phaseRole: "candidate",
                  phaseItemIndex: 0,
                  sessionKind: "candidate",
                  candidateIndex: 0,
                  executionModeSnapshot: "parallel",
                  executionStatus: "complete",
                  archivedAt: null,
                },
                {
                  id: "task-session:task-1:ses-2",
                  taskId: "task-1",
                  runtimeSessionId: "ses-2",
                  phaseId: "phase-1",
                  phaseRole: "candidate",
                  phaseItemIndex: 1,
                  sessionKind: "candidate",
                  candidateIndex: 1,
                  executionModeSnapshot: "parallel",
                  executionStatus: "complete",
                  archivedAt: null,
                },
              ],
              meta: {
                currentSessionId: "task-session:task-1:ses-2",
              },
            },
          };
        }

        if ((options?.method || "GET") === "GET" && url === "/api/project-tree/tasks/task-1") {
          return {
            ok: true,
            status: 200,
            data: {
              id: "task-1",
              title: "Projection-backed parallel task",
              prompt: "Summarize progress",
              projectId: "proj-1",
              sessionId: "ses-task-main",
              currentRunId: "task_run:task-1:ses-task-main",
              orchestrationKind: "parallel",
              strategy: null,
              selectedModel: "gpt-5.4",
            },
          };
        }

        if (options?.method === "POST" && url === "/api/tasks/task-1/phases") {
          return {
            ok: true,
            status: 200,
            data: {
              id: "phase-1",
              status: "awaiting_adoption",
              awaitingAdoptionSince: "2026-04-08T03:18:24.437Z",
            },
          };
        }

        return { ok: true, status: 200, data: { ok: true, body: options?.body } };
      },
    );

    const aggregator = sseAggregator as unknown as {
      parallelCandidateResults: Map<string, Map<number, { sessionId: string; result?: string }>>;
      parallelTaskSessions: Map<string, Set<string>>;
      parallelTaskPhaseIds: Map<string, string>;
      finalizeParallelTask: (
        taskId: string,
        projectId: string,
        authorization: string,
      ) => Promise<void>;
    };
    aggregator.parallelCandidateResults.set(
      "task-1",
      new Map([
        [0, { sessionId: "ses-1", result: "Answer A" }],
        [1, { sessionId: "ses-2", result: "Answer B" }],
      ]),
    );
    aggregator.parallelTaskSessions.set("task-1", new Set(["ses-1", "ses-2"]));
    aggregator.parallelTaskPhaseIds.set("task-1", "phase-1");

    await aggregator.finalizeParallelTask("task-1", "proj-1", "Bearer internal");

    const taskPatchCall = (
      cpFetchMock.mock.calls as unknown as Array<
        [string, { method?: string; authorization?: string; body?: Record<string, unknown> }]
      >
    ).find(([url, options]) => url === "/api/tasks/task-1" && options?.method === "PATCH");
    expect(taskPatchCall).toBeDefined();
    expect(taskPatchCall?.[1]?.body?.status).toBe("awaiting_adoption");
    expect(taskPatchCall?.[1]?.body).not.toHaveProperty("executionPlan");
  });

  test("projection-backed sequential chain advancement stops patching legacy runtime plan", async () => {
    cpFetchMock.mockImplementation(
      async (url: string, options?: { method?: string; body?: unknown }) => {
        if ((options?.method || "GET") === "GET" && url === "/api/project-tree/tasks/task-1") {
          return {
            ok: true,
            status: 200,
            data: {
              id: "task-1",
              title: "Projection-backed sequential task",
              prompt: "Implement the fix",
              projectId: "proj-1",
              sessionId: "ses-root",
              currentRunId: "task_run:task-1:root",
              orchestrationKind: "sequential-chain",
              strategy: null,
              selectedModel: "github-copilot:gpt-5.4",
            },
          };
        }

        return { ok: true, status: 200, data: { ok: true, body: options?.body } };
      },
    );

    const aggregator = sseAggregator as unknown as {
      sequentialChainTasks: Map<
        string,
        {
          plan: {
            mode: string;
            currentChainStepIndex: number;
            steps: Array<Record<string, unknown>>;
            candidates: Array<Record<string, unknown>>;
          };
          authorization: string;
          projectionBacked: boolean;
        }
      >;
      sessionToChainStepMap: Map<string, { taskId: string; stepIndex: number }>;
      advanceSequentialChainStep: (
        taskId: string,
        completedStepIndex: number,
        completedSessionId: string,
        stepResult: string | undefined,
        projectId: string,
        authorization: string,
      ) => Promise<void>;
    };

    aggregator.sequentialChainTasks.set("task-1", {
      authorization: "Bearer internal",
      projectionBacked: true,
      plan: {
        mode: "sequential-chain",
        currentChainStepIndex: 0,
        steps: [
          { id: "step-1", type: "chain-step", title: "分析", status: "running" },
          { id: "step-2", type: "chain-step", title: "实施", status: "pending" },
        ],
        candidates: [{ label: "主执行", status: "running" }],
      },
    });
    aggregator.sessionToChainStepMap.set("ses-step-1", { taskId: "task-1", stepIndex: 0 });

    await aggregator.advanceSequentialChainStep(
      "task-1",
      0,
      "ses-step-1",
      "第一步完成",
      "proj-1",
      "Bearer internal",
    );

    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/sessions",
      expect.objectContaining({
        method: "POST",
        authorization: "Bearer internal",
        body: expect.objectContaining({
          runtimeSessionId: "ses-1",
          parentRuntimeSessionId: "ses-step-1",
          branchName: "Projection-backed sequential task — 实施",
          sourceType: "fork",
          sessionKind: "sequential_step",
          executionModeSnapshot: "sequential_chain",
          isActive: true,
          stepIndex: 1,
          selectedModel: "github-copilot:gpt-5.4",
        }),
      }),
    );

    const taskPatchCalls = (
      cpFetchMock.mock.calls as unknown as Array<
        [string, { method?: string; body?: Record<string, unknown> }]
      >
    ).filter(([url, options]) => url === "/api/tasks/task-1" && options?.method === "PATCH");

    expect(taskPatchCalls.length).toBe(0);
  });

  test("projection-backed sequential chain finalization stops patching legacy runtime plan", async () => {
    const aggregator = sseAggregator as unknown as {
      sequentialChainTasks: Map<
        string,
        {
          plan: {
            mode: string;
            currentChainStepIndex: number;
            steps: Array<Record<string, unknown>>;
            candidates: Array<Record<string, unknown>>;
          };
          authorization: string;
          projectionBacked: boolean;
        }
      >;
      finalizeSequentialChainTask: (
        taskId: string,
        projectId: string,
        authorization: string,
        failureError?: string,
      ) => Promise<void>;
    };

    aggregator.sequentialChainTasks.set("task-1", {
      authorization: "Bearer internal",
      projectionBacked: true,
      plan: {
        mode: "sequential-chain",
        currentChainStepIndex: 2,
        steps: [
          {
            id: "step-1",
            type: "chain-step",
            title: "分析",
            status: "completed",
            result: "分析完成",
          },
          {
            id: "step-2",
            type: "chain-step",
            title: "实施",
            status: "completed",
            result: "实施完成",
          },
        ],
        candidates: [{ label: "主执行", status: "completed" }],
      },
    });

    await aggregator.finalizeSequentialChainTask("task-1", "proj-1", "Bearer internal");

    const taskPatchCall = (
      cpFetchMock.mock.calls as unknown as Array<
        [string, { method?: string; body?: Record<string, unknown> }]
      >
    ).find(([url, options]) => url === "/api/tasks/task-1" && options?.method === "PATCH");

    expect(taskPatchCall?.[1]?.body).toMatchObject({
      status: "completed",
      result: expect.stringContaining("分析完成"),
    });
    expect(taskPatchCall?.[1]?.body).not.toHaveProperty("executionPlan");
  });
});
