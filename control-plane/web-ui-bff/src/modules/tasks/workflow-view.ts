import { cpFetch } from "../../lib/control-plane-client";

interface WorkflowRunPayload {
  id?: string;
  templateId?: string | null;
  currentStage?: string | null;
  status?: string | null;
}

interface WorkflowStagePayload {
  id?: string;
  stageKey?: string | null;
  status?: string | null;
  approvalState?: string | null;
  blockingReason?: string | null;
  primaryRoleAgentId?: string | null;
}

interface RoleConclusionPayload {
  id?: string;
  roleAgentId?: string | null;
  stage?: string | null;
  finalDecision?: string | null;
  aggregateRiskLevel?: string | null;
  consensusScore?: number | null;
  winningRationale?: string | null;
  mergedFindings?: Array<{ key?: string; title?: string; severity?: string }> | null;
  minorityFindings?: Array<{ key?: string; title?: string; severity?: string }> | null;
  conflicts?: Array<{ type?: string; severity?: string; summary?: string }> | null;
  approvalRequired?: boolean | null;
  approvalRecommendation?: { required?: boolean | null } | null;
}

interface DeveloperChangeRequestPayload {
  id?: string;
  taskStageRunId?: string | null;
  sourceRoleAgentId?: string | null;
  priority?: string | null;
  title?: string | null;
  summary?: string | null;
  requiredChanges?: string[] | null;
  blocking?: boolean | null;
  approvalRequired?: boolean | null;
  status?: string | null;
}

interface WorkflowTemplateStagePayload {
  id?: string;
  stageKey?: string | null;
  name?: string | null;
  primaryRoleAgentId?: string | null;
  gatesJson?: Array<Record<string, unknown>> | null;
  approvalsJson?: Array<Record<string, unknown>> | null;
}

interface TaskListItemPayload {
  id: string;
  title?: string | null;
  status?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface TaskStageRuntimeSummaryViewModel {
  conclusionCount: number;
  blockDecisionCount: number;
  approvalDecisionCount: number;
  manualReviewCount: number;
  openChangeRequestCount: number;
  blockingChangeRequestCount: number;
  gateResult: "not-configured" | "pending" | "passed" | "blocked";
  approvalResult: "not-configured" | "pending" | "approved" | "rejected";
  latestBlockingRoleLabel?: string;
  latestApprovalRoleLabel?: string;
}

export interface ProjectStageRuntimeSummaryViewModel {
  totalTasks: number;
  runningCount: number;
  blockedCount: number;
  waitingApprovalCount: number;
  completedCount: number;
  failedCount: number;
  blockDecisionCount: number;
  approvalDecisionCount: number;
  openChangeRequestCount: number;
  blockingChangeRequestCount: number;
  latestTask: {
    taskId: string;
    title: string;
    workflowStatus: string;
    stageStatus: string;
    approvalState: string;
    blockingReason?: string;
    timestamp?: string | null;
  } | null;
}

export interface WorkflowViewModel {
  taskId: string;
  workflow: {
    templateId: string | null;
    currentStage: string;
    status: string;
    stages: Array<{
      id: string;
      stageKey: string;
      stageLabel: string;
      status: string;
      approvalState: string;
      blockingReason?: string;
      primaryRoleLabel?: string;
      gateCount: number;
      approvalCount: number;
      runtimeSummary: TaskStageRuntimeSummaryViewModel;
    }>;
  };
  roleConclusions: Array<{
    id: string;
    roleAgentId: string;
    roleLabel: string;
    stage: string;
    finalDecision: string;
    aggregateRiskLevel: string;
    consensusScore: number;
    winningRationale: string;
    mergedFindings: Array<{ key: string; title: string; severity: string }>;
    minorityFindings: Array<{ key: string; title: string; severity: string }>;
    conflicts: Array<{ type: string; severity: string; summary: string }>;
    approvalRequired: boolean;
  }>;
  developerChangeRequests: Array<{
    id: string;
    sourceRoleAgentId: string;
    sourceRoleLabel: string;
    stageKey?: string;
    priority: string;
    title: string;
    summary: string;
    requiredChanges: string[];
    blocking: boolean;
    approvalRequired: boolean;
    status: string;
  }>;
}

function fallbackRoleLabelFromId(roleAgentId: string | null | undefined) {
  switch (roleAgentId) {
    case "role.product":
      return "产品";
    case "role.architect":
      return "架构";
    case "role.developer":
      return "开发者";
    case "role.visual":
      return "美术";
    case "role.security":
      return "安全";
    case "role.release":
      return "部署";
    case "role.operations":
      return "运维";
    case "role.qa":
      return "QA";
    default:
      return roleAgentId?.replace(/^role\./, "") || "未命名角色";
  }
}

export function stageLabelFromKey(stageKey: string | null | undefined) {
  switch (stageKey) {
    case "intake":
      return "需求进入";
    case "clarify":
      return "需求澄清";
    case "design":
      return "方案设计";
    case "plan":
      return "任务拆解";
    case "implement":
      return "实现开发";
    case "verify":
      return "集成验证";
    case "release":
      return "发布执行";
    case "post-release":
      return "发布观察";
    case "retrospective":
      return "复盘沉淀";
    case "done":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return stageKey || "未命名阶段";
  }
}

async function resolveRoleLabels(
  roleAgentIds: Array<string | null | undefined>,
  authorization: string,
  options: {
    projectId?: string | null;
  } = {},
) {
  const uniqueIds = Array.from(new Set(roleAgentIds.filter((value): value is string => Boolean(value))));
  const labelEntries = await Promise.all(
    uniqueIds.map(async (roleAgentId) => {
      const query = new URLSearchParams();
      if (options.projectId) {
        query.set("projectId", options.projectId);
      }

      const resolveResult = await cpFetch<{ data?: { role?: { name?: string | null } } }>(
        `/api/role-agents/${encodeURIComponent(roleAgentId)}/resolve${query.toString() ? `?${query.toString()}` : ""}`,
        { authorization },
      );
      if (resolveResult.ok && resolveResult.data?.data?.role?.name) {
        return [roleAgentId, resolveResult.data.data.role.name] as const;
      }

      const detailResult = await cpFetch<{ data?: { name?: string | null } }>(
        `/api/role-agents/${encodeURIComponent(roleAgentId)}`,
        { authorization },
      );
      if (detailResult.ok && detailResult.data?.data?.name) {
        return [roleAgentId, detailResult.data.data.name] as const;
      }

      return [roleAgentId, fallbackRoleLabelFromId(roleAgentId)] as const;
    }),
  );

  return new Map(labelEntries);
}

function inferWorkflowStatus(
  workflowRun: WorkflowRunPayload | null,
  stages: WorkflowStagePayload[],
  taskStatus?: string | null,
) {
  if (workflowRun?.status) {
    return workflowRun.status;
  }

  if (stages.some((stage) => stage.status === "blocked")) {
    return "blocked";
  }

  if (stages.some((stage) => stage.status === "waiting-approval" || stage.approvalState === "pending")) {
    return "waiting-approval";
  }

  if (stages.some((stage) => stage.status === "running")) {
    return "running";
  }

  switch (taskStatus) {
    case "running":
      return "running";
    case "paused":
      return "blocked";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

function inferWorkflowCurrentStage(
  workflowRun: WorkflowRunPayload | null,
  stages: WorkflowStagePayload[],
  workflowStatus: string,
  taskStatus?: string | null,
) {
  if (workflowRun?.currentStage) {
    return workflowRun.currentStage;
  }

  const activeStage = stages.find(
    (stage) =>
      Boolean(stage.stageKey)
      && (stage.status === "running"
        || stage.status === "blocked"
        || stage.status === "waiting-approval"
        || stage.approvalState === "pending"
        || (workflowStatus === "running" && stage.status === "pending")),
  );
  if (activeStage?.stageKey) {
    return activeStage.stageKey;
  }

  const completedStage = [...stages].reverse().find((stage) => stage.stageKey && stage.status === "completed");
  if (completedStage?.stageKey) {
    return completedStage.stageKey;
  }

  if (taskStatus === "completed") {
    return "done";
  }

  if (taskStatus === "cancelled") {
    return "cancelled";
  }

  return "unknown";
}

function normalizeApprovalRequired(item: RoleConclusionPayload) {
  return Boolean(item.approvalRequired ?? item.approvalRecommendation?.required);
}

function normalizeTemplateControls(templateStage?: WorkflowTemplateStagePayload | null) {
  return {
    gateCount: Array.isArray(templateStage?.gatesJson) ? templateStage.gatesJson.length : 0,
    approvalCount: Array.isArray(templateStage?.approvalsJson) ? templateStage.approvalsJson.length : 0,
  };
}

function buildStageRuntimeSummary(input: {
  stage: WorkflowStagePayload;
  conclusions: RoleConclusionPayload[];
  requests: Array<DeveloperChangeRequestPayload & { stageKey?: string }>;
  roleLabels: Map<string, string>;
  templateStage?: WorkflowTemplateStagePayload | null;
}): TaskStageRuntimeSummaryViewModel {
  const manualReviewCount = input.conclusions.filter((item) => item.finalDecision === "human-review").length;
  const blockDecisionCount = input.conclusions.filter((item) => item.finalDecision === "block").length;
  const approvalDecisionCount = input.conclusions.filter(
    (item) => item.finalDecision === "needs-approval" || normalizeApprovalRequired(item),
  ).length;
  const openRequests = input.requests.filter((item) => item.status !== "resolved" && item.status !== "won't-fix");
  const blockingChangeRequestCount = openRequests.filter((item) => item.blocking).length;
  const controls = normalizeTemplateControls(input.templateStage);
  const blockingConclusion = input.conclusions.find(
    (item) => item.finalDecision === "block" || item.finalDecision === "human-review",
  );
  const approvalConclusion = input.conclusions.find(
    (item) => item.finalDecision === "needs-approval" || normalizeApprovalRequired(item),
  );

  const hasBlocking = blockDecisionCount > 0 || manualReviewCount > 0 || blockingChangeRequestCount > 0 || input.stage.status === "blocked";
  const hasApprovalPending = approvalDecisionCount > 0 || input.stage.approvalState === "pending" || input.stage.status === "waiting-approval";

  return {
    conclusionCount: input.conclusions.length,
    blockDecisionCount,
    approvalDecisionCount,
    manualReviewCount,
    openChangeRequestCount: openRequests.length,
    blockingChangeRequestCount,
    gateResult: controls.gateCount === 0
      ? "not-configured"
      : hasBlocking
        ? "blocked"
        : input.stage.status === "completed"
          ? "passed"
          : "pending",
    approvalResult: controls.approvalCount === 0
      ? "not-configured"
      : hasApprovalPending
        ? "pending"
        : input.stage.status === "failed" || input.stage.approvalState === "rejected"
          ? "rejected"
          : input.stage.status === "completed"
            ? "approved"
            : "pending",
    latestBlockingRoleLabel: blockingConclusion?.roleAgentId
      ? input.roleLabels.get(blockingConclusion.roleAgentId) || fallbackRoleLabelFromId(blockingConclusion.roleAgentId)
      : undefined,
    latestApprovalRoleLabel: approvalConclusion?.roleAgentId
      ? input.roleLabels.get(approvalConclusion.roleAgentId) || fallbackRoleLabelFromId(approvalConclusion.roleAgentId)
      : undefined,
  };
}

async function fetchWorkflowTemplateStages(templateId: string, authorization: string) {
  const result = await cpFetch<{ data?: WorkflowTemplateStagePayload[] }>(
    `/api/workflow-templates/${encodeURIComponent(templateId)}/stages`,
    { authorization },
  );

  return result.ok ? result.data?.data || [] : [];
}

export async function buildTaskWorkflowViewModel(
  taskId: string,
  authorization: string,
  options: { projectId?: string | null; taskStatus?: string | null } = {},
): Promise<WorkflowViewModel> {
  const [workflowResult, conclusionsResult, requestsResult] = await Promise.all([
    cpFetch<{ data?: { workflowRun?: WorkflowRunPayload | null; stages?: WorkflowStagePayload[] | null } }>(
      `/api/tasks/${encodeURIComponent(taskId)}/workflow`,
      { authorization },
    ),
    cpFetch<{ data?: RoleConclusionPayload[] }>(`/api/tasks/${encodeURIComponent(taskId)}/role-conclusions`, {
      authorization,
    }),
    cpFetch<{ data?: DeveloperChangeRequestPayload[] }>(
      `/api/tasks/${encodeURIComponent(taskId)}/developer-change-requests`,
      { authorization },
    ),
  ]);

  const workflowRun = workflowResult.ok ? workflowResult.data?.data?.workflowRun ?? null : null;
  const stages = workflowResult.ok ? workflowResult.data?.data?.stages ?? [] : [];
  const conclusions = conclusionsResult.ok ? conclusionsResult.data?.data ?? [] : [];
  const requests = requestsResult.ok ? requestsResult.data?.data ?? [] : [];
  const templateStages = workflowRun?.templateId
    ? await fetchWorkflowTemplateStages(workflowRun.templateId, authorization)
    : [];
  const templateStageMap = new Map(
    templateStages
      .filter((stage): stage is WorkflowTemplateStagePayload & { stageKey: string } => Boolean(stage.stageKey))
      .map((stage) => [stage.stageKey, stage] as const),
  );
  const roleLabels = await resolveRoleLabels(
    [
      ...stages.map((stage) => stage.primaryRoleAgentId),
      ...templateStages.map((stage) => stage.primaryRoleAgentId),
      ...conclusions.map((item) => item.roleAgentId),
      ...requests.map((item) => item.sourceRoleAgentId),
    ],
    authorization,
    { projectId: options.projectId },
  );
  const inferredWorkflowStatus = inferWorkflowStatus(workflowRun, stages, options.taskStatus);
  const inferredCurrentStage = inferWorkflowCurrentStage(
    workflowRun,
    stages,
    inferredWorkflowStatus,
    options.taskStatus,
  );
  const stageRunIdToKey = new Map(
    stages
      .filter((stage): stage is WorkflowStagePayload & { id: string; stageKey: string } => Boolean(stage.id && stage.stageKey))
      .map((stage) => [stage.id, stage.stageKey] as const),
  );
  const mappedRequests = requests.map((item) => ({
    ...item,
    stageKey: item.taskStageRunId ? stageRunIdToKey.get(item.taskStageRunId) : undefined,
  }));

  return {
    taskId,
    workflow: {
      templateId: workflowRun?.templateId ?? null,
      currentStage: inferredCurrentStage,
      status: inferredWorkflowStatus,
      stages: stages.map((stage, index) => {
        const stageKey = stage.stageKey || `stage-${index + 1}`;
        const templateStage = templateStageMap.get(stageKey);
        const controls = normalizeTemplateControls(templateStage);
        return {
          id: stage.id || `${taskId}-${stage.stageKey || index}`,
          stageKey,
          stageLabel: templateStage?.name || stageLabelFromKey(stage.stageKey),
          status: stage.status || "pending",
          approvalState: stage.approvalState || "not-required",
          blockingReason: stage.blockingReason || undefined,
          primaryRoleLabel:
            roleLabels.get(stage.primaryRoleAgentId || templateStage?.primaryRoleAgentId || "")
            || fallbackRoleLabelFromId(stage.primaryRoleAgentId || templateStage?.primaryRoleAgentId),
          gateCount: controls.gateCount,
          approvalCount: controls.approvalCount,
          runtimeSummary: buildStageRuntimeSummary({
            stage,
            conclusions: conclusions.filter((item) => item.stage === stageKey),
            requests: mappedRequests.filter((item) => item.stageKey === stageKey),
            roleLabels,
            templateStage,
          }),
        };
      }),
    },
    roleConclusions: conclusions.map((item, index) => ({
      id: item.id || `${item.roleAgentId || "role"}-${item.stage || index}`,
      roleAgentId: item.roleAgentId || "unknown",
      roleLabel: roleLabels.get(item.roleAgentId || "") || fallbackRoleLabelFromId(item.roleAgentId),
      stage: item.stage || "unknown",
      finalDecision: item.finalDecision || "observe",
      aggregateRiskLevel: item.aggregateRiskLevel || "low",
      consensusScore: typeof item.consensusScore === "number" ? item.consensusScore : 0,
      winningRationale: item.winningRationale || "",
      mergedFindings: Array.isArray(item.mergedFindings)
        ? item.mergedFindings.map((finding, findingIndex) => ({
            key: finding?.key || `${index}-merged-${findingIndex}`,
            title: finding?.title || "未命名发现",
            severity: finding?.severity || "low",
          }))
        : [],
      minorityFindings: Array.isArray(item.minorityFindings)
        ? item.minorityFindings.map((finding, findingIndex) => ({
            key: finding?.key || `${index}-minority-${findingIndex}`,
            title: finding?.title || "未命名发现",
            severity: finding?.severity || "low",
          }))
        : [],
      conflicts: Array.isArray(item.conflicts)
        ? item.conflicts.map((conflict) => ({
            type: conflict?.type || "unknown",
            severity: conflict?.severity || "low",
            summary: conflict?.summary || "未提供冲突摘要",
          }))
        : [],
      approvalRequired: normalizeApprovalRequired(item),
    })),
    developerChangeRequests: mappedRequests.map((item, index) => ({
      id: item.id || `${item.sourceRoleAgentId || "role"}-request-${index}`,
      sourceRoleAgentId: item.sourceRoleAgentId || "unknown",
      sourceRoleLabel:
        roleLabels.get(item.sourceRoleAgentId || "")
        || fallbackRoleLabelFromId(item.sourceRoleAgentId),
      stageKey: item.stageKey,
      priority: item.priority || "medium",
      title: item.title || "未命名修正请求",
      summary: item.summary || "",
      requiredChanges: Array.isArray(item.requiredChanges) ? item.requiredChanges : [],
      blocking: Boolean(item.blocking),
      approvalRequired: Boolean(item.approvalRequired),
      status: item.status || "open",
    })),
  };
}

export async function buildProjectWorkflowStageRuntimeSummaries(input: {
  projectId: string;
  templateId: string;
  stageKeys: string[];
  authorization: string;
  maxTasks?: number;
}) {
  const taskListResult = await cpFetch<{ data?: TaskListItemPayload[] }>(
    `/api/tasks?projectId=${encodeURIComponent(input.projectId)}&limit=${Math.max(1, input.maxTasks || 20)}`,
    { authorization: input.authorization },
  );

  const tasks = taskListResult.ok ? taskListResult.data?.data || [] : [];
  const summaries = Object.fromEntries(
    input.stageKeys.map((stageKey) => [stageKey, {
      totalTasks: 0,
      runningCount: 0,
      blockedCount: 0,
      waitingApprovalCount: 0,
      completedCount: 0,
      failedCount: 0,
      blockDecisionCount: 0,
      approvalDecisionCount: 0,
      openChangeRequestCount: 0,
      blockingChangeRequestCount: 0,
      latestTask: null,
    } satisfies ProjectStageRuntimeSummaryViewModel]),
  ) as Record<string, ProjectStageRuntimeSummaryViewModel>;

  const workflowViews = await Promise.all(
    tasks.map(async (task) => ({
      task,
      view: await buildTaskWorkflowViewModel(task.id, input.authorization, {
        projectId: input.projectId,
        taskStatus: task.status,
      }),
    })),
  );

  for (const { task, view } of workflowViews) {
    if (view.workflow.templateId !== input.templateId) {
      continue;
    }

    for (const stage of view.workflow.stages) {
      const summary = summaries[stage.stageKey];
      if (!summary) {
        continue;
      }

      summary.totalTasks += 1;
      if (stage.status === "running") summary.runningCount += 1;
      if (stage.status === "blocked") summary.blockedCount += 1;
      if (stage.status === "waiting-approval" || stage.approvalState === "pending") summary.waitingApprovalCount += 1;
      if (stage.status === "completed") summary.completedCount += 1;
      if (stage.status === "failed" || view.workflow.status === "failed") summary.failedCount += 1;
      summary.blockDecisionCount += stage.runtimeSummary.blockDecisionCount + stage.runtimeSummary.manualReviewCount;
      summary.approvalDecisionCount += stage.runtimeSummary.approvalDecisionCount;
      summary.openChangeRequestCount += stage.runtimeSummary.openChangeRequestCount;
      summary.blockingChangeRequestCount += stage.runtimeSummary.blockingChangeRequestCount;

      if (!summary.latestTask) {
        summary.latestTask = {
          taskId: task.id,
          title: task.title || task.id,
          workflowStatus: view.workflow.status,
          stageStatus: stage.status,
          approvalState: stage.approvalState,
          blockingReason: stage.blockingReason,
          timestamp: task.finishedAt || task.startedAt || task.createdAt,
        };
      }
    }
  }

  return summaries;
}