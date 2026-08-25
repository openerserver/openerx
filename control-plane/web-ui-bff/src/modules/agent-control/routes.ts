import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { authHeader, cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import { mergeTaskStrategy, readOrchestrationStrategy } from "../../lib/orchestration-strategy";
import { recordPaidExecutionRuntimeUsage } from "../../lib/paid-execution-runtime";
import { executeLifecycleHooks } from "../hooks/lifecycle-hooks";
import { wsBroadcaster } from "../realtime/ws-broadcaster";
import { finalizeTaskState } from "../tasks/finalize";
import { getAgentRun, recoverAgentRun, updateAgentRunStatus } from "./agent-run-registry";
import { extractAssistantResultFromMessages } from "./runtime-message-utils";
import { patchAgentRunRecord, recordAgentAudit } from "./run-persistence";
import {
  getAgentMessages,
  getSessionMessages,
  injectGuidance,
  pauseAgent,
  resumeAgent,
  terminateAgent,
} from "./runtime-provider";

export const agentControlRoutes = new Hono();

type RuntimeRun = NonNullable<ReturnType<typeof getAgentRun>>;
type AgentOpsQueue = "attention" | "running" | "recent";

type AgentOpsViewScope = "mine" | "project" | "global";

interface AgentRunSummaryResponse {
  agentRunId: string;
  entryContext?: string;
  viewScope?: "mine" | "project" | "global";
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string | null;
  agentType: string;
  status: string;
  sessionId: string | null;
  modelUsed: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  durationMs: number | null;
  tokenUsed: number;
  blockerType: string | null;
  blockerLabel: string;
  riskLevel: string | null;
  guidanceCount: number;
  resultSummary: string | null;
  result: string | null;
  error: string | null;
  longSummary: string | null;
  latestEvents: Array<{ ts: string; type: string; summary: string }>;
  actionPermissions?: {
    canPause: boolean;
    canResume: boolean;
    canTerminate: boolean;
    canInjectGuidance: boolean;
    canViewApproval: boolean;
    canViewAudit: boolean;
    canViewCodeChanges: boolean;
    canExport: boolean;
  } | null;
  governance?: {
    approvalTickets?: number;
    pendingApprovals?: number;
    latestApprovalStatus?: string | null;
    recentAuditEvents?: number;
    latestHighRiskAction?: string | null;
  } | null;
  codeChanges?: {
    changeCount?: number;
    files?: number;
    insertions?: number;
    deletions?: number;
    latestSummary?: string | null;
  } | null;
  subSessionId?: string;
}

interface AgentOpsQueueItemResponse {
  agentRunId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string | null;
  subSessionId?: string;
  agentType: string;
  status: string;
  currentStage: string | null;
  blockerType: string | null;
  blockerLabel: string;
  blockerReason: string | null;
  riskLevel: string | null;
  approvalStatus: string | null;
  requiresIntervention: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  durationMs: number | null;
  modelUsed: string | null;
  tokenUsed: number;
  resultSummary: string | null;
  guidanceCount: number;
  primaryAttentionReason?: string | null;
  quickActions?: string[];
  actionPermissions?: AgentRunSummaryResponse["actionPermissions"];
}

interface AgentRunSummariesResponse {
  data?: Array<Partial<AgentRunSummaryResponse>>;
}

interface TaskSessionPhaseReference {
  id: string;
  runtimeSessionId?: string | null;
  phaseId?: string | null;
}

interface TaskPhaseReference {
  id: string;
  phaseKind: string;
  triggerType: string;
  currentSessionId?: string | null;
  latestSessionId?: string | null;
}

interface RuntimeRunTaskPhaseContext {
  taskId: string;
  projectId: string;
  phaseId: string;
  phaseKind: string;
  triggerType: string;
  taskSessionId: string | null;
  currentSessionId: string | null;
  latestSessionId: string | null;
}

type RuntimeRunRecoveryFailure = {
  status: 404 | 409;
  code: "AGENT_RUN_SUMMARY_NOT_FOUND" | "AGENT_RUN_SUMMARY_INCOMPLETE";
  error: string;
};

type RuntimeRunRecoveryResult = {
  run?: RuntimeRun;
  failure?: RuntimeRunRecoveryFailure;
};

function shouldPreferPersistedStatus(persistedStatus: string, runtimeStatus: string) {
  return runtimeStatus === "running" && persistedStatus !== "running";
}

function maybeResyncRuntimeStatus(
  agentRunId: string,
  persistedStatus: string,
  runtimeRun?: RuntimeRun,
) {
  if (!runtimeRun || !shouldPreferPersistedStatus(persistedStatus, runtimeRun.status)) {
    return runtimeRun;
  }

  const synced = updateAgentRunStatus(agentRunId, persistedStatus as RuntimeRun["status"]);
  return synced ?? runtimeRun;
}

function parsePersistedModel(modelUsed?: string | null) {
  if (!modelUsed) {
    return undefined;
  }

  const delimiterIndex = modelUsed.indexOf(":");
  if (delimiterIndex <= 0 || delimiterIndex >= modelUsed.length - 1) {
    return undefined;
  }

  return {
    providerId: modelUsed.slice(0, delimiterIndex),
    modelId: modelUsed.slice(delimiterIndex + 1),
  };
}

function extractRuntimeSessionIdFromPublicTaskSessionId(
  taskId?: string | null,
  sessionId?: string | null,
) {
  const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalizedSessionId) {
    return null;
  }

  if (!normalizedSessionId.startsWith("task-session:")) {
    return normalizedSessionId;
  }

  const normalizedTaskId = typeof taskId === "string" ? taskId.trim() : "";
  if (!normalizedTaskId) {
    return null;
  }

  const prefix = `task-session:${normalizedTaskId}:`;
  if (!normalizedSessionId.startsWith(prefix)) {
    return null;
  }

  const runtimeSessionId = normalizedSessionId.slice(prefix.length).trim();
  return runtimeSessionId || null;
}

function resolveRuntimeSessionIdFromAgentRunSummary(summary: Partial<AgentRunSummaryResponse>) {
  const subSessionId = typeof summary.subSessionId === "string" ? summary.subSessionId.trim() : "";
  if (subSessionId) {
    return subSessionId;
  }

  const taskId = typeof summary.taskId === "string" ? summary.taskId : null;
  const sessionId = typeof summary.sessionId === "string" ? summary.sessionId : null;
  return extractRuntimeSessionIdFromPublicTaskSessionId(taskId, sessionId);
}

async function ensureRuntimeRunFromSummary(
  c: Parameters<typeof authHeader>[0],
  agentRunId: string,
) {
  const result = await ensureRuntimeRunFromSummaryDetailed(c, agentRunId);
  return result.run;
}

async function ensureRuntimeRunFromSummaryDetailed(
  c: Parameters<typeof authHeader>[0],
  agentRunId: string,
): Promise<RuntimeRunRecoveryResult> {
  const existing = getAgentRun(agentRunId);
  if (existing) {
    return { run: existing };
  }

  const summaryResult = await cpFetch<Partial<AgentRunSummaryResponse>>(
    `/api/agent-runs/${encodeURIComponent(agentRunId)}/summary`,
    { authorization: authHeader(c) },
  );
  if (!summaryResult.ok) {
    return {
      failure: {
        status: 404,
        code: "AGENT_RUN_SUMMARY_NOT_FOUND",
        error:
          "This agent run is not currently active in the runtime. Historical agent run data is no longer available.",
      },
    };
  }

  const summary = summaryResult.data;
  const sessionId = resolveRuntimeSessionIdFromAgentRunSummary(summary);
  const taskId = typeof summary.taskId === "string" ? summary.taskId : null;
  const projectId = typeof summary.projectId === "string" ? summary.projectId : null;

  if (!sessionId || !taskId || !projectId) {
    return {
      failure: {
        status: 409,
        code: "AGENT_RUN_SUMMARY_INCOMPLETE",
        error: "Historical agent run summary is incomplete and cannot be recovered.",
      },
    };
  }

  recoverAgentRun(
    agentRunId,
    sessionId,
    taskId,
    projectId,
    summary.startedAt,
    parsePersistedModel(typeof summary.modelUsed === "string" ? summary.modelUsed : null),
  );

  const recovered = getAgentRun(agentRunId);
  if (!recovered) {
    return {
      failure: {
        status: 409,
        code: "AGENT_RUN_SUMMARY_INCOMPLETE",
        error: "Historical agent run summary is incomplete and cannot be recovered.",
      },
    };
  }

  const persistedStatus = typeof summary.status === "string" ? summary.status : "running";
  return {
    run: maybeResyncRuntimeStatus(agentRunId, persistedStatus, recovered) ?? recovered,
  };
}

async function loadSessionTokenUsage(
  sessionId?: string | null,
  taskId?: string,
  authorization?: string,
): Promise<number> {
  if (!sessionId) {
    return 0;
  }

  const messagesResult = await getSessionMessages(
    sessionId,
    taskId ? { taskId, authorization } : undefined,
  );
  if (!messagesResult.ok) {
    return 0;
  }

  return extractAssistantResultFromMessages(messagesResult.data).tokenUsed;
}

function parseIsoMs(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveDurationMs(
  startedAt?: string | null,
  finishedAt?: string | null,
  explicitDurationMs?: number | null,
) {
  if (typeof explicitDurationMs === "number" && Number.isFinite(explicitDurationMs)) {
    return explicitDurationMs;
  }

  const startedAtMs = parseIsoMs(startedAt);
  if (startedAtMs == null) {
    return null;
  }

  const finishedAtMs = parseIsoMs(finishedAt) ?? Date.now();
  return finishedAtMs >= startedAtMs ? finishedAtMs - startedAtMs : null;
}

function defaultBlockerState(status: string) {
  switch (status) {
    case "stopped":
      return { blockerType: "stopped", blockerLabel: "已停止待处理" };
    case "paused":
      return { blockerType: "paused", blockerLabel: "已暂停待处理" };
    case "failed":
      return { blockerType: "failed", blockerLabel: "执行失败待处理" };
    default:
      return { blockerType: null, blockerLabel: "" };
  }
}

function normalizeBlockerState(
  status: string,
  blockerType?: string | null,
  blockerLabel?: string | null,
) {
  const fallback = defaultBlockerState(status);
  const normalizedType =
    typeof blockerType === "string" && blockerType.trim().length > 0
      ? blockerType.trim()
      : fallback.blockerType;
  const normalizedLabel =
    typeof blockerLabel === "string" && blockerLabel.trim().length > 0
      ? blockerLabel.trim()
      : fallback.blockerLabel;

  return {
    blockerType: normalizedType,
    blockerLabel: normalizedLabel,
  };
}

function readErrorMessage(data: unknown, fallback: string) {
  if (typeof data === "object" && data && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }

  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readDataRecords(value: unknown) {
  const root = asRecord(value);
  const items = Array.isArray(root?.data) ? root.data : [];
  return items
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null);
}

function matchesTaskSessionReference(
  taskId: string,
  runtimeSessionId: string,
  session: TaskSessionPhaseReference,
) {
  return (
    session.runtimeSessionId === runtimeSessionId ||
    session.id === runtimeSessionId ||
    session.id === `task-session:${taskId}:${runtimeSessionId}`
  );
}

function broadcastTaskPhaseAgentLifecycleEvent(args: {
  type: "task.phase.paused" | "task.phase.resumed";
  taskId: string;
  projectId: string;
  phaseId: string;
  sessionId?: string | null;
  data?: Record<string, unknown>;
}) {
  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: args.type,
    ts: new Date().toISOString(),
    taskId: args.taskId,
    projectId: args.projectId,
    sessionId: args.sessionId ?? undefined,
    phaseId: args.phaseId,
    data: {
      phaseId: args.phaseId,
      ...(args.data ?? {}),
    },
  });
}

async function resolveRuntimeRunTaskPhaseContext(
  c: Parameters<typeof authHeader>[0],
  run?: RuntimeRun,
): Promise<RuntimeRunTaskPhaseContext | null> {
  const taskId = run?.taskId;
  const runtimeSessionId = run?.subSessionId;
  const projectId = run?.projectId;
  if (!taskId || !runtimeSessionId || !projectId) {
    return null;
  }

  const authorization = authHeader(c);
  const [sessionsResult, phasesResult] = await Promise.all([
    cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/sessions`, { authorization }),
    cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/phases`, { authorization }),
  ]);
  if (!sessionsResult.ok || !phasesResult.ok) {
    return null;
  }

  const sessions = readDataRecords(sessionsResult.data).map(
    (record) =>
      ({
        id: asNonEmptyString(record.id) ?? "",
        runtimeSessionId: asNonEmptyString(record.runtimeSessionId) ?? null,
        phaseId: asNonEmptyString(record.phaseId) ?? null,
      }) satisfies TaskSessionPhaseReference,
  );
  const session = sessions.find(
    (candidate) => candidate.id && matchesTaskSessionReference(taskId, runtimeSessionId, candidate),
  );
  const phaseId = asNonEmptyString(session?.phaseId);
  if (!phaseId) {
    return null;
  }

  const phases = readDataRecords(phasesResult.data).map(
    (record) =>
      ({
        id: asNonEmptyString(record.id) ?? "",
        phaseKind: asNonEmptyString(record.phaseKind) ?? "",
        triggerType: asNonEmptyString(record.triggerType) ?? "",
        currentSessionId: asNonEmptyString(record.currentSessionId) ?? null,
        latestSessionId: asNonEmptyString(record.latestSessionId) ?? null,
      }) satisfies TaskPhaseReference,
  );
  const phase = phases.find((candidate) => candidate.id === phaseId);
  if (!phase || !phase.phaseKind || !phase.triggerType) {
    return null;
  }

  return {
    taskId,
    projectId,
    phaseId,
    phaseKind: phase.phaseKind,
    triggerType: phase.triggerType,
    taskSessionId: session?.id ?? null,
    currentSessionId: phase.currentSessionId ?? session?.id ?? null,
    latestSessionId: phase.latestSessionId ?? session?.id ?? null,
  };
}

async function syncPausedTaskPhaseForRun(c: Parameters<typeof authHeader>[0], run?: RuntimeRun) {
  const phaseContext = await resolveRuntimeRunTaskPhaseContext(c, run);
  if (!phaseContext) {
    return;
  }

  const result = await cpFetch(
    `/api/tasks/${encodeURIComponent(phaseContext.taskId)}/phases/${encodeURIComponent(phaseContext.phaseId)}/pause`,
    {
      method: "POST",
      authorization: authHeader(c),
      body: {},
    },
  );
  if (!result.ok) {
    return;
  }

  const payload = asRecord(result.data);
  const currentSessionId =
    asNonEmptyString(payload?.currentSessionId) ?? phaseContext.currentSessionId;
  const latestSessionId =
    asNonEmptyString(payload?.latestSessionId) ?? phaseContext.latestSessionId;
  broadcastTaskPhaseAgentLifecycleEvent({
    type: "task.phase.paused",
    taskId: phaseContext.taskId,
    projectId: phaseContext.projectId,
    phaseId: phaseContext.phaseId,
    sessionId: currentSessionId ?? phaseContext.taskSessionId,
    data: {
      status: asNonEmptyString(payload?.status) ?? "paused",
      phaseKind: phaseContext.phaseKind,
      triggerType: phaseContext.triggerType,
      ...(currentSessionId ? { currentSessionId } : {}),
      ...(latestSessionId ? { latestSessionId } : {}),
    },
  });
}

async function syncResumedTaskPhaseForRun(c: Parameters<typeof authHeader>[0], run?: RuntimeRun) {
  const phaseContext = await resolveRuntimeRunTaskPhaseContext(c, run);
  if (!phaseContext) {
    return;
  }

  const result = await cpFetch(
    `/api/tasks/${encodeURIComponent(phaseContext.taskId)}/phases/${encodeURIComponent(phaseContext.phaseId)}/resume`,
    {
      method: "POST",
      authorization: authHeader(c),
      body: { mode: "reuse" },
    },
  );
  if (!result.ok) {
    return;
  }

  const payload = asRecord(result.data);
  const currentSessionId =
    asNonEmptyString(payload?.currentSessionId) ?? phaseContext.currentSessionId;
  broadcastTaskPhaseAgentLifecycleEvent({
    type: "task.phase.resumed",
    taskId: phaseContext.taskId,
    projectId: phaseContext.projectId,
    phaseId: phaseContext.phaseId,
    sessionId: currentSessionId ?? phaseContext.taskSessionId,
    data: {
      status: asNonEmptyString(payload?.status) ?? "running",
      phaseKind: phaseContext.phaseKind,
      triggerType: phaseContext.triggerType,
      ...(currentSessionId ? { currentSessionId } : {}),
    },
  });
}

function normalizeLatestEvents(summary: Partial<AgentRunSummaryResponse>) {
  if (!Array.isArray(summary.latestEvents)) {
    return [];
  }

  return summary.latestEvents
    .filter(
      (event): event is { ts: string; type: string; summary: string } =>
        typeof event === "object" &&
        event !== null &&
        typeof event.ts === "string" &&
        typeof event.type === "string" &&
        typeof event.summary === "string",
    )
    .map((event) => ({
      ts: event.ts,
      type: event.type,
      summary: event.summary,
    }));
}

function normalizeAgentRunSummary(
  agentRunId: string,
  summary: Partial<AgentRunSummaryResponse>,
): AgentRunSummaryResponse {
  const status = typeof summary.status === "string" ? summary.status : "running";
  const startedAt = typeof summary.startedAt === "string" ? summary.startedAt : null;
  const finishedAt = typeof summary.finishedAt === "string" ? summary.finishedAt : null;
  const lastActivityAt =
    typeof summary.lastActivityAt === "string" ? summary.lastActivityAt : (finishedAt ?? startedAt);
  const blockerState = normalizeBlockerState(status, summary.blockerType, summary.blockerLabel);

  return {
    agentRunId,
    entryContext: summary.entryContext,
    viewScope: summary.viewScope,
    taskId: typeof summary.taskId === "string" ? summary.taskId : "",
    taskTitle: typeof summary.taskTitle === "string" ? summary.taskTitle : "",
    projectId: typeof summary.projectId === "string" ? summary.projectId : "",
    projectName: typeof summary.projectName === "string" ? summary.projectName : null,
    agentType: typeof summary.agentType === "string" ? summary.agentType : "agent",
    status,
    sessionId: typeof summary.sessionId === "string" ? summary.sessionId : null,
    modelUsed: typeof summary.modelUsed === "string" ? summary.modelUsed : null,
    startedAt,
    finishedAt,
    lastActivityAt,
    durationMs: resolveDurationMs(startedAt, finishedAt, summary.durationMs),
    tokenUsed: typeof summary.tokenUsed === "number" ? summary.tokenUsed : 0,
    blockerType: blockerState.blockerType,
    blockerLabel: blockerState.blockerLabel,
    riskLevel: typeof summary.riskLevel === "string" ? summary.riskLevel : null,
    guidanceCount: typeof summary.guidanceCount === "number" ? summary.guidanceCount : 0,
    resultSummary: typeof summary.resultSummary === "string" ? summary.resultSummary : null,
    result: typeof summary.result === "string" ? summary.result : null,
    error: typeof summary.error === "string" ? summary.error : null,
    longSummary: typeof summary.longSummary === "string" ? summary.longSummary : null,
    latestEvents: normalizeLatestEvents(summary),
    actionPermissions: summary.actionPermissions ?? null,
    governance: summary.governance ?? null,
    codeChanges: summary.codeChanges ?? null,
    subSessionId: resolveRuntimeSessionIdFromAgentRunSummary(summary) ?? undefined,
  };
}

async function loadAgentRunSummaryResponse(
  c: Parameters<typeof authHeader>[0],
  agentRunId: string,
): Promise<
  { ok: true; summary: AgentRunSummaryResponse } | { ok: false; status: number; error: string }
> {
  const summaryResult = await cpFetch<Partial<AgentRunSummaryResponse>>(
    `/api/agent-runs/${encodeURIComponent(agentRunId)}/summary`,
    { authorization: authHeader(c) },
  );
  if (summaryResult.ok) {
    const normalizedSummary = normalizeAgentRunSummary(agentRunId, summaryResult.data);
    return {
      ok: true,
      summary: normalizedSummary,
    };
  }

  return {
    ok: false,
    status: summaryResult.status,
    error: readErrorMessage(
      summaryResult.data,
      summaryResult.status === 404 ? "Agent run not found" : "Failed to load agent run summary",
    ),
  };
}

async function loadPersistedAgentRunSummaries(c: AgentOpsQueryContext) {
  const result = await cpFetch<AgentRunSummariesResponse>("/api/agent-runs/summaries", {
    authorization: authHeader(c),
  });
  if (!result.ok || !Array.isArray(result.data?.data)) {
    return [];
  }
  return result.data.data
    .map((summary) =>
      typeof summary.agentRunId === "string"
        ? normalizeAgentRunSummary(summary.agentRunId, summary)
        : null,
    )
    .filter((summary): summary is AgentRunSummaryResponse => Boolean(summary));
}

function buildRegisteredRunFromSummary(summary: AgentRunSummaryResponse) {
  return {
    agentRunId: summary.agentRunId,
    subSessionId: summary.subSessionId ?? summary.sessionId ?? "",
    status: summary.status,
    taskId: summary.taskId,
    projectId: summary.projectId,
    agentType: summary.agentType,
    startedAt: parseIsoMs(summary.startedAt) ?? 0,
    finishedAt: summary.finishedAt ?? undefined,
  };
}

function buildAgentOpsQueueItem(summary: AgentRunSummaryResponse): AgentOpsQueueItemResponse {
  return {
    agentRunId: summary.agentRunId,
    taskId: summary.taskId,
    taskTitle: summary.taskTitle,
    projectId: summary.projectId,
    projectName: summary.projectName,
    subSessionId: summary.subSessionId ?? undefined,
    agentType: summary.agentType,
    status: summary.status,
    currentStage: null,
    blockerType: summary.blockerType,
    blockerLabel: summary.blockerLabel,
    blockerReason: summary.error,
    riskLevel: summary.riskLevel,
    approvalStatus: summary.governance?.latestApprovalStatus ?? null,
    requiresIntervention: Boolean(summary.blockerType),
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    lastActivityAt: summary.lastActivityAt,
    durationMs: summary.durationMs,
    modelUsed: summary.modelUsed,
    tokenUsed: summary.tokenUsed,
    resultSummary: summary.resultSummary,
    guidanceCount: summary.guidanceCount,
    primaryAttentionReason: summary.blockerType ? summary.blockerLabel : null,
    actionPermissions: summary.actionPermissions ?? null,
  };
}

function parseBooleanQuery(value?: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function normalizeQueryText(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function resolveSummaryTimeMs(summary: AgentRunSummaryResponse) {
  return (
    parseIsoMs(summary.lastActivityAt) ??
    parseIsoMs(summary.finishedAt) ??
    parseIsoMs(summary.startedAt)
  );
}

function parseQueryTime(value?: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isApprovalBlocked(summary: AgentRunSummaryResponse) {
  return (
    (typeof summary.governance?.pendingApprovals === "number" &&
      summary.governance.pendingApprovals > 0) ||
    summary.governance?.latestApprovalStatus === "pending"
  );
}

function hasHumanIntervention(summary: AgentRunSummaryResponse) {
  return summary.guidanceCount > 0;
}

type AgentOpsQueryContext = {
  req: {
    header: (name: string) => string | undefined;
    query: (name: string) => string | undefined;
  };
};

function resolveViewScope(c: AgentOpsQueryContext): AgentOpsViewScope {
  if (c.req.query("ownerScope") === "mine") {
    return "mine";
  }

  if (c.req.query("projectId")) {
    return "project";
  }

  return "global";
}

function matchesAgentOpsFilters(summary: AgentRunSummaryResponse, c: AgentOpsQueryContext) {
  const projectId = c.req.query("projectId");
  if (projectId && summary.projectId !== projectId) {
    return false;
  }

  const taskId = c.req.query("taskId");
  if (taskId && summary.taskId !== taskId) {
    return false;
  }

  const agentRunId = c.req.query("agentRunId");
  if (agentRunId && summary.agentRunId !== agentRunId) {
    return false;
  }

  const entryContext = c.req.query("entryContext");
  if (entryContext && summary.entryContext !== entryContext) {
    return false;
  }

  const status = c.req.query("status");
  if (status && summary.status !== status) {
    return false;
  }

  const riskLevel = c.req.query("riskLevel");
  if (riskLevel && summary.riskLevel !== riskLevel) {
    return false;
  }

  const agentType = c.req.query("agentType");
  if (agentType && summary.agentType !== agentType) {
    return false;
  }

  const model = c.req.query("model");
  if (model && summary.modelUsed !== model) {
    return false;
  }

  const approvalBlocked = parseBooleanQuery(c.req.query("approvalBlocked"));
  if (approvalBlocked !== undefined && isApprovalBlocked(summary) !== approvalBlocked) {
    return false;
  }

  const requiresIntervention = parseBooleanQuery(c.req.query("requiresIntervention"));
  if (requiresIntervention !== undefined && Boolean(summary.blockerType) !== requiresIntervention) {
    return false;
  }

  const search = normalizeQueryText(c.req.query("search"));
  if (search) {
    const haystack = [
      summary.agentRunId,
      summary.taskId,
      summary.taskTitle,
      summary.projectId,
      summary.projectName,
      summary.agentType,
      summary.status,
      summary.modelUsed,
      summary.blockerLabel,
      summary.resultSummary,
      summary.error,
      summary.longSummary,
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join("\n")
      .toLowerCase();
    if (!haystack.includes(search)) {
      return false;
    }
  }

  const fromMs = parseQueryTime(c.req.query("from"));
  const toMs = parseQueryTime(c.req.query("to"));
  if (fromMs != null || toMs != null) {
    const summaryMs = resolveSummaryTimeMs(summary);
    if (summaryMs == null) {
      return false;
    }
    if (fromMs != null && summaryMs < fromMs) {
      return false;
    }
    if (toMs != null && summaryMs > toMs) {
      return false;
    }
  }

  return true;
}

async function loadFilteredAgentRunSummaries(c: AgentOpsQueryContext) {
  const summaries = await loadPersistedAgentRunSummaries(c);
  return summaries.filter((summary) => matchesAgentOpsFilters(summary, c));
}

function computeRate(count: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.round((count / total) * 1000) / 10;
}

function computeAverage(numbers: number[]) {
  if (numbers.length === 0) {
    return null;
  }

  return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function buildRankingItems(
  summaries: AgentRunSummaryResponse[],
  keySelector: (summary: AgentRunSummaryResponse) => string,
) {
  const groups = new Map<
    string,
    {
      label: string;
      totalRuns: number;
      completedRuns: number;
      failedRuns: number;
      attentionCount: number;
      interventionCount: number;
      durationValues: number[];
      tokenValues: number[];
    }
  >();

  for (const summary of summaries) {
    const key = keySelector(summary) || "unknown";
    const current = groups.get(key) ?? {
      label: key,
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      attentionCount: 0,
      interventionCount: 0,
      durationValues: [],
      tokenValues: [],
    };
    current.totalRuns += 1;
    current.completedRuns += summary.status === "completed" ? 1 : 0;
    current.failedRuns += summary.status === "failed" ? 1 : 0;
    current.attentionCount += summary.blockerType ? 1 : 0;
    current.interventionCount += hasHumanIntervention(summary) ? 1 : 0;
    if (typeof summary.durationMs === "number" && Number.isFinite(summary.durationMs)) {
      current.durationValues.push(summary.durationMs);
    }
    if (typeof summary.tokenUsed === "number" && Number.isFinite(summary.tokenUsed)) {
      current.tokenValues.push(summary.tokenUsed);
    }
    groups.set(key, current);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      label: group.label,
      totalRuns: group.totalRuns,
      completedRuns: group.completedRuns,
      failedRuns: group.failedRuns,
      attentionCount: group.attentionCount,
      interventionCount: group.interventionCount,
      successRate: computeRate(group.completedRuns, group.totalRuns),
      failureRate: computeRate(group.failedRuns, group.totalRuns),
      avgDurationMs: computeAverage(group.durationValues),
      avgTokenUsed: computeAverage(group.tokenValues),
    }))
    .sort((left, right) => {
      if (right.totalRuns !== left.totalRuns) {
        return right.totalRuns - left.totalRuns;
      }
      if (right.attentionCount !== left.attentionCount) {
        return right.attentionCount - left.attentionCount;
      }
      return left.label.localeCompare(right.label);
    });
}

function buildBreakdownItems(items: Array<{ key: string; label: string }>, total: number) {
  const counts = new Map<string, { label: string; count: number }>();

  for (const item of items) {
    const current = counts.get(item.key) ?? { label: item.label, count: 0 };
    current.count += 1;
    counts.set(item.key, current);
  }

  return Array.from(counts.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
      share: computeRate(value.count, total),
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });
}

function floorBucketStart(timestampMs: number, bucketUnit: "hour" | "day") {
  const date = new Date(timestampMs);
  if (bucketUnit === "day") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours());
}

function formatBucketLabel(timestampMs: number, bucketUnit: "hour" | "day") {
  const iso = new Date(timestampMs).toISOString();
  return bucketUnit === "day" ? iso.slice(0, 10) : `${iso.slice(0, 13)}:00Z`;
}

function buildTimelineBuckets(summaries: AgentRunSummaryResponse[]) {
  const resolved = summaries
    .map((summary) => ({ summary, timestampMs: resolveSummaryTimeMs(summary) }))
    .filter(
      (entry): entry is { summary: AgentRunSummaryResponse; timestampMs: number } =>
        typeof entry.timestampMs === "number",
    );

  if (resolved.length === 0) {
    return {
      bucketUnit: "hour" as const,
      buckets: [],
    };
  }

  const timestamps = resolved.map((entry) => entry.timestampMs);
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const bucketUnit =
    maxTimestamp - minTimestamp > 48 * 60 * 60 * 1000 ? ("day" as const) : ("hour" as const);
  const bucketMs = bucketUnit === "day" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const start = floorBucketStart(minTimestamp, bucketUnit);
  const end = floorBucketStart(maxTimestamp, bucketUnit);
  const buckets = new Map<
    number,
    {
      bucket: string;
      label: string;
      totalRuns: number;
      completedRuns: number;
      failedRuns: number;
      attentionRuns: number;
      interventionRuns: number;
    }
  >();

  for (let bucketStart = start; bucketStart <= end; bucketStart += bucketMs) {
    buckets.set(bucketStart, {
      bucket: new Date(bucketStart).toISOString(),
      label: formatBucketLabel(bucketStart, bucketUnit),
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      attentionRuns: 0,
      interventionRuns: 0,
    });
  }

  for (const entry of resolved) {
    const bucketStart = floorBucketStart(entry.timestampMs, bucketUnit);
    const bucket = buckets.get(bucketStart);
    if (!bucket) {
      continue;
    }

    bucket.totalRuns += 1;
    bucket.completedRuns += entry.summary.status === "completed" ? 1 : 0;
    bucket.failedRuns += entry.summary.status === "failed" ? 1 : 0;
    bucket.attentionRuns += entry.summary.blockerType ? 1 : 0;
    bucket.interventionRuns += hasHumanIntervention(entry.summary) ? 1 : 0;
  }

  return {
    bucketUnit,
    buckets: Array.from(buckets.values()),
  };
}

function parseQueueName(value?: string): AgentOpsQueue {
  return value === "attention" || value === "running" || value === "recent" ? value : "recent";
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldIncludeSummaryInQueue(summary: AgentRunSummaryResponse, queue: AgentOpsQueue) {
  switch (queue) {
    case "attention":
      return Boolean(summary.blockerType);
    case "running":
      return summary.status === "running";
    case "recent":
    default:
      return true;
  }
}

function queueSortKey(summary: AgentRunSummaryResponse) {
  return (
    parseIsoMs(summary.lastActivityAt) ??
    parseIsoMs(summary.finishedAt) ??
    parseIsoMs(summary.startedAt) ??
    0
  );
}

// GET /api/agents — list persisted agent runs for the product console.
agentControlRoutes.get("/", async (c) => {
  const summaries = await loadPersistedAgentRunSummaries(c);
  return c.json(summaries.map(buildRegisteredRunFromSummary));
});

// GET /api/agents/overview
agentControlRoutes.get("/overview", async (c) => {
  const summaries = await loadFilteredAgentRunSummaries(c);
  const durationValues = summaries
    .map((summary) => summary.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const attentionCount = summaries.filter((summary) =>
    shouldIncludeSummaryInQueue(summary, "attention"),
  ).length;
  const runningCount = summaries.filter((summary) =>
    shouldIncludeSummaryInQueue(summary, "running"),
  ).length;
  const completedCount = summaries.filter((summary) => summary.status === "completed").length;
  const failedCount = summaries.filter((summary) => summary.status === "failed").length;
  const humanInterventionCount = summaries.filter((summary) =>
    hasHumanIntervention(summary),
  ).length;

  return c.json({
    viewScope: resolveViewScope(c),
    summary: {
      attentionCount,
      runningCount,
      completedCount,
      failureRate: computeRate(failedCount, summaries.length),
      avgDurationMs: computeAverage(durationValues),
      humanInterventionRate: computeRate(humanInterventionCount, summaries.length),
    },
    queueCounts: {
      attention: attentionCount,
      running: runningCount,
      recent: summaries.length,
    },
    blockerBreakdown: {
      failedHighRisk: summaries.filter(
        (summary) =>
          summary.status === "failed" &&
          (summary.riskLevel === "high" || summary.riskLevel === "critical"),
      ).length,
      approvalBlocked: summaries.filter((summary) => isApprovalBlocked(summary)).length,
      pausedAwaitingResume: summaries.filter((summary) => summary.status === "paused").length,
      stalled: summaries.filter((summary) => summary.blockerType === "stalled").length,
      stoppedPendingReview: summaries.filter((summary) => summary.status === "stopped").length,
    },
    generatedAt: new Date().toISOString(),
  });
});

// GET /api/agents/queues
agentControlRoutes.get("/queues", async (c) => {
  const queue = parseQueueName(c.req.query("queue"));
  const page = parsePositiveInt(c.req.query("page"), 1);
  const pageSize = Math.min(parsePositiveInt(c.req.query("pageSize"), 20), 100);
  const summaries = await loadFilteredAgentRunSummaries(c);

  const filtered = summaries
    .filter((summary) => shouldIncludeSummaryInQueue(summary, queue))
    .sort((left, right) => queueSortKey(right) - queueSortKey(left));
  const total = filtered.length;
  const startIndex = (page - 1) * pageSize;

  return c.json({
    data: filtered.slice(startIndex, startIndex + pageSize).map(buildAgentOpsQueueItem),
    page,
    pageSize,
    total,
  });
});

// GET /api/agents/analytics/health
agentControlRoutes.get("/analytics/health", async (c) => {
  const summaries = await loadFilteredAgentRunSummaries(c);
  const durationValues = summaries
    .map((summary) => summary.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const completedRuns = summaries.filter((summary) => summary.status === "completed").length;
  const failedRuns = summaries.filter((summary) => summary.status === "failed").length;
  const stoppedRuns = summaries.filter((summary) => summary.status === "stopped").length;
  const humanInterventionRuns = summaries.filter((summary) => hasHumanIntervention(summary)).length;
  const attentionRuns = summaries.filter((summary) => summary.blockerType != null).length;
  const approvalBlockedRuns = summaries.filter((summary) => isApprovalBlocked(summary)).length;

  return c.json({
    viewScope: resolveViewScope(c),
    generatedAt: new Date().toISOString(),
    totals: {
      totalRuns: summaries.length,
      completedRuns,
      failedRuns,
      stoppedRuns,
      humanInterventionRuns,
      attentionRuns,
      approvalBlockedRuns,
      avgDurationMs: computeAverage(durationValues),
      failureRate: computeRate(failedRuns, summaries.length),
      interventionRate: computeRate(humanInterventionRuns, summaries.length),
    },
    agentRanking: buildRankingItems(summaries, (summary) => summary.agentType || "unknown"),
    modelRanking: buildRankingItems(summaries, (summary) => summary.modelUsed || "unknown"),
  });
});

// GET /api/agents/analytics/failures
agentControlRoutes.get("/analytics/failures", async (c) => {
  const summaries = await loadFilteredAgentRunSummaries(c);
  const attentionSummaries = summaries.filter((summary) => summary.blockerType != null);

  return c.json({
    generatedAt: new Date().toISOString(),
    totalAttentionRuns: attentionSummaries.length,
    blockerBreakdown: buildBreakdownItems(
      attentionSummaries.map((summary) => ({
        key: summary.blockerType ?? "unknown",
        label: summary.blockerLabel || summary.blockerType || "未知阻塞",
      })),
      attentionSummaries.length,
    ),
    failureReasons: buildBreakdownItems(
      attentionSummaries.map((summary) => ({
        key: summary.error ?? summary.blockerLabel ?? "unknown",
        label: summary.error ?? summary.blockerLabel ?? "未知原因",
      })),
      attentionSummaries.length,
    ),
    riskBreakdown: buildBreakdownItems(
      attentionSummaries.map((summary) => ({
        key: summary.riskLevel ?? "unknown",
        label: summary.riskLevel ?? "unknown",
      })),
      attentionSummaries.length,
    ),
  });
});

// GET /api/agents/analytics/timeline
agentControlRoutes.get("/analytics/timeline", async (c) => {
  const summaries = await loadFilteredAgentRunSummaries(c);
  const timeline = buildTimelineBuckets(summaries);

  return c.json({
    generatedAt: new Date().toISOString(),
    bucketUnit: timeline.bucketUnit,
    buckets: timeline.buckets,
  });
});

// GET /api/agents/:agentRunId/summary
agentControlRoutes.get("/:agentRunId/summary", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const summary = await loadAgentRunSummaryResponse(c, agentRunId);

  if (!summary.ok) {
    return c.json({ error: summary.error }, summary.status === 404 ? 404 : 502);
  }

  return c.json(summary.summary);
});

// POST /api/agents/:agentRunId/pause
agentControlRoutes.post("/:agentRunId/pause", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  let run = await ensureRuntimeRunFromSummary(c, agentRunId);
  const result = await pauseAgent(agentRunId);

  if (result.ok) {
    run = getAgentRun(agentRunId) ?? run;
    if (run?.taskId) {
      await Promise.all([
        patchAgentRunRecord({
          taskId: run.taskId,
          agentRunId,
          status: "paused",
          model: run.model,
        }),
        recordAgentAudit({
          projectId: run.projectId,
          taskId: run.taskId,
          sessionId: run.subSessionId,
          agentRunId,
          eventType: "agent",
          action: "paused",
          detail: { agentRunId },
          riskLevel: "medium",
        }),
      ]);
      await syncPausedTaskPhaseForRun(c, run).catch(() => undefined);
    }
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.paused",
      ts: new Date().toISOString(),
      agentRunId,
      sessionId: run?.subSessionId,
      taskId: run?.taskId,
      projectId: run?.projectId,
      data: { agentRunId },
    });
  }

  return c.json(result, result.ok ? 200 : 400);
});

// POST /api/agents/:agentRunId/resume
agentControlRoutes.post("/:agentRunId/resume", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const run = await ensureRuntimeRunFromSummary(c, agentRunId);

  // Run pre-resume hooks before the actual resume
  if (run?.taskId) {
    const preResume = await runPreResumeHooks(run.taskId, run.projectId, agentRunId);
    if (!preResume.ok) {
      return c.json({ ok: false, error: preResume.error }, preResume.status || 400);
    }
  }

  const result = await resumeAgent(agentRunId);

  if (result.ok) {
    const currentRun = getAgentRun(agentRunId) ?? run;
    if (currentRun?.taskId) {
      await Promise.all([
        patchAgentRunRecord({
          taskId: currentRun.taskId,
          agentRunId,
          status: "running",
          model: currentRun.model,
        }),
        recordAgentAudit({
          projectId: currentRun.projectId,
          taskId: currentRun.taskId,
          sessionId: currentRun.subSessionId,
          agentRunId,
          eventType: "agent",
          action: "resumed",
          detail: { agentRunId },
          riskLevel: "low",
        }),
      ]);
      await syncResumedTaskPhaseForRun(c, currentRun).catch(() => undefined);
    }
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.resumed",
      ts: new Date().toISOString(),
      agentRunId,
      sessionId: currentRun?.subSessionId,
      taskId: currentRun?.taskId,
      projectId: currentRun?.projectId,
      data: { agentRunId },
    });
  }

  return c.json(result, result.ok ? 200 : 400);
});

// POST /api/agents/:agentRunId/guidance
const guidanceSchema = z.object({
  content: z.string().min(1).max(5000),
  mode: z.enum(["reply", "noReply"]).default("reply"),
});

agentControlRoutes.post("/:agentRunId/guidance", zValidator("json", guidanceSchema), async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const { content, mode } = c.req.valid("json");
  let run = await ensureRuntimeRunFromSummary(c, agentRunId);
  const result = await injectGuidance(agentRunId, content, mode);

  if (result.ok) {
    run = getAgentRun(agentRunId) ?? run;
    if (run?.taskId) {
      await recordAgentAudit({
        projectId: run.projectId,
        taskId: run.taskId,
        sessionId: run.subSessionId,
        agentRunId,
        eventType: "guidance",
        action: mode === "noReply" ? "injected_no_reply" : "injected",
        detail: { agentRunId, content, mode },
        riskLevel: "low",
      });
    }
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "guidance.injected",
      ts: new Date().toISOString(),
      agentRunId,
      sessionId: run?.subSessionId,
      taskId: run?.taskId,
      projectId: run?.projectId,
      data: { agentRunId, content, mode },
    });
  }

  return c.json(result, result.ok ? 200 : 400);
});

// POST /api/agents/:agentRunId/terminate
agentControlRoutes.post("/:agentRunId/terminate", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const authorization = authHeader(c);
  const recovery = await ensureRuntimeRunFromSummaryDetailed(c, agentRunId);
  let run = recovery.run;

  if (!run && recovery.failure) {
    return c.json(
      {
        ok: false,
        error: recovery.failure.error,
        code: recovery.failure.code,
      },
      recovery.failure.status,
    );
  }

  const previousStatus = run?.status;
  if (previousStatus && previousStatus !== "stopped") {
    updateAgentRunStatus(agentRunId, "stopped");
  }

  const result = await terminateAgent(agentRunId);

  if (!result.ok && previousStatus && previousStatus !== "stopped") {
    updateAgentRunStatus(agentRunId, previousStatus);
  }

  if (result.ok) {
    run = getAgentRun(agentRunId) ?? run;
    const tokenUsed = await loadSessionTokenUsage(run?.subSessionId, run?.taskId, authorization);
    const finishedAt = new Date().toISOString();
    if (run?.taskId) {
      await Promise.all([
        patchAgentRunRecord({
          taskId: run.taskId,
          agentRunId,
          status: "stopped",
          model: run.model,
          tokenUsed,
          finishedAt,
        }),
        recordAgentAudit({
          projectId: run.projectId,
          taskId: run.taskId,
          sessionId: run.subSessionId,
          agentRunId,
          eventType: "agent",
          action: "stopped",
          detail: { agentRunId, reason: "terminated" },
          riskLevel: "high",
        }),
        finalizeTaskState({
          authorization,
          taskId: run.taskId,
          status: "cancelled",
          sessionId: run.subSessionId,
          agentRunId,
          task: {
            id: run.taskId,
            status: "running",
            sessionId: run.subSessionId,
            agentRunId,
          },
        }),
      ]);
    }
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.stopped",
      ts: new Date().toISOString(),
      agentRunId,
      sessionId: run?.subSessionId,
      taskId: run?.taskId,
      projectId: run?.projectId,
      data: { agentRunId, reason: "terminated" },
    });
  }

  return c.json(result, result.ok ? 200 : 400);
});

// GET /api/agents/:agentRunId/messages
agentControlRoutes.get("/:agentRunId/messages", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  await ensureRuntimeRunFromSummary(c, agentRunId);
  const result = await getAgentMessages(agentRunId);
  return c.json(result, result.ok ? 200 : 400);
});

// GET /api/agents/:agentRunId/status
agentControlRoutes.get("/:agentRunId/status", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const run = (await ensureRuntimeRunFromSummary(c, agentRunId)) ?? getAgentRun(agentRunId);
  if (!run) return c.json({ error: "Agent run not found" }, 404);
  return c.json(run);
});

// ── Pre-resume Hook Runner ─────────────────────────────────────────

async function runPreResumeHooks(
  taskId: string,
  _projectId: string,
  agentRunId: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: 400 | 409 }> {
  const strategyConfig = readOrchestrationStrategy();
  let breakerReason: string | undefined;

  const authorization = await createInternalAuthorization();
  const taskResult = await cpFetch<{
    id: string;
    title: string;
    prompt: string;
    projectId: string;
    strategy?: string | null;
  }>(`/api/project-tree/tasks/${encodeURIComponent(taskId)}`, { authorization });
  if (!taskResult.ok) {
    return { ok: false, error: `Failed to load task ${taskId} before resume` };
  }

  const task = taskResult.data;
  const hookResult = await executeLifecycleHooks({
    strategy: strategyConfig,
    trigger: "pre-resume",
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    titlePrefix: "pre-resume",
    context: {
      taskId: task.id,
      projectId: task.projectId,
      taskTitle: task.title,
      taskPrompt: task.prompt,
      agentRunId,
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
        agentRunId,
        modelRoute: execution.model,
        tokenUsed: execution.tokenUsed,
        requestDelta: 1,
        action: "pre_resume_usage_recorded",
        runtimeLedger: {
          executionSource: "task-pre-resume-hook",
          entrypointType: "hook-only",
          hookRequestCountDelta: 1,
          status: execution.status === "failed" ? "failed" : "completed",
          finishedAt: execution.completedAt,
          step: {
            stepType: "resume",
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
          outcome.breakerReason || "paid execution breaker tripped during pre-resume hooks";
        return {
          stop: true,
          reason: breakerReason,
        };
      }
    },
  });

  if (breakerReason) {
    return { ok: false, error: breakerReason, status: 409 };
  }

  if (hookResult.rewrittenPrompt) {
    const guidanceResult = await injectGuidance(
      agentRunId,
      [
        "Pre-resume hook updated the execution instructions.",
        "Apply the following revised guidance when continuing the task:",
        hookResult.rewrittenPrompt,
      ].join("\n\n"),
      "noReply",
    );
    if (!guidanceResult.ok) {
      return {
        ok: false,
        error: guidanceResult.error || "Failed to inject pre-resume guidance",
      };
    }
  }

  if (hookResult.hookExecutions.length > 0) {
    await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      authorization,
      body: {
        strategy: mergeTaskStrategy(task.strategy, {
          hookExecutions: hookResult.hookExecutions,
        }),
      },
    });
  }

  return { ok: true };
}
