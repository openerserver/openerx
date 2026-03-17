import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";
import { readDefaultExecutionModel, resolveModelRoute } from "../../lib/opencode-config";
import { readOrchestrationStrategy } from "../../lib/orchestration-strategy";
import {
  buildPreflightOrchestrationFingerprint,
  evaluatePaidExecutionPreflight,
  fetchProjectPaidExecutionLeaseState,
} from "../../lib/paid-execution-guard";
import { fetchProjectRuntimeUsageBaseline } from "../../lib/runtime-usage-ledger";
import type { JWTPayload } from "../../middleware/auth";
import {
  type ProjectStageRuntimeSummaryViewModel,
  buildProjectWorkflowStageRuntimeSummaries,
  buildTaskWorkflowViewModel,
} from "../tasks/workflow-view";

type AppEnv = { Variables: { user: JWTPayload } };

export const projectRoutes = new Hono<AppEnv>();

interface ProjectRecord {
  id: string;
  name?: string;
  slug?: string;
  description?: string | null;
  settings?: {
    defaultModel?: string;
    allowPaidExecution?: boolean;
  } | null;
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

interface ProjectRoleExecutionViewRow {
  role: RoleAgentRecord;
  override: RoleAgentProjectOverrideRecord | null;
  mode: "platform-default" | "project-extend" | "project-takeover";
  effectiveStages: string[];
  overrideSummary: string;
}

interface ProjectRoleExecutionViewData {
  access: { allowed: boolean; message?: string };
  rows: ProjectRoleExecutionViewRow[];
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
    (collaborationMode !== "solo" &&
      collaborationMode !== "team" &&
      collaborationMode !== "hybrid") ||
    (autopilotLevel !== "L0" && autopilotLevel !== "L1" && autopilotLevel !== "L2") ||
    (bossParticipationMode !== "disabled" &&
      bossParticipationMode !== "advisory" &&
      bossParticipationMode !== "exception-only" &&
      bossParticipationMode !== "full-manager") ||
    (source !== undefined &&
      source !== "system-default" &&
      source !== "project-default" &&
      source !== "task-override" &&
      source !== "boss-decision")
  ) {
    return null;
  }

  return {
    collaborationMode,
    autopilotLevel,
    bossParticipationMode,
    selectedTemplateId:
      typeof record.selectedTemplateId === "string" ? record.selectedTemplateId : null,
    scenarioKey: typeof record.scenarioKey === "string" ? record.scenarioKey : undefined,
    source: source === undefined ? "task-override" : source,
  };
}

function isHumanOverrideDecision(decision: BossDecisionRecord) {
  return (
    decision.decisionType === "manual-override" ||
    decision.decisionType === "clear-override" ||
    decision.metadata?.actorType === "human"
  );
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

function effectiveStages(role: RoleAgentRecord, override: RoleAgentProjectOverrideRecord | null) {
  return override?.allowedStages?.length ? override.allowedStages : role.allowedStages || [];
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
    default:
      return "单执行器";
  }
}

function projectModeLabel(
  mode: "platform-default" | "project-extend" | "project-takeover" | "unregistered",
) {
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
  const requiresApproval =
    role.override?.requiresApprovalForWrite ?? role.role.requiresApprovalForWrite;
  const stageText = role.effectiveStages.slice(0, 2).join(" / ");
  if (requiresApproval && (risk === "high" || risk === "critical")) {
    return `${stageText || "对应阶段"} 可阻断并请求审批`;
  }
  if (risk === "high" || risk === "critical") {
    return `${stageText || "对应阶段"} 可发起修正请求并阻断推进`;
  }
  return `${stageText || "对应阶段"} 提供建议与修正请求`;
}

function normalizeBindings(
  bindings: RoleAgentBindingRecord[] | undefined,
  source: "system" | "project",
) {
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
  return (
    (stage.roleExecutionPoliciesJson || []).find((item) => item?.roleAgentId === roleAgentId) ||
    null
  );
}

function describeGateSource(gateEntry: unknown) {
  const gate =
    gateEntry && typeof gateEntry === "object" ? (gateEntry as Record<string, unknown>) : {};
  const gateName =
    typeof gate.name === "string" && gate.name.trim()
      ? gate.name.trim()
      : String(gate.type || "Gate");
  const evaluatorRole =
    typeof gate.evaluatorRole === "string" && gate.evaluatorRole.trim()
      ? gate.evaluatorRole.trim()
      : "未指定评估角色";
  return `Gate：${gateName}，评估角色 ${evaluatorRole}`;
}

function describeApprovalSource(approvalEntry: unknown) {
  const approval =
    approvalEntry && typeof approvalEntry === "object"
      ? (approvalEntry as Record<string, unknown>)
      : {};
  const approvalName =
    typeof approval.name === "string" && approval.name.trim() ? approval.name.trim() : "审批项";
  const approverRole =
    typeof approval.approverRole === "string" && approval.approverRole.trim()
      ? approval.approverRole.trim()
      : "未指定审批角色";
  return `Approval：${approvalName}，审批角色 ${approverRole}`;
}

function describeFailureFallback(stage: WorkflowTemplateStageRecord) {
  const policy =
    stage.failurePolicyJson && typeof stage.failurePolicyJson === "object"
      ? (stage.failurePolicyJson as Record<string, unknown>)
      : null;
  if (!policy) {
    return null;
  }

  const fallbackStageKey =
    typeof policy.fallbackStageKey === "string" && policy.fallbackStageKey.trim()
      ? policy.fallbackStageKey.trim()
      : "";
  const action =
    typeof policy.action === "string" && policy.action.trim()
      ? policy.action.trim()
      : "manual-intervention";
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
  const activeSystem = normalizeBindings(
    (systemBindings || []).filter((binding) => binding.enabled),
    "system",
  );
  const activeProject = normalizeBindings(
    (projectBindings || []).filter((binding) => binding.enabled),
    "project",
  );

  const candidatePool =
    roleRow?.mode === "project-takeover"
      ? [...activeProject]
      : [...activeProject, ...activeSystem].sort((left, right) => {
          if (left.priority !== right.priority) {
            return left.priority - right.priority;
          }
          if (left.source !== right.source) {
            return left.source === "project" ? -1 : 1;
          }
          return left.label.localeCompare(right.label, "zh-CN");
        });
  const sourceInfo = resolveBindingSourceInfo(roleRow, activeProject, activeSystem, candidatePool);
  const activeCount = resolveActiveBindingCount(candidatePool.length, executionMode, maxBindings);

  return {
    source: sourceInfo.source,
    sourceReason: describeBindingExecutionMode(sourceInfo.reason, executionMode, activeCount),
    activeBindings: candidatePool.slice(0, activeCount),
    standbyBindings: candidatePool.slice(activeCount),
    candidatePoolSize: candidatePool.length,
    maxBindings,
  };
}

function resolveBindingSourceInfo(
  roleRow: {
    mode: "platform-default" | "project-extend" | "project-takeover";
  } | null,
  activeProject: BindingViewModel[],
  activeSystem: BindingViewModel[],
  candidatePool: BindingViewModel[],
) {
  if (roleRow?.mode === "project-takeover") {
    return {
      source: candidatePool.length > 0 ? ("project" as const) : ("none" as const),
      reason:
        candidatePool.length > 0
          ? "项目已接管该角色，仅使用项目专属执行器。"
          : "项目已接管该角色，但当前没有启用的项目执行器。",
    };
  }

  if (activeProject.length > 0 && activeSystem.length > 0) {
    return {
      source: "mixed" as const,
      reason: "项目增强模式下，平台默认执行器与项目专属执行器共同组成候选池。",
    };
  }
  if (activeProject.length > 0) {
    return { source: "project" as const, reason: "当前仅命中项目专属执行器。" };
  }
  if (activeSystem.length > 0) {
    return { source: "system" as const, reason: "当前沿用平台默认执行器。" };
  }

  return { source: "none" as const, reason: "当前没有可用执行器。" };
}

function resolveActiveBindingCount(
  candidatePoolSize: number,
  executionMode: string,
  maxBindings: number | null,
) {
  if (executionMode === "single" || executionMode === "round-robin") {
    return Math.min(1, candidatePoolSize);
  }
  if (executionMode === "parallel-review") {
    return maxBindings ? Math.min(maxBindings, candidatePoolSize) : candidatePoolSize;
  }
  return candidatePoolSize;
}

function describeBindingExecutionMode(
  sourceReason: string,
  executionMode: string,
  activeCount: number,
) {
  if (executionMode === "single") {
    return `${sourceReason} 单执行器模式下只命中优先级最高的 1 个执行器。`;
  }
  if (executionMode === "parallel-review") {
    return `${sourceReason} 并行评审模式会并发命中 ${activeCount} 个执行器。`;
  }
  if (executionMode === "round-robin") {
    return `${sourceReason} 轮询模式会从候选池中按顺序轮转，本次默认首选优先级最高的执行器。`;
  }
  return sourceReason;
}

function buildRoleMatrixWarnings(args: {
  roleRow: {
    role: RoleAgentRecord;
    override: RoleAgentProjectOverrideRecord | null;
    mode: "platform-default" | "project-extend" | "project-takeover";
    effectiveStages: string[];
    overrideSummary: string;
  } | null;
  stageCovered: boolean;
  stageKey: string;
  bindingResolution: BindingResolutionViewModel;
}) {
  const warnings: string[] = [];
  if (!args.roleRow) {
    warnings.push("模板引用了未注册角色，当前无法解析其项目能力与执行器。");
  }
  if (args.roleRow?.role.status && args.roleRow.role.status !== "active") {
    warnings.push(`角色状态为 ${args.roleRow.role.status}，运行时可能被跳过。`);
  }
  if (!args.stageCovered) {
    warnings.push(`角色有效阶段未覆盖 ${args.stageKey}，模板与角色配置存在冲突。`);
  }
  if (args.bindingResolution.candidatePoolSize === 0) {
    warnings.push("当前没有命中可用执行器，阶段虽有配置但运行时无法派发。");
  }
  return warnings;
}

function createRoleMatrixRow(args: {
  roleAgentId: string;
  roleRow: {
    role: RoleAgentRecord;
    override: RoleAgentProjectOverrideRecord | null;
    mode: "platform-default" | "project-extend" | "project-takeover";
    effectiveStages: string[];
    overrideSummary: string;
  } | null;
  stage: WorkflowTemplateStageRecord;
  bindingResolution: BindingResolutionViewModel;
  executionMethod: ReturnType<typeof resolveExecutionMethod>;
  stageCovered: boolean;
}): StageRoleMatrixRowViewModel {
  return {
    roleAgentId: args.roleAgentId,
    roleLabel: args.roleRow?.role.name || args.roleAgentId,
    involvementKinds: [],
    reasons: [],
    executionMode: args.executionMethod.executionMode,
    executionModeLabel: args.executionMethod.executionModeLabel,
    executionMethodSource: args.executionMethod.executionMethodSource,
    executionMethodSourceLabel: args.executionMethod.executionMethodSourceLabel,
    projectMode: args.roleRow?.mode || "unregistered",
    projectModeLabel: projectModeLabel(args.roleRow?.mode || "unregistered"),
    impactSummary: args.roleRow
      ? interventionSummary(args.roleRow)
      : `${args.stage.stageKey} 由模板直接引用，当前无法判断更细的项目影响。`,
    riskLevel: args.roleRow?.override?.riskLevel || args.roleRow?.role.riskLevel || "low",
    stageCovered: args.stageCovered,
    bindingResolution: args.bindingResolution,
    warnings: buildRoleMatrixWarnings({
      roleRow: args.roleRow,
      stageCovered: args.stageCovered,
      stageKey: args.stage.stageKey,
      bindingResolution: args.bindingResolution,
    }),
  };
}

function createRoleMatrixEnsure(
  stage: WorkflowTemplateStageRecord,
  roleMap: Map<
    string,
    {
      role: RoleAgentRecord;
      override: RoleAgentProjectOverrideRecord | null;
      mode: "platform-default" | "project-extend" | "project-takeover";
      effectiveStages: string[];
      overrideSummary: string;
    }
  >,
  bindingsByRoleId: Record<
    string,
    { system: RoleAgentBindingRecord[]; project: RoleAgentBindingRecord[] }
  >,
  matrix: Map<string, StageRoleMatrixRowViewModel>,
) {
  return (roleAgentId: string) => {
    const existing = matrix.get(roleAgentId);
    if (existing) {
      return existing;
    }

    const roleRow = roleMap.get(roleAgentId) || null;
    const effectiveStageList = roleRow?.effectiveStages || [];
    const stageCovered =
      effectiveStageList.length === 0 || effectiveStageList.includes(stage.stageKey);
    const executionMethod = resolveExecutionMethod(roleRow, stage, roleAgentId);
    const bindings = bindingsByRoleId[roleAgentId];
    const bindingResolution = resolveBindingResolution(
      roleRow,
      executionMethod.executionMode,
      executionMethod.maxBindings,
      bindings?.system,
      bindings?.project,
    );
    const created = createRoleMatrixRow({
      roleAgentId,
      roleRow,
      stage,
      bindingResolution,
      executionMethod,
      stageCovered,
    });
    matrix.set(roleAgentId, created);
    return created;
  };
}

function addPrimaryRoleToMatrix(
  stage: WorkflowTemplateStageRecord,
  ensure: (roleAgentId: string) => StageRoleMatrixRowViewModel,
) {
  const primary = ensure(stage.primaryRoleAgentId);
  primary.involvementKinds.push("primary");
  primary.reasons.push(`主角色：${stage.name} 的默认负责人。`);
}

function addParticipantRolesToMatrix(
  stage: WorkflowTemplateStageRecord,
  ensure: (roleAgentId: string) => StageRoleMatrixRowViewModel,
) {
  for (const roleAgentId of stage.participantRoleAgentIdsJson || []) {
    if (!roleAgentId) {
      continue;
    }
    const participant = ensure(roleAgentId);
    participant.involvementKinds.push("participant");
    participant.reasons.push(`参与角色：${stage.name} 会并行纳入该角色的意见。`);
  }
}

function addGateRolesToMatrix(
  stage: WorkflowTemplateStageRecord,
  ensure: (roleAgentId: string) => StageRoleMatrixRowViewModel,
) {
  for (const gate of stage.gatesJson || []) {
    if (typeof gate?.evaluatorRole !== "string" || !gate.evaluatorRole.trim()) {
      continue;
    }
    const gateRow = ensure(gate.evaluatorRole.trim());
    gateRow.involvementKinds.push("gate");
    gateRow.reasons.push(describeGateSource(gate));
  }
}

function addApprovalRolesToMatrix(
  stage: WorkflowTemplateStageRecord,
  ensure: (roleAgentId: string) => StageRoleMatrixRowViewModel,
) {
  for (const approval of stage.approvalsJson || []) {
    if (typeof approval?.approverRole !== "string" || !approval.approverRole.trim()) {
      continue;
    }
    const approvalRow = ensure(approval.approverRole.trim());
    approvalRow.involvementKinds.push("approval");
    approvalRow.reasons.push(describeApprovalSource(approval));
  }
}

function applyFailureFallbackReason(
  stage: WorkflowTemplateStageRecord,
  matrix: Map<string, StageRoleMatrixRowViewModel>,
) {
  const fallbackReason = describeFailureFallback(stage);
  if (!fallbackReason) {
    return;
  }

  for (const row of matrix.values()) {
    row.reasons.push(fallbackReason);
  }
}

function buildRoleMatrix(
  stage: WorkflowTemplateStageRecord,
  roleRows: ProjectRoleExecutionViewRow[],
  bindingsByRoleId: Record<
    string,
    { system: RoleAgentBindingRecord[]; project: RoleAgentBindingRecord[] }
  >,
) {
  const roleMap = new Map(roleRows.map((row) => [row.role.id, row] as const));
  const matrix = new Map<string, StageRoleMatrixRowViewModel>();
  const ensure = createRoleMatrixEnsure(stage, roleMap, bindingsByRoleId, matrix);

  addPrimaryRoleToMatrix(stage, ensure);
  addParticipantRolesToMatrix(stage, ensure);
  addGateRolesToMatrix(stage, ensure);
  addApprovalRolesToMatrix(stage, ensure);
  applyFailureFallbackReason(stage, matrix);

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
  if (
    input.latestDecisionType === "request-approval" ||
    input.latestDecisionType === "escalate-human"
  )
    return 4;
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
    cpFetch<{ data?: ProjectTaskRecord[] }>(
      `/api/tasks?projectId=${encodeURIComponent(projectId)}&limit=50`,
      {
        authorization,
      },
    ),
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
      const latestBossDecision = [...bossDecisions].sort((left, right) =>
        right.ts.localeCompare(left.ts),
      )[0];
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
      bossDecisions.filter(isHumanOverrideDecision).map((decision) => ({
        ...decision,
        taskId: task.id,
        taskTitle: task.title || task.id,
        taskStatus: task.status || "unknown",
        workflowStatus: workflowView.workflow.status,
        currentStageKey: workflowView.workflow.currentStage,
        actorId: typeof decision.metadata?.actorId === "string" ? decision.metadata.actorId : null,
        overrideAction:
          typeof decision.metadata?.action === "string" ? decision.metadata.action : null,
        previousMode: asOperatingModeSelection(decision.metadata?.previousMode),
        nextMode: asOperatingModeSelection(decision.metadata?.nextMode),
      })),
    )
    .sort((left, right) => right.ts.localeCompare(left.ts));

  const attentionTasks = taskViews
    .filter(
      ({ workflowView, openEscalations, latestBossDecision }) =>
        workflowView.workflow.status === "blocked" ||
        workflowView.workflow.status === "waiting-approval" ||
        openEscalations.length > 0 ||
        latestBossDecision?.decisionType === "hold-stage" ||
        latestBossDecision?.decisionType === "request-approval" ||
        latestBossDecision?.decisionType === "escalate-human",
    )
    .map(
      ({
        task,
        workflowView,
        openEscalations,
        latestBossDecision,
        bossDecisions,
        currentStage,
      }) => ({
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
        latestDecisionTs:
          latestBossDecision?.ts ||
          task.updatedAt ||
          task.finishedAt ||
          task.startedAt ||
          task.createdAt ||
          null,
      }),
    )
    .sort((left, right) => {
      const leftWeight = severityWeight(left);
      const rightWeight = severityWeight(right);
      if (leftWeight !== rightWeight) {
        return leftWeight - rightWeight;
      }
      return String(right.latestDecisionTs || "").localeCompare(
        String(left.latestDecisionTs || ""),
      );
    });

  const summary = {
    totalTasks: tasks.length,
    tasksWithBossDecisions: taskViews.filter((item) => item.bossDecisions.length > 0).length,
    totalBossDecisions: timeline.length,
    openEscalations: escalations.length,
    blockedTasks: taskViews.filter((item) => item.workflowView.workflow.status === "blocked")
      .length,
    waitingApprovalTasks: taskViews.filter(
      (item) => item.workflowView.workflow.status === "waiting-approval",
    ).length,
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

  const tasks = (taskResult.data?.data || []).map(
    (task) =>
      ({
        ...task,
        currentStageLabel: inferTaskStageLabel(task),
        latestActivityAt: task.finishedAt || task.startedAt || task.createdAt || null,
      }) satisfies ProjectTaskGraphTaskViewModel,
  );

  const taskIds = new Set(tasks.map((task) => task.id));
  const edges = (relationResult.data?.data || [])
    .filter((relation) => taskIds.has(relation.sourceTaskId) && taskIds.has(relation.targetTaskId))
    .map(
      (relation) =>
        ({
          id: relation.id,
          sourceTaskId: relation.sourceTaskId,
          targetTaskId: relation.targetTaskId,
          type: relation.type,
          source: relation.source,
        }) satisfies ProjectTaskGraphEdgeViewModel,
    );

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
  bindingsByRoleId: Record<
    string,
    { system: RoleAgentBindingRecord[]; project: RoleAgentBindingRecord[] }
  >,
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
      primaryRoleLabel:
        roleRows.find((row) => row.role.id === stage.primaryRoleAgentId)?.role.name ||
        stage.primaryRoleAgentId,
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
    cpFetch<{ data?: RoleAgentRecord[] }>("/api/role-agents?scope=system", {
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

function canManageProjectOrchestrationView(
  user: {
    role?: string;
    projects?: Array<{ id: string; role: string }>;
  },
  projectId: string,
) {
  return (
    user.role === "platform_admin" ||
    user.role === "org_admin" ||
    Boolean(user.projects?.some((item) => item.id === projectId && item.role === "project_admin"))
  );
}

async function loadProjectOrchestrationResources(projectId: string, authorization: string) {
  const [projectResult, roleExecutionResult, bindingResult, templatesResult] = await Promise.all([
    cpFetch<ProjectRecord>(`/api/projects/${encodeURIComponent(projectId)}`, { authorization }),
    getProjectRoleExecutionView(projectId, authorization),
    fetchProjectWorkflowBinding(projectId, authorization),
    fetchWorkflowTemplates(authorization),
  ]);

  return { projectResult, roleExecutionResult, bindingResult, templatesResult };
}

function findProjectOrchestrationErrorResponse(resources: {
  projectResult: Awaited<ReturnType<typeof cpFetch<ProjectRecord>>>;
  roleExecutionResult: Awaited<ReturnType<typeof getProjectRoleExecutionView>>;
  bindingResult: Awaited<ReturnType<typeof fetchProjectWorkflowBinding>>;
  templatesResult: Awaited<ReturnType<typeof fetchWorkflowTemplates>>;
}) {
  if (!resources.projectResult.ok) {
    return {
      data: resources.projectResult.data,
      status: resources.projectResult.status as 401 | 403 | 404 | 502,
    };
  }
  if (!resources.roleExecutionResult.ok) {
    return {
      data: resources.roleExecutionResult.data,
      status: resources.roleExecutionResult.status as 401 | 403 | 404 | 502,
    };
  }
  if (!resources.bindingResult.ok) {
    return {
      data: resources.bindingResult.data,
      status: resources.bindingResult.status as 401 | 403 | 404 | 502,
    };
  }
  if (!resources.templatesResult.ok) {
    return {
      data: resources.templatesResult.data,
      status: resources.templatesResult.status as 401 | 403 | 404 | 502,
    };
  }

  return null;
}

function selectProjectWorkflowTemplates(
  templates: WorkflowTemplateRecord[],
  projectId: string,
) {
  return templates.filter(
    (item) => item.enabled && (item.selectableByProjects || item.projectId === projectId),
  );
}

async function loadCurrentWorkflowStages(
  currentTemplate: WorkflowTemplateRecord | null,
  authorization: string,
) {
  if (!currentTemplate) {
    return {
      ok: true as const,
      status: 200 as const,
      data: { data: [] as WorkflowTemplateStageRecord[] },
    };
  }

  return fetchWorkflowTemplateStages(currentTemplate.id, authorization);
}

async function loadBindingsByRoleId(
  roleRows: ProjectRoleExecutionViewRow[],
  projectId: string,
  authorization: string,
) {
  return Object.fromEntries(
    await Promise.all(
      roleRows.map(
        async (row) =>
          [row.role.id, await fetchRoleBindings(row.role.id, projectId, authorization)] as const,
      ),
    ),
  );
}

async function buildCandidateScenario(args: {
  candidateTemplateId: string | undefined;
  currentTemplateId: string | null;
  selectableTemplates: WorkflowTemplateRecord[];
  authorization: string;
  roleRows: ProjectRoleExecutionViewRow[];
  bindingsByRoleId: Record<
    string,
    { system: RoleAgentBindingRecord[]; project: RoleAgentBindingRecord[] }
  >;
}) {
  if (!args.candidateTemplateId || args.candidateTemplateId === args.currentTemplateId) {
    return { scenario: null, error: null };
  }

  const candidateTemplate =
    args.selectableTemplates.find((item) => item.id === args.candidateTemplateId) || null;
  if (!candidateTemplate) {
    return { scenario: null, error: null };
  }

  const candidateStagesResult = await fetchWorkflowTemplateStages(
    candidateTemplate.id,
    args.authorization,
  );
  if (!candidateStagesResult.ok) {
    return {
      scenario: null,
      error: {
        data: candidateStagesResult.data,
        status: candidateStagesResult.status as 401 | 403 | 404 | 502,
      },
    };
  }

  return {
    scenario: buildScenario(
      "candidate",
      candidateTemplate,
      candidateStagesResult.data.data || [],
      args.roleRows,
      args.bindingsByRoleId,
    ),
    error: null,
  };
}

async function buildCurrentScenario(args: {
  projectId: string;
  currentTemplate: WorkflowTemplateRecord | null;
  currentStages: WorkflowTemplateStageRecord[];
  roleRows: ProjectRoleExecutionViewRow[];
  bindingsByRoleId: Record<
    string,
    { system: RoleAgentBindingRecord[]; project: RoleAgentBindingRecord[] }
  >;
  authorization: string;
}) {
  const runtimeSummaries = args.currentTemplate
    ? await buildProjectWorkflowStageRuntimeSummaries({
        projectId: args.projectId,
        templateId: args.currentTemplate.id,
        stageKeys: args.currentStages.map((stage) => stage.stageKey),
        authorization: args.authorization,
      })
    : {};

  return buildScenario(
    "current",
    args.currentTemplate,
    args.currentStages,
    args.roleRows,
    args.bindingsByRoleId,
    runtimeSummaries,
  );
}

function buildProjectOrchestrationViewPayload(args: {
  project: ProjectRecord;
  workflowTemplateId: string | null;
  currentTemplate: WorkflowTemplateRecord | null;
  selectableTemplates: WorkflowTemplateRecord[];
  canManage: boolean;
  roleExecutionView: ProjectRoleExecutionViewData;
  bindingsByRoleId: Record<
    string,
    { system: RoleAgentBindingRecord[]; project: RoleAgentBindingRecord[] }
  >;
  currentScenario: OrchestrationScenarioViewModel;
  candidateScenario: OrchestrationScenarioViewModel | null;
}) {
  return {
    project: {
      id: args.project.id,
      name: args.project.name || args.project.id,
      slug: args.project.slug || "",
    },
    workflowTemplateId: args.workflowTemplateId,
    currentTemplate: args.currentTemplate,
    selectableTemplates: args.selectableTemplates,
    access: {
      canManage: args.canManage,
      message: args.roleExecutionView.access.message || null,
    },
    roleCapabilities: args.roleExecutionView.rows.map((row) => ({
      ...row,
      executionModeLabel: executionModeLabel(
        row.override?.defaultExecutionMode || row.role.defaultExecutionMode,
      ),
      projectModeLabel: projectModeLabel(row.mode),
      bindingCounts: {
        system:
          args.bindingsByRoleId[row.role.id]?.system.filter((binding) => binding.enabled).length ||
          0,
        project:
          args.bindingsByRoleId[row.role.id]?.project.filter((binding) => binding.enabled).length ||
          0,
      },
    })),
    scenarios: {
      current: args.currentScenario,
      candidate: args.candidateScenario,
    },
  };
}

async function buildProjectOrchestrationView(args: {
  projectId: string;
  authorization: string;
  candidateTemplateId?: string;
  user: {
    role?: string;
    projects?: Array<{ id: string; role: string }>;
  };
}) {
  const canManage = canManageProjectOrchestrationView(args.user, args.projectId);
  const resources = await loadProjectOrchestrationResources(args.projectId, args.authorization);
  const resourceError = findProjectOrchestrationErrorResponse(resources);
  if (resourceError) {
    return resourceError;
  }

  const project = resources.projectResult.data;
  const roleExecutionView = resources.roleExecutionResult.data as ProjectRoleExecutionViewData;
  const workflowBinding = resources.bindingResult.data;
  const selectableTemplates = selectProjectWorkflowTemplates(
    resources.templatesResult.data.data || [],
    args.projectId,
  );
  const currentTemplate = workflowBinding.template;
  const currentStagesResult = await loadCurrentWorkflowStages(currentTemplate, args.authorization);
  if (!currentStagesResult.ok) {
    return {
      data: currentStagesResult.data,
      status: currentStagesResult.status as 401 | 403 | 404 | 502,
    };
  }

  const currentStages = currentStagesResult.data.data || [];
  const roleRows = roleExecutionView.rows;
  const bindingsByRoleId = await loadBindingsByRoleId(
    roleRows,
    args.projectId,
    args.authorization,
  );
  const candidateScenarioResult = await buildCandidateScenario({
    candidateTemplateId: args.candidateTemplateId,
    currentTemplateId: workflowBinding.workflowTemplateId,
    selectableTemplates,
    authorization: args.authorization,
    roleRows,
    bindingsByRoleId,
  });
  if (candidateScenarioResult.error) {
    return candidateScenarioResult.error;
  }

  const currentScenario = await buildCurrentScenario({
    projectId: args.projectId,
    currentTemplate,
    currentStages,
    roleRows,
    bindingsByRoleId,
    authorization: args.authorization,
  });

  return {
    data: buildProjectOrchestrationViewPayload({
      project,
      workflowTemplateId: workflowBinding.workflowTemplateId,
      currentTemplate,
      selectableTemplates,
      canManage,
      roleExecutionView,
      bindingsByRoleId,
      currentScenario,
      candidateScenario: candidateScenarioResult.scenario,
    }),
    status: 200 as const,
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
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

projectRoutes.get("/:projectId/paid-execution-lease", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/paid-execution-lease`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

projectRoutes.post("/:projectId/paid-execution-lease", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/paid-execution-lease`,
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

projectRoutes.delete("/:projectId/paid-execution-lease/:leaseId", async (c) => {
  const projectId = c.req.param("projectId");
  const leaseId = c.req.param("leaseId");
  const body = await c.req.json().catch(() => undefined);
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/paid-execution-lease/${leaseId}`,
    {
      method: "DELETE",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
});

projectRoutes.get("/:projectId/paid-execution-preflight", async (c) => {
  const projectId = c.req.param("projectId");
  const authorization = authHeader(c);
  const [projectResult, leaseResult] = await Promise.all([
    cpFetch<ProjectRecord>(`/api/projects/${projectId}`, { authorization }),
    fetchProjectPaidExecutionLeaseState(projectId, authorization),
  ]);

  if (!projectResult.ok) {
    return c.json(projectResult.data, projectResult.status as 401 | 403 | 404 | 502);
  }
  if (!leaseResult.ok) {
    return c.json(leaseResult.data, leaseResult.status as 401 | 403 | 404 | 502);
  }

  const defaultModel = projectResult.data.settings?.defaultModel || readDefaultExecutionModel();
  const resolvedModel = defaultModel ? resolveModelRoute(defaultModel) : undefined;
  const strategy = readOrchestrationStrategy();
  const enabledHookTriggers = strategy.hooks
    .filter((hook) => hook.enabled && hook.trigger !== "pre-resume")
    .map((hook) => hook.trigger);
  const shape = {
    candidateCount: 1,
    judgeEnabled: false,
    enabledHookTriggers,
    suiteLabel: "project default execute profile",
    suiteReference: `project=${projectId}`,
  };
  const baselineResult = await fetchProjectRuntimeUsageBaseline(projectId, authorization, {
    providerId: resolvedModel?.providerId,
    modelId: resolvedModel?.modelId,
    entrypointType: "single-task",
    orchestrationFingerprint: buildPreflightOrchestrationFingerprint(shape),
  });
  const preflight = evaluatePaidExecutionPreflight(
    {
      projectId,
      allowPaidExecution: projectResult.data.settings?.allowPaidExecution === true,
      resolvedModel: resolvedModel || undefined,
      shape,
      baseline: baselineResult.ok ? baselineResult.data.baseline : null,
    },
    leaseResult.data,
  );

  return c.json(
    {
      projectId,
      defaultModel: projectResult.data.settings?.defaultModel || null,
      effectiveModel: defaultModel || `${preflight.policy.providerId}:${preflight.policy.modelId}`,
      allowed: preflight.allowed,
      activeLease: preflight.activeLease,
      policy: preflight.policy,
      requirements: preflight.requirements,
      preflight: preflight.estimate,
    },
    200,
  );
});

projectRoutes.get("/:projectId/runtime-usage-ledgers", async (c) => {
  const projectId = c.req.param("projectId");
  const search = new URLSearchParams();
  for (const key of ["limit", "taskId", "status"]) {
    const value = c.req.query(key);
    if (value) {
      search.set(key, value);
    }
  }

  const suffix = search.toString() ? `?${search.toString()}` : "";
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/runtime-usage-ledgers${suffix}`,
    {
      authorization: authHeader(c),
    },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

projectRoutes.get("/:projectId/runtime-usage-ledgers/:ledgerId", async (c) => {
  const projectId = c.req.param("projectId");
  const ledgerId = c.req.param("ledgerId");
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/runtime-usage-ledgers/${ledgerId}`,
    {
      authorization: authHeader(c),
    },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
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

  try {
    const result = await buildProjectOrchestrationView({
      projectId,
      authorization,
      candidateTemplateId,
      user,
    });
    return c.json(result.data, result.status);
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
      {
        message: error instanceof Error ? error.message : "Failed to build project task graph view",
      },
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
