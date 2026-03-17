/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");
const createInternalAuthorizationMock = mock(async () => "Bearer internal-token");
const readDefaultExecutionModelMock = mock(() => "github-copilot:gpt-5.4");
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
  createInternalAuthorization: createInternalAuthorizationMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/opencode-config", () => ({
  readDefaultExecutionModel: readDefaultExecutionModelMock,
  resolveModelRoute: resolveModelRouteMock,
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  readOrchestrationStrategy: readOrchestrationStrategyMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  readDefaultExecutionModelMock.mockReset();
  resolveModelRouteMock.mockReset();
  readOrchestrationStrategyMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test-token");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal-token");
  readDefaultExecutionModelMock.mockReturnValue("github-copilot:gpt-5.4");
  resolveModelRouteMock.mockImplementation((value: string) => ({
    providerId: value.split(":")[0] || "github-copilot",
    modelId: value.split(":").slice(1).join(":") || value,
  }));
  readOrchestrationStrategyMock.mockReturnValue({
    hooks: [],
    templates: [],
    judge: { enabled: false },
  });

  cpFetchMock.mockImplementation(async (...args: unknown[]) => {
    const [path] = args as [string];
    if (path === "/api/projects/proj-default") {
      return {
        ok: true,
        status: 200,
        data: {
          id: "proj-default",
          name: "Default Project",
          slug: "default",
          settings: {
            defaultModel: "github-copilot:gpt-5.4",
          },
        },
      };
    }

    if (path === "/api/projects/proj-default/paid-execution-lease") {
      return {
        ok: true,
        status: 200,
        data: {
          projectId: "proj-default",
          activeLease: null,
          now: "2026-03-10T00:00:00.000Z",
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

describe("project paid execution preflight route", () => {
  test("aggregates project default model and active lease state", async () => {
    delete process.env.ALLOW_PAID_MODEL_EXECUTION;

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-default/paid-execution-preflight",
      {
        headers: {
          Authorization: "Bearer inbound-token",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      projectId: "proj-default",
      defaultModel: "github-copilot:gpt-5.4",
      effectiveModel: "github-copilot:gpt-5.4",
      allowed: false,
      activeLease: null,
      requirements: {
        allowPaidExecution: true,
        leaseRequired: true,
        hasAllowPaidExecution: false,
        hasLease: false,
      },
      preflight: {
        providerId: "github-copilot",
        modelId: "gpt-5.4",
        guardDecision: "deny",
      },
    });
  });

  test("treats project-level paid execution permission as an explicit gate override", async () => {
    delete process.env.ALLOW_PAID_MODEL_EXECUTION;
    cpFetchMock.mockImplementation(async (...args: unknown[]) => {
      const [path] = args as [string];
      if (path === "/api/projects/proj-default") {
        return {
          ok: true,
          status: 200,
          data: {
            id: "proj-default",
            name: "Default Project",
            slug: "default",
            settings: {
              defaultModel: "github-copilot:gpt-5.4",
              allowPaidExecution: true,
            },
          },
        };
      }

      if (path === "/api/projects/proj-default/paid-execution-lease") {
        return {
          ok: true,
          status: 200,
          data: {
            projectId: "proj-default",
            activeLease: null,
            now: "2026-03-10T00:00:00.000Z",
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

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes"
    );

    const response = await projectRoutes.request(
      "http://localhost/proj-default/paid-execution-preflight",
      {
        headers: {
          Authorization: "Bearer inbound-token",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requirements: {
        allowPaidExecution: true,
        hasAllowPaidExecution: true,
        leaseRequired: true,
        hasLease: false,
      },
      preflight: {
        guardDecision: "require-approval",
      },
    });
  });
});
