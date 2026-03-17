import { beforeEach, describe, expect, mock, test } from "bun:test";

const estimatePaidExecutionUsageMock = mock(() => ({
  inputTokens: 80,
  outputTokens: 40,
  totalTokens: 120,
  costUsd: 0.12,
}));
const evaluatePaidExecutionPreflightMock = mock(async () => ({
  allowed: true,
  requirements: {
    allowPaidExecution: false,
    leaseRequired: false,
    hasAllowPaidExecution: true,
    hasLease: false,
  },
  estimate: {
    guardDecision: "allow",
    guardReason: "ok",
  },
  activeLease: null,
}));
const fetchProjectPaidExecutionLeaseStateMock = mock(async () => ({
  projectId: "proj-default",
  activeLease: null,
  now: "2026-03-17T10:00:00.000Z",
}));

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const createInternalAuthorizationMock = mock(async () => "Bearer internal");
const authHeaderMock = mock(() => "Bearer inbound-test-token");
const syncRuntimeUsageLedgerMock = mock(async (..._args: unknown[]) => ({ id: "ledger-1" }));

mock.module("../../control-plane/web-ui-bff/src/lib/paid-execution-guard", () => ({
  estimatePaidExecutionUsage: estimatePaidExecutionUsageMock,
  evaluatePaidExecutionPreflight: evaluatePaidExecutionPreflightMock,
  fetchProjectPaidExecutionLeaseState: fetchProjectPaidExecutionLeaseStateMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/runtime-usage-ledger", () => ({
  syncRuntimeUsageLedger: syncRuntimeUsageLedgerMock,
}));

beforeEach(() => {
  estimatePaidExecutionUsageMock.mockReset();
  evaluatePaidExecutionPreflightMock.mockReset();
  fetchProjectPaidExecutionLeaseStateMock.mockReset();
  cpFetchMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  authHeaderMock.mockReset();
  syncRuntimeUsageLedgerMock.mockReset();

  estimatePaidExecutionUsageMock.mockReturnValue({
    inputTokens: 80,
    outputTokens: 40,
    totalTokens: 120,
    costUsd: 0.12,
  });
  evaluatePaidExecutionPreflightMock.mockResolvedValue({
    allowed: true,
    requirements: {
      allowPaidExecution: false,
      leaseRequired: false,
      hasAllowPaidExecution: true,
      hasLease: false,
    },
    estimate: {
      guardDecision: "allow",
      guardReason: "ok",
    },
    activeLease: null,
  });
  fetchProjectPaidExecutionLeaseStateMock.mockResolvedValue({
    projectId: "proj-default",
    activeLease: null,
    now: "2026-03-17T10:00:00.000Z",
  });
  cpFetchMock.mockResolvedValue({ ok: true, status: 200, data: {} });
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal");
  authHeaderMock.mockReturnValue("Bearer inbound-test-token");
  syncRuntimeUsageLedgerMock.mockResolvedValue({ id: "ledger-1" });
});

describe("runtime usage ledger sync", () => {
  test("records cost and syncs runtime ledger when runtime metadata is present", async () => {
    const { recordModelUsage } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence?runtime-usage-ledger-sync-test"
    );

    const usage = await recordModelUsage({
      projectId: "proj-default",
      taskId: "task-1",
      sessionId: "session-1",
      agentRunId: "run-1",
      providerId: "github-copilot",
      modelId: "gpt-5-mini",
      tokenUsed: 120,
      runtimeLedger: {
        executionSource: "task-execution",
        entrypointType: "task-run",
        orchestrationFingerprint: "fp-1",
        candidateCount: 2,
        judgeRequestCountDelta: 1,
        hookRequestCountDelta: 0,
        status: "completed",
        startedAt: "2026-03-17T10:00:00.000Z",
        finishedAt: "2026-03-17T10:01:00.000Z",
        step: {
          stepType: "execution",
          candidateIndex: 1,
          requestIndex: 0,
          status: "completed",
          startedAt: "2026-03-17T10:00:00.000Z",
          finishedAt: "2026-03-17T10:01:00.000Z",
        },
      },
    });

    expect(estimatePaidExecutionUsageMock).toHaveBeenCalledWith(
      {
        providerId: "github-copilot",
        modelId: "gpt-5-mini",
      },
      120,
    );

    expect(cpFetchMock).toHaveBeenCalledTimes(1);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/cost/records", {
      method: "POST",
      authorization: "Bearer internal",
      body: {
        projectId: "proj-default",
        taskId: "task-1",
        sessionId: "session-1",
        agentRunId: "run-1",
        userId: undefined,
        providerId: "github-copilot",
        modelId: "gpt-5-mini",
        inputTokens: 80,
        outputTokens: 40,
        cost: 0.12,
        budgetPeriod: undefined,
      },
    });

    expect(syncRuntimeUsageLedgerMock).toHaveBeenCalledTimes(1);
    expect(syncRuntimeUsageLedgerMock).toHaveBeenCalledWith({
      projectId: "proj-default",
      taskId: "task-1",
      agentRunId: "run-1",
      runtimeSessionId: "session-1",
      executionSource: "task-execution",
      entrypointType: "task-run",
      orchestrationFingerprint: "fp-1",
      defaultProviderId: "github-copilot",
      defaultModelId: "gpt-5-mini",
      inputTokens: 80,
      outputTokens: 40,
      totalTokens: 120,
      costUsd: 0.12,
      candidateCount: 2,
      judgeRequestCountDelta: 1,
      hookRequestCountDelta: 0,
      status: "completed",
      startedAt: "2026-03-17T10:00:00.000Z",
      finishedAt: "2026-03-17T10:01:00.000Z",
      step: {
        stepType: "execution",
        triggerType: undefined,
        hookId: undefined,
        candidateIndex: 1,
        requestIndex: 0,
        providerId: "github-copilot",
        modelId: "gpt-5-mini",
        inputTokens: 80,
        outputTokens: 40,
        totalTokens: 120,
        costUsd: 0.12,
        amplificationSource: undefined,
        status: "completed",
        startedAt: "2026-03-17T10:00:00.000Z",
        finishedAt: "2026-03-17T10:01:00.000Z",
      },
    });

    expect(usage).toEqual({
      providerId: "github-copilot",
      modelId: "gpt-5-mini",
      inputTokens: 80,
      outputTokens: 40,
      totalTokens: 120,
      costUsd: 0.12,
    });
  });

  test("skips runtime ledger sync when session id is absent", async () => {
    const { recordModelUsage } = await import(
      "../../control-plane/web-ui-bff/src/modules/agent-control/run-persistence?runtime-usage-ledger-no-session-test"
    );

    await recordModelUsage({
      projectId: "proj-default",
      providerId: "github-copilot",
      modelId: "gpt-5-mini",
      tokenUsed: 120,
      runtimeLedger: {
        executionSource: "task-execution",
        entrypointType: "task-run",
      },
    });

    expect(cpFetchMock).toHaveBeenCalledTimes(1);
    expect(syncRuntimeUsageLedgerMock).not.toHaveBeenCalled();
  });
});
