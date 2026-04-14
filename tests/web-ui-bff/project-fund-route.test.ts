/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as orchestrationStrategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import { createControlPlaneClientModuleMock } from "./control-plane-client-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");

async function parseJsonResponse(response: Response) {
  const raw = await response.text();
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () =>
  createControlPlaneClientModuleMock({
    authHeader: authHeaderMock,
    cpFetch: cpFetchMock,
  }),
);

mock.module("../../control-plane/web-ui-bff/src/lib/model-config", () => ({
  formatModelRoute: mock((resolved: { providerId: string; modelId: string }) =>
    `${resolved.providerId}:${resolved.modelId}`,
  ),
  readDefaultExecutionModel: mock(() => "github-copilot:gpt-5.4"),
  readOpencodeJson: mock(() => ({ models: { list: [] }, provider: {} })),
  resolveModelRoute: mock((value: string) => ({
    providerId: value.split(":")[0] || "github-copilot",
    modelId: value.split(":").slice(1).join(":") || value,
  })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...orchestrationStrategyModule,
  readOrchestrationStrategy: mock(() => ({
    hooks: [],
    templates: [],
    judge: { enabled: false },
    organizationSettings: {
      recommendedProfiles: [],
    },
  })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/paid-execution-guard", () => ({
  buildPreflightOrchestrationFingerprint: mock(() => "fingerprint"),
  evaluatePaidExecutionPreflight: mock(() => ({
    allowed: false,
    policy: {
      providerId: "github-copilot",
      modelId: "gpt-5.4",
    },
    estimate: {},
  })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/runtime-usage-ledger", () => ({
  fetchProjectRuntimeUsageBaseline: mock(async () => ({ ok: true, status: 200, data: { baseline: null } })),
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer inbound-token");
  cpFetchMock.mockImplementation(async (...args: unknown[]) => {
    const [path] = args as [string];

    if (path === "/api/projects/proj-default/fund") {
      return {
        ok: true,
        status: 200,
        data: {
          id: "fund-1",
          projectId: "proj-default",
          currency: "USD",
          totalGranted: 200,
          reserved: 20,
          consumed: 50,
          available: 130,
          status: "active",
          hasFund: true,
        },
      };
    }

    if (path.startsWith("/api/projects/proj-default/fund/ledger")) {
      return {
        ok: true,
        status: 200,
        data: {
          projectId: "proj-default",
          items: [
            {
              id: "ledger-1",
              projectId: "proj-default",
              fundId: "fund-1",
              type: "grant",
              amountUsd: 50,
              balanceAfter: 130,
              createdAt: "2026-04-10T00:00:00.000Z",
            },
          ],
          nextCursor: null,
        },
      };
    }

    if (path === "/api/projects/proj-default/fund/grant") {
      return {
        ok: true,
        status: 201,
        data: {
          fund: {
            id: "fund-1",
            projectId: "proj-default",
            currency: "USD",
            totalGranted: 250,
            reserved: 20,
            consumed: 50,
            available: 180,
            status: "active",
            hasFund: true,
          },
          ledgerEntry: {
            id: "ledger-2",
            projectId: "proj-default",
            fundId: "fund-1",
            type: "grant",
            amountUsd: 50,
            balanceAfter: 180,
            createdAt: "2026-04-10T01:00:00.000Z",
          },
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

describe("project fund routes", () => {
  test("proxies fund snapshot reads", async () => {
    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes?project-fund-read"
    );

    const response = await projectRoutes.request("http://localhost/proj-default/fund", {
      headers: {
        Authorization: "Bearer inbound-token",
      },
    });

    expect(response.status).toBe(200);
    const payload = await parseJsonResponse(response);
    expect(payload).toMatchObject({
      projectId: "proj-default",
      available: 130,
      totalGranted: 200,
    });
  });

  test("forwards grant payloads and returns created wallet mutation", async () => {
    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes?project-fund-grant"
    );

    const response = await projectRoutes.request("http://localhost/proj-default/fund/grant", {
      method: "POST",
      headers: {
        Authorization: "Bearer inbound-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amountUsd: 50, note: "补充预算" }),
    });

    expect(response.status).toBe(201);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/projects/proj-default/fund/grant",
      expect.objectContaining({
        method: "POST",
        body: { amountUsd: 50, note: "补充预算" },
        authorization: "Bearer inbound-token",
      }),
    );

    const payload = await parseJsonResponse(response);
    expect(payload).toMatchObject({
      fund: {
        available: 180,
      },
      ledgerEntry: {
        id: "ledger-2",
        type: "grant",
      },
    });
  });

  test("preserves ledger pagination query parameters", async () => {
    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes?project-fund-ledger"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-default/fund/ledger?limit=5&cursor=2026-04-10T00%3A00%3A00.000Z",
      {
        headers: {
          Authorization: "Bearer inbound-token",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(cpFetchMock).toHaveBeenCalledWith(
      "/api/projects/proj-default/fund/ledger?limit=5&cursor=2026-04-10T00%3A00%3A00.000Z",
      expect.objectContaining({
        authorization: "Bearer inbound-token",
      }),
    );

    const payload = await parseJsonResponse(response);
    expect(payload).toMatchObject({
      projectId: "proj-default",
      items: [
        {
          id: "ledger-1",
          type: "grant",
        },
      ],
    });
  });
});