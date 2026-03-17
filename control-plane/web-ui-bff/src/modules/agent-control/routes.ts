import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { authHeader, cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import { recordPaidExecutionRuntimeUsage } from "../../lib/paid-execution-runtime";
import { mergeTaskStrategy, readOrchestrationStrategy } from "../../lib/orchestration-strategy";
import { executeLifecycleHooks } from "../hooks/lifecycle-hooks";
import { wsBroadcaster } from "../realtime/ws-broadcaster";
import {
  extractAssistantResultFromMessages,
  getAgentMessages,
  getAgentRun,
  getSessionMessages,
  injectGuidance,
  listAgentRuns,
  pauseAgent,
  resumeAgent,
  terminateAgent,
  updateAgentRunStatus,
} from "./opencode-adapter";
import { patchAgentRunRecord, recordAgentAudit } from "./run-persistence";

export const agentControlRoutes = new Hono();

type RuntimeRun = ReturnType<typeof listAgentRuns>[number];

interface AgentOverviewResponse {
  viewScope?: "mine" | "project" | "global";
  summary: {
    attentionCount: number;
    runningCount: number;
    completedCount: number;
    failureRate: number;
    avgDurationMs: number | null;
    humanInterventionRate: number;
  };
  queueCounts: {
    attention: number;
    running: number;
    recent: number;
  };
  blockerBreakdown?: {
    failedHighRisk: number;
    approvalBlocked: number;
    pausedAwaitingResume: number;
    stalled: number;
    stoppedPendingReview: number;
  };
  generatedAt: string;
}

interface AgentQueueItem {
  agentRunId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string | null;
  agentType: string;
  status: string;
  sessionId?: string | null;
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
}

interface AgentQueueResponse {
  data: AgentQueueItem[];
  page: number;
  pageSize: number;
  total: number;
}

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

interface AgentAnalyticsRankingItem {
  key: string;
  label: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  attentionCount: number;
  interventionCount: number;
  successRate: number;
  failureRate: number;
  avgDurationMs: number | null;
  avgTokenUsed: number | null;
}

interface AgentAnalyticsHealthResponse {
  viewScope?: "mine" | "project" | "global";
  generatedAt: string;
  totals: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    stoppedRuns: number;
    humanInterventionRuns: number;
    attentionRuns: number;
    approvalBlockedRuns: number;
    avgDurationMs: number | null;
    failureRate: number;
    interventionRate: number;
  };
  agentRanking: AgentAnalyticsRankingItem[];
  modelRanking: AgentAnalyticsRankingItem[];
}

interface AgentAnalyticsBreakdownItem {
  key: string;
  label: string;
  count: number;
  share: number;
}

interface AgentAnalyticsFailuresResponse {
  generatedAt: string;
  totalAttentionRuns: number;
  blockerBreakdown: AgentAnalyticsBreakdownItem[];
  failureReasons: AgentAnalyticsBreakdownItem[];
  riskBreakdown: AgentAnalyticsBreakdownItem[];
}

interface AgentAnalyticsTimelineResponse {
  generatedAt: string;
  bucketUnit: "hour" | "day";
  buckets: Array<{
    bucket: string;
    label: string;
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    attentionRuns: number;
    interventionRuns: number;
  }>;
}

type PersistedRunStatus = Parameters<typeof patchAgentRunRecord>[0]["status"];

function buildForwardedQuery(c: { req: { query: (name: string) => string | undefined } }, keys: string[]) {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = c.req.query(key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function runtimeTimestampToIso(value?: number | string | null) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const ts = Date.parse(value);
    if (Number.isFinite(ts)) return new Date(ts).toISOString();
  }
  return null;
}

function shouldPreferPersistedStatus(persistedStatus: string, runtimeStatus: string) {
  return runtimeStatus === "running" && persistedStatus !== "running";
}

function resolveMergedStatus(persistedStatus: string, runtimeStatus: string) {
  return shouldPreferPersistedStatus(persistedStatus, runtimeStatus)
    ? persistedStatus
    : runtimeStatus;
}

function maybeResyncRuntimeStatus(agentRunId: string, persistedStatus: string, runtimeRun?: RuntimeRun) {
  if (!runtimeRun || !shouldPreferPersistedStatus(persistedStatus, runtimeRun.status)) {
    return runtimeRun;
  }

  const synced = updateAgentRunStatus(agentRunId, persistedStatus as RuntimeRun["status"]);
  return synced ?? runtimeRun;
}

function mergeQueueItemWithRuntime(item: AgentQueueItem, runtimeRun?: RuntimeRun): AgentQueueItem {
  const effectiveRuntimeRun = maybeResyncRuntimeStatus(item.agentRunId, item.status, runtimeRun);
  if (!effectiveRuntimeRun) return item;
  return {
    ...item,
    status: resolveMergedStatus(item.status, effectiveRuntimeRun.status),
    agentType: effectiveRuntimeRun.model ? `${item.agentType}` : item.agentType,
    startedAt: item.startedAt || runtimeTimestampToIso(effectiveRuntimeRun.startedAt),
    lastActivityAt:
      runtimeTimestampToIso(effectiveRuntimeRun.pausedAt) ||
      runtimeTimestampToIso(effectiveRuntimeRun.finishedAt) ||
      item.lastActivityAt ||
      runtimeTimestampToIso(effectiveRuntimeRun.startedAt),
  };
}

function mergeSummaryWithRuntime(summary: AgentRunSummaryResponse, runtimeRun?: RuntimeRun) {
  const effectiveRuntimeRun = maybeResyncRuntimeStatus(summary.agentRunId, summary.status, runtimeRun);
  if (!effectiveRuntimeRun) return summary;
  return {
    ...summary,
    status: resolveMergedStatus(summary.status, effectiveRuntimeRun.status),
    startedAt: summary.startedAt || runtimeTimestampToIso(effectiveRuntimeRun.startedAt),
    finishedAt: summary.finishedAt || runtimeTimestampToIso(effectiveRuntimeRun.finishedAt),
    lastActivityAt:
      runtimeTimestampToIso(effectiveRuntimeRun.pausedAt) ||
      runtimeTimestampToIso(effectiveRuntimeRun.finishedAt) ||
      summary.lastActivityAt ||
      runtimeTimestampToIso(effectiveRuntimeRun.startedAt),
    subSessionId: effectiveRuntimeRun.subSessionId,
  };
}

async function loadSessionTokenUsage(sessionId?: string | null): Promise<number> {
  if (!sessionId) {
    return 0;
  }

  const messagesResult = await getSessionMessages(sessionId);
  if (!messagesResult.ok) {
    return 0;
  }

  return extractAssistantResultFromMessages(messagesResult.data).tokenUsed;
}

async function maybeBackfillTokenUsage(input: {
  agentRunId: string;
  taskId: string;
  sessionId?: string | null;
  status: string;
  tokenUsed: number;
}) {
  if (input.tokenUsed > 0 || !input.sessionId) {
    return input.tokenUsed;
  }

  const tokenUsed = await loadSessionTokenUsage(input.sessionId);
  if (tokenUsed <= 0) {
    return input.tokenUsed;
  }

  await patchAgentRunRecord({
    taskId: input.taskId,
    agentRunId: input.agentRunId,
    status: input.status as PersistedRunStatus,
    tokenUsed,
  });

  return tokenUsed;
}

async function buildRuntimeOnlySummary(c: { req: { header: (name: string) => string | undefined } }, runtimeRun: RuntimeRun) {
  const taskResult = await cpFetch<{ id: string; title: string; projectId: string }>(
    `/api/tasks/${encodeURIComponent(runtimeRun.taskId)}`,
    { authorization: authHeader(c) },
  );
  return {
    agentRunId: runtimeRun.agentRunId,
    taskId: runtimeRun.taskId,
    taskTitle: taskResult.ok ? taskResult.data.title : runtimeRun.taskId,
    projectId: taskResult.ok ? taskResult.data.projectId : runtimeRun.projectId,
    projectName: null,
    agentType: "Agent",
    status: runtimeRun.status,
    sessionId: runtimeRun.subSessionId,
    modelUsed: runtimeRun.model ? `${runtimeRun.model.providerId}:${runtimeRun.model.modelId}` : null,
    startedAt: runtimeTimestampToIso(runtimeRun.startedAt),
    finishedAt: runtimeTimestampToIso(runtimeRun.finishedAt),
    lastActivityAt:
      runtimeTimestampToIso(runtimeRun.pausedAt) ||
      runtimeTimestampToIso(runtimeRun.finishedAt) ||
      runtimeTimestampToIso(runtimeRun.startedAt),
    durationMs: null,
    tokenUsed: 0,
    blockerType: runtimeRun.status === "paused" ? "manual_resume" : runtimeRun.status === "running" ? null : runtimeRun.status,
    blockerLabel:
      runtimeRun.status === "paused"
        ? "等待人工恢复"
        : runtimeRun.status === "running"
          ? "推进中"
          : runtimeRun.status,
    riskLevel: null,
    guidanceCount: 0,
    resultSummary: null,
    result: null,
    error: null,
    longSummary: "该实例当前仅存在于 BFF 运行时注册表中，聚合视图尚未持久化完整摘要。",
    latestEvents: [],
    subSessionId: runtimeRun.subSessionId,
  } satisfies AgentRunSummaryResponse;
}

// GET /api/agents/overview — aggregated overview for agent ops dashboard
agentControlRoutes.get("/overview", async (c) => {
  const query = buildForwardedQuery(c, [
    "projectId",
    "taskId",
    "agentRunId",
    "from",
    "to",
    "ownerScope",
    "status",
    "search",
    "riskLevel",
    "approvalBlocked",
    "requiresIntervention",
    "agentType",
    "model",
    "entryContext",
  ]);
  const result = await cpFetch<AgentOverviewResponse>(`/api/agent-runs/overview${query}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 502));
});

// GET /api/agents/queues — aggregated queues for attention/running/recent
agentControlRoutes.get("/queues", async (c) => {
  const query = buildForwardedQuery(c, [
    "queue",
    "projectId",
    "taskId",
    "agentRunId",
    "from",
    "to",
    "ownerScope",
    "page",
    "pageSize",
    "status",
    "search",
    "riskLevel",
    "approvalBlocked",
    "requiresIntervention",
    "agentType",
    "model",
    "entryContext",
  ]);
  const result = await cpFetch<AgentQueueResponse>(`/api/agent-runs/queues${query}`, {
    authorization: authHeader(c),
  });
  if (!result.ok) {
    return c.json(result.data, result.status as 401 | 403 | 502);
  }

  const runtimeMap = new Map(listAgentRuns().map((run) => [run.agentRunId, run]));
  const data = await Promise.all(
    result.data.data.map(async (item) => {
      const tokenUsed = await maybeBackfillTokenUsage({
        agentRunId: item.agentRunId,
        taskId: item.taskId,
        sessionId: item.sessionId,
        status: item.status,
        tokenUsed: item.tokenUsed,
      });
      return mergeQueueItemWithRuntime({ ...item, tokenUsed }, runtimeMap.get(item.agentRunId));
    }),
  );
  return c.json({ ...result.data, data });
});

// GET /api/agents/:agentRunId/summary — aggregated drawer summary for single agent run
agentControlRoutes.get("/:agentRunId/summary", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const query = buildForwardedQuery(c, ["entryContext", "ownerScope"]);
  const result = await cpFetch<AgentRunSummaryResponse>(
    `/api/agent-runs/${encodeURIComponent(agentRunId)}/summary${query}`,
    {
      authorization: authHeader(c),
    },
  );
  const runtimeRun = getAgentRun(agentRunId);

  if (!result.ok) {
    if (result.status === 404 && runtimeRun) {
      const fallback = await buildRuntimeOnlySummary(c, { agentRunId, ...runtimeRun });
      const tokenUsed = await loadSessionTokenUsage(fallback.sessionId);
      return c.json({ ...fallback, tokenUsed: tokenUsed || fallback.tokenUsed }, 200);
    }
    return c.json(result.data, result.status as 401 | 403 | 404 | 502);
  }

  const summary = mergeSummaryWithRuntime(result.data, runtimeRun ? { agentRunId, ...runtimeRun } : undefined);
  const tokenUsed = await maybeBackfillTokenUsage({
    agentRunId: summary.agentRunId,
    taskId: summary.taskId,
    sessionId: summary.sessionId,
    status: summary.status,
    tokenUsed: summary.tokenUsed,
  });
  return c.json({ ...summary, tokenUsed });
});

agentControlRoutes.get("/analytics/health", async (c) => {
  const query = buildForwardedQuery(c, [
    "projectId",
    "taskId",
    "agentRunId",
    "from",
    "to",
    "ownerScope",
    "status",
    "search",
    "riskLevel",
    "approvalBlocked",
    "requiresIntervention",
    "agentType",
    "model",
    "entryContext",
  ]);
  const result = await cpFetch<AgentAnalyticsHealthResponse>(`/api/agent-runs/analytics/health${query}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 502));
});

agentControlRoutes.get("/analytics/failures", async (c) => {
  const query = buildForwardedQuery(c, [
    "projectId",
    "taskId",
    "agentRunId",
    "from",
    "to",
    "ownerScope",
    "status",
    "search",
    "riskLevel",
    "approvalBlocked",
    "requiresIntervention",
    "agentType",
    "model",
    "entryContext",
  ]);
  const result = await cpFetch<AgentAnalyticsFailuresResponse>(`/api/agent-runs/analytics/failures${query}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 502));
});

agentControlRoutes.get("/analytics/timeline", async (c) => {
  const query = buildForwardedQuery(c, [
    "projectId",
    "taskId",
    "agentRunId",
    "from",
    "to",
    "ownerScope",
    "status",
    "search",
    "riskLevel",
    "approvalBlocked",
    "requiresIntervention",
    "agentType",
    "model",
    "entryContext",
  ]);
  const result = await cpFetch<AgentAnalyticsTimelineResponse>(`/api/agent-runs/analytics/timeline${query}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 403 | 502));
});

// GET /api/agents — list all registered agent runs
agentControlRoutes.get("/", (c) => {
  const runs = listAgentRuns();
  return c.json(runs);
});

// POST /api/agents/:agentRunId/pause
agentControlRoutes.post("/:agentRunId/pause", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const result = await pauseAgent(agentRunId);

  if (result.ok) {
    const run = getAgentRun(agentRunId);
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

  // Run pre-resume hooks before the actual resume
  const run = getAgentRun(agentRunId);
  if (run?.taskId) {
    const preResume = await runPreResumeHooks(run.taskId, run.projectId, agentRunId);
    if (!preResume.ok) {
      return c.json({ ok: false, error: preResume.error }, preResume.status || 400);
    }
  }

  const result = await resumeAgent(agentRunId);

  if (result.ok) {
    const currentRun = getAgentRun(agentRunId);
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
  const result = await injectGuidance(agentRunId, content, mode);

  if (result.ok) {
    const run = getAgentRun(agentRunId);
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
  const result = await terminateAgent(agentRunId);

  if (result.ok) {
    const run = getAgentRun(agentRunId);
    const tokenUsed = await loadSessionTokenUsage(run?.subSessionId);
    if (run?.taskId) {
      await Promise.all([
        patchAgentRunRecord({
          taskId: run.taskId,
          agentRunId,
          status: "stopped",
          model: run.model,
          tokenUsed,
          finishedAt: new Date().toISOString(),
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
  const result = await getAgentMessages(agentRunId);
  return c.json(result, result.ok ? 200 : 400);
});

// GET /api/agents/:agentRunId/status
agentControlRoutes.get("/:agentRunId/status", async (c) => {
  const agentRunId = c.req.param("agentRunId");
  const run = getAgentRun(agentRunId);
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
  }>(`/api/tasks/${encodeURIComponent(taskId)}`, { authorization });
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
      if (!execution.sessionId || !execution.model || !execution.tokenUsed || execution.tokenUsed <= 0) {
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
            status: execution.status === "failed" ? "failed" : execution.status === "skipped" ? "skipped" : "completed",
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
        breakerReason = outcome.breakerReason || "paid execution breaker tripped during pre-resume hooks";
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
