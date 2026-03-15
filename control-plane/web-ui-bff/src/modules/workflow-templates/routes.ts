import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";

export const workflowTemplateRoutes = new Hono();

interface WorkflowTemplateRecord {
  id: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  enabled: boolean;
  selectableByProjects: boolean;
  stageOrderJson: string[];
  defaultRolesJson?: string[] | null;
  version: number;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowTemplateStageRecord {
  id: string;
  templateId: string;
  stageKey: string;
  name: string;
  enabled: boolean;
  mode: "single" | "parallel" | "pipeline";
  primaryRoleAgentId: string;
  participantRoleAgentIdsJson: string[];
  roleExecutionPoliciesJson?: Array<Record<string, unknown>> | null;
  entryCriteriaJson?: string[] | null;
  exitCriteriaJson?: string[] | null;
  hooksJson?: Array<Record<string, unknown>> | null;
  gatesJson?: Array<Record<string, unknown>> | null;
  approvalsJson?: Array<Record<string, unknown>> | null;
  failurePolicyJson?: Record<string, unknown> | null;
  orderIndex: number;
}

interface RoleAgentSummary {
  id: string;
  name: string;
  riskLevel?: string;
  defaultExecutionMode?: string;
  allowedStages?: string[];
}

interface ProjectWorkflowTemplateBinding {
  projectId: string;
  workflowTemplateId: string | null;
  template: WorkflowTemplateRecord | null;
}

interface CloneWorkflowTemplatePayload {
  id: string;
  name: string;
  description?: string;
  category?: string;
  projectId?: string;
  enabled?: boolean;
  selectableByProjects?: boolean;
  defaultRoles?: string[];
}

const STAGE_CATALOG = [
  { key: "intake", label: "需求进入", description: "受理请求并建立任务上下文" },
  { key: "clarify", label: "需求澄清", description: "明确目标、范围与验收标准" },
  { key: "design", label: "方案设计", description: "确定技术方案、边界与风险" },
  { key: "plan", label: "任务拆解", description: "形成执行计划与依赖" },
  { key: "implement", label: "实现开发", description: "代码、配置与文档落地" },
  { key: "verify", label: "集成验证", description: "测试、联调与发布前验证" },
  { key: "release", label: "发布执行", description: "审批、部署与回滚准备" },
  { key: "post-release", label: "发布观察", description: "观察指标、日志与异常" },
  { key: "retrospective", label: "复盘沉淀", description: "沉淀经验并更新规则" },
] as const;

async function fetchTemplates(authorization: string, projectId?: string) {
  const params = new URLSearchParams();
  if (projectId) {
    params.set("projectId", projectId);
  }

  const query = params.toString();
  return cpFetch<{ data?: WorkflowTemplateRecord[] }>(
    `/api/workflow-templates${query ? `?${query}` : ""}`,
    { authorization },
  );
}

async function fetchTemplateById(templateId: string, authorization: string) {
  const result = await fetchTemplates(authorization);
  if (!result.ok) {
    return result;
  }

  return {
    ok: true as const,
    status: 200,
    data: result.data.data?.find((item) => item.id === templateId) ?? null,
  };
}

async function fetchStages(templateId: string, authorization: string) {
  return cpFetch<{ data?: WorkflowTemplateStageRecord[] }>(
    `/api/workflow-templates/${encodeURIComponent(templateId)}/stages`,
    { authorization },
  );
}

function sortStages(stages: WorkflowTemplateStageRecord[]) {
  return [...stages].sort((left, right) => left.orderIndex - right.orderIndex);
}

function buildDiagnostics(
  template: WorkflowTemplateRecord | null,
  stages: WorkflowTemplateStageRecord[],
) {
  const stageKeyCount = new Map<string, number>();
  for (const stage of stages) {
    stageKeyCount.set(stage.stageKey, (stageKeyCount.get(stage.stageKey) || 0) + 1);
  }

  const duplicateStageKeys = Array.from(stageKeyCount.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
  const configuredKeys = new Set(stages.map((stage) => stage.stageKey));
  const missingConfiguredStages = (template?.stageOrderJson || []).filter((key) => !configuredKeys.has(key));
  const hasCustomStages = stages.some(
    (stage) => !STAGE_CATALOG.some((catalogItem) => catalogItem.key === stage.stageKey),
  );

  return {
    duplicateStageKeys,
    missingConfiguredStages,
    hasCustomStages,
  };
}

workflowTemplateRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const result = await fetchTemplates(authHeader(c), projectId);
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

workflowTemplateRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>("/api/workflow-templates", {
    method: "POST",
    body,
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 409 | 502));
});

workflowTemplateRoutes.patch("/:templateId", async (c) => {
  const templateId = c.req.param("templateId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/workflow-templates/${encodeURIComponent(templateId)}`,
    {
      method: "PATCH",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 409 | 502));
});

workflowTemplateRoutes.post("/:templateId/clone", async (c) => {
  const authorization = authHeader(c);
  const templateId = c.req.param("templateId");
  const body = (await c.req.json()) as CloneWorkflowTemplatePayload;

  const [templateResult, stagesResult] = await Promise.all([
    fetchTemplateById(templateId, authorization),
    fetchStages(templateId, authorization),
  ]);

  if (!templateResult.ok) {
    return c.json(templateResult.data, templateResult.status as 400 | 401 | 403 | 404 | 502);
  }
  if (!templateResult.data) {
    return c.json({ error: "Source workflow template not found" }, 404);
  }
  if (!stagesResult.ok) {
    return c.json(stagesResult.data, stagesResult.status as 400 | 401 | 403 | 404 | 502);
  }
  if (!body.id?.trim() || !body.name?.trim()) {
    return c.json({ error: "Template id and name are required" }, 400);
  }

  const sourceTemplate = templateResult.data;
  const sourceStages = sortStages(stagesResult.data.data || []);
  const createTemplateResult = await cpFetch<WorkflowTemplateRecord>("/api/workflow-templates", {
    method: "POST",
    authorization,
    body: {
      id: body.id.trim(),
      projectId: body.projectId?.trim() || undefined,
      name: body.name.trim(),
      description: body.description ?? sourceTemplate.description ?? undefined,
      category: body.category ?? sourceTemplate.category ?? undefined,
      enabled: body.enabled ?? sourceTemplate.enabled,
      selectableByProjects: body.selectableByProjects ?? sourceTemplate.selectableByProjects,
      stageOrder: [...sourceTemplate.stageOrderJson],
      defaultRoles: body.defaultRoles ?? sourceTemplate.defaultRolesJson ?? undefined,
    },
  });

  if (!createTemplateResult.ok) {
    return c.json(createTemplateResult.data, createTemplateResult.status as 400 | 401 | 403 | 404 | 409 | 502);
  }

  const clonedStages: WorkflowTemplateStageRecord[] = [];
  for (const stage of sourceStages) {
    const createStageResult = await cpFetch<WorkflowTemplateStageRecord>(
      `/api/workflow-templates/${encodeURIComponent(body.id.trim())}/stages`,
      {
        method: "POST",
        authorization,
        body: {
          id: `${body.id.trim()}.${stage.stageKey}.${crypto.randomUUID()}`,
          stageKey: stage.stageKey,
          name: stage.name,
          enabled: stage.enabled,
          mode: stage.mode,
          primaryRoleAgentId: stage.primaryRoleAgentId,
          participantRoleAgentIds: stage.participantRoleAgentIdsJson,
          roleExecutionPolicies: stage.roleExecutionPoliciesJson ?? undefined,
          entryCriteria: stage.entryCriteriaJson ?? undefined,
          exitCriteria: stage.exitCriteriaJson ?? undefined,
          hooks: stage.hooksJson ?? undefined,
          gates: stage.gatesJson ?? undefined,
          approvals: stage.approvalsJson ?? undefined,
          failurePolicy: stage.failurePolicyJson ?? undefined,
          orderIndex: stage.orderIndex,
        },
      },
    );

    if (!createStageResult.ok) {
      return c.json(
        {
          error: "Workflow template cloned partially",
          template: createTemplateResult.data,
          failedStageKey: stage.stageKey,
        },
        createStageResult.status as 400 | 401 | 403 | 404 | 409 | 502,
      );
    }

    clonedStages.push(createStageResult.data);
  }

  return c.json(
    {
      template: createTemplateResult.data,
      stages: clonedStages,
      sourceTemplateId: templateId,
    },
    201,
  );
});

workflowTemplateRoutes.get("/:templateId/stages", async (c) => {
  const templateId = c.req.param("templateId");
  const result = await fetchStages(templateId, authHeader(c));
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

workflowTemplateRoutes.post("/:templateId/stages", async (c) => {
  const templateId = c.req.param("templateId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/workflow-templates/${encodeURIComponent(templateId)}/stages`,
    {
      method: "POST",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 409 | 502));
});

workflowTemplateRoutes.patch("/:templateId/stages/:stageId", async (c) => {
  const templateId = c.req.param("templateId");
  const stageId = c.req.param("stageId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/workflow-templates/${encodeURIComponent(templateId)}/stages/${encodeURIComponent(stageId)}`,
    {
      method: "PATCH",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 409 | 502));
});

workflowTemplateRoutes.delete("/:templateId/stages/:stageId", async (c) => {
  const templateId = c.req.param("templateId");
  const stageId = c.req.param("stageId");
  const result = await cpFetch<Record<string, unknown>>(
    `/api/workflow-templates/${encodeURIComponent(templateId)}/stages/${encodeURIComponent(stageId)}`,
    {
      method: "DELETE",
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 409 | 502));
});

workflowTemplateRoutes.get("/:templateId/editor-view", async (c) => {
  const authorization = authHeader(c);
  const templateId = c.req.param("templateId");

  const [templateResult, stagesResult, rolesResult] = await Promise.all([
    fetchTemplateById(templateId, authorization),
    fetchStages(templateId, authorization),
    cpFetch<{ data?: RoleAgentSummary[] }>("/api/role-agents?scope=system", { authorization }),
  ]);

  if (!templateResult.ok) {
    return c.json(templateResult.data, templateResult.status as 400 | 401 | 403 | 404 | 502);
  }
  if (!templateResult.data) {
    return c.json({ error: "Workflow template not found" }, 404);
  }
  if (!stagesResult.ok) {
    return c.json(stagesResult.data, stagesResult.status as 400 | 401 | 403 | 404 | 502);
  }
  if (!rolesResult.ok) {
    return c.json(rolesResult.data, rolesResult.status as 400 | 401 | 403 | 404 | 502);
  }

  const stages = sortStages(stagesResult.data.data || []);
  return c.json({
    template: templateResult.data,
    stages,
    availableRoles: (rolesResult.data.data || []).map((item) => ({
      id: item.id,
      name: item.name,
      riskLevel: item.riskLevel,
      defaultExecutionMode: item.defaultExecutionMode,
      allowedStages: item.allowedStages || [],
    })),
    stageCatalog: STAGE_CATALOG,
    diagnostics: buildDiagnostics(templateResult.data, stages),
  });
});

workflowTemplateRoutes.get("/projects/:projectId/view", async (c) => {
  const authorization = authHeader(c);
  const projectId = c.req.param("projectId");
  const user = c.get("user") as { role?: string; projects?: Array<{ id: string; role: string }> };
  const canManage =
    user.role === "platform_admin" ||
    user.role === "org_admin" ||
    Boolean(user.projects?.some((item) => item.id === projectId && item.role === "project_admin"));
  const [projectResult, bindingResult, templateResult] = await Promise.all([
    cpFetch<{ id: string; name?: string; slug?: string }>(`/api/projects/${encodeURIComponent(projectId)}`, {
      authorization,
    }),
    cpFetch<ProjectWorkflowTemplateBinding>(`/api/projects/${encodeURIComponent(projectId)}/workflow-template`, {
      authorization,
    }),
    fetchTemplates(authorization),
  ]);

  if (!projectResult.ok) {
    return c.json(projectResult.data, projectResult.status as 400 | 401 | 403 | 404 | 502);
  }
  if (!bindingResult.ok) {
    return c.json(bindingResult.data, bindingResult.status as 400 | 401 | 403 | 404 | 502);
  }
  if (!templateResult.ok) {
    return c.json(templateResult.data, templateResult.status as 400 | 401 | 403 | 404 | 502);
  }

  const selectableTemplates = (templateResult.data.data || []).filter(
    (item) => item.enabled && (item.selectableByProjects || item.projectId === projectId),
  );
  const currentTemplate = bindingResult.data.template;

  if (!currentTemplate) {
    return c.json({
      project: {
        id: projectResult.data.id,
        name: projectResult.data.name || projectResult.data.id,
        slug: projectResult.data.slug || "",
      },
      currentTemplate: null,
      workflowTemplateId: bindingResult.data.workflowTemplateId,
      currentTemplateSource: "unbound",
      stages: [],
      selectableTemplates,
      stageCatalog: STAGE_CATALOG,
      access: {
        canManage,
        message: bindingResult.data.workflowTemplateId
          ? "项目已记录模板绑定，但模板不存在、无权限访问，或已不再适用于当前项目。"
          : "当前项目尚未绑定工作流模板。",
      },
    });
  }

  const stagesResult = await fetchStages(currentTemplate.id, authorization);
  if (!stagesResult.ok) {
    return c.json(stagesResult.data, stagesResult.status as 400 | 401 | 403 | 404 | 502);
  }

  return c.json({
    project: {
      id: projectResult.data.id,
      name: projectResult.data.name || projectResult.data.id,
      slug: projectResult.data.slug || "",
    },
    currentTemplate,
    workflowTemplateId: bindingResult.data.workflowTemplateId,
    currentTemplateSource: "bound",
    stages: sortStages(stagesResult.data.data || []),
    selectableTemplates,
    stageCatalog: STAGE_CATALOG,
    access: {
      canManage,
      message: null,
    },
  });
});

workflowTemplateRoutes.put("/projects/:projectId/selection", async (c) => {
  const authorization = authHeader(c);
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const result = await cpFetch<ProjectWorkflowTemplateBinding>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow-template`,
    {
      method: "PUT",
      body,
      authorization,
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});