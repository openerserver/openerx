import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { authHeader, cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import { mergeTaskStrategy, readOrchestrationStrategy } from "../../lib/orchestration-strategy";
import { recordPaidExecutionRuntimeUsage } from "../../lib/paid-execution-runtime";
import { executeLifecycleHooks } from "../hooks/lifecycle-hooks";
import { wsBroadcaster } from "../realtime/ws-broadcaster";
import { finalizeTaskState } from "../tasks/finalize";
import {
  getAgentRun,
  listAgentRuns,
  recoverAgentRun,
  updateAgentRunStatus,
} from "./agent-run-registry";
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

type RuntimeRun = ReturnType<typeof listAgentRuns>[number];
type AgentOpsQueue = "attention" | "running" | "recent";

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
  const sessionId = typeof summary.sessionId === "string" ? summary.sessionId : null;
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
    typeof summary.lastActivityAt === "string"
      ? summary.lastActivityAt
      : finishedAt ?? startedAt;
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
    subSessionId: typeof summary.subSessionId === "string" ? summary.subSessionId : undefined,
  };
}

function buildRuntimeFallbackSummary(agentRunId: string, run: RuntimeRun): AgentRunSummaryResponse {
  const startedAt = new Date(run.startedAt).toISOString();
  const finishedAt = typeof run.finishedAt === "string" ? run.finishedAt : null;
  const lastActivityAt =
    typeof run.lastPromptAt === "number"
      ? new Date(run.lastPromptAt).toISOString()
      : finishedAt ?? startedAt;
  const blockerState = normalizeBlockerState(run.status, null, null);

  return {
    agentRunId,
    taskId: run.taskId,
    taskTitle: run.taskId,
    projectId: run.projectId,
    projectName: null,
    agentType: "agent",
    status: run.status,
    sessionId: run.subSessionId,
    modelUsed: run.model ? `${run.model.providerId}:${run.model.modelId}` : null,
    startedAt,
    finishedAt,
    lastActivityAt,
    durationMs: resolveDurationMs(startedAt, finishedAt, null),
    tokenUsed: 0,
    blockerType: blockerState.blockerType,
    blockerLabel: blockerState.blockerLabel,
    riskLevel: null,
    guidanceCount: 0,
    resultSummary: null,
    result: null,
    error: null,
    longSummary: null,
    latestEvents: [],
    actionPermissions: {
      canPause: run.status === "running",
      canResume: run.status === "paused",
      canTerminate: run.status === "running" || run.status === "paused",
      canInjectGuidance: true,
      canViewApproval: false,
      canViewAudit: false,
      canViewCodeChanges: false,
      canExport: false,
    },
    governance: null,
    codeChanges: null,
    subSessionId: run.subSessionId,
  };
}

function statusFreshnessRank(status: string) {
  switch (status) {
    case "paused":
      return 1;
    case "completed":
    case "failed":
    case "stopped":
      return 2;
    case "running":
    default:
      return 0;
  }
}

function shouldPreferRuntimeSummary(persistedStatus: string, runtimeStatus: string) {
  return statusFreshnessRank(runtimeStatus) > statusFreshnessRank(persistedStatus);
}

function mergeSummaryWithRuntime(
  agentRunId: string,
  persistedSummary: AgentRunSummaryResponse,
  runtimeRun?: RuntimeRun,
): AgentRunSummaryResponse {
  if (!runtimeRun || !shouldPreferRuntimeSummary(persistedSummary.status, runtimeRun.status)) {
    return persistedSummary;
  }

  const runtimeSummary = buildRuntimeFallbackSummary(agentRunId, runtimeRun);
  const startedAt = persistedSummary.startedAt ?? runtimeSummary.startedAt;
  const finishedAt = runtimeSummary.finishedAt ?? persistedSummary.finishedAt;
  const lastActivityAt =
    runtimeSummary.lastActivityAt ?? finishedAt ?? persistedSummary.lastActivityAt;

  return {
    ...persistedSummary,
    status: runtimeSummary.status,
    sessionId: persistedSummary.sessionId ?? runtimeSummary.sessionId,
    modelUsed: persistedSummary.modelUsed ?? runtimeSummary.modelUsed,
    startedAt,
    finishedAt,
    lastActivityAt,
    durationMs: resolveDurationMs(startedAt, finishedAt, persistedSummary.durationMs),
    blockerType: runtimeSummary.blockerType,
    blockerLabel: runtimeSummary.blockerLabel,
    actionPermissions: runtimeSummary.actionPermissions ?? persistedSummary.actionPermissions,
    subSessionId: persistedSummary.subSessionId ?? runtimeSummary.subSessionId,
  };
}

async function loadAgentRunSummaryResponse(
  c: Parameters<typeof authHeader>[0],
  agentRunId: string,
): Promise<
  | { ok: true; summary: AgentRunSummaryResponse }
  | { ok: false; status: number; error: string }
> {
  const summaryResult = await cpFetch<Partial<AgentRunSummaryResponse>>(
    `/api/agent-runs/${encodeURIComponent(agentRunId)}/summary`,
    { authorization: authHeader(c) },
  );
  if (summaryResult.ok) {
    const normalizedSummary = normalizeAgentRunSummary(agentRunId, summaryResult.data);
    const runtimeRun = (await ensureRuntimeRunFromSummary(c, agentRunId)) ?? getAgentRun(agentRunId);
    return {
      ok: true,
      summary: mergeSummaryWithRuntime(agentRunId, normalizedSummary, runtimeRun),
    };
  }

  const runtimeRun = (await ensureRuntimeRunFromSummary(c, agentRunId)) ?? getAgentRun(agentRunId);
  if (runtimeRun) {
    return {
      ok: true,
      summary: buildRuntimeFallbackSummary(agentRunId, runtimeRun),
    };
  }

  return {
    ok: false,
    status: summaryResult.status,
    error: readErrorMessage(
      summaryResult.data,
      summaryResult.status === 404
        ? "Agent run not found"
        : "Failed to load agent run summary",
    ),
  };
}

function buildAgentOpsQueueItem(summary: AgentRunSummaryResponse): AgentOpsQueueItemResponse {
  return {
    agentRunId: summary.agentRunId,
    taskId: summary.taskId,
    taskTitle: summary.taskTitle,
    projectId: summary.projectId,
    projectName: summary.projectName,
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

function parseQueueName(value?: string): AgentOpsQueue {
  return value === "attention" || value === "running" || value === "recent"
    ? value
    : "recent";
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
    parseIsoMs(summary.lastActivityAt) ?? parseIsoMs(summary.finishedAt) ?? parseIsoMs(summary.startedAt) ?? 0
  );
}

// GET /api/agents — list all registered agent runs
agentControlRoutes.get("/", (c) => {
  const runs = listAgentRuns();
  return c.json(runs);
});

// GET /api/agents/queues
agentControlRoutes.get("/queues", async (c) => {
  const queue = parseQueueName(c.req.query("queue"));
  const page = parsePositiveInt(c.req.query("page"), 1);
  const pageSize = Math.min(parsePositiveInt(c.req.query("pageSize"), 20), 100);
  const runs = listAgentRuns();

  const summaries = await Promise.all(
    runs.map(async (run) => {
      const loaded = await loadAgentRunSummaryResponse(c, run.agentRunId);
      return loaded.ok ? loaded.summary : buildRuntimeFallbackSummary(run.agentRunId, run);
    }),
  );

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
    }
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.paused",
      ts: new Date().toISOString(),
      agentRunId,
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
    }
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "agent.resumed",
      ts: new Date().toISOString(),
      agentRunId,
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
