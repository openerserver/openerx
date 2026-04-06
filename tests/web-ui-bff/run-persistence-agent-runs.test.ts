import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const createInternalAuthorizationMock = mock(async () => "Bearer internal");

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/paid-execution-guard", () => ({
  estimatePaidExecutionUsage: mock(() => ({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/runtime-usage-ledger", () => ({
  syncRuntimeUsageLedger: mock(async () => ({ id: "ledger-1" })),
}));

describe("agent run persistence", () => {
  beforeEach(() => {
    cpFetchMock.mockReset();
    createInternalAuthorizationMock.mockReset();

    cpFetchMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  });

  test("createAgentRunRecord posts task run facts to the control plane", async () => {
    const { createAgentRunRecord } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence?agent-run-create-test"
    );

    await createAgentRunRecord({
      taskId: "task-1",
      agentRunId: "run-1",
      sessionId: "session-1",
      agentType: "builder",
      status: "running",
      model: { providerId: "github-copilot", modelId: "gpt-5.4" },
      candidateIndex: 2,
      startedAt: "2026-04-04T10:00:00.000Z",
      tokenUsed: 33,
      result: "partial",
    });

    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/runs", {
      method: "POST",
      authorization: "Bearer internal",
      body: {
        id: "run-1",
        sessionId: "session-1",
        agentType: "builder",
        status: "running",
        modelUsed: "github-copilot:gpt-5.4",
        candidateIndex: 2,
        startedAt: "2026-04-04T10:00:00.000Z",
        finishedAt: undefined,
        tokenUsed: 33,
        result: "partial",
        error: undefined,
      },
    });
  });

  test("patchAgentRunRecord patches task run facts in the control plane", async () => {
    const { patchAgentRunRecord } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence?agent-run-patch-test"
    );

    await patchAgentRunRecord({
      taskId: "task-1",
      agentRunId: "run-1",
      status: "completed",
      model: { providerId: "github-copilot", modelId: "gpt-5.4" },
      finishedAt: "2026-04-04T10:05:00.000Z",
      tokenUsed: 88,
      result: "done",
    });

    expect(cpFetchMock).toHaveBeenCalledWith("/api/tasks/task-1/runs/run-1", {
      method: "PATCH",
      authorization: "Bearer internal",
      body: {
        status: "completed",
        modelUsed: "github-copilot:gpt-5.4",
        startedAt: undefined,
        finishedAt: "2026-04-04T10:05:00.000Z",
        tokenUsed: 88,
        result: "done",
        error: undefined,
      },
    });
  });
});
