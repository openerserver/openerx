import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";
import type { JWTPayload } from "../../middleware/auth";

type AppEnv = { Variables: { user: JWTPayload } };

export const workflowTemplateRoutes = new Hono<AppEnv>();

interface WorkflowTemplateRecord {
  id: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  enabled: boolean;
  selectableByProjects: boolean;
  defaultCollaborationMode?: "solo" | "team" | "hybrid" | null;
  defaultAutopilotLevel?: "L0" | "L1" | "L2" | null;
  defaultBossParticipationMode?: "disabled" | "advisory" | "exception-only" | "full-manager" | null;
  forceBossParticipation: boolean;
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
  stageTemplateStrategyJson?: {
    onBlockedTemplateId?: string;
    onWaitingApprovalTemplateId?: string;
    note?: string;
  } | null;
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

interface ProjectViewRecord {
  id: string;
  name?: string;
  slug?: string;
  settings?: {
    preferredTemplateId?: string | null;
    allowBossAutoTemplateSwitch?: boolean;
  } | null;
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
    return {
      ok: false as const,
      status: result.status,
      data: result.data,
    };
  }

  return {
    ok: true as const,
    status: 200,
    data: result.data?.data?.find((item) => item.id === templateId) ?? null,
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
  const missingConfiguredStages = (template?.stageOrderJson || []).filter(
    (key) => !configuredKeys.has(key),
  );
  const hasCustomStages = stages.some(
    (stage) => !STAGE_CATALOG.some((catalogItem) => catalogItem.key === stage.stageKey),
  );

  return {
    duplicateStageKeys,
    missingConfiguredStages,
    hasCustomStages,
  };
}

function canManageWorkflowTemplateProject(
  user: { role?: string; projects?: Array<{ id: string; role: string }> },
  projectId: string,
) {
  return (
    user.role === "platform_admin" ||
    user.role === "org_admin" ||
    Boolean(user.projects?.some((item) => item.id === projectId && item.role === "project_admin"))
  );
}

async function loadCloneWorkflowTemplateSource(templateId: string, authorization: string) {
  const [templateResult, stagesResult] = await Promise.all([
    fetchTemplateById(templateId, authorization),
    fetchStages(templateId, authorization),
  ]);

  return { templateResult, stagesResult };
}

function validateCloneWorkflowTemplateSource(resources: {
  templateResult: Awaited<ReturnType<typeof fetchTemplateById>>;
  stagesResult: Awaited<ReturnType<typeof fetchStages>>;
  body: CloneWorkflowTemplatePayload;
}) {
  if (!resources.templateResult.ok) {
    return {
      data: resources.templateResult.data,
      status: resources.templateResult.status as 400 | 401 | 403 | 404 | 502,
    };
  }
  if (!resources.templateResult.data) {
    return { data: { error: "Source workflow template not found" }, status: 404 as const };
  }
  if (!resources.stagesResult.ok) {
    return {
      data: resources.stagesResult.data,
      status: resources.stagesResult.status as 400 | 401 | 403 | 404 | 502,
    };
  }
  if (!resources.body.id?.trim() || !resources.body.name?.trim()) {
    return { data: { error: "Template id and name are required" }, status: 400 as const };
  }

  return null;
}

function buildCloneTemplateCreatePayload(
  sourceTemplate: WorkflowTemplateRecord,
  body: CloneWorkflowTemplatePayload,
) {
  return {
    id: body.id.trim(),
    projectId: body.projectId?.trim() || undefined,
    name: body.name.trim(),
    description: body.description ?? sourceTemplate.description ?? undefined,
    category: body.category ?? sourceTemplate.category ?? undefined,
    enabled: body.enabled ?? sourceTemplate.enabled,
    selectableByProjects: body.selectableByProjects ?? sourceTemplate.selectableByProjects,
    defaultCollaborationMode: sourceTemplate.defaultCollaborationMode ?? undefined,
    defaultAutopilotLevel: sourceTemplate.defaultAutopilotLevel ?? undefined,
    defaultBossParticipationMode: sourceTemplate.defaultBossParticipationMode ?? undefined,
    forceBossParticipation: sourceTemplate.forceBossParticipation ?? false,
    stageOrder: [...sourceTemplate.stageOrderJson],
    defaultRoles: body.defaultRoles ?? sourceTemplate.defaultRolesJson ?? undefined,
  };
}

async function cloneWorkflowTemplateStages(args: {
  targetTemplateId: string;
  sourceStages: WorkflowTemplateStageRecord[];
  authorization: string;
  createdTemplate: WorkflowTemplateRecord;
}) {
  const clonedStages: WorkflowTemplateStageRecord[] = [];

  for (const stage of args.sourceStages) {
    const createStageResult = await cpFetch<WorkflowTemplateStageRecord>(
      `/api/workflow-templates/${encodeURIComponent(args.targetTemplateId)}/stages`,
      {
        method: "POST",
        authorization: args.authorization,
        body: {
          id: `${args.targetTemplateId}.${stage.stageKey}.${crypto.randomUUID()}`,
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
          stageTemplateStrategy: stage.stageTemplateStrategyJson ?? undefined,
          failurePolicy: stage.failurePolicyJson ?? undefined,
          orderIndex: stage.orderIndex,
        },
      },
    );

    if (!createStageResult.ok) {
      return {
        ok: false as const,
        data: {
          error: "Workflow template cloned partially",
          template: args.createdTemplate,
          failedStageKey: stage.stageKey,
        },
        status: createStageResult.status as 400 | 401 | 403 | 404 | 409 | 502,
      };
    }

    clonedStages.push(createStageResult.data);
  }

  return { ok: true as const, data: clonedStages };
}

async function loadProjectWorkflowTemplateView(projectId: string, authorization: string) {
  const [projectResult, bindingResult, templateResult] = await Promise.all([
    cpFetch<ProjectViewRecord>(`/api/projects/${encodeURIComponent(projectId)}`, {
      authorization,
    }),
    cpFetch<ProjectWorkflowTemplateBinding>(
      `/api/projects/${encodeURIComponent(projectId)}/workflow-template`,
      {
        authorization,
      },
    ),
    fetchTemplates(authorization),
  ]);

  return { projectResult, bindingResult, templateResult };
}

function findProjectWorkflowTemplateViewError(resources: {
  projectResult: Awaited<ReturnType<typeof cpFetch<ProjectViewRecord>>>;
  bindingResult: Awaited<ReturnType<typeof cpFetch<ProjectWorkflowTemplateBinding>>>;
  templateResult: Awaited<ReturnType<typeof fetchTemplates>>;
}) {
  if (!resources.projectResult.ok) {
    return {
      data: resources.projectResult.data,
      status: resources.projectResult.status as 400 | 401 | 403 | 404 | 502,
    };
  }
  if (!resources.bindingResult.ok) {
    return {
      data: resources.bindingResult.data,
      status: resources.bindingResult.status as 400 | 401 | 403 | 404 | 502,
    };
  }
  if (!resources.templateResult.ok) {
    return {
      data: resources.templateResult.data,
      status: resources.templateResult.status as 400 | 401 | 403 | 404 | 502,
    };
  }

  return null;
}

function buildProjectWorkflowTemplateViewPayload(args: {
  project: ProjectViewRecord;
  binding: ProjectWorkflowTemplateBinding;
  selectableTemplates: WorkflowTemplateRecord[];
  canManage: boolean;
  stages: WorkflowTemplateStageRecord[];
}) {
  const currentTemplate = args.binding.template;
  const projectSettings = {
    preferredTemplateId: args.project.settings?.preferredTemplateId || null,
    allowBossAutoTemplateSwitch: Boolean(args.project.settings?.allowBossAutoTemplateSwitch),
  };
  const currentTemplatePolicy = currentTemplate
    ? {
        defaultCollaborationMode: currentTemplate.defaultCollaborationMode || null,
        defaultAutopilotLevel: currentTemplate.defaultAutopilotLevel || null,
        defaultBossParticipationMode: currentTemplate.forceBossParticipation
          ? "full-manager"
          : currentTemplate.defaultBossParticipationMode || null,
        forceBossParticipation: Boolean(currentTemplate.forceBossParticipation),
      }
    : null;

  return {
    project: {
      id: args.project.id,
      name: args.project.name || args.project.id,
      slug: args.project.slug || "",
    },
    currentTemplate,
    workflowTemplateId: args.binding.workflowTemplateId,
    currentTemplateSource: currentTemplate ? "bound" : "unbound",
    stages: args.stages,
    selectableTemplates: args.selectableTemplates,
    projectSettings,
    currentTemplatePolicy,
    stageCatalog: STAGE_CATALOG,
    access: {
      canManage: args.canManage,
      message: currentTemplate
        ? null
        : args.binding.workflowTemplateId
          ? "项目已记录模板绑定，但模板不存在、无权限访问，或已不再适用于当前项目。"
          : "当前项目尚未绑定工作流模板。",
    },
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
  return c.json(
    result.data,
    result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
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
  return c.json(
    result.data,
    result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
});

workflowTemplateRoutes.post("/:templateId/clone", async (c) => {
  const authorization = authHeader(c);
  const templateId = c.req.param("templateId");
  const body = (await c.req.json()) as CloneWorkflowTemplatePayload;

  const resources = await loadCloneWorkflowTemplateSource(templateId, authorization);
  const validationError = validateCloneWorkflowTemplateSource({ ...resources, body });
  if (validationError) {
    return c.json(validationError.data, validationError.status);
  }

  const sourceTemplate = resources.templateResult.data as WorkflowTemplateRecord;
  const sourceStages = sortStages(resources.stagesResult.data.data || []);
  const createTemplateResult = await cpFetch<WorkflowTemplateRecord>("/api/workflow-templates", {
    method: "POST",
    authorization,
    body: buildCloneTemplateCreatePayload(sourceTemplate, body),
  });

  if (!createTemplateResult.ok) {
    return c.json(
      createTemplateResult.data,
      createTemplateResult.status as 400 | 401 | 403 | 404 | 409 | 502,
    );
  }

  const cloneStagesResult = await cloneWorkflowTemplateStages({
    targetTemplateId: body.id.trim(),
    sourceStages,
    authorization,
    createdTemplate: createTemplateResult.data,
  });
  if (!cloneStagesResult.ok) {
    return c.json(cloneStagesResult.data, cloneStagesResult.status);
  }

  return c.json(
    {
      template: createTemplateResult.data,
      stages: cloneStagesResult.data,
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
  return c.json(
    result.data,
    result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
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
  return c.json(
    result.data,
    result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
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
  return c.json(
    result.data,
    result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 409 | 502),
  );
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
  const canManage = canManageWorkflowTemplateProject(user, projectId);
  const resources = await loadProjectWorkflowTemplateView(projectId, authorization);
  const resourceError = findProjectWorkflowTemplateViewError(resources);
  if (resourceError) {
    return c.json(resourceError.data, resourceError.status);
  }

  const selectableTemplates = (resources.templateResult.data.data || []).filter(
    (item) => item.enabled && (item.selectableByProjects || item.projectId === projectId),
  );
  const currentTemplate = resources.bindingResult.data.template;
  if (!currentTemplate) {
    return c.json(
      buildProjectWorkflowTemplateViewPayload({
        project: resources.projectResult.data,
        binding: resources.bindingResult.data,
        selectableTemplates,
        canManage,
        stages: [],
      }),
    );
  }

  const stagesResult = await fetchStages(currentTemplate.id, authorization);
  if (!stagesResult.ok) {
    return c.json(stagesResult.data, stagesResult.status as 400 | 401 | 403 | 404 | 502);
  }

  return c.json(
    buildProjectWorkflowTemplateViewPayload({
      project: resources.projectResult.data,
      binding: resources.bindingResult.data,
      selectableTemplates,
      canManage,
      stages: sortStages(stagesResult.data.data || []),
    }),
  );
});

workflowTemplateRoutes.put("/projects/:projectId/selection", async (c) => {
  const authorization = authHeader(c);
  const projectId = c.req.param("projectId");
  const body = (await c.req.json()) as {
    workflowTemplateId?: string | null;
    preferredTemplateId?: string | null;
    allowBossAutoTemplateSwitch?: boolean;
  };

  const bindingResult = await cpFetch<ProjectWorkflowTemplateBinding>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow-template`,
    {
      method: "PUT",
      body: { workflowTemplateId: body.workflowTemplateId ?? null },
      authorization,
    },
  );

  if (!bindingResult.ok) {
    return c.json(bindingResult.data, bindingResult.status as 400 | 401 | 403 | 404 | 502);
  }

  const settingsPatchResult = await cpFetch<{ id: string }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      body: {
        settings: {
          preferredTemplateId: body.preferredTemplateId ?? null,
          allowBossAutoTemplateSwitch: body.allowBossAutoTemplateSwitch ?? false,
        },
      },
      authorization,
    },
  );

  if (!settingsPatchResult.ok) {
    return c.json(
      settingsPatchResult.data,
      settingsPatchResult.status as 400 | 401 | 403 | 404 | 502,
    );
  }

  return c.json(
    {
      ...bindingResult.data,
      projectSettings: {
        preferredTemplateId: body.preferredTemplateId ?? null,
        allowBossAutoTemplateSwitch: body.allowBossAutoTemplateSwitch ?? false,
      },
    },
    200,
  );
});
