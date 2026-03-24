import { cpFetch } from "../../lib/control-plane-client";
import { runDetachedPrompt } from "../agent-control/opencode-adapter";
import { fetchTaskWorkflowResources } from "./workflow-view";

interface TaskRecord {
  id: string;
  title: string;
  prompt: string;
  projectId: string;
  result?: string | null;
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
  entryCriteriaJson?: string[] | null;
  exitCriteriaJson?: string[] | null;
  hooksJson?: Array<Record<string, unknown>> | null;
  gatesJson?: Array<Record<string, unknown>> | null;
  approvalsJson?: Array<Record<string, unknown>> | null;
}

interface TaskWorkflowStageRecord {
  id: string;
  stageKey: string;
  status: string;
}

interface RoleConclusionPayload {
  id?: string;
  roleAgentId?: string | null;
  stage?: string | null;
  finalDecision?: ParsedRoleDecision["finalDecision"] | null;
  aggregateRiskLevel?: ParsedRoleDecision["aggregateRiskLevel"] | null;
  winningRationale?: string | null;
  approvalRecommendation?: {
    required?: boolean;
  } | null;
}

interface DeveloperChangeRequestPayload {
  id?: string;
  sourceRoleAgentId?: string | null;
  title?: string | null;
}

interface ResolvedRoleAgentResult {
  role: {
    id: string;
    name: string;
    status: "active" | "disabled" | "deprecated";
    riskLevel: "low" | "medium" | "high" | "critical";
    defaultExecutionMode: "single" | "parallel-review" | "round-robin";
    requiresApprovalForWrite: boolean;
    aggregationPolicy?: {
      strategy: "first-pass" | "majority" | "merge-summary" | "human-review";
      maxActiveBindings?: number;
      requireConsensus?: boolean;
    };
    bindings: Array<{
      bindingId: string;
      runtimeAgent: string;
      label: string;
      priority: number;
      model?: string | null;
    }>;
  };
  validation: {
    executable: boolean;
    reasons: string[];
  };
}

interface ParsedRoleDecision {
  finalDecision:
    | "allow"
    | "notify-developer"
    | "needs-approval"
    | "block"
    | "observe"
    | "human-review";
  aggregateRiskLevel: "low" | "medium" | "high" | "critical";
  winningRationale: string;
  summary: string;
  requiredChanges: string[];
  mergedFindings: Array<Record<string, unknown>>;
  approvalRequired: boolean;
  confidenceScore: number;
}

interface RoleExecutionRecord {
  bindingId: string;
  bindingLabel: string;
  runtimeAgent: string;
  text: string;
  parsed: ParsedRoleDecision;
}

interface StageInterventionInput {
  authorization: string;
  taskId: string;
  templateId: string;
  stageKey: string;
}

export interface StageInterventionResult {
  disposition: "continue" | "blocked" | "waiting-approval";
  decision: ParsedRoleDecision["finalDecision"] | null;
  reason?: string;
  blockingReason?: string;
}

const DECISION_WEIGHT: Record<ParsedRoleDecision["finalDecision"], number> = {
  allow: 0,
  observe: 1,
  "notify-developer": 2,
  "needs-approval": 3,
  "human-review": 4,
  block: 5,
};

const RISK_WEIGHT: Record<ParsedRoleDecision["aggregateRiskLevel"], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function stageLabelFromKey(stageKey: string) {
  switch (stageKey) {
    case "clarify":
      return "需求澄清";
    case "design":
      return "方案设计";
    case "implement":
      return "实现开发";
    case "verify":
      return "集成验证";
    case "release":
      return "发布执行";
    default:
      return stageKey;
  }
}

function clampScore(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function normalizeDecision(value: unknown): ParsedRoleDecision["finalDecision"] {
  switch (value) {
    case "allow":
    case "notify-developer":
    case "needs-approval":
    case "block":
    case "observe":
    case "human-review":
      return value;
    default:
      return "observe";
  }
}

function normalizeRisk(value: unknown): ParsedRoleDecision["aggregateRiskLevel"] {
  switch (value) {
    case "low":
    case "medium":
    case "high":
    case "critical":
      return value;
    default:
      return "medium";
  }
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildFallbackRoleDecision(
  text: string,
  finalDecision: ParsedRoleDecision["finalDecision"],
  aggregateRiskLevel: ParsedRoleDecision["aggregateRiskLevel"],
  requiredChanges: string[] = [],
  approvalRequired = false,
): ParsedRoleDecision {
  return {
    finalDecision,
    aggregateRiskLevel,
    winningRationale: text.trim() || "未提供说明。",
    summary: text.trim() || "未提供摘要。",
    requiredChanges,
    mergedFindings: [],
    approvalRequired,
    confidenceScore: 0.5,
  };
}

function parseJsonRoleDecision(payload: Record<string, unknown>, text: string): ParsedRoleDecision {
  const winningRationale =
    (typeof payload.winningRationale === "string" && payload.winningRationale.trim()) ||
    (typeof payload.summary === "string" && payload.summary.trim()) ||
    text.trim() ||
    "未提供说明。";
  const summary =
    (typeof payload.summary === "string" && payload.summary.trim()) ||
    (typeof payload.winningRationale === "string" && payload.winningRationale.trim()) ||
    text.trim() ||
    "未提供摘要。";

  return {
    finalDecision: normalizeDecision(payload.finalDecision),
    aggregateRiskLevel: normalizeRisk(payload.aggregateRiskLevel),
    winningRationale,
    summary,
    requiredChanges: Array.isArray(payload.requiredChanges)
      ? payload.requiredChanges.map((item) => String(item)).filter(Boolean)
      : [],
    mergedFindings: Array.isArray(payload.mergedFindings)
      ? (payload.mergedFindings.filter((item) => item && typeof item === "object") as Array<
          Record<string, unknown>
        >)
      : [],
    approvalRequired: Boolean(payload.approvalRequired),
    confidenceScore: clampScore(payload.confidenceScore, 0.7),
  };
}

function matchFallbackRoleDecision(text: string) {
  const lowered = text.toLowerCase();

  if (lowered.includes("block") || lowered.includes("阻断")) {
    return buildFallbackRoleDecision(text, "block", "high");
  }
  if (lowered.includes("approval") || lowered.includes("审批")) {
    return buildFallbackRoleDecision(text, "needs-approval", "medium", [], true);
  }
  if (lowered.includes("change") || lowered.includes("修改") || lowered.includes("fix")) {
    return buildFallbackRoleDecision(text, "notify-developer", "medium", [
      text.trim() || "请根据角色建议调整当前阶段产出。",
    ]);
  }

  return buildFallbackRoleDecision(text, "allow", "low");
}

function parseRoleDecision(text: string): ParsedRoleDecision {
  const payload = extractJsonObject(text);
  if (payload) {
    return parseJsonRoleDecision(payload, text);
  }

  return matchFallbackRoleDecision(text);
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function summarizeStageIntervention(conclusions: RoleConclusionPayload[]): StageInterventionResult {
  const dominant = [...conclusions]
    .filter((item) => Boolean(item.finalDecision))
    .sort((left, right) => {
      const leftDecision = left.finalDecision || "observe";
      const rightDecision = right.finalDecision || "observe";
      const decisionGap = DECISION_WEIGHT[rightDecision] - DECISION_WEIGHT[leftDecision];
      if (decisionGap !== 0) {
        return decisionGap;
      }

      const leftRisk = left.aggregateRiskLevel || "low";
      const rightRisk = right.aggregateRiskLevel || "low";
      return RISK_WEIGHT[rightRisk] - RISK_WEIGHT[leftRisk];
    })[0];

  if (!dominant?.finalDecision) {
    return {
      disposition: "continue",
      decision: null,
    };
  }

  const dominantReason = dominant.winningRationale?.trim() || "角色审查已完成。";

  if (dominant.finalDecision === "block") {
    return {
      disposition: "blocked",
      decision: dominant.finalDecision,
      reason: dominantReason,
      blockingReason: dominantReason || "角色审查阻断当前阶段。",
    };
  }

  if (dominant.finalDecision === "needs-approval" || dominant.finalDecision === "human-review") {
    return {
      disposition: "waiting-approval",
      decision: dominant.finalDecision,
      reason: dominantReason,
    };
  }

  return {
    disposition: "continue",
    decision: dominant.finalDecision,
    reason: dominantReason,
  };
}

function pickDominantDecision(values: RoleExecutionRecord[]) {
  return [...values].sort((left, right) => {
    const decisionGap =
      DECISION_WEIGHT[right.parsed.finalDecision] - DECISION_WEIGHT[left.parsed.finalDecision];
    if (decisionGap !== 0) {
      return decisionGap;
    }
    return (
      RISK_WEIGHT[right.parsed.aggregateRiskLevel] - RISK_WEIGHT[left.parsed.aggregateRiskLevel]
    );
  })[0]?.parsed;
}

function aggregateRoleExecutions(
  role: ResolvedRoleAgentResult["role"],
  stageKey: string,
  executions: RoleExecutionRecord[],
): ParsedRoleDecision & {
  status: "aligned" | "partially-aligned" | "conflicted" | "escalated" | "blocked";
  consensusScore: number;
  conflicts: Array<Record<string, unknown>>;
} {
  const dominant = pickDominantDecision(executions) || {
    finalDecision: "observe" as const,
    aggregateRiskLevel: role.riskLevel,
    winningRationale: `${role.name} 在 ${stageKey} 阶段未返回可解析结论。`,
    summary: `${role.name} 在 ${stageKey} 阶段未返回可解析结论。`,
    requiredChanges: [],
    mergedFindings: [],
    approvalRequired: false,
    confidenceScore: 0,
  };
  const decisionHistogram = new Map<string, number>();
  for (const execution of executions) {
    const key = execution.parsed.finalDecision;
    decisionHistogram.set(key, (decisionHistogram.get(key) || 0) + 1);
  }
  const topBucket = Math.max(...decisionHistogram.values(), 0);
  const consensusScore = executions.length > 0 ? topBucket / executions.length : 0;
  const conflicts =
    executions.length > 1 && decisionHistogram.size > 1
      ? executions.map((execution) => ({
          type: "binding-decision-mismatch",
          severity: execution.parsed.aggregateRiskLevel,
          summary: `${execution.bindingLabel} 给出 ${execution.parsed.finalDecision}。`,
        }))
      : [];

  const finalDecision = dominant.finalDecision;
  let status: "aligned" | "partially-aligned" | "conflicted" | "escalated" | "blocked" = "aligned";
  if (finalDecision === "block") {
    status = "blocked";
  } else if (finalDecision === "needs-approval" || finalDecision === "human-review") {
    status = "escalated";
  } else if (conflicts.length > 0) {
    status = consensusScore >= 0.5 ? "partially-aligned" : "conflicted";
  }

  return {
    ...dominant,
    aggregateRiskLevel: executions.reduce<ParsedRoleDecision["aggregateRiskLevel"]>(
      (current, execution) =>
        RISK_WEIGHT[execution.parsed.aggregateRiskLevel] > RISK_WEIGHT[current]
          ? execution.parsed.aggregateRiskLevel
          : current,
      dominant.aggregateRiskLevel,
    ),
    summary: dedupeStrings(executions.map((execution) => execution.parsed.summary)).join("\n"),
    winningRationale: dominant.winningRationale,
    requiredChanges: dedupeStrings(
      executions.flatMap((execution) => execution.parsed.requiredChanges),
    ),
    mergedFindings: executions.flatMap((execution) => execution.parsed.mergedFindings),
    approvalRequired: Boolean(
      role.requiresApprovalForWrite ||
        dominant.approvalRequired ||
        finalDecision === "needs-approval",
    ),
    confidenceScore:
      executions.length > 0
        ? executions.reduce((sum, execution) => sum + execution.parsed.confidenceScore, 0) /
          executions.length
        : 0,
    consensusScore,
    conflicts,
    status,
  };
}

function buildRolePrompt(input: {
  task: TaskRecord;
  stage: WorkflowTemplateStageRecord;
  role: ResolvedRoleAgentResult["role"];
  stageStatus: string;
}) {
  const entryCriteria = (input.stage.entryCriteriaJson || []).join("; ");
  const exitCriteria = (input.stage.exitCriteriaJson || []).join("; ");
  const resultSummary = input.task.result?.trim()
    ? `\n任务当前结果摘要：${input.task.result.trim()}`
    : "";
  return [
    `你当前作为 ${input.role.name} 参与 Opener-X 工作流阶段审查。`,
    `任务标题：${input.task.title}`,
    `任务说明：${input.task.prompt}`,
    `阶段：${input.stage.name} (${input.stage.stageKey})，当前状态 ${input.stageStatus}`,
    entryCriteria ? `进入条件：${entryCriteria}` : "",
    exitCriteria ? `退出条件：${exitCriteria}` : "",
    resultSummary,
    "请只返回一个 JSON 对象，不要输出额外解释。",
    "JSON 字段要求：finalDecision, aggregateRiskLevel, winningRationale, summary, requiredChanges, mergedFindings, approvalRequired, confidenceScore。",
    "finalDecision 只能是 allow, notify-developer, needs-approval, block, observe, human-review。",
    "aggregateRiskLevel 只能是 low, medium, high, critical。",
    "requiredChanges 必须是字符串数组；没有时返回空数组。",
    "mergedFindings 必须是对象数组；没有时返回空数组。",
  ]
    .filter(Boolean)
    .join("\n");
}

async function fetchTemplateStage(authorization: string, templateId: string, stageKey: string) {
  const result = await cpFetch<{ data?: WorkflowTemplateStageRecord[] }>(
    `/api/workflow-templates/${encodeURIComponent(templateId)}/stages`,
    { authorization },
  );
  if (!result.ok) {
    return null;
  }
  return (result.data?.data || []).find((stage) => stage.stageKey === stageKey) || null;
}

async function resolveRoleExecution(
  authorization: string,
  roleAgentId: string,
  projectId: string,
  templateId: string,
  stageKey: string,
) {
  const params = new URLSearchParams({
    projectId,
    templateId,
    stage: stageKey,
  });
  const result = await cpFetch<{ data?: ResolvedRoleAgentResult }>(
    `/api/role-agents/${encodeURIComponent(roleAgentId)}/resolve?${params.toString()}`,
    { authorization },
  );
  return result.ok ? result.data?.data || null : null;
}

function collectStageRoleIds(stage: WorkflowTemplateStageRecord) {
  const roleIds = new Set<string>();
  if (stage.primaryRoleAgentId) {
    roleIds.add(stage.primaryRoleAgentId);
  }
  for (const roleId of stage.participantRoleAgentIdsJson || []) {
    if (roleId) {
      roleIds.add(roleId);
    }
  }
  for (const gate of stage.gatesJson || []) {
    if (typeof gate?.evaluatorRole === "string" && gate.evaluatorRole.trim()) {
      roleIds.add(gate.evaluatorRole.trim());
    }
  }
  for (const approval of stage.approvalsJson || []) {
    if (typeof approval?.approverRole === "string" && approval.approverRole.trim()) {
      roleIds.add(approval.approverRole.trim());
    }
  }
  return Array.from(roleIds);
}

async function executeRoleBindings(input: {
  task: TaskRecord;
  stage: WorkflowTemplateStageRecord;
  role: ResolvedRoleAgentResult["role"];
  stageStatus: string;
}) {
  const bindings =
    input.role.defaultExecutionMode === "parallel-review"
      ? input.role.bindings
      : input.role.bindings.slice(0, 1);

  const executions = await Promise.all(
    bindings.map(async (binding) => {
      const prompt = buildRolePrompt({
        task: input.task,
        stage: input.stage,
        role: input.role,
        stageStatus: input.stageStatus,
      });
      const result = await runDetachedPrompt(
        `[${input.stage.stageKey}] ${input.role.name} / ${input.task.title}`,
        prompt,
        {
          agent: binding.runtimeAgent,
          model: binding.model
            ? (() => {
                const index = binding.model.indexOf(":");
                return index > 0
                  ? {
                      providerId: binding.model.slice(0, index),
                      modelId: binding.model.slice(index + 1),
                    }
                  : undefined;
              })()
            : undefined,
          taskId: input.task.id,
          projectId: input.task.projectId,
          timeoutMs: 10_000,
        },
      );

      const text =
        typeof result.text === "string" && result.text.trim()
          ? result.text.trim()
          : result.error || "未返回内容";

      return {
        bindingId: binding.bindingId,
        bindingLabel: binding.label,
        runtimeAgent: binding.runtimeAgent,
        text,
        parsed: parseRoleDecision(text),
      } satisfies RoleExecutionRecord;
    }),
  );

  return executions;
}

async function persistRoleConclusion(input: {
  authorization: string;
  taskId: string;
  role: ResolvedRoleAgentResult["role"];
  stageKey: string;
  execution: ReturnType<typeof aggregateRoleExecutions>;
}) {
  await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}/role-conclusions`, {
    method: "POST",
    authorization: input.authorization,
    body: {
      roleAgentId: input.role.id,
      stage: input.stageKey,
      aggregationStrategy: input.role.aggregationPolicy?.strategy || "first-pass",
      status: input.execution.status,
      finalDecision: input.execution.finalDecision,
      aggregateRiskLevel: input.execution.aggregateRiskLevel,
      confidenceScore: input.execution.confidenceScore,
      consensusScore: input.execution.consensusScore,
      winningRationale: input.execution.winningRationale,
      mergedFindings: input.execution.mergedFindings,
      conflicts: input.execution.conflicts,
      approvalRecommendation: {
        required: input.execution.approvalRequired,
      },
    },
  });
}

async function persistDeveloperChangeRequest(input: {
  authorization: string;
  taskId: string;
  role: ResolvedRoleAgentResult["role"];
  stageKey: string;
  stageRunId?: string;
  execution: ReturnType<typeof aggregateRoleExecutions>;
  existingRequests: DeveloperChangeRequestPayload[];
}) {
  const title = `${stageLabelFromKey(input.stageKey)} · ${input.role.name} 修正请求`;
  const duplicate = input.existingRequests.some(
    (request) => request.sourceRoleAgentId === input.role.id && request.title === title,
  );
  if (duplicate) {
    return;
  }

  if (
    input.execution.finalDecision !== "notify-developer" &&
    input.execution.finalDecision !== "needs-approval" &&
    input.execution.finalDecision !== "block"
  ) {
    return;
  }

  const requiredChanges =
    input.execution.requiredChanges.length > 0
      ? input.execution.requiredChanges
      : [input.execution.summary || `${input.role.name} 对 ${input.stageKey} 阶段提出修正建议。`];

  await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}/developer-change-requests`, {
    method: "POST",
    authorization: input.authorization,
    body: {
      taskStageRunId: input.stageRunId,
      sourceRoleAgentId: input.role.id,
      priority:
        input.execution.aggregateRiskLevel === "critical"
          ? "critical"
          : input.execution.aggregateRiskLevel === "high"
            ? "high"
            : "medium",
      title,
      summary: input.execution.summary,
      requiredChanges,
      blocking: input.execution.finalDecision === "block",
      approvalRequired: input.execution.approvalRequired,
    },
  });
}

function buildSyntheticInterventionConclusion(resolved: ResolvedRoleAgentResult) {
  return {
    finalDecision: "human-review" as const,
    aggregateRiskLevel: resolved.role.riskLevel === "low" ? "medium" : resolved.role.riskLevel,
    winningRationale: `未执行 ${resolved.role.name}：${resolved.validation.reasons.join("; ") || "缺少可用 binding"}`,
    summary: `未执行 ${resolved.role.name}：${resolved.validation.reasons.join("; ") || "缺少可用 binding"}`,
    requiredChanges: [],
    mergedFindings: [],
    approvalRequired: false,
    confidenceScore: 0,
    consensusScore: 0,
    conflicts: [],
    status: "escalated" as const,
  };
}

function appendStageConclusion(
  stageConclusions: RoleConclusionPayload[],
  roleId: string,
  stageKey: string,
  decision: {
    finalDecision: ParsedRoleDecision["finalDecision"];
    aggregateRiskLevel: ParsedRoleDecision["aggregateRiskLevel"];
    winningRationale: string;
    approvalRequired: boolean;
  },
) {
  stageConclusions.push({
    roleAgentId: roleId,
    stage: stageKey,
    finalDecision: decision.finalDecision,
    aggregateRiskLevel: decision.aggregateRiskLevel,
    winningRationale: decision.winningRationale,
    approvalRecommendation: {
      required: decision.approvalRequired,
    },
  });
}

async function processStageRoleIntervention(input: {
  authorization: string;
  task: TaskRecord;
  templateId: string;
  stageKey: string;
  stage: WorkflowTemplateStageRecord;
  stageStatus: string;
  stageRunId?: string;
  roleAgentId: string;
  existingRequests: DeveloperChangeRequestPayload[];
  stageConclusions: RoleConclusionPayload[];
}) {
  const resolved = await resolveRoleExecution(
    input.authorization,
    input.roleAgentId,
    input.task.projectId,
    input.templateId,
    input.stageKey,
  );
  if (!resolved) {
    return;
  }

  if (!resolved.validation.executable || resolved.role.bindings.length === 0) {
    const synthetic = buildSyntheticInterventionConclusion(resolved);
    await persistRoleConclusion({
      authorization: input.authorization,
      taskId: input.task.id,
      role: resolved.role,
      stageKey: input.stageKey,
      execution: synthetic,
    });
    appendStageConclusion(input.stageConclusions, resolved.role.id, input.stageKey, synthetic);
    return;
  }

  const executions = await executeRoleBindings({
    task: input.task,
    stage: input.stage,
    role: resolved.role,
    stageStatus: input.stageStatus,
  });
  const aggregate = aggregateRoleExecutions(resolved.role, input.stageKey, executions);
  await persistRoleConclusion({
    authorization: input.authorization,
    taskId: input.task.id,
    role: resolved.role,
    stageKey: input.stageKey,
    execution: aggregate,
  });
  appendStageConclusion(input.stageConclusions, resolved.role.id, input.stageKey, aggregate);
  await persistDeveloperChangeRequest({
    authorization: input.authorization,
    taskId: input.task.id,
    role: resolved.role,
    stageKey: input.stageKey,
    stageRunId: input.stageRunId,
    execution: aggregate,
    existingRequests: input.existingRequests,
  });
}

export async function dispatchStageIntervention(
  input: StageInterventionInput,
): Promise<StageInterventionResult> {
  const [taskResources, stage] = await Promise.all([
    fetchTaskWorkflowResources({
      taskId: input.taskId,
      authorization: input.authorization,
      includeTask: true,
    }),
    fetchTemplateStage(input.authorization, input.templateId, input.stageKey),
  ]);

  const task =
    taskResources.task?.id &&
    taskResources.task?.title &&
    taskResources.task?.prompt &&
    taskResources.task?.projectId
      ? {
          id: taskResources.task.id,
          title: taskResources.task.title,
          prompt: taskResources.task.prompt,
          projectId: taskResources.task.projectId,
          result: taskResources.task.result ?? null,
        }
      : null;
  const workflowStages = taskResources.stages as TaskWorkflowStageRecord[];
  const existingConclusions = taskResources.conclusions as RoleConclusionPayload[];
  const existingRequests = taskResources.requests as DeveloperChangeRequestPayload[];

  if (!task || !stage || !task.projectId) {
    return {
      disposition: "continue",
      decision: null,
    };
  }

  const stageRunId = workflowStages.find((entry) => entry.stageKey === input.stageKey)?.id;
  const stageStatus =
    workflowStages.find((entry) => entry.stageKey === input.stageKey)?.status || "running";
  const involvedRoles = collectStageRoleIds(stage);
  const stageConclusions = existingConclusions.filter((item) => item.stage === input.stageKey);

  for (const roleAgentId of involvedRoles) {
    const alreadyExists = existingConclusions.some(
      (item) => item.roleAgentId === roleAgentId && item.stage === input.stageKey,
    );
    if (alreadyExists) {
      continue;
    }

    await processStageRoleIntervention({
      authorization: input.authorization,
      task,
      templateId: input.templateId,
      stageKey: input.stageKey,
      stage,
      stageStatus,
      stageRunId,
      roleAgentId,
      existingRequests,
      stageConclusions,
    });
  }

  return summarizeStageIntervention(stageConclusions);
}
