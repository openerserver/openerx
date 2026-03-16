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

  if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/task-sessions") {
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
const getSessionMessagesMock = mock(async () => ({ ok: true, data: [] as Array<Record<string, unknown>> }));
const listSessionsMock = mock(async () => ({ ok: true, data: [{ id: "ses-1" }] }));
const recoverAgentRunMock = mock(() => undefined);
const updateAgentRunStatusMock = mock(() => undefined);
const runDetachedPromptMock = mock(async () => ({ ok: true, text: "judge result", sessionId: "judge-ses" }));
const collectChangesFromSessionMock = mock(async () => undefined);
const executeLifecycleHooksMock = mock(async () => ({ hookExecutions: [] as Array<Record<string, unknown>> }));
const onGraphToolExecutedMock = mock(async () => undefined);
const buildPipelineStageUpdatedEventsMock = mock(async () => [] as Array<Record<string, unknown>>);

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
  extractAssistantResultFromMessages: extractAssistantResultFromMessagesMock,
  findAgentRunBySessionId: findAgentRunBySessionIdMock,
  getAgentRun: getAgentRunMock,
  getSessionMessages: getSessionMessagesMock,
  listSessions: listSessionsMock,
  recoverAgentRun: recoverAgentRunMock,
  runDetachedPrompt: runDetachedPromptMock,
  updateAgentRunStatus: updateAgentRunStatusMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/code-changes/change-collector", () => ({
  collectChangesFromSession: collectChangesFromSessionMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: executeLifecycleHooksMock,
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
  };

  aggregator.finalizedAgentRuns.clear();
  aggregator.finalizingAgentRuns.clear();
  aggregator.parallelTaskSessions.clear();
  aggregator.parallelCandidateResults.clear();
  aggregator.sessionToCandidateMap.clear();
  aggregator.judgingTasks.clear();
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

    if ((options?.method || "GET") === "GET" && url === "/api/tasks/task-1/task-sessions") {
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
  updateAgentRunStatusMock.mockImplementation(() => undefined);
  runDetachedPromptMock.mockResolvedValue({ ok: true, text: "judge result", sessionId: "judge-ses" });
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
        "/api/tasks/task-1/task-sessions",
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
});