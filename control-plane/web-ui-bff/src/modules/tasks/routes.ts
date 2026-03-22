import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { authHeader, cpFetch } from "../../lib/control-plane-client";
import { classifyIntent } from "../../lib/intent-classifier";
import {
  formatModelRoute,
  diagnoseModelReadiness,
  readDefaultExecutionModel,
  resolveModelRoute,
  validateModelProvider,
} from "../../lib/opencode-config";
import {
  DEFAULT_EXECUTION_AGENT,
  type ChainStepInput,
  type ExecutionMode,
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
  isFreeExecutionModelRoute,
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
  listRuntimePermissions,
  listSessions,
  replyRuntimePermission,
  type RuntimePermissionReply,
  type RuntimePermissionRequest,
  terminateAgent,
} from "../agent-control/opencode-adapter";
import { createAgentRunRecord, recordAgentAudit } from "../agent-control/run-persistence";
import { executeLifecycleHooks, mergeStageAndStrategyHooks, parseStageHooks } from "../hooks/lifecycle-hooks";
import { buildPipelineStageUpdatedEvents } from "../realtime/pipeline-events";
import { sseAggregator } from "../realtime/sse-aggregator";
import { wsBroadcaster } from "../realtime/ws-broadcaster";
import { reconcileRunningTasksOnStartup } from "./reconcile";
import {
  type ParallelExecutionPlanRecord,
  upsertParallelRunHistory,
} from "./parallel-run-history";
import {
  buildStageArtifactSummary,
  buildWorkflowExecutionPromptSnapshot,
  fetchCurrentStageHooks,
  persistWorkflowStageExecutionOutcome,
} from "./workflow-stage-execution";
import { ensureTaskWorkflowStarted } from "./workflow-sync";
import { buildTaskWorkflowViewModel, fetchTaskWorkflowState } from "./workflow-view";

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

interface TaskRuntimePermissionRecord {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown> | null;
  always: string[];
  tool: {
    messageId: string;
    callId: string;
  } | null;
}

interface ExecutableTask {
  id: string;
  prompt: string;
  status: string;
  category?: string | null;
  projectId: string;
  sessionId?: string | null;
  executionMode?: ExecutionMode | null;
  executionPlan?: string | null;
  parallelRunHistory?: string | null;
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

interface UpsertTaskSessionLineageInput {
  runtimeSessionId: string;
  parentRuntimeSessionId?: string;
  forkedFromMessageId?: string;
  branchName?: string;
  sourceType?: "root" | "fork" | "sub_session";
  isActive: boolean;
}

async function fetchTaskSessionLineageRecords(taskId: string, authorization: string) {
  const lineageResult = await cpFetch<{ data: TaskSessionRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/branches`,
    { authorization },
  );

  const records =
    lineageResult.ok && Array.isArray(lineageResult.data?.data)
      ? lineageResult.data.data
      : [];

  return {
    ok: lineageResult.ok,
    status: lineageResult.status,
    records,
    activeRecords: records.filter((record) => !record.archivedAt),
  };
}

async function resolveTaskRuntimeSessionIds(taskId: string, authorization: string) {
  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  const sessionIds = new Set<string>();

  for (const record of lineageResult.activeRecords) {
    if (record.runtimeSessionId) {
      sessionIds.add(record.runtimeSessionId);
    }
  }

  const taskResult = await cpFetch<{ sessionId?: string | null }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );
  if (taskResult.ok && typeof taskResult.data?.sessionId === "string" && taskResult.data.sessionId.trim()) {
    sessionIds.add(taskResult.data.sessionId.trim());
  }

  return sessionIds;
}

function normalizeRuntimePermissionRecord(
  permission: RuntimePermissionRequest,
): TaskRuntimePermissionRecord {
  return {
    id: permission.id,
    sessionId: permission.sessionID,
    permission: permission.permission,
    patterns: Array.isArray(permission.patterns) ? permission.patterns : [],
    metadata:
      permission.metadata && typeof permission.metadata === "object"
        ? permission.metadata
        : null,
    always: Array.isArray(permission.always) ? permission.always : [],
    tool:
      permission.tool && typeof permission.tool === "object"
        ? {
            messageId: permission.tool.messageID,
            callId: permission.tool.callID,
          }
        : null,
  };
}

async function fetchTaskRuntimePermissions(args: {
  taskId: string;
  authorization: string;
  sessionId?: string;
}) {
  const sessionIds = await resolveTaskRuntimeSessionIds(args.taskId, args.authorization);
  if (args.sessionId && !sessionIds.has(args.sessionId)) {
    return {
      ok: false as const,
      status: 404 as const,
      data: { error: "Session does not belong to this task" },
    };
  }

  const permissionResult = await listRuntimePermissions();
  if (!permissionResult.ok) {
    return {
      ok: false as const,
      status: 502 as const,
      data: { error: permissionResult.error || "Failed to list runtime permissions" },
    };
  }

  const rawPermissions = Array.isArray(permissionResult.data)
    ? (permissionResult.data as RuntimePermissionRequest[])
    : [];
  const filtered = rawPermissions
    .filter((permission) => sessionIds.has(permission.sessionID))
    .filter((permission) => !args.sessionId || permission.sessionID === args.sessionId)
    .map(normalizeRuntimePermissionRecord);

  return { ok: true as const, status: 200 as const, data: { data: filtered } };
}

async function resolveTaskRuntimePermission(args: {
  taskId: string;
  authorization: string;
  requestId: string;
}) {
  const permissionResult = await fetchTaskRuntimePermissions({
    taskId: args.taskId,
    authorization: args.authorization,
  });
  if (!permissionResult.ok) {
    return permissionResult;
  }

  const permission = permissionResult.data.data.find((item) => item.id === args.requestId);
  if (!permission) {
    return {
      ok: false as const,
      status: 404 as const,
      data: { error: "Runtime permission request not found for this task" },
    };
  }

  return { ok: true as const, status: 200 as const, data: permission };
}

async function upsertTaskSessionLineageRecord(
  taskId: string,
  authorization: string,
  input: UpsertTaskSessionLineageInput,
) {
  return cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/branches`, {
    method: "POST",
    body: {
      runtimeSessionId: input.runtimeSessionId,
      parentRuntimeSessionId: input.parentRuntimeSessionId,
      forkedFromMessageId: input.forkedFromMessageId,
      branchName: input.branchName,
      sourceType: input.sourceType,
      isActive: input.isActive,
    },
    authorization,
  });
}

async function fetchTaskSessionTimeline(
  taskId: string,
  sessionId: string,
  authorization: string,
  options?: { includeLineage?: boolean },
) {
  const suffix = options?.includeLineage ? "?includeLineage=true" : "";
  return cpFetch<TaskSessionTimelineResponseRecord>(
    `/api/tasks/${encodeURIComponent(taskId)}/branches/${encodeURIComponent(sessionId)}/timeline${suffix}`,
    { authorization },
  );
}

async function activateTaskSessionLineageByRecordId(
  taskId: string,
  recordId: string,
  authorization: string,
) {
  return cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/branches/${encodeURIComponent(recordId)}/activate`,
    { method: "POST", authorization },
  );
}

async function archiveTaskSessionLineageByRecordId(
  taskId: string,
  recordId: string,
  authorization: string,
) {
  return cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/branches/${encodeURIComponent(recordId)}/archive`,
    { method: "POST", authorization },
  );
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
  parentSessionId?: string;
}

interface WorkflowPromptContextRecord {
  [key: string]: string | string[] | null | undefined;
  taskId: string;
  projectId: string;
  taskCategory?: string;
  taskTitle: string;
  taskPrompt: string;
  executionMode?: ExecutionMode;
  repoName?: string | null;
  remoteUrl?: string | null;
  workingBranch?: string | null;
  workflowStatus?: string;
  currentStageKey?: string;
  currentStageLabel?: string;
  currentStageStatus?: string;
  currentStageExitCriteria?: string[];
  completedStageOutputs?: string[];
  pendingStageLabels?: string[];
  openChangeRequestSummary?: string;
  activeRoleSummary?: string;
  selectedAgent?: string;
  selectedModel?: string;
  taskResult?: string;
  changesSummary?: string;
}

interface ExecutionTraceSegmentRecord {
  type:
    | "user-input"
    | "workflow-context"
    | "hook-injection"
    | "hook-result"
    | "hook-rewrite"
    | "final-prompt"
    | "model-response";
  label: string;
  content: string;
  hookId?: string;
  hookTrigger?: string;
  hookAgent?: string;
  hookDecisionAction?: string;
  timestamp?: string;
}

interface ExecutionTraceMessageRecord {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  raw: unknown;
}

interface TaskSessionTimelineItemRecord {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  completedAt?: string | null;
  raw?: unknown;
  sourceEventTypes?: string[];
}

interface TaskSessionTimelineMetaRecord {
  cacheState?: "none" | "partial" | "complete";
  complete?: boolean;
  includeLineage?: boolean;
  lineagePath?: string[];
  cachedSessionCount?: number;
  itemCount?: number;
}

interface TaskSessionTimelineResponseRecord {
  data: TaskSessionTimelineItemRecord[];
  meta?: TaskSessionTimelineMetaRecord;
}

interface TaskExecutionTraceRecord {
  taskId: string;
  sessionId: string | null;
  workflowContext: string | null;
  finalPrompt: string | null;
  latestResponse: string | null;
  truncated: boolean;
  messageLimit: number;
  segments: ExecutionTraceSegmentRecord[];
  messages: ExecutionTraceMessageRecord[];
  timeline: TaskSessionTimelineItemRecord[];
  timelineMeta?: TaskSessionTimelineMetaRecord;
  hookExecutions: Array<{
    hookId: string;
    trigger: string;
    status: string;
    agent: string;
    model?: string;
    prompt: string;
    result?: string;
    error?: string;
    decision?: {
      parentSessionId: input.parentSessionId,
      reason?: string;
      rewrittenPrompt?: string;
      targetModel?: string;
    };
    completedAt: string;
  }>;
}

interface ParallelCandidateAttempt {
  index: number;
  sessionResult?: SessionStartResult;
}

/** Optional overrides the user can pass in POST /:taskId/execute body. */
interface ExecuteOverrides {
  mode?: ExecutionMode;
  candidates?: Array<{ model: string; label?: string }>;
  steps?: ChainStepInput[];
}

const executeBodySchema = z
  .object({
    mode: z.enum(["single", "parallel", "sequential-chain"]).optional(),
    candidates: z
      .array(z.object({ model: z.string().min(1), label: z.string().optional() }))
      .max(5)
      .optional(),
    steps: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          instruction: z.string().min(1),
          model: z.string().optional(),
        }),
      )
      .max(20)
      .optional(),
  })
  .optional();

interface ContinueTaskInput {
  taskId: string;
  prompt: string;
  overrideSessionId?: string;
  executionMode?: ExecutionMode;
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
      effectiveModel: formatModelRoute({
        providerId: preflight.policy.providerId,
        modelId: preflight.policy.modelId,
      }),
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
  candidateCount?: number;
}) {
  const continuationShape = {
    candidateCount: Math.max(1, input.candidateCount ?? 1),
    judgeEnabled: false,
    enabledHookTriggers: [],
    suiteLabel: "task continue",
    suiteReference: `task=${input.task.id}:continue`,
  };
  const rawPreflight = await buildPaidExecutionPreflight({
    projectId: input.task.projectId,
    authorization: input.authorization,
    resolvedModel: input.resolvedModel,
    shape: continuationShape,
  });
  if (!rawPreflight.ok) {
    return {
      ok: false as const,
      status: rawPreflight.status as 401 | 403 | 404 | 502,
      data: rawPreflight.data,
    };
  }

  const preflight = rawPreflight.data;

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
        effectiveModel: args.resolvedModel ? formatModelRoute(args.resolvedModel) : undefined,
        paidExecutionGuard: args.guard,
      }),
    },
  });

  return patchResult.ok
    ? ({ ok: true as const } as const)
    : ({ ok: false as const, status: 502 as const, data: { error: "Failed to persist continuation guard configuration" } } as const);
}

function parseStoredExecutionPlan(task: Pick<ExecutableTask, "executionPlan">): ExecutionPlan | null {
  if (!task.executionPlan) {
    return null;
  }

  try {
    const parsed = JSON.parse(task.executionPlan) as ParallelExecutionPlanRecord;
    if (parsed?.mode !== "parallel" || !Array.isArray(parsed.candidates)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseStoredTaskClassification(
  task: Pick<ExecutableTask, "category">,
): Pick<IntentClassification, "category"> | null {
  return typeof task.category === "string" && task.category.trim()
    ? { category: task.category.trim() as IntentClassification["category"] }
    : null;
}

function buildStoredParallelPlan(task: Pick<ExecutableTask, "strategy">): ExecutionPlan | null {
  const parsedStrategy = parseTaskStrategy(task.strategy);
  const candidates = Array.isArray(parsedStrategy.parallelCandidates)
    ? parsedStrategy.parallelCandidates.filter(
        (candidate): candidate is { model: string; label?: string } =>
          Boolean(candidate && typeof candidate.model === "string" && candidate.model.trim()),
      )
    : [];

  if (parsedStrategy.executionMode !== "parallel" || candidates.length < 2) {
    return null;
  }

  return {
    templateId:
      typeof parsedStrategy.selectedTemplateId === "string" && parsedStrategy.selectedTemplateId.trim()
        ? parsedStrategy.selectedTemplateId.trim()
        : "saved-parallel",
    mode: "parallel",
    steps: [{ id: "exec-parallel", type: "execution", status: "pending" }],
    candidates: candidates.map((candidate, index) => ({
      label: candidate.label || `候选 ${index + 1}`,
      agent: DEFAULT_EXECUTION_AGENT,
      model: candidate.model,
      role: "executor",
      status: "pending",
    })),
  };
}

function isActiveParallelCandidateStatus(status: unknown): boolean {
  return status === "pending" || status === "running";
}

function resetParallelContinuationPlan(plan: ExecutionPlan): ExecutionPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => ({
      ...step,
      status: step.type === "chain-step" ? step.status : "pending",
      result: undefined,
      finishedAt: undefined,
    })),
    candidates: plan.candidates.map((candidate) => ({
      label: candidate.label,
      agent: candidate.agent,
      model: candidate.model,
      role: candidate.role,
      status: "pending",
    })),
    judgeResult: undefined,
    winnerCandidateIndex: undefined,
    parallelRunId: undefined,
  };
}

function shouldRestartParallelContinuation(
  task: Pick<ExecutableTask, "status">,
  plan: ExecutionPlan,
): boolean {
  if (typeof plan.winnerCandidateIndex === "number") {
    return true;
  }

  if (plan.judgeResult) {
    return true;
  }

  if (task.status !== "running") {
    return true;
  }

  return !plan.candidates.some((candidate) => isActiveParallelCandidateStatus(candidate.status));
}

function resolveParallelContinuationPlan(
  task: Pick<ExecutableTask, "executionPlan" | "strategy" | "status">,
) {
  const storedPlan = parseStoredExecutionPlan(task);
  if (storedPlan) {
    if (storedPlan.candidates.length < 2) {
      return buildStoredParallelPlan(task) || storedPlan;
    }

    return shouldRestartParallelContinuation(task, storedPlan)
      ? resetParallelContinuationPlan(storedPlan)
      : storedPlan;
  }

  return buildStoredParallelPlan(task);
}

function resolveCandidateExecutionModel(
  candidate: ExecutionPlan["candidates"][number],
  fallbackModel?: ResolvedModel,
): ResolvedModel | undefined {
  if (candidate.model) {
    return parseModelString(candidate.model);
  }

  return fallbackModel;
}

function resolvePreflightModelForParallelPlan(
  plan: Pick<ExecutionPlan, "candidates">,
  fallbackModel?: ResolvedModel,
): ResolvedModel | undefined {
  const parsedCandidates = plan.candidates
    .map((candidate) => candidate.model)
    .filter((model): model is string => Boolean(model && model.trim()))
    .map((model) => {
      const resolved = parseModelString(model);
      return {
        resolved,
        isFree: isFreeExecutionModelRoute(model, resolved.providerId),
      };
    });
  if (parsedCandidates.length === 0) {
    return fallbackModel;
  }

  if (parsedCandidates.every((candidate) => candidate.isFree)) {
    return parsedCandidates[0]?.resolved;
  }

  return parsedCandidates.find((candidate) => !candidate.isFree)?.resolved ?? fallbackModel;
}

async function registerParallelTaskSessions(
  task: Pick<ExecutableTask, "id" | "title" | "sessionId">,
  plan: ExecutionPlan,
  authorization: string,
  options?: { parentSessionId?: string },
) {
  const candidatesWithSessions = plan.candidates
    .map((candidate, index) => ({
      index,
      sessionId: candidate.sessionId,
      branchName: candidate.label || candidate.model || `Candidate ${index + 1}`,
    }))
    .filter((candidate): candidate is { index: number; sessionId: string; branchName: string } =>
      Boolean(candidate.sessionId),
    );

  if (candidatesWithSessions.length === 0) {
    return;
  }

  const lineageResult = await fetchTaskSessionLineageRecords(task.id, authorization);
  const existingRecords = lineageResult.activeRecords;
  const { records: normalizedRecords } = normalizeLineageRecords(existingRecords);
  const existingSessionIds = new Set(normalizedRecords.map((record) => record.runtimeSessionId));
  const existingRecordMap = new Map(
    normalizedRecords.map((record) => [record.runtimeSessionId, record] as const),
  );
  const existingRoot = normalizedRecords.find((record) => record.sourceType === "root");

  if (options?.parentSessionId && !existingSessionIds.has(options.parentSessionId)) {
    await ensureParentLineageRecord(task.id, options.parentSessionId, authorization, task.title).catch(
      () => null,
    );
    existingSessionIds.add(options.parentSessionId);
  }

  const rootSessionId =
    existingRoot?.runtimeSessionId ||
    (task.sessionId && existingSessionIds.has(task.sessionId) ? task.sessionId : undefined) ||
    candidatesWithSessions[0]?.sessionId;

  if (!rootSessionId) {
    return;
  }

  const orderedCandidates = candidatesWithSessions.slice().sort((left, right) => {
    if (left.sessionId === rootSessionId) {
      return -1;
    }
    if (right.sessionId === rootSessionId) {
      return 1;
    }
    return left.index - right.index;
  });

  for (const candidate of orderedCandidates) {
    const parentRuntimeSessionId =
      options?.parentSessionId && options.parentSessionId !== candidate.sessionId
        ? options.parentSessionId
        : candidate.sessionId === rootSessionId
          ? undefined
          : rootSessionId;
    const nextSourceType = parentRuntimeSessionId ? "fork" : "root";
    const existingRecord = existingRecordMap.get(candidate.sessionId);

    if (
      existingRecord &&
      existingRecord.parentRuntimeSessionId === (parentRuntimeSessionId ?? null) &&
      existingRecord.sourceType === nextSourceType
    ) {
      continue;
    }

    await upsertTaskSessionLineageRecord(task.id, authorization, {
      runtimeSessionId: candidate.sessionId,
      parentRuntimeSessionId,
      branchName: candidate.branchName,
      sourceType: nextSourceType,
      isActive: task.sessionId === candidate.sessionId,
    });
    existingSessionIds.add(candidate.sessionId);
    existingRecordMap.set(candidate.sessionId, {
      id: existingRecord?.id || `synthetic-${candidate.sessionId}`,
      taskId: task.id,
      runtimeSessionId: candidate.sessionId,
      parentRuntimeSessionId: parentRuntimeSessionId ?? null,
      forkedFromMessageId: existingRecord?.forkedFromMessageId ?? null,
      branchName: candidate.branchName,
      sourceType: nextSourceType,
      isActive: task.sessionId === candidate.sessionId,
      createdAt: existingRecord?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
    });
  }
}

function broadcastParallelContinuationStarted(
  task: Pick<ExecutableTask, "id" | "projectId" | "title">,
  candidates: ExecutionPlan["candidates"],
) {
  for (const candidate of candidates) {
    if (candidate.status !== "running") {
      continue;
    }

    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.started",
      ts: new Date().toISOString(),
      taskId: task.id,
      projectId: task.projectId,
      agentRunId: candidate.agentRunId,
      sessionId: candidate.sessionId,
      data: {
        taskId: task.id,
        title: task.title,
        agentRunId: candidate.agentRunId,
        agent: candidate.agent,
        executionMode: "parallel",
      },
    });
  }
}

async function continueParallelTaskExecution(input: ContinueTaskInput & {
  task: ExecutableTask;
  classification?: Pick<IntentClassification, "category"> | null;
  resolvedModel?: ResolvedModel;
  guard?: PaidExecutionGuardState;
}) {
  const plan = resolveParallelContinuationPlan(input.task);
  if (!plan || plan.candidates.length < 2) {
    return { status: 400 as const, body: { error: "No parallel candidates configured for this task" } };
  }

  const repoContext = buildRepoContext(input.task, {});
  const workflowContext = await buildWorkflowPromptContext(input.task, input.authorization, {
    taskCategory: input.classification?.category,
    executionMode: "parallel",
    selectedModel: input.resolvedModel ? formatModelRoute(input.resolvedModel) : undefined,
    taskResult: "",
    changesSummary: "",
  });
  const prompt = prependWorkflowContextToPrompt(input.prompt, workflowContext);
  const attempts = await Promise.all(
    plan.candidates.map(async (candidate, index) => {
      const candidateModel = resolveCandidateExecutionModel(candidate, input.resolvedModel);
      if (candidateModel) {
        const validationError = await validateResolvedModel(candidateModel);
        if (validationError) {
          return {
            index,
            ok: false,
            error:
              typeof validationError.body?.error === "string"
                ? validationError.body.error
                : "Selected model is not available",
          };
        }
      }

      if (candidate.sessionId) {
        const agentRunId = ensureAgentRunForSession(
          candidate.sessionId,
          input.taskId,
          input.task.projectId,
          candidateModel,
        );
        const continuedResult = await continueSession(candidate.sessionId, prompt, {
          model: candidateModel,
        });
        return {
          index,
          ok: continuedResult.ok,
          sessionId: candidate.sessionId,
          agentRunId,
          error:
            continuedResult.ok
              ? undefined
              : continuedResult.error || "Failed to continue candidate session",
        };
      }

      const sessionResult = await createSession(input.taskId, input.task.projectId, prompt, {
        agent: candidate.agent,
        candidateIndex: index,
        repoContext,
        model: candidateModel,
      });

      if (sessionResult.agentRunId) {
        await createAgentRunRecord({
          taskId: input.task.id,
          agentRunId: sessionResult.agentRunId,
          sessionId: sessionResult.sessionId,
          agentType: candidate.agent,
          parentSessionId: input.parentSessionId,
          model: candidateModel,
          candidateIndex: index,
          error: sessionResult.ok ? undefined : sessionResult.error,
          startedAt: new Date().toISOString(),
          finishedAt: sessionResult.ok ? undefined : new Date().toISOString(),
        });
      }

      return {
        index,
        ok: sessionResult.ok,
        sessionId: sessionResult.sessionId,
        agentRunId: sessionResult.agentRunId,
        error: sessionResult.ok ? undefined : sessionResult.error || "Failed to start parallel candidate",
      };
    }),
  );

  let hasAnySuccess = false;
  for (const attempt of attempts) {
    const candidate = plan.candidates[attempt.index];
    if (!candidate) {
      continue;
    }

    candidate.sessionId = attempt.sessionId || candidate.sessionId;
    candidate.agentRunId = attempt.agentRunId || candidate.agentRunId;
    candidate.status = attempt.ok ? "running" : "failed";
    if (attempt.ok) {
      candidate.startedAt = new Date().toISOString();
      candidate.finishedAt = undefined;
      hasAnySuccess = true;
    } else {
      candidate.finishedAt = new Date().toISOString();
    }
  }

  if (!hasAnySuccess) {
    return {
      status: 502 as const,
      body: {
        error:
          attempts.map((attempt) => attempt.error).find((value): value is string => Boolean(value)) ||
          "All parallel candidates failed to continue",
      },
    };
  }

  const primaryCandidate = plan.candidates.find((candidate) => candidate.status === "running");
  await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    method: "PATCH",
    body: {
      status: "running",
      sessionId: primaryCandidate?.sessionId,
      agentRunId: primaryCandidate?.agentRunId,
      executionMode: "parallel",
      executionPlan: JSON.stringify(plan),
      parallelRunHistory: upsertParallelRunHistory(input.task, plan as ParallelExecutionPlanRecord, {
        parentSessionId: input.parentSessionId,
      }),
      strategy: mergeTaskStrategy(input.task.strategy, {
        executionMode: "parallel",
        effectiveModel: input.resolvedModel ? formatModelRoute(input.resolvedModel) : undefined,
        paidExecutionGuard: input.guard,
      }),
    },
    authorization: input.authorization,
  });

  await registerParallelTaskSessions(input.task, plan, input.authorization, {
    parentSessionId: input.parentSessionId,
  }).catch(() => null);
  sseAggregator.registerParallelTask(input.task.id, plan.candidates);
  broadcastParallelContinuationStarted(input.task, plan.candidates);

  return {
    status: 200 as const,
    body: {
      ok: true,
      sessionId: primaryCandidate?.sessionId,
      agentRunId: primaryCandidate?.agentRunId,
      executionMode: "parallel",
      candidates: plan.candidates.map((candidate) => ({
        label: candidate.label,
        model: candidate.model,
        sessionId: candidate.sessionId,
        agentRunId: candidate.agentRunId,
        status: candidate.status,
      })),
    },
  };
}

async function continueTaskExecution(input: ContinueTaskInput) {
  const taskResult = await fetchExecutableTask(input.taskId, input.authorization);
  if (!taskResult.ok) {
    return { status: 404 as const, body: { error: "Task not found" } };
  }

  const task = taskResult.data;
  const parallelPlan =
    input.executionMode === "single" || input.executionMode === "sequential-chain"
      ? null
      : resolveParallelContinuationPlan(task);
  const sessionId = input.overrideSessionId || task.sessionId || undefined;
  if (!sessionId && !parallelPlan) {
    return { status: 400 as const, body: { error: "No session associated with this task" } };
  }

  const resolvedModel = await resolveExecutionModel(
    { ...task, prompt: input.prompt, status: "running" },
    input.authorization,
  );
  const preflightModel = parallelPlan
    ? resolvePreflightModelForParallelPlan(parallelPlan, resolvedModel)
    : resolvedModel;
  if (resolvedModel) {
    const modelValidationError = await validateResolvedModel(resolvedModel);
    if (modelValidationError) {
      return { status: modelValidationError.status, body: modelValidationError.body };
    }
  }

  const preflightResult = await buildContinuationPreflight({
    task,
    authorization: input.authorization,
    resolvedModel: preflightModel,
    candidateCount: parallelPlan?.candidates.length,
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

  const workflowTemplateId = await resolveTaskWorkflowTemplateId(task, input.authorization);
  await ensureTaskWorkflowStarted({
    authorization: input.authorization,
    taskId: input.taskId,
    templateId: workflowTemplateId,
  });

  if (parallelPlan) {
    const parallelResult = await continueParallelTaskExecution({
      ...input,
      task,
      classification: parseStoredTaskClassification(task),
      parentSessionId: sessionId,
      resolvedModel,
      guard: preflightResult.guard,
    });

    if (parallelResult.status === 200) {
      await recordPaidExecutionGuardStateEvent({
        projectId: task.projectId,
        taskId: input.taskId,
        sessionId: typeof parallelResult.body.sessionId === "string" ? parallelResult.body.sessionId : undefined,
        agentRunId:
          typeof parallelResult.body.agentRunId === "string" ? parallelResult.body.agentRunId : undefined,
        action: "continued",
        guardState: preflightResult.guard,
        detail: {
          effectiveModel: resolvedModel ? formatModelRoute(resolvedModel) : undefined,
          executionMode: "parallel",
          candidateCount: parallelPlan.candidates.length,
        },
        riskLevel: preflightResult.guard?.enabled ? "medium" : undefined,
      });

      wsBroadcaster.broadcast({
        id: crypto.randomUUID(),
        type: "task.continued",
        ts: new Date().toISOString(),
        taskId: input.taskId,
        projectId: task.projectId,
        agentRunId:
          typeof parallelResult.body.agentRunId === "string" ? parallelResult.body.agentRunId : undefined,
        data: {
          sessionId: parallelResult.body.sessionId,
          agentRunId: parallelResult.body.agentRunId,
          executionMode: "parallel",
          candidateCount: parallelPlan.candidates.length,
        },
      });

      void buildPipelineStageUpdatedEvents({
        taskId: input.taskId,
        sessionId:
          typeof parallelResult.body.sessionId === "string" ? parallelResult.body.sessionId : undefined,
        projectId: task.projectId,
        agentRunId:
          typeof parallelResult.body.agentRunId === "string" ? parallelResult.body.agentRunId : undefined,
        authorization: input.authorization,
        reason: "task.continued",
      }).then((events) => {
        for (const event of events) {
          wsBroadcaster.broadcast(event);
        }
      });
    }

    return parallelResult;
  }

  if (!sessionId) {
    return { status: 400 as const, body: { error: "No session associated with this task" } };
  }

  const agentRunId = ensureAgentRunForSession(sessionId, input.taskId, task.projectId, resolvedModel);
  const workflowContext = await buildWorkflowPromptContext(task, input.authorization, {
    taskCategory: parseStoredTaskClassification(task)?.category,
    executionMode: task.executionMode ?? "single",
    selectedModel: resolvedModel ? formatModelRoute(resolvedModel) : undefined,
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
      effectiveModel: resolvedModel ? formatModelRoute(resolvedModel) : undefined,
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

function applyPaidExecutionSafetyOverlay(context: PreparedExecutionContext): {
  context: PreparedExecutionContext;
  overridesApplied: PaidExecutionOverride[];
} {
  const overridesApplied: PaidExecutionOverride[] = [];

  const safePlan = {
    ...context.plan,
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
  return cpFetch<ExecutableTask>(`/api/project-tree/tasks/${encodeURIComponent(taskId)}`, {
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

async function buildPaidExecutionPreflight(input: {
  projectId: string;
  authorization: string;
  resolvedModel?: ResolvedModel;
  shape: {
    candidateCount: number;
    judgeEnabled: boolean;
    enabledHookTriggers: string[];
    suiteLabel: string;
    suiteReference: string;
  };
}) {
  const leaseResult = await fetchProjectPaidExecutionLeaseState(
    input.projectId,
    input.authorization,
  );
  if (!leaseResult.ok) {
    return {
      ok: false as const,
      status: leaseResult.status,
      data: leaseResult.data,
    };
  }

  const [baselineResult, projectResult] = await Promise.all([
    fetchProjectRuntimeUsageBaseline(input.projectId, input.authorization, {
      providerId: input.resolvedModel?.providerId,
      modelId: input.resolvedModel?.modelId,
      entrypointType: "single-task",
      orchestrationFingerprint: buildPreflightOrchestrationFingerprint(input.shape),
    }),
    fetchProjectPaidExecutionSettings(input.projectId, input.authorization),
  ]);

  return {
    ok: true as const,
    status: 200 as const,
    data: evaluatePaidExecutionPreflight(
      {
        projectId: input.projectId,
        allowPaidExecution: projectResult.ok
          ? projectResult.data.settings?.allowPaidExecution === true
          : false,
        resolvedModel: input.resolvedModel,
        shape: input.shape,
        baseline: baselineResult.ok ? baselineResult.data.baseline : null,
      },
      leaseResult.data,
    ),
  };
}

async function buildTaskExecutionPreflight(
  context: PreparedExecutionContext,
  authorization: string,
) {
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
  const preflightModel = isParallelExecution(context.plan)
    ? resolvePreflightModelForParallelPlan(context.plan, context.resolvedModel)
    : context.resolvedModel;

  return buildPaidExecutionPreflight({
    projectId: context.task.projectId,
    authorization,
    resolvedModel: preflightModel,
    shape,
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

function selectExecutionAgent(prompt: string, overrides?: ExecuteOverrides) {
  const strategy = readOrchestrationStrategy();
  const classification = classifyIntent(prompt);
  const configuredAgents = strategy.categoryAgentMap[classification.category] || [];
  const suggestedAgents =
    configuredAgents.length > 0 ? configuredAgents : classification.suggestedAgents;

  // Resolve template and build execution plan (with optional user overrides)
  const template = resolveWorkflowTemplate(strategy, classification.category);
  const plan = buildExecutionPlan(template, strategy, classification.category, overrides);

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
  const plan = executionMeta.plan as ParallelExecutionPlanRecord | undefined;

  return {
    status: "running",
    sessionId: execResult.sessionId,
    agentRunId: execResult.agentRunId,
    category: classification.category,
    executionMode: plan?.mode ?? "single",
    executionPlan: plan ? JSON.stringify(plan) : undefined,
    parallelRunHistory:
      plan?.mode === "parallel"
        ? upsertParallelRunHistory(task, plan, { parentSessionId: task.sessionId ?? null })
        : undefined,
    strategy: mergeTaskStrategy(task.strategy, {
      selectedTemplateId: plan?.templateId,
      workflowTemplateId: executionMeta.workflowTemplateId,
      complexity: classification.complexity,
      suggestedAgents: classification.suggestedAgents,
      requiresPlan: classification.requiresPlan,
      confidence: classification.confidence,
      selectedAgent: executionMeta.selectedAgent,
      effectiveModel: executionMeta.effectiveModel,
      executionMode: plan?.mode,
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
  let currentStageExitCriteria: string[] = [];
  let completedStageOutputs: string[] = [];
  let pendingStageLabels: string[] = [];
  let openChangeRequestSummary: string | undefined;
  let activeRoleSummary: string | undefined;

  try {
    const executionSnapshot = await buildWorkflowExecutionPromptSnapshot(task.id, authorization);
    workflowStatus = executionSnapshot?.workflowStatus;
    currentStageKey = executionSnapshot?.currentStageKey;
    currentStageLabel = executionSnapshot?.currentStageLabel;
    currentStageStatus = executionSnapshot?.currentStageStatus;
    currentStageExitCriteria = executionSnapshot?.currentStageExitCriteria || [];
    completedStageOutputs = executionSnapshot?.completedStageOutputs || [];
    pendingStageLabels = executionSnapshot?.pendingStageLabels || [];

    const workflowView = await buildTaskWorkflowViewModel(task.id, authorization, {
      projectId: task.projectId,
      taskStatus: task.status,
    });
    workflowStatus ||= workflowView.workflow.status;
    currentStageKey ||= workflowView.workflow.currentStage;
    const currentStage = workflowView.workflow.stages.find(
      (stage) => stage.stageKey === workflowView.workflow.currentStage,
    );
    currentStageLabel ||= currentStage?.stageLabel;
    currentStageStatus ||= currentStage?.status;
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
    taskCategory: typeof task.category === "string" ? task.category : undefined,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    executionMode: task.executionMode ?? undefined,
    repoName: task.repoName,
    remoteUrl: task.remoteUrl,
    workingBranch: task.workingBranch,
    workflowStatus,
    currentStageKey,
    currentStageLabel,
    currentStageStatus,
    currentStageExitCriteria,
    completedStageOutputs,
    pendingStageLabels,
    openChangeRequestSummary,
    activeRoleSummary,
    ...extras,
  };
}

function prependWorkflowContextToPrompt(
  prompt: string,
  context: WorkflowPromptContextRecord,
) {
  const isQuickParallelExecution =
    context.taskCategory === "quick" && context.executionMode === "parallel";
  const lines = [
    "## 当前执行上下文",
    `任务：${context.taskTitle}`,
    context.workflowStatus ? `流程状态：${context.workflowStatus}` : undefined,
    context.currentStageLabel || context.currentStageKey
      ? `当前阶段：${context.currentStageLabel || context.currentStageKey}${context.currentStageStatus ? `（${context.currentStageStatus}）` : ""}`
      : undefined,
    context.currentStageExitCriteria && context.currentStageExitCriteria.length > 0
      ? `阶段目标：${context.currentStageExitCriteria.join("；")}`
      : undefined,
    context.activeRoleSummary ? `当前阶段角色：${context.activeRoleSummary}` : undefined,
    context.selectedAgent ? `执行 Agent：${context.selectedAgent}` : undefined,
    context.selectedModel ? `执行模型：${context.selectedModel}` : undefined,
    context.openChangeRequestSummary ? `待处理修正项：${context.openChangeRequestSummary}` : undefined,
    "已完成阶段及产出：",
    ...(context.completedStageOutputs && context.completedStageOutputs.length > 0
      ? context.completedStageOutputs.map((item) => `- ${item}`)
      : ["- 暂无已完成阶段产出"]),
    `待完成阶段：${context.pendingStageLabels && context.pendingStageLabels.length > 0 ? context.pendingStageLabels.join(" → ") : "无（当前可能已是最后阶段）"}`,
    "",
    "请只完成当前阶段的目标。",
    ...(isQuickParallelExecution
      ? []
      : [
          "完成后请输出本阶段产出摘要。",
          "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
        ]),
  ].filter(Boolean);

  return `${lines.join("\n")}\n\n${prompt}`;
}

function renderWorkflowContextBlock(context: WorkflowPromptContextRecord): string {
  return prependWorkflowContextToPrompt("", context).trim();
}

function parseExecutionTraceStrategy(strategyJson: string | null | undefined): {
  selectedAgent?: string;
  hookExecutions: HookExecutionRecord[];
} {
  if (!strategyJson) {
    return { hookExecutions: [] };
  }

  try {
    const strategy = JSON.parse(strategyJson) as {
      selectedAgent?: string;
      hookExecutions?: HookExecutionRecord[];
    };
    return {
      selectedAgent: typeof strategy?.selectedAgent === "string" ? strategy.selectedAgent : undefined,
      hookExecutions: Array.isArray(strategy?.hookExecutions) ? strategy.hookExecutions : [],
    };
  } catch {
    return { hookExecutions: [] };
  }
}

function extractSessionMessageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const record = message as Record<string, unknown>;
  const parts = Array.isArray(record.parts) ? record.parts : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const typedPart = part as Record<string, unknown>;
      if (typedPart.type === "text" && typeof typedPart.text === "string") {
        return typedPart.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractSessionMessageRole(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "unknown";
  }

  const info = (message as Record<string, unknown>).info;
  if (info && typeof info === "object" && typeof (info as Record<string, unknown>).role === "string") {
    return String((info as Record<string, unknown>).role);
  }

  return "unknown";
}

function extractExecutionTraceMessageId(message: unknown, fallback: string): string {
  if (!message || typeof message !== "object") {
    return fallback;
  }

  const info = (message as Record<string, unknown>).info;
  if (info && typeof info === "object" && typeof (info as Record<string, unknown>).id === "string") {
    return String((info as Record<string, unknown>).id);
  }

  return fallback;
}

function extractSessionMessageCreatedAt(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const info = (message as Record<string, unknown>).info;
  if (!info || typeof info !== "object") {
    return undefined;
  }

  const time = (info as Record<string, unknown>).time;
  if (!time || typeof time !== "object") {
    return undefined;
  }

  const created = (time as Record<string, unknown>).created;
  if (typeof created === "number" && Number.isFinite(created)) {
    return new Date(created).toISOString();
  }
  if (typeof created === "string") {
    const parsed = Date.parse(created);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return undefined;
}

function buildSyntheticExecutionTraceRawMessage(item: TaskSessionTimelineItemRecord) {
  return {
    info: {
      id: item.id,
      role: item.role,
      time: {
        created: item.createdAt,
        completed: item.completedAt ?? undefined,
      },
    },
    parts: item.text
      ? [
          {
            type: "text",
            text: item.text,
          },
        ]
      : [],
  };
}

/**
 * Reassemble anonymous part timeline items back into their parent messages.
 * The service layer stores each message part as a separate event group with an
 * `anonymous-*` id. We collapse repeated snapshots for the same part and only
 * keep visible part types that the frontend can render.
 */
function reassembleTimelineMessageParts(
  items: TaskSessionTimelineItemRecord[],
): TaskSessionTimelineItemRecord[] {
  const parentMessageIds = new Set<string>();
  for (const item of items) {
    if (item.role !== "unknown") {
      parentMessageIds.add(item.id);
    }
  }
  if (parentMessageIds.size === 0) {
    return items;
  }

  const partsByParent = new Map<string, Array<Record<string, unknown>>>();
  const mergedItemIds = new Set<string>();

  for (const item of items) {
    if (item.role !== "unknown" || !item.raw) {
      continue;
    }
    const raw = item.raw as Record<string, unknown>;
    const part = raw.part;
    if (!part || typeof part !== "object") {
      continue;
    }
    const parentMessageId = (part as Record<string, unknown>).messageID;
    if (typeof parentMessageId !== "string" || !parentMessageIds.has(parentMessageId)) {
      continue;
    }
    if (!partsByParent.has(parentMessageId)) {
      partsByParent.set(parentMessageId, []);
    }
    partsByParent.get(parentMessageId)!.push(part as Record<string, unknown>);
    mergedItemIds.add(item.id);
  }

  if (partsByParent.size === 0) {
    return items;
  }

  const isVisibleConversationPart = (part: Record<string, unknown>) => {
    const type = typeof part.type === "string" ? part.type : "";
    return type === "tool" || type === "text";
  };

  const dedupeParts = (parts: Array<Record<string, unknown>>) => {
    const order: string[] = [];
    const latestByKey = new Map<string, Record<string, unknown>>();

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const key =
        typeof part.id === "string" && part.id.trim()
          ? part.id
          : typeof part.callID === "string" && part.callID.trim()
            ? `${part.type ?? "part"}:${part.callID}`
            : `${part.type ?? "part"}:${index}`;
      if (!latestByKey.has(key)) {
        order.push(key);
      }
      latestByKey.set(key, part);
    }

    return order
      .map((key) => latestByKey.get(key))
      .filter((part): part is Record<string, unknown> => Boolean(part))
      .filter((part) => isVisibleConversationPart(part));
  };

  return items
    .filter((item) => !mergedItemIds.has(item.id))
    .map((item) => {
      if (!partsByParent.has(item.id)) {
        return item;
      }
      const existingParts =
        item.raw && typeof item.raw === "object" && Array.isArray((item.raw as { parts?: unknown[] }).parts)
          ? (((item.raw as { parts?: unknown[] }).parts ?? []) as Array<Record<string, unknown>>)
          : [];
      const parts = dedupeParts([...existingParts, ...partsByParent.get(item.id)!]);
      const nextRaw = { ...(item.raw ?? {}), parts };
      return {
        ...item,
        text: item.text || extractSessionMessageText(nextRaw),
        raw: nextRaw,
      };
    });
}

function mapTimelineItemsToExecutionTraceMessages(
  items: TaskSessionTimelineItemRecord[],
): ExecutionTraceMessageRecord[] {
  return items.map((item, index) => ({
    id: item.id || `${index}`,
    role: item.role || "unknown",
    text: item.text || extractSessionMessageText(item.raw) || "",
    createdAt: item.createdAt,
    raw: item.raw ?? buildSyntheticExecutionTraceRawMessage(item),
  }));
}

async function loadExecutionTraceMessagesFromTimeline(
  taskId: string,
  sessionId: string,
  authorization: string,
  options?: { includeLineage?: boolean },
) {
  const timelineResult = await fetchTaskSessionTimeline(taskId, sessionId, authorization, {
    includeLineage: options?.includeLineage === true,
  });

  if (!timelineResult.ok || !Array.isArray(timelineResult.data?.data)) {
    return null;
  }

  const reassembled = reassembleTimelineMessageParts(timelineResult.data.data);

  return {
    items: reassembled,
    messages: mapTimelineItemsToExecutionTraceMessages(reassembled),
    meta: timelineResult.data.meta,
    complete: timelineResult.data.meta?.cacheState === "complete",
    messageLimit: timelineResult.data.meta?.itemCount ?? reassembled.length,
  };
}

function parseTraceSegmentTimestamp(value?: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function stripWorkflowExecutionContextPrefix(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return normalized;
  }

  const contextMarkers = [
    "Execution context:",
    "当前执行上下文",
    "请只完成当前阶段的目标。",
    "完成后请输出本阶段产出摘要。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加",
  ];

  const hasContextPrefix = contextMarkers.some((marker) => normalized.includes(marker));
  if (!hasContextPrefix) {
    return normalized;
  }

  const cutMarkers = [
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加",
    "完成后请输出本阶段产出摘要。",
    "请只完成当前阶段的目标。",
  ];

  for (const marker of cutMarkers) {
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex < 0) {
      continue;
    }

    const stripped = normalized.slice(markerIndex + marker.length).trim();
    if (stripped) {
      return stripped;
    }
  }

  const lastDoubleBreak = normalized.lastIndexOf("\n\n");
  if (lastDoubleBreak >= 0) {
    const stripped = normalized.slice(lastDoubleBreak + 2).trim();
    if (stripped) {
      return stripped;
    }
  }

  return normalized;
}

function buildExecutionTraceConversationSegments(
  messages: ExecutionTraceMessageRecord[],
): ExecutionTraceSegmentRecord[] {
  const timedSegments: Array<{ segment: ExecutionTraceSegmentRecord; sortTime: number; sequence: number }> = [];
  let userIndex = 0;
  let assistantIndex = 0;
  let sequence = 0;

  for (const message of messages) {
    if (!message.text) {
      continue;
    }

    if (message.role === "user") {
      const actualInput = stripWorkflowExecutionContextPrefix(message.text);
      userIndex += 1;
      timedSegments.push({
        segment: {
          type: "user-input",
          label: userIndex > 1 ? `用户输入 ${userIndex}` : "用户输入",
          content: actualInput,
          timestamp: message.createdAt,
        },
        sortTime: parseTraceSegmentTimestamp(message.createdAt) ?? Number.MAX_SAFE_INTEGER,
        sequence: sequence++,
      });

      if (actualInput !== message.text) {
        timedSegments.push({
          segment: {
            type: "final-prompt",
            label: userIndex > 1 ? `最终 Prompt ${userIndex}` : "最终 Prompt",
            content: message.text,
            timestamp: message.createdAt,
          },
          sortTime: parseTraceSegmentTimestamp(message.createdAt) ?? Number.MAX_SAFE_INTEGER,
          sequence: sequence++,
        });
      }
      continue;
    }

    if (message.role === "assistant") {
      assistantIndex += 1;
      timedSegments.push({
        segment: {
          type: "model-response",
          label: assistantIndex > 1 ? `模型回复 ${assistantIndex}` : "模型回复",
          content: message.text,
          timestamp: message.createdAt,
        },
        sortTime: parseTraceSegmentTimestamp(message.createdAt) ?? Number.MAX_SAFE_INTEGER,
        sequence: sequence++,
      });
    }
  }

  timedSegments.sort((left, right) => {
    if (left.sortTime !== right.sortTime) {
      return left.sortTime - right.sortTime;
    }
    return left.sequence - right.sequence;
  });

  return timedSegments.map((item) => item.segment);
}

async function buildTaskExecutionTrace(
  taskId: string,
  authorization: string,
  requestedSessionId?: string,
  includeLineage = true,
): Promise<{ ok: true; status: 200; data: TaskExecutionTraceRecord } | { ok: false; status: number; data: unknown }> {
  const taskResult = await cpFetch<ExecutableTask>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    {
      authorization,
    },
  );
  if (!taskResult.ok) {
    return { ok: false as const, status: taskResult.status, data: taskResult.data };
  }

  const task = taskResult.data;
  const parsedStrategy = parseExecutionTraceStrategy(task.strategy);
  const workflowContextRecord = await buildWorkflowPromptContext(task, authorization, {
    selectedAgent: parsedStrategy.selectedAgent,
    selectedModel: task.selectedModel || undefined,
    taskResult: "",
    changesSummary: "",
  });
  const workflowContext = renderWorkflowContextBlock(workflowContextRecord);
  const segments: ExecutionTraceSegmentRecord[] = [];
  if (workflowContext) {
    segments.push({
      type: "workflow-context",
      label: "工作流注入上下文",
      content: workflowContext,
    });
  }

  const timedSegments: Array<{ segment: ExecutionTraceSegmentRecord; sortTime: number; sequence: number }> = [];
  let timedSequence = 0;

  for (const hook of parsedStrategy.hookExecutions) {
    const hookTime = parseTraceSegmentTimestamp(hook.completedAt) ?? Number.MAX_SAFE_INTEGER;

    if (hook.prompt) {
      timedSegments.push({
        segment: {
          type: "hook-injection",
          label: `Hook 输入: ${hook.hookId}`,
          content: hook.prompt,
          hookId: hook.hookId,
          hookTrigger: hook.trigger,
          hookAgent: hook.agent,
          hookDecisionAction: hook.decision?.action,
          timestamp: hook.completedAt,
        },
        sortTime: hookTime,
        sequence: timedSequence++,
      });
    }

    if (hook.result) {
      timedSegments.push({
        segment: {
          type: "hook-result",
          label: `Hook 输出: ${hook.hookId}`,
          content: hook.result,
          hookId: hook.hookId,
          hookTrigger: hook.trigger,
          hookAgent: hook.agent,
          hookDecisionAction: hook.decision?.action,
          timestamp: hook.completedAt,
        },
        sortTime: hookTime,
        sequence: timedSequence++,
      });
    }

    if (hook.decision?.action === "rewrite-prompt" && hook.decision.rewrittenPrompt) {
      timedSegments.push({
        segment: {
          type: "hook-rewrite",
          label: `Hook 重写 Prompt: ${hook.hookId}`,
          content: hook.decision.rewrittenPrompt,
          hookId: hook.hookId,
          hookTrigger: hook.trigger,
          hookAgent: hook.agent,
          hookDecisionAction: hook.decision.action,
          timestamp: hook.completedAt,
        },
        sortTime: hookTime,
        sequence: timedSequence++,
      });
    }
  }

  const sessionId = requestedSessionId || task.sessionId || null;
  const messages: ExecutionTraceMessageRecord[] = [];
  let timeline: TaskSessionTimelineItemRecord[] = [];
  let finalPrompt: string | null = null;
  let latestResponse: string | null = null;
  let truncated = false;
  let messageLimit = 200;
  let timelineMeta: TaskSessionTimelineMetaRecord | undefined;

  if (sessionId) {
    const timelineMessages = await loadExecutionTraceMessagesFromTimeline(task.id, sessionId, authorization, {
      includeLineage,
    });

    if (timelineMessages) {
      timeline = timelineMessages.items;
      timelineMeta = timelineMessages.meta;
    }

    if (timelineMessages?.complete) {
      messages.push(...timelineMessages.messages);
      messageLimit = timelineMessages.messageLimit;
    } else {
      const messagesResult = await getSessionMessages(sessionId, {
        taskId: task.id,
        authorization,
        includeLineage,
      });
      if (messagesResult.ok && Array.isArray(messagesResult.data)) {
        const rawMessages = messagesResult.data as unknown[];
        truncated = rawMessages.length >= 200;
        messageLimit = 200;

        for (let index = 0; index < rawMessages.length; index += 1) {
          const rawMessage = rawMessages[index];
          const role = extractSessionMessageRole(rawMessage);
          const text = extractSessionMessageText(rawMessage);
          messages.push({
            id: extractExecutionTraceMessageId(rawMessage, `${index}`),
            role,
            text,
            createdAt: extractSessionMessageCreatedAt(rawMessage),
            raw: rawMessage,
          });
        }
      }
    }

    // Backfill first user message text from task.prompt when runtime
    // didn't persist the prompt content into session messages.
    if (task.prompt) {
      const firstUser = messages.find((item) => item.role === "user");
      if (firstUser && !firstUser.text) {
        firstUser.text = task.prompt;
      }
      const firstUserTimeline = timeline.find((item) => item.role === "user");
      if (firstUserTimeline && !firstUserTimeline.text) {
        firstUserTimeline.text = task.prompt;
      }
    }

    if (messages.length > 0) {
      const userMessages = messages.filter((item) => item.role === "user" && item.text);
      if (userMessages.length > 0) {
        finalPrompt = userMessages[userMessages.length - 1]?.text || null;
      }

      const assistantMessages = messages.filter((item) => item.role === "assistant" && item.text);
      if (assistantMessages.length > 0) {
        latestResponse = assistantMessages[assistantMessages.length - 1]?.text || null;
      }

      segments.push(...buildExecutionTraceConversationSegments(messages));
    }
  }

  if (messages.length === 0 && task.prompt) {
    segments.push({
      type: "user-input",
      label: "用户输入",
      content: task.prompt,
    });
  }

  timedSegments.sort((left, right) => {
    if (left.sortTime !== right.sortTime) {
      return left.sortTime - right.sortTime;
    }
    return left.sequence - right.sequence;
  });
  segments.push(...timedSegments.map((item) => item.segment));

  return {
    ok: true,
    status: 200,
    data: {
      taskId: task.id,
      sessionId,
      workflowContext,
      finalPrompt,
      latestResponse,
      truncated,
      messageLimit,
      segments,
      messages,
      timeline,
      timelineMeta,
      hookExecutions: parsedStrategy.hookExecutions.map((hook) => ({
        hookId: hook.hookId,
        trigger: hook.trigger,
        status: hook.status,
        agent: hook.agent,
        model: hook.model,
        prompt: hook.prompt,
        result: hook.result,
        error: hook.error,
        decision: hook.decision
          ? {
              action: hook.decision.action,
              reason: hook.decision.reason,
              rewrittenPrompt: hook.decision.rewrittenPrompt,
              targetModel: hook.decision.targetModel,
            }
          : undefined,
        completedAt: hook.completedAt,
      })),
    },
  };
}

function flattenWorkflowContextForHooks(
  context: WorkflowPromptContextRecord,
): Record<string, string | null | undefined> {
  return {
    ...context,
    currentStageExitCriteria: context.currentStageExitCriteria?.join("；"),
    completedStageOutputs: context.completedStageOutputs?.join("\n"),
    pendingStageLabels: context.pendingStageLabels?.join(" → "),
  };
}

async function runPreExecutionHooks(
  task: ExecutableTask,
  repoContext: ReturnType<typeof buildRepoContext>,
  executionAgent: string,
  classification: IntentClassification,
  executionMode: ExecutionMode,
  effectiveModel: string | undefined,
  authorization: string,
) {
  const strategy = readOrchestrationStrategy();
  let breakerReason: string | undefined;
  const workflowContext = await buildWorkflowPromptContext(task, authorization, {
    taskCategory: classification.category,
    executionMode,
    selectedAgent: executionAgent,
    selectedModel: effectiveModel,
    taskResult: "",
    changesSummary: "",
  });

  // Merge stage-level hooks with strategy-level hooks (stage takes priority)
  const rawStageHooks = await fetchCurrentStageHooks(task.id, authorization);
  const stageHooks = parseStageHooks(rawStageHooks);
  const mergedHooks = mergeStageAndStrategyHooks(stageHooks, strategy.hooks);
  const mergedStrategy: typeof strategy = { ...strategy, hooks: mergedHooks };

  const hookResult = await executeLifecycleHooks({
    strategy: mergedStrategy,
    trigger: "pre-execution",
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    titlePrefix: "Preflight",
    repoContext,
      context: flattenWorkflowContextForHooks(workflowContext),
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

  // Check for deny decision — any hook that returned deny blocks the execution
  const denyExecution = hookResult.hookExecutions.find(
    (exec) => exec.decision?.action === "deny",
  );
  if (denyExecution) {
    void recordAgentAudit({
      projectId: task.projectId,
      taskId: task.id,
      eventType: "lifecycle_hook",
      action: "pre_execution_denied",
      detail: {
        hookId: denyExecution.hookId,
        reason: denyExecution.decision?.reason,
        agent: denyExecution.agent,
      },
      riskLevel: "high",
    });
    return {
      prompt: prependWorkflowContextToPrompt(task.prompt, workflowContext),
      hookExecutions: hookResult.hookExecutions,
      breakerReason,
      denied: true,
      denyReason: denyExecution.decision?.reason || "Blocked by pre-execution hook",
    };
  }

  // Check for switch-model decision — the last one wins
  const switchModelExecution = [...hookResult.hookExecutions]
    .reverse()
    .find((exec) => exec.decision?.action === "switch-model" && exec.decision.targetModel);
  const switchedModel = switchModelExecution?.decision?.targetModel;

  if (switchedModel) {
    void recordAgentAudit({
      projectId: task.projectId,
      taskId: task.id,
      eventType: "lifecycle_hook",
      action: "pre_execution_switch_model",
      detail: {
        hookId: switchModelExecution?.hookId,
        targetModel: switchedModel,
        reason: switchModelExecution?.decision?.reason,
      },
      riskLevel: "medium",
    });
  }

  if (hookResult.rewrittenPrompt) {
    return {
      prompt: prependWorkflowContextToPrompt(hookResult.rewrittenPrompt, workflowContext),
      hookExecutions: hookResult.hookExecutions,
      breakerReason,
      switchedModel,
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
    switchedModel,
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

async function registerPrimaryTaskSession(
  task: Pick<ExecutableTask, "id">,
  sessionId: string | undefined,
  branchName: string,
  authorization: string,
  options?: { parentSessionId?: string },
) {
  if (!sessionId) {
    return;
  }

  if (options?.parentSessionId) {
    await ensureParentLineageRecord(task.id, options.parentSessionId, authorization, branchName).catch(
      () => null,
    );
  }

  await upsertTaskSessionLineageRecord(task.id, authorization, {
    runtimeSessionId: sessionId,
    parentRuntimeSessionId:
      options?.parentSessionId && options.parentSessionId !== sessionId
        ? options.parentSessionId
        : undefined,
    branchName,
    sourceType:
      options?.parentSessionId && options.parentSessionId !== sessionId ? "fork" : "root",
    isActive: true,
  }).catch(() => null);
}

async function prepareExecutionContext(
  task: ExecutableTask,
  authorization: string,
  overrides?: ExecuteOverrides,
): Promise<PreparedExecutionContext> {
  const identitySnapshot = await resolveExecutionIdentity(task, authorization);
  const { classification, executionAgent, strategy, plan } = selectExecutionAgent(
    task.prompt,
    overrides,
  );
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
    effectiveModel: resolvedModel ? formatModelRoute(resolvedModel) : undefined,
  };
}

async function finalizePreExecutionContext(
  context: PreparedExecutionContext,
): Promise<{ ok: true; context: ExecutionContext } | { ok: false; reason: string }> {
  const preExecutionHooks = await runPreExecutionHooks(
    context.task,
    context.repoContext,
    context.executionAgent,
    context.classification,
    context.plan.mode,
    context.effectiveModel,
    context.authorization,
  );

  if (preExecutionHooks.breakerReason) {
    return {
      ok: false,
      reason: preExecutionHooks.breakerReason,
    };
  }

  if (preExecutionHooks.denied) {
    return {
      ok: false,
      reason: preExecutionHooks.denyReason || "Blocked by pre-execution hook",
    };
  }

  // Apply switch-model decision if present
  let resolvedModel = context.resolvedModel;
  let effectiveModel = context.effectiveModel;
  if (preExecutionHooks.switchedModel) {
    const parts = preExecutionHooks.switchedModel.split(":");
    const [providerId, ...modelParts] = parts;
    const modelId = modelParts.join(":");
    if (providerId && modelId) {
      resolvedModel = { providerId, modelId };
      effectiveModel = preExecutionHooks.switchedModel;
    }
  }

  return {
    ok: true,
    context: {
      ...context,
      resolvedModel,
      effectiveModel,
      prompt: preExecutionHooks.prompt,
      hookExecutions: [...preExecutionHooks.hookExecutions],
      parentSessionId: context.task.sessionId || undefined,
    },
  };
}

function isParallelExecution(plan: ExecutionPlan) {
  return plan.mode === "parallel" && plan.candidates.length > 1;
}

function isSequentialChainExecution(plan: ExecutionPlan) {
  return plan.mode === "sequential-chain" && plan.steps.some((s) => s.type === "chain-step");
}

async function createParallelCandidateAttempts(
  context: ExecutionContext,
): Promise<ParallelCandidateAttempt[]> {
  return Promise.all(
    context.plan.candidates.map(async (candidate, index) => {
      try {
        const candidateModel = resolveCandidateExecutionModel(candidate, context.resolvedModel);
        const sessionResult = await createSession(
          context.task.id,
          context.task.projectId,
          context.prompt,
          {
            agent: candidate.agent,
            candidateIndex: index,
            repoContext: context.repoContext,
            model: candidateModel,
          },
        );
        if (sessionResult.agentRunId) {
          await createAgentRunRecord({
            taskId: context.task.id,
            agentRunId: sessionResult.agentRunId,
            sessionId: sessionResult.sessionId,
            agentType: candidate.agent,
            status: sessionResult.ok ? "running" : "failed",
            model: candidateModel,
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
  await registerParallelTaskSessions(context.task, context.plan, context.authorization, {
    parentSessionId: context.parentSessionId ?? null,
  }).catch(() => null);

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

  await registerPrimaryTaskSession(
    context.task,
    execResult.sessionId,
    context.task.title,
    context.authorization,
    { parentSessionId: context.parentSessionId ?? null },
  );

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

// ── Sequential-chain execution engine ───────────────────────────────

function buildChainStepPrompt(
  basePrompt: string,
  step: ExecutionPlan["steps"][0],
  stepIndex: number,
  allSteps: ExecutionPlan["steps"],
): string {
  const chainSteps = allSteps.filter((s) => s.type === "chain-step");
  const totalSteps = chainSteps.length;

  const parts: string[] = [basePrompt];

  // Inject completed step results as context
  const completedSteps = chainSteps.filter((s) => s.status === "completed" && s.result);
  if (completedSteps.length > 0) {
    parts.push("\n\n## 已完成步骤产出\n");
    for (const cs of completedSteps) {
      parts.push(`### ${cs.title}\n${cs.result}\n`);
    }
  }

  parts.push(`\n## 当前步骤 (${stepIndex + 1}/${totalSteps}): ${step.title}\n`);
  parts.push(step.instruction || "");
  parts.push("\n请只完成当前步骤的目标。完成后输出本步骤产出摘要。");

  return parts.join("\n");
}

async function startSequentialChainExecution(
  context: ExecutionContext,
): Promise<StartExecutionResponse> {
  const plan = context.plan;
  const stepIndex = plan.currentChainStepIndex ?? 0;
  const chainSteps = plan.steps.filter((s) => s.type === "chain-step");
  const currentStep = chainSteps[stepIndex];
  if (!currentStep) {
    return {
      status: 502,
      body: { error: "No chain step available to execute" },
    };
  }

  // Build the prompt for the first step
  const stepPrompt = buildChainStepPrompt(context.prompt, currentStep, stepIndex, plan.steps);

  // Resolve model override if the step specifies one
  let resolvedModel = context.resolvedModel;
  if (currentStep.model) {
    resolvedModel = parseModelString(currentStep.model);
  }

  currentStep.status = "running";

  const execResult = await createSession(
    context.task.id,
    context.task.projectId,
    stepPrompt,
    {
      agent: context.executionAgent,
      repoContext: context.repoContext,
      model: resolvedModel,
    },
  );

  if (execResult.agentRunId) {
    await createAgentRunRecord({
      taskId: context.task.id,
      agentRunId: execResult.agentRunId,
      sessionId: execResult.sessionId,
      agentType: context.executionAgent,
      status: execResult.ok ? "running" : "failed",
      model: resolvedModel,
      candidateIndex: stepIndex,
      error: execResult.ok ? undefined : execResult.error,
      startedAt: new Date().toISOString(),
      finishedAt: execResult.ok ? undefined : new Date().toISOString(),
    });
  }

  if (!execResult.ok) {
    currentStep.status = "failed";
    await markTaskFailed(context.task.id, context.authorization);
    return {
      status: 502,
      body: { error: execResult.error || "Failed to start chain step" },
    };
  }

  plan.candidates[0] = {
    ...plan.candidates[0],
    agent: plan.candidates[0]?.agent || "executor",
    sessionId: execResult.sessionId,
    agentRunId: execResult.agentRunId,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  await persistExecutionStart(context, execResult);

  // Register for sequential chain tracking in SSE aggregator
  sseAggregator.registerSequentialChainTask(
    context.task.id,
    execResult.sessionId!,
    plan,
    context.authorization,
  );

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
      agent: context.executionAgent,
      executionMode: "sequential-chain",
      chainStepIndex: stepIndex,
      chainStepTitle: currentStep.title,
      totalSteps: chainSteps.length,
    },
  });

  if (execResult.sessionId) {
  await registerPrimaryTaskSession(
    context.task,
    execResult.sessionId,
    `${context.task.title} — ${currentStep.title}`,
    context.authorization,
    { parentSessionId: context.parentSessionId ?? null },
  );
  }

  return {
    status: 200,
    body: {
      taskId: context.task.id,
      sessionId: execResult.sessionId,
      agentRunId: execResult.agentRunId,
      status: "running",
      executionMode: "sequential-chain",
      chainStepIndex: stepIndex,
      totalSteps: chainSteps.length,
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

  const result = await cpFetch(`/api/project-tree/tasks?${params.toString()}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 502));
});

// GET /api/tasks/:taskId — Get task detail
taskRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/project-tree/tasks/${encodeURIComponent(taskId)}`, {
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

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

taskRoutes.get("/:taskId/operating-mode", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch<{ data?: OperatingModeSelectionRecord | null }>(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/mode`,
    {
      authorization: authHeader(c),
    },
  );

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
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

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
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

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
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
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
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
  executionMode: z.enum(["single", "parallel", "sequential-chain"]).optional(),
  executionPlan: z.string().optional(),
  parallelRunHistory: z.string().optional(),
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

  // Parse optional execution overrides from body
  let overrides: ExecuteOverrides | undefined;
  try {
    const rawBody = await c.req.json().catch(() => undefined);
    if (rawBody) {
      const parsed = executeBodySchema.safeParse(rawBody);
      if (parsed.success && parsed.data) {
        overrides = parsed.data;
      }
    }
  } catch {
    // No body or invalid body — proceed with defaults
  }

  const taskResult = await fetchExecutableTask(taskId, authorization);
  if (!taskResult.ok) {
    return c.json({ error: "Task not found" }, 404);
  }

  const task = taskResult.data;
  const validationError = validateExecutableTask(task);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const preparedContext = await prepareExecutionContext(task, authorization, overrides);
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
  const response = isSequentialChainExecution(executionContext.plan)
    ? await startSequentialChainExecution(executionContext)
    : isParallelExecution(executionContext.plan)
      ? await startParallelExecution(executionContext)
      : await startSingleExecution(executionContext);

  return c.json(response.body, response.status);
});

// POST /api/tasks/:taskId/candidates/:index/adopt — Manually adopt a parallel candidate
taskRoutes.post("/:taskId/candidates/:index/adopt", async (c) => {
  const taskId = c.req.param("taskId");
  const candidateIndex = Number.parseInt(c.req.param("index"), 10);
  const authorization = authHeader(c);

  if (Number.isNaN(candidateIndex) || candidateIndex < 0) {
    return c.json({ error: "Invalid candidate index" }, 400);
  }

  // Fetch the task
  const taskResult = await cpFetch<ExecutableTask & { executionPlan?: string; result?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );
  if (!taskResult.ok) {
    return c.json({ error: "Task not found" }, 404);
  }

  const task = taskResult.data;
  if (!task.executionPlan) {
    return c.json({ error: "Task has no execution plan" }, 400);
  }

  let plan: ExecutionPlan;
  try {
    plan = JSON.parse(task.executionPlan) as ExecutionPlan;
  } catch {
    return c.json({ error: "Invalid execution plan" }, 400);
  }

  if (plan.mode !== "parallel") {
    return c.json({ error: "Candidate adoption is only available for parallel execution" }, 400);
  }

  const candidate = plan.candidates[candidateIndex];
  if (!candidate) {
    return c.json({ error: `Candidate ${candidateIndex} not found` }, 404);
  }

  if (candidate.status !== "completed") {
    return c.json({ error: `Candidate ${candidateIndex} is not completed (status: ${candidate.status})` }, 400);
  }

  // Set the winner
  plan.winnerCandidateIndex = candidateIndex;
  const winnerResult = candidate.result;
  const finishedAt = new Date().toISOString();

  for (const [index, currentCandidate] of plan.candidates.entries()) {
    if (index === candidateIndex || currentCandidate.status !== "running") {
      continue;
    }

    const terminateResult = currentCandidate.agentRunId
      ? await terminateAgent(currentCandidate.agentRunId)
      : { ok: true as const };

    const stopMessage = terminateResult.ok
      ? "Manual candidate adoption ended this parallel run before the candidate completed."
      : `Failed to stop after manual candidate adoption: ${terminateResult.error || "unknown error"}`;

    currentCandidate.status = terminateResult.ok ? "stopped" : "failed";
    currentCandidate.result = currentCandidate.result || `[${terminateResult.ok ? "STOPPED" : "FAILED"}] ${stopMessage}`;
    currentCandidate.finishedAt = finishedAt;
  }

  if (candidate.sessionId) {
    await registerParallelTaskSessions(task, plan, authorization);
    const activation = await activateTaskSessionLineage(taskId, candidate.sessionId, authorization);
    if (!activation.ok) {
      return c.json({ error: activation.error }, activation.status);
    }

    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "session.activated",
      ts: new Date().toISOString(),
      taskId,
      projectId: task.projectId,
      data: {
        sessionId: candidate.sessionId,
        branchName: activation.branchName,
        source: "candidate-adopt",
      },
    });
  }

  await persistWorkflowStageExecutionOutcome({
    taskId,
    authorization,
    resultText: winnerResult,
    source: "manual-adopt",
  }).catch((error) => {
    console.error(`Failed to persist workflow stage outcome for adopted candidate:`, error);
  });

  // Update the task
  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    authorization,
    body: {
      status: "completed",
      executionPlan: JSON.stringify(plan),
      parallelRunHistory: upsertParallelRunHistory(task, plan as ParallelExecutionPlanRecord),
      ...(winnerResult ? { result: winnerResult } : {}),
    },
  });

  await recordAgentAudit({
    projectId: task.projectId,
    taskId,
    eventType: "task",
    action: "candidate_adopted",
    detail: {
      candidateIndex,
      executionMode: "parallel",
      hasResult: Boolean(winnerResult),
    },
    riskLevel: "low",
  });

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.completed",
    ts: new Date().toISOString(),
    taskId,
    projectId: task.projectId,
    data: {
      status: "completed",
      executionMode: "parallel",
      winnerCandidateIndex: candidateIndex,
      adoptedManually: true,
      ...(winnerResult ? { result: winnerResult } : {}),
    },
  });

  return c.json({ ok: true, winnerCandidateIndex: candidateIndex });
});

taskRoutes.post("/:taskId/complete", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);

  const workflowState = await fetchTaskWorkflowState({
    taskId,
    authorization,
    includeTask: true,
  });
  if (!workflowState.task?.id || !workflowState.task.projectId) {
    return c.json({ error: "Task not found" }, 404);
  }

  const task = workflowState.task;

  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    authorization,
    body: { status: "completed" },
  });

  const currentStage = workflowState.workflowRun?.currentStage ?? undefined;
  const stageSummary = buildStageArtifactSummary(task.result ?? undefined);
  const existingSummary = workflowState.stages.find((stage) => stage.stageKey === currentStage)
    ?.artifactsSummaryJson;

  if (currentStage) {
    await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/workflow/advance`, {
      method: "POST",
      authorization,
      body: {
        fromStage: currentStage,
        status: "completed",
        artifactsSummaryJson: existingSummary ?? stageSummary,
      },
    });
  }

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.completed",
    ts: new Date().toISOString(),
    taskId,
    projectId: task.projectId,
    data: {
      status: "completed",
      explicitCompletion: true,
      ...(task.result ? { result: task.result } : {}),
    },
  });

  return c.json({ ok: true });
});

taskRoutes.post("/:taskId/workflow/advance", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);

  const taskResult = await cpFetch<ExecutableTask & { result?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );
  if (!taskResult.ok) {
    return c.json({ error: "Task not found" }, 404);
  }

  const task = taskResult.data;
  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    authorization,
    body: { status: "completed" },
  });

  const outcome = await persistWorkflowStageExecutionOutcome({
    taskId,
    authorization,
    resultText: task.result ?? "[STAGE_COMPLETE]",
    source: "assistant-output",
    forceAdvance: true,
  });

  if (!outcome.updated) {
    return c.json({ error: "Workflow stage not found or not updated" }, 404);
  }

  return c.json({
    ok: true,
    nextStageKey: outcome.nextStageKey,
    spawnedTaskId: outcome.spawnedTaskId,
  });
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
// BRANCH ROUTES — Expose task branch and lineage views
// ═══════════════════════════════════════════════════════════════════

// GET /api/tasks/:taskId/branches — List task branches
taskRoutes.get("/:taskId/branches", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);

  // Get task to find its sessionId
  const taskResult = await cpFetch<{ sessionId?: string; title?: string; status?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );

  if (!taskResult.ok) {
    return c.json({ data: [] });
  }

  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  const lineageRecords = lineageResult.activeRecords;

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

  return c.json({ data: [] });
});

// GET /api/tasks/:taskId/execution-trace — Get full execution trace for task detail
taskRoutes.get(":taskId/execution-trace", async (c) => {
  const taskId = c.req.param("taskId") as string;
  const authorization = authHeader(c);
  const requestedSessionId = c.req.query("sessionId") || undefined;
  const includeLineage = c.req.query("includeLineage") !== "false";

  const result = await buildTaskExecutionTrace(taskId, authorization, requestedSessionId, includeLineage);
  if (!result.ok) {
    return c.json(result.data, result.status as 401 | 403 | 404 | 502);
  }

  return c.json(result.data, 200);
});

const runtimePermissionReplySchema = z.object({
  reply: z.enum(["once", "always", "reject"]),
  message: z.string().max(500).optional(),
});

taskRoutes.get("/:taskId/runtime-permissions", async (c) => {
  const result = await fetchTaskRuntimePermissions({
    taskId: c.req.param("taskId"),
    authorization: authHeader(c),
    sessionId: c.req.query("sessionId") || undefined,
  });

  return c.json(result.data, result.ok ? 200 : result.status);
});

taskRoutes.post(
  "/:taskId/runtime-permissions/:requestId/reply",
  zValidator("json", runtimePermissionReplySchema),
  async (c) => {
    const taskId = c.req.param("taskId");
    const requestId = c.req.param("requestId");
    const authorization = authHeader(c);
    const body = c.req.valid("json") as { reply: RuntimePermissionReply; message?: string };

    const permissionResult = await resolveTaskRuntimePermission({
      taskId,
      authorization,
      requestId,
    });
    if (!permissionResult.ok) {
      return c.json(permissionResult.data, permissionResult.status);
    }

    const replyResult = await replyRuntimePermission(requestId, body);
    if (!replyResult.ok) {
      return c.json({ error: replyResult.error || "Failed to reply runtime permission" }, 502);
    }

    return c.json({
      ok: true,
      requestId,
      sessionId: permissionResult.data.sessionId,
      reply: body.reply,
    });
  },
);

// POST /api/tasks/:taskId/continue — Continue a task (send follow-up prompt to its session)
const continueSchema = z.object({
  prompt: z.string().min(1).max(50000),
  sessionId: z.string().optional(),
  executionMode: z.enum(["single", "parallel", "sequential-chain"]).optional(),
});

taskRoutes.post("/:taskId/continue", zValidator("json", continueSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const { prompt, sessionId: overrideSessionId, executionMode } = c.req.valid("json");
  const authorization = authHeader(c);
  const result = await continueTaskExecution({
    taskId,
    prompt,
    overrideSessionId,
    executionMode,
    authorization,
  });
  return c.json(result.body, result.status);
});

const forkSessionSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  messageId: z.string().optional(),
});

async function executeTaskBranchFork(args: {
  taskId: string;
  sessionId: string;
  title?: string;
  messageId?: string;
  authorization: string;
}) {
  const taskResult = await cpFetch<{ projectId?: string; title?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(args.taskId)}`,
    { authorization: args.authorization },
  );

  if (!taskResult.ok) {
    return { status: 404 as const, body: { error: "Task not found" } };
  }

  await ensureParentLineageRecord(
    args.taskId,
    args.sessionId,
    args.authorization,
    taskResult.data?.title,
  );

  const defaultTitle =
    args.title || `[Task ${args.taskId.slice(0, 8)}] Fork ${new Date().toLocaleTimeString()}`;
  const result = await forkSession(args.sessionId, { title: defaultTitle });

  if (!result.ok || !result.sessionId) {
    return { status: 502 as const, body: { error: result.error || "Failed to fork session" } };
  }

  await upsertTaskSessionLineageRecord(args.taskId, args.authorization, {
    runtimeSessionId: result.sessionId,
    parentRuntimeSessionId: args.sessionId,
    forkedFromMessageId: args.messageId,
    branchName: defaultTitle,
    sourceType: "fork",
    isActive: true,
  });

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.forked",
    ts: new Date().toISOString(),
    taskId: args.taskId,
    projectId: taskResult.data?.projectId,
    sessionId: result.sessionId,
    data: {
      parentSessionId: args.sessionId,
      title: defaultTitle,
      forkedFromMessageId: args.messageId,
    },
  });

  return {
    status: 200 as const,
    body: {
      ok: true,
      sessionId: result.sessionId,
      title: defaultTitle,
      parentSessionId: args.sessionId,
      forkedFromMessageId: args.messageId,
    },
  };
}

taskRoutes.post(
  "/:taskId/branches/:sessionId/fork",
  zValidator("json", forkSessionSchema),
  async (c) => {
    const result = await executeTaskBranchFork({
      taskId: c.req.param("taskId"),
      sessionId: c.req.param("sessionId"),
      ...c.req.valid("json"),
      authorization: authHeader(c),
    });
    return c.json(result.body, result.status);
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

function extractSessionMessageId(message: unknown) {
  const record = asRecord(message);
  const info = asRecord(record?.info);
  return asNonEmptyString(info?.id) || asNonEmptyString(record?.id);
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
    blocks.find((block) => !block.startsWith("- Opener-X task ID:")) ??
    blocks[0] ??
    text;

  const normalized = preferredBlock.replace(/\s+/g, " ").trim();
  const preview = normalized.length > 72 ? `${normalized.slice(0, 71).trimEnd()}…` : normalized;

  return {
    role,
    preview: preview || null,
  } as const;
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
    await upsertTaskSessionLineageRecord(taskId, authorization, {
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
    });
  }
}

async function ensureParentLineageRecord(
  taskId: string,
  parentSessionId: string,
  authorization: string,
  taskTitle?: string,
) {
  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  const existingRecords = lineageResult.activeRecords;

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

  await upsertTaskSessionLineageRecord(taskId, authorization, {
    runtimeSessionId: parentSessionId,
    parentRuntimeSessionId: inferredParentId,
    branchName: runtime?.title ?? taskTitle,
    sourceType: inferredParentId ? "fork" : "root",
    isActive: false,
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

async function activateTaskSessionLineage(
  taskId: string,
  sessionId: string,
  authorization: string,
): Promise<{ ok: true; branchName: string | null } | { ok: false; status: 404 | 502; error: string }> {
  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);

  if (!lineageResult.ok) {
    return { ok: false, status: 502, error: "Failed to fetch branch lineage" };
  }

  const record = lineageResult.records.find(
    (r: TaskSessionRecord) => r.runtimeSessionId === sessionId,
  );
  if (!record) {
    return { ok: false, status: 404, error: "Session not found in branch lineage" };
  }

  const activateResult = await activateTaskSessionLineageByRecordId(
    taskId,
    record.id,
    authorization,
  );

  if (!activateResult.ok) {
    return { ok: false, status: 502, error: "Failed to activate session" };
  }

  return { ok: true, branchName: record.branchName };
}

async function executeTaskBranchActivation(args: {
  taskId: string;
  sessionId: string;
  authorization: string;
}) {
  const activation = await activateTaskSessionLineage(
    args.taskId,
    args.sessionId,
    args.authorization,
  );
  if (!activation.ok) {
    return { status: activation.status, body: { error: activation.error } };
  }

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "session.activated",
    ts: new Date().toISOString(),
    taskId: args.taskId,
    data: { sessionId: args.sessionId, branchName: activation.branchName },
  });

  return { status: 200 as const, body: { ok: true, sessionId: args.sessionId } };
}

async function executeTaskBranchArchive(args: {
  taskId: string;
  sessionId: string;
  authorization: string;
}) {
  const lineageResult = await fetchTaskSessionLineageRecords(args.taskId, args.authorization);

  if (!lineageResult.ok) {
    return { status: 502 as const, body: { error: "Failed to fetch branch lineage" } };
  }

  const record = lineageResult.records.find(
    (r: TaskSessionRecord) => r.runtimeSessionId === args.sessionId,
  );
  if (!record) {
    return { status: 404 as const, body: { error: "Session not found in branch lineage" } };
  }

  const archiveResult = await archiveTaskSessionLineageByRecordId(
    args.taskId,
    record.id,
    args.authorization,
  );

  if (!archiveResult.ok) {
    return { status: 502 as const, body: { error: "Failed to archive session" } };
  }

  return { status: 200 as const, body: { ok: true } };
}

// GET /api/tasks/:taskId/branch-lineage — Return branch lineage tree for a task
taskRoutes.get("/:taskId/branch-lineage", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);

  const taskResult = await cpFetch<{ sessionId?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );

  // Fetch task_sessions lineage from control plane
  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  const lineageRecords = lineageResult.activeRecords;

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

// POST /api/tasks/:taskId/branches/:sessionId/activate — Activate a branch
taskRoutes.post("/:taskId/branches/:sessionId/activate", async (c) => {
  const result = await executeTaskBranchActivation({
    taskId: c.req.param("taskId"),
    sessionId: c.req.param("sessionId"),
    authorization: authHeader(c),
  });
  return c.json(result.body, result.status);
});

// POST /api/tasks/:taskId/branches/:sessionId/archive — Archive a branch
taskRoutes.post("/:taskId/branches/:sessionId/archive", async (c) => {
  const result = await executeTaskBranchArchive({
    taskId: c.req.param("taskId"),
    sessionId: c.req.param("sessionId"),
    authorization: authHeader(c),
  });
  return c.json(result.body, result.status);
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
