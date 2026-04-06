import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { authHeader, cpFetch } from "../../lib/control-plane-client";
import { classifyIntent } from "../../lib/intent-classifier";
import {
  diagnoseModelReadiness,
  formatModelRoute,
  readDefaultExecutionModel,
  resolveModelRoute,
  validateModelProvider,
} from "../../lib/opencode-config";
import {
  type ChainStepInput,
  DEFAULT_EXECUTION_AGENT,
  type ExecutionMode,
  type ExecutionStep,
  type HookExecutionRecord,
  type OrchestrationStrategy,
  type RuntimePlan,
  buildRuntimePlan,
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
import { ensureAgentRunForSession } from "../agent-control/agent-run-registry";
import { buildExecutionContext } from "../agent-control/runtime-execution-context";
import { createAgentRunRecord, recordAgentAudit } from "../agent-control/run-persistence";
import {
  continueSession,
  createSession,
  forkSession,
  getSessionMessages,
  listRuntimePermissions,
  listSessions,
  replyRuntimePermission,
  terminateAgent,
  type RuntimePermissionReply,
  type RuntimePermissionRequest,
} from "../agent-control/runtime-provider";
import { executeLifecycleHooks } from "../hooks/lifecycle-hooks";
import { buildPipelineStageUpdatedEvents } from "../realtime/pipeline-events";
import { sseAggregator } from "../realtime/sse-aggregator";
import { wsBroadcaster } from "../realtime/ws-broadcaster";
import { buildTaskMemberViewModel } from "./member-view";
import { reconcileRunningTasksOnStartup } from "./reconcile";
import {
  type TaskSessionLineageRecord,
  type TaskSessionTimelineMeta,
  createProjectionTraceTimelineMeta,
  fetchTaskConversationMessages,
  fetchTaskSessionCachedMessages,
  fetchTaskSessionLineageRecords as fetchTaskSessionCompatLineageRecords,
  normalizeTaskSessionTimelineMeta,
  persistTaskSessionMessageSnapshot,
  toCanonicalTaskSessionId,
  upsertTaskSessionLineageRecord as upsertTaskSessionCompatLineageRecord,
} from "./task-session-compat";
import { buildWorkflowExecutionPromptSnapshot } from "./workflow-stage-execution";
import { buildTaskWorkflowViewModel } from "./workflow-view";

// ── Task Routes (BFF) ──────────────────────────────────────────────

type AppEnv = { Variables: { user: JWTPayload } };

export const taskRoutes = new Hono<AppEnv>();

type IntentClassification = ReturnType<typeof classifyIntent>;
type ResolvedModel = { providerId: string; modelId: string };
type SessionStartResult = Awaited<ReturnType<typeof createSession>>;
type ParallelRuntimePlanRecord = Pick<
  RuntimePlan,
  "templateId" | "mode" | "steps" | "candidates" | "judgeResult" | "winnerCandidateIndex"
> & { parallelRunId?: string };

interface StartExecutionResponse {
  status: 200 | 403 | 409 | 502;
  body: Record<string, unknown>;
}

interface SessionSummaryRecord {
  id: string;
  taskSessionId?: string;
  title: string;
  isActive: boolean;
  summary: { additions: number; deletions: number; files: number } | null;
  createdAt: string | null;
  updatedAt: string | null;
  executionStatus?: string | null;
  sessionKind?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  executionModeSnapshot?: string | null;
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
  orchestrationKind?: string | null;
  currentRunId?: string | null;
  executionMode?: ExecutionMode | null;
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

function isProjectionBackedTask(task: Pick<ExecutableTask, "currentRunId">) {
  return typeof task.currentRunId === "string" && task.currentRunId.length > 0;
}

interface TaskDomainRunSummaryRecord {
  id: string;
  orchestrationKind: "single" | "parallel" | "sequential-chain";
  winnerNodeId?: string | null;
  judgeNodeId?: string | null;
}

interface TaskDomainRunNodeRecord {
  id: string;
  nodeKind: string;
  title?: string | null;
  candidateIndex?: number | null;
  agentType?: string | null;
  modelUsed?: string | null;
  sessionId?: string | null;
  agentRunId?: string | null;
  status: string;
  resultText?: string | null;
  resultSummary?: string | null;
  errorText?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface TaskDomainRunDetailRecord {
  run: TaskDomainRunSummaryRecord;
  nodes: TaskDomainRunNodeRecord[];
  candidateNodes: TaskDomainRunNodeRecord[];
  judgeNode: TaskDomainRunNodeRecord | null;
  winnerCandidateIndex: number | null;
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
  sessionKind?:
    | "primary"
    | "candidate"
    | "judge"
    | "sequential_step"
    | "resume"
    | "manual_branch"
    | "hook";
  executionModeSnapshot?: "single" | "parallel" | "sequential_chain";
  isActive: boolean;
  candidateIndex?: number;
  stepIndex?: number;
  selectedModel?: string;
  coordinationKey?: string;
  operationId?: string;
}

async function fetchTaskSessionLineageRecords(taskId: string, authorization: string) {
  const lineageResult = await fetchTaskSessionCompatLineageRecords(taskId, authorization);
  const records = lineageResult.records.map((record) => coerceTaskSessionRecord(taskId, record));

  return {
    ...lineageResult,
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
  if (
    taskResult.ok &&
    typeof taskResult.data?.sessionId === "string" &&
    taskResult.data.sessionId.trim()
  ) {
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
      permission.metadata && typeof permission.metadata === "object" ? permission.metadata : null,
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
  return upsertTaskSessionCompatLineageRecord(taskId, authorization, input);
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

async function fetchTaskProjectionSnapshot(taskId: string, authorization: string) {
  return cpFetch<TaskProjectionSnapshotResponseRecord>(
    `/api/tasks/${encodeURIComponent(taskId)}/snapshot`,
    { authorization },
  );
}

async function fetchTaskProjectionSnapshots(
  authorization: string,
  options?: { projectId?: string; status?: string; limit?: number },
) {
  const params = new URLSearchParams();
  if (options?.projectId) {
    params.set("projectId", options.projectId);
  }
  if (options?.status) {
    params.set("status", options.status);
  }
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return cpFetch<{ data?: TaskProjectionSnapshotRecord[] }>(`/api/tasks/snapshots${suffix}`, {
    authorization,
  });
}

async function fetchTaskProjectionTimelineView(
  taskId: string,
  authorization: string,
  options?: { sessionId?: string; includeLineage?: boolean },
) {
  const params = new URLSearchParams();
  const canonicalSessionId =
    typeof options?.sessionId === "string" && options.sessionId.trim().length > 0
      ? toCanonicalTaskSessionId(taskId, options.sessionId)
      : null;
  if (canonicalSessionId) {
    params.set("sessionId", canonicalSessionId);
  }
  if (options?.includeLineage === false) {
    params.set("includeLineage", "false");
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return cpFetch<TaskProjectionTimelineViewResponseRecord>(
    `/api/tasks/${encodeURIComponent(taskId)}/timeline-view${suffix}`,
    { authorization },
  );
}

async function activateTaskSessionLineageByRecordId(
  taskId: string,
  recordId: string,
  authorization: string,
) {
  return cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/sessions/${encodeURIComponent(recordId)}/activate`,
    { method: "POST", authorization },
  );
}

async function archiveTaskSessionLineageByRecordId(
  taskId: string,
  recordId: string,
  authorization: string,
) {
  return cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/sessions/${encodeURIComponent(recordId)}/archive`,
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
  operationId: string;
  identitySnapshot: IdentitySnapshot;
  classification: IntentClassification;
  executionAgent: string;
  strategy: OrchestrationStrategy;
  plan: RuntimePlan;
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

type TaskSessionTimelineMetaRecord = TaskSessionTimelineMeta;

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
  meta?: TaskSessionTimelineMetaRecord;
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
  snapshot?: TaskProjectionSnapshotRecord | null;
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
      action: string;
      reason?: string;
      rewrittenPrompt?: string;
      targetModel?: string;
    };
    completedAt: string;
  }>;
  followupExecutions: Array<{
    templateId: string;
    triggerHookId: string;
    status: string;
    agent: string;
    model?: string;
    prompt: string;
    result?: string;
    error?: string;
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
  parentSessionId?: string;
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
    : ({
        ok: false as const,
        status: 502 as const,
        data: { error: "Failed to persist continuation guard configuration" },
      } as const);
}

function parseStoredTaskClassification(
  task: Pick<ExecutableTask, "category">,
): Pick<IntentClassification, "category"> | null {
  return typeof task.category === "string" && task.category.trim()
    ? { category: task.category.trim() as IntentClassification["category"] }
    : null;
}

function buildStoredParallelPlan(
  task: Pick<ExecutableTask, "strategy">,
): ParallelRuntimePlanRecord | null {
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
      typeof parsedStrategy.selectedTemplateId === "string" &&
      parsedStrategy.selectedTemplateId.trim()
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

function resolveParallelContinuationPlan(task: Pick<ExecutableTask, "strategy">) {
  return buildStoredParallelPlan(task);
}

function resolveCandidateExecutionModel(
  candidate: RuntimePlan["candidates"][number],
  fallbackModel?: ResolvedModel,
): ResolvedModel | undefined {
  if (candidate.model) {
    return parseModelString(candidate.model);
  }

  return fallbackModel;
}

function resolvePreflightModelForParallelPlan(
  plan: Pick<RuntimePlan, "candidates">,
  fallbackModel?: ResolvedModel,
): ResolvedModel | undefined {
  const parsedCandidates = plan.candidates
    .map((candidate) => candidate.model)
    .filter((model): model is string => Boolean(model?.trim()))
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
  plan: RuntimePlan,
  authorization: string,
  options?: { parentSessionId?: string; operationId?: string },
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

  await registerParallelTaskSessionCandidates(task, candidatesWithSessions, authorization, options);
}

async function registerParallelTaskSessionCandidates(
  task: Pick<ExecutableTask, "id" | "title" | "sessionId">,
  candidatesWithSessions: Array<{ index: number; sessionId: string; branchName: string }>,
  authorization: string,
  options?: { parentSessionId?: string; operationId?: string },
) {
  if (candidatesWithSessions.length === 0) {
    return;
  }

  const lineageContext = await loadParallelTaskSessionLineageContext(task, authorization, options);
  const rootSessionId = resolveParallelRootSessionId(task, candidatesWithSessions, lineageContext);

  if (!rootSessionId) {
    return;
  }

  const orderedCandidates = orderParallelTaskSessionCandidates(
    candidatesWithSessions,
    rootSessionId,
  );

  for (const candidate of orderedCandidates) {
    const parentRuntimeSessionId = resolveParallelCandidateParentSessionId(
      candidate,
      rootSessionId,
      options,
    );
    const nextSourceType = parentRuntimeSessionId ? "fork" : "root";
    const existingRecord = lineageContext.existingRecordMap.get(candidate.sessionId);

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
      operationId: options?.operationId,
    });
    lineageContext.existingSessionIds.add(candidate.sessionId);
    lineageContext.existingRecordMap.set(candidate.sessionId, {
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

async function loadParallelTaskSessionLineageContext(
  task: Pick<ExecutableTask, "id" | "title" | "sessionId">,
  authorization: string,
  options?: { parentSessionId?: string },
) {
  const lineageResult = await fetchTaskSessionLineageRecords(task.id, authorization);
  const { records: normalizedRecords } = normalizeLineageRecords(lineageResult.activeRecords);
  const existingSessionIds = new Set(normalizedRecords.map((record) => record.runtimeSessionId));
  const existingRecordMap = new Map(
    normalizedRecords.map((record) => [record.runtimeSessionId, record] as const),
  );
  const existingRoot = normalizedRecords.find((record) => record.sourceType === "root");

  if (options?.parentSessionId && !existingSessionIds.has(options.parentSessionId)) {
    await ensureParentLineageRecord(
      task.id,
      options.parentSessionId,
      authorization,
      task.title,
    ).catch(() => null);
    existingSessionIds.add(options.parentSessionId);
  }

  return {
    existingSessionIds,
    existingRecordMap,
    existingRoot,
  };
}

function resolveParallelRootSessionId(
  task: Pick<ExecutableTask, "sessionId">,
  candidatesWithSessions: Array<{ sessionId: string }>,
  lineageContext: Awaited<ReturnType<typeof loadParallelTaskSessionLineageContext>>,
) {
  return (
    lineageContext.existingRoot?.runtimeSessionId ||
    (task.sessionId && lineageContext.existingSessionIds.has(task.sessionId)
      ? task.sessionId
      : undefined) ||
    candidatesWithSessions[0]?.sessionId
  );
}

function orderParallelTaskSessionCandidates(
  candidatesWithSessions: Array<{ index: number; sessionId: string; branchName: string }>,
  rootSessionId: string,
) {
  return candidatesWithSessions.slice().sort((left, right) => {
    if (left.sessionId === rootSessionId) {
      return -1;
    }
    if (right.sessionId === rootSessionId) {
      return 1;
    }
    return left.index - right.index;
  });
}

function resolveParallelCandidateParentSessionId(
  candidate: { sessionId: string },
  rootSessionId: string,
  options?: { parentSessionId?: string },
) {
  if (options?.parentSessionId && options.parentSessionId !== candidate.sessionId) {
    return options.parentSessionId;
  }

  return candidate.sessionId === rootSessionId ? undefined : rootSessionId;
}

function broadcastParallelContinuationStarted(
  task: Pick<ExecutableTask, "id" | "projectId" | "title">,
  candidates: RuntimePlan["candidates"],
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

async function continueParallelTaskExecution(
  input: ContinueTaskInput & {
    task: ExecutableTask;
    classification?: Pick<IntentClassification, "category"> | null;
    resolvedModel?: ResolvedModel;
    guard?: PaidExecutionGuardState;
  },
) {
  const plan = resolveParallelContinuationPlan(input.task);
  if (!plan || plan.candidates.length < 2) {
    return {
      status: 400 as const,
      body: { error: "No parallel candidates configured for this task" },
    };
  }

  const repoContext = buildRepoContext(input.task, {});
  const attempts = await continueParallelPlanCandidates(input, plan, input.prompt, repoContext);

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
    return buildParallelContinuationFailureResponse(attempts);
  }

  const primaryCandidate = plan.candidates.find((candidate) => candidate.status === "running");
  await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    method: "PATCH",
    authorization: input.authorization,
    body: {
      status: "running",
      sessionId: primaryCandidate?.sessionId,
      agentRunId: primaryCandidate?.agentRunId,
      executionMode: "parallel",
      strategy: mergeTaskStrategy(input.task.strategy, {
        executionMode: "parallel",
        effectiveModel: input.resolvedModel ? formatModelRoute(input.resolvedModel) : undefined,
        paidExecutionGuard: input.guard,
      }),
    },
  });

  const continuationOperationId = crypto.randomUUID();
  await registerParallelTaskSessions(input.task, plan, input.authorization, {
    parentSessionId: input.parentSessionId,
    operationId: continuationOperationId,
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

type ParallelContinuationAttempt = {
  index: number;
  ok: boolean;
  sessionId?: string;
  agentRunId?: string;
  error?: string;
};

async function continueParallelPlanCandidates(
  input: ContinueTaskInput & {
    task: ExecutableTask;
    resolvedModel?: ResolvedModel;
  },
  plan: RuntimePlan,
  prompt: string,
  repoContext: ReturnType<typeof buildRepoContext>,
) {
  return Promise.all(
    plan.candidates.map((candidate, index) =>
      continueParallelPlanCandidate(input, candidate, index, prompt, repoContext),
    ),
  );
}

async function continueParallelPlanCandidate(
  input: ContinueTaskInput & {
    task: ExecutableTask;
    resolvedModel?: ResolvedModel;
  },
  candidate: RuntimePlan["candidates"][number],
  index: number,
  prompt: string,
  repoContext: ReturnType<typeof buildRepoContext>,
): Promise<ParallelContinuationAttempt> {
  const candidateModel = resolveCandidateExecutionModel(candidate, input.resolvedModel);
  const validationFailure = await validateParallelCandidateModel(candidateModel, index);
  if (validationFailure) {
    return validationFailure;
  }

  if (candidate.sessionId) {
    return continueExistingParallelCandidateSession(
      input,
      candidate,
      index,
      prompt,
      candidateModel,
    );
  }

  return createParallelCandidateSession(
    input,
    candidate,
    index,
    prompt,
    repoContext,
    candidateModel,
  );
}

async function validateParallelCandidateModel(
  candidateModel: ResolvedModel | undefined,
  index: number,
): Promise<ParallelContinuationAttempt | null> {
  if (!candidateModel) {
    return null;
  }

  const validationError = await validateResolvedModel(candidateModel);
  if (!validationError) {
    return null;
  }

  return {
    index,
    ok: false,
    error:
      typeof validationError.body?.error === "string"
        ? validationError.body.error
        : "Selected model is not available",
  };
}

async function continueExistingParallelCandidateSession(
  input: ContinueTaskInput & { task: ExecutableTask },
  candidate: RuntimePlan["candidates"][number],
  index: number,
  prompt: string,
  candidateModel: ResolvedModel | undefined,
): Promise<ParallelContinuationAttempt> {
  const agentRunId = ensureAgentRunForSession(
    candidate.sessionId as string,
    input.taskId,
    input.task.projectId,
    candidateModel,
  );
  const continuedResult = await continueSession(candidate.sessionId as string, prompt, {
    model: candidateModel,
  });
  return {
    index,
    ok: continuedResult.ok,
    sessionId: candidate.sessionId ?? undefined,
    agentRunId,
    error: continuedResult.ok
      ? undefined
      : continuedResult.error || "Failed to continue candidate session",
  };
}

async function createParallelCandidateSession(
  input: ContinueTaskInput & { task: ExecutableTask },
  candidate: RuntimePlan["candidates"][number],
  index: number,
  prompt: string,
  repoContext: ReturnType<typeof buildRepoContext>,
  candidateModel: ResolvedModel | undefined,
): Promise<ParallelContinuationAttempt> {
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
      status: sessionResult.ok ? "running" : "failed",
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
    error: sessionResult.ok
      ? undefined
      : sessionResult.error || "Failed to start parallel candidate",
  };
}

function buildParallelContinuationFailureResponse(attempts: ParallelContinuationAttempt[]) {
  return {
    status: 502 as const,
    body: {
      error:
        attempts.map((attempt) => attempt.error).find((value): value is string => Boolean(value)) ||
        "All parallel candidates failed to continue",
    },
  };
}

async function continueTaskExecution(input: ContinueTaskInput) {
  const continuationContext = await buildTaskContinuationContext(input);
  if (!continuationContext.ok) {
    return continuationContext.response;
  }

  const continuationGuardResult = await prepareTaskContinuation(continuationContext.context, input);
  if (!continuationGuardResult.ok) {
    return continuationGuardResult.response;
  }

  if (continuationContext.context.parallelPlan) {
    return continueParallelTaskExecutionFlow(
      input,
      continuationContext.context,
      continuationGuardResult.guard,
    );
  }

  return continueSingleTaskExecutionFlow(
    input,
    continuationContext.context,
    continuationGuardResult.guard,
  );
}

type TaskContinuationContext = {
  task: ExecutableTask;
  parallelPlan: RuntimePlan | null;
  sessionId?: string;
  resolvedModel?: ResolvedModel;
};

async function buildTaskContinuationContext(input: ContinueTaskInput): Promise<
  | { ok: true; context: TaskContinuationContext }
  | {
      ok: false;
      response:
        | { status: 404; body: { error: string } }
        | { status: 400; body: { error: string } }
        | { status: number; body: unknown };
    }
> {
  const taskResult = await fetchExecutableTask(input.taskId, input.authorization);
  if (!taskResult.ok) {
    return { ok: false, response: { status: 404 as const, body: { error: "Task not found" } } };
  }

  const task = taskResult.data;
  const parallelPlan = resolveTaskContinuationParallelPlan(task, input.executionMode);
  const sessionId = input.overrideSessionId || task.sessionId || undefined;
  if (!sessionId && !parallelPlan) {
    return {
      ok: false,
      response: { status: 400 as const, body: { error: "No session associated with this task" } },
    };
  }

  const resolvedModel = await resolveExecutionModel(
    { ...task, prompt: input.prompt, status: "running" },
    input.authorization,
  );
  if (resolvedModel) {
    const modelValidationError = await validateResolvedModel(resolvedModel);
    if (modelValidationError) {
      return {
        ok: false,
        response: { status: modelValidationError.status, body: modelValidationError.body },
      };
    }
  }

  return {
    ok: true,
    context: {
      task,
      parallelPlan,
      sessionId,
      resolvedModel,
    },
  };
}

function resolveTaskContinuationParallelPlan(
  task: ExecutableTask,
  executionMode: ContinueTaskInput["executionMode"],
) {
  return executionMode === "single" || executionMode === "sequential-chain"
    ? null
    : resolveParallelContinuationPlan(task);
}

async function prepareTaskContinuation(
  context: TaskContinuationContext,
  input: ContinueTaskInput,
): Promise<
  | { ok: true; guard: PaidExecutionGuardState | null | undefined }
  | { ok: false; response: { status: number; body: unknown } }
> {
  const preflightModel = context.parallelPlan
    ? resolvePreflightModelForParallelPlan(context.parallelPlan, context.resolvedModel)
    : context.resolvedModel;

  const preflightResult = await buildContinuationPreflight({
    task: context.task,
    authorization: input.authorization,
    resolvedModel: preflightModel,
    candidateCount: context.parallelPlan?.candidates.length,
  });
  if (!preflightResult.ok) {
    return { ok: false, response: { status: preflightResult.status, body: preflightResult.data } };
  }

  const blockedResponse = await buildBlockedTaskContinuationResponse(
    context,
    input,
    preflightResult.preflight,
    preflightResult.guard,
  );
  if (blockedResponse) {
    return { ok: false, response: blockedResponse };
  }

  const guardPersistResult = await persistContinuationGuard({
    taskId: input.taskId,
    authorization: input.authorization,
    strategy: context.task.strategy,
    resolvedModel: context.resolvedModel,
    guard: preflightResult.guard,
  });
  if (!guardPersistResult.ok) {
    return {
      ok: false,
      response: { status: guardPersistResult.status, body: guardPersistResult.data },
    };
  }

  return { ok: true, guard: preflightResult.guard };
}

async function buildBlockedTaskContinuationResponse(
  context: TaskContinuationContext,
  input: ContinueTaskInput,
  preflight: PaidExecutionPreflightResult,
  guard: PaidExecutionGuardState | null | undefined,
) {
  if (preflight.allowed) {
    return null;
  }

  await recordPaidExecutionAuditEvent({
    projectId: context.task.projectId,
    taskId: input.taskId,
    sessionId: context.sessionId,
    action: "continue_blocked",
    preflight,
    guardState: guard ?? undefined,
    riskLevel: preflight.estimate.guardDecision === "allow-with-downgrade" ? "medium" : "high",
  });
  const blockedResponse = buildBlockedExecutionResponse(input.taskId, preflight);
  return { status: blockedResponse.status, body: blockedResponse.body };
}

async function continueParallelTaskExecutionFlow(
  input: ContinueTaskInput,
  context: TaskContinuationContext,
  guard: PaidExecutionGuardState | null | undefined,
) {
  const parallelPlan = context.parallelPlan;
  if (!parallelPlan) {
    return { status: 400 as const, body: { error: "No parallel plan available" } };
  }

  const parallelResult = await continueParallelTaskExecution({
    ...input,
    task: context.task,
    classification: parseStoredTaskClassification(context.task),
    parentSessionId: context.sessionId,
    resolvedModel: context.resolvedModel,
    guard: guard ?? undefined,
  });

  if (parallelResult.status === 200) {
    await handleSuccessfulParallelContinuation(
      input,
      context,
      guard,
      parallelPlan,
      parallelResult.body.sessionId,
      parallelResult.body.agentRunId,
    );
  }

  return parallelResult;
}

async function handleSuccessfulParallelContinuation(
  input: ContinueTaskInput,
  context: TaskContinuationContext,
  guard: PaidExecutionGuardState | null | undefined,
  parallelPlan: RuntimePlan,
  sessionId: unknown,
  agentRunId: unknown,
) {
  const resolvedSessionId = typeof sessionId === "string" ? sessionId : undefined;
  const resolvedAgentRunId = typeof agentRunId === "string" ? agentRunId : undefined;

  await recordPaidExecutionGuardStateEvent({
    projectId: context.task.projectId,
    taskId: input.taskId,
    sessionId: resolvedSessionId,
    agentRunId: resolvedAgentRunId,
    action: "continued",
    guardState: guard ?? undefined,
    detail: {
      effectiveModel: context.resolvedModel ? formatModelRoute(context.resolvedModel) : undefined,
      executionMode: "parallel",
      candidateCount: parallelPlan.candidates.length,
    },
    riskLevel: guard?.enabled ? "medium" : undefined,
  });

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.continued",
    ts: new Date().toISOString(),
    taskId: input.taskId,
    projectId: context.task.projectId,
    agentRunId: resolvedAgentRunId,
    data: {
      sessionId,
      agentRunId,
      executionMode: "parallel",
      candidateCount: parallelPlan.candidates.length,
    },
  });

  void broadcastPipelineStageContinuationEvents({
    taskId: input.taskId,
    sessionId: resolvedSessionId,
    projectId: context.task.projectId,
    agentRunId: resolvedAgentRunId,
    authorization: input.authorization,
  });
}

async function continueSingleTaskExecutionFlow(
  input: ContinueTaskInput,
  context: TaskContinuationContext,
  guard: PaidExecutionGuardState | null | undefined,
) {
  if (!context.sessionId) {
    return { status: 400 as const, body: { error: "No session associated with this task" } };
  }

  const agentRunId = ensureAgentRunForSession(
    context.sessionId,
    input.taskId,
    context.task.projectId,
    context.resolvedModel,
  );
  const result = await continueSession(context.sessionId, input.prompt, {
    model: context.resolvedModel,
  });
  if (!result.ok) {
    return { status: 502 as const, body: { error: result.error || "Failed to continue session" } };
  }

  await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    method: "PATCH",
    body: { status: "running" },
    authorization: input.authorization,
  });

  await recordPaidExecutionGuardStateEvent({
    projectId: context.task.projectId,
    taskId: input.taskId,
    sessionId: context.sessionId,
    agentRunId,
    action: "continued",
    guardState: guard ?? undefined,
    detail: {
      effectiveModel: context.resolvedModel ? formatModelRoute(context.resolvedModel) : undefined,
    },
    riskLevel: guard?.enabled ? "medium" : undefined,
  });

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.continued",
    ts: new Date().toISOString(),
    taskId: input.taskId,
    projectId: context.task.projectId,
    agentRunId,
    data: { sessionId: context.sessionId, agentRunId },
  });

  void broadcastPipelineStageContinuationEvents({
    taskId: input.taskId,
    sessionId: context.sessionId,
    projectId: context.task.projectId,
    agentRunId,
    authorization: input.authorization,
  });

  return { status: 200 as const, body: { ok: true, sessionId: context.sessionId, agentRunId } };
}

async function broadcastPipelineStageContinuationEvents(args: {
  taskId: string;
  sessionId: string | undefined;
  projectId: string;
  agentRunId: string | undefined;
  authorization: string;
}) {
  const events = await buildPipelineStageUpdatedEvents({
    taskId: args.taskId,
    sessionId: args.sessionId,
    projectId: args.projectId,
    agentRunId: args.agentRunId,
    authorization: args.authorization,
    reason: "task.continued",
  });
  for (const event of events) {
    wsBroadcaster.broadcast(event);
  }
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

function requireSystemAdmin(user: Pick<JWTPayload, "role"> | null | undefined): string | null {
  if (!user) {
    return "Requires org_admin role";
  }
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

  // Resolve template and build runtime plan (with optional user overrides)
  const template = resolveWorkflowTemplate(strategy, classification.category);
  const plan = buildRuntimePlan(template, strategy, classification.category, overrides);

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
    plan?: RuntimePlan;
    workflowTemplateId?: string | null;
    hookExecutions?: HookExecutionRecord[];
    paidExecutionGuard?: PaidExecutionGuardState;
  },
) {
  const plan = executionMeta.plan as ParallelRuntimePlanRecord | undefined;

  return {
    status: "running",
    sessionId: execResult.sessionId,
    agentRunId: execResult.agentRunId,
    category: classification.category,
    executionMode: plan?.mode ?? "single",
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

function prependWorkflowContextToPrompt(prompt: string, context: WorkflowPromptContextRecord) {
  const isQuickParallelExecution =
    context.taskCategory === "quick" && context.executionMode === "parallel";
  const lines = buildWorkflowPromptContextLines(context, isQuickParallelExecution);

  return `${lines.join("\n")}\n\n${prompt}`;
}

function buildWorkflowPromptContextLines(
  context: WorkflowPromptContextRecord,
  isQuickParallelExecution: boolean,
) {
  return [
    "## 当前执行上下文",
    `任务：${context.taskTitle}`,
    context.workflowStatus ? `流程状态：${context.workflowStatus}` : undefined,
    buildWorkflowPromptCurrentStageLine(context),
    buildWorkflowPromptExitCriteriaLine(context),
    context.activeRoleSummary ? `当前阶段角色：${context.activeRoleSummary}` : undefined,
    context.selectedAgent ? `执行 Agent：${context.selectedAgent}` : undefined,
    context.selectedModel ? `执行模型：${context.selectedModel}` : undefined,
    context.openChangeRequestSummary
      ? `待处理修正项：${context.openChangeRequestSummary}`
      : undefined,
    "已完成阶段及产出：",
    ...buildWorkflowPromptCompletedOutputs(context),
    buildWorkflowPromptPendingStagesLine(context),
    "",
    "请只完成当前阶段的目标。",
    ...buildWorkflowPromptCompletionInstructions(isQuickParallelExecution),
  ].filter(Boolean);
}

function buildWorkflowPromptCurrentStageLine(context: WorkflowPromptContextRecord) {
  if (!context.currentStageLabel && !context.currentStageKey) {
    return undefined;
  }

  return `当前阶段：${context.currentStageLabel || context.currentStageKey}${context.currentStageStatus ? `（${context.currentStageStatus}）` : ""}`;
}

function buildWorkflowPromptExitCriteriaLine(context: WorkflowPromptContextRecord) {
  return context.currentStageExitCriteria && context.currentStageExitCriteria.length > 0
    ? `阶段目标：${context.currentStageExitCriteria.join("；")}`
    : undefined;
}

function buildWorkflowPromptCompletedOutputs(context: WorkflowPromptContextRecord) {
  return context.completedStageOutputs && context.completedStageOutputs.length > 0
    ? context.completedStageOutputs.map((item) => `- ${item}`)
    : ["- 暂无已完成阶段产出"];
}

function buildWorkflowPromptPendingStagesLine(context: WorkflowPromptContextRecord) {
  return `待完成阶段：${context.pendingStageLabels && context.pendingStageLabels.length > 0 ? context.pendingStageLabels.join(" → ") : "无（当前可能已是最后阶段）"}`;
}

function buildWorkflowPromptCompletionInstructions(isQuickParallelExecution: boolean) {
  return isQuickParallelExecution
    ? []
    : [
        "完成后请输出本阶段产出摘要。",
        "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
      ];
}

function renderWorkflowContextBlock(context: WorkflowPromptContextRecord): string {
  return prependWorkflowContextToPrompt("", context).trim();
}

function parseExecutionTraceStrategy(strategyJson: string | null | undefined): {
  selectedAgent?: string;
  hookExecutions: HookExecutionRecord[];
  followupExecutions: Array<{
    templateId: string;
    triggerHookId: string;
    status: "completed" | "failed" | "skipped";
    agent: string;
    model?: string;
    prompt: string;
    result?: string;
    error?: string;
    sessionId?: string;
    tokenUsed?: number;
    completedAt: string;
  }>;
} {
  if (!strategyJson) {
    return { hookExecutions: [], followupExecutions: [] };
  }

  try {
    const strategy = JSON.parse(strategyJson) as {
      selectedAgent?: string;
      hookExecutions?: HookExecutionRecord[];
      followupExecutions?: Array<{
        templateId: string;
        triggerHookId: string;
        status: "completed" | "failed" | "skipped";
        agent: string;
        model?: string;
        prompt: string;
        result?: string;
        error?: string;
        sessionId?: string;
        tokenUsed?: number;
        completedAt: string;
      }>;
    };
    return {
      selectedAgent:
        typeof strategy?.selectedAgent === "string" ? strategy.selectedAgent : undefined,
      hookExecutions: Array.isArray(strategy?.hookExecutions) ? strategy.hookExecutions : [],
      followupExecutions: Array.isArray(strategy?.followupExecutions)
        ? strategy.followupExecutions
        : [],
    };
  } catch {
    return { hookExecutions: [], followupExecutions: [] };
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
  if (
    info &&
    typeof info === "object" &&
    typeof (info as Record<string, unknown>).role === "string"
  ) {
    return String((info as Record<string, unknown>).role);
  }

  return "unknown";
}

function extractExecutionTraceMessageId(message: unknown, fallback: string): string {
  if (!message || typeof message !== "object") {
    return fallback;
  }

  const info = (message as Record<string, unknown>).info;
  if (
    info &&
    typeof info === "object" &&
    typeof (info as Record<string, unknown>).id === "string"
  ) {
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

function extractSessionMessageCompletedAt(message: unknown): string | undefined {
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

  const completed = (time as Record<string, unknown>).completed;
  if (typeof completed === "number" && Number.isFinite(completed)) {
    return new Date(completed).toISOString();
  }
  if (typeof completed === "string") {
    const parsed = Date.parse(completed);
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

function isDisplayableTraceTimelineItem(item: TaskSessionTimelineItemRecord) {
  return typeof item.text === "string" && item.text.trim().length > 0;
}

function mapExecutionTraceMessagesToTimelineItems(
  messages: ExecutionTraceMessageRecord[],
  sourceEventPrefix: string,
) {
  return messages.filter(isDisplayableExecutionTraceMessage).map(
    (message) =>
      ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        completedAt: extractSessionMessageCompletedAt(message.raw),
        raw: message.raw,
        sourceEventTypes: [`${sourceEventPrefix}:message:${message.role}`],
      }) satisfies TaskSessionTimelineItemRecord,
  );
}

function mergeTaskSessionTimelineItem(
  current: TaskSessionTimelineItemRecord,
  candidate: TaskSessionTimelineItemRecord,
) {
  const currentText = typeof current.text === "string" ? current.text.trim() : "";
  const candidateText = typeof candidate.text === "string" ? candidate.text.trim() : "";

  return {
    id: candidate.id || current.id,
    role: candidate.role || current.role,
    text: candidateText || currentText,
    createdAt: current.createdAt ?? candidate.createdAt,
    completedAt: candidate.completedAt ?? current.completedAt,
    raw: candidate.raw ?? current.raw,
    sourceEventTypes: [
      ...new Set([...(current.sourceEventTypes ?? []), ...(candidate.sourceEventTypes ?? [])]),
    ],
  } satisfies TaskSessionTimelineItemRecord;
}

function resolveTraceTimelineItemSortTime(item: TaskSessionTimelineItemRecord) {
  return parseTraceSegmentTimestamp(item.completedAt ?? item.createdAt) ?? Number.MAX_SAFE_INTEGER;
}

function mergeTaskExecutionTraceTimelineItems(
  baseItems: TaskSessionTimelineItemRecord[],
  supplementalItems: TaskSessionTimelineItemRecord[],
) {
  const merged = new Map<string, { item: TaskSessionTimelineItemRecord; order: number }>();
  let order = 0;

  for (const item of [...baseItems, ...supplementalItems]) {
    if (!isDisplayableTraceTimelineItem(item)) {
      continue;
    }

    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, { item, order });
      order += 1;
      continue;
    }

    existing.item = mergeTaskSessionTimelineItem(existing.item, item);
  }

  return [...merged.values()]
    .sort((left, right) => {
      const leftTime = resolveTraceTimelineItemSortTime(left.item);
      const rightTime = resolveTraceTimelineItemSortTime(right.item);
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.order - right.order;
    })
    .map((entry) => entry.item);
}

function mapProjectionTimelineRole(item: TaskProjectionTimelineViewItemRecord) {
  const metadata = asRecord(item.metadataJson);
  const explicitRole =
    item.itemRole === "user" || item.itemRole === "assistant" || item.itemRole === "tool"
      ? item.itemRole
      : metadata?.role === "user" || metadata?.role === "assistant" || metadata?.role === "tool"
        ? (metadata.role as "user" | "assistant" | "tool")
        : null;

  if (item.itemKind === "message" && explicitRole) {
    return explicitRole;
  }
  if (item.itemKind === "user-input") {
    return "user";
  }
  if (item.itemKind === "assistant-output") {
    return "assistant";
  }
  if (item.itemKind === "tool-output" || item.itemKind === "tool-call") {
    return "tool";
  }

  return "system";
}

function mapProjectionGenericItemKindToSegmentType(
  item: TaskProjectionTimelineViewItemRecord,
  metadata: Record<string, unknown> | null,
): ExecutionTraceSegmentRecord["type"] | null {
  if (item.itemKind === "operation") {
    const sourceKind = asNonEmptyString(metadata?.sourceKind);
    const partType = asNonEmptyString(metadata?.partType);
    if (sourceKind === "tool-call" || partType === "tool_call") {
      return "tool-call";
    }
    if (sourceKind === "thinking") {
      return "thinking";
    }
    return null;
  }

  if (item.itemKind === "artifact") {
    const sourceKind = asNonEmptyString(metadata?.sourceKind);
    const artifactKind = asNonEmptyString(metadata?.artifactKind);
    if (sourceKind === "tool-output" || (artifactKind === "result" && asNonEmptyString(metadata?.toolName))) {
      return "tool-output";
    }
    if (sourceKind === "file-reference" || artifactKind === "file") {
      return "file-reference";
    }
    if (sourceKind === "diff" || artifactKind === "diff") {
      return "diff";
    }
    return null;
  }

  return null;
}

function mapProjectionItemToSegmentType(
  item: TaskProjectionTimelineViewItemRecord,
  metadata: Record<string, unknown> | null,
): ExecutionTraceSegmentRecord["type"] | null {
  const genericType = mapProjectionGenericItemKindToSegmentType(item, metadata);
  if (genericType) {
    return genericType;
  }

  switch (item.itemKind) {
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
      return item.itemKind;
    default:
      return null;
  }
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
): ExecutionTraceSegmentRecord | null {
  const metadata = asRecord(item.metadataJson);
  const type = mapProjectionItemToSegmentType(item, metadata);
  if (!type) {
    return null;
  }

  const toolName = asNonEmptyString(metadata?.toolName);
  const toolArgumentsSummary = asNonEmptyString(metadata?.argumentsSummary);
  const toolStatus = asNonEmptyString(metadata?.status);
  const filePath = asNonEmptyString(metadata?.filePath);
  const diffSummary = asNonEmptyString(metadata?.diffSummary);
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
  } satisfies ExecutionTraceSegmentRecord;
}

function resolveProjectionTimelineSegmentContent(
  item: TaskProjectionTimelineViewItemRecord,
  type: ExecutionTraceSegmentRecord["type"],
  metadata: Record<string, unknown> | null | undefined,
) {
  const toolName = asNonEmptyString(metadata?.toolName);
  const baseLabel = item.title || item.itemKind;
  const baseContent = item.displayText || item.title || "";

  if (type === "tool-call") {
    return {
      label: toolName ? `工具调用 ${toolName}` : baseLabel,
      content: asNonEmptyString(metadata?.argumentsSummary) || baseContent,
    };
  }

  if (type === "tool-output") {
    return {
      label: toolName ? `工具输出 ${toolName}` : baseLabel,
      content: asNonEmptyString(metadata?.outputSummary) || baseContent,
    };
  }

  if (type === "file-reference") {
    return {
      label: baseLabel,
      content:
        asNonEmptyString(metadata?.locationSummary) ||
        asNonEmptyString(metadata?.filePath) ||
        baseContent,
    };
  }

  if (type === "diff") {
    return {
      label: baseLabel,
      content: asNonEmptyString(metadata?.diffSummary) || baseContent,
    };
  }

  return { label: baseLabel, content: baseContent };
}

function resolveProjectionConversationText(item: TaskProjectionTimelineViewItemRecord) {
  const displayText = asNonEmptyString(item.displayText);
  if (displayText) {
    return displayText;
  }

  if (
    item.itemKind === "user-input" ||
    item.itemKind === "assistant-output" ||
    item.itemKind === "message"
  ) {
    return "";
  }

  return item.title || "";
}

function buildProjectionTimelineSegments(
  items: TaskProjectionTimelineViewItemRecord[],
): ExecutionTraceSegmentRecord[] {
  return items
    .map((item) => buildProjectionTimelineSegment(item))
    .filter((segment): segment is ExecutionTraceSegmentRecord => Boolean(segment?.content));
}

function mapProjectionTimelineItemsToTraceItems(
  items: TaskProjectionTimelineViewItemRecord[],
): TaskSessionTimelineItemRecord[] {
  return items.map((item) => ({
    id: item.messageId || item.runNodeId || item.id,
    role: mapProjectionTimelineRole(item),
    text: resolveProjectionConversationText(item),
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
}

function mapProjectionTimelineItemsToTraceMessages(
  items: TaskSessionTimelineItemRecord[],
): ExecutionTraceMessageRecord[] {
  return items
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      id: item.id,
      role: item.role,
      text: item.text,
      createdAt: item.createdAt,
      raw: item.raw ?? buildSyntheticExecutionTraceRawMessage(item),
    }))
    .filter(isDisplayableExecutionTraceMessage);
}

function isDisplayableExecutionTraceMessage(message: ExecutionTraceMessageRecord) {
  return (
    ["user", "assistant", "tool"].includes(message.role) &&
    typeof message.text === "string" &&
    message.text.trim().length > 0
  );
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
  const parentMessageIds = collectTimelineParentMessageIds(items);
  if (parentMessageIds.size === 0) {
    return items;
  }

  const { partsByParent, mergedItemIds } = collectTimelinePartsByParent(items, parentMessageIds);

  if (partsByParent.size === 0) {
    return items;
  }

  return items
    .filter((item) => !mergedItemIds.has(item.id))
    .map((item) => {
      if (!partsByParent.has(item.id)) {
        return item;
      }
      const existingParts =
        item.raw &&
        typeof item.raw === "object" &&
        Array.isArray((item.raw as { parts?: unknown[] }).parts)
          ? (((item.raw as { parts?: unknown[] }).parts ?? []) as Array<Record<string, unknown>>)
          : [];
      const nextParts = partsByParent.get(item.id) ?? [];
      const parts = dedupeTimelineConversationParts([...existingParts, ...nextParts]);
      const nextRaw = { ...(item.raw ?? {}), parts };
      return {
        ...item,
        text: item.text || extractSessionMessageText(nextRaw),
        raw: nextRaw,
      };
    });
}

function collectTimelineParentMessageIds(items: TaskSessionTimelineItemRecord[]) {
  const parentMessageIds = new Set<string>();
  for (const item of items) {
    if (item.role !== "unknown") {
      parentMessageIds.add(item.id);
    }
  }
  return parentMessageIds;
}

function collectTimelinePartsByParent(
  items: TaskSessionTimelineItemRecord[],
  parentMessageIds: Set<string>,
) {
  const partsByParent = new Map<string, Array<Record<string, unknown>>>();
  const mergedItemIds = new Set<string>();

  for (const item of items) {
    const timelinePart = resolveTimelineAnonymousPart(item, parentMessageIds);
    if (!timelinePart) {
      continue;
    }

    if (!partsByParent.has(timelinePart.parentMessageId)) {
      partsByParent.set(timelinePart.parentMessageId, []);
    }
    partsByParent.get(timelinePart.parentMessageId)?.push(timelinePart.part);
    mergedItemIds.add(item.id);
  }

  return { partsByParent, mergedItemIds };
}

function resolveTimelineAnonymousPart(
  item: TaskSessionTimelineItemRecord,
  parentMessageIds: Set<string>,
) {
  if (item.role !== "unknown" || !item.raw) {
    return null;
  }
  const raw = item.raw as Record<string, unknown>;
  const part = raw.part;
  if (!part || typeof part !== "object") {
    return null;
  }

  const parentMessageId = (part as Record<string, unknown>).messageID;
  if (typeof parentMessageId !== "string" || !parentMessageIds.has(parentMessageId)) {
    return null;
  }

  return {
    parentMessageId,
    part: part as Record<string, unknown>,
  };
}

function isVisibleTimelineConversationPart(part: Record<string, unknown>) {
  const type = typeof part.type === "string" ? part.type : "";
  return type === "tool" || type === "text";
}

function resolveTimelinePartKey(part: Record<string, unknown>, index: number) {
  if (typeof part.id === "string" && part.id.trim()) {
    return part.id;
  }

  if (typeof part.callID === "string" && part.callID.trim()) {
    return `${part.type ?? "part"}:${part.callID}`;
  }

  return `${part.type ?? "part"}:${index}`;
}

function dedupeTimelineConversationParts(parts: Array<Record<string, unknown>>) {
  const order: string[] = [];
  const latestByKey = new Map<string, Record<string, unknown>>();

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) {
      continue;
    }
    const key = resolveTimelinePartKey(part, index);
    if (!latestByKey.has(key)) {
      order.push(key);
    }
    latestByKey.set(key, part);
  }

  return order
    .map((key) => latestByKey.get(key))
    .filter((part): part is Record<string, unknown> => Boolean(part))
    .filter((part) => isVisibleTimelineConversationPart(part));
}

function mapTimelineItemsToExecutionTraceMessages(
  items: TaskSessionTimelineItemRecord[],
): ExecutionTraceMessageRecord[] {
  return items
    .map((item, index) => ({
      id: item.id || `${index}`,
      role: item.role || "unknown",
      text: item.text || extractSessionMessageText(item.raw) || "",
      createdAt: item.createdAt,
      raw: item.raw ?? buildSyntheticExecutionTraceRawMessage(item),
    }))
    .filter(isDisplayableExecutionTraceMessage);
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
    meta: {
      ...normalizeTaskSessionTimelineMeta(timelineResult.data.meta),
    },
    complete: timelineResult.data.meta?.cacheState === "complete",
    messageLimit: timelineResult.data.meta?.itemCount ?? reassembled.length,
  };
}

function deriveExecutionTraceCacheState(totalSessionCount: number, cachedSessionCount: number) {
  if (cachedSessionCount <= 0 || totalSessionCount <= 0) {
    return "none" as const;
  }
  if (cachedSessionCount >= totalSessionCount) {
    return "complete" as const;
  }
  return "partial" as const;
}

function buildTaskSessionLineagePath(records: TaskSessionRecord[], runtimeSessionId: string) {
  const byRuntimeSessionId = new Map(
    records.map((record) => [record.runtimeSessionId, record] as const),
  );
  const path: TaskSessionRecord[] = [];
  const visited = new Set<string>();
  let current = byRuntimeSessionId.get(runtimeSessionId);

  while (current && !visited.has(current.runtimeSessionId)) {
    path.unshift(current);
    visited.add(current.runtimeSessionId);
    current = current.parentRuntimeSessionId
      ? byRuntimeSessionId.get(current.parentRuntimeSessionId)
      : undefined;
  }

  return path;
}

function sliceRuntimeMessagesForLineageBoundary(
  messages: unknown[],
  childRecord: TaskSessionRecord | undefined,
) {
  if (!childRecord?.forkedFromMessageId) {
    return messages;
  }

  const boundaryIndex = messages.findIndex(
    (message) => extractSessionMessageId(message) === childRecord.forkedFromMessageId,
  );
  if (boundaryIndex < 0) {
    return messages;
  }

  return messages.slice(0, boundaryIndex + 1);
}

function dedupeRuntimeTraceMessages(messages: ExecutionTraceMessageRecord[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) {
      return false;
    }
    seen.add(message.id);
    return true;
  });
}

async function loadExecutionTraceMessagesFromRuntime(args: {
  task: ExecutableTask;
  sessionId: string;
  authorization: string;
  includeLineage: boolean;
}) {
  let lineageRecords: TaskSessionRecord[] = [];
  if (args.includeLineage) {
    const lineageResult = await fetchTaskSessionLineageRecords(args.task.id, args.authorization);
    lineageRecords = lineageResult.activeRecords;

    if (!lineageRecords.some((record) => record.runtimeSessionId === args.sessionId)) {
      const runtimeMap = await fetchRuntimeSessionMap(100);
      lineageRecords = synthesizeLineageRecordsFromRuntime(
        args.task.id,
        args.task.sessionId ?? args.sessionId,
        runtimeMap,
      );
    }
  }

  const normalizedLineage =
    lineageRecords.length > 0 ? normalizeLineageRecords(lineageRecords).records : [];
  const lineagePath = args.includeLineage
    ? buildTaskSessionLineagePath(normalizedLineage, args.sessionId)
    : [];
  const runtimeSessionIds =
    lineagePath.length > 0
      ? lineagePath.map((record) => record.runtimeSessionId)
      : [args.sessionId];

  const messageSets = await Promise.all(
    runtimeSessionIds.map(async (runtimeSessionId) => {
      const result = await getSessionMessages(runtimeSessionId);
      return {
        runtimeSessionId,
        data: result.ok && Array.isArray(result.data) ? result.data : [],
      };
    }),
  );

  const cachedSessionCount = messageSets.filter(({ data }) => data.length > 0).length;
  if (cachedSessionCount === 0) {
    return null;
  }

  const mergedRawMessages = messageSets.flatMap(({ data }, index) =>
    sliceRuntimeMessagesForLineageBoundary(data, lineagePath[index + 1]),
  );
  const messages = dedupeRuntimeTraceMessages(
    mergedRawMessages.map((message, index) => ({
      id: extractExecutionTraceMessageId(message, `runtime-${index}`),
      role: extractSessionMessageRole(message),
      text: extractSessionMessageText(message),
      createdAt: extractSessionMessageCreatedAt(message),
      raw: message,
    })),
  );
  const cacheState = deriveExecutionTraceCacheState(runtimeSessionIds.length, cachedSessionCount);
  const timeline = mapExecutionTraceMessagesToTimelineItems(messages, "runtime");

  return {
    messages,
    timeline,
    meta: {
      readSource: "opencode-runtime" as const,
      cacheState,
      complete: cacheState === "complete" && messages.length > 0,
      includeLineage: args.includeLineage,
      lineagePath: runtimeSessionIds,
      cachedSessionCount,
      itemCount: timeline.length,
    },
    messageLimit: messages.length,
  };
}

function shouldLoadTaskExecutionTraceRuntimeFallback(
  messages: ExecutionTraceMessageRecord[],
  timelineMeta: TaskSessionTimelineMetaRecord | undefined,
) {
  const hasServiceTimelineCache = typeof timelineMeta?.cacheState === "string";
  const hasCachedButUndisplayableTimelineItems =
    hasServiceTimelineCache &&
    typeof timelineMeta?.itemCount === "number" &&
    timelineMeta.itemCount > 0;

  return (
    messages.length === 0 &&
    (!timelineMeta || timelineMeta.cacheState === "none" || hasCachedButUndisplayableTimelineItems)
  );
}

async function loadExecutionTraceMessagesFromProjection(
  taskId: string,
  sessionId: string,
  authorization: string,
  options?: { includeLineage?: boolean },
) {
  const projectionResult = await fetchTaskProjectionTimelineView(taskId, authorization, {
    sessionId,
    includeLineage: options?.includeLineage,
  });

  if (!projectionResult.ok || !Array.isArray(projectionResult.data?.data)) {
    return null;
  }

  const items = mapProjectionTimelineItemsToTraceItems(projectionResult.data.data);
  return {
    rawItems: projectionResult.data.data,
    items,
    messages: mapProjectionTimelineItemsToTraceMessages(items),
    meta: createProjectionTraceTimelineMeta({
      meta: projectionResult.data.meta,
      itemCount: items.length,
    }),
    complete: projectionResult.data.meta?.complete === true && items.length > 0,
    messageLimit: projectionResult.data.meta?.itemCount ?? items.length,
  };
}

async function loadTaskProjectionSnapshot(taskId: string, authorization: string) {
  const snapshotResult = await fetchTaskProjectionSnapshot(taskId, authorization);
  if (!snapshotResult.ok) {
    return null;
  }

  return snapshotResult.data?.data ?? null;
}

function mergeTaskWithProjectionSnapshot<T extends Record<string, unknown>>(
  task: T,
  snapshot?: TaskProjectionSnapshotRecord | null,
) {
  if (!snapshot) {
    return task;
  }

  return {
    ...task,
    status: snapshot.currentStatus || task.status,
    orchestrationKind: snapshot.orchestrationKind ?? task.orchestrationKind,
    currentRunId: snapshot.currentRunId ?? task.currentRunId,
    sessionId: snapshot.currentSessionId || task.sessionId,
    result: snapshot.latestResult ?? task.result,
    latestResultSummary: snapshot.latestResultSummary ?? task.latestResultSummary,
    latestErrorText: snapshot.latestErrorText ?? task.latestErrorText,
    activeCandidateCount: snapshot.activeCandidateCount,
    completedCandidateCount: snapshot.completedCandidateCount,
    failedCandidateCount: snapshot.failedCandidateCount,
    totalChainSteps: snapshot.totalChainSteps,
    completedChainSteps: snapshot.completedChainSteps,
    winnerNodeId: snapshot.winnerNodeId ?? task.winnerNodeId,
    lastActivityAt: snapshot.lastActivityAt ?? task.lastActivityAt,
    finishedAt:
      snapshot.currentStatus === "completed" || snapshot.currentStatus === "failed"
        ? snapshot.lastActivityAt || task.finishedAt
        : task.finishedAt,
    snapshot,
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
  const timedSegments: Array<{
    segment: ExecutionTraceSegmentRecord;
    sortTime: number;
    sequence: number;
  }> = [];
  let userIndex = 0;
  let assistantIndex = 0;
  let sequence = 0;

  for (const message of messages) {
    if (!message.text) {
      continue;
    }

    if (message.role === "user") {
      const nextSegments = buildUserExecutionTraceSegments(message, userIndex + 1, sequence);
      userIndex += 1;
      timedSegments.push(...nextSegments.segments);
      sequence = nextSegments.nextSequence;
      continue;
    }

    if (message.role === "assistant") {
      assistantIndex += 1;
      timedSegments.push(buildAssistantExecutionTraceSegment(message, assistantIndex, sequence));
      sequence += 1;
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

function buildTimedExecutionTraceSegment(
  segment: ExecutionTraceSegmentRecord,
  createdAt: string | undefined,
  sequence: number,
) {
  return {
    segment,
    sortTime: parseTraceSegmentTimestamp(createdAt) ?? Number.MAX_SAFE_INTEGER,
    sequence,
  };
}

function buildUserExecutionTraceSegments(
  message: ExecutionTraceMessageRecord,
  userIndex: number,
  sequence: number,
) {
  const actualInput = stripWorkflowExecutionContextPrefix(message.text);
  const segments = [
    buildTimedExecutionTraceSegment(
      {
        type: "user-input",
        label: userIndex > 1 ? `用户输入 ${userIndex}` : "用户输入",
        content: actualInput,
        timestamp: message.createdAt,
      },
      message.createdAt,
      sequence,
    ),
  ];

  let nextSequence = sequence + 1;
  if (actualInput !== message.text) {
    segments.push(
      buildTimedExecutionTraceSegment(
        {
          type: "final-prompt",
          label: userIndex > 1 ? `最终 Prompt ${userIndex}` : "最终 Prompt",
          content: message.text,
          timestamp: message.createdAt,
        },
        message.createdAt,
        nextSequence,
      ),
    );
    nextSequence += 1;
  }

  return { segments, nextSequence };
}

function buildAssistantExecutionTraceSegment(
  message: ExecutionTraceMessageRecord,
  assistantIndex: number,
  sequence: number,
) {
  return buildTimedExecutionTraceSegment(
    {
      type: "model-response",
      label: assistantIndex > 1 ? `模型回复 ${assistantIndex}` : "模型回复",
      content: message.text,
      timestamp: message.createdAt,
    },
    message.createdAt,
    sequence,
  );
}

async function buildTaskExecutionTrace(
  taskId: string,
  authorization: string,
  requestedSessionId?: string,
  includeLineage = true,
): Promise<
  | { ok: true; status: 200; data: TaskExecutionTraceRecord }
  | { ok: false; status: number; data: unknown }
> {
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
  const snapshot = await loadTaskProjectionSnapshot(task.id, authorization);
  const parsedStrategy = parseExecutionTraceStrategy(task.strategy);
  const workflowContext = await buildTaskExecutionTraceWorkflowContext(
    task,
    parsedStrategy,
    authorization,
  );
  const sessionId = requestedSessionId || task.sessionId || snapshot?.currentSessionId || null;
  const traceMessages = await loadTaskExecutionTraceMessages({
    task,
    snapshot,
    sessionId,
    authorization,
    includeLineage,
  });
  const segments = buildTaskExecutionTraceSegments({
    task,
    workflowContext,
    parsedStrategy,
    messages: traceMessages.messages,
    projectionSegments: traceMessages.projectionSegments,
  });
  const finalPrompt = resolveTaskExecutionTraceFinalPrompt(traceMessages.messages);
  const latestResponse =
    resolveTaskExecutionTraceLatestResponse(traceMessages.messages) ??
    (shouldUseTaskSnapshotLatestResultForTrace({
      requestedSessionId,
      task,
      snapshot,
    })
      ? snapshot?.latestResult
      : null) ??
    null;

  return {
    ok: true,
    status: 200,
    data: {
      taskId: task.id,
      sessionId,
      workflowContext,
      finalPrompt,
      latestResponse,
      truncated: traceMessages.truncated,
      messageLimit: traceMessages.messageLimit,
      segments,
      messages: traceMessages.messages,
      timeline: traceMessages.timeline,
      timelineMeta: traceMessages.timelineMeta,
      snapshot,
      hookExecutions: parsedStrategy.hookExecutions.map(mapTaskExecutionTraceHookExecution),
      followupExecutions: parsedStrategy.followupExecutions.map(mapTaskExecutionTraceFollowup),
    },
  };
}

function shouldUseTaskSnapshotLatestResultForTrace(args: {
  requestedSessionId?: string;
  task: ExecutableTask;
  snapshot: Awaited<ReturnType<typeof loadTaskProjectionSnapshot>>;
}) {
  if (!args.requestedSessionId) {
    return true;
  }

  const requestedSessionId = args.requestedSessionId.trim();
  if (!requestedSessionId) {
    return true;
  }

  return false;
}

async function buildTaskExecutionTraceWorkflowContext(
  task: ExecutableTask,
  parsedStrategy: ReturnType<typeof parseExecutionTraceStrategy>,
  authorization: string,
) {
  const workflowContextRecord = await buildWorkflowPromptContext(task, authorization, {
    selectedAgent: parsedStrategy.selectedAgent,
    selectedModel: task.selectedModel || undefined,
    taskResult: "",
    changesSummary: "",
  });
  return renderWorkflowContextBlock(workflowContextRecord);
}

type TaskExecutionTraceMessageLoadResult = {
  messages: ExecutionTraceMessageRecord[];
  timeline: TaskSessionTimelineItemRecord[];
  truncated: boolean;
  messageLimit: number;
  timelineMeta: TaskSessionTimelineMetaRecord | undefined;
  projectionSegments: ExecutionTraceSegmentRecord[];
};

async function loadTaskExecutionTraceMessages(args: {
  task: ExecutableTask;
  snapshot: Awaited<ReturnType<typeof loadTaskProjectionSnapshot>>;
  sessionId: string | null;
  authorization: string;
  includeLineage: boolean;
}): Promise<TaskExecutionTraceMessageLoadResult> {
  const messages: ExecutionTraceMessageRecord[] = [];
  let timeline: TaskSessionTimelineItemRecord[] = [];
  let truncated = false;
  let messageLimit = 200;
  let timelineMeta: TaskSessionTimelineMetaRecord | undefined;
  let projectionSegments: ExecutionTraceSegmentRecord[] = [];

  if (args.sessionId) {
    const projectionTimeline = await loadExecutionTraceMessagesFromProjection(
      args.task.id,
      args.sessionId,
      args.authorization,
      { includeLineage: args.includeLineage },
    );

    if (projectionTimeline) {
      timeline = projectionTimeline.items;
      timelineMeta = projectionTimeline.meta;
      messages.push(...projectionTimeline.messages);
      messageLimit = projectionTimeline.messageLimit;
      projectionSegments = buildProjectionTimelineSegments(projectionTimeline.rawItems);
    }

    if (
      shouldLoadTaskExecutionTraceTimelineFallback(
        projectionTimeline,
        messages,
        timeline,
        args.snapshot,
      )
    ) {
      const timelineFallback = await loadTaskExecutionTraceTimelineFallback({
        task: args.task,
        sessionId: args.sessionId,
        authorization: args.authorization,
        includeLineage: args.includeLineage,
        timelineMeta,
      });
      timeline = timelineFallback.timeline;
      timelineMeta = timelineFallback.timelineMeta;
      truncated = timelineFallback.truncated;
      messageLimit = timelineFallback.messageLimit;
      messages.splice(0, messages.length, ...timelineFallback.messages);
    }

    if (shouldLoadTaskExecutionTraceRuntimeFallback(messages, timelineMeta)) {
      const runtimeFallback = await loadExecutionTraceMessagesFromRuntime({
        task: args.task,
        sessionId: args.sessionId,
        authorization: args.authorization,
        includeLineage: args.includeLineage,
      });
      if (runtimeFallback) {
        timeline = mergeTaskExecutionTraceTimelineItems(timeline, runtimeFallback.timeline);
        timelineMeta = {
          ...runtimeFallback.meta,
          itemCount: timeline.length,
          complete: runtimeFallback.meta.complete && timeline.length > 0,
        };
        messageLimit = runtimeFallback.messageLimit;
        messages.splice(0, messages.length, ...runtimeFallback.messages);
      }
    }
  }

  return {
    messages,
    timeline,
    truncated,
    messageLimit,
    timelineMeta,
    projectionSegments,
  };
}

function shouldLoadTaskExecutionTraceTimelineFallback(
  projectionTimeline: Awaited<ReturnType<typeof loadExecutionTraceMessagesFromProjection>>,
  messages: ExecutionTraceMessageRecord[],
  timeline: TaskSessionTimelineItemRecord[],
  snapshot: Awaited<ReturnType<typeof loadTaskProjectionSnapshot>>,
) {
  void projectionTimeline;
  void timeline;
  void snapshot;

  // Main chat requires actual conversation items. Older projections can contain
  // only status/judge/tool timeline rows or snapshot latestResult without any
  // user/assistant messages; in that case we must fall back to branch timeline.
  return messages.length === 0;
}

async function loadTaskExecutionTraceTimelineFallback(args: {
  task: ExecutableTask;
  sessionId: string;
  authorization: string;
  includeLineage: boolean;
  timelineMeta: TaskSessionTimelineMetaRecord | undefined;
}) {
  let messages: ExecutionTraceMessageRecord[] = [];
  let timeline: TaskSessionTimelineItemRecord[] = [];
  const truncated = false;
  let messageLimit = 200;
  let timelineMeta: TaskSessionTimelineMetaRecord | undefined = args.timelineMeta;

  const timelineMessages = await loadExecutionTraceMessagesFromTimeline(
    args.task.id,
    args.sessionId,
    args.authorization,
    { includeLineage: args.includeLineage },
  );

  if (timelineMessages) {
    timeline = timelineMessages.items;
    timelineMeta = timelineMessages.meta;
    messages = timelineMessages.messages;
    messageLimit = timelineMessages.messageLimit;
  }

  return { messages, timeline, truncated, messageLimit, timelineMeta };
}

function buildTaskExecutionTraceSegments(args: {
  task: ExecutableTask;
  workflowContext: string;
  parsedStrategy: ReturnType<typeof parseExecutionTraceStrategy>;
  messages: ExecutionTraceMessageRecord[];
  projectionSegments: ExecutionTraceSegmentRecord[];
}) {
  const segments: ExecutionTraceSegmentRecord[] = [];
  if (args.workflowContext) {
    segments.push({
      type: "workflow-context",
      label: "工作流注入上下文",
      content: args.workflowContext,
    });
  }

  segments.push(...buildTaskExecutionTraceTimedHookSegments(args.parsedStrategy.hookExecutions));

  if (args.messages.length > 0) {
    segments.push(...buildExecutionTraceConversationSegments(args.messages));
  }

  if (args.projectionSegments.length > 0) {
    segments.push(...args.projectionSegments);
  }

  return segments;
}

function buildTaskExecutionTraceTimedHookSegments(
  hookExecutions: ReturnType<typeof parseExecutionTraceStrategy>["hookExecutions"],
) {
  const timedSegments: Array<{
    segment: ExecutionTraceSegmentRecord;
    sortTime: number;
    sequence: number;
  }> = [];
  let timedSequence = 0;

  for (const hook of hookExecutions) {
    const hookTime = parseTraceSegmentTimestamp(hook.completedAt) ?? Number.MAX_SAFE_INTEGER;
    timedSegments.push(...buildTaskExecutionTraceHookTimedSegments(hook, hookTime, timedSequence));
    timedSequence += countTaskExecutionTraceHookSegments(hook);
  }

  timedSegments.sort((left, right) => {
    if (left.sortTime !== right.sortTime) {
      return left.sortTime - right.sortTime;
    }
    return left.sequence - right.sequence;
  });

  return timedSegments.map((item) => item.segment);
}

function buildTaskExecutionTraceHookTimedSegments(
  hook: ReturnType<typeof parseExecutionTraceStrategy>["hookExecutions"][number],
  hookTime: number,
  startSequence: number,
) {
  const timedSegments: Array<{
    segment: ExecutionTraceSegmentRecord;
    sortTime: number;
    sequence: number;
  }> = [];
  let sequence = startSequence;

  if (hook.prompt) {
    timedSegments.push(
      buildTimedTaskExecutionTraceHookSegment(
        {
          type: "hook-injection",
          label: `Hook 输入: ${hook.hookId}`,
          content: hook.prompt,
          hookId: hook.hookId,
          hookTrigger: hook.trigger,
          hookAgent: hook.agent,
          hookDecisionAction: hook.decision?.action,
          timestamp: hook.completedAt,
        },
        hookTime,
        sequence++,
      ),
    );
  }

  if (hook.result) {
    timedSegments.push(
      buildTimedTaskExecutionTraceHookSegment(
        {
          type: "hook-result",
          label: `Hook 输出: ${hook.hookId}`,
          content: hook.result,
          hookId: hook.hookId,
          hookTrigger: hook.trigger,
          hookAgent: hook.agent,
          hookDecisionAction: hook.decision?.action,
          timestamp: hook.completedAt,
        },
        hookTime,
        sequence++,
      ),
    );
  }

  if (hook.decision?.action === "rewrite-prompt" && hook.decision.rewrittenPrompt) {
    timedSegments.push(
      buildTimedTaskExecutionTraceHookSegment(
        {
          type: "hook-rewrite",
          label: `Hook 重写 Prompt: ${hook.hookId}`,
          content: hook.decision.rewrittenPrompt,
          hookId: hook.hookId,
          hookTrigger: hook.trigger,
          hookAgent: hook.agent,
          hookDecisionAction: hook.decision.action,
          timestamp: hook.completedAt,
        },
        hookTime,
        sequence,
      ),
    );
  }

  return timedSegments;
}

function buildTimedTaskExecutionTraceHookSegment(
  segment: ExecutionTraceSegmentRecord,
  sortTime: number,
  sequence: number,
) {
  return {
    segment,
    sortTime,
    sequence,
  };
}

function countTaskExecutionTraceHookSegments(
  hook: ReturnType<typeof parseExecutionTraceStrategy>["hookExecutions"][number],
) {
  return (
    Number(Boolean(hook.prompt)) +
    Number(Boolean(hook.result)) +
    Number(Boolean(hook.decision?.action === "rewrite-prompt" && hook.decision.rewrittenPrompt))
  );
}

function resolveTaskExecutionTraceFinalPrompt(messages: ExecutionTraceMessageRecord[]) {
  const userMessages = messages.filter((item) => item.role === "user" && item.text);
  return userMessages.length > 0 ? (userMessages[userMessages.length - 1]?.text ?? null) : null;
}

function resolveTaskExecutionTraceLatestResponse(messages: ExecutionTraceMessageRecord[]) {
  const assistantMessages = messages.filter((item) => item.role === "assistant" && item.text);
  return assistantMessages.length > 0
    ? (assistantMessages[assistantMessages.length - 1]?.text ?? null)
    : null;
}

function mapTaskExecutionTraceHookExecution(
  hook: ReturnType<typeof parseExecutionTraceStrategy>["hookExecutions"][number],
) {
  return {
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
  };
}

function mapTaskExecutionTraceFollowup(
  followup: ReturnType<typeof parseExecutionTraceStrategy>["followupExecutions"][number],
) {
  return {
    templateId: followup.templateId,
    triggerHookId: followup.triggerHookId,
    status: followup.status,
    agent: followup.agent,
    model: followup.model,
    prompt: followup.prompt,
    result: followup.result,
    error: followup.error,
    completedAt: followup.completedAt,
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

  const hookResult = await executeLifecycleHooks({
    strategy,
    trigger: "pre-execution",
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    titlePrefix: "Preflight",
    repoContext,
    context: {
      taskCategory: classification.category,
      executionMode,
      selectedAgent: executionAgent,
      selectedModel: effectiveModel,
      repoName: task.repoName ?? undefined,
      remoteUrl: task.remoteUrl ?? undefined,
      workingBranch: task.workingBranch ?? undefined,
    },
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
      prompt: task.prompt,
      hookExecutions: [] as HookExecutionRecord[],
    };
  }

  // Check for deny decision — any hook that returned deny blocks the execution
  const denyExecution = hookResult.hookExecutions.find((exec) => exec.decision?.action === "deny");
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
      prompt: task.prompt,
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
      prompt: hookResult.rewrittenPrompt,
      hookExecutions: hookResult.hookExecutions,
      breakerReason,
      switchedModel,
    };
  }

  if (!hookResult.combinedResultText?.trim()) {
    return {
      prompt: task.prompt,
      hookExecutions: hookResult.hookExecutions,
      breakerReason,
      switchedModel,
    };
  }

  const promptWithReview = [
    "Pre-execution assessment from the configured review agent:",
    hookResult.combinedResultText,
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

async function registerPrimaryTaskSession(
  task: Pick<ExecutableTask, "id">,
  sessionId: string | undefined,
  branchName: string,
  authorization: string,
  options?: { parentSessionId?: string; operationId?: string },
) {
  if (!sessionId) {
    return;
  }

  if (options?.parentSessionId) {
    await ensureParentLineageRecord(
      task.id,
      options.parentSessionId,
      authorization,
      branchName,
    ).catch(() => null);
  }

  await upsertTaskSessionLineageRecord(task.id, authorization, {
    runtimeSessionId: sessionId,
    parentRuntimeSessionId:
      options?.parentSessionId && options.parentSessionId !== sessionId
        ? options.parentSessionId
        : undefined,
    branchName,
    sourceType: options?.parentSessionId && options.parentSessionId !== sessionId ? "fork" : "root",
    isActive: true,
    operationId: options?.operationId,
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
    operationId: crypto.randomUUID(),
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

function isParallelExecution(plan: RuntimePlan) {
  return plan.mode === "parallel" && plan.candidates.length > 1;
}

function isSequentialChainExecution(plan: RuntimePlan) {
  return plan.mode === "sequential-chain" && plan.steps.some((s) => s.type === "chain-step");
}

type ExecuteTaskPreparationResult =
  | {
      ok: true;
      context: ExecutionContext;
    }
  | {
      ok: false;
      response: {
        status: StartExecutionResponse["status"] | 400 | 401 | 404 | 503;
        body: Record<string, unknown>;
      };
    };

type ExecuteOverridesRequest = {
  req: {
    json(): Promise<unknown>;
  };
};

async function parseExecuteOverridesFromRequest(c: ExecuteOverridesRequest) {
  try {
    const rawBody = await c.req.json().catch(() => undefined);
    if (!rawBody) {
      return undefined;
    }

    const parsed = executeBodySchema.safeParse(rawBody);
    return parsed.success && parsed.data ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function prepareTaskExecutionStart(
  taskId: string,
  authorization: string,
  overrides?: ExecuteOverrides,
): Promise<ExecuteTaskPreparationResult> {
  const taskResult = await fetchExecutableTask(taskId, authorization);
  if (!taskResult.ok) {
    return {
      ok: false,
      response: {
        status: 404,
        body: { error: "Task not found" },
      },
    };
  }

  const task = taskResult.data;
  const validationError = validateExecutableTask(task);
  if (validationError) {
    return {
      ok: false,
      response: {
        status: 400,
        body: { error: validationError },
      },
    };
  }

  const preparedContext = await prepareExecutionContext(task, authorization, overrides);
  const modelValidationError = await validateResolvedModel(preparedContext.resolvedModel);
  if (modelValidationError) {
    return {
      ok: false,
      response: modelValidationError,
    };
  }

  const guardPreparation = await preparePaidExecutionContext(preparedContext, authorization);
  if (!guardPreparation.ok) {
    return {
      ok: false,
      response: {
        status: guardPreparation.status as 401 | 403 | 404 | 502,
        body: guardPreparation.data,
      },
    };
  }

  const preflight = guardPreparation.preflight;
  if (!preflight.allowed) {
    await recordPaidExecutionAuditEvent({
      projectId: preparedContext.task.projectId,
      taskId,
      action: "blocked",
      preflight,
      guardState: guardPreparation.context.paidExecutionGuard,
      riskLevel: preflight.estimate.guardDecision === "allow-with-downgrade" ? "medium" : "high",
    });

    return {
      ok: false,
      response: buildBlockedExecutionResponse(taskId, preflight),
    };
  }

  if (!(await persistPaidExecutionConfiguration(guardPreparation.context))) {
    return {
      ok: false,
      response: {
        status: 502,
        body: { error: "Failed to persist paid execution guard configuration" },
      },
    };
  }

  const executionContextResult = await finalizePreExecutionContext(guardPreparation.context);
  if (!executionContextResult.ok) {
    return {
      ok: false,
      response: {
        status: 409,
        body: {
          error: executionContextResult.reason,
          code: "PAID_EXECUTION_BREAKER_TRIPPED",
          taskId,
          allowed: false,
        },
      },
    };
  }

  return {
    ok: true,
    context: executionContextResult.context,
  };
}

async function startTaskExecutionByPlan(
  executionContext: ExecutionContext,
): Promise<StartExecutionResponse> {
  if (isSequentialChainExecution(executionContext.plan)) {
    return startSequentialChainExecution(executionContext);
  }

  if (isParallelExecution(executionContext.plan)) {
    return startParallelExecution(executionContext);
  }

  return startSingleExecution(executionContext);
}

function getSequentialChainExecutionState(context: ExecutionContext) {
  const stepIndex = context.plan.currentChainStepIndex ?? 0;
  const chainSteps = context.plan.steps.filter((s) => s.type === "chain-step");
  const currentStep = chainSteps[stepIndex];

  return {
    stepIndex,
    chainSteps,
    currentStep,
  };
}

async function startSequentialChainSession(
  context: ExecutionContext,
  currentStep: ExecutionStep,
  stepIndex: number,
  chainSteps: RuntimePlan["steps"],
) {
  const stepPrompt = buildChainStepPrompt(
    context.prompt,
    currentStep,
    stepIndex,
    context.plan.steps,
  );
  const resolvedModel = currentStep.model
    ? parseModelString(currentStep.model)
    : context.resolvedModel;

  currentStep.status = "running";

  const execResult = await createSession(context.task.id, context.task.projectId, stepPrompt, {
    agent: context.executionAgent,
    repoContext: context.repoContext,
    model: resolvedModel,
  });

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

  return {
    execResult,
    resolvedModel,
    totalSteps: chainSteps.length,
  };
}

async function finalizeSuccessfulSequentialChainStart(args: {
  context: ExecutionContext;
  currentStep: ExecutionStep;
  execResult: SessionStartResult;
  stepIndex: number;
  totalSteps: number;
}) {
  const { context, currentStep, execResult, stepIndex, totalSteps } = args;

  context.plan.candidates[0] = {
    ...context.plan.candidates[0],
    agent: context.plan.candidates[0]?.agent || "executor",
    sessionId: execResult.sessionId,
    agentRunId: execResult.agentRunId,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  await persistExecutionStart(context, execResult);

  if (!execResult.sessionId) {
    throw new Error("Sequential-chain execution requires a sessionId");
  }

  sseAggregator.registerSequentialChainTask(
    context.task.id,
    execResult.sessionId,
    context.plan,
    context.authorization,
    {
      projectionBacked:
        isProjectionBackedTask(context.task) &&
        (context.task.orchestrationKind === "sequential-chain" ||
          context.task.executionMode === "sequential-chain"),
      operationId: context.operationId,
    },
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
      totalSteps,
    },
  });

  await registerPrimaryTaskSession(
    context.task,
    execResult.sessionId,
    `${context.task.title} — ${currentStep.title}`,
    context.authorization,
    { parentSessionId: context.parentSessionId, operationId: context.operationId },
  );

  if (execResult.sessionId) {
    const stepPromptText = buildChainStepPrompt(
      context.prompt,
      currentStep,
      stepIndex,
      context.plan.steps,
    );
    const model = args.context.resolvedModel
      ? `${args.context.resolvedModel.providerId}:${args.context.resolvedModel.modelId}`
      : undefined;
    const systemContextText = buildExecutionContext({
      taskId: context.task.id,
      projectId: context.task.projectId,
      repoContext: context.repoContext,
    });
    const userInputText = stepPromptText;
    const finalSentText = `${systemContextText}${userInputText}`;
    persistTaskSessionMessageSnapshot(context.task.id, context.authorization, {
      runtimeSessionId: execResult.sessionId,
      message: {
        info: {
          id: `${execResult.sessionId}:user-prompt`,
          role: "user",
          agent: context.executionAgent,
          model,
          time: { created: new Date().toISOString(), completed: new Date().toISOString() },
        },
        parts: [{ type: "text", text: finalSentText }],
        promptDecomposition: { userInputText, systemContextText, finalSentText },
      },
    }).catch(() => null);
  }

  return {
    status: 200 as const,
    body: {
      taskId: context.task.id,
      sessionId: execResult.sessionId,
      agentRunId: execResult.agentRunId,
      status: "running",
      executionMode: "sequential-chain",
      chainStepIndex: stepIndex,
      totalSteps,
    },
  };
}

interface CandidateAdoptionContext {
  task: ExecutableTask & { result?: string };
  parallelRunId: string;
  runDetail: TaskDomainRunDetailRecord;
  candidate: TaskDomainRunNodeRecord;
}

async function fetchCandidateAdoptionContext(
  taskId: string,
  candidateIndex: number,
  authorization: string,
): Promise<
  | { ok: true; context: CandidateAdoptionContext }
  | {
      ok: false;
      response: {
        status: 400 | 404;
        body: Record<string, unknown>;
      };
    }
> {
  const taskResult = await cpFetch<ExecutableTask & { result?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );
  if (!taskResult.ok) {
    return {
      ok: false,
      response: {
        status: 404,
        body: { error: "Task not found" },
      },
    };
  }

  const task = taskResult.data;
  if (task.orchestrationKind && task.orchestrationKind !== "parallel") {
    return {
      ok: false,
      response: {
        status: 400,
        body: { error: "Candidate adoption is only available for parallel execution" },
      },
    };
  }

  const domainRunsResult = await cpFetch<{ data: TaskDomainRunSummaryRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/domain-runs`,
    { authorization },
  );
  const parallelRunId =
    domainRunsResult.ok && Array.isArray(domainRunsResult.data?.data)
      ? (domainRunsResult.data.data.find((run) => run.orchestrationKind === "parallel")?.id ?? null)
      : null;
  if (!parallelRunId) {
    return {
      ok: false,
      response: {
        status: 404,
        body: { error: "Task domain run not found" },
      },
    };
  }

  const runDetailResult = await cpFetch<{ data: TaskDomainRunDetailRecord }>(
    `/api/tasks/${encodeURIComponent(taskId)}/domain-runs/${encodeURIComponent(parallelRunId)}`,
    { authorization },
  );
  if (!runDetailResult.ok || !runDetailResult.data?.data) {
    return {
      ok: false,
      response: {
        status: 404,
        body: { error: "Task domain run not found" },
      },
    };
  }

  const runDetail = runDetailResult.data.data;
  const candidate = runDetail.candidateNodes.find((node) => node.candidateIndex === candidateIndex);
  if (!candidate) {
    return {
      ok: false,
      response: {
        status: 404,
        body: { error: `Candidate ${candidateIndex} not found` },
      },
    };
  }

  if (candidate.status !== "completed") {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          error: `Candidate ${candidateIndex} is not completed (status: ${candidate.status})`,
        },
      },
    };
  }

  return {
    ok: true,
    context: {
      task,
      parallelRunId,
      runDetail,
      candidate,
    },
  };
}

async function stopNonWinningCandidates(
  candidateIndex: number,
  candidateNodes: TaskDomainRunNodeRecord[],
) {
  const stoppedCandidates: Array<{
    candidateIndex: number;
    status: "failed" | "cancelled";
    resultText: string;
    errorText?: string;
  }> = [];

  for (const currentCandidate of candidateNodes) {
    if (!shouldStopNonWinningCandidate(currentCandidate, candidateIndex)) {
      continue;
    }

    stoppedCandidates.push(await stopParallelCandidate(currentCandidate));
  }

  return stoppedCandidates;
}

function shouldStopNonWinningCandidate(
  candidate: TaskDomainRunNodeRecord,
  winnerCandidateIndex: number,
) {
  return (
    candidate.candidateIndex !== winnerCandidateIndex &&
    typeof candidate.candidateIndex === "number" &&
    (candidate.status === "running" ||
      candidate.status === "pending" ||
      candidate.status === "paused")
  );
}

async function stopParallelCandidate(candidate: TaskDomainRunNodeRecord) {
  const terminateResult = candidate.agentRunId
    ? await terminateAgent(candidate.agentRunId)
    : { ok: true as const };
  const status = terminateResult.ok ? ("cancelled" as const) : ("failed" as const);
  const stopMessage = terminateResult.ok
    ? "Manual candidate adoption ended this parallel run before the candidate completed."
    : `Failed to stop after manual candidate adoption: ${terminateResult.error || "unknown error"}`;

  return {
    candidateIndex: candidate.candidateIndex as number,
    status,
    resultText: `[${terminateResult.ok ? "STOPPED" : "FAILED"}] ${stopMessage}`,
    ...(terminateResult.ok ? {} : { errorText: stopMessage }),
  };
}

function buildCandidateSessionLineageNodes(candidateNodes: TaskDomainRunNodeRecord[]) {
  return candidateNodes
    .map((node) => ({
      index: node.candidateIndex,
      sessionId: node.sessionId,
      branchName:
        node.title ||
        node.modelUsed ||
        node.agentType ||
        (typeof node.candidateIndex === "number"
          ? `Candidate ${node.candidateIndex + 1}`
          : "Candidate"),
    }))
    .filter(
      (node): node is { index: number; sessionId: string; branchName: string } =>
        typeof node.index === "number" &&
        typeof node.sessionId === "string" &&
        node.sessionId.length > 0,
    );
}

async function activateAdoptedCandidateSession(args: {
  task: ExecutableTask & { result?: string };
  taskId: string;
  candidate: TaskDomainRunNodeRecord;
  candidateNodes: TaskDomainRunNodeRecord[];
  authorization: string;
}) {
  const { task, taskId, candidate, candidateNodes, authorization } = args;
  if (!candidate.sessionId) {
    return null;
  }

  await registerParallelTaskSessionCandidates(
    task,
    buildCandidateSessionLineageNodes(candidateNodes),
    authorization,
  );
  const activation = await activateTaskSessionLineage(taskId, candidate.sessionId, authorization);
  if (!activation.ok) {
    return {
      ok: false as const,
      response: {
        status: activation.status,
        body: { error: activation.error },
      },
    };
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

  return { ok: true as const };
}

async function finalizeCandidateAdoption(args: {
  taskId: string;
  candidateIndex: number;
  authorization: string;
  task: ExecutableTask & { result?: string };
  parallelRunId: string;
  stoppedCandidates: Array<{
    candidateIndex: number;
    status: "failed" | "cancelled";
    resultText: string;
    errorText?: string;
  }>;
  winnerResult: string | undefined;
}) {
  const {
    taskId,
    candidateIndex,
    authorization,
    task,
    parallelRunId,
    stoppedCandidates,
    winnerResult,
  } = args;

  const adoptResult = await cpFetch<{
    data?: {
      winnerCandidateIndex?: number;
      result?: string | null;
    };
    error?: string;
  }>(
    `/api/tasks/${encodeURIComponent(taskId)}/domain-runs/${encodeURIComponent(parallelRunId)}/candidates/${candidateIndex}/adopt`,
    {
      method: "POST",
      authorization,
      body: { stoppedCandidates },
    },
  );
  if (!adoptResult.ok) {
    return {
      ok: false as const,
      response: {
        status: adoptResult.status as 400 | 404 | 502,
        body: { error: adoptResult.data?.error || "Failed to adopt candidate" },
      },
    };
  }

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

  return {
    ok: true as const,
    response: {
      status: 200 as const,
      body: { ok: true, winnerCandidateIndex: candidateIndex },
    },
  };
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

function applyParallelCandidateAttempts(plan: RuntimePlan, attempts: ParallelCandidateAttempt[]) {
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
  primaryCandidate: RuntimePlan["candidates"][number] | undefined,
  candidates: RuntimePlan["candidates"],
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
    parentSessionId: context.parentSessionId,
    operationId: context.operationId,
  }).catch(() => null);

  // Persist user prompt for each parallel candidate session
  const parallelSystemContextText = buildExecutionContext({
    taskId: context.task.id,
    projectId: context.task.projectId,
    repoContext: context.repoContext,
  });
  for (const candidate of context.plan.candidates) {
    if (candidate.sessionId && candidate.status === "running") {
      const candidateModel = candidate.model || context.effectiveModel;
      const userInputText = context.prompt;
      const finalSentText = `${parallelSystemContextText}${userInputText}`;
      persistTaskSessionMessageSnapshot(context.task.id, context.authorization, {
        runtimeSessionId: candidate.sessionId,
        message: {
          info: {
            id: `${candidate.sessionId}:user-prompt`,
            role: "user",
            agent: candidate.agent || context.executionAgent,
            model: candidateModel,
            time: { created: new Date().toISOString(), completed: new Date().toISOString() },
          },
          parts: [{ type: "text", text: finalSentText }],
          promptDecomposition: {
            userInputText,
            systemContextText: parallelSystemContextText,
            finalSentText,
          },
        },
      }).catch(() => null);
    }
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

function attachSingleCandidate(plan: RuntimePlan, execResult: SessionStartResult) {
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
    { parentSessionId: context.parentSessionId, operationId: context.operationId },
  );

  // Persist user prompt message explicitly — SSE message.updated for user
  // messages may arrive without inline content and fail to persist.
  if (execResult.sessionId) {
    const model = context.resolvedModel
      ? `${context.resolvedModel.providerId}:${context.resolvedModel.modelId}`
      : undefined;
    const systemContextText = buildExecutionContext({
      taskId: context.task.id,
      projectId: context.task.projectId,
      repoContext: context.repoContext,
    });
    const userInputText = context.prompt;
    const finalSentText = `${systemContextText}${userInputText}`;
    persistTaskSessionMessageSnapshot(context.task.id, context.authorization, {
      runtimeSessionId: execResult.sessionId,
      message: {
        info: {
          id: `${execResult.sessionId}:user-prompt`,
          role: "user",
          agent: context.executionAgent,
          model,
          time: { created: new Date().toISOString(), completed: new Date().toISOString() },
        },
        parts: [{ type: "text", text: finalSentText }],
        promptDecomposition: { userInputText, systemContextText, finalSentText },
      },
    }).catch(() => null);
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

// ── Sequential-chain execution engine ───────────────────────────────

function buildChainStepPrompt(
  basePrompt: string,
  step: RuntimePlan["steps"][0],
  stepIndex: number,
  allSteps: RuntimePlan["steps"],
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
  const { stepIndex, chainSteps, currentStep } = getSequentialChainExecutionState(context);
  if (!currentStep) {
    return {
      status: 502,
      body: { error: "No chain step available to execute" },
    };
  }

  const { execResult, totalSteps } = await startSequentialChainSession(
    context,
    currentStep,
    stepIndex,
    chainSteps,
  );

  if (!execResult.ok) {
    currentStep.status = "failed";
    await markTaskFailed(context.task.id, context.authorization);
    return {
      status: 502,
      body: { error: execResult.error || "Failed to start chain step" },
    };
  }

  return finalizeSuccessfulSequentialChainStart({
    context,
    currentStep,
    execResult,
    stepIndex,
    totalSteps,
  });
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

  const authorization = authHeader(c);
  const [result, snapshotsResult] = await Promise.all([
    cpFetch(`/api/project-tree/tasks?${params.toString()}`, {
      authorization,
    }),
    fetchTaskProjectionSnapshots(authorization, {
      projectId: projectId || undefined,
      status: status || undefined,
      limit: 200,
    }),
  ]);
  if (!result.ok) {
    return c.json(result.data, result.status as 401 | 502);
  }

  const snapshots = Array.isArray(snapshotsResult.data?.data) ? snapshotsResult.data.data : [];

  const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.taskId, snapshot]));

  const data = Array.isArray((result.data as { data?: unknown[] })?.data)
    ? (result.data as { data: Array<Record<string, unknown>> }).data.map((task) =>
        mergeTaskWithProjectionSnapshot(task, snapshotMap.get(String(task.id))),
      )
    : [];

  return c.json({ ...(result.data as Record<string, unknown>), data }, 200);
});

// GET /api/tasks/:taskId — Get task detail read model only.
// Tree, session, message, and lineage consumers should use /api/tasks/:taskId/tree.
taskRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);
  const [result, snapshot] = await Promise.all([
    cpFetch(`/api/project-tree/tasks/${encodeURIComponent(taskId)}`, {
      authorization,
    }),
    loadTaskProjectionSnapshot(taskId, authorization),
  ]);
  if (!result.ok) {
    return c.json(result.data, result.status as 401 | 404 | 502);
  }

  return c.json(
    mergeTaskWithProjectionSnapshot(result.data as Record<string, unknown>, snapshot),
    200,
  );
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

taskRoutes.get(":taskId/member-view", async (c) => {
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

  const view = await buildTaskMemberViewModel({
    taskId,
    authorization,
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

  const overrides = await parseExecuteOverridesFromRequest(c);
  const preparation = await prepareTaskExecutionStart(taskId, authorization, overrides);
  if (!preparation.ok) {
    return c.json(preparation.response.body, preparation.response.status);
  }

  const response = await startTaskExecutionByPlan(preparation.context);

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

  const adoptionContext = await fetchCandidateAdoptionContext(
    taskId,
    candidateIndex,
    authorization,
  );
  if (!adoptionContext.ok) {
    return c.json(adoptionContext.response.body, adoptionContext.response.status);
  }

  const { task, parallelRunId, runDetail, candidate } = adoptionContext.context;
  const stoppedCandidates = await stopNonWinningCandidates(
    candidateIndex,
    runDetail.candidateNodes,
  );
  const activation = await activateAdoptedCandidateSession({
    task,
    taskId,
    candidate,
    candidateNodes: runDetail.candidateNodes,
    authorization,
  });
  if (activation && !activation.ok) {
    return c.json(activation.response.body, activation.response.status as 400 | 404 | 502);
  }

  const winnerResult = candidate.resultText ?? candidate.resultSummary ?? undefined;
  const adoptionResult = await finalizeCandidateAdoption({
    taskId,
    candidateIndex,
    authorization,
    task,
    parallelRunId,
    stoppedCandidates,
    winnerResult,
  });
  if (!adoptionResult.ok) {
    return c.json(adoptionResult.response.body, adoptionResult.response.status);
  }

  return c.json(adoptionResult.response.body, adoptionResult.response.status);
});

taskRoutes.post("/:taskId/complete", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);

  const taskResult = await cpFetch<ExecutableTask & { result?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );
  if (!taskResult.ok || !taskResult.data?.id || !taskResult.data?.projectId) {
    return c.json({ error: "Task not found" }, 404);
  }

  const task = taskResult.data;

  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    authorization,
    body: { status: "completed" },
  });

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.completed",
    ts: new Date().toISOString(),
    taskId,
    projectId: task.projectId ?? undefined,
    data: {
      status: "completed",
      explicitCompletion: true,
      ...(task.result ? { result: task.result } : {}),
    },
  });

  return c.json({ ok: true });
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

taskRoutes.get("/:taskId/domain-runs", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/domain-runs`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

taskRoutes.get("/:taskId/domain-runs/:runId", async (c) => {
  const taskId = c.req.param("taskId");
  const runId = c.req.param("runId");
  const result = await cpFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/domain-runs/${encodeURIComponent(runId)}`,
    {
      authorization: authHeader(c),
    },
  );
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

taskRoutes.get("/:taskId/query/normalized-conversation", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);
  const sessionId = c.req.query("sessionId");
  const includeLineage = c.req.query("includeLineage") !== "false";

  const result = await fetchTaskConversationMessages(taskId, authorization, {
    ...(sessionId ? { sessionId } : {}),
    includeLineage,
  });

  if (!result.ok) {
    return c.json(
      result.data ?? { error: result.error ?? "Failed to load normalized conversation" },
      result.status as 401 | 404 | 502,
    );
  }

  return c.json(result.data, 200);
});

taskRoutes.get("/:taskId/messages", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);
  const includeLineage = c.req.query("includeLineage") !== "false";

  const result = await fetchTaskConversationMessages(taskId, authorization, {
    includeLineage,
  });

  if (!result.ok) {
    return c.json(
      result.data ?? { error: result.error ?? "Failed to load task messages" },
      result.status as 401 | 404 | 502,
    );
  }

  return c.json(result.data, 200);
});

taskRoutes.get("/:taskId/sessions/:sessionId/messages", async (c) => {
  const taskId = c.req.param("taskId");
  const sessionId = c.req.param("sessionId");
  const authorization = authHeader(c);
  const includeLineage = c.req.query("includeLineage") !== "false";

  const result = await fetchTaskSessionCachedMessages(taskId, sessionId, authorization, {
    includeLineage,
  });

  if (!result.ok) {
    return c.json(
      result.data ?? { error: result.error ?? "Failed to load task session messages" },
      result.status as 401 | 404 | 502,
    );
  }

  return c.json(
    {
      data: result.data?.data ?? [],
      meta: result.data?.meta ? { ...result.data.meta, sessionId } : { sessionId },
    },
    200,
  );
});

taskRoutes.get("/:taskId/query/raw-events", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/query/raw-events`, {
    authorization: authHeader(c),
  });

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

taskRoutes.get("/:taskId/tree", async (c) => {
  const taskId = c.req.param("taskId");
  const params = new URLSearchParams();
  const sessionId = c.req.query("sessionId");
  if (sessionId) {
    params.set("sessionId", sessionId);
  }
  const includeLineage = c.req.query("includeLineage");
  if (includeLineage) {
    params.set("includeLineage", includeLineage);
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/tree${suffix}`, {
    authorization: authHeader(c),
  });

  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

taskRoutes.get("/:taskId/timeline", async (c) => {
  const taskId = c.req.param("taskId");
  const params = new URLSearchParams();
  const sessionId = c.req.query("sessionId");
  if (sessionId) {
    params.set("sessionId", sessionId);
  }
  const includeLineage = c.req.query("includeLineage");
  if (includeLineage) {
    params.set("includeLineage", includeLineage);
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/timeline${suffix}`, {
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
        taskSessionId: buildPublicTaskSessionId(taskId, record.runtimeSessionId),
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
          taskSessionId: buildPublicTaskSessionId(taskId, record.runtimeSessionId),
          title: record.branchName ?? runtime?.title ?? "",
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

// Legacy alias for session summary reads used by task detail pages.
taskRoutes.get(":taskId/sessions", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);

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

    return c.json({
      data: normalizedRecords.map((record) => {
        const runtime = runtimeMap.get(record.runtimeSessionId);
        return {
          id: record.runtimeSessionId,
          taskSessionId: buildPublicTaskSessionId(taskId, record.runtimeSessionId),
          title: record.branchName ?? runtime?.title ?? "",
          isActive: record.isActive || record.runtimeSessionId === taskResult.data?.sessionId,
          summary: runtime?.summary ?? null,
          createdAt: runtime?.createdAt ?? record.createdAt ?? null,
          updatedAt: runtime?.updatedAt ?? record.updatedAt ?? null,
          executionStatus: record.executionStatus ?? null,
          sessionKind: record.sessionKind ?? null,
          candidateIndex: record.candidateIndex ?? null,
          stepIndex: record.stepIndex ?? null,
          selectedModel: record.selectedModel ?? null,
          executionModeSnapshot: record.executionModeSnapshot ?? null,
        } satisfies SessionSummaryRecord;
      }),
    });
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
          taskSessionId: buildPublicTaskSessionId(taskId, record.runtimeSessionId),
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

  const result = await buildTaskExecutionTrace(
    taskId,
    authorization,
    requestedSessionId,
    includeLineage,
  );
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
  return c.json(result.body, result.status as 200 | 400 | 404 | 502);
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
  const lineageResult = await fetchTaskSessionLineageRecords(args.taskId, args.authorization);
  const parentRecord = lineageResult.ok
    ? lineageResult.records.find(
        (record) =>
          record.runtimeSessionId === args.sessionId ||
          record.id === args.sessionId ||
          `task-session:${args.taskId}:${record.runtimeSessionId}` === args.sessionId,
      )
    : undefined;
  const parentRuntimeSessionId = parentRecord?.runtimeSessionId ?? args.sessionId;
  const parentTaskSessionId = buildPublicTaskSessionId(args.taskId, parentRuntimeSessionId);

  const taskResult = await cpFetch<{ projectId?: string; title?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(args.taskId)}`,
    { authorization: args.authorization },
  );

  if (!taskResult.ok) {
    return { status: 404 as const, body: { error: "Task not found" } };
  }

  await ensureParentLineageRecord(
    args.taskId,
    parentRuntimeSessionId,
    args.authorization,
    taskResult.data?.title,
  );

  const defaultTitle =
    args.title || `[Task ${args.taskId.slice(0, 8)}] Fork ${new Date().toLocaleTimeString()}`;
  const result = await forkSession(parentRuntimeSessionId, { title: defaultTitle });

  if (!result.ok || !result.sessionId) {
    return { status: 502 as const, body: { error: result.error || "Failed to fork session" } };
  }

  await upsertTaskSessionLineageRecord(args.taskId, args.authorization, {
    runtimeSessionId: result.sessionId,
    parentRuntimeSessionId: parentRuntimeSessionId,
    forkedFromMessageId: args.messageId,
    branchName: defaultTitle,
    sourceType: "fork",
    isActive: true,
    operationId: crypto.randomUUID(),
  });

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.forked",
    ts: new Date().toISOString(),
    taskId: args.taskId,
    projectId: taskResult.data?.projectId,
    sessionId: result.sessionId,
    data: {
      parentSessionId: parentRuntimeSessionId,
      title: defaultTitle,
      forkedFromMessageId: args.messageId,
    },
  });

  return {
    status: 200 as const,
    body: {
      ok: true,
      sessionId: result.sessionId,
      taskSessionId: buildPublicTaskSessionId(args.taskId, result.sessionId),
      title: defaultTitle,
      parentSessionId: parentRuntimeSessionId,
      parentTaskSessionId,
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

taskRoutes.post(
  "/:taskId/sessions/:sessionId/fork",
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
  coordinationKey?: string | null;
  winnerSessionId?: string | null;
  executionStatus?: string | null;
  sessionKind?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  executionModeSnapshot?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
}

function coerceTaskSessionRecord(
  taskId: string,
  record: TaskSessionLineageRecord,
): TaskSessionRecord {
  return {
    id: record.id ?? buildPublicTaskSessionId(taskId, record.runtimeSessionId),
    taskId: record.taskId ?? taskId,
    runtimeSessionId: record.runtimeSessionId,
    parentRuntimeSessionId: record.parentRuntimeSessionId ?? null,
    forkedFromMessageId: record.forkedFromMessageId ?? null,
    branchName: record.branchName ?? null,
    sourceType: record.sourceType,
    isActive: record.isActive,
    coordinationKey: record.coordinationKey ?? null,
    winnerSessionId: record.winnerSessionId ?? null,
    executionStatus: record.executionStatus ?? null,
    sessionKind: record.sessionKind ?? null,
    candidateIndex: typeof record.candidateIndex === "number" ? record.candidateIndex : null,
    stepIndex: typeof record.stepIndex === "number" ? record.stepIndex : null,
    selectedModel: record.selectedModel ?? null,
    executionModeSnapshot: record.executionModeSnapshot ?? null,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
    archivedAt: record.archivedAt ?? null,
  };
}

interface RuntimeSessionMeta {
  title?: string;
  summary?: { additions: number; deletions: number; files: number } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface SessionTreeNode {
  id: string;
  branchNodeId: string;
  runtimeSessionId: string;
  taskSessionId: string;
  parentRuntimeSessionId: string | null;
  parentTaskSessionId: string | null;
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

function buildPublicTaskSessionId(taskId: string, sessionId: string) {
  return toCanonicalTaskSessionId(taskId, sessionId) ?? `task-session:${taskId}:${sessionId}`;
}

function buildBranchLineageNodeId(taskId: string, runtimeSessionId: string) {
  return `branch-node:${taskId}:${runtimeSessionId}`;
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

async function loadTaskSessionPreviewMessages(
  taskId: string,
  sessionId: string,
  authorization: string,
) {
  const cachedResult = await fetchTaskSessionCachedMessages(taskId, sessionId, authorization, {
    includeLineage: false,
  });
  if (
    cachedResult.ok &&
    Array.isArray(cachedResult.data?.data) &&
    cachedResult.data.data.length > 0
  ) {
    return cachedResult.data.data;
  }

  const runtimeResult = await getSessionMessages(sessionId);
  if (!runtimeResult.ok || !Array.isArray(runtimeResult.data)) {
    return [] as unknown[];
  }

  return runtimeResult.data;
}

async function appendForkMessagePreviews(
  previewMap: Map<string, { role: string | null; preview: string | null }>,
  taskId: string,
  parentSessionId: string,
  authorization: string,
  messageIds: Set<string>,
) {
  const messages = await loadTaskSessionPreviewMessages(taskId, parentSessionId, authorization);

  for (const message of messages) {
    const messageId = extractSessionMessageId(message);
    if (!messageId || !messageIds.has(messageId)) {
      continue;
    }

    previewMap.set(`${parentSessionId}:${messageId}`, extractMessagePreview(message));
  }
}

async function buildForkMessagePreviewMap(
  taskId: string,
  authorization: string,
  records: TaskSessionRecord[],
) {
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
      await appendForkMessagePreviews(
        previewMap,
        taskId,
        parentSessionId,
        authorization,
        messageIds,
      );
    }),
  );

  return previewMap;
}

async function buildFirstPromptAfterForkMap(
  taskId: string,
  authorization: string,
  records: TaskSessionRecord[],
) {
  const promptMap = new Map<string, string | null>();

  await Promise.all(
    records.map(async (record) => {
      const messages = await loadTaskSessionPreviewMessages(
        taskId,
        record.runtimeSessionId,
        authorization,
      );
      if (messages.length === 0) {
        promptMap.set(record.runtimeSessionId, null);
        return;
      }

      if (record.sourceType === "root") {
        const firstUserMessage = messages.find((message) => {
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

      if (!record.createdAt) {
        promptMap.set(record.runtimeSessionId, null);
        return;
      }

      const createdAtMs = Date.parse(record.createdAt);
      if (!Number.isFinite(createdAtMs)) {
        promptMap.set(record.runtimeSessionId, null);
        return;
      }

      const firstUserMessage = messages.find((message) => {
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
  activeRuntimeSessionId: string | undefined,
  runtimeSessions: Map<string, RuntimeSessionMeta>,
) {
  const taskPrefix = `[Task ${taskId.slice(0, 8)}]`;
  const records = Array.from(runtimeSessions.entries())
    .filter(
      ([runtimeSessionId, runtime]) =>
        runtimeSessionId === activeRuntimeSessionId || runtime.title?.includes(taskPrefix),
    )
    .sort((left, right) =>
      compareIsoTime(
        left[1].createdAt ?? left[1].updatedAt,
        right[1].createdAt ?? right[1].updatedAt,
      ),
    )
    .map(([runtimeSessionId, runtime]) => ({ runtimeSessionId, runtime }));

  const rootRuntimeSessionId =
    (activeRuntimeSessionId &&
      records.find((record) => record.runtimeSessionId === activeRuntimeSessionId)
        ?.runtimeSessionId) ||
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
    isActive: runtimeSessionId === activeRuntimeSessionId,
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
  taskId: string,
  record: TaskSessionRecord,
  runtimeSessions: Map<string, RuntimeSessionMeta>,
  forkMessagePreviewMap: Map<string, { role: string | null; preview: string | null }>,
  firstPromptAfterForkMap: Map<string, string | null>,
): SessionTreeNode {
  const runtime = runtimeSessions.get(record.runtimeSessionId);
  const branchNodeId = buildBranchLineageNodeId(taskId, record.runtimeSessionId);
  const forkSource =
    record.parentRuntimeSessionId && record.forkedFromMessageId
      ? forkMessagePreviewMap.get(`${record.parentRuntimeSessionId}:${record.forkedFromMessageId}`)
      : undefined;

  return {
    id: branchNodeId,
    branchNodeId,
    runtimeSessionId: record.runtimeSessionId,
    taskSessionId: buildPublicTaskSessionId(taskId, record.runtimeSessionId),
    parentRuntimeSessionId: record.parentRuntimeSessionId,
    parentTaskSessionId: record.parentRuntimeSessionId
      ? buildPublicTaskSessionId(taskId, record.parentRuntimeSessionId)
      : null,
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
  taskId: string,
  records: TaskSessionRecord[],
  runtimeSessions: Map<string, RuntimeSessionMeta>,
  forkMessagePreviewMap: Map<string, { role: string | null; preview: string | null }>,
  firstPromptAfterForkMap: Map<string, string | null>,
): SessionTreeNode[] {
  const nodeMap = new Map<string, SessionTreeNode>();
  const roots: SessionTreeNode[] = [];

  for (const rec of records) {
    const node = createSessionTreeNode(
      taskId,
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
): Promise<
  { ok: true; branchName: string | null } | { ok: false; status: 404 | 502; error: string }
> {
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
taskRoutes.get(":taskId/branch-lineage", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);

  const taskResult = await cpFetch<{ sessionId?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );

  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  const lineageRecords = lineageResult.activeRecords;

  const runtimeMap = await fetchRuntimeSessionMap(100);
  const forkMessagePreviewMap = await buildForkMessagePreviewMap(
    taskId,
    authorization,
    lineageRecords,
  );
  const firstPromptAfterForkMap = await buildFirstPromptAfterForkMap(
    taskId,
    authorization,
    lineageRecords,
  );

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
    return c.json({
      data: buildSessionTree(taskId, synthesizedRecords, runtimeMap, new Map(), new Map()),
    });
  }

  const { records: normalizedRecords, repaired } = normalizeLineageRecords(lineageRecords);
  if (repaired.length > 0) {
    await persistLineageRepairs(taskId, repaired, authorization);
  }

  const tree = buildSessionTree(
    taskId,
    normalizedRecords,
    runtimeMap,
    forkMessagePreviewMap,
    firstPromptAfterForkMap,
  );
  return c.json({ data: tree });
});

// Legacy alias for branch lineage reads used by tree view composables.
taskRoutes.get(":taskId/session-lineage", async (c) => {
  const taskId = c.req.param("taskId");
  const authorization = authHeader(c);

  const taskResult = await cpFetch<{ sessionId?: string }>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    { authorization },
  );

  const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
  const lineageRecords = lineageResult.activeRecords;
  const runtimeMap = await fetchRuntimeSessionMap(100);
  const forkMessagePreviewMap = await buildForkMessagePreviewMap(
    taskId,
    authorization,
    lineageRecords,
  );
  const firstPromptAfterForkMap = await buildFirstPromptAfterForkMap(
    taskId,
    authorization,
    lineageRecords,
  );

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
    return c.json({
      data: buildSessionTree(taskId, synthesizedRecords, runtimeMap, new Map(), new Map()),
    });
  }

  const { records: normalizedRecords, repaired } = normalizeLineageRecords(lineageRecords);
  if (repaired.length > 0) {
    await persistLineageRepairs(taskId, repaired, authorization);
  }

  return c.json({
    data: buildSessionTree(
      taskId,
      normalizedRecords,
      runtimeMap,
      forkMessagePreviewMap,
      firstPromptAfterForkMap,
    ),
  });
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

taskRoutes.post("/:taskId/sessions/:sessionId/activate", async (c) => {
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

taskRoutes.post("/:taskId/sessions/:sessionId/archive", async (c) => {
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
