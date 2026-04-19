import { Hono } from "hono";
import { authHeader, cpFetch } from "../../lib/control-plane-client";
import type { HookExecutionRecord } from "../../lib/orchestration-strategy";
import type { JWTPayload } from "../../middleware/auth";
import {
  type TaskSessionTimelineMeta,
  createProjectionTraceTimelineMeta,
  fetchTaskSessionTimeline,
  normalizeTaskSessionTimelineMeta,
  shouldReplaceTraceTimeline,
  toCanonicalTaskSessionId,
} from "../tasks/task-session-store";
import {
  type ProjectStageRuntimeSummaryViewModel,
  type ProjectTaskListItemPayload,
  buildProjectWorkflowStageRuntimeSummaries,
  buildTaskWorkflowViewModel,
  fetchProjectTaskList,
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
  } | null;
}

interface ProjectTaskGraphEdgeViewModel {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  type: "depends-on" | "blocks" | "spawned-from";
  source: "manual" | "system" | "task-create";
}

interface ProjectTaskGraphTaskViewModel extends ProjectTaskListItemPayload {
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

interface ProjectTreeNodeRecord {
  id: string;
  projectId: string;
  parentId?: string | null;
  path: string;
  depth: number;
  nodeType: "project_root" | "task" | "session" | "message" | "context" | "fork_point";
  role?: string | null;
  contentText?: string | null;
  contentJson?: Record<string, unknown> | null;
  tokenCount?: number | null;
  runtimeSessionId?: string | null;
  runtimeMessageId?: string | null;
  branchName?: string | null;
  isActive: boolean;
  supersededBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
}

interface ProjectTreeBranchRecord {
  id: string;
  projectId: string;
  taskNodeId?: string | null;
  branchName: string;
  headNodeId: string;
  isDefault: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface ProjectTreeLinkRecord {
  id: string;
  sourceNodeId: string;
  sourceProjectId: string;
  targetNodeId: string;
  targetProjectId: string;
  linkType: "depends-on" | "blocks" | "cites" | "forked-from" | "spawned" | "related";
  metadata?: Record<string, unknown> | null;
  bidirectional?: boolean;
  createdBy?: string | null;
  createdAt?: string | null;
  direction?: "incoming" | "outgoing" | "self";
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
  mode: "single" | "parallel" | "sequential-chain";
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
  mode: "single" | "parallel" | "sequential-chain";
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

async function buildProjectManagementOperationsView(projectId: string, authorization: string) {
  const [projectResult, tasksResult] = await Promise.all([
    cpFetch<ProjectRecord>(`/api/projects/${encodeURIComponent(projectId)}`, { authorization }),
    fetchProjectTaskList({ projectId, authorization, limit: 50 }),
  ]);

  if (!projectResult.ok) {
    return projectResult;
  }
  if (!tasksResult.ok) {
    return tasksResult;
  }

  const tasks = tasksResult.data || [];
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
        managementDecisionCount: bossDecisions.length,
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
    tasksWithManagementDecisions: taskViews.filter((item) => item.bossDecisions.length > 0).length,
    totalManagementDecisions: timeline.length,
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

async function buildProjectBossOperationsView(projectId: string, authorization: string) {
  return buildProjectManagementOperationsView(projectId, authorization);
}

function inferTaskStageLabel(
  task: Pick<ProjectTaskGraphTaskViewModel, "category" | "strategy">,
): string | null {
  if (typeof task.category === "string" && task.category.trim()) {
    return task.category.trim();
  }
  if (typeof task.strategy === "string" && task.strategy.trim()) {
    return task.strategy.trim();
  }
  return null;
}

async function buildProjectTaskGraphView(projectId: string, authorization: string) {
  const [projectResult, taskResult, linkResult, bindingResult] = await Promise.all([
    cpFetch<ProjectRecord>(`/api/projects/${encodeURIComponent(projectId)}`, { authorization }),
    fetchProjectTaskList({ projectId, authorization, limit: 200 }),
    cpFetch<{ data?: ProjectTreeLinkRecord[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/links`,
      {
        authorization,
      },
    ),
    fetchProjectWorkflowBinding(projectId, authorization),
  ]);

  if (!projectResult.ok) {
    return projectResult;
  }

  if (!taskResult.ok) {
    return taskResult;
  }

  if (!linkResult.ok) {
    return linkResult;
  }

  const rawTasks = taskResult.data || [];
  const stageKeyToName = await loadWorkflowStageNameMap(bindingResult, authorization);
  const taskStageMap = await loadTaskWorkflowStageMap(rawTasks, authorization);

  const tasks = rawTasks.map((task) => {
    const stageKey = taskStageMap.get(task.id);
    const stageName = stageKey ? stageKeyToName.get(stageKey) || stageKey : null;
    return {
      ...task,
      currentStageLabel: stageName || inferTaskStageLabel(task),
      latestActivityAt: task.finishedAt || task.startedAt || task.createdAt || null,
    } satisfies ProjectTaskGraphTaskViewModel;
  });

  const taskIds = new Set(tasks.map((task) => task.id));
  const edges = buildProjectTaskGraphEdges(linkResult.data?.data || [], taskIds);

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

async function loadWorkflowStageNameMap(
  bindingResult: Awaited<ReturnType<typeof fetchProjectWorkflowBinding>>,
  authorization: string,
) {
  const stageKeyToName = new Map<string, string>();
  const templateId = bindingResult.ok ? bindingResult.data?.workflowTemplateId : null;
  if (!templateId) {
    return stageKeyToName;
  }

  const stagesResult = await fetchWorkflowTemplateStages(templateId, authorization);
  if (!stagesResult.ok || !stagesResult.data?.data) {
    return stageKeyToName;
  }

  for (const stage of stagesResult.data.data) {
    if (stage.stageKey && stage.name) {
      stageKeyToName.set(stage.stageKey, stage.name);
    }
  }

  return stageKeyToName;
}

async function loadTaskWorkflowStageMap(rawTasks: Array<{ id: string }>, authorization: string) {
  const taskStageMap = new Map<string, string>();

  await Promise.all(
    rawTasks.map((task) =>
      cpFetch<{ data?: { workflowRun?: { currentStage?: string } | null } }>(
        `/api/tasks/${encodeURIComponent(task.id)}/workflow`,
        { authorization },
      ).then((result) => {
        const stageKey = result.ok ? result.data?.data?.workflowRun?.currentStage : undefined;
        if (stageKey) {
          taskStageMap.set(task.id, stageKey);
        }
      }),
    ),
  );

  return taskStageMap;
}

function mapProjectTaskGraphEdgeType(linkType: string) {
  if (linkType === "spawned") {
    return "spawned-from" as const;
  }

  return linkType === "depends-on" || linkType === "blocks" ? linkType : null;
}

function buildProjectTaskGraphEdges(links: ProjectTreeLinkRecord[], taskIds: Set<string>) {
  return links
    .filter(
      (link) =>
        taskIds.has(link.sourceNodeId) &&
        taskIds.has(link.targetNodeId) &&
        (link.linkType === "depends-on" ||
          link.linkType === "blocks" ||
          link.linkType === "spawned"),
    )
    .map((link) => {
      const edgeType = mapProjectTaskGraphEdgeType(link.linkType);
      if (!edgeType) {
        return null;
      }

      const relationSource = link.metadata?.relationSource;
      return {
        id: link.id,
        sourceTaskId: link.sourceNodeId,
        targetTaskId: link.targetNodeId,
        type: edgeType,
        source:
          relationSource === "system" || relationSource === "task-create"
            ? relationSource
            : "manual",
      } satisfies ProjectTaskGraphEdgeViewModel;
    })
    .filter((edge): edge is ProjectTaskGraphEdgeViewModel => Boolean(edge));
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

function selectProjectWorkflowTemplates(templates: WorkflowTemplateRecord[], projectId: string) {
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
  const bindingsByRoleId = await loadBindingsByRoleId(roleRows, args.projectId, args.authorization);
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

projectRoutes.delete("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Record<string, unknown>>(`/api/projects/${projectId}`, {
    method: "DELETE",
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

projectRoutes.get("/:projectId/fund", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<Record<string, unknown>>(`/api/projects/${projectId}/fund`, {
    authorization: authHeader(c),
  });

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 404 | 502));
});

projectRoutes.post("/:projectId/fund/grant", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/fund/grant`,
    {
      method: "POST",
      body,
      authorization: authHeader(c),
    },
  );

  return c.json(
    result.data,
    result.ok ? 201 : (result.status as 400 | 401 | 403 | 404 | 502),
  );
});

projectRoutes.post("/:projectId/fund/adjust", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/fund/adjust`,
    {
      method: "POST",
      body,
      authorization: authHeader(c),
    },
  );

  return c.json(
    result.data,
    result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502),
  );
});

projectRoutes.get("/:projectId/fund/ledger", async (c) => {
  const projectId = c.req.param("projectId");
  const search = new URLSearchParams();
  for (const key of ["limit", "cursor"]) {
    const value = c.req.query(key);
    if (value) {
      search.set(key, value);
    }
  }

  const suffix = search.toString() ? `?${search.toString()}` : "";
  const result = await cpFetch<Record<string, unknown>>(
    `/api/projects/${projectId}/fund/ledger${suffix}`,
    {
      authorization: authHeader(c),
    },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 403 | 404 | 502));
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

projectRoutes.get(":projectId/management-operations-view", async (c) => {
  const projectId = c.req.param("projectId");
  const authorization = authHeader(c);

  try {
    const result = await buildProjectManagementOperationsView(projectId, authorization);
    if (!result.ok) {
      return c.json(result.data, result.status as 401 | 403 | 404 | 502);
    }
    return c.json(result.data, 200);
  } catch (error) {
    return c.json(
      {
        message:
          error instanceof Error ? error.message : "Failed to build management operations view",
      },
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

projectRoutes.get("/:projectId/tree", async (c) => {
  const projectId = c.req.param("projectId");
  const authorization = authHeader(c);
  const search = new URL(c.req.url).searchParams;
  const params = new URLSearchParams();
  const depth = search.get("depth");
  const nodeType = search.get("nodeType");
  if (depth) params.set("depth", depth);
  if (nodeType) params.set("nodeType", nodeType);
  const suffix = params.toString() ? `?${params.toString()}` : "";

  const result = await cpFetch<{ data: ProjectTreeNodeRecord[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/tree${suffix}`,
    { authorization },
  );
  return c.json(result.data, result.status as 200 | 400 | 401 | 403 | 404 | 502);
});

projectRoutes.get("/:projectId/tree/:nodeId", async (c) => {
  const projectId = c.req.param("projectId");
  const nodeId = c.req.param("nodeId");
  const result = await cpFetch<ProjectTreeNodeRecord>(
    `/api/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}`,
    { authorization: authHeader(c) },
  );
  return c.json(result.data, result.status as 200 | 401 | 403 | 404 | 502);
});

projectRoutes.get("/:projectId/tree/:nodeId/children", async (c) => {
  const projectId = c.req.param("projectId");
  const nodeId = c.req.param("nodeId");
  const result = await cpFetch<{ data: ProjectTreeNodeRecord[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}/children`,
    { authorization: authHeader(c) },
  );
  return c.json(result.data, result.status as 200 | 401 | 403 | 404 | 502);
});

projectRoutes.post("/:projectId/tree/:nodeId/children", async (c) => {
  const projectId = c.req.param("projectId");
  const nodeId = c.req.param("nodeId");
  const body = await c.req.json().catch(() => ({}));
  const result = await cpFetch<ProjectTreeNodeRecord>(
    `/api/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}/children`,
    {
      method: "POST",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.status as 201 | 400 | 401 | 403 | 404 | 502);
});

projectRoutes.get("/:projectId/tree/:nodeId/ancestors", async (c) => {
  const projectId = c.req.param("projectId");
  const nodeId = c.req.param("nodeId");
  const result = await cpFetch<{ data: ProjectTreeNodeRecord[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}/ancestors`,
    { authorization: authHeader(c) },
  );
  return c.json(result.data, result.status as 200 | 401 | 403 | 404 | 502);
});

projectRoutes.get("/:projectId/branches", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<{ data: ProjectTreeBranchRecord[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches`,
    { authorization: authHeader(c) },
  );
  return c.json(result.data, result.status as 200 | 401 | 403 | 404 | 502);
});

projectRoutes.put("/:projectId/branches/:branchId", async (c) => {
  const projectId = c.req.param("projectId");
  const branchId = c.req.param("branchId");
  const body = await c.req.json().catch(() => ({}));
  const result = await cpFetch<ProjectTreeBranchRecord>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
    {
      method: "PUT",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.status as 200 | 400 | 401 | 403 | 404 | 502);
});

projectRoutes.get("/:projectId/tree/:nodeId/links", async (c) => {
  const projectId = c.req.param("projectId");
  const nodeId = c.req.param("nodeId");
  const result = await cpFetch<{ data: ProjectTreeLinkRecord[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}/links`,
    { authorization: authHeader(c) },
  );
  return c.json(result.data, result.status as 200 | 401 | 403 | 404 | 502);
});

projectRoutes.post("/:projectId/tree/:nodeId/links", async (c) => {
  const projectId = c.req.param("projectId");
  const nodeId = c.req.param("nodeId");
  const body = await c.req.json().catch(() => ({}));
  const result = await cpFetch<ProjectTreeLinkRecord>(
    `/api/projects/${encodeURIComponent(projectId)}/tree/${encodeURIComponent(nodeId)}/links`,
    {
      method: "POST",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.status as 200 | 201 | 400 | 401 | 403 | 404 | 502);
});

projectRoutes.get("/:projectId/links", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await cpFetch<{ data: ProjectTreeLinkRecord[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/links`,
    { authorization: authHeader(c) },
  );
  return c.json(result.data, result.status as 200 | 401 | 403 | 404 | 502);
});

projectRoutes.delete("/:projectId/links/:linkId", async (c) => {
  const projectId = c.req.param("projectId");
  const linkId = c.req.param("linkId");
  const result = await cpFetch<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/links/${encodeURIComponent(linkId)}`,
    {
      method: "DELETE",
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.status as 200 | 401 | 403 | 404 | 502);
});

// ── Execution Trace Types ─────────────────────────────────────────

interface ExecutionTraceSegment {
  type:
    | "user-input"
    | "workflow-context"
    | "hook-injection"
    | "hook-rewrite"
    | "final-prompt"
    | "model-response"
    | "tool-call"
    | "tool-output"
    | "thinking"
    | "file-reference"
    | "diff"
    | "candidate-result"
    | "judge-decision"
    | "chain-step-result"
    | "status-transition"
    | "session-activate"
    | "session-branch"
    | "session-archive";
  label: string;
  content: string;
  hookId?: string;
  hookTrigger?: string;
  hookAgent?: string;
  hookDecisionAction?: string;
  timestamp?: string;
  toolName?: string;
  toolArgumentsSummary?: string;
  toolStatus?: string;
  filePath?: string;
  fileRange?: string;
  diffSummary?: string;
}

interface TaskExecutionTrace {
  taskId: string;
  sessionId: string | null;
  segments: ExecutionTraceSegment[];
  timeline?: TaskSessionTimelineItem[];
  timelineMeta?: TaskSessionTimelineResponse["meta"];
  snapshot?: TaskProjectionSnapshotRecord | null;
  hookExecutions: Array<{
    hookId: string;
    trigger: string;
    status: string;
    agent: string;
    model?: string;
    prompt: string;
    result?: string;
    decision?: {
      action: string;
      reason?: string;
      rewrittenPrompt?: string;
      targetModel?: string;
    };
    completedAt: string;
  }>;
}

interface TaskSessionTimelineItem {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  completedAt?: string | null;
  raw?: unknown;
  sourceEventTypes?: string[];
}

interface TaskSessionTimelineResponse {
  data: TaskSessionTimelineItem[];
  meta?: {
    readSource?: TaskSessionTimelineMeta["readSource"];
    cacheState?: "none" | "partial" | "complete";
    complete?: boolean;
    includeLineage?: boolean;
    lineagePath?: string[];
    cachedSessionCount?: number;
    itemCount?: number;
  };
}

interface TaskProjectionSnapshotRecord {
  taskId: string;
  projectId: string;
  currentStatus: string;
  orchestrationKind?: string | null;
  currentRunId?: string | null;
  currentSessionId?: string | null;
  latestResult?: string | null;
  latestResultSummary?: string | null;
  latestErrorText?: string | null;
  activeCandidateCount: number;
  completedCandidateCount: number;
  failedCandidateCount: number;
  totalChainSteps: number;
  completedChainSteps: number;
  winnerNodeId?: string | null;
  lastActivityAt?: string | null;
  updatedAt: string;
}

interface TaskProjectionSnapshotResponseRecord {
  data: TaskProjectionSnapshotRecord | null;
  meta?: {
    readSource?: "task-domain-projection";
    complete?: boolean;
  };
}

interface TaskProjectionTimelineViewItemRecord {
  id: string;
  taskId: string;
  projectId: string;
  runId?: string | null;
  runNodeId?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  itemKind: string;
  itemRole?: string | null;
  title?: string | null;
  displayText?: string | null;
  metadataJson?: Record<string, unknown> | null;
  sortAt: string;
  createdAt: string;
}

interface TaskProjectionTimelineViewResponseRecord {
  data: TaskProjectionTimelineViewItemRecord[];
  meta?: TaskSessionTimelineResponse["meta"];
}

interface FullTaskRecord {
  id: string;
  projectId: string;
  sessionId?: string | null;
  strategy?: string | null;
  prompt: string;
  title: string;
  status: string;
  repoName?: string | null;
  workingBranch?: string | null;
}

function parseStrategyHookExecutions(
  strategyJson: string | null | undefined,
): HookExecutionRecord[] {
  if (!strategyJson) return [];
  try {
    const strategy = JSON.parse(strategyJson);
    if (Array.isArray(strategy?.hookExecutions)) {
      return strategy.hookExecutions as HookExecutionRecord[];
    }
    return [];
  } catch {
    return [];
  }
}

async function loadExecutionTraceTimeline(
  taskId: string,
  sessionId: string,
  authorization: string,
) {
  const timelineResult = await fetchTaskSessionTimeline(taskId, sessionId, authorization, {
    includeLineage: true,
  });

  if (!timelineResult.ok || !Array.isArray(timelineResult.data?.data)) {
    return null;
  }

  return {
    items: timelineResult.data.data,
    meta: {
      ...normalizeTaskSessionTimelineMeta(timelineResult.data.meta),
    },
    complete: timelineResult.data.meta?.cacheState === "complete",
  };
}

async function loadTaskProjectionSnapshot(taskId: string, authorization: string) {
  const result = await cpFetch<TaskProjectionSnapshotResponseRecord>(
    `/api/tasks/${encodeURIComponent(taskId)}/snapshot`,
    { authorization },
  );
  return result.ok ? (result.data?.data ?? null) : null;
}

function mapProjectionTimelineRole(item: TaskProjectionTimelineViewItemRecord) {
  if (item.itemKind === "user-input") return "user";
  if (item.itemKind === "assistant-output") return "assistant";
  if (item.itemKind === "tool-output" || item.itemKind === "tool-call") return "tool";
  return "system";
}

function mapProjectionItemKindToSegmentType(
  itemKind: TaskProjectionTimelineViewItemRecord["itemKind"],
): ExecutionTraceSegment["type"] | null {
  switch (itemKind) {
    case "tool-call":
    case "tool-output":
    case "thinking":
    case "file-reference":
    case "diff":
    case "candidate-result":
    case "judge-decision":
    case "chain-step-result":
    case "status-transition":
    case "session-activate":
    case "session-branch":
    case "session-archive":
      return itemKind;
    default:
      return null;
  }
}

function asProjectionRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asProjectionString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function buildProjectionFileRange(metadata: Record<string, unknown> | null) {
  if (!metadata) {
    return undefined;
  }

  const startLine = typeof metadata.startLine === "number" ? metadata.startLine : null;
  const endLine = typeof metadata.endLine === "number" ? metadata.endLine : null;
  if (startLine === null) {
    return undefined;
  }
  if (endLine !== null && endLine > startLine) {
    return `${startLine}-${endLine}`;
  }
  return String(startLine);
}

function buildProjectionTimelineSegment(
  item: TaskProjectionTimelineViewItemRecord,
): ExecutionTraceSegment | null {
  const type = mapProjectionItemKindToSegmentType(item.itemKind);
  if (!type) {
    return null;
  }

  const metadata = asProjectionRecord(item.metadataJson);
  const toolName = asProjectionString(metadata?.toolName);
  const toolArgumentsSummary = asProjectionString(metadata?.argumentsSummary);
  const toolStatus = asProjectionString(metadata?.status);
  const filePath = asProjectionString(metadata?.filePath);
  const diffSummary = asProjectionString(metadata?.diffSummary);
  const fileRange = buildProjectionFileRange(metadata);
  const segmentContent = resolveProjectionTimelineSegmentContent(item, type, metadata);
  const label = segmentContent.label;
  const content = segmentContent.content;

  if (!content) {
    return null;
  }

  return {
    type,
    label,
    content,
    timestamp: item.sortAt,
    toolName,
    toolArgumentsSummary,
    toolStatus,
    filePath,
    fileRange,
    diffSummary,
  } satisfies ExecutionTraceSegment;
}

function resolveProjectionTimelineSegmentContent(
  item: TaskProjectionTimelineViewItemRecord,
  type: ExecutionTraceSegment["type"],
  metadata: Record<string, unknown> | null,
) {
  const toolName = asProjectionString(metadata?.toolName);
  const toolArgumentsSummary = asProjectionString(metadata?.argumentsSummary);
  const filePath = asProjectionString(metadata?.filePath);
  const diffSummary = asProjectionString(metadata?.diffSummary);
  const baseLabel = item.title || item.itemKind;
  const baseContent = item.displayText || item.title || "";

  if (type === "tool-call") {
    return {
      label: toolName ? `工具调用 ${toolName}` : baseLabel,
      content: toolArgumentsSummary || baseContent,
    };
  }

  if (type === "tool-output") {
    return {
      label: toolName ? `工具输出 ${toolName}` : baseLabel,
      content: asProjectionString(metadata?.outputSummary) || baseContent,
    };
  }

  if (type === "file-reference") {
    return {
      label: baseLabel,
      content: asProjectionString(metadata?.locationSummary) || filePath || baseContent,
    };
  }

  if (type === "diff") {
    return { label: baseLabel, content: diffSummary || baseContent };
  }

  return { label: baseLabel, content: baseContent };
}

function buildProjectionTimelineSegments(items: TaskProjectionTimelineViewItemRecord[]) {
  return items
    .map((item) => buildProjectionTimelineSegment(item))
    .filter((segment): segment is ExecutionTraceSegment => Boolean(segment));
}

async function loadExecutionTraceProjectionTimeline(
  taskId: string,
  sessionId: string,
  authorization: string,
) {
  const persistedSessionId = toCanonicalTaskSessionId(taskId, sessionId);
  if (!persistedSessionId) {
    return null;
  }

  const result = await cpFetch<TaskProjectionTimelineViewResponseRecord>(
    `/api/tasks/${encodeURIComponent(taskId)}/timeline-view?sessionId=${encodeURIComponent(persistedSessionId)}`,
    { authorization },
  );
  if (!result.ok || !Array.isArray(result.data?.data)) {
    return null;
  }

  const items = result.data.data.map((item) => ({
    id: item.messageId || item.runNodeId || item.id,
    role: mapProjectionTimelineRole(item),
    text: item.displayText || item.title || "",
    createdAt: item.createdAt,
    completedAt: item.sortAt,
    raw: {
      projection: true,
      itemKind: item.itemKind,
      itemRole: item.itemRole,
      title: item.title,
      displayText: item.displayText,
      messageId: item.messageId,
      runId: item.runId,
      runNodeId: item.runNodeId,
      sessionId: item.sessionId,
      metadata: item.metadataJson ?? null,
    },
    sourceEventTypes: [`projection:${item.itemKind}`],
  }));

  return {
    rawItems: result.data.data,
    items,
    meta: createProjectionTraceTimelineMeta({
      meta: result.data.meta,
      itemCount: items.length,
    }),
    complete: result.data.meta?.complete === true && items.length > 0,
  };
}

async function buildTaskExecutionTrace(
  taskId: string,
  authorization: string,
): Promise<
  { ok: true; status: 200; data: TaskExecutionTrace } | { ok: false; status: number; data: unknown }
> {
  const taskResult = await cpFetch<FullTaskRecord>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );
  if (!taskResult.ok)
    return { ok: false as const, status: taskResult.status, data: taskResult.data };

  const task = taskResult.data;
  const snapshot = await loadTaskProjectionSnapshot(task.id, authorization);
  const hookExecutions = parseStrategyHookExecutions(task.strategy);
  const segments: ExecutionTraceSegment[] = [];
  const effectiveSessionId = task.sessionId || snapshot?.currentSessionId || null;

  segments.push(...buildExecutionTraceHookSegments(hookExecutions));

  const traceContext = await loadTaskExecutionTraceContext(
    task,
    effectiveSessionId,
    authorization,
    snapshot,
  );

  appendTaskExecutionTraceTimelineSegments(
    segments,
    traceContext.timeline,
    traceContext.projectionSegments,
  );

  return {
    ok: true,
    status: 200,
    data: {
      taskId: task.id,
      sessionId: effectiveSessionId,
      segments,
      timeline: traceContext.timeline,
      timelineMeta: traceContext.timelineMeta,
      snapshot,
      hookExecutions: hookExecutions.map(mapExecutionTraceHookExecution),
    },
  };
}

function buildExecutionTraceHookSegments(
  hookExecutions: ReturnType<typeof parseStrategyHookExecutions>,
) {
  const segments: ExecutionTraceSegment[] = [];

  for (const hook of hookExecutions) {
    if (hook.trigger !== "pre-execution") {
      continue;
    }

    segments.push({
      type: "hook-injection",
      label: `Hook: ${hook.hookId} (${hook.trigger})`,
      content: hook.prompt || "",
      hookId: hook.hookId,
      hookTrigger: hook.trigger,
      hookAgent: hook.agent,
      hookDecisionAction: hook.decision?.action,
      timestamp: hook.completedAt,
    });

    if (hook.decision?.action === "rewrite-prompt" && hook.decision.rewrittenPrompt) {
      segments.push({
        type: "hook-rewrite",
        label: `Hook 重写结果: ${hook.hookId}`,
        content: hook.decision.rewrittenPrompt,
        hookId: hook.hookId,
        hookTrigger: hook.trigger,
        hookAgent: hook.agent,
        hookDecisionAction: hook.decision.action,
        timestamp: hook.completedAt,
      });
    }
  }

  return segments;
}

async function loadTaskExecutionTraceContext(
  task: FullTaskRecord,
  effectiveSessionId: string | null,
  authorization: string,
  snapshot: TaskProjectionSnapshotRecord | null,
) {
  let timeline: TaskSessionTimelineItem[] = [];
  let timelineMeta: TaskSessionTimelineResponse["meta"] | undefined;
  let projectionSegments: ExecutionTraceSegment[] = [];

  if (effectiveSessionId) {
    const projectionItems = await loadExecutionTraceProjectionTimeline(
      task.id,
      effectiveSessionId,
      authorization,
    );

    if (projectionItems) {
      timeline = projectionItems.items;
      timelineMeta = projectionItems.meta;
      projectionSegments = buildProjectionTimelineSegments(projectionItems.rawItems);
    }

    const timelineItems = shouldLoadProjectExecutionTraceTimelineFallback(
      projectionItems,
      timeline,
      snapshot,
    )
      ? await loadExecutionTraceTimeline(task.id, effectiveSessionId, authorization)
      : null;

    if (
      timelineItems &&
      shouldReplaceTraceTimeline({
        currentItemCount: timeline.length,
        fallbackItemCount: timelineItems.items.length,
        projectionComplete: projectionItems?.complete,
      })
    ) {
      timeline = timelineItems.items;
      timelineMeta = timelineItems.meta;
    }
  }

  return {
    timeline,
    timelineMeta,
    projectionSegments,
  };
}

function shouldLoadProjectExecutionTraceTimelineFallback(
  projectionItems: Awaited<ReturnType<typeof loadExecutionTraceProjectionTimeline>>,
  timeline: TaskSessionTimelineItem[],
  snapshot: TaskProjectionSnapshotRecord | null,
) {
  void projectionItems;

  // Project-level execution trace follows the same fallback rule as task trace:
  // when projection has no displayable conversation timeline and snapshot has no
  // latestResult shortcut, fall back to the persisted session timeline.
  return timeline.length === 0 && !snapshot?.latestResult;
}

function appendTaskExecutionTraceTimelineSegments(
  segments: ExecutionTraceSegment[],
  timeline: TaskSessionTimelineItem[],
  projectionSegments: ExecutionTraceSegment[],
) {
  if (timeline.length === 0) {
    return;
  }

  appendTaskExecutionTraceLastUserSegment(segments, timeline);
  appendTaskExecutionTraceLastAssistantSegment(segments, timeline);
  if (projectionSegments.length > 0) {
    segments.push(...projectionSegments);
  }
}

function appendTaskExecutionTraceLastUserSegment(
  segments: ExecutionTraceSegment[],
  timeline: TaskSessionTimelineItem[],
) {
  const userMessages = timeline.filter((item) => item.role === "user" && item.text);
  if (userMessages.length > 0) {
    segments.push({
      type: "final-prompt",
      label: "最终发送给模型的 Prompt",
      content: userMessages[userMessages.length - 1]?.text || "",
    });
  }
}

function appendTaskExecutionTraceLastAssistantSegment(
  segments: ExecutionTraceSegment[],
  timeline: TaskSessionTimelineItem[],
) {
  const assistantMessages = timeline.filter((item) => item.role === "assistant" && item.text);
  if (assistantMessages.length > 0) {
    segments.push({
      type: "model-response",
      label: "模型回复",
      content: assistantMessages[assistantMessages.length - 1]?.text || "",
    });
  }
}

function mapExecutionTraceHookExecution(
  hook: ReturnType<typeof parseStrategyHookExecutions>[number],
) {
  return {
    hookId: hook.hookId,
    trigger: hook.trigger,
    status: hook.status,
    agent: hook.agent,
    model: hook.model,
    prompt: hook.prompt,
    result: hook.result,
    decision: hook.decision
      ? {
          action: hook.decision.action,
          reason: hook.decision.reason,
          rewrittenPrompt: hook.decision.rewrittenPrompt,
          targetModel: hook.decision.targetModel,
        }
      : undefined,
    completedAt: hook.completedAt,
  };
}

// GET /api/projects/:projectId/task-execution-trace/:taskId
projectRoutes.get("/:projectId/task-execution-trace/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);

  try {
    const result = await buildTaskExecutionTrace(taskId, authorization);
    if (!result.ok) {
      return c.json(result.data, result.status as 401 | 403 | 404 | 502);
    }
    return c.json(result.data, 200);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Failed to build execution trace" },
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
