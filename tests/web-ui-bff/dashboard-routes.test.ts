/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  authHeaderMock.mockReturnValue("Bearer test-token");
});

describe("dashboard routes", () => {
  test("proxies governance overview queries to control plane", async () => {
    cpFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        range: "7d",
        generatedAt: "2026-03-17T10:00:00.000Z",
        summary: {
          blockedCount: 2,
          breakerCount: 1,
          activeLeaseCount: 1,
          topRiskTaskCount: 1,
        },
        topRiskTasks: [
          {
            taskId: "task-risk-1",
            projectId: "proj-default",
            title: "Risk task",
            runtimeSessionId: "session-risk-1",
            requestCount: 4,
            totalTokens: 480,
            costUsd: 0.48,
            blockedCount: 1,
            breakerCount: 1,
            judgeRequestCount: 1,
            hookRequestCount: 2,
            parallelCandidateCount: 2,
            riskScore: 24,
            dominantDriver: "breaker",
            lastGuardDecision: "deny",
            lastGuardReason: "Estimated amplification exceeds policy.",
            lastBreakerReason: "Parallel candidate burst exceeded the breaker threshold.",
            lastActivityAt: "2026-03-17T10:00:00.000Z",
          },
        ],
        recentEvents: [
          {
            id: "audit-1",
            projectId: "proj-default",
            taskId: "task-risk-1",
            title: "Risk task",
            runtimeSessionId: "session-risk-1",
            eventKind: "breaker",
            action: "breaker_tripped",
            guardDecision: null,
            reason: "Parallel candidate burst exceeded the breaker threshold.",
            occurredAt: "2026-03-17T10:00:00.000Z",
          },
        ],
      },
    });

    const { dashboardRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/dashboard/routes?dashboard-governance-overview-route-test"
    );

    const response = await dashboardRoutes.request("http://localhost/governance-overview?range=7d", {
      headers: {
        Authorization: "Bearer inbound-token",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      range: "7d",
      summary: {
        blockedCount: 2,
        breakerCount: 1,
        activeLeaseCount: 1,
        topRiskTaskCount: 1,
      },
      topRiskTasks: [
        expect.objectContaining({
          taskId: "task-risk-1",
          dominantDriver: "breaker",
          lastBreakerReason: "Parallel candidate burst exceeded the breaker threshold.",
        }),
      ],
      recentEvents: [
        expect.objectContaining({
          eventKind: "breaker",
          reason: "Parallel candidate burst exceeded the breaker threshold.",
        }),
      ],
    });

    expect(authHeaderMock).toHaveBeenCalledTimes(1);
    expect(cpFetchMock).toHaveBeenCalledWith("/api/dashboard/governance-overview?range=7d", {
      authorization: "Bearer test-token",
    });
  });

  test("preserves upstream governance overview error status", async () => {
    cpFetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      data: {
        error: "Forbidden",
      },
    });

    const { dashboardRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/dashboard/routes?dashboard-governance-overview-error-test"
    );

    const response = await dashboardRoutes.request("http://localhost/governance-overview?range=30d", {
      headers: {
        Authorization: "Bearer inbound-token",
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
    });
    expect(cpFetchMock).toHaveBeenCalledWith("/api/dashboard/governance-overview?range=30d", {
      authorization: "Bearer test-token",
    });
  });
});