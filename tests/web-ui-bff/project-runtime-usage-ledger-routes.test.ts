/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as paidExecutionGuardModule from "../../control-plane/web-ui-bff/src/lib/paid-execution-guard";
import * as strategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");
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

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
  createInternalAuthorization: mock(async () => "Bearer internal"),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/paid-execution-guard", () => ({
  ...paidExecutionGuardModule,
  evaluatePaidExecutionPreflight: evaluatePaidExecutionPreflightMock,
  fetchProjectPaidExecutionLeaseState: fetchProjectPaidExecutionLeaseStateMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/opencode-config", () => ({
  formatModelRoute: (resolved: { providerId: string; modelId: string }) =>
    `${resolved.providerId}:${resolved.modelId}`,
  readDefaultExecutionModel: readDefaultExecutionModelMock,
  resolveModelRoute: resolveModelRouteMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...strategyModule,
  readOrchestrationStrategy: readOrchestrationStrategyMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  evaluatePaidExecutionPreflightMock.mockReset();
  fetchProjectPaidExecutionLeaseStateMock.mockReset();
  readDefaultExecutionModelMock.mockReset();
  resolveModelRouteMock.mockReset();
  readOrchestrationStrategyMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test-token");
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
    await expect(response.json()).resolves.toEqual({
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
