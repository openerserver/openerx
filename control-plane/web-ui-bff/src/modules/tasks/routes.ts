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
  DEFAULT_EXECUTION_AGENT,
  type ExecutionPlan,
  type HookExecutionRecord,
  type OrchestrationStrategy,
  buildExecutionPlan,
  mergeTaskStrategy,
  parseTaskStrategy,
  readOrchestrationStrategy,
  resolveWorkflowTemplate,
} from "../../lib/orchestration-strategy";
import {
  type PaidExecutionGuardState,
  type PaidExecutionOverride,
  type PaidExecutionPreflightResult,
  buildPreflightOrchestrationFingerprint,
  createPaidExecutionGuardState,
  evaluatePaidExecutionPreflight,
  fetchProjectPaidExecutionLeaseState,
} from "../../lib/paid-execution-guard";
import { recordPaidExecutionRuntimeUsage } from "../../lib/paid-execution-runtime";
import { buildRuntimePipeline } from "../../lib/runtime-pipeline";
import {
  RUNTIME_RECOVERY_ERROR_CODES,
  RUNTIME_RECOVERY_SUGGESTION_IDS,
  RUNTIME_RECOVERY_SUGGESTION_KINDS,
  type RuntimeRecoverySuggestion,
} from "../../lib/runtime-recovery-contract";
import { fetchProjectRuntimeUsageBaseline } from "../../lib/runtime-usage-ledger";
import type { JWTPayload } from "../../middleware/auth";
import {
  continueSession,
  createSession,
  ensureAgentRunForSession,
  forkSession,
  getSessionMessages,
  listSessions,
} from "../agent-control/opencode-adapter";
import { createAgentRunRecord, recordAgentAudit } from "../agent-control/run-persistence";
import { executeLifecycleHooks } from "../hooks/lifecycle-hooks";
import { buildPipelineStageUpdatedEvents } from "../realtime/pipeline-events";
import { sseAggregator } from "../realtime/sse-aggregator";
import { wsBroadcaster } from "../realtime/ws-broadcaster";
import { reconcileRunningTasksOnStartup } from "./reconcile";
import { ensureTaskWorkflowStarted } from "./workflow-sync";
import { buildTaskWorkflowViewModel } from "./workflow-view";

// ── Task Routes (BFF) ──────────────────────────────────────────────

type AppEnv = { Variables: { user: JWTPayload } };

export const taskRoutes = new Hono<AppEnv>();

type IntentClassification = ReturnType<typeof classifyIntent>;
type ResolvedModel = { providerId: string; modelId: string };
type SessionStartResult = Awaited<ReturnType<typeof createSession>>;

interface StartExecutionResponse {
  status: 200 | 403 | 409 | 502;
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

interface ExecutableTask {
  id: string;
  prompt: string;
  status: string;
  projectId: string;
  sessionId?: string | null;
  title: string;
  strategy?: string | null;
  selectedModel?: string | null;
  repoId?: string | null;
  repoName?: string | null;
  remoteUrl?: string | null;
  workingBranch?: string | null;
  credentialId?: string | null;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
}

interface TaskOperatingStateRecord {
  collaborationMode?: "solo" | "team" | "hybrid";
  autopilotLevel?: "L0" | "L1" | "L2";
  bossParticipationMode?: "disabled" | "advisory" | "exception-only" | "full-manager";
  operatingModeSource?: "system-default" | "project-default" | "task-override" | "boss-decision";
  currentStageKey?: string;
  currentStageStatus?: string;
}

interface OperatingModeSelectionRecord {
  collaborationMode: "solo" | "team" | "hybrid";
  autopilotLevel: "L0" | "L1" | "L2";
  bossParticipationMode: "disabled" | "advisory" | "exception-only" | "full-manager";
  selectedTemplateId?: string | null;
  scenarioKey?: string;
  source: "system-default" | "project-default" | "task-override" | "boss-decision";
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

type IdentitySnapshot = Record<string, unknown>;

interface PreparedExecutionContext {
  task: ExecutableTask;
  authorization: string;
  identitySnapshot: IdentitySnapshot;
  classification: IntentClassification;
  executionAgent: string;
  strategy: OrchestrationStrategy;
  plan: ExecutionPlan;
  workflowTemplateId: string | null;
  repoContext: ReturnType<typeof buildRepoContext>;
  resolvedModel?: ResolvedModel;
  effectiveModel?: string;
  paidExecutionGuard?: PaidExecutionGuardState;
}

interface ExecutionContext extends PreparedExecutionContext {
  prompt: string;
  hookExecutions: HookExecutionRecord[];
}

interface WorkflowPromptContextRecord {
  [key: string]: string | null | undefined;
  taskId: string;
  projectId: string;
  taskTitle: string;
  taskPrompt: string;
  repoName?: string | null;
  remoteUrl?: string | null;
  workingBranch?: string | null;
  workflowStatus?: string;
  currentStageKey?: string;
  currentStageLabel?: string;
  currentStageStatus?: string;
  completedStageSummaries?: string;
  openChangeRequestSummary?: string;
  activeRoleSummary?: string;
  selectedAgent?: string;
  selectedModel?: string;
  taskResult?: string;
  changesSummary?: string;
}

interface ParallelCandidateAttempt {
  index: number;
  sessionResult?: SessionStartResult;
}

interface ContinueTaskInput {
  taskId: string;
  prompt: string;
  overrideSessionId?: string;
  authorization: string;
}

function buildBlockedExecutionResponse(
  taskId: string,
  preflight: PaidExecutionPreflightResult,
): StartExecutionResponse {
  const status = preflight.estimate.guardDecision === "allow-with-downgrade" ? 409 : 403;

  return {
    status,
    body: {
      error: preflight.estimate.guardReason,
      code: preflight.code,
      taskId,
      allowed: false,
      effectiveModel: `${preflight.policy.providerId}:${preflight.policy.modelId}`,
      guardDecision: preflight.estimate.guardDecision,
      guardReason: preflight.estimate.guardReason,
      suggestedModel: preflight.policy.suggestedModel,
      activeLease: preflight.activeLease,
      requirements: preflight.requirements,
      policy: preflight.policy,
      preflight: preflight.estimate,
    },
  };
}

function buildPaidExecutionAuditDetail(
  preflight: PaidExecutionPreflightResult,
  guardState?: PaidExecutionGuardState,
  detail: Record<string, unknown> = {},
) {
  return {
    leaseId: preflight.requirements.leaseId,
    guardDecision: preflight.estimate.guardDecision,
    guardReason: preflight.estimate.guardReason,
    estimatedRequestUpperBound: preflight.estimate.requestCount.max,
    estimatedTokenUpperBound: preflight.estimate.totalTokens.max,
    estimatedCostUpperBound: preflight.estimate.costUsd.max,
    actualTokenUsage: guardState?.actualTokenUsage ?? 0,
    actualCost: guardState?.actualCost ?? 0,
    guardOverridesApplied: guardState?.overridesApplied ?? [],
    ...detail,
  };
}

async function buildContinuationPreflight(input: {
  task: ExecutableTask;
  authorization: string;
  resolvedModel?: ResolvedModel;
}) {
  const leaseResult = await fetchProjectPaidExecutionLeaseState(
    input.task.projectId,
    input.authorization,
  );
  if (!leaseResult.ok) {
    return {
      ok: false as const,
      status: leaseResult.status as 401 | 403 | 404 | 502,
      data: leaseResult.data,
    };
  }

  const continuationShape = {
    candidateCount: 1,
    judgeEnabled: false,
    enabledHookTriggers: [],
    suiteLabel: "task continue",
    suiteReference: `task=${input.task.id}:continue`,
  };
  const [continuationBaseline, continuationProjectResult] = await Promise.all([
    fetchProjectRuntimeUsageBaseline(input.task.projectId, input.authorization, {
      providerId: input.resolvedModel?.providerId,
      modelId: input.resolvedModel?.modelId,
      entrypointType: "single-task",
      orchestrationFingerprint: buildPreflightOrchestrationFingerprint(continuationShape),
    }),
    fetchProjectPaidExecutionSettings(input.task.projectId, input.authorization),
  ]);

  const preflight = evaluatePaidExecutionPreflight(
    {
      projectId: input.task.projectId,
      allowPaidExecution: continuationProjectResult.ok
        ? continuationProjectResult.data.settings?.allowPaidExecution === true
        : false,
      resolvedModel: input.resolvedModel,
      shape: continuationShape,
      baseline: continuationBaseline.ok ? continuationBaseline.data.baseline : null,
    },
    leaseResult.data,
  );

  return {
    ok: true as const,
    preflight,
    guard: preflight.policy.isPaid
      ? createPaidExecutionGuardState(preflight, ["judge-disabled", "post-hook-disabled"])
      : undefined,
  };
}

async function persistContinuationGuard(args: {
  taskId: string;
  authorization: string;
  strategy?: string | null;
  resolvedModel?: ResolvedModel;
  guard?: PaidExecutionGuardState;
}) {
  if (!args.guard?.enabled) {
    return { ok: true as const };
  }

  const patchResult = await cpFetch(`/api/tasks/${encodeURIComponent(args.taskId)}`, {
    method: "PATCH",
    authorization: args.authorization,
    body: {
      strategy: mergeTaskStrategy(args.strategy, {
        effectiveModel: args.resolvedModel
          ? `${args.resolvedModel.providerId}:${args.resolvedModel.modelId}`
          : undefined,
        paidExecutionGuard: args.guard,
      }),
    },
  });

  return patchResult.ok
    ? ({ ok: true as const } as const)
    : ({ ok: false as const, status: 502 as const, data: { error: "Failed to persist continuation guard configuration" } } as const);
}

async function continueTaskExecution(input: ContinueTaskInput) {
  const taskResult = await fetchExecutableTask(input.taskId, input.authorization);
  if (!taskResult.ok) {
    return { status: 404 as const, body: { error: "Task not found" } };
  }

  const task = taskResult.data;
  const sessionId = input.overrideSessionId || task.sessionId;
  if (!sessionId) {
    return { status: 400 as const, body: { error: "No session associated with this task" } };
  }

  const resolvedModel = await resolveExecutionModel(
    { ...task, prompt: input.prompt, status: "running" },
    input.authorization,
  );
  if (resolvedModel) {
    const modelValidationError = await validateResolvedModel(resolvedModel);
    if (modelValidationError) {
      return { status: modelValidationError.status, body: modelValidationError.body };
    }
  }

  const preflightResult = await buildContinuationPreflight({
    task,
    authorization: input.authorization,
    resolvedModel,
  });
  if (!preflightResult.ok) {
    return { status: preflightResult.status, body: preflightResult.data };
  }

  if (!preflightResult.preflight.allowed) {
    await recordPaidExecutionAuditEvent({
      projectId: task.projectId,
      taskId: input.taskId,
      sessionId,
      action: "continue_blocked",
      preflight: preflightResult.preflight,
      guardState: preflightResult.guard,
      riskLevel:
        preflightResult.preflight.estimate.guardDecision === "allow-with-downgrade"
          ? "medium"
          : "high",
    });
    const blockedResponse = buildBlockedExecutionResponse(input.taskId, preflightResult.preflight);
    return { status: blockedResponse.status, body: blockedResponse.body };
  }

  const guardPersistResult = await persistContinuationGuard({
    taskId: input.taskId,
    authorization: input.authorization,
    strategy: task.strategy,
    resolvedModel,
    guard: preflightResult.guard,
  });
  if (!guardPersistResult.ok) {
    return { status: guardPersistResult.status, body: guardPersistResult.data };
  }

  const agentRunId = ensureAgentRunForSession(sessionId, input.taskId, task.projectId, resolvedModel);
  const workflowContext = await buildWorkflowPromptContext(task, input.authorization, {
    selectedModel: resolvedModel
      ? `${resolvedModel.providerId}:${resolvedModel.modelId}`
      : undefined,
    taskResult: "",
    changesSummary: "",
  });
  const result = await continueSession(
    sessionId,
    prependWorkflowContextToPrompt(input.prompt, workflowContext),
    { model: resolvedModel },
  );
  if (!result.ok) {
    return { status: 502 as const, body: { error: result.error || "Failed to continue session" } };
  }

  await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    method: "PATCH",
    body: { status: "running" },
    authorization: input.authorization,
  });

  await recordPaidExecutionGuardStateEvent({
    projectId: task.projectId,
    taskId: input.taskId,
    sessionId,
    agentRunId,
    action: "continued",
    guardState: preflightResult.guard,
    detail: {
      effectiveModel: resolvedModel
        ? `${resolvedModel.providerId}:${resolvedModel.modelId}`
        : undefined,
    },
    riskLevel: preflightResult.guard?.enabled ? "medium" : undefined,
  });

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.continued",
    ts: new Date().toISOString(),
    taskId: input.taskId,
    projectId: task.projectId,
    agentRunId,
    data: { sessionId, agentRunId },
  });

  void buildPipelineStageUpdatedEvents({
    taskId: input.taskId,
    sessionId,
    projectId: task.projectId,
    agentRunId,
    authorization: input.authorization,
    reason: "task.continued",
  }).then((events) => {
    for (const event of events) {
      wsBroadcaster.broadcast(event);
    }
  });

  return { status: 200 as const, body: { ok: true, sessionId, agentRunId } };
}

async function recordPaidExecutionAuditEvent(args: {
  projectId: string;
  taskId: string;
  sessionId?: string;
  agentRunId?: string;
  action: string;
  preflight: PaidExecutionPreflightResult;
  guardState?: PaidExecutionGuardState;
  riskLevel?: "low" | "medium" | "high" | "critical";
  detail?: Record<string, unknown>;
}) {
  if (!args.preflight.policy.isPaid) {
    return;
  }

  await recordAgentAudit({
    projectId: args.projectId,
    taskId: args.taskId,
    sessionId: args.sessionId,
    agentRunId: args.agentRunId,
    eventType: "paid_execution",
    action: args.action,
    detail: buildPaidExecutionAuditDetail(args.preflight, args.guardState, args.detail),
    riskLevel: args.riskLevel,
  });
}

async function recordPaidExecutionGuardStateEvent(args: {
  projectId: string;
  taskId: string;
  sessionId?: string;
  agentRunId?: string;
  action: string;
  guardState?: PaidExecutionGuardState;
  detail?: Record<string, unknown>;
  riskLevel?: "low" | "medium" | "high" | "critical";
}) {
  if (!args.guardState?.enabled) {
    return;
  }

  await recordAgentAudit({
    projectId: args.projectId,
    taskId: args.taskId,
    sessionId: args.sessionId,
    agentRunId: args.agentRunId,
    eventType: "paid_execution",
    action: args.action,
    detail: {
      leaseId: args.guardState.leaseId,
      guardDecision: args.guardState.guardDecision,
      guardReason: args.guardState.guardReason,
      estimatedRequestUpperBound: args.guardState.estimatedRequestUpperBound,
      estimatedTokenUpperBound: args.guardState.estimatedTokenUpperBound,
      estimatedCostUpperBound: args.guardState.estimatedCostUpperBound,
      actualTokenUsage: args.guardState.actualTokenUsage,
      actualCost: args.guardState.actualCost,
      guardOverridesApplied: args.guardState.overridesApplied,
      ...args.detail,
    },
    riskLevel: args.riskLevel,
  });
}

function collapseExecutionPlanToSingle(plan: ExecutionPlan, executionAgent: string): ExecutionPlan {
  const primaryCandidate = plan.candidates[0];
  return {
    templateId: plan.templateId,
    mode: "single",
    steps: [{ id: "exec-0", type: "execution" as const, status: "pending" as const }],
    candidates: [
      {
        label: primaryCandidate?.label || "主执行",
        agent: primaryCandidate?.agent || executionAgent,
        role: primaryCandidate?.role,
        model: primaryCandidate?.model,
        status: "pending" as const,
      },
    ],
  };
}

function applyPaidExecutionSafetyOverlay(context: PreparedExecutionContext): {
  context: PreparedExecutionContext;
  overridesApplied: PaidExecutionOverride[];
} {
  const overridesApplied: PaidExecutionOverride[] = [];

  const safePlan = isParallelExecution(context.plan)
    ? (() => {
        overridesApplied.push("parallel-collapsed");
        return collapseExecutionPlanToSingle(context.plan, context.executionAgent);
      })()
    : {
        ...context.plan,
        mode: "single" as const,
        steps: [{ id: "exec-0", type: "execution" as const, status: "pending" as const }],
        candidates: [
          {
            ...(context.plan.candidates[0] || {
              label: "主执行",
              agent: context.executionAgent,
            }),
            status: "pending" as const,
          },
        ],
        judgeResult: undefined,
        winnerCandidateIndex: undefined,
      };

  if (context.strategy.hooks.some((hook) => hook.enabled && hook.trigger === "post-execution")) {
    overridesApplied.push("post-hook-disabled");
  }
  if (context.strategy.judge.enabled) {
    overridesApplied.push("judge-disabled");
  }

  return {
    context: {
      ...context,
      plan: safePlan,
      strategy: {
        ...context.strategy,
        judge: {
          ...context.strategy.judge,
          enabled: false,
        },
        hooks: context.strategy.hooks.map((hook) =>
          hook.enabled && hook.trigger === "post-execution" ? { ...hook, enabled: false } : hook,
        ),
      },
    },
    overridesApplied,
  };
}

async function preparePaidExecutionContext(
  context: PreparedExecutionContext,
  authorization: string,
): Promise<
  | { ok: true; context: PreparedExecutionContext; preflight: PaidExecutionPreflightResult }
  | { ok: false; status: number; data: Record<string, unknown> }
> {
  const rawPreflight = await buildTaskExecutionPreflight(context, authorization);
  if (!rawPreflight.ok) {
    return {
      ok: false,
      status: rawPreflight.status,
      data: rawPreflight.data as unknown as Record<string, unknown>,
    };
  }

  if (!rawPreflight.data.policy.isPaid) {
    return {
      ok: true,
      context,
      preflight: rawPreflight.data,
    };
  }

  const overlay = applyPaidExecutionSafetyOverlay(context);
  const safePreflight = await buildTaskExecutionPreflight(overlay.context, authorization);
  if (!safePreflight.ok) {
    return {
      ok: false,
      status: safePreflight.status,
      data: safePreflight.data as unknown as Record<string, unknown>,
    };
  }

  return {
    ok: true,
    context: {
      ...overlay.context,
      paidExecutionGuard: createPaidExecutionGuardState(
        safePreflight.data,
        overlay.overridesApplied,
      ),
    },
    preflight: safePreflight.data,
  };
}

async function persistPaidExecutionConfiguration(context: PreparedExecutionContext) {
  if (!context.paidExecutionGuard?.enabled) {
    return true;
  }

  const result = await cpFetch(`/api/tasks/${encodeURIComponent(context.task.id)}`, {
    method: "PATCH",
    authorization: context.authorization,
    body: {
      executionMode: context.plan.mode,
      executionPlan: JSON.stringify(context.plan),
      strategy: mergeTaskStrategy(context.task.strategy, {
        selectedTemplateId: context.plan.templateId,
        workflowTemplateId: context.workflowTemplateId,
        selectedAgent: context.executionAgent,
        effectiveModel: context.effectiveModel,
        executionMode: context.plan.mode,
        paidExecutionGuard: context.paidExecutionGuard,
      }),
    },
  });

  return result.ok;
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

async function fetchProjectPaidExecutionSettings(projectId: string, authorization: string) {
  return cpFetch<{ settings?: { allowPaidExecution?: boolean } }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      authorization,
    },
  );
}

async function buildTaskExecutionPreflight(
  context: PreparedExecutionContext,
  authorization: string,
) {
  const leaseResult = await fetchProjectPaidExecutionLeaseState(
    context.task.projectId,
    authorization,
  );
  if (!leaseResult.ok) {
    return {
      ok: false as const,
      status: leaseResult.status,
      data: leaseResult.data,
    };
  }

  const enabledHookTriggers = context.strategy.hooks
    .filter((hook) => hook.enabled && hook.trigger !== "pre-resume")
    .map((hook) => hook.trigger);
  const shape = {
    candidateCount: Math.max(1, context.plan.candidates.length),
    judgeEnabled: context.strategy.judge.enabled && context.plan.candidates.length > 1,
    enabledHookTriggers,
    suiteLabel: "single-task execute",
    suiteReference: `task=${context.task.id}`,
  };
  const baselineResult = await fetchProjectRuntimeUsageBaseline(
    context.task.projectId,
    authorization,
    {
      providerId: context.resolvedModel?.providerId,
      modelId: context.resolvedModel?.modelId,
      entrypointType: "single-task",
      orchestrationFingerprint: buildPreflightOrchestrationFingerprint(shape),
    },
  );
  const projectResult = await fetchProjectPaidExecutionSettings(
    context.task.projectId,
    authorization,
  );

  return {
    ok: true as const,
    status: 200 as const,
    data: evaluatePaidExecutionPreflight(
      {
        projectId: context.task.projectId,
        allowPaidExecution: projectResult.ok
          ? projectResult.data.settings?.allowPaidExecution === true
          : false,
        resolvedModel: context.resolvedModel,
        shape,
        baseline: baselineResult.ok ? baselineResult.data.baseline : null,
      },
      leaseResult.data,
    ),
  };
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
  task: ExecutableTask,
  execResult: { sessionId?: string; agentRunId?: string },
  classification: ReturnType<typeof classifyIntent>,
  identitySnapshot: IdentitySnapshot,
  executionMeta: {
    selectedAgent: string;
    effectiveModel?: string;
    plan?: ExecutionPlan;
    workflowTemplateId?: string | null;
    hookExecutions?: HookExecutionRecord[];
    paidExecutionGuard?: PaidExecutionGuardState;
  },
) {
  return {
    status: "running",
    sessionId: execResult.sessionId,
    agentRunId: execResult.agentRunId,
    category: classification.category,
    executionMode: executionMeta.plan?.mode ?? "single",
    executionPlan: executionMeta.plan ? JSON.stringify(executionMeta.plan) : undefined,
    strategy: mergeTaskStrategy(task.strategy, {
      selectedTemplateId: executionMeta.plan?.templateId,
      workflowTemplateId: executionMeta.workflowTemplateId,
      complexity: classification.complexity,
      suggestedAgents: classification.suggestedAgents,
      requiresPlan: classification.requiresPlan,
      confidence: classification.confidence,
      selectedAgent: executionMeta.selectedAgent,
      effectiveModel: executionMeta.effectiveModel,
      executionMode: executionMeta.plan?.mode,
      hookExecutions: executionMeta.hookExecutions,
      paidExecutionGuard: executionMeta.paidExecutionGuard,
    }),
    ...identitySnapshot,
  };
}

async function buildWorkflowPromptContext(
  task: ExecutableTask,
  authorization: string,
  extras: Record<string, string | undefined | null>,
): Promise<WorkflowPromptContextRecord> {
  let workflowStatus: string | undefined;
  let currentStageKey: string | undefined;
  let currentStageLabel: string | undefined;
  let currentStageStatus: string | undefined;
  let completedStageSummaries: string | undefined;
  let openChangeRequestSummary: string | undefined;
  let activeRoleSummary: string | undefined;

  try {
    const workflowView = await buildTaskWorkflowViewModel(task.id, authorization, {
      projectId: task.projectId,
      taskStatus: task.status,
    });
    workflowStatus = workflowView.workflow.status;
    currentStageKey = workflowView.workflow.currentStage;
    const currentStage = workflowView.workflow.stages.find(
      (stage) => stage.stageKey === workflowView.workflow.currentStage,
    );
    currentStageLabel = currentStage?.stageLabel;
    currentStageStatus = currentStage?.status;
    const completedStages = workflowView.workflow.stages
      .filter((stage) => stage.status === "completed")
      .map((stage) => `${stage.stageLabel}(${stage.stageKey})`);
    completedStageSummaries = completedStages.length > 0 ? completedStages.join(" -> ") : undefined;
    const openRequests = workflowView.developerChangeRequests.filter(
      (item) => item.status !== "resolved",
    );
    if (openRequests.length > 0) {
      openChangeRequestSummary = openRequests
        .slice(0, 3)
        .map((item) => `${item.sourceRoleLabel}:${item.title}`)
        .join("; ");
    }
    const activeRoles = Array.from(
      new Set(
        workflowView.roleConclusions
          .filter((item) => item.stage === workflowView.workflow.currentStage)
          .map((item) => item.roleLabel),
      ),
    );
    activeRoleSummary = activeRoles.length > 0 ? activeRoles.join(" / ") : undefined;
  } catch {
    // Workflow context is additive; execution can proceed without it.
  }

  return {
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    repoName: task.repoName,
    remoteUrl: task.remoteUrl,
    workingBranch: task.workingBranch,
    workflowStatus,
    currentStageKey,
    currentStageLabel,
    currentStageStatus,
    completedStageSummaries,
    openChangeRequestSummary,
    activeRoleSummary,
    ...extras,
  };
}

function prependWorkflowContextToPrompt(
  prompt: string,
  context: WorkflowPromptContextRecord,
): string {
  const lines = [
    "Workflow execution context:",
    `- Task: ${context.taskTitle}`,
    context.workflowStatus ? `- Workflow status: ${context.workflowStatus}` : undefined,
    context.currentStageLabel || context.currentStageKey
      ? `- Current stage: ${context.currentStageLabel || context.currentStageKey}${context.currentStageStatus ? ` (${context.currentStageStatus})` : ""}`
      : undefined,
    context.activeRoleSummary ? `- Active roles in stage: ${context.activeRoleSummary}` : undefined,
    context.completedStageSummaries
      ? `- Completed stages: ${context.completedStageSummaries}`
      : undefined,
    context.openChangeRequestSummary
      ? `- Open change requests: ${context.openChangeRequestSummary}`
      : undefined,
    context.selectedAgent ? `- Execution agent: ${context.selectedAgent}` : undefined,
    context.selectedModel ? `- Execution model: ${context.selectedModel}` : undefined,
    "",
    "Follow the current workflow stage as the primary execution boundary. If the request spans multiple steps, keep the output aligned to the current stage and only prepare the next stage when the current stage is complete.",
  ].filter(Boolean);

  return `${lines.join("\n")}\n\n${prompt}`;
}

async function runPreExecutionHooks(
  task: ExecutableTask,
  repoContext: ReturnType<typeof buildRepoContext>,
  executionAgent: string,
  effectiveModel: string | undefined,
  authorization: string,
) {
  const strategy = readOrchestrationStrategy();
  let breakerReason: string | undefined;
  const workflowContext = await buildWorkflowPromptContext(task, authorization, {
    selectedAgent: executionAgent,
    selectedModel: effectiveModel,
    taskResult: "",
    changesSummary: "",
  });
  const hookResult = await executeLifecycleHooks({
    strategy,
    trigger: "pre-execution",
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    titlePrefix: "Preflight",
    repoContext,
    context: workflowContext,
    onHookExecuted: async (execution) => {
      if (
        !execution.sessionId ||
        !execution.model ||
        !execution.tokenUsed ||
        execution.tokenUsed <= 0
      ) {
        return;
      }

      const outcome = await recordPaidExecutionRuntimeUsage({
        authorization,
        taskId: task.id,
        projectId: task.projectId,
        sessionId: execution.sessionId,
        modelRoute: execution.model,
        tokenUsed: execution.tokenUsed,
        requestDelta: 1,
        action: "pre_execution_usage_recorded",
        runtimeLedger: {
          executionSource: "task-pre-execution-hook",
          entrypointType: "hook-only",
          hookRequestCountDelta: 1,
          status: execution.status === "failed" ? "failed" : "completed",
          finishedAt: execution.completedAt,
          step: {
            stepType: "hook",
            triggerType: execution.trigger,
            hookId: execution.hookId,
            amplificationSource: "hook",
            status:
              execution.status === "failed"
                ? "failed"
                : execution.status === "skipped"
                  ? "skipped"
                  : "completed",
            finishedAt: execution.completedAt,
          },
        },
        detail: {
          hookId: execution.hookId,
          trigger: execution.trigger,
          status: execution.status,
          agent: execution.agent,
        },
        riskLevel: "medium",
      });

      if (outcome.tripped) {
        breakerReason =
          outcome.breakerReason || "paid execution breaker tripped during pre-execution hooks";
        return {
          stop: true,
          reason: breakerReason,
        };
      }
    },
  });

  if (hookResult.hookExecutions.length === 0) {
    return {
      prompt: prependWorkflowContextToPrompt(task.prompt, workflowContext),
      hookExecutions: [] as HookExecutionRecord[],
    };
  }

  if (hookResult.rewrittenPrompt) {
    return {
      prompt: prependWorkflowContextToPrompt(hookResult.rewrittenPrompt, workflowContext),
      hookExecutions: hookResult.hookExecutions,
      breakerReason,
    };
  }

  // Default: prepend the review as context for the execution agent
  const promptWithReview = [
    prependWorkflowContextToPrompt("", workflowContext).trim(),
    "Pre-execution assessment from the configured review agent:",
    hookResult.combinedResultText || "",
    "",
    "Original task:",
    task.prompt,
  ].join("\n\n");

  return {
    prompt: promptWithReview,
    hookExecutions: hookResult.hookExecutions,
    breakerReason,
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

/**
 * Build a minimal session record from CP data only — no OpenCode calls.
 * Used when OpenCode is unreachable to avoid cascading timeouts.
 */
function buildCpOnlyFallbackSession(
  taskId: string,
  task: {
    sessionId?: string;
    title?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
  },
): SessionSummaryRecord | null {
  if (!task.sessionId) return null;
  return {
    id: task.sessionId,
    title: task.title
      ? `[Task ${taskId.slice(0, 8)}] ${task.title}`
      : `[Task ${taskId.slice(0, 8)}] 主会话`,
    isActive: task.status === "running",
    summary: null,
    createdAt: task.createdAt ?? null,
    updatedAt: task.updatedAt ?? null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeBossDecisionRecord(value: unknown, index: number): BossDecisionRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    id: asNonEmptyString(record.id) || `boss-decision-${index + 1}`,
    ts: asNonEmptyString(record.ts) || new Date(0).toISOString(),
    decisionType: asNonEmptyString(record.decisionType) || "unknown",
    reason: asNonEmptyString(record.reason) || "",
    confidence: typeof record.confidence === "number" ? record.confidence : undefined,
    stageKey: asNonEmptyString(record.stageKey),
    metadata: asRecord(record.metadata) || undefined,
  };
}

function normalizeHumanEscalationRequest(
  value: unknown,
  index: number,
): HumanEscalationRequest | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    id: asNonEmptyString(record.id) || `human-escalation-${index + 1}`,
    ts: asNonEmptyString(record.ts) || new Date(0).toISOString(),
    reason: asNonEmptyString(record.reason) || "",
    status: asNonEmptyString(record.status),
    stageKey: asNonEmptyString(record.stageKey),
    requestedBy: asNonEmptyString(record.requestedBy),
    metadata: asRecord(record.metadata) || undefined,
  };
}

function buildTaskOperatingState(task: Pick<ExecutableTask, "strategy">): TaskOperatingStateRecord {
  const strategy = parseTaskStrategy(task.strategy);
  return {
    collaborationMode:
      strategy.collaborationMode === "solo" ||
      strategy.collaborationMode === "team" ||
      strategy.collaborationMode === "hybrid"
        ? strategy.collaborationMode
        : undefined,
    autopilotLevel:
      strategy.autopilotLevel === "L0" ||
      strategy.autopilotLevel === "L1" ||
      strategy.autopilotLevel === "L2"
        ? strategy.autopilotLevel
        : undefined,
    bossParticipationMode:
      strategy.bossParticipationMode === "disabled" ||
      strategy.bossParticipationMode === "advisory" ||
      strategy.bossParticipationMode === "exception-only" ||
      strategy.bossParticipationMode === "full-manager"
        ? strategy.bossParticipationMode
        : undefined,
    operatingModeSource:
      strategy.operatingModeSource === "system-default" ||
      strategy.operatingModeSource === "project-default" ||
      strategy.operatingModeSource === "task-override" ||
      strategy.operatingModeSource === "boss-decision"
        ? strategy.operatingModeSource
        : undefined,
    currentStageKey: asNonEmptyString(strategy.currentStageKey),
    currentStageStatus: asNonEmptyString(strategy.currentStageStatus),
  };
}

function buildLegacyOperatingMode(
  task: Pick<ExecutableTask, "strategy">,
): OperatingModeSelectionRecord | null {
  const strategy = parseTaskStrategy(task.strategy);
  const state = buildTaskOperatingState(task);
  if (!state.collaborationMode || !state.autopilotLevel || !state.bossParticipationMode) {
    return null;
  }

  return {
    collaborationMode: state.collaborationMode,
    autopilotLevel: state.autopilotLevel,
    bossParticipationMode: state.bossParticipationMode,
    selectedTemplateId:
      asNonEmptyString(strategy.selectedTemplateId) ||
      asNonEmptyString(strategy.workflowTemplateId) ||
      null,
    scenarioKey: asNonEmptyString(strategy.scenarioKey),
    source: state.operatingModeSource || "task-override",
  };
}

function extractBossDecisions(task: Pick<ExecutableTask, "strategy">) {
  const strategy = parseTaskStrategy(task.strategy);
  return Array.isArray(strategy.bossDecisions)
    ? strategy.bossDecisions
        .map(normalizeBossDecisionRecord)
        .filter((item): item is BossDecisionRecord => Boolean(item))
    : [];
}

function extractEscalationRequests(task: Pick<ExecutableTask, "strategy">) {
  const strategy = parseTaskStrategy(task.strategy);
  return Array.isArray(strategy.escalationRequests)
    ? strategy.escalationRequests
        .map(normalizeHumanEscalationRequest)
        .filter((item): item is HumanEscalationRequest => Boolean(item))
    : [];
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
  const workflowTemplateId = await resolveTaskWorkflowTemplateId(task, authorization);
  const repoContext = buildRepoContext(task, identitySnapshot);

  return {
    task,
    authorization,
    identitySnapshot,
    classification,
    executionAgent,
    strategy,
    plan,
    workflowTemplateId,
    repoContext,
    resolvedModel,
    effectiveModel: resolvedModel
      ? `${resolvedModel.providerId}:${resolvedModel.modelId}`
      : undefined,
  };
}

async function finalizePreExecutionContext(
  context: PreparedExecutionContext,
): Promise<{ ok: true; context: ExecutionContext } | { ok: false; reason: string }> {
  const preExecutionHooks = await runPreExecutionHooks(
    context.task,
    context.repoContext,
    context.executionAgent,
    context.effectiveModel,
    context.authorization,
  );

  if (preExecutionHooks.breakerReason) {
    return {
      ok: false,
      reason: preExecutionHooks.breakerReason,
    };
  }

  return {
    ok: true,
    context: {
      ...context,
      prompt: preExecutionHooks.prompt,
      hookExecutions: [...preExecutionHooks.hookExecutions],
    },
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
    body: buildTaskPatchBody(
      context.task,
      execResult,
      context.classification,
      context.identitySnapshot,
      {
        selectedAgent: context.executionAgent,
        effectiveModel: context.effectiveModel,
        plan: context.plan,
        workflowTemplateId: context.workflowTemplateId,
        hookExecutions: context.hookExecutions,
        paidExecutionGuard: context.paidExecutionGuard,
      },
    ),
    authorization: context.authorization,
  });

  await ensureTaskWorkflowStarted({
    authorization: context.authorization,
    taskId: context.task.id,
    templateId: context.workflowTemplateId,
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
  await recordPaidExecutionGuardStateEvent({
    projectId: context.task.projectId,
    taskId: context.task.id,
    sessionId: execResult.sessionId,
    agentRunId: execResult.agentRunId,
    action: "started",
    guardState: context.paidExecutionGuard,
    detail: {
      executionMode: context.plan.mode,
      effectiveModel: context.effectiveModel,
    },
    riskLevel: context.paidExecutionGuard?.enabled ? "medium" : undefined,
  });
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

taskRoutes.get("/:taskId/operating-state", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch<TaskOperatingStateRecord>(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/state`,
    {
      authorization: authHeader(c),
    },
  );

  if (result.ok) {
    return c.json(result.data);
  }

  const legacyTaskResult = await cpFetch<ExecutableTask>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    {
      authorization: authHeader(c),
    },
  );

  if (!legacyTaskResult.ok) {
    return c.json(result.data, legacyTaskResult.status as 401 | 404 | 502);
  }

  return c.json(buildTaskOperatingState(legacyTaskResult.data || {}));
});

taskRoutes.get("/:taskId/operating-mode", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch<{ data?: OperatingModeSelectionRecord | null }>(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/mode`,
    {
      authorization: authHeader(c),
    },
  );

  if (result.ok) {
    return c.json(result.data);
  }

  const legacyTaskResult = await cpFetch<ExecutableTask>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    {
      authorization: authHeader(c),
    },
  );
  if (!legacyTaskResult.ok) {
    return c.json(result.data, legacyTaskResult.status as 401 | 404 | 502);
  }

  return c.json({ data: buildLegacyOperatingMode(legacyTaskResult.data || {}) });
});

const taskOperatingModeSchema = z.object({
  collaborationMode: z.enum(["solo", "team", "hybrid"]),
  autopilotLevel: z.enum(["L0", "L1", "L2"]),
  bossParticipationMode: z.enum(["disabled", "advisory", "exception-only", "full-manager"]),
  selectedTemplateId: z.string().min(1).nullable().optional(),
  scenarioKey: z.string().min(1).optional(),
  source: z.enum(["system-default", "project-default", "task-override", "boss-decision"]),
});

taskRoutes.put(
  "/:taskId/operating-mode",
  zValidator("json", taskOperatingModeSchema),
  async (c) => {
    const taskId = c.req.param("taskId");
    const body = c.req.valid("json");
    const result = await cpFetch(
      `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/mode`,
      {
        method: "PUT",
        body,
        authorization: authHeader(c),
      },
    );
    return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 404 | 502));
  },
);

taskRoutes.delete("/:taskId/operating-mode", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/mode`, {
    method: "DELETE",
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

taskRoutes.get("/:taskId/boss-decisions", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch<{ data: BossDecisionRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/boss-decisions`,
    {
      authorization: authHeader(c),
    },
  );

  if (result.ok) {
    return c.json(result.data);
  }

  const legacyTaskResult = await cpFetch<ExecutableTask>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    {
      authorization: authHeader(c),
    },
  );

  if (!legacyTaskResult.ok) {
    return c.json(result.data, legacyTaskResult.status as 401 | 404 | 502);
  }

  return c.json({ data: extractBossDecisions(legacyTaskResult.data || {}) });
});

const bossDecisionSchema = z.object({
  ts: z.string().datetime().optional(),
  decisionType: z.string().min(1),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  stageKey: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

taskRoutes.post("/:taskId/boss-decisions", zValidator("json", bossDecisionSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");
  const result = await cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/boss-decisions`,
    {
      method: "POST",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 404 | 502));
});

taskRoutes.get("/:taskId/escalations", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch<{ data: HumanEscalationRequest[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/escalations`,
    {
      authorization: authHeader(c),
    },
  );

  if (result.ok) {
    return c.json(result.data);
  }

  const legacyTaskResult = await cpFetch<ExecutableTask>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    {
      authorization: authHeader(c),
    },
  );

  if (!legacyTaskResult.ok) {
    return c.json(result.data, legacyTaskResult.status as 401 | 404 | 502);
  }

  return c.json({ data: extractEscalationRequests(legacyTaskResult.data || {}) });
});

const escalationSchema = z.object({
  ts: z.string().datetime().optional(),
  reason: z.string().min(1),
  status: z.string().min(1).optional(),
  stageKey: z.string().min(1).optional(),
  requestedBy: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

taskRoutes.post("/:taskId/escalations", zValidator("json", escalationSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");
  const result = await cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/escalations`,
    {
      method: "POST",
      body,
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 404 | 502));
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
  const result = await cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/developer-change-requests`,
    {
      authorization: authHeader(c),
    },
  );
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
    const result = await cpFetch(
      `/api/tasks/${encodeURIComponent(taskId)}/developer-change-requests`,
      {
        method: "PATCH",
        body,
        authorization: authHeader(c),
      },
    );
    return c.json(result.data, result.ok ? 200 : (result.status as 400 | 401 | 404 | 502));
  },
);

taskRoutes.get(":taskId/workflow-view", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);
  const taskResult = await cpFetch<{ projectId?: string | null; status?: string | null }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    {
      authorization,
    },
  );
  if (!taskResult.ok) {
    return c.json(taskResult.data, taskResult.status as 401 | 404 | 502);
  }

  const view = await buildTaskWorkflowViewModel(taskId, authorization, {
    projectId: taskResult.data?.projectId,
    taskStatus: taskResult.data?.status,
  });
  return c.json(view);
});

const updateTaskSchema = z.object({
  selectedModel: z.string().max(200).nullable().optional(),
  status: z.enum(["running", "paused", "completed", "failed", "cancelled"]).optional(),
  sessionId: z.string().optional(),
  agentRunId: z.string().optional(),
  result: z.string().optional(),
  category: z.enum(["quick", "deep", "ops", "security", "architecture"]).optional(),
  strategy: z.string().optional(),
  executionMode: z.enum(["single", "parallel"]).optional(),
  executionPlan: z.string().optional(),
  workspaceRoot: z.string().optional(),
  baseRevision: z.string().optional(),
  workingBranch: z.string().optional(),
  credentialId: z.string().optional(),
  gitAuthorName: z.string().max(200).optional(),
  gitAuthorEmail: z.string().email().max(200).optional(),
  gitCommitterName: z.string().max(200).optional(),
  gitCommitterEmail: z.string().email().max(200).optional(),
  finalCommitSha: z.string().max(200).optional(),
  finalBranchName: z.string().max(200).optional(),
  changesSummary: z
    .object({
      filesAdded: z.number().int().optional(),
      filesModified: z.number().int().optional(),
      filesDeleted: z.number().int().optional(),
      totalInsertions: z.number().int().optional(),
      totalDeletions: z.number().int().optional(),
    })
    .optional(),
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
  gitCommitterName: z.string().max(200).optional(),
  gitCommitterEmail: z.string().email().max(200).optional(),
  relations: z
    .array(
      z.object({
        sourceTaskId: z.string().min(1).optional(),
        targetTaskId: z.string().min(1).optional(),
        type: z.enum(["depends-on", "blocks", "spawned-from"]),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
  relationContext: z
    .object({
      spawnedFromTaskId: z.string().min(1).optional(),
      dependsOnTaskIds: z.array(z.string().min(1)).optional(),
      blockedByTaskIds: z.array(z.string().min(1)).optional(),
      blocksTaskIds: z.array(z.string().min(1)).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .optional(),
  operatingMode: taskOperatingModeSchema.optional(),
});

async function fetchProjectWorkflowTemplateId(projectId: string, authorization: string) {
  const projectResult = await cpFetch<{ settings?: { workflowTemplateId?: string | null } }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    { authorization },
  );

  if (!projectResult.ok) {
    return null;
  }

  return typeof projectResult.data?.settings?.workflowTemplateId === "string" &&
    projectResult.data.settings.workflowTemplateId.trim()
    ? projectResult.data.settings.workflowTemplateId.trim()
    : null;
}

async function snapshotTaskWorkflowTemplate(
  taskId: string,
  projectId: string,
  authorization: string,
  selectedTemplateId?: string | null,
) {
  const workflowTemplateId =
    selectedTemplateId || (await fetchProjectWorkflowTemplateId(projectId, authorization));

  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    authorization,
    body: {
      strategy: mergeTaskStrategy(undefined, {
        workflowTemplateId,
      }),
    },
  });

  return workflowTemplateId;
}

async function resolveTaskWorkflowTemplateId(task: ExecutableTask, authorization: string) {
  const operatingModeResult = await cpFetch<{ data?: OperatingModeSelectionRecord | null }>(
    `/api/tasks/${encodeURIComponent(task.id)}/operating-runtime/mode`,
    {
      authorization,
    },
  );
  const selectedRuntimeTemplateId =
    typeof operatingModeResult.data?.data?.selectedTemplateId === "string" &&
    operatingModeResult.data.data.selectedTemplateId.trim()
      ? operatingModeResult.data.data.selectedTemplateId.trim()
      : null;
  if (operatingModeResult.ok && selectedRuntimeTemplateId) {
    return selectedRuntimeTemplateId;
  }

  const parsedStrategy = parseTaskStrategy(task.strategy);
  if (
    typeof parsedStrategy.selectedTemplateId === "string" &&
    parsedStrategy.selectedTemplateId.trim()
  ) {
    return parsedStrategy.selectedTemplateId.trim();
  }
  if (Object.prototype.hasOwnProperty.call(parsedStrategy, "workflowTemplateId")) {
    return typeof parsedStrategy.workflowTemplateId === "string" &&
      parsedStrategy.workflowTemplateId.trim()
      ? parsedStrategy.workflowTemplateId.trim()
      : null;
  }

  return fetchProjectWorkflowTemplateId(task.projectId, authorization);
}

taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const body = c.req.valid("json");
  const authorization = authHeader(c);

  const { operatingMode, ...taskCreateBody } = body;

  const result = await cpFetch<{ id: string; status: string }>("/api/tasks", {
    method: "POST",
    body: taskCreateBody,
    authorization,
  });

  if (result.ok) {
    await snapshotTaskWorkflowTemplate(
      result.data.id,
      body.projectId,
      authorization,
      operatingMode?.selectedTemplateId ?? null,
    );
    if (operatingMode) {
      await cpFetch(`/api/tasks/${encodeURIComponent(result.data.id)}/operating-runtime/mode`, {
        method: "PUT",
        body: operatingMode,
        authorization,
      });
    }
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

taskRoutes.get("/:taskId/execute/preflight", async (c) => {
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

  const preflightResult = await buildTaskExecutionPreflight(preparedContext, authorization);
  if (!preflightResult.ok) {
    return c.json(preflightResult.data, preflightResult.status as 401 | 403 | 404 | 502);
  }

  const preflight = preflightResult.data;

  return c.json({
    taskId,
    allowed: preflight.allowed,
    effectiveModel: preparedContext.effectiveModel,
    activeLease: preflight.activeLease,
    policy: preflight.policy,
    requirements: preflight.requirements,
    preflight: preflight.estimate,
  });
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

  const guardPreparation = await preparePaidExecutionContext(preparedContext, authorization);
  if (!guardPreparation.ok) {
    return c.json(guardPreparation.data, guardPreparation.status as 401 | 403 | 404 | 502);
  }

  const preflight = guardPreparation.preflight;
  if (!preflight.allowed) {
    await recordPaidExecutionAuditEvent({
      projectId: preparedContext.task.projectId,
      taskId,
      action: "blocked",
      preflight,
      guardState: guardPreparation.ok ? guardPreparation.context.paidExecutionGuard : undefined,
      riskLevel: preflight.estimate.guardDecision === "allow-with-downgrade" ? "medium" : "high",
    });
    const blockedResponse = buildBlockedExecutionResponse(taskId, preflight);
    return c.json(blockedResponse.body, blockedResponse.status);
  }

  if (!(await persistPaidExecutionConfiguration(guardPreparation.context))) {
    return c.json({ error: "Failed to persist paid execution guard configuration" }, 502);
  }

  const executionContextResult = await finalizePreExecutionContext(guardPreparation.context);
  if (!executionContextResult.ok) {
    return c.json(
      {
        error: executionContextResult.reason,
        code: "PAID_EXECUTION_BREAKER_TRIPPED",
        taskId,
        allowed: false,
      },
      409,
    );
  }

  const executionContext = executionContextResult.context;
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
  const authorization = authHeader(c);

  // Get task to find its sessionId
  const taskResult = await cpFetch<{ sessionId?: string; title?: string; status?: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );

  if (!taskResult.ok) {
    return c.json({ data: [] });
  }

  const lineageResult = await cpFetch<{ data: TaskSessionRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/task-sessions`,
    { authorization },
  );

  const lineageRecords: TaskSessionRecord[] =
    lineageResult.ok && Array.isArray(lineageResult.data?.data)
      ? lineageResult.data.data.filter((record) => !record.archivedAt)
      : [];

  const runtimeMap = await fetchRuntimeSessionMap(100);

  if (lineageRecords.length > 0) {
    const { records: normalizedRecords, repaired } = normalizeLineageRecords(lineageRecords);
    if (repaired.length > 0) {
      await persistLineageRepairs(taskId, repaired, authorization);
    }

    const sessions = normalizedRecords.map((record) => {
      const runtime = runtimeMap.get(record.runtimeSessionId);
      return {
        id: record.runtimeSessionId,
        title: runtime?.title ?? record.branchName ?? "",
        isActive: record.isActive || record.runtimeSessionId === taskResult.data?.sessionId,
        summary: runtime?.summary ?? null,
        createdAt: runtime?.createdAt ?? record.createdAt ?? null,
        updatedAt: runtime?.updatedAt ?? record.updatedAt ?? null,
      } satisfies SessionSummaryRecord;
    });

    return c.json({ data: sessions });
  }

  const synthesizedRecords = synthesizeLineageRecordsFromRuntime(
    taskId,
    taskResult.data?.sessionId,
    runtimeMap,
  );

  if (synthesizedRecords.length > 0) {
    await persistLineageRepairs(taskId, synthesizedRecords, authorization);
    return c.json({
      data: synthesizedRecords.map((record) => {
        const runtime = runtimeMap.get(record.runtimeSessionId);
        return {
          id: record.runtimeSessionId,
          title: runtime?.title ?? record.branchName ?? "",
          isActive: record.isActive,
          summary: runtime?.summary ?? null,
          createdAt: runtime?.createdAt ?? record.createdAt ?? null,
          updatedAt: runtime?.updatedAt ?? record.updatedAt ?? null,
        } satisfies SessionSummaryRecord;
      }),
    });
  }

  const fallback = buildCpOnlyFallbackSession(taskId, taskResult.data || {});
  return c.json({ data: fallback ? [fallback] : [] });
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
  const authorization = authHeader(c);
  const result = await continueTaskExecution({
    taskId,
    prompt,
    overrideSessionId,
    authorization,
  });
  return c.json(result.body, result.status);
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

    const defaultTitle =
      title || `[Task ${taskId.slice(0, 8)}] Fork ${new Date().toLocaleTimeString()}`;
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

    const existingScore =
      Number(Boolean(existing.parentRuntimeSessionId)) +
      Number(Boolean(existing.forkedFromMessageId));
    const nextScore =
      Number(Boolean(record.parentRuntimeSessionId)) + Number(Boolean(record.forkedFromMessageId));
    const existingUpdated = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    const nextUpdated = record.updatedAt ? Date.parse(record.updatedAt) : 0;

    if (nextScore > existingScore || nextUpdated > existingUpdated) {
      byRuntimeSessionId.set(record.runtimeSessionId, record);
    }
  }

  return Array.from(byRuntimeSessionId.values()).sort((left, right) =>
    compareIsoTime(left.createdAt, right.createdAt),
  );
}

function findLineageRootRecord(records: TaskSessionRecord[]) {
  return (
    records.find((record) => record.sourceType === "root") ??
    records.slice().sort((left, right) => compareIsoTime(left.createdAt, right.createdAt))[0]
  );
}

function repairLineageRecord(record: TaskSessionRecord, rootRuntimeSessionId: string) {
  const previousParent = record.parentRuntimeSessionId;
  const previousSourceType = record.sourceType;

  if (record.runtimeSessionId === rootRuntimeSessionId) {
    record.parentRuntimeSessionId = null;
    record.sourceType = "root";
  } else if (!record.parentRuntimeSessionId) {
    record.parentRuntimeSessionId = rootRuntimeSessionId;
    if (record.sourceType !== "sub_session") {
      record.sourceType = "fork";
    }
  } else if (record.sourceType === "root") {
    record.sourceType = "fork";
  }

  return (
    record.parentRuntimeSessionId !== previousParent || record.sourceType !== previousSourceType
  );
}

function normalizeLineageRecords(records: TaskSessionRecord[]) {
  const normalized = dedupeTaskSessionRecords(records).map((record) => ({ ...record }));
  if (normalized.length <= 1) {
    return { records: normalized, repaired: [] as TaskSessionRecord[] };
  }

  const rootRecord = findLineageRootRecord(normalized);

  if (!rootRecord) {
    return { records: normalized, repaired: [] as TaskSessionRecord[] };
  }

  const repaired: TaskSessionRecord[] = [];

  for (const record of normalized) {
    if (repairLineageRecord(record, rootRecord.runtimeSessionId)) {
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
  const info =
    record.info && typeof record.info === "object"
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

function extractSessionMessageId(message: unknown) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const info = (message as Record<string, unknown>).info;
  return info && typeof info === "object" && typeof (info as Record<string, unknown>).id === "string"
    ? ((info as Record<string, unknown>).id as string)
    : null;
}

async function appendForkMessagePreviews(
  previewMap: Map<string, { role: string | null; preview: string | null }>,
  parentSessionId: string,
  messageIds: Set<string>,
) {
  const result = await getSessionMessages(parentSessionId);
  if (!result.ok || !Array.isArray(result.data)) {
    return;
  }

  for (const message of result.data) {
    const messageId = extractSessionMessageId(message);
    if (!messageId || !messageIds.has(messageId)) {
      continue;
    }

    previewMap.set(`${parentSessionId}:${messageId}`, extractMessagePreview(message));
  }
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
      await appendForkMessagePreviews(previewMap, parentSessionId, messageIds);
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
        const created = (
          (info as Record<string, unknown>).time as Record<string, unknown> | undefined
        )?.created;
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
    .filter(
      ([runtimeSessionId, runtime]) =>
        runtimeSessionId === taskSessionId || runtime.title?.includes(taskPrefix),
    )
    .sort((left, right) =>
      compareIsoTime(
        left[1].createdAt ?? left[1].updatedAt,
        right[1].createdAt ?? right[1].updatedAt,
      ),
    )
    .map(([runtimeSessionId, runtime]) => ({ runtimeSessionId, runtime }));

  const rootRuntimeSessionId =
    (taskSessionId &&
      records.find((record) => record.runtimeSessionId === taskSessionId)?.runtimeSessionId) ||
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

async function persistLineageRepairs(
  taskId: string,
  records: TaskSessionRecord[],
  authorization: string,
) {
  for (const record of records) {
    await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/task-sessions`, {
      method: "POST",
      body: {
        runtimeSessionId: record.runtimeSessionId,
        parentRuntimeSessionId: record.parentRuntimeSessionId ?? undefined,
        forkedFromMessageId: record.forkedFromMessageId ?? undefined,
        branchName: record.branchName ?? undefined,
        sourceType:
          record.sourceType === "sub_session"
            ? "sub_session"
            : record.sourceType === "root"
              ? "root"
              : "fork",
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
  const inferredParentId =
    rootRecord && rootRecord.runtimeSessionId !== parentSessionId
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

function createSessionTreeNode(
  record: TaskSessionRecord,
  runtimeSessions: Map<string, RuntimeSessionMeta>,
  forkMessagePreviewMap: Map<string, { role: string | null; preview: string | null }>,
  firstPromptAfterForkMap: Map<string, string | null>,
): SessionTreeNode {
  const runtime = runtimeSessions.get(record.runtimeSessionId);
  const forkSource =
    record.parentRuntimeSessionId && record.forkedFromMessageId
      ? forkMessagePreviewMap.get(`${record.parentRuntimeSessionId}:${record.forkedFromMessageId}`)
      : undefined;

  return {
    id: record.id,
    runtimeSessionId: record.runtimeSessionId,
    parentRuntimeSessionId: record.parentRuntimeSessionId,
    forkedFromMessageId: record.forkedFromMessageId,
    forkedFromMessageRole: forkSource?.role ?? null,
    forkedFromMessagePreview: forkSource?.preview ?? null,
    firstPromptAfterFork: firstPromptAfterForkMap.get(record.runtimeSessionId) ?? null,
    branchName: record.branchName,
    sourceType: record.sourceType,
    isActive: record.isActive,
    title: runtime?.title ?? record.branchName,
    summary: runtime?.summary ?? null,
    createdAt: runtime?.createdAt ?? record.createdAt,
    updatedAt: runtime?.updatedAt ?? record.updatedAt,
    children: [],
  };
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
    const node = createSessionTreeNode(
      rec,
      runtimeSessions,
      forkMessagePreviewMap,
      firstPromptAfterForkMap,
    );
    nodeMap.set(rec.runtimeSessionId, node);
  }

  for (const node of nodeMap.values()) {
    const parent = node.parentRuntimeSessionId ? nodeMap.get(node.parentRuntimeSessionId) : null;
    if (parent) {
      parent.children.push(node);
      continue;
    }
    roots.push(node);
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
    const synthesizedRecords = synthesizeLineageRecordsFromRuntime(
      taskId,
      taskResult.data?.sessionId,
      runtimeMap,
    );

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

  const tree = buildSessionTree(
    normalizedRecords,
    runtimeMap,
    forkMessagePreviewMap,
    firstPromptAfterForkMap,
  );
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

  const record = lineageResult.data.data.find(
    (r: TaskSessionRecord) => r.runtimeSessionId === sessionId,
  );
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

  const record = lineageResult.data.data.find(
    (r: TaskSessionRecord) => r.runtimeSessionId === sessionId,
  );
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
