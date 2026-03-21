/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, data: {} }));
const authHeaderMock = mock(() => "Bearer test");
const executeLifecycleHooksMock = mock(async () => ({ hookExecutions: [] }));

const persistedSummaryState = {
  status: "running" as "running" | "paused" | "completed" | "failed" | "stopped",
  sessionId: "session-1",
  taskId: "task-1",
  projectId: "proj-1",
  modelUsed: "github-copilot:gpt-5-mini",
  startedAt: "2026-03-18T08:00:00.000Z",
};

const runtimeState = {
  run: undefined as
    | {
        subSessionId: string;
        taskId: string;
        projectId: string;
        model?: { providerId: string; modelId: string };
        status: "running" | "paused" | "completed" | "failed" | "stopped";
        startedAt: number;
      }
    | undefined,
};

const extractAssistantResultFromMessagesMock = mock(() => ({
  completed: false,
  failed: false,
  error: undefined,
  tokenUsed: 123,
}));
const getAgentMessagesMock = mock(async () => ({ ok: true, data: [] }));
const getAgentRunMock = mock((agentRunId: string) => {
  if (!runtimeState.run || agentRunId !== "run-missing") {
    return undefined;
  }

  return runtimeState.run;
});
const getSessionMessagesMock = mock(async () => ({ ok: true, data: [] }));
const injectGuidanceMock = mock(async () => ({ ok: true }));
const listAgentRunsMock = mock(() => []);
const pauseAgentMock = mock(async () => ({ ok: true }));
const recoverAgentRunMock = mock(
  (
    agentRunId: string,
    subSessionId: string,
    taskId: string,
    projectId: string,
    startedAt?: string | number | null,
    model?: { providerId: string; modelId: string },
  ) => {
    if (agentRunId !== "run-missing") {
      return;
    }

    runtimeState.run = {
      subSessionId,
      taskId,
      projectId,
      model,
      status: "running",
      startedAt:
        typeof startedAt === "number"
          ? startedAt
          : typeof startedAt === "string"
            ? Date.parse(startedAt)
            : Date.now(),
    };
  },
);
const resumeAgentMock = mock(async () => ({ ok: true }));
const terminateAgentMock = mock(async (agentRunId: string) => {
  if (!runtimeState.run || agentRunId !== "run-missing") {
    return { ok: false, error: "Agent run not found" };
  }

  runtimeState.run.status = "stopped";
  return { ok: true };
});
const updateAgentRunStatusMock = mock(
  (agentRunId: string, status: "running" | "paused" | "completed" | "failed" | "stopped") => {
    if (!runtimeState.run || agentRunId !== "run-missing") {
      return undefined;
    }

    runtimeState.run.status = status;
    return {
      agentRunId,
      ...runtimeState.run,
    };
  },
);

const patchAgentRunRecordMock = mock(async () => undefined);
const recordAgentAuditMock = mock(async () => undefined);
const createAgentRunRecordMock = mock(async () => undefined);
const createCostRecordMock = mock(async () => undefined);
const recordModelUsageMock = mock(async () => ({
  providerId: "github-copilot",
  modelId: "gpt-5-mini",
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
}));
const broadcastMock = mock(() => undefined);
const finalizeTaskStateMock = mock(async () => true);

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: mock(async () => "Bearer internal"),
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/opencode-adapter", () => ({
  extractAssistantResultFromMessages: extractAssistantResultFromMessagesMock,
  getAgentMessages: getAgentMessagesMock,
  getAgentRun: getAgentRunMock,
  getSessionMessages: getSessionMessagesMock,
  injectGuidance: injectGuidanceMock,
  listAgentRuns: listAgentRunsMock,
  pauseAgent: pauseAgentMock,
  recoverAgentRun: recoverAgentRunMock,
  resumeAgent: resumeAgentMock,
  terminateAgent: terminateAgentMock,
  updateAgentRunStatus: updateAgentRunStatusMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence", () => ({
  createAgentRunRecord: createAgentRunRecordMock,
  createCostRecord: createCostRecordMock,
  patchAgentRunRecord: patchAgentRunRecordMock,
  recordModelUsage: recordModelUsageMock,
  recordAgentAudit: recordAgentAuditMock,
}));

mock.module("../../control-plane/web-ui-bff/src/modules/hooks/lifecycle-hooks", () => ({
  executeLifecycleHooks: executeLifecycleHooksMock,
  parseStageHooks: (raw: unknown) => (Array.isArray(raw) ? raw : []),
  mergeStageAndStrategyHooks: (_stage: unknown[], strategy: unknown[]) => strategy ?? [],
}));

mock.module("../../control-plane/web-ui-bff/src/modules/realtime/ws-broadcaster", () => ({
  wsBroadcaster: {
    broadcast: broadcastMock,
  },
}));

mock.module("../../control-plane/web-ui-bff/src/modules/tasks/finalize", () => ({
  finalizeTaskState: finalizeTaskStateMock,
}));

describe("agent control routes", () => {
  beforeEach(() => {
    runtimeState.run = undefined;
    persistedSummaryState.status = "running";
    persistedSummaryState.sessionId = "session-1";
    persistedSummaryState.taskId = "task-1";
    persistedSummaryState.projectId = "proj-1";
    persistedSummaryState.modelUsed = "github-copilot:gpt-5-mini";
    persistedSummaryState.startedAt = "2026-03-18T08:00:00.000Z";
    cpFetchMock.mockReset();
    authHeaderMock.mockReset();
    executeLifecycleHooksMock.mockClear();
    extractAssistantResultFromMessagesMock.mockClear();
    getAgentMessagesMock.mockClear();
    getAgentRunMock.mockClear();
    getSessionMessagesMock.mockClear();
    injectGuidanceMock.mockClear();
    listAgentRunsMock.mockClear();
    pauseAgentMock.mockClear();
    recoverAgentRunMock.mockClear();
    resumeAgentMock.mockClear();
    terminateAgentMock.mockClear();
    updateAgentRunStatusMock.mockClear();
    createAgentRunRecordMock.mockClear();
    createCostRecordMock.mockClear();
    patchAgentRunRecordMock.mockClear();
    recordModelUsageMock.mockClear();
    recordAgentAuditMock.mockClear();
    broadcastMock.mockClear();
    finalizeTaskStateMock.mockClear();
    authHeaderMock.mockReturnValue("Bearer test");
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url] = args as [string];

      if (url === "/api/agent-runs/run-missing/summary") {
        return {
          ok: true,
          data: {
            agentRunId: "run-missing",
            taskId: persistedSummaryState.taskId,
            taskTitle: "Task 1",
            projectId: persistedSummaryState.projectId,
            projectName: "Project 1",
            agentType: "Agent",
            status: persistedSummaryState.status,
            sessionId: persistedSummaryState.sessionId,
            modelUsed: persistedSummaryState.modelUsed,
            startedAt: persistedSummaryState.startedAt,
            finishedAt: null,
            lastActivityAt: null,
            durationMs: null,
            tokenUsed: 0,
            blockerType: null,
            blockerLabel: "",
            riskLevel: null,
            guidanceCount: 0,
            resultSummary: null,
            result: null,
            error: null,
            longSummary: null,
            latestEvents: [],
          },
        };
      }

      if (url === `/api/tasks/${persistedSummaryState.taskId}`) {
        return {
          ok: true,
          data: {
            id: persistedSummaryState.taskId,
            title: "Task 1",
            prompt: "Resume task",
            projectId: persistedSummaryState.projectId,
            strategy: null,
          },
        };
      }

      return { ok: true, data: {} };
    });
  });

  test("recovers persisted run metadata before terminating when runtime registry misses", async () => {
    const { agentControlRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/routes"
    );

    const response = await agentControlRoutes.request("http://localhost/run-missing/terminate", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/agent-runs/run-missing/summary", {
      authorization: "Bearer test",
    });
    expect(recoverAgentRunMock).toHaveBeenCalledWith(
      "run-missing",
      "session-1",
      "task-1",
      "proj-1",
      "2026-03-18T08:00:00.000Z",
      {
        providerId: "github-copilot",
        modelId: "gpt-5-mini",
      },
    );
    expect(updateAgentRunStatusMock).toHaveBeenCalledWith("run-missing", "stopped");
    expect(terminateAgentMock).toHaveBeenCalledWith("run-missing");
    expect(patchAgentRunRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        agentRunId: "run-missing",
        status: "stopped",
        tokenUsed: 123,
      }),
    );
    expect(recordAgentAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        projectId: "proj-1",
        sessionId: "session-1",
        agentRunId: "run-missing",
        action: "stopped",
      }),
    );
    expect(finalizeTaskStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: "Bearer test",
        taskId: "task-1",
        status: "cancelled",
        sessionId: "session-1",
        agentRunId: "run-missing",
      }),
    );
    expect(broadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent.stopped",
        agentRunId: "run-missing",
        taskId: "task-1",
        projectId: "proj-1",
      }),
    );
  });

  test("recovers persisted run metadata before pausing when runtime registry misses", async () => {
    const { agentControlRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/routes"
    );

    const response = await agentControlRoutes.request("http://localhost/run-missing/pause", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(recoverAgentRunMock).toHaveBeenCalled();
    expect(pauseAgentMock).toHaveBeenCalledWith("run-missing");
    expect(patchAgentRunRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        agentRunId: "run-missing",
        status: "paused",
      }),
    );
    expect(broadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent.paused", agentRunId: "run-missing" }),
    );
  });

  test("recovers persisted paused run metadata before resuming when runtime registry misses", async () => {
    persistedSummaryState.status = "paused";

    const { agentControlRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/routes"
    );

    const response = await agentControlRoutes.request("http://localhost/run-missing/resume", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(recoverAgentRunMock).toHaveBeenCalled();
    expect(executeLifecycleHooksMock).toHaveBeenCalled();
    expect(resumeAgentMock).toHaveBeenCalledWith("run-missing");
    expect(patchAgentRunRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        agentRunId: "run-missing",
        status: "running",
      }),
    );
    expect(broadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent.resumed", agentRunId: "run-missing" }),
    );
  });

  test("recovers persisted paused run metadata before injecting guidance when runtime registry misses", async () => {
    persistedSummaryState.status = "paused";

    const { agentControlRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/routes"
    );

    const response = await agentControlRoutes.request("http://localhost/run-missing/guidance", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "Please tighten the summary.", mode: "reply" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(recoverAgentRunMock).toHaveBeenCalled();
    expect(injectGuidanceMock).toHaveBeenCalledWith(
      "run-missing",
      "Please tighten the summary.",
      "reply",
    );
    expect(recordAgentAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        agentRunId: "run-missing",
        action: "injected",
      }),
    );
    expect(broadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "guidance.injected", agentRunId: "run-missing" }),
    );
  });

  test("recovers persisted run metadata before loading messages when runtime registry misses", async () => {
    getAgentMessagesMock.mockResolvedValueOnce({ ok: true, data: [{ id: "msg-1" }] as never[] });

    const { agentControlRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/routes"
    );

    const response = await agentControlRoutes.request("http://localhost/run-missing/messages", {
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: [{ id: "msg-1" }] });
    expect(recoverAgentRunMock).toHaveBeenCalled();
    expect(getAgentMessagesMock).toHaveBeenCalledWith("run-missing");
  });

  test("recovers persisted run metadata before loading status when runtime registry misses", async () => {
    persistedSummaryState.status = "paused";

    const { agentControlRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/routes"
    );

    const response = await agentControlRoutes.request("http://localhost/run-missing/status", {
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      subSessionId: "session-1",
      taskId: "task-1",
      projectId: "proj-1",
      status: "paused",
    });
    expect(recoverAgentRunMock).toHaveBeenCalled();
  });

  test("returns a structured recovery error when historical run summary is unavailable", async () => {
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [url] = args as [string];

      if (url === "/api/agent-runs/run-history/summary") {
        return { ok: false, error: "Not found", data: {} };
      }

      return { ok: true, data: {} };
    });

    const { agentControlRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/routes"
    );

    const response = await agentControlRoutes.request("http://localhost/run-history/terminate", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "AGENT_RUN_SUMMARY_NOT_FOUND",
    });
    expect(terminateAgentMock).not.toHaveBeenCalled();
    expect(finalizeTaskStateMock).not.toHaveBeenCalled();
  });
});
