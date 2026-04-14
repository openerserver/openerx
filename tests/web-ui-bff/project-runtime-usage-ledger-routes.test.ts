/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as strategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import * as paidExecutionGuardModule from "../../control-plane/web-ui-bff/src/lib/paid-execution-guard";
import { createControlPlaneClientModuleMock } from "./control-plane-client-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");
const evaluatePaidExecutionPreflightMock = mock(async () => ({
  allowed: true,
  code: "PAID_EXECUTION_ALLOWED",
  policy: {
    providerId: "github-copilot",
    modelId: "gpt-5-mini",
    modelRoute: "github-copilot:gpt-5-mini",
    environment: "dev",
    costTier: "free",
    isPaid: false,
    defaultDecision: "allow",
    maxRequestsPerRun: 20,
    maxEstimatedCostUsdPerRun: 0,
    maxParallelCandidates: 4,
    allowJudge: true,
    allowHooks: true,
  },
  estimate: {
    providerId: "github-copilot",
    modelId: "gpt-5-mini",
    requestCount: { min: 1, max: 1 },
    inputTokens: { min: 80, max: 80 },
    outputTokens: { min: 40, max: 40 },
    totalTokens: { min: 120, max: 120 },
    costUsd: { min: 0.12, max: 0.12 },
    riskDrivers: [],
    budgetHeadroom: { remainingUsd: 100, enoughForSingleRun: true, enoughForSuiteRun: true },
    guardDecision: "allow",
    guardReason: "ok",
    generatedAt: "2026-03-17T10:00:00.000Z",
  },
}));
const readDefaultExecutionModelMock = mock(() => "github-copilot:gpt-5-mini");
const resolveModelRouteMock = mock((value: string) => ({
  providerId: value.split(":")[0] || "github-copilot",
  modelId: value.split(":").slice(1).join(":") || value,
}));
const readOrchestrationStrategyMock = mock(() => ({
  hooks: [],
  templates: [],
  judge: { enabled: false },
}));

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () =>
  createControlPlaneClientModuleMock({
    authHeader: authHeaderMock,
    cpFetch: cpFetchMock,
    createInternalAuthorization: mock(async () => "Bearer internal"),
  }),
);

mock.module("../../control-plane/web-ui-bff/src/lib/paid-execution-guard", () => ({
  ...paidExecutionGuardModule,
  evaluatePaidExecutionPreflight: evaluatePaidExecutionPreflightMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/model-config", () => ({
  diagnoseModelReadiness: mock(async () => undefined),
  formatModelRoute: (resolved: { providerId: string; modelId: string }) =>
    `${resolved.providerId}:${resolved.modelId}`,
  readDefaultExecutionModel: readDefaultExecutionModelMock,
  readOpencodeJson: mock(() => ({ models: { list: [] }, provider: {} })),
  resolveModelRoute: resolveModelRouteMock,
  validateModelProvider: mock(() => ({ valid: true })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...strategyModule,
  readOrchestrationStrategy: readOrchestrationStrategyMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  evaluatePaidExecutionPreflightMock.mockReset();
  readDefaultExecutionModelMock.mockReset();
  resolveModelRouteMock.mockReset();
  readOrchestrationStrategyMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test-token");
  evaluatePaidExecutionPreflightMock.mockResolvedValue({
    allowed: true,
    code: "PAID_EXECUTION_ALLOWED",
    policy: {
      providerId: "github-copilot",
      modelId: "gpt-5-mini",
      modelRoute: "github-copilot:gpt-5-mini",
      environment: "dev",
      costTier: "free",
      isPaid: false,
      defaultDecision: "allow",
      maxRequestsPerRun: 20,
      maxEstimatedCostUsdPerRun: 0,
      maxParallelCandidates: 4,
      allowJudge: true,
      allowHooks: true,
    },
    estimate: {
      providerId: "github-copilot",
      modelId: "gpt-5-mini",
      requestCount: { min: 1, max: 1 },
      inputTokens: { min: 80, max: 80 },
      outputTokens: { min: 40, max: 40 },
      totalTokens: { min: 120, max: 120 },
      costUsd: { min: 0.12, max: 0.12 },
      riskDrivers: [],
      budgetHeadroom: { remainingUsd: 100, enoughForSingleRun: true, enoughForSuiteRun: true },
      guardDecision: "allow",
      guardReason: "ok",
      generatedAt: "2026-03-17T10:00:00.000Z",
    },
  });
  readDefaultExecutionModelMock.mockReturnValue("github-copilot:gpt-5-mini");
  resolveModelRouteMock.mockImplementation((value: string) => ({
    providerId: value.split(":")[0] || "github-copilot",
    modelId: value.split(":").slice(1).join(":") || value,
  }));
  readOrchestrationStrategyMock.mockReturnValue({
    hooks: [],
    templates: [],
    judge: { enabled: false },
  });
  cpFetchMock.mockImplementation(async (path: string) => {
    if (path === "/api/projects/proj-default/runtime-usage-ledgers?limit=10&status=completed") {
      return {
        ok: true,
        status: 200,
        data: {
          data: [
            {
              id: "ledger-1",
              projectId: "proj-default",
              taskId: "task-1",
              runtimeSessionId: "session-1",
              agentRunId: "run-1",
              executionSource: "task-execution",
              entrypointType: "task-run",
              orchestrationFingerprint: "fp-1",
              defaultProviderId: "github-copilot",
              defaultModelId: "gpt-5-mini",
              requestCount: 1,
              judgeRequestCount: 0,
              hookRequestCount: 0,
              inputTokens: 80,
              outputTokens: 40,
              totalTokens: 120,
              costUsd: 0.12,
              candidateCount: 2,
              status: "completed",
              startedAt: "2026-03-17T10:00:00.000Z",
              finishedAt: "2026-03-17T10:01:00.000Z",
              createdAt: "2026-03-17T10:00:00.000Z",
              updatedAt: "2026-03-17T10:01:00.000Z",
            },
          ],
        },
      };
    }

    if (path === "/api/projects/proj-default/runtime-usage-ledgers/ledger-1") {
      return {
        ok: true,
        status: 200,
        data: {
          ledger: {
            id: "ledger-1",
            projectId: "proj-default",
            taskId: "task-1",
            runtimeSessionId: "session-1",
            agentRunId: "run-1",
            executionSource: "task-execution",
            entrypointType: "task-run",
            orchestrationFingerprint: "fp-1",
            defaultProviderId: "github-copilot",
            defaultModelId: "gpt-5-mini",
            requestCount: 1,
            judgeRequestCount: 0,
            hookRequestCount: 0,
            inputTokens: 80,
            outputTokens: 40,
            totalTokens: 120,
            costUsd: 0.12,
            candidateCount: 2,
            status: "completed",
            startedAt: "2026-03-17T10:00:00.000Z",
            finishedAt: "2026-03-17T10:01:00.000Z",
            createdAt: "2026-03-17T10:00:00.000Z",
            updatedAt: "2026-03-17T10:01:00.000Z",
          },
          steps: [
            {
              id: "step-1",
              ledgerId: "ledger-1",
              projectId: "proj-default",
              taskId: "task-1",
              runtimeSessionId: "session-1",
              agentRunId: "run-1",
              stepType: "execution",
              triggerType: null,
              hookId: null,
              candidateIndex: 1,
              requestIndex: 0,
              providerId: "github-copilot",
              modelId: "gpt-5-mini",
              inputTokens: 80,
              outputTokens: 40,
              totalTokens: 120,
              costUsd: 0.12,
              amplificationSource: null,
              status: "completed",
              startedAt: "2026-03-17T10:00:00.000Z",
              finishedAt: "2026-03-17T10:01:00.000Z",
              createdAt: "2026-03-17T10:01:00.000Z",
            },
          ],
        },
      };
    }

    return {
      ok: false,
      status: 404,
      data: {
        error: `Unhandled path: ${path}`,
      },
    };
  });
});

describe("project runtime usage ledger routes", () => {
  test("proxies ledger list queries to control plane", async () => {
    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes?project-runtime-usage-ledger-list-test"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-default/runtime-usage-ledgers?limit=10&status=completed",
      {
        headers: {
          Authorization: "Bearer inbound-token",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: "ledger-1",
          projectId: "proj-default",
          taskId: "task-1",
          runtimeSessionId: "session-1",
          agentRunId: "run-1",
          executionSource: "task-execution",
          entrypointType: "task-run",
          orchestrationFingerprint: "fp-1",
          defaultProviderId: "github-copilot",
          defaultModelId: "gpt-5-mini",
          requestCount: 1,
          costUsd: 0.12,
          candidateCount: 2,
          status: "completed",
          startedAt: "2026-03-17T10:00:00.000Z",
          finishedAt: "2026-03-17T10:01:00.000Z",
          createdAt: "2026-03-17T10:00:00.000Z",
          updatedAt: "2026-03-17T10:01:00.000Z",
        },
      ],
    });

    expect(authHeaderMock).toHaveBeenCalledTimes(1);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/projects/proj-default/runtime-usage-ledgers?limit=10&status=completed",
      {
        authorization: "Bearer test-token",
      },
    );
  });

  test("proxies ledger detail queries to control plane", async () => {
    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes?project-runtime-usage-ledger-detail-test"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-default/runtime-usage-ledgers/ledger-1",
      {
        headers: {
          Authorization: "Bearer inbound-token",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ledger: {
        id: "ledger-1",
        projectId: "proj-default",
        runtimeSessionId: "session-1",
        status: "completed",
      },
      steps: [
        {
          id: "step-1",
          ledgerId: "ledger-1",
          stepType: "execution",
          totalTokens: 120,
        },
      ],
    });

    expect(authHeaderMock).toHaveBeenCalledTimes(1);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/projects/proj-default/runtime-usage-ledgers/ledger-1",
      {
        authorization: "Bearer test-token",
      },
    );
  });
});
