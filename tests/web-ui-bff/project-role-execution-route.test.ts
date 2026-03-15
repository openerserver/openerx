/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const cpFetchMock = mock(async (..._args: unknown[]) => ({ ok: true, status: 200, data: {} }));
const authHeaderMock = mock(() => "Bearer test-token");

function makeProject() {
  return {
    id: "proj-default",
    name: "Default Project",
    slug: "default",
  };
}

function makeSystemRole() {
  return {
    id: "role.architect",
    projectId: null,
    name: "架构师",
    description: "负责架构评审",
    scope: "system",
    status: "active",
    ownerTeam: "platform",
    permissionProfile: "perm.readonly-analysis",
    toolProfile: "tools.discovery+review",
    defaultExecutionMode: "single",
    aggregationStrategy: null,
    maxActiveBindings: null,
    requireConsensus: false,
    riskLevel: "high",
    requiresApprovalForWrite: false,
    allowedStages: ["plan", "review"],
    outputSchemaId: null,
    tagsJson: ["review"],
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
  };
}

mock.module("../../control-plane/web-ui-bff/src/lib/control-plane-client", () => ({
  authHeader: authHeaderMock,
  cpFetch: cpFetchMock,
}));

beforeEach(() => {
  cpFetchMock.mockReset();
  authHeaderMock.mockReset();

  authHeaderMock.mockReturnValue("Bearer test-token");
  cpFetchMock.mockImplementation(async (path: string) => {
    if (path === "/api/projects/proj-default") {
      return {
        ok: true,
        status: 200,
        data: makeProject(),
      };
    }

    if (path === "/api/role-agents?scope=system") {
      return {
        ok: true,
        status: 200,
        data: {
          data: [makeSystemRole()],
        },
      };
    }

    if (path === "/api/role-agents/role.architect/projects/proj-default/override") {
      return {
        ok: false,
        status: 403,
        data: {
          error: "Forbidden",
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

describe("project role execution aggregate route", () => {
  test("falls back to system defaults when override reads return 403", async () => {
    const { projectRoutes } = await import("../../control-plane/web-ui-bff/src/modules/projects/routes");

    const response = await projectRoutes.request("http://localhost/proj-default/role-execution-view", {
      headers: {
        Authorization: "Bearer inbound-token",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      project: {
        id: "proj-default",
        name: "Default Project",
        slug: "default",
      },
      summary: {
        totalRoles: 1,
        customizedRoles: 0,
        takeoverRoles: 0,
        riskyRoles: 1,
      },
      rows: [
        {
          role: {
            id: "role.architect",
            projectId: null,
            name: "架构师",
            description: "负责架构评审",
            scope: "system",
            status: "active",
            ownerTeam: "platform",
            permissionProfile: "perm.readonly-analysis",
            toolProfile: "tools.discovery+review",
            defaultExecutionMode: "single",
            aggregationStrategy: null,
            maxActiveBindings: null,
            requireConsensus: false,
            riskLevel: "high",
            requiresApprovalForWrite: false,
            allowedStages: ["plan", "review"],
            outputSchemaId: null,
            tagsJson: ["review"],
            createdAt: "2026-03-15T00:00:00.000Z",
            updatedAt: "2026-03-15T00:00:00.000Z",
          },
          override: null,
          mode: "platform-default",
          effectiveStages: ["plan", "review"],
          overrideSummary: "当前项目未做定制，完全沿用平台默认配置。",
        },
      ],
      access: {
        overrideReadable: false,
        fallbackToSystemDefaults: true,
        message: "当前账号无法读取项目级定制字段，已回退展示平台默认角色配置。",
      },
    });

    expect(authHeaderMock).toHaveBeenCalledTimes(1);
    expect(cpFetchMock).toHaveBeenCalledTimes(3);
    expect(cpFetchMock.mock.calls[2]?.[0]).toBe(
      "/api/role-agents/role.architect/projects/proj-default/override",
    );
  });

  test("returns upstream 404 when the project is missing", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/projects/proj-default") {
        return {
          ok: false,
          status: 404,
          data: {
            error: "Project not found",
          },
        };
      }

      if (path === "/api/role-agents?scope=system") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [makeSystemRole()],
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

    const { projectRoutes } = await import("../../control-plane/web-ui-bff/src/modules/projects/routes");

    const response = await projectRoutes.request("http://localhost/proj-default/role-execution-view", {
      headers: {
        Authorization: "Bearer inbound-token",
      },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Project not found",
    });
  });

  test("returns 502 when a non-403 override fetch fails", async () => {
    cpFetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/projects/proj-default") {
        return {
          ok: true,
          status: 200,
          data: makeProject(),
        };
      }

      if (path === "/api/role-agents?scope=system") {
        return {
          ok: true,
          status: 200,
          data: {
            data: [makeSystemRole()],
          },
        };
      }

      if (path === "/api/role-agents/role.architect/projects/proj-default/override") {
        return {
          ok: false,
          status: 500,
          data: {
            error: "Upstream exploded",
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

    const { projectRoutes } = await import("../../control-plane/web-ui-bff/src/modules/projects/routes");

    const response = await projectRoutes.request("http://localhost/proj-default/role-execution-view", {
      headers: {
        Authorization: "Bearer inbound-token",
      },
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      message: "Failed to load override for role.architect: 500",
    });
  });
});