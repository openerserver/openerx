/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as orchestrationStrategyModule from "../../control-plane/web-ui-bff/src/lib/orchestration-strategy";
import { createControlPlaneClientModuleMock } from "./control-plane-client-mock";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");
const createInternalAuthorizationMock = mock(async () => "Bearer internal-token");
const readDefaultExecutionModelMock = mock(() => "github-copilot:gpt-5.4");
const formatModelRouteMock = mock((resolved: { providerId: string; modelId: string }) =>
  resolved.modelId.startsWith(`${resolved.providerId}/`) ||
  resolved.modelId.startsWith(`${resolved.providerId}:`)
    ? resolved.modelId
    : `${resolved.providerId}:${resolved.modelId}`,
);
const resolveModelRouteMock = mock((value: string) => ({
  providerId: value.split(":")[0] || "github-copilot",
  modelId: value.split(":").slice(1).join(":") || value,
}));
const readOrchestrationStrategyMock = mock(() => ({
  hooks: [],
  templates: [],
  judge: { enabled: false },
  organizationSettings: {
    recommendedProfiles: [],
  },
}));
const DEFAULT_EXECUTION_AGENT = "coder";
const isDefaultExecutionAgentMock = mock(
  (agentName?: string | null) => !agentName || agentName === "coder",
);

async function parseJsonResponse(response: Response) {
  const raw = await response.text();

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON response body: ${raw || "<empty>"}`);
  }
}

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () =>
  createControlPlaneClientModuleMock({
    authHeader: authHeaderMock,
    cpFetch: cpFetchMock,
    createInternalAuthorization: createInternalAuthorizationMock,
  }),
);

mock.module("../../control-plane/web-ui-bff/src/lib/opencode-config", () => ({
  diagnoseModelReadiness: mock(async () => undefined),
  formatModelRoute: formatModelRouteMock,
  readDefaultExecutionModel: readDefaultExecutionModelMock,
  resolveModelRoute: resolveModelRouteMock,
  validateModelProvider: mock(() => ({ valid: true })),
}));

mock.module("../../control-plane/web-ui-bff/src/lib/orchestration-strategy", () => ({
  ...orchestrationStrategyModule,
  DEFAULT_EXECUTION_AGENT,
  isDefaultExecutionAgent: isDefaultExecutionAgentMock,
  readOrchestrationStrategy: readOrchestrationStrategyMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();
  createInternalAuthorizationMock.mockReset();
  readDefaultExecutionModelMock.mockReset();
  formatModelRouteMock.mockReset();
  isDefaultExecutionAgentMock.mockReset();
  resolveModelRouteMock.mockReset();
  readOrchestrationStrategyMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test-token");
  createInternalAuthorizationMock.mockResolvedValue("Bearer internal-token");
  readDefaultExecutionModelMock.mockReturnValue("github-copilot:gpt-5.4");
  isDefaultExecutionAgentMock.mockImplementation(
    (agentName?: string | null) => !agentName || agentName === "coder",
  );
  formatModelRouteMock.mockImplementation((resolved: { providerId: string; modelId: string }) =>
    resolved.modelId.startsWith(`${resolved.providerId}/`) ||
    resolved.modelId.startsWith(`${resolved.providerId}:`)
      ? resolved.modelId
      : `${resolved.providerId}:${resolved.modelId}`,
  );
  resolveModelRouteMock.mockImplementation((value: string) => ({
    providerId: value.split(":")[0] || "github-copilot",
    modelId: value.split(":").slice(1).join(":") || value,
  }));
  readOrchestrationStrategyMock.mockReturnValue({
    hooks: [],
    templates: [],
    judge: { enabled: false },
    organizationSettings: {
      recommendedProfiles: [],
    },
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
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes?project-paid-execution-preflight-default"
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
    const payload = await parseJsonResponse(response);
    expect(payload).toMatchObject({
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
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;
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
      "../../control-plane/web-ui-bff/src/modules/projects/routes?project-paid-execution-preflight-override"
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
    const payload = await parseJsonResponse(response);
    expect(payload).toMatchObject({
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

  test("keeps direct provider models intact in effectiveModel", async () => {
    process.env.ALLOW_PAID_MODEL_EXECUTION = undefined;
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
              defaultModel: "anthropic/claude-sonnet-4-20250514",
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
    resolveModelRouteMock.mockImplementation((value: string) => ({
      providerId: "anthropic",
      modelId: value,
    }));

    const { projectRoutes } = await import(
      "../../control-plane/web-ui-bff/src/modules/projects/routes?project-paid-execution-preflight-direct-provider"
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
    const payload = await parseJsonResponse(response);
    expect(payload).toMatchObject({
      defaultModel: "anthropic/claude-sonnet-4-20250514",
      effectiveModel: "anthropic/claude-sonnet-4-20250514",
      preflight: {
        providerId: "anthropic",
        modelId: "anthropic/claude-sonnet-4-20250514",
      },
    });
  });
});
