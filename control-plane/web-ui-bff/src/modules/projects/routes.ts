import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";
import type { JWTPayload } from "../../middleware/auth";
import {
  buildTaskWorkflowViewModel,
  type ProjectStageRuntimeSummaryViewModel,
  buildProjectWorkflowStageRuntimeSummaries,
} from "../tasks/workflow-view";

type AppEnv = { Variables: { user: JWTPayload } };

export const projectRoutes = new Hono<AppEnv>();

interface ProjectRecord {
  id: string;
  name?: string;
  slug?: string;
  description?: string | null;
}

interface ProjectTaskGraphTaskRecord {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  prompt: string;
  status: string;
  category?: string | null;
  strategy?: string | null;
  repoName?: string | null;
  workingBranch?: string | null;
  selectedModel?: string | null;
  changesSummary?: {
    filesAdded?: number;
    filesModified?: number;
    filesDeleted?: number;
    totalInsertions?: number;
    totalDeletions?: number;
  } | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface ProjectTaskGraphEdgeViewModel {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  type: "depends-on" | "blocks" | "spawned-from";
  source: "manual" | "system" | "task-create";
}

interface ProjectTaskGraphTaskViewModel extends ProjectTaskGraphTaskRecord {
  currentStageLabel: string | null;
  latestActivityAt: string | null;
}

interface ProjectTaskGraphViewModel {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  };
  tasks: ProjectTaskGraphTaskViewModel[];
  edges: ProjectTaskGraphEdgeViewModel[];
  capabilities: {
    supportsDependsOn: boolean;
    supportsBlocks: boolean;
    supportsSpawnedFrom: boolean;
  };
  refreshedAt: string;
}

interface ProjectTaskRelationRecord {
  id: string;
  projectId: string;
  sourceTaskId: string;
  targetTaskId: string;
  type: "depends-on" | "blocks" | "spawned-from";
  source: "manual" | "system" | "task-create";
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
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

interface RoleAgentBindingRecord {
  id: string;
  roleAgentId: string;
  projectId?: string | null;
  bindingKey: string;
  runtimeAgent: string;
  label: string;
  enabled: boolean;
  priority: number;
  model?: string | null;
  tagsJson?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

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

interface ProjectWorkflowTemplateBinding {
  projectId: string;
  workflowTemplateId: string | null;
  template: WorkflowTemplateRecord | null;
}

interface BindingViewModel {
  id: string;
  bindingKey: string;
  label: string;
  runtimeAgent: string;
  enabled: boolean;
  priority: number;
  model?: string | null;
  source: "system" | "project";
}

interface BindingResolutionViewModel {
  source: "system" | "project" | "mixed" | "none";
  sourceReason: string;
  activeBindings: BindingViewModel[];
  standbyBindings: BindingViewModel[];
  candidatePoolSize: number;
  maxBindings: number | null;
}

interface StageRoleMatrixRowViewModel {
  roleAgentId: string;
  roleLabel: string;
  involvementKinds: string[];
  reasons: string[];
  executionMode: string;
  executionModeLabel: string;
  executionMethodSource: "stage-policy" | "project-override" | "system-default";
  executionMethodSourceLabel: string;
  projectMode: "platform-default" | "project-extend" | "project-takeover" | "unregistered";
  projectModeLabel: string;
  impactSummary: string;
  riskLevel: string;
  stageCovered: boolean;
  bindingResolution: BindingResolutionViewModel;
  warnings: string[];
}

interface OrchestrationStageViewModel {
  id: string;
  stageKey: string;
  name: string;
  enabled: boolean;
  mode: "single" | "parallel" | "pipeline";
  orderIndex: number;
  primaryRoleAgentId: string;
  primaryRoleLabel: string;
  participantRoleAgentIdsJson: string[];
  gatesJson?: Array<Record<string, unknown>> | null;
  approvalsJson?: Array<Record<string, unknown>> | null;
  failurePolicyJson?: Record<string, unknown> | null;
  roleMatrix: StageRoleMatrixRowViewModel[];
  runtimeSummary: ProjectStageRuntimeSummaryViewModel | null;
}

interface OrchestrationScenarioViewModel {
  source: "current" | "candidate";
  template: WorkflowTemplateRecord | null;
  stages: OrchestrationStageViewModel[];
}

interface ProjectTaskRecord {
  id: string;
  title?: string | null;
  status?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt?: string | null;
}

interface BossDecisionRecord {
  id: string;
  ts: string;
  decisionType: string;
  reason: string;
  confidence?: number;
  stageKey?: string;
  metadata?: Record<string, unknown>;
}

interface HumanEscalationRequest {
  id: string;
  ts: string;
  reason: string;
  status?: string;
  stageKey?: string;
  requestedBy?: string;
  metadata?: Record<string, unknown>;
}

function asOperatingModeSelection(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const collaborationMode = record.collaborationMode;
  const autopilotLevel = record.autopilotLevel;
  const bossParticipationMode = record.bossParticipationMode;
  const source = record.source;

  if (
    (collaborationMode !== "solo" && collaborationMode !== "team" && collaborationMode !== "hybrid")
    || (autopilotLevel !== "L0" && autopilotLevel !== "L1" && autopilotLevel !== "L2")
    || (bossParticipationMode !== "disabled"
      && bossParticipationMode !== "advisory"
      && bossParticipationMode !== "exception-only"
      && bossParticipationMode !== "full-manager")
    || (source !== undefined
      && source !== "system-default"
      && source !== "project-default"
      && source !== "task-override"
      && source !== "boss-decision")
  ) {
    return null;
  }

  return {
    collaborationMode,
    autopilotLevel,
    bossParticipationMode,
    selectedTemplateId: typeof record.selectedTemplateId === "string" ? record.selectedTemplateId : null,
    scenarioKey: typeof record.scenarioKey === "string" ? record.scenarioKey : undefined,
    source: source === undefined ? "task-override" : source,
  };
}

function isHumanOverrideDecision(decision: BossDecisionRecord) {
  return decision.decisionType === "manual-override"
    || decision.decisionType === "clear-override"
    || decision.metadata?.actorType === "human";
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

function executionModeLabel(value?: string | null) {
  switch (value) {
    case "parallel-review":
      return "并行评审";
    case "round-robin":
      return "轮询执行";
    case "single":
    default:
      return "单执行器";
  }
}

function projectModeLabel(mode: "platform-default" | "project-extend" | "project-takeover" | "unregistered") {
  if (mode === "project-takeover") return "项目接管";
  if (mode === "project-extend") return "项目增强";
  if (mode === "unregistered") return "未注册";
  return "平台默认";
}

function interventionSummary(role: {
  role: RoleAgentRecord;
  override: RoleAgentProjectOverrideRecord | null;
  effectiveStages: string[];
}) {
  const risk = role.override?.riskLevel || role.role.riskLevel;
  const requiresApproval = role.override?.requiresApprovalForWrite ?? role.role.requiresApprovalForWrite;
  const stageText = role.effectiveStages.slice(0, 2).join(" / ");
  if (requiresApproval && (risk === "high" || risk === "critical")) {
    return `${stageText || "对应阶段"} 可阻断并请求审批`;
  }
  if (risk === "high" || risk === "critical") {
    return `${stageText || "对应阶段"} 可发起修正请求并阻断推进`;
  }
  return `${stageText || "对应阶段"} 提供建议与修正请求`;
}

function normalizeBindings(bindings: RoleAgentBindingRecord[] | undefined, source: "system" | "project") {
  return (bindings || [])
    .map((binding) => ({
      id: binding.id,
      bindingKey: binding.bindingKey,
      label: binding.label,
      runtimeAgent: binding.runtimeAgent,
      enabled: binding.enabled,
      priority: binding.priority,
      model: binding.model ?? null,
      source,
    }))
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      if (left.source !== right.source) {
        return left.source === "project" ? -1 : 1;
      }
      return left.label.localeCompare(right.label, "zh-CN");
    });
}

function toPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function findStagePolicy(stage: WorkflowTemplateStageRecord, roleAgentId: string) {
  return (stage.roleExecutionPoliciesJson || []).find((item) => item?.roleAgentId === roleAgentId) || null;
}

function describeGateSource(gateEntry: unknown) {
  const gate = gateEntry && typeof gateEntry === "object" ? gateEntry as Record<string, unknown> : {};
  const gateName = typeof gate.name === "string" && gate.name.trim() ? gate.name.trim() : String(gate.type || "Gate");
  const evaluatorRole = typeof gate.evaluatorRole === "string" && gate.evaluatorRole.trim()
    ? gate.evaluatorRole.trim()
    : "未指定评估角色";
  return `Gate：${gateName}，评估角色 ${evaluatorRole}`;
}

function describeApprovalSource(approvalEntry: unknown) {
  const approval = approvalEntry && typeof approvalEntry === "object" ? approvalEntry as Record<string, unknown> : {};
  const approvalName = typeof approval.name === "string" && approval.name.trim() ? approval.name.trim() : "审批项";
  const approverRole = typeof approval.approverRole === "string" && approval.approverRole.trim()
    ? approval.approverRole.trim()
    : "未指定审批角色";
  return `Approval：${approvalName}，审批角色 ${approverRole}`;
}

function describeFailureFallback(stage: WorkflowTemplateStageRecord) {
  const policy = stage.failurePolicyJson && typeof stage.failurePolicyJson === "object"
    ? stage.failurePolicyJson as Record<string, unknown>
    : null;
  if (!policy) {
    return null;
  }

  const fallbackStageKey = typeof policy.fallbackStageKey === "string" && policy.fallbackStageKey.trim()
    ? policy.fallbackStageKey.trim()
    : "";
  const action = typeof policy.action === "string" && policy.action.trim() ? policy.action.trim() : "manual-intervention";
  if (fallbackStageKey) {
    return `失败回退：当前阶段失败后按 ${action} 回到 ${fallbackStageKey}`;
  }
  if (action && action !== "manual-intervention") {
    return `失败策略：当前阶段失败后执行 ${action}`;
  }
  return null;
}

function resolveExecutionMethod(
  roleRow: {
    role: RoleAgentRecord;
    override: RoleAgentProjectOverrideRecord | null;
    mode: "platform-default" | "project-extend" | "project-takeover";
    effectiveStages: string[];
  } | null,
  stage: WorkflowTemplateStageRecord,
  roleAgentId: string,
) {
  const stagePolicy = findStagePolicy(stage, roleAgentId);
  if (stagePolicy?.executionMode) {
    return {
      executionMode: String(stagePolicy.executionMode),
      executionModeLabel: executionModeLabel(String(stagePolicy.executionMode)),
      executionMethodSource: "stage-policy" as const,
      executionMethodSourceLabel: "阶段策略",
      maxBindings: toPositiveNumber(stagePolicy.maxBindings),
    };
  }

  if (roleRow?.override?.defaultExecutionMode) {
    return {
      executionMode: roleRow.override.defaultExecutionMode,
      executionModeLabel: executionModeLabel(roleRow.override.defaultExecutionMode),
      executionMethodSource: "project-override" as const,
      executionMethodSourceLabel: "项目定制",
      maxBindings: roleRow.override.maxActiveBindings ?? roleRow.role.maxActiveBindings ?? null,
    };
  }

  return {
    executionMode: roleRow?.role.defaultExecutionMode || "single",
    executionModeLabel: executionModeLabel(roleRow?.role.defaultExecutionMode || "single"),
    executionMethodSource: "system-default" as const,
    executionMethodSourceLabel: "系统默认",
    maxBindings: roleRow?.role.maxActiveBindings ?? null,
  };
}

function resolveBindingResolution(
  roleRow: {
    mode: "platform-default" | "project-extend" | "project-takeover";
  } | null,
  executionMode: string,
  maxBindings: number | null,
  systemBindings: RoleAgentBindingRecord[] | undefined,
  projectBindings: RoleAgentBindingRecord[] | undefined,
): BindingResolutionViewModel {
  const activeSystem = normalizeBindings((systemBindings || []).filter((binding) => binding.enabled), "system");
  const activeProject = normalizeBindings((projectBindings || []).filter((binding) => binding.enabled), "project");

  let candidatePool: BindingViewModel[] = [];
  let source: BindingResolutionViewModel["source"] = "none";
  let sourceReason = "当前没有可用执行器。";

  if (roleRow?.mode === "project-takeover") {
    candidatePool = [...activeProject];
    source = candidatePool.length > 0 ? "project" : "none";
    sourceReason = candidatePool.length > 0
      ? "项目已接管该角色，仅使用项目专属执行器。"
      : "项目已接管该角色，但当前没有启用的项目执行器。";
  } else {
    candidatePool = [...activeProject, ...activeSystem].sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      if (left.source !== right.source) {
        return left.source === "project" ? -1 : 1;
      }
      return left.label.localeCompare(right.label, "zh-CN");
    });
    if (activeProject.length > 0 && activeSystem.length > 0) {
      source = "mixed";
      sourceReason = "项目增强模式下，平台默认执行器与项目专属执行器共同组成候选池。";
    } else if (activeProject.length > 0) {
      source = "project";
      sourceReason = "当前仅命中项目专属执行器。";
    } else if (activeSystem.length > 0) {
      source = "system";
      sourceReason = "当前沿用平台默认执行器。";
    }
  }

  let activeCount = candidatePool.length;
  if (executionMode === "single") {
    activeCount = Math.min(1, candidatePool.length);
    sourceReason = `${sourceReason} 单执行器模式下只命中优先级最高的 1 个执行器。`;
  } else if (executionMode === "parallel-review") {
    activeCount = maxBindings ? Math.min(maxBindings, candidatePool.length) : candidatePool.length;
    sourceReason = `${sourceReason} 并行评审模式会并发命中 ${activeCount} 个执行器。`;
  } else if (executionMode === "round-robin") {
    activeCount = Math.min(1, candidatePool.length);
    sourceReason = `${sourceReason} 轮询模式会从候选池中按顺序轮转，本次默认首选优先级最高的执行器。`;
  }

  return {
    source,
    sourceReason,
    activeBindings: candidatePool.slice(0, activeCount),
    standbyBindings: candidatePool.slice(activeCount),
    candidatePoolSize: candidatePool.length,
    maxBindings,
  };
}

function buildRoleMatrix(
  stage: WorkflowTemplateStageRecord,
  roleRows: Array<{
    role: RoleAgentRecord;
    override: RoleAgentProjectOverrideRecord | null;
    mode: "platform-default" | "project-extend" | "project-takeover";
    effectiveStages: string[];
    overrideSummary: string;
  }>,
  bindingsByRoleId: Record<string, { system: RoleAgentBindingRecord[]; project: RoleAgentBindingRecord[] }>,
) {
  const roleMap = new Map(roleRows.map((row) => [row.role.id, row] as const));
  const matrix = new Map<string, StageRoleMatrixRowViewModel>();

  function ensure(roleAgentId: string) {
    const existing = matrix.get(roleAgentId);
    if (existing) {
      return existing;
    }
    const roleRow = roleMap.get(roleAgentId) || null;
    const effectiveStageList = roleRow?.effectiveStages || [];
    const stageCovered = effectiveStageList.length === 0 || effectiveStageList.includes(stage.stageKey);
    const executionMethod = resolveExecutionMethod(roleRow, stage, roleAgentId);
    const bindingResolution = resolveBindingResolution(
      roleRow,
      executionMethod.executionMode,
      executionMethod.maxBindings,
      bindingsByRoleId[roleAgentId]?.system,
      bindingsByRoleId[roleAgentId]?.project,
    );
    const warnings: string[] = [];
    if (!roleRow) {
      warnings.push("模板引用了未注册角色，当前无法解析其项目能力与执行器。");
    }
    if (roleRow?.role.status && roleRow.role.status !== "active") {
      warnings.push(`角色状态为 ${roleRow.role.status}，运行时可能被跳过。`);
    }
    if (!stageCovered) {
      warnings.push(`角色有效阶段未覆盖 ${stage.stageKey}，模板与角色配置存在冲突。`);
    }
    if (bindingResolution.candidatePoolSize === 0) {
      warnings.push("当前没有命中可用执行器，阶段虽有配置但运行时无法派发。");
    }
    const created: StageRoleMatrixRowViewModel = {
      roleAgentId,
      roleLabel: roleRow?.role.name || roleAgentId,
      involvementKinds: [],
      reasons: [],
      executionMode: executionMethod.executionMode,
      executionModeLabel: executionMethod.executionModeLabel,
      executionMethodSource: executionMethod.executionMethodSource,
      executionMethodSourceLabel: executionMethod.executionMethodSourceLabel,
      projectMode: roleRow?.mode || "unregistered",
      projectModeLabel: projectModeLabel(roleRow?.mode || "unregistered"),
      impactSummary: roleRow
        ? interventionSummary(roleRow)
        : `${stage.stageKey} 由模板直接引用，当前无法判断更细的项目影响。`,
      riskLevel: roleRow?.override?.riskLevel || roleRow?.role.riskLevel || "low",
      stageCovered,
      bindingResolution,
      warnings,
    };
    matrix.set(roleAgentId, created);
    return created;
  }

  if (stage.primaryRoleAgentId) {
    const row = ensure(stage.primaryRoleAgentId);
    row.involvementKinds.push("主责");
    row.reasons.push(`模板主责：${stage.stageKey} 由该角色负责推进`);
  }

  for (const participantRoleId of stage.participantRoleAgentIdsJson || []) {
    const row = ensure(participantRoleId);
    row.involvementKinds.push("参与");
    row.reasons.push(`模板参与：${stage.stageKey} 将该角色列为协同参与者`);
  }

  for (const gateEntry of stage.gatesJson || []) {
    const gate = gateEntry && typeof gateEntry === "object" ? gateEntry : {};
    const evaluatorRole = typeof gate.evaluatorRole === "string" ? gate.evaluatorRole : "";
    if (!evaluatorRole) {
      if (stage.primaryRoleAgentId) {
        ensure(stage.primaryRoleAgentId).reasons.push(`阶段控制：${describeGateSource(gateEntry)}`);
      }
      continue;
    }
    const row = ensure(evaluatorRole);
    row.involvementKinds.push("Gate 评估");
    row.reasons.push(describeGateSource(gateEntry));
    if (stage.primaryRoleAgentId && stage.primaryRoleAgentId !== evaluatorRole) {
      ensure(stage.primaryRoleAgentId).reasons.push(`阶段控制：${describeGateSource(gateEntry)}`);
    }
  }

  for (const approvalEntry of stage.approvalsJson || []) {
    const approval = approvalEntry && typeof approvalEntry === "object" ? approvalEntry : {};
    const approverRole = typeof approval.approverRole === "string" ? approval.approverRole : "";
    if (!approverRole) {
      if (stage.primaryRoleAgentId) {
        ensure(stage.primaryRoleAgentId).reasons.push(`阶段控制：${describeApprovalSource(approvalEntry)}`);
      }
      continue;
    }
    const row = ensure(approverRole);
    row.involvementKinds.push("审批");
    row.reasons.push(describeApprovalSource(approvalEntry));
    if (stage.primaryRoleAgentId && stage.primaryRoleAgentId !== approverRole) {
      ensure(stage.primaryRoleAgentId).reasons.push(`阶段控制：${describeApprovalSource(approvalEntry)}`);
    }
  }

  const failureFallbackReason = describeFailureFallback(stage);
  if (failureFallbackReason) {
    for (const row of matrix.values()) {
      if (row.involvementKinds.includes("主责") || row.involvementKinds.includes("Gate 评估") || row.involvementKinds.includes("审批")) {
        row.reasons.push(failureFallbackReason);
      }
    }
  }

  return Array.from(matrix.values()).map((item) => ({
    ...item,
    involvementKinds: Array.from(new Set(item.involvementKinds)),
    reasons: Array.from(new Set(item.reasons)),
  }));
}

function sortStages(stages: WorkflowTemplateStageRecord[]) {
  return [...stages].sort((left, right) => left.orderIndex - right.orderIndex);
}

function isOpenEscalation(status?: string | null) {
  return status !== "resolved" && status !== "dismissed" && status !== "cancelled";
}

function severityWeight(input: {
  workflowStatus: string;
  openEscalationCount: number;
  latestDecisionType?: string;
}) {
  if (input.workflowStatus === "blocked") return 0;
  if (input.workflowStatus === "waiting-approval") return 1;
  if (input.openEscalationCount > 0) return 2;
  if (input.latestDecisionType === "hold-stage") return 3;
  if (input.latestDecisionType === "request-approval" || input.latestDecisionType === "escalate-human") return 4;
  return 5;
}

async function fetchTaskBossDecisions(taskId: string, authorization: string) {
  const result = await cpFetch<{ data?: BossDecisionRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/boss-decisions`,
    { authorization },
  );
  return result.ok ? result.data?.data || [] : [];
}

async function fetchTaskEscalations(taskId: string, authorization: string) {
  const result = await cpFetch<{ data?: HumanEscalationRequest[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/escalations`,
    { authorization },
  );
  return result.ok ? result.data?.data || [] : [];
}

async function buildProjectBossOperationsView(projectId: string, authorization: string) {
  const [projectResult, tasksResult] = await Promise.all([
    cpFetch<ProjectRecord>(`/api/projects/${encodeURIComponent(projectId)}`, { authorization }),
    cpFetch<{ data?: ProjectTaskRecord[] }>(`/api/tasks?projectId=${encodeURIComponent(projectId)}&limit=50`, {
      authorization,
    }),
  ]);

  if (!projectResult.ok) {
    return projectResult;
  }
  if (!tasksResult.ok) {
    return tasksResult;
  }

  const tasks = tasksResult.data?.data || [];
  const taskViews = await Promise.all(
    tasks.map(async (task) => {
      const [bossDecisions, escalations, workflowView] = await Promise.all([
        fetchTaskBossDecisions(task.id, authorization),
        fetchTaskEscalations(task.id, authorization),
        buildTaskWorkflowViewModel(task.id, authorization, {
          projectId,
          taskStatus: task.status,
        }),
      ]);

      const openEscalations = escalations.filter((item) => isOpenEscalation(item.status));
      const latestBossDecision = [...bossDecisions].sort((left, right) => right.ts.localeCompare(left.ts))[0];
      const currentStage = workflowView.workflow.stages.find(
        (stage) => stage.stageKey === workflowView.workflow.currentStage,
      );

      return {
        task,
        workflowView,
        bossDecisions,
        escalations,
        openEscalations,
        latestBossDecision,
        currentStage,
      };
    }),
  );

  const timeline = taskViews
    .flatMap(({ task, workflowView, bossDecisions, openEscalations }) =>
      bossDecisions.map((decision) => ({
        ...decision,
        taskId: task.id,
        taskTitle: task.title || task.id,
        taskStatus: task.status || "unknown",
        workflowStatus: workflowView.workflow.status,
        currentStageKey: workflowView.workflow.currentStage,
        openEscalationCount: openEscalations.length,
      })),
    )
    .sort((left, right) => right.ts.localeCompare(left.ts));

  const escalations = taskViews
    .flatMap(({ task, workflowView, openEscalations }) =>
      openEscalations.map((item) => ({
        ...item,
        taskId: task.id,
        taskTitle: task.title || task.id,
        taskStatus: task.status || "unknown",
        workflowStatus: workflowView.workflow.status,
        currentStageKey: workflowView.workflow.currentStage,
      })),
    )
    .sort((left, right) => right.ts.localeCompare(left.ts));

  const overrideHistory = taskViews
    .flatMap(({ task, workflowView, bossDecisions }) =>
      bossDecisions
        .filter(isHumanOverrideDecision)
        .map((decision) => ({
          ...decision,
          taskId: task.id,
          taskTitle: task.title || task.id,
          taskStatus: task.status || "unknown",
          workflowStatus: workflowView.workflow.status,
          currentStageKey: workflowView.workflow.currentStage,
          actorId: typeof decision.metadata?.actorId === "string" ? decision.metadata.actorId : null,
          overrideAction: typeof decision.metadata?.action === "string" ? decision.metadata.action : null,
          previousMode: asOperatingModeSelection(decision.metadata?.previousMode),
          nextMode: asOperatingModeSelection(decision.metadata?.nextMode),
        })),
    )
    .sort((left, right) => right.ts.localeCompare(left.ts));

  const attentionTasks = taskViews
    .filter(({ workflowView, openEscalations, latestBossDecision }) => (
      workflowView.workflow.status === "blocked"
      || workflowView.workflow.status === "waiting-approval"
      || openEscalations.length > 0
      || latestBossDecision?.decisionType === "hold-stage"
      || latestBossDecision?.decisionType === "request-approval"
      || latestBossDecision?.decisionType === "escalate-human"
    ))
    .map(({ task, workflowView, openEscalations, latestBossDecision, bossDecisions, currentStage }) => ({
      taskId: task.id,
      taskTitle: task.title || task.id,
      taskStatus: task.status || "unknown",
      workflowStatus: workflowView.workflow.status,
      currentStageKey: workflowView.workflow.currentStage,
      currentStageLabel: currentStage?.stageLabel || workflowView.workflow.currentStage,
      currentStageStatus: currentStage?.status || "unknown",
      blockingReason: currentStage?.blockingReason,
      openEscalationCount: openEscalations.length,
      bossDecisionCount: bossDecisions.length,
      latestDecisionType: latestBossDecision?.decisionType,
      latestDecisionReason: latestBossDecision?.reason,
      latestDecisionTs: latestBossDecision?.ts || task.updatedAt || task.finishedAt || task.startedAt || task.createdAt || null,
    }))
    .sort((left, right) => {
      const leftWeight = severityWeight(left);
      const rightWeight = severityWeight(right);
      if (leftWeight !== rightWeight) {
        return leftWeight - rightWeight;
      }
      return String(right.latestDecisionTs || "").localeCompare(String(left.latestDecisionTs || ""));
    });

  const summary = {
    totalTasks: tasks.length,
    tasksWithBossDecisions: taskViews.filter((item) => item.bossDecisions.length > 0).length,
    totalBossDecisions: timeline.length,
    openEscalations: escalations.length,
    blockedTasks: taskViews.filter((item) => item.workflowView.workflow.status === "blocked").length,
    waitingApprovalTasks: taskViews.filter((item) => item.workflowView.workflow.status === "waiting-approval").length,
    tasksNeedingAttention: attentionTasks.length,
    manualOverrides: overrideHistory.length,
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
      timeline,
      overrideHistory,
      escalations,
      attentionTasks,
    },
  };
}

function inferTaskStageLabel(task: ProjectTaskGraphTaskRecord): string | null {
  if (typeof task.category === "string" && task.category.trim()) {
    return task.category.trim();
  }
  if (typeof task.strategy === "string" && task.strategy.trim()) {
    return task.strategy.trim();
  }
  return null;
}

async function buildProjectTaskGraphView(projectId: string, authorization: string) {
  const [projectResult, taskResult, relationResult] = await Promise.all([
    cpFetch<ProjectRecord>(`/api/projects/${encodeURIComponent(projectId)}`, { authorization }),
    cpFetch<{ data?: ProjectTaskGraphTaskRecord[] }>(
      `/api/tasks?projectId=${encodeURIComponent(projectId)}&limit=200`,
      { authorization },
    ),
    cpFetch<{ data?: ProjectTaskRelationRecord[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/task-relations`,
      { authorization },
    ),
  ]);

  if (!projectResult.ok) {
    return projectResult;
  }

  if (!taskResult.ok) {
    return taskResult;
  }

  if (!relationResult.ok) {
    return relationResult;
  }

  const tasks = (taskResult.data?.data || []).map((task) => ({
    ...task,
    currentStageLabel: inferTaskStageLabel(task),
    latestActivityAt: task.finishedAt || task.startedAt || task.createdAt || null,
  } satisfies ProjectTaskGraphTaskViewModel));

  const taskIds = new Set(tasks.map((task) => task.id));
  const edges = (relationResult.data?.data || []).filter(
    (relation) => taskIds.has(relation.sourceTaskId) && taskIds.has(relation.targetTaskId),
  ).map((relation) => ({
    id: relation.id,
    sourceTaskId: relation.sourceTaskId,
    targetTaskId: relation.targetTaskId,
    type: relation.type,
    source: relation.source,
  } satisfies ProjectTaskGraphEdgeViewModel));

  const relationTypes = new Set(edges.map((edge) => edge.type));

  return {
    ok: true as const,
    status: 200 as const,
    data: {
      project: {
        id: projectResult.data.id,
        name: projectResult.data.name || projectResult.data.id,
        slug: projectResult.data.slug || "",
        description: projectResult.data.description || null,
      },
      tasks,
      edges,
      capabilities: {
        supportsDependsOn: relationTypes.has("depends-on"),
        supportsBlocks: relationTypes.has("blocks"),
        supportsSpawnedFrom: relationTypes.has("spawned-from"),
      },
      refreshedAt: new Date().toISOString(),
    } satisfies ProjectTaskGraphViewModel,
  };
}

async function fetchWorkflowTemplates(authorization: string) {
  return cpFetch<{ data?: WorkflowTemplateRecord[] }>("/api/workflow-templates", { authorization });
}

async function fetchWorkflowTemplateStages(templateId: string, authorization: string) {
  return cpFetch<{ data?: WorkflowTemplateStageRecord[] }>(
    `/api/workflow-templates/${encodeURIComponent(templateId)}/stages`,
    { authorization },
  );
}

async function fetchProjectWorkflowBinding(projectId: string, authorization: string) {
  return cpFetch<ProjectWorkflowTemplateBinding>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow-template`,
    { authorization },
  );
}

async function fetchRoleBindings(roleAgentId: string, projectId: string, authorization: string) {
  const systemPath = `/api/role-agents/${encodeURIComponent(roleAgentId)}/bindings`;
  const projectPath = `/api/role-agents/${encodeURIComponent(roleAgentId)}/bindings?projectId=${encodeURIComponent(projectId)}`;
  const [systemResult, projectResult] = await Promise.all([
    cpFetch<{ data?: RoleAgentBindingRecord[] }>(systemPath, { authorization }),
    cpFetch<{ data?: RoleAgentBindingRecord[] }>(projectPath, { authorization }),
  ]);
  if (!systemResult.ok) {
    throw new Error(`Failed to load system bindings for ${roleAgentId}: ${systemResult.status}`);
  }
  if (!projectResult.ok) {
    throw new Error(`Failed to load project bindings for ${roleAgentId}: ${projectResult.status}`);
  }
  return {
    system: systemResult.data.data || [],
    project: projectResult.data.data || [],
  };
}

function buildScenario(
  source: "current" | "candidate",
  template: WorkflowTemplateRecord | null,
  stages: WorkflowTemplateStageRecord[],
  roleRows: Array<{
    role: RoleAgentRecord;
    override: RoleAgentProjectOverrideRecord | null;
    mode: "platform-default" | "project-extend" | "project-takeover";
    effectiveStages: string[];
    overrideSummary: string;
  }>,
  bindingsByRoleId: Record<string, { system: RoleAgentBindingRecord[]; project: RoleAgentBindingRecord[] }>,
  runtimeSummaries: Record<string, ProjectStageRuntimeSummaryViewModel> = {},
): OrchestrationScenarioViewModel {
  return {
    source,
    template,
    stages: sortStages(stages).map((stage) => ({
      id: stage.id,
      stageKey: stage.stageKey,
      name: stage.name,
      enabled: stage.enabled,
      mode: stage.mode,
      orderIndex: stage.orderIndex,
      primaryRoleAgentId: stage.primaryRoleAgentId,
      primaryRoleLabel: roleRows.find((row) => row.role.id === stage.primaryRoleAgentId)?.role.name || stage.primaryRoleAgentId,
      participantRoleAgentIdsJson: stage.participantRoleAgentIdsJson || [],
      gatesJson: stage.gatesJson || [],
      approvalsJson: stage.approvalsJson || [],
      failurePolicyJson: stage.failurePolicyJson || null,
      roleMatrix: buildRoleMatrix(stage, roleRows, bindingsByRoleId),
      runtimeSummary: runtimeSummaries[stage.stageKey] || null,
    })),
  };
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

projectRoutes.get("/:projectId/orchestration-view", async (c) => {
  const projectId = c.req.param("projectId");
  const authorization = authHeader(c);
  const candidateTemplateId = c.req.query("candidateTemplateId") || undefined;
  const user = (c.get("user") || {}) as {
    role?: string;
    projects?: Array<{ id: string; role: string }>;
  };
  const canManage =
    user.role === "platform_admin"
    || user.role === "org_admin"
    || Boolean(user.projects?.some((item) => item.id === projectId && item.role === "project_admin"));

  try {
    const [projectResult, roleExecutionResult, bindingResult, templatesResult] = await Promise.all([
      cpFetch<ProjectRecord>(`/api/projects/${encodeURIComponent(projectId)}`, { authorization }),
      getProjectRoleExecutionView(projectId, authorization),
      fetchProjectWorkflowBinding(projectId, authorization),
      fetchWorkflowTemplates(authorization),
    ]);

    if (!projectResult.ok) {
      return c.json(projectResult.data, projectResult.status as 401 | 403 | 404 | 502);
    }
    if (!roleExecutionResult.ok) {
      return c.json(roleExecutionResult.data, roleExecutionResult.status as 401 | 403 | 404 | 502);
    }
    if (!bindingResult.ok) {
      return c.json(bindingResult.data, bindingResult.status as 401 | 403 | 404 | 502);
    }
    if (!templatesResult.ok) {
      return c.json(templatesResult.data, templatesResult.status as 401 | 403 | 404 | 502);
    }

    const selectableTemplates = (templatesResult.data.data || []).filter(
      (item) => item.enabled && (item.selectableByProjects || item.projectId === projectId),
    );
    const currentTemplate = bindingResult.data.template;
    const currentStagesResult = currentTemplate
      ? await fetchWorkflowTemplateStages(currentTemplate.id, authorization)
      : { ok: true as const, status: 200, data: { data: [] as WorkflowTemplateStageRecord[] } };

    if (!currentStagesResult.ok) {
      return c.json(currentStagesResult.data, currentStagesResult.status as 401 | 403 | 404 | 502);
    }

    const roleRows = roleExecutionResult.data.rows;
    const bindingsByRoleId = Object.fromEntries(
      await Promise.all(
        roleRows.map(async (row) => [row.role.id, await fetchRoleBindings(row.role.id, projectId, authorization)] as const),
      ),
    );

    let candidateScenario: OrchestrationScenarioViewModel | null = null;
    if (candidateTemplateId && candidateTemplateId !== bindingResult.data.workflowTemplateId) {
      const candidateTemplate = selectableTemplates.find((item) => item.id === candidateTemplateId) || null;
      if (candidateTemplate) {
        const candidateStagesResult = await fetchWorkflowTemplateStages(candidateTemplate.id, authorization);
        if (!candidateStagesResult.ok) {
          return c.json(candidateStagesResult.data, candidateStagesResult.status as 401 | 403 | 404 | 502);
        }
        candidateScenario = buildScenario(
          "candidate",
          candidateTemplate,
          candidateStagesResult.data.data || [],
          roleRows,
          bindingsByRoleId,
        );
      }
    }

    const currentScenario = buildScenario(
      "current",
      currentTemplate,
      currentStagesResult.data.data || [],
      roleRows,
      bindingsByRoleId,
      currentTemplate
        ? await buildProjectWorkflowStageRuntimeSummaries({
            projectId,
            templateId: currentTemplate.id,
            stageKeys: (currentStagesResult.data.data || []).map((stage) => stage.stageKey),
            authorization,
          })
        : {},
    );

    return c.json({
      project: {
        id: projectResult.data.id,
        name: projectResult.data.name || projectResult.data.id,
        slug: projectResult.data.slug || "",
      },
      workflowTemplateId: bindingResult.data.workflowTemplateId,
      currentTemplate,
      selectableTemplates,
      access: {
        canManage,
        message: roleExecutionResult.data.access.message || null,
      },
      roleCapabilities: roleRows.map((row) => ({
        ...row,
        executionModeLabel: executionModeLabel(row.override?.defaultExecutionMode || row.role.defaultExecutionMode),
        projectModeLabel: projectModeLabel(row.mode),
        bindingCounts: {
          system: bindingsByRoleId[row.role.id]?.system.filter((binding) => binding.enabled).length || 0,
          project: bindingsByRoleId[row.role.id]?.project.filter((binding) => binding.enabled).length || 0,
        },
      })),
      scenarios: {
        current: currentScenario,
        candidate: candidateScenario,
      },
    }, 200);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Failed to build orchestration view" },
      502,
    );
  }
});

projectRoutes.get("/:projectId/boss-operations-view", async (c) => {
  const projectId = c.req.param("projectId");
  const authorization = authHeader(c);

  try {
    const result = await buildProjectBossOperationsView(projectId, authorization);
    if (!result.ok) {
      return c.json(result.data, result.status as 401 | 403 | 404 | 502);
    }
    return c.json(result.data, 200);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Failed to build boss operations view" },
      502,
    );
  }
});

projectRoutes.get("/:projectId/task-graph-view", async (c) => {
  const projectId = c.req.param("projectId");
  const authorization = authHeader(c);

  try {
    const result = await buildProjectTaskGraphView(projectId, authorization);
    if (!result.ok) {
      return c.json(result.data, result.status as 401 | 403 | 404 | 502);
    }
    return c.json(result.data, 200);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Failed to build project task graph view" },
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
