import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { authHeader, cpFetch } from "../../lib/control-plane-client";
import { classifyIntent } from "../../lib/intent-classifier";
import {
  diagnoseModelReadiness,
  readDefaultExecutionModel,
  resolveModelRoute,
  validateModelProvider,
} from "../../lib/opencode-config";
import {
  RUNTIME_RECOVERY_ERROR_CODES,
  RUNTIME_RECOVERY_SUGGESTION_IDS,
  RUNTIME_RECOVERY_SUGGESTION_KINDS,
  type RuntimeRecoverySuggestion,
} from "../../lib/runtime-recovery-contract";
import {
  DEFAULT_EXECUTION_AGENT,
  type ExecutionPlan,
  type HookExecutionRecord,
  buildExecutionPlan,
  mergeTaskStrategy,
  readOrchestrationStrategy,
  resolveWorkflowTemplate,
} from "../../lib/orchestration-strategy";
import { buildRuntimePipeline } from "../../lib/runtime-pipeline";
import type { JWTPayload } from "../../middleware/auth";
import {
  continueSession,
  createSession,
  ensureAgentRunForSession,
  forkSession,
  getSessionMessages,
  listSessions,
} from "../agent-control/opencode-adapter";
import { createAgentRunRecord } from "../agent-control/run-persistence";
import { executeLifecycleHooks } from "../hooks/lifecycle-hooks";
import { syncGraphsForSessionTask, syncGraphsForTask } from "../realtime/dag-sync";
import { buildPipelineStageUpdatedEvents } from "../realtime/pipeline-events";
import { sseAggregator } from "../realtime/sse-aggregator";
import { wsBroadcaster } from "../realtime/ws-broadcaster";
import { reconcileRunningTasksOnStartup } from "./reconcile";

// ── Task Routes (BFF) ──────────────────────────────────────────────

type AppEnv = { Variables: { user: JWTPayload } };

export const taskRoutes = new Hono<AppEnv>();

type IntentClassification = ReturnType<typeof classifyIntent>;
type ResolvedModel = { providerId: string; modelId: string };
type SessionStartResult = Awaited<ReturnType<typeof createSession>>;

interface StartExecutionResponse {
  status: 200 | 502;
  body: Record<string, unknown>;
}

interface SessionSummaryRecord {
  id: string;
  title: string;
  isActive: boolean;
  summary: { additions: number; deletions: number; files: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
}

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
  sourceRoleAgentId?: string | null;
  priority?: string | null;
  title?: string | null;
  summary?: string | null;
  requiredChanges?: string[] | null;
  blocking?: boolean | null;
  approvalRequired?: boolean | null;
  status?: string | null;
}

interface WorkflowViewModel {
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
    priority: string;
    title: string;
    summary: string;
    requiredChanges: string[];
    blocking: boolean;
    approvalRequired: boolean;
    status: string;
  }>;
}

interface ExecutableTask {
  id: string;
  prompt: string;
  status: string;
  projectId: string;
  title: string;
  selectedModel?: string | null;
  repoId?: string | null;
  repoName?: string | null;
  remoteUrl?: string | null;
  workingBranch?: string | null;
  credentialId?: string | null;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
}

type IdentitySnapshot = Record<string, unknown>;

interface PreparedExecutionContext {
  task: ExecutableTask;
  authorization: string;
  identitySnapshot: IdentitySnapshot;
  classification: IntentClassification;
  executionAgent: string;
  plan: ExecutionPlan;
  repoContext: ReturnType<typeof buildRepoContext>;
  resolvedModel?: ResolvedModel;
  effectiveModel?: string;
}

interface ExecutionContext extends PreparedExecutionContext {
  prompt: string;
  hookExecutions: HookExecutionRecord[];
}

interface ParallelCandidateAttempt {
  index: number;
  sessionResult?: SessionStartResult;
}

function requireSystemAdmin(user: JWTPayload): string | null {
  if (user.role === "platform_admin" || user.role === "org_admin" || user.role === "admin") {
    return null;
  }
  return "Requires org_admin role";
}

async function recordManualReconcileAudit(
  authorization: string,
  user: JWTPayload,
  summary: Awaited<ReturnType<typeof reconcileRunningTasksOnStartup>>,
) {
  const result = await cpFetch("/api/audit", {
    method: "POST",
    authorization,
    body: {
      eventType: "task.running.reconciled",
      action: "manual_reconcile_running_tasks",
      target: "running_tasks",
      detail: {
        triggeredByRole: user.role,
        scanned: summary.scanned,
        completed: summary.completed,
        failed: summary.failed,
        recovered: summary.recovered,
        skipped: summary.skipped,
        runtimeAvailable: summary.runtimeAvailable,
      },
      riskLevel: "medium",
    },
  });

  if (!result.ok) {
    console.warn(
      `[reconcile] audit write failed status=${result.status} user=${user.sub} action=manual_reconcile_running_tasks`,
    );
  }
}

async function fetchExecutableTask(taskId: string, authorization: string) {
  return cpFetch<ExecutableTask>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    authorization,
  });
}

async function resolveExecutionIdentity(task: ExecutableTask, authorization: string) {
  if (!task.repoId || task.gitAuthorName) {
    return {} satisfies IdentitySnapshot;
  }

  const credResult = await resolveIdentity(
    task.projectId,
    task.repoId,
    task.credentialId ?? undefined,
    authorization,
  );
  return credResult ?? ({} satisfies IdentitySnapshot);
}

function selectExecutionAgent(prompt: string) {
  const strategy = readOrchestrationStrategy();
  const classification = classifyIntent(prompt);
  const configuredAgents = strategy.categoryAgentMap[classification.category] || [];
  const suggestedAgents =
    configuredAgents.length > 0 ? configuredAgents : classification.suggestedAgents;

  // Resolve template and build execution plan
  const template = resolveWorkflowTemplate(strategy, classification.category);
  const plan = buildExecutionPlan(template, strategy, classification.category);

  // For single mode, the execution agent is the sole candidate
  const executionAgent = plan.candidates[0]?.agent || suggestedAgents[0] || DEFAULT_EXECUTION_AGENT;

  return {
    classification: {
      ...classification,
      suggestedAgents,
    },
    executionAgent,
    strategy,
    plan,
  };
}

/**
 * Resolve the model to use for execution.
 * Priority: task.selectedModel > strategy override > project.settings.defaultModel >
 * opencode.json default > env fallback (null).
 */
async function resolveExecutionModel(
  task: ExecutableTask,
  authorization: string,
  strategyModel?: string,
): Promise<ResolvedModel | undefined> {
  // 1. Task-level override
  if (task.selectedModel) {
    return parseModelString(task.selectedModel);
  }

  // 2. Strategy-level category override
  if (strategyModel) {
    return parseModelString(strategyModel);
  }

  // 3. Project-level default
  try {
    const projectResult = await cpFetch<{ settings?: { defaultModel?: string } }>(
      `/api/projects/${encodeURIComponent(task.projectId)}`,
      { authorization },
    );
    if (projectResult.ok && projectResult.data?.settings?.defaultModel) {
      return parseModelString(projectResult.data.settings.defaultModel);
    }
  } catch {
    // Fall through to system default
  }

  // 4. System-level default from opencode.json
  const systemDefaultModel = readDefaultExecutionModel();
  if (systemDefaultModel) {
    return parseModelString(systemDefaultModel);
  }

  // 5. Return undefined — adapter will use its env-based defaults
  return undefined;
}

function parseModelString(raw: string): { providerId: string; modelId: string } {
  return resolveModelRoute(raw);
}

function buildRepoContext(task: ExecutableTask, identitySnapshot: IdentitySnapshot) {
  if (!task.repoId) {
    return undefined;
  }

  return {
    repoName: task.repoName ?? undefined,
    remoteUrl: task.remoteUrl ?? undefined,
    workingBranch: task.workingBranch ?? undefined,
    gitAuthorName: (identitySnapshot.gitAuthorName ?? task.gitAuthorName ?? undefined) as
      | string
      | undefined,
    gitAuthorEmail: (identitySnapshot.gitAuthorEmail ?? task.gitAuthorEmail ?? undefined) as
      | string
      | undefined,
    gitCommitterName: identitySnapshot.gitCommitterName as string | undefined,
    gitCommitterEmail: identitySnapshot.gitCommitterEmail as string | undefined,
  };
}

function buildTaskPatchBody(
  execResult: { sessionId?: string; agentRunId?: string },
  classification: ReturnType<typeof classifyIntent>,
  identitySnapshot: IdentitySnapshot,
  executionMeta: {
    selectedAgent: string;
    effectiveModel?: string;
    plan?: ExecutionPlan;
    hookExecutions?: HookExecutionRecord[];
  },
) {
  return {
    status: "running",
    sessionId: execResult.sessionId,
    agentRunId: execResult.agentRunId,
    category: classification.category,
    executionMode: executionMeta.plan?.mode ?? "single",
    executionPlan: executionMeta.plan ? JSON.stringify(executionMeta.plan) : undefined,
    strategy: mergeTaskStrategy(undefined, {
      selectedTemplateId: executionMeta.plan?.templateId,
      complexity: classification.complexity,
      suggestedAgents: classification.suggestedAgents,
      requiresPlan: classification.requiresPlan,
      confidence: classification.confidence,
      selectedAgent: executionMeta.selectedAgent,
      effectiveModel: executionMeta.effectiveModel,
      executionMode: executionMeta.plan?.mode,
      hookExecutions: executionMeta.hookExecutions,
    }),
    ...identitySnapshot,
  };
}

function buildWorkflowPromptContext(
  task: ExecutableTask,
  extras: Record<string, string | undefined | null>,
) {
  return {
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    repoName: task.repoName,
    remoteUrl: task.remoteUrl,
    workingBranch: task.workingBranch,
    ...extras,
  };
}

function roleLabelFromId(roleAgentId: string | null | undefined) {
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

function stageLabelFromKey(stageKey: string | null | undefined) {
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

async function buildTaskWorkflowViewModel(taskId: string, authorization: string): Promise<WorkflowViewModel> {
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

  return {
    taskId,
    workflow: {
      templateId: workflowRun?.templateId ?? null,
      currentStage: workflowRun?.currentStage || "unknown",
      status: workflowRun?.status || "pending",
      stages: stages.map((stage, index) => ({
        id: stage.id || `${taskId}-${stage.stageKey || index}`,
        stageKey: stage.stageKey || `stage-${index + 1}`,
        stageLabel: stageLabelFromKey(stage.stageKey),
        status: stage.status || "pending",
        approvalState: stage.approvalState || "not-required",
        blockingReason: stage.blockingReason || undefined,
        primaryRoleLabel: roleLabelFromId(stage.primaryRoleAgentId),
      })),
    },
    roleConclusions: conclusions.map((item, index) => ({
      id: item.id || `${item.roleAgentId || "role"}-${item.stage || index}`,
      roleAgentId: item.roleAgentId || "unknown",
      roleLabel: roleLabelFromId(item.roleAgentId),
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
      approvalRequired: Boolean(item.approvalRequired ?? item.approvalRecommendation?.required),
    })),
    developerChangeRequests: requests.map((item, index) => ({
      id: item.id || `${item.sourceRoleAgentId || "role"}-request-${index}`,
      sourceRoleAgentId: item.sourceRoleAgentId || "unknown",
      sourceRoleLabel: roleLabelFromId(item.sourceRoleAgentId),
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

async function runPreExecutionHooks(
  task: ExecutableTask,
  repoContext: ReturnType<typeof buildRepoContext>,
  executionAgent: string,
  effectiveModel: string | undefined,
) {
  const strategy = readOrchestrationStrategy();
  const hookResult = await executeLifecycleHooks({
    strategy,
    trigger: "pre-execution",
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    titlePrefix: "Preflight",
    repoContext,
    context: buildWorkflowPromptContext(task, {
      selectedAgent: executionAgent,
      selectedModel: effectiveModel,
      taskResult: "",
      changesSummary: "",
    }),
  });

  if (hookResult.hookExecutions.length === 0) {
    return {
      prompt: task.prompt,
      hookExecutions: [] as HookExecutionRecord[],
    };
  }

  if (hookResult.rewrittenPrompt) {
    return {
      prompt: hookResult.rewrittenPrompt,
      hookExecutions: hookResult.hookExecutions,
    };
  }

  // Default: prepend the review as context for the execution agent
  const promptWithReview = [
    "Pre-execution assessment from the configured review agent:",
    hookResult.combinedResultText || "",
    "",
    "Original task:",
    task.prompt,
  ].join("\n\n");

  return {
    prompt: promptWithReview,
    hookExecutions: hookResult.hookExecutions,
  };
}

function validateExecutableTask(task: ExecutableTask): string | null {
  if (task.status !== "pending") {
    return `Cannot execute: task status is ${task.status}`;
  }

  return null;
}

async function validateResolvedModel(resolvedModel: ResolvedModel | undefined) {
  if (!resolvedModel) {
    return null;
  }

  const check = validateModelProvider(resolvedModel.providerId);
  if (check.valid) {
    return diagnoseModelReadiness(resolvedModel).then((failure) =>
      failure
        ? {
            status: failure.status,
            body: failure,
          }
        : null,
    );
  }

  return {
    status: 400 as const,
    body: {
      error: check.error,
      code: RUNTIME_RECOVERY_ERROR_CODES.providerNotConfigured,
      diagnostics: {
        providerId: resolvedModel.providerId,
        modelId: resolvedModel.modelId,
        configuredProviders: check.providers,
      },
      recoverySuggestions: [
        {
          id: RUNTIME_RECOVERY_SUGGESTION_IDS.addMissingProvider,
          kind: RUNTIME_RECOVERY_SUGGESTION_KINDS.config,
          title: "先在系统配置 → 模型中添加对应 Provider。",
          detail: `当前缺少 Provider: ${resolvedModel.providerId}`,
        },
        {
          id: RUNTIME_RECOVERY_SUGGESTION_IDS.switchToConfiguredModel,
          kind: RUNTIME_RECOVERY_SUGGESTION_KINDS.check,
          title: "或改用当前已经配置好的模型后再执行。",
          detail: `已配置 Provider: ${check.providers.join(", ") || "(无)"}`,
        },
      ] satisfies RuntimeRecoverySuggestion[],
      providers: check.providers,
    },
  };
}

function parseMessageTimeValue(message: unknown, key: "created" | "updated") {
  if (!message || typeof message !== "object") {
    return null;
  }

  const info = "info" in message && typeof message.info === "object" && message.info
    ? (message.info as Record<string, unknown>)
    : undefined;
  const time = info && typeof info.time === "object" && info.time
    ? (info.time as Record<string, unknown>)
    : undefined;
  const value = time?.[key] ?? time?.started ?? time?.completed;

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return null;
}

async function buildFallbackTaskSession(
  taskId: string,
  task: { sessionId?: string; title?: string; status?: string },
): Promise<SessionSummaryRecord | null> {
  if (!task.sessionId) {
    return null;
  }

  const messagesResult = await getSessionMessages(task.sessionId);
  const messages = Array.isArray(messagesResult.data) ? messagesResult.data : [];
  const lastMessage = messages[messages.length - 1];

  return {
    id: task.sessionId,
    title: task.title ? `[Task ${taskId.slice(0, 8)}] ${task.title}` : `[Task ${taskId.slice(0, 8)}] 主会话`,
    isActive: task.status === "running",
    summary: null,
    createdAt: parseMessageTimeValue(messages[0], "created"),
    updatedAt: parseMessageTimeValue(lastMessage, "updated"),
  };
}

async function prepareExecutionContext(
  task: ExecutableTask,
  authorization: string,
): Promise<PreparedExecutionContext> {
  const identitySnapshot = await resolveExecutionIdentity(task, authorization);
  const { classification, executionAgent, strategy, plan } = selectExecutionAgent(task.prompt);
  const resolvedModel = await resolveExecutionModel(
    task,
    authorization,
    strategy.categoryModelMap[classification.category] || undefined,
  );
  const repoContext = buildRepoContext(task, identitySnapshot);

  return {
    task,
    authorization,
    identitySnapshot,
    classification,
    executionAgent,
    plan,
    repoContext,
    resolvedModel,
    effectiveModel: resolvedModel
      ? `${resolvedModel.providerId}:${resolvedModel.modelId}`
      : undefined,
  };
}

async function finalizePreExecutionContext(
  context: PreparedExecutionContext,
): Promise<ExecutionContext> {
  const preExecutionHooks = await runPreExecutionHooks(
    context.task,
    context.repoContext,
    context.executionAgent,
    context.effectiveModel,
  );

  return {
    ...context,
    prompt: preExecutionHooks.prompt,
    hookExecutions: [...preExecutionHooks.hookExecutions],
  };
}

function isParallelExecution(plan: ExecutionPlan) {
  return plan.mode === "parallel" && plan.candidates.length > 1;
}

async function createParallelCandidateAttempts(
  context: ExecutionContext,
): Promise<ParallelCandidateAttempt[]> {
  return Promise.all(
    context.plan.candidates.map(async (candidate, index) => {
      try {
        const sessionResult = await createSession(
          context.task.id,
          context.task.projectId,
          context.prompt,
          {
            agent: candidate.agent,
            candidateIndex: index,
            repoContext: context.repoContext,
            model: context.resolvedModel,
          },
        );
        if (sessionResult.agentRunId) {
          await createAgentRunRecord({
            taskId: context.task.id,
            agentRunId: sessionResult.agentRunId,
            sessionId: sessionResult.sessionId,
            agentType: candidate.agent,
            status: sessionResult.ok ? "running" : "failed",
            model: context.resolvedModel,
            candidateIndex: index,
            error: sessionResult.ok ? undefined : sessionResult.error,
            startedAt: new Date().toISOString(),
            finishedAt: sessionResult.ok ? undefined : new Date().toISOString(),
          });
        }
        return { index, sessionResult };
      } catch {
        return { index };
      }
    }),
  );
}

function applyParallelCandidateAttempts(plan: ExecutionPlan, attempts: ParallelCandidateAttempt[]) {
  let hasAnySuccess = false;
  const startedAt = new Date().toISOString();

  for (const attempt of attempts) {
    const candidate = plan.candidates[attempt.index];
    if (!candidate) {
      continue;
    }

    if (!attempt.sessionResult) {
      candidate.status = "failed";
      continue;
    }

    candidate.sessionId = attempt.sessionResult.sessionId;
    candidate.agentRunId = attempt.sessionResult.agentRunId;
    candidate.status = attempt.sessionResult.ok ? "running" : "failed";
    candidate.startedAt = startedAt;
    hasAnySuccess ||= attempt.sessionResult.ok;
  }

  return hasAnySuccess;
}

async function markTaskFailed(taskId: string, authorization: string) {
  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: { status: "failed" },
    authorization,
  });
}

async function persistExecutionStart(
  context: ExecutionContext,
  execResult: { sessionId?: string; agentRunId?: string },
) {
  await cpFetch(`/api/tasks/${encodeURIComponent(context.task.id)}`, {
    method: "PATCH",
    body: buildTaskPatchBody(execResult, context.classification, context.identitySnapshot, {
      selectedAgent: context.executionAgent,
      effectiveModel: context.effectiveModel,
      plan: context.plan,
      hookExecutions: context.hookExecutions,
    }),
    authorization: context.authorization,
  });
}

function broadcastParallelExecutionStarted(context: ExecutionContext) {
  for (const candidate of context.plan.candidates) {
    if (candidate.status !== "running") {
      continue;
    }

    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.started",
      ts: new Date().toISOString(),
      taskId: context.task.id,
      projectId: context.task.projectId,
      agentRunId: candidate.agentRunId,
      sessionId: candidate.sessionId,
      data: {
        taskId: context.task.id,
        title: context.task.title,
        agentRunId: candidate.agentRunId,
        agent: candidate.agent,
        executionMode: "parallel",
      },
    });
  }
}

function buildParallelExecutionResponse(
  taskId: string,
  primaryCandidate: ExecutionPlan["candidates"][number] | undefined,
  candidates: ExecutionPlan["candidates"],
): StartExecutionResponse {
  return {
    status: 200,
    body: {
      taskId,
      sessionId: primaryCandidate?.sessionId,
      agentRunId: primaryCandidate?.agentRunId,
      status: "running",
      executionMode: "parallel",
      candidates: candidates.map((candidate) => ({
        agent: candidate.agent,
        sessionId: candidate.sessionId,
        status: candidate.status,
      })),
    },
  };
}

async function startParallelExecution(context: ExecutionContext): Promise<StartExecutionResponse> {
  const attempts = await createParallelCandidateAttempts(context);
  const hasAnySuccess = applyParallelCandidateAttempts(context.plan, attempts);

  if (!hasAnySuccess) {
    await markTaskFailed(context.task.id, context.authorization);
    return {
      status: 502,
      body: { error: "All parallel candidates failed to start" },
    };
  }

  const primaryCandidate = context.plan.candidates.find(
    (candidate) => candidate.status === "running",
  );
  await persistExecutionStart(context, {
    sessionId: primaryCandidate?.sessionId,
    agentRunId: primaryCandidate?.agentRunId,
  });
  sseAggregator.registerParallelTask(context.task.id, context.plan.candidates);
  broadcastParallelExecutionStarted(context);

  // Register root branch in task_sessions lineage for primary candidate
  if (primaryCandidate?.sessionId) {
    await cpFetch(`/api/tasks/${encodeURIComponent(context.task.id)}/task-sessions`, {
      method: "POST",
      body: {
        runtimeSessionId: primaryCandidate.sessionId,
        branchName: context.task.title,
        sourceType: "root",
        isActive: true,
      },
      authorization: context.authorization,
    });
  }

  return buildParallelExecutionResponse(context.task.id, primaryCandidate, context.plan.candidates);
}

function handleSingleExecutionFailure(
  taskId: string,
  execResult: SessionStartResult,
): StartExecutionResponse | null {
  if (!execResult.ok && !execResult.sessionId) {
    return {
      status: 502,
      body: { error: execResult.error || "Failed to start agent execution" },
    };
  }

  if (!execResult.ok && execResult.sessionId) {
    return {
      status: 502,
      body: {
        error: execResult.error || "Agent 会话已创建但提示发送失败 — 所选模型可能未开通或不可用",
        code: "MODEL_RUNTIME_ERROR",
        sessionId: execResult.sessionId,
        taskId,
      },
    };
  }

  return null;
}

function attachSingleCandidate(plan: ExecutionPlan, execResult: SessionStartResult) {
  const candidate = plan.candidates[0];
  if (!candidate) {
    return;
  }

  candidate.sessionId = execResult.sessionId;
  candidate.agentRunId = execResult.agentRunId;
  candidate.status = "running";
  candidate.startedAt = new Date().toISOString();
}

function broadcastSingleExecutionStarted(
  context: ExecutionContext,
  execResult: SessionStartResult,
) {
  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "agent.started",
    ts: new Date().toISOString(),
    taskId: context.task.id,
    projectId: context.task.projectId,
    agentRunId: execResult.agentRunId,
    sessionId: execResult.sessionId,
    data: {
      taskId: context.task.id,
      title: context.task.title,
      agentRunId: execResult.agentRunId,
    },
  });
}

async function startSingleExecution(context: ExecutionContext): Promise<StartExecutionResponse> {
  const execResult = await createSession(context.task.id, context.task.projectId, context.prompt, {
    agent: context.executionAgent,
    repoContext: context.repoContext,
    model: context.resolvedModel,
  });
  if (execResult.agentRunId) {
    await createAgentRunRecord({
      taskId: context.task.id,
      agentRunId: execResult.agentRunId,
      sessionId: execResult.sessionId,
      agentType: context.executionAgent,
      status: execResult.ok ? "running" : "failed",
      model: context.resolvedModel,
      error: execResult.ok ? undefined : execResult.error,
      startedAt: new Date().toISOString(),
      finishedAt: execResult.ok ? undefined : new Date().toISOString(),
    });
  }
  const failure = handleSingleExecutionFailure(context.task.id, execResult);
  if (failure) {
    if (failure.body.code === "MODEL_RUNTIME_ERROR") {
      await markTaskFailed(context.task.id, context.authorization);
    }
    return failure;
  }

  attachSingleCandidate(context.plan, execResult);
  await persistExecutionStart(context, execResult);
  broadcastSingleExecutionStarted(context, execResult);

  // Register root branch in task_sessions lineage
  if (execResult.sessionId) {
    await cpFetch(`/api/tasks/${encodeURIComponent(context.task.id)}/task-sessions`, {
      method: "POST",
      body: {
        runtimeSessionId: execResult.sessionId,
        branchName: context.task.title,
        sourceType: "root",
        isActive: true,
      },
      authorization: context.authorization,
    });
  }

  return {
    status: 200,
    body: {
      taskId: context.task.id,
      sessionId: execResult.sessionId,
      agentRunId: execResult.agentRunId,
      status: "running",
      executionMode: "single",
    },
  };
}

// GET /api/tasks — List tasks
taskRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId") || "";
  const status = c.req.query("status") || "";
  const repoId = c.req.query("repoId") || "";
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  if (repoId) params.set("repoId", repoId);

  const result = await cpFetch(`/api/tasks?${params.toString()}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 502));
});

// GET /api/tasks/:taskId — Get task detail
taskRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

taskRoutes.get("/:taskId/workflow", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/workflow`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

taskRoutes.get("/:taskId/role-conclusions", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/role-conclusions`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

taskRoutes.get("/:taskId/developer-change-requests", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/developer-change-requests`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

const updateDeveloperChangeRequestSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(["open", "acknowledged", "in-progress", "resolved", "won't-fix"]),
  resolutionNote: z.string().optional(),
});

taskRoutes.patch(
  "/:taskId/developer-change-requests",
  zValidator("json", updateDeveloperChangeRequestSchema),
  async (c) => {
    const taskId = c.req.param("taskId");
    const body = c.req.valid("json");
    const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/developer-change-requests`, {
      method: "PATCH",
      body,
      authorization: authHeader(c),
    });
    return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 404 | 502));
  },
);

taskRoutes.get("/:taskId/workflow-view", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);
  const taskResult = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    authorization,
  });
  if (!taskResult.ok) {
    return c.json(taskResult.data, taskResult.status as 401 | 404 | 502);
  }

  const view = await buildTaskWorkflowViewModel(taskId, authorization);
  return c.json(view);
});

const updateTaskSchema = z.object({
  selectedModel: z.string().max(200).nullable().optional(),
});

taskRoutes.patch("/:taskId", zValidator("json", updateTaskSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");

  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body,
    authorization: authHeader(c),
  });

  return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 404 | 502));
});

// POST /api/tasks — Create a new task
const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  prompt: z.string().min(1).max(50000),
  projectId: z.string().min(1),
  repoId: z.string().min(1).optional(),
  workingBranch: z.string().min(1).max(100).optional(),
  credentialId: z.string().min(1).optional(),
  selectedModel: z.string().max(200).optional(),
  gitAuthorName: z.string().max(200).optional(),
  gitAuthorEmail: z.string().email().max(200).optional(),
});

taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const body = c.req.valid("json");

  const result = await cpFetch<{ id: string; status: string }>("/api/tasks", {
    method: "POST",
    body,
    authorization: authHeader(c),
  });

  if (result.ok) {
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "task.created",
      ts: new Date().toISOString(),
      taskId: result.data.id,
      projectId: body.projectId,
      data: { title: body.title },
    });
  }

  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 502));
});

// POST /api/tasks/:taskId/execute — Start agent execution for a task
taskRoutes.post("/:taskId/execute", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);
  const taskResult = await fetchExecutableTask(taskId, authorization);
  if (!taskResult.ok) {
    return c.json({ error: "Task not found" }, 404);
  }

  const task = taskResult.data;
  const validationError = validateExecutableTask(task);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const preparedContext = await prepareExecutionContext(task, authorization);
  const modelValidationError = await validateResolvedModel(preparedContext.resolvedModel);
  if (modelValidationError) {
    return c.json(modelValidationError.body, modelValidationError.status);
  }

  const executionContext = await finalizePreExecutionContext(preparedContext);
  const response = isParallelExecution(executionContext.plan)
    ? await startParallelExecution(executionContext)
    : await startSingleExecution(executionContext);

  return c.json(response.body, response.status);
});

// POST /api/tasks/reconcile-running — Manually reconcile persisted running tasks
taskRoutes.post("/reconcile-running", async (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) {
    return c.json({ error: adminErr }, 403);
  }

  const user = c.get("user");
  const authorization = authHeader(c);
  const summary = await reconcileRunningTasksOnStartup();
  await recordManualReconcileAudit(authorization, user, summary);
  return c.json({ ok: true, data: summary });
});

// GET /api/tasks/:taskId/graph — Get DAG visualization data
taskRoutes.get("/:taskId/graph", async (c) => {
  const taskId = c.req.param("taskId");
  const taskResult = await cpFetch<{ sessionId?: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    {
      authorization: authHeader(c),
    },
  );

  // Sync latest runtime DAG state before returning
  await syncGraphsForSessionTask(
    taskId,
    taskResult.ok ? taskResult.data?.sessionId : undefined,
  ).catch(() => {});
  await syncGraphsForTask(taskId).catch(() => {});
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/graph`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// GET /api/tasks/:taskId/runs — Get agent run history
taskRoutes.get("/:taskId/runs", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/runs`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// GET /api/tasks/:taskId/pipeline — Get runtime pipeline results
taskRoutes.get("/:taskId/pipeline", async (c) => {
  const taskId = c.req.param("taskId");
  const requestedSessionId = c.req.query("sessionId");
  const authorization = authHeader(c);

  await syncGraphsForSessionTask(taskId, requestedSessionId).catch(() => {});
  await syncGraphsForTask(taskId).catch(() => {});

  const pipeline = await buildRuntimePipeline({
    taskId,
    sessionId: requestedSessionId,
    authorization,
  });

  return c.json(pipeline);
});

// ═══════════════════════════════════════════════════════════════════
// SESSION ROUTES — Expose OpenCode session operations
// ═══════════════════════════════════════════════════════════════════

// GET /api/tasks/:taskId/sessions — List sessions related to a task
taskRoutes.get("/:taskId/sessions", async (c) => {
  const taskId = c.req.param("taskId");

  // Get task to find its sessionId
  const taskResult = await cpFetch<{ sessionId?: string; title?: string; status?: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    { authorization: authHeader(c) },
  );

  if (!taskResult.ok) {
    return c.json({ data: [] });
  }

  const sessionIsActive = taskResult.data?.status === "running";

  // List recent sessions from OpenCode and filter by task reference
  const sessResult = await listSessions(50);
  if (!sessResult.ok || !Array.isArray(sessResult.data)) {
    const fallback = await buildFallbackTaskSession(taskId, taskResult.data || {});
    return c.json({ data: fallback ? [fallback] : [] });
  }

  const taskPrefix = `[Task ${taskId.slice(0, 8)}]`;
  const sessions: SessionSummaryRecord[] = (
    sessResult.data as Array<{
      id: string;
      title?: string;
      version?: string;
      summary?: { additions: number; deletions: number; files: number };
      time?: { created: number; updated: number };
    }>
  )
    .filter((s) => s.id === taskResult.data?.sessionId || s.title?.includes(taskPrefix))
    .map((s) => ({
      id: s.id,
      title: s.title || "",
      isActive: sessionIsActive && s.id === taskResult.data?.sessionId,
      summary: s.summary || null,
      createdAt: s.time?.created ? new Date(s.time.created).toISOString() : null,
      updatedAt: s.time?.updated ? new Date(s.time.updated).toISOString() : null,
    }));

  if (taskResult.data?.sessionId && !sessions.some((session) => session.id === taskResult.data?.sessionId)) {
    const fallback = await buildFallbackTaskSession(taskId, taskResult.data);
    if (fallback) {
      sessions.unshift(fallback);
    }
  }

  return c.json({ data: sessions });
});

// GET /api/tasks/:taskId/sessions/:sessionId/messages — Get session messages
taskRoutes.get("/:taskId/sessions/:sessionId/messages", async (c) => {
  const sessionId = c.req.param("sessionId") as string;
  const result = await getSessionMessages(sessionId);
  if (!result.ok) {
    return c.json({ data: [] });
  }
  return c.json({ data: result.data });
});

// POST /api/tasks/:taskId/continue — Continue a task (send follow-up prompt to its session)
const continueSchema = z.object({
  prompt: z.string().min(1).max(50000),
  sessionId: z.string().optional(),
});

taskRoutes.post("/:taskId/continue", zValidator("json", continueSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const { prompt, sessionId: overrideSessionId } = c.req.valid("json");

  // Get the task's session
  const taskResult = await cpFetch<{
    sessionId?: string;
    projectId: string;
    selectedModel?: string | null;
  }>(`/api/tasks/${encodeURIComponent(taskId)}`, { authorization: authHeader(c) });

  if (!taskResult.ok) return c.json({ error: "Task not found" }, 404);

  const sid = overrideSessionId || taskResult.data?.sessionId;
  if (!sid) return c.json({ error: "No session associated with this task" }, 400);

  // Resolve model for continuation (same priority as initial execution)
  const resolvedModel = await resolveExecutionModel(
    {
      id: taskId,
      prompt,
      status: "running",
      projectId: taskResult.data.projectId,
      title: "",
      selectedModel: taskResult.data.selectedModel,
    },
    authHeader(c),
  );

  // Pre-flight: validate model provider
  if (resolvedModel) {
    const modelValidationError = await validateResolvedModel(resolvedModel);
    if (modelValidationError) {
      return c.json(modelValidationError.body, modelValidationError.status);
    }
  }

  const agentRunId = ensureAgentRunForSession(
    sid,
    taskId,
    taskResult.data.projectId,
    resolvedModel,
  );

  const result = await continueSession(sid, prompt, { model: resolvedModel });
  if (!result.ok) return c.json({ error: result.error || "Failed to continue session" }, 502);

  // Update task status back to running
  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: { status: "running" },
    authorization: authHeader(c),
  });

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.continued",
    ts: new Date().toISOString(),
    taskId,
    projectId: taskResult.data?.projectId,
    agentRunId,
    data: { sessionId: sid, agentRunId },
  });

  void buildPipelineStageUpdatedEvents({
    taskId,
    sessionId: sid,
    projectId: taskResult.data?.projectId,
    agentRunId,
    authorization: authHeader(c),
    reason: "task.continued",
  }).then((events) => {
    for (const event of events) {
      wsBroadcaster.broadcast(event);
    }
  });

  return c.json({ ok: true, sessionId: sid, agentRunId });
});

const forkSessionSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  messageId: z.string().optional(),
});

taskRoutes.post(
  "/:taskId/sessions/:sessionId/fork",
  zValidator("json", forkSessionSchema),
  async (c) => {
    const taskId = c.req.param("taskId");
    const sessionId = c.req.param("sessionId");
    const { title, messageId } = c.req.valid("json");
    const authorization = authHeader(c);

    const taskResult = await cpFetch<{ projectId?: string; title?: string }>(
      `/api/tasks/${encodeURIComponent(taskId)}`,
      { authorization },
    );

    if (!taskResult.ok) {
      return c.json({ error: "Task not found" }, 404);
    }

    await ensureParentLineageRecord(taskId, sessionId, authorization, taskResult.data?.title);

    const defaultTitle = title || `[Task ${taskId.slice(0, 8)}] Fork ${new Date().toLocaleTimeString()}`;
    const result = await forkSession(sessionId, { title: defaultTitle });

    if (!result.ok || !result.sessionId) {
      return c.json({ error: result.error || "Failed to fork session" }, 502);
    }

    // Persist branch lineage in task_sessions
    await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/task-sessions`, {
      method: "POST",
      body: {
        runtimeSessionId: result.sessionId,
        parentRuntimeSessionId: sessionId,
        forkedFromMessageId: messageId,
        branchName: defaultTitle,
        sourceType: "fork",
        isActive: true,
      },
      authorization,
    });

    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "task.forked",
      ts: new Date().toISOString(),
      taskId,
      projectId: taskResult.data?.projectId,
      sessionId: result.sessionId,
      data: {
        parentSessionId: sessionId,
        title: defaultTitle,
        forkedFromMessageId: messageId,
      },
    });

    return c.json({
      ok: true,
      sessionId: result.sessionId,
      title: defaultTitle,
      parentSessionId: sessionId,
      forkedFromMessageId: messageId,
    });
  },
);

// ═══════════════════════════════════════════════════════════════════
// SESSION TREE & ACTIVATE — Branch lineage operations
// ═══════════════════════════════════════════════════════════════════

interface TaskSessionRecord {
  id: string;
  taskId: string;
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  branchName: string | null;
  sourceType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface RuntimeSessionMeta {
  title?: string;
  summary?: { additions: number; deletions: number; files: number } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface SessionTreeNode {
  id: string;
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  forkedFromMessageRole: string | null;
  forkedFromMessagePreview: string | null;
  firstPromptAfterFork: string | null;
  branchName: string | null;
  sourceType: string;
  isActive: boolean;
  title: string | null;
  summary: { additions: number; deletions: number; files: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
  children: SessionTreeNode[];
}

function compareIsoTime(left?: string | null, right?: string | null) {
  const leftTime = left ? Date.parse(left) : Number.POSITIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}

function dedupeTaskSessionRecords(records: TaskSessionRecord[]) {
  const byRuntimeSessionId = new Map<string, TaskSessionRecord>();

  for (const record of records) {
    const existing = byRuntimeSessionId.get(record.runtimeSessionId);
    if (!existing) {
      byRuntimeSessionId.set(record.runtimeSessionId, record);
      continue;
    }

    const existingScore = Number(Boolean(existing.parentRuntimeSessionId)) + Number(Boolean(existing.forkedFromMessageId));
    const nextScore = Number(Boolean(record.parentRuntimeSessionId)) + Number(Boolean(record.forkedFromMessageId));
    const existingUpdated = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    const nextUpdated = record.updatedAt ? Date.parse(record.updatedAt) : 0;

    if (nextScore > existingScore || nextUpdated > existingUpdated) {
      byRuntimeSessionId.set(record.runtimeSessionId, record);
    }
  }

  return Array.from(byRuntimeSessionId.values()).sort((left, right) => compareIsoTime(left.createdAt, right.createdAt));
}

function normalizeLineageRecords(records: TaskSessionRecord[]) {
  const normalized = dedupeTaskSessionRecords(records).map((record) => ({ ...record }));
  if (normalized.length <= 1) {
    return { records: normalized, repaired: [] as TaskSessionRecord[] };
  }

  const rootRecord =
    normalized.find((record) => record.sourceType === "root") ??
    normalized.slice().sort((left, right) => compareIsoTime(left.createdAt, right.createdAt))[0];

  if (!rootRecord) {
    return { records: normalized, repaired: [] as TaskSessionRecord[] };
  }

  const repaired: TaskSessionRecord[] = [];

  for (const record of normalized) {
    let changed = false;

    if (record.runtimeSessionId === rootRecord.runtimeSessionId) {
      if (record.parentRuntimeSessionId !== null) {
        record.parentRuntimeSessionId = null;
        changed = true;
      }
      if (record.sourceType !== "root") {
        record.sourceType = "root";
        changed = true;
      }
    } else if (!record.parentRuntimeSessionId) {
      record.parentRuntimeSessionId = rootRecord.runtimeSessionId;
      changed = true;
      if (record.sourceType !== "sub_session") {
        record.sourceType = "fork";
      }
    } else if (record.sourceType === "root") {
      record.sourceType = "fork";
      changed = true;
    }

    if (changed) {
      repaired.push(record);
    }
  }

  return { records: normalized, repaired };
}

async function fetchRuntimeSessionMap(limit = 50) {
  const sessResult = await listSessions(limit);
  const runtimeMap = new Map<string, RuntimeSessionMeta>();

  if (sessResult.ok && Array.isArray(sessResult.data)) {
    for (const session of sessResult.data as Array<{
      id: string;
      title?: string;
      summary?: { additions: number; deletions: number; files: number };
      time?: { created: number; updated: number };
    }>) {
      runtimeMap.set(session.id, {
        title: session.title,
        summary: session.summary ?? null,
        createdAt: session.time?.created ? new Date(session.time.created).toISOString() : null,
        updatedAt: session.time?.updated ? new Date(session.time.updated).toISOString() : null,
      });
    }
  }

  return runtimeMap;
}

function extractMessagePreview(message: unknown) {
  if (!message || typeof message !== "object") {
    return { role: null, preview: null } as const;
  }

  const record = message as Record<string, unknown>;
  const info = record.info && typeof record.info === "object"
    ? (record.info as Record<string, unknown>)
    : undefined;
  const role = typeof info?.role === "string" ? info.role : null;
  const parts = Array.isArray(record.parts) ? record.parts : [];
  const text = parts
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [] as string[];
      }

      const typedPart = part as Record<string, unknown>;
      if (typedPart.type === "text" && typeof typedPart.text === "string") {
        return [typedPart.text];
      }

      return [] as string[];
    })
    .join("\n\n")
    .trim();

  if (!text) {
    return { role, preview: null } as const;
  }

  const blocks = text
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const preferredBlock =
    blocks.find((block) => !block.startsWith("Execution context:")) ??
    blocks.find((block) => !block.startsWith("- OpenerX task ID:")) ??
    blocks[0] ??
    text;

  const normalized = preferredBlock.replace(/\s+/g, " ").trim();
  const preview = normalized.length > 72 ? `${normalized.slice(0, 71).trimEnd()}…` : normalized;

  return {
    role,
    preview: preview || null,
  } as const;
}

async function buildForkMessagePreviewMap(records: TaskSessionRecord[]) {
  const previewMap = new Map<string, { role: string | null; preview: string | null }>();
  const parentSessionTargets = new Map<string, Set<string>>();

  for (const record of records) {
    if (!record.parentRuntimeSessionId || !record.forkedFromMessageId) {
      continue;
    }

    const messageIds = parentSessionTargets.get(record.parentRuntimeSessionId) ?? new Set<string>();
    messageIds.add(record.forkedFromMessageId);
    parentSessionTargets.set(record.parentRuntimeSessionId, messageIds);
  }

  await Promise.all(
    Array.from(parentSessionTargets.entries()).map(async ([parentSessionId, messageIds]) => {
      const result = await getSessionMessages(parentSessionId);
      if (!result.ok || !Array.isArray(result.data)) {
        return;
      }

      for (const message of result.data) {
        if (!message || typeof message !== "object") {
          continue;
        }

        const info = (message as Record<string, unknown>).info;
        const messageId = info && typeof info === "object" && typeof (info as Record<string, unknown>).id === "string"
          ? ((info as Record<string, unknown>).id as string)
          : null;

        if (!messageId || !messageIds.has(messageId)) {
          continue;
        }

        previewMap.set(`${parentSessionId}:${messageId}`, extractMessagePreview(message));
      }
    }),
  );

  return previewMap;
}

async function buildFirstPromptAfterForkMap(records: TaskSessionRecord[]) {
  const promptMap = new Map<string, string | null>();

  await Promise.all(
    records.map(async (record) => {
      const result = await getSessionMessages(record.runtimeSessionId);
      if (!result.ok || !Array.isArray(result.data)) {
        promptMap.set(record.runtimeSessionId, null);
        return;
      }

      if (record.sourceType === "root") {
        const firstUserMessage = result.data.find((message) => {
          if (!message || typeof message !== "object") {
            return false;
          }

          const info = (message as Record<string, unknown>).info;
          if (!info || typeof info !== "object") {
            return false;
          }

          return (info as Record<string, unknown>).role === "user";
        });

        const preview = firstUserMessage ? extractMessagePreview(firstUserMessage).preview : null;
        promptMap.set(record.runtimeSessionId, preview);
        return;
      }

      if (record.sourceType !== "fork") {
        return;
      }

      const createdAtMs = Date.parse(record.createdAt);
      if (!Number.isFinite(createdAtMs)) {
        promptMap.set(record.runtimeSessionId, null);
        return;
      }

      const firstUserMessage = result.data.find((message) => {
        if (!message || typeof message !== "object") {
          return false;
        }

        const info = (message as Record<string, unknown>).info;
        if (!info || typeof info !== "object") {
          return false;
        }

        const role = (info as Record<string, unknown>).role;
        const created = ((info as Record<string, unknown>).time as Record<string, unknown> | undefined)?.created;
        return role === "user" && typeof created === "number" && created >= createdAtMs;
      });

      const preview = firstUserMessage ? extractMessagePreview(firstUserMessage).preview : null;
      promptMap.set(record.runtimeSessionId, preview);
    }),
  );

  return promptMap;
}

function synthesizeLineageRecordsFromRuntime(
  taskId: string,
  taskSessionId: string | undefined,
  runtimeSessions: Map<string, RuntimeSessionMeta>,
) {
  const taskPrefix = `[Task ${taskId.slice(0, 8)}]`;
  const records = Array.from(runtimeSessions.entries())
    .filter(([runtimeSessionId, runtime]) => runtimeSessionId === taskSessionId || runtime.title?.includes(taskPrefix))
    .sort((left, right) => compareIsoTime(left[1].createdAt ?? left[1].updatedAt, right[1].createdAt ?? right[1].updatedAt))
    .map(([runtimeSessionId, runtime]) => ({ runtimeSessionId, runtime }));

  const rootRuntimeSessionId =
    (taskSessionId && records.find((record) => record.runtimeSessionId === taskSessionId)?.runtimeSessionId) ||
    records[0]?.runtimeSessionId;

  if (!rootRuntimeSessionId) {
    return [] as TaskSessionRecord[];
  }

  return records.map(({ runtimeSessionId, runtime }) => ({
    id: `synthetic-${runtimeSessionId}`,
    taskId,
    runtimeSessionId,
    parentRuntimeSessionId: runtimeSessionId === rootRuntimeSessionId ? null : rootRuntimeSessionId,
    forkedFromMessageId: null,
    branchName: runtime.title ?? null,
    sourceType: runtimeSessionId === rootRuntimeSessionId ? "root" : "fork",
    isActive: runtimeSessionId === taskSessionId,
    createdAt: runtime.createdAt ?? runtime.updatedAt ?? new Date().toISOString(),
    updatedAt: runtime.updatedAt ?? runtime.createdAt ?? new Date().toISOString(),
    archivedAt: null,
  }));
}

async function persistLineageRepairs(taskId: string, records: TaskSessionRecord[], authorization: string) {
  for (const record of records) {
    await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/task-sessions`, {
      method: "POST",
      body: {
        runtimeSessionId: record.runtimeSessionId,
        parentRuntimeSessionId: record.parentRuntimeSessionId ?? undefined,
        forkedFromMessageId: record.forkedFromMessageId ?? undefined,
        branchName: record.branchName ?? undefined,
        sourceType: record.sourceType === "sub_session" ? "sub_session" : record.sourceType === "root" ? "root" : "fork",
        isActive: record.isActive,
      },
      authorization,
    });
  }
}

async function ensureParentLineageRecord(
  taskId: string,
  parentSessionId: string,
  authorization: string,
  taskTitle?: string,
) {
  const lineageResult = await cpFetch<{ data: TaskSessionRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/task-sessions`,
    { authorization },
  );

  const existingRecords =
    lineageResult.ok && Array.isArray(lineageResult.data?.data)
      ? lineageResult.data.data.filter((record: TaskSessionRecord) => !record.archivedAt)
      : [];

  if (existingRecords.some((record) => record.runtimeSessionId === parentSessionId)) {
    return;
  }

  const runtimeMap = await fetchRuntimeSessionMap(100);
  const runtime = runtimeMap.get(parentSessionId);
  const { records: normalized } = normalizeLineageRecords(existingRecords);
  const rootRecord = normalized.find((record) => record.sourceType === "root");
  const inferredParentId = rootRecord && rootRecord.runtimeSessionId !== parentSessionId
    ? rootRecord.runtimeSessionId
    : undefined;

  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/task-sessions`, {
    method: "POST",
    body: {
      runtimeSessionId: parentSessionId,
      parentRuntimeSessionId: inferredParentId,
      branchName: runtime?.title ?? taskTitle,
      sourceType: inferredParentId ? "fork" : "root",
      isActive: false,
    },
    authorization,
  });
}

function buildSessionTree(
  records: TaskSessionRecord[],
  runtimeSessions: Map<string, RuntimeSessionMeta>,
  forkMessagePreviewMap: Map<string, { role: string | null; preview: string | null }>,
  firstPromptAfterForkMap: Map<string, string | null>,
): SessionTreeNode[] {
  const nodeMap = new Map<string, SessionTreeNode>();
  const roots: SessionTreeNode[] = [];

  for (const rec of records) {
    const runtime = runtimeSessions.get(rec.runtimeSessionId);
    const forkSource = rec.parentRuntimeSessionId && rec.forkedFromMessageId
      ? forkMessagePreviewMap.get(`${rec.parentRuntimeSessionId}:${rec.forkedFromMessageId}`)
      : undefined;
    const node: SessionTreeNode = {
      id: rec.id,
      runtimeSessionId: rec.runtimeSessionId,
      parentRuntimeSessionId: rec.parentRuntimeSessionId,
      forkedFromMessageId: rec.forkedFromMessageId,
      forkedFromMessageRole: forkSource?.role ?? null,
      forkedFromMessagePreview: forkSource?.preview ?? null,
      firstPromptAfterFork: firstPromptAfterForkMap.get(rec.runtimeSessionId) ?? null,
      branchName: rec.branchName,
      sourceType: rec.sourceType,
      isActive: rec.isActive,
      title: runtime?.title ?? rec.branchName,
      summary: runtime?.summary ?? null,
      createdAt: runtime?.createdAt ?? rec.createdAt,
      updatedAt: runtime?.updatedAt ?? rec.updatedAt,
      children: [],
    };
    nodeMap.set(rec.runtimeSessionId, node);
  }

  for (const node of nodeMap.values()) {
    if (node.parentRuntimeSessionId && nodeMap.has(node.parentRuntimeSessionId)) {
      nodeMap.get(node.parentRuntimeSessionId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// GET /api/tasks/:taskId/session-tree — Return branch tree for a task
taskRoutes.get("/:taskId/session-tree", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);

  const taskResult = await cpFetch<{ sessionId?: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );

  // Fetch task_sessions lineage from control plane
  const lineageResult = await cpFetch<{ data: TaskSessionRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/task-sessions`,
    { authorization },
  );

  const lineageRecords: TaskSessionRecord[] =
    lineageResult.ok && Array.isArray(lineageResult.data?.data)
      ? lineageResult.data.data.filter((r: TaskSessionRecord) => !r.archivedAt)
      : [];

  const runtimeMap = await fetchRuntimeSessionMap(100);
  const forkMessagePreviewMap = await buildForkMessagePreviewMap(lineageRecords);
  const firstPromptAfterForkMap = await buildFirstPromptAfterForkMap(lineageRecords);

  // If no lineage records, fall back to the flat sessions list
  if (lineageRecords.length === 0) {
    const synthesizedRecords = synthesizeLineageRecordsFromRuntime(taskId, taskResult.data?.sessionId, runtimeMap);

    if (synthesizedRecords.length === 0) {
      return c.json({ data: [] });
    }

    await persistLineageRepairs(taskId, synthesizedRecords, authorization);
    return c.json({ data: buildSessionTree(synthesizedRecords, runtimeMap, new Map(), new Map()) });
  }

  const { records: normalizedRecords, repaired } = normalizeLineageRecords(lineageRecords);
  if (repaired.length > 0) {
    await persistLineageRepairs(taskId, repaired, authorization);
  }

  const tree = buildSessionTree(normalizedRecords, runtimeMap, forkMessagePreviewMap, firstPromptAfterForkMap);
  return c.json({ data: tree });
});

// POST /api/tasks/:taskId/sessions/:sessionId/activate — Activate a branch
taskRoutes.post("/:taskId/sessions/:sessionId/activate", async (c) => {
  const taskId = c.req.param("taskId");
  const sessionId = c.req.param("sessionId");

  // Find the task_sessions record by runtimeSessionId
  const lineageResult = await cpFetch<{ data: TaskSessionRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/task-sessions`,
    { authorization: authHeader(c) },
  );

  if (!lineageResult.ok || !Array.isArray(lineageResult.data?.data)) {
    return c.json({ error: "Failed to fetch branch lineage" }, 502);
  }

  const record = lineageResult.data.data.find((r: TaskSessionRecord) => r.runtimeSessionId === sessionId);
  if (!record) {
    return c.json({ error: "Session not found in branch lineage" }, 404);
  }

  // Call service activate endpoint
  const activateResult = await cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/task-sessions/${encodeURIComponent(record.id)}/activate`,
    { method: "POST", authorization: authHeader(c) },
  );

  if (!activateResult.ok) {
    return c.json({ error: "Failed to activate session" }, 502);
  }

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "session.activated",
    ts: new Date().toISOString(),
    taskId,
    data: { sessionId, branchName: record.branchName },
  });

  return c.json({ ok: true, sessionId });
});

// POST /api/tasks/:taskId/sessions/:sessionId/archive — Archive a branch
taskRoutes.post("/:taskId/sessions/:sessionId/archive", async (c) => {
  const taskId = c.req.param("taskId");
  const sessionId = c.req.param("sessionId");

  // Find the task_sessions record by runtimeSessionId
  const lineageResult = await cpFetch<{ data: TaskSessionRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/task-sessions`,
    { authorization: authHeader(c) },
  );

  if (!lineageResult.ok || !Array.isArray(lineageResult.data?.data)) {
    return c.json({ error: "Failed to fetch branch lineage" }, 502);
  }

  const record = lineageResult.data.data.find((r: TaskSessionRecord) => r.runtimeSessionId === sessionId);
  if (!record) {
    return c.json({ error: "Session not found in branch lineage" }, 404);
  }

  const archiveResult = await cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/task-sessions/${encodeURIComponent(record.id)}/archive`,
    { method: "POST", authorization: authHeader(c) },
  );

  if (!archiveResult.ok) {
    return c.json({ error: "Failed to archive session" }, 502);
  }

  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
// CODE CHANGE ROUTES
// ═══════════════════════════════════════════════════════════════════

// GET /api/tasks/:taskId/changes — List code changes for a task
taskRoutes.get("/:taskId/changes", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/changes`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// GET /api/tasks/:taskId/changes/:changeId/files — List files for a change
taskRoutes.get("/:taskId/changes/:changeId/files", async (c) => {
  const taskId = c.req.param("taskId");
  const changeId = c.req.param("changeId");
  const result = await cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/changes/${encodeURIComponent(changeId)}/files`,
    { authorization: authHeader(c) },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// GET /api/tasks/:taskId/governance — Get governance summary for a task
taskRoutes.get("/:taskId/governance", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/governance/tasks/${encodeURIComponent(taskId)}/summary`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 502));
});

// ═══════════════════════════════════════════════════════════════════
// IDENTITY RESOLUTION HELPER
// ═══════════════════════════════════════════════════════════════════

interface CredentialInfo {
  id: string;
  label: string;
  repoId?: string | null;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
  scope: string;
  isDefault?: boolean;
  status?: string;
}

export function selectCredentialForIdentity(
  credentials: CredentialInfo[],
  repoId: string,
): CredentialInfo | null {
  const activeCredentials = credentials.filter(
    (credential) => credential.status !== "revoked" && credential.status !== "expired",
  );
  const repoCredentials = activeCredentials.filter((credential) => credential.repoId === repoId);
  const projectCredentials = activeCredentials.filter((credential) => !credential.repoId);

  return (
    repoCredentials.find((credential) => credential.isDefault) ??
    projectCredentials.find((credential) => credential.isDefault) ??
    repoCredentials[0] ??
    projectCredentials[0] ??
    null
  );
}

/**
 * Resolve identity for a task execution:
 * 1. If explicit credentialId, use that credential's author info
 * 2. Otherwise, look for default credential for the repo → project
 * Returns identity snapshot fields to freeze on the task, or null if nothing found.
 */
async function resolveIdentity(
  projectId: string,
  repoId: string,
  credentialId: string | undefined,
  authorization: string,
): Promise<Record<string, unknown> | null> {
  // If explicit credential specified, fetch it
  if (credentialId) {
    const credResult = await cpFetch<CredentialInfo>(
      `/api/projects/${encodeURIComponent(projectId)}/credentials/${encodeURIComponent(credentialId)}`,
      { authorization },
    );
    if (credResult.ok && credResult.data) {
      return buildIdentitySnapshot(credResult.data, credentialId);
    }
  }

  // Try to find a default credential for this repo, then fall back to project-level credentials.
  const repoCredsResult = await cpFetch<{ data: CredentialInfo[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/credentials`,
    { authorization },
  );

  if (repoCredsResult.ok && Array.isArray(repoCredsResult.data?.data)) {
    const selectedCredential = selectCredentialForIdentity(repoCredsResult.data.data, repoId);
    if (selectedCredential) {
      return buildIdentitySnapshot(selectedCredential, selectedCredential.id);
    }
  }

  return null;
}

function buildIdentitySnapshot(
  cred: CredentialInfo,
  credentialId: string,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { credentialId };
  if (cred.gitAuthorName) snapshot.gitAuthorName = cred.gitAuthorName;
  if (cred.gitAuthorEmail) snapshot.gitAuthorEmail = cred.gitAuthorEmail;
  // For shared credentials, committer = credential author; for user, same as author
  if (cred.gitAuthorName) snapshot.gitCommitterName = cred.gitAuthorName;
  if (cred.gitAuthorEmail) snapshot.gitCommitterEmail = cred.gitAuthorEmail;
  return snapshot;
}
