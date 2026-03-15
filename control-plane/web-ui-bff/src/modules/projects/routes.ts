import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const projectRoutes = new Hono();

interface ProjectRecord {
  id: string;
  name?: string;
  slug?: string;
}

interface RoleAgentRecord {
  id: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  scope: "system" | "project";
  status: "active" | "disabled" | "deprecated";
  ownerTeam?: string | null;
  permissionProfile: string;
  toolProfile: string;
  defaultExecutionMode: "single" | "parallel-review" | "round-robin";
  aggregationStrategy?: "first-pass" | "majority" | "merge-summary" | "human-review" | null;
  maxActiveBindings?: number | null;
  requireConsensus: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApprovalForWrite: boolean;
  allowedStages?: string[];
  outputSchemaId?: string | null;
  tagsJson?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

interface RoleAgentProjectOverrideRecord {
  id: string;
  roleAgentId: string;
  projectId: string;
  name?: string | null;
  description?: string | null;
  status?: "active" | "disabled" | "deprecated" | null;
  ownerTeam?: string | null;
  permissionProfile?: string | null;
  toolProfile?: string | null;
  defaultExecutionMode?: "single" | "parallel-review" | "round-robin" | null;
  aggregationStrategy?: "first-pass" | "majority" | "merge-summary" | "human-review" | null;
  maxActiveBindings?: number | null;
  requireConsensus?: boolean | null;
  riskLevel?: "low" | "medium" | "high" | "critical" | null;
  requiresApprovalForWrite?: boolean | null;
  allowedStages?: string[];
  outputSchemaId?: string | null;
  tagsJson?: string[] | null;
  bindingsMode?: "inherit" | "replace" | null;
  createdAt: string;
  updatedAt: string;
}

function roleMode(override: RoleAgentProjectOverrideRecord | null) {
  if (override?.bindingsMode === "replace") {
    return "project-takeover" as const;
  }
  if (override) {
    return "project-extend" as const;
  }
  return "platform-default" as const;
}

function effectiveStages(
  role: RoleAgentRecord,
  override: RoleAgentProjectOverrideRecord | null,
) {
  return override?.allowedStages?.length ? override.allowedStages : (role.allowedStages || []);
}

function buildOverrideSummary(
  role: RoleAgentRecord,
  override: RoleAgentProjectOverrideRecord | null,
) {
  if (!override) {
    return "当前项目未做定制，完全沿用平台默认配置。";
  }

  const summary: string[] = [];
  if (override.name) summary.push(`名称: ${override.name}`);
  if (override.status) summary.push(`状态: ${override.status}`);
  if (override.defaultExecutionMode) summary.push(`执行: ${override.defaultExecutionMode}`);
  if (override.riskLevel) summary.push(`风险: ${override.riskLevel}`);
  if (override.allowedStages?.length) {
    summary.push(`阶段: ${override.allowedStages.join("/")}`);
  }
  if (override.bindingsMode === "replace") {
    summary.push("项目完全接管执行器");
  }
  return summary.join(" · ") || `沿用 ${role.name} 默认配置`; 
}

async function getProjectRoleExecutionView(projectId: string, authorization: string) {
  const [projectResult, roleAgentResult] = await Promise.all([
    cpFetch<ProjectRecord>(`/api/projects/${encodeURIComponent(projectId)}`, {
      authorization,
    }),
    cpFetch<{ data?: RoleAgentRecord[] }>(`/api/role-agents?scope=system`, {
      authorization,
    }),
  ]);

  if (!projectResult.ok) {
    return {
      ok: false as const,
      status: projectResult.status,
      data: projectResult.data,
    };
  }

  if (!roleAgentResult.ok) {
    return {
      ok: false as const,
      status: roleAgentResult.status,
      data: roleAgentResult.data,
    };
  }

  const roles = (roleAgentResult.data?.data || [])
    .filter((item) => item.scope === "system")
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  let overrideReadable = true;
  const rows = await Promise.all(
    roles.map(async (role) => {
      let override: RoleAgentProjectOverrideRecord | null = null;

      const overrideResult = await cpFetch<RoleAgentProjectOverrideRecord>(
        `/api/role-agents/${encodeURIComponent(role.id)}/projects/${encodeURIComponent(projectId)}/override`,
        { authorization },
      );

      if (overrideResult.ok) {
        override = overrideResult.data;
      } else if (overrideResult.status === 403) {
        overrideReadable = false;
      } else if (overrideResult.status !== 404) {
        throw new Error(`Failed to load override for ${role.id}: ${overrideResult.status}`);
      }

      return {
        role,
        override,
        mode: roleMode(override),
        effectiveStages: effectiveStages(role, override),
        overrideSummary: buildOverrideSummary(role, override),
      };
    }),
  );

  const summary = {
    totalRoles: rows.length,
    customizedRoles: rows.filter((item) => Boolean(item.override)).length,
    takeoverRoles: rows.filter((item) => item.override?.bindingsMode === "replace").length,
    riskyRoles: rows.filter((item) => {
      const risk = item.override?.riskLevel || item.role.riskLevel;
      return risk === "high" || risk === "critical";
    }).length,
  };

  return {
    ok: true as const,
    status: 200,
    data: {
      project: {
        id: projectResult.data.id,
        name: projectResult.data.name || projectResult.data.id,
        slug: projectResult.data.slug || "",
      },
      summary,
      rows,
      access: {
        overrideReadable,
        fallbackToSystemDefaults: !overrideReadable,
        message: overrideReadable
          ? null
          : "当前账号无法读取项目级定制字段，已回退展示平台默认角色配置。",
      },
    },
  };
}

// GET /api/projects/overview
projectRoutes.get("/overview", async (c) => {
  const params = new URLSearchParams();
  for (const key of [
    "q",
    "orgId",
    "status",
    "configStatus",
    "onlyManaged",
    "sortBy",
    "page",
    "pageSize",
  ]) {
    const val = c.req.query(key);
    if (val) params.set(key, val);
  }
  const query = params.toString();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/overview${query ? `?${query}` : ""}`,
    { authorization: authHeader(c) },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 502));
});

// PATCH /api/projects/:projectId/archive
projectRoutes.patch("/:projectId/archive", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Record<string, unknown>>(`/api/projects/${projectId}/archive`, {
    method: "PATCH",
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

// GET /api/projects?orgId=
projectRoutes.get("/", async (c) => {
  const orgId = c.req.query("orgId") || "";
  const params = new URLSearchParams();
  if (orgId) params.set("orgId", orgId);

  const query = params.toString();
  const result = await cpFetch<Array<Record<string, unknown>>>(
    `/api/projects${query ? `?${query}` : ""}`,
    {
      authorization: authHeader(c),
    },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 502));
});

// POST /api/projects
projectRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>("/api/projects", {
    method: "POST",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 404 | 502));
});

// GET /api/projects/:projectId/members
projectRoutes.get("/:projectId/members", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Array<Record<string, unknown>>>(
    `/api/projects/${projectId}/members`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

// GET /api/projects/:projectId/members/candidates
projectRoutes.get("/:projectId/members/candidates", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Array<Record<string, unknown>>>(
    `/api/projects/${projectId}/members/candidates`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

// POST /api/projects/:projectId/members
projectRoutes.post("/:projectId/members", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(`/api/projects/${projectId}/members`, {
    method: "POST",
    body,
    authorization: authHeader(c),
  });
  return c.json(
    result.data,
    result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
});

// PATCH /api/projects/:projectId/members/:userId
projectRoutes.patch("/:projectId/members/:userId", async (c) => {
  const projectId = c.req.param("projectId");
  const userId = c.req.param("userId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/members/${userId}`,
    {
      method: "PATCH",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// DELETE /api/projects/:projectId/members/:userId
projectRoutes.delete("/:projectId/members/:userId", async (c) => {
  const projectId = c.req.param("projectId");
  const userId = c.req.param("userId");
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/members/${userId}`,
    {
      method: "DELETE",
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

// GET /api/projects/:projectId
projectRoutes.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Record<string, unknown>>(`/api/projects/${projectId}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

projectRoutes.get("/:projectId/role-execution-view", async (c) => {
  const projectId = c.req.param("projectId");
  const authorization = authHeader(c);

  try {
    const result = await getProjectRoleExecutionView(projectId, authorization);
    if (!result.ok) {
      return c.json(result.data, result.status as 401 | 403 | 404 | 502);
    }
    return c.json(result.data, 200);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Failed to build role execution view" },
      502,
    );
  }
});

// PATCH /api/projects/:projectId
projectRoutes.patch("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 404 | 502));
});
