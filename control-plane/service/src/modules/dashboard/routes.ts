import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db";
import {
  auditEvents,
  paidExecutionLeases,
  projects,
  runtimeUsageLedgers,
  taskSessions,
  taskSnapshots,
  taskTimelineViews,
  tasks,
} from "../../db/schema";
import { type AppEnv, type JWTPayload, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { fromStoredTaskExecutionMode } from "../tasks/task-execution-mode";

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.use("*", authMiddleware);
dashboardRoutes.use("*", requireRole("developer"));

type Role = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";
type DashboardRange = "24h" | "7d" | "30d" | "monthly";
type AgentRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped"
  | "terminated";
type ProviderHealth = "healthy" | "warn" | "risk";

const ROLE_HIERARCHY: Record<Role, number> = {
  platform_admin: 5,
  org_admin: 4,
  project_admin: 3,
  developer: 2,
  viewer: 1,
};

const DASHBOARD_RANGES: DashboardRange[] = ["24h", "7d", "30d", "monthly"];

interface RunRecord {
  agentRunId: string;
  taskId: string;
  projectId: string;
  status: AgentRunStatus;
  modelUsed: string | null;
  tokenUsed: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface ProviderBucket {
  bucket: string;
  tokenUsed: number;
  completedRuns: number;
}

interface ProviderMonthlyBucket {
  month: string;
  tokenUsed: number;
  completedRuns: number;
  failureRate: number;
  interventionRate: number;
  avgTokensPerCompletedRun: number;
}

interface ModelReference {
  providerId: string;
  modelId: string;
  route: string;
}

interface ModelAggregate {
  route: string;
  modelId: string;
  label: string;
  tokenUsed: number;
  completedRuns: number;
  failedRuns: number;
  stoppedRuns: number;
  interventionRuns: number;
  totalRuns: number;
  latestRunAtMs: number | null;
}

interface ProviderAggregate {
  providerId: string;
  label: string;
  tokenUsed: number;
  completedRuns: number;
  failedRuns: number;
  stoppedRuns: number;
  interventionRuns: number;
  totalRuns: number;
  latestRunAtMs: number | null;
  trend: Map<string, { tokenUsed: number; completedRuns: number }>;
  monthly: Map<
    string,
    {
      tokenUsed: number;
      completedRuns: number;
      failedRuns: number;
      interventionRuns: number;
      totalRuns: number;
    }
  >;
  models: Map<string, ModelAggregate>;
}

interface ProviderModelResponseItem {
  route: string;
  modelId: string;
  label: string;
  tokenUsed: number;
  requestCount: number;
  tokenShareWithinProvider: number;
  completedRuns: number;
  failedRuns: number;
  stoppedRuns: number;
  interventionRuns: number;
  totalRuns: number;
  failureRate: number;
  interventionRate: number;
  avgTokensPerRun: number;
  avgTokensPerCompletedRun: number;
  latestRunAt: string | null;
}

interface ProviderResponseItem {
  providerId: string;
  label: string;
  tokenUsed: number;
  requestCount: number;
  tokenShare: number;
  completedRuns: number;
  failedRuns: number;
  stoppedRuns: number;
  interventionRuns: number;
  totalRuns: number;
  failureRate: number;
  interventionRate: number;
  avgTokensPerRun: number;
  avgTokensPerCompletedRun: number;
  latestRunAt: string | null;
  trend: ProviderBucket[];
  monthly: ProviderMonthlyBucket[];
  health: ProviderHealth;
  reasons: string[];
  recommendationAction: "keep" | "observe" | "downgrade";
  recommendationLabel: string;
  recommendationMessage: string;
  models: ProviderModelResponseItem[];
}

interface SummaryResponse {
  range: DashboardRange;
  totalTokens: number;
  requestCount: number;
  totalRuns: number;
  completedRuns: number;
  topProviderId: string | null;
  topProviderShare: number;
  avgTokensPerCompletedRun: number;
  riskProviderCount: number;
  monthlyTotals?: Array<{ month: string; tokenUsed: number; completedRuns: number }>;
}

interface GovernanceTopRiskTaskItem {
  taskId: string;
  projectId: string;
  title: string;
  runtimeSessionId: string | null;
  requestCount: number;
  totalTokens: number;
  costUsd: number;
  blockedCount: number;
  breakerCount: number;
  judgeRequestCount: number;
  hookRequestCount: number;
  parallelCandidateCount: number;
  riskScore: number;
  dominantDriver: string;
  lastGuardDecision: string | null;
  lastGuardReason: string | null;
  lastBreakerReason: string | null;
  lastActivityAt: string | null;
}

interface GovernanceRecentEventItem {
  id: string;
  projectId: string;
  taskId: string | null;
  title: string;
  runtimeSessionId: string | null;
  eventKind: "guard" | "breaker";
  action: string;
  guardDecision: string | null;
  reason: string | null;
  occurredAt: string;
}

interface GovernanceOverviewResponse {
  range: DashboardRange;
  generatedAt: string;
  summary: {
    blockedCount: number;
    breakerCount: number;
    activeLeaseCount: number;
    topRiskTaskCount: number;
    runningTaskCount: number;
    activeSessionCount: number;
    parallelTaskCount: number;
    sequentialChainTaskCount: number;
    recentTimelineItemCount: number;
    pausedTaskCount: number;
    failedTaskCount: number;
    activeCandidateCount: number;
    pendingChainStepCount: number;
    toolTimelineItemCount: number;
    decisionTimelineItemCount: number;
  };
  topRiskTasks: GovernanceTopRiskTaskItem[];
  recentEvents: GovernanceRecentEventItem[];
}

interface MutableGovernanceTopRiskTaskItem extends GovernanceTopRiskTaskItem {
  lastGuardAuditAtMs: number | null;
  lastBreakerAuditAtMs: number | null;
}

interface GovernanceTaskRecord {
  id: string;
  projectId: string;
  title: string;
  currentSessionId: string | null;
  lastActivityAt: string | null;
}

type DashboardTaskSnapshotRow = typeof taskSnapshots.$inferSelect;

function normalizeDashboardTaskStatus(snapshot: DashboardTaskSnapshotRow) {
  if (
    snapshot.currentExecutionStatus === "pending" ||
    snapshot.currentExecutionStatus === "running" ||
    snapshot.currentExecutionStatus === "paused" ||
    snapshot.currentExecutionStatus === "completed" ||
    snapshot.currentExecutionStatus === "failed" ||
    snapshot.currentExecutionStatus === "cancelled"
  ) {
    return snapshot.currentExecutionStatus;
  }

  if (snapshot.lifecycleStatus === "done") {
    return "completed";
  }
  if (snapshot.lifecycleStatus === "active") {
    return "running";
  }
  if (snapshot.lifecycleStatus === "archived") {
    return "cancelled";
  }

  return "pending";
}

function normalizeDashboardExecutionMode(snapshot: DashboardTaskSnapshotRow) {
  return fromStoredTaskExecutionMode(snapshot.currentExecutionMode);
}

interface GovernanceLedgerRecord {
  taskId: string | null;
  projectId: string;
  runtimeSessionId: string | null;
  requestCount: number;
  totalTokens: number;
  costUsd: number;
  judgeRequestCount: number;
  hookRequestCount: number;
  candidateCount: number | null;
  finishedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

interface GovernanceAuditRecord {
  id: string;
  projectId: string | null;
  taskId: string | null;
  sessionId: string | null;
  action: string;
  detail: unknown;
  ts: string;
}

interface GovernanceSummaryCounts {
  blockedCount: number;
  breakerCount: number;
}

function parseDateMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAccessibleProjectIds(user: JWTPayload): string[] | null {
  const globalLevel = ROLE_HIERARCHY[user.role as Role] ?? 0;
  if (globalLevel >= ROLE_HIERARCHY.org_admin) {
    return null;
  }
  return Array.from(new Set((user.projects || []).map((project) => project.id)));
}

function hasProjectAccess(user: JWTPayload, projectId: string): boolean {
  const accessible = getAccessibleProjectIds(user);
  return accessible == null || accessible.includes(projectId);
}

function parseRange(value?: string): DashboardRange {
  return DASHBOARD_RANGES.includes(value as DashboardRange) ? (value as DashboardRange) : "24h";
}

async function loadGovernanceTaskRecords(taskIds: string[]) {
  if (taskIds.length === 0) {
    return [] as GovernanceTaskRecord[];
  }

  const [taskRows, snapshotRows] = await Promise.all([
    db.query.tasks.findMany({ where: inArray(tasks.id, taskIds) }),
    db.query.taskSnapshots.findMany({ where: inArray(taskSnapshots.taskId, taskIds) }),
  ]);

  const snapshotSessionIds = Array.from(
    new Set(
      snapshotRows
        .map((row) => row.currentSessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ),
  );
  const snapshotSessions =
    snapshotSessionIds.length > 0
      ? await db.query.taskSessions.findMany({
          where: inArray(taskSessions.id, snapshotSessionIds),
          columns: { id: true, runtimeSessionId: true },
        })
      : [];

  const snapshotByTaskId = new Map(snapshotRows.map((row) => [row.taskId, row] as const));
  const runtimeSessionIdById = new Map(
    snapshotSessions.map((row) => [row.id, row.runtimeSessionId ?? row.id] as const),
  );

  return taskRows.map((task) => {
    const snapshot = snapshotByTaskId.get(task.id);
    return {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      currentSessionId: snapshot?.currentSessionId
        ? (runtimeSessionIdById.get(snapshot.currentSessionId) ?? task.currentSessionId ?? null)
        : (task.currentSessionId ?? null),
      lastActivityAt:
        snapshot?.lastActivityAt ??
        task.finishedAt ??
        task.startedAt ??
        task.updatedAt ??
        task.createdAt ??
        null,
    } satisfies GovernanceTaskRecord;
  });
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function addUtcMonths(date: Date, offset: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1, 0, 0, 0, 0));
}

function formatMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function bucketKeyForTimestamp(range: DashboardRange, timestampMs: number) {
  const date = new Date(timestampMs);
  if (range === "24h") {
    return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
  }
  return range === "monthly"
    ? formatMonthKey(startOfUtcMonth(date))
    : `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function buildBucketSeries(range: DashboardRange, nowMs: number) {
  if (range === "24h") {
    const series: string[] = [];
    for (let offset = 23; offset >= 0; offset -= 1) {
      const date = new Date(nowMs - offset * 60 * 60 * 1000);
      series.push(`${String(date.getUTCHours()).padStart(2, "0")}:00`);
    }
    return series;
  }

  if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    const series: string[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(nowMs - offset * 24 * 60 * 60 * 1000);
      series.push(
        `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`,
      );
    }
    return series;
  }

  const currentMonth = startOfUtcMonth(new Date(nowMs));
  const series: string[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    series.push(formatMonthKey(addUtcMonths(currentMonth, -offset)));
  }
  return series;
}

function getRangeBounds(range: DashboardRange, nowMs: number) {
  if (range === "24h") {
    return {
      currentStartMs: nowMs - 24 * 60 * 60 * 1000,
      previousStartMs: nowMs - 48 * 60 * 60 * 1000,
      currentEndMs: nowMs,
    };
  }
  if (range === "7d") {
    return {
      currentStartMs: nowMs - 7 * 24 * 60 * 60 * 1000,
      previousStartMs: nowMs - 14 * 24 * 60 * 60 * 1000,
      currentEndMs: nowMs,
    };
  }
  if (range === "30d") {
    return {
      currentStartMs: nowMs - 30 * 24 * 60 * 60 * 1000,
      previousStartMs: nowMs - 60 * 24 * 60 * 60 * 1000,
      currentEndMs: nowMs,
    };
  }

  const currentMonthStart = startOfUtcMonth(new Date(nowMs));
  const currentMonthEnd = addUtcMonths(currentMonthStart, 1).getTime();
  const currentStartMs = currentMonthStart.getTime();
  const previousStartMs = addUtcMonths(currentMonthStart, -5).getTime();
  return {
    currentStartMs,
    previousStartMs,
    currentEndMs: currentMonthEnd,
  };
}

function toIso(value: number | null) {
  return value == null ? null : new Date(value).toISOString();
}

function dominantGovernanceDriver(args: {
  blockedCount: number;
  breakerCount: number;
  judgeRequestCount: number;
  hookRequestCount: number;
  parallelCandidateCount: number;
  costUsd: number;
}) {
  if (args.breakerCount > 0) return "breaker";
  if (args.blockedCount > 0) return "blocked";

  const amplificationCandidates = [
    { label: "parallel", score: args.parallelCandidateCount },
    { label: "hook", score: args.hookRequestCount },
    { label: "judge", score: args.judgeRequestCount },
  ].sort((left, right) => right.score - left.score);

  if ((amplificationCandidates[0]?.score ?? 0) > 0) {
    return amplificationCandidates[0]?.label || "cost";
  }

  return "cost";
}

function resolveRunTimestampMs(run: RunRecord) {
  return (
    parseDateMs(run.finishedAt) ?? parseDateMs(run.startedAt) ?? parseDateMs(run.createdAt) ?? 0
  );
}

function parseModelReference(modelUsed?: string | null): ModelReference {
  const value = modelUsed?.trim();
  if (!value) {
    return { providerId: "unknown", modelId: "unknown", route: "unknown" };
  }

  const colonIndex = value.indexOf(":");
  if (colonIndex > 0) {
    const providerId = value.slice(0, colonIndex);
    const modelId = value.slice(colonIndex + 1) || "unknown";
    return { providerId, modelId, route: `${providerId}:${modelId}` };
  }

  const slashIndex = value.indexOf("/");
  if (slashIndex > 0) {
    return {
      providerId: value.slice(0, slashIndex),
      modelId: value.slice(slashIndex + 1) || value,
      route: value,
    };
  }

  return { providerId: value, modelId: value, route: value };
}

function humanizeProviderLabel(providerId: string) {
  if (providerId === "unknown") return "Unknown";
  return providerId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createProviderAggregate(providerId: string): ProviderAggregate {
  return {
    providerId,
    label: humanizeProviderLabel(providerId),
    tokenUsed: 0,
    completedRuns: 0,
    failedRuns: 0,
    stoppedRuns: 0,
    interventionRuns: 0,
    totalRuns: 0,
    latestRunAtMs: null,
    trend: new Map(),
    monthly: new Map(),
    models: new Map(),
  };
}

function createModelAggregate(ref: ModelReference): ModelAggregate {
  return {
    route: ref.route,
    modelId: ref.modelId,
    label: ref.modelId,
    tokenUsed: 0,
    completedRuns: 0,
    failedRuns: 0,
    stoppedRuns: 0,
    interventionRuns: 0,
    totalRuns: 0,
    latestRunAtMs: null,
  };
}

async function loadGuidanceAgentRunIds(candidateRunIds: string[]) {
  const guidanceAgentRunIds = new Set<string>();
  if (candidateRunIds.length === 0) {
    return guidanceAgentRunIds;
  }

  const audits = await db
    .select({
      agentRunId: auditEvents.agentRunId,
      eventType: auditEvents.eventType,
      action: auditEvents.action,
    })
    .from(auditEvents)
    .where(inArray(auditEvents.agentRunId, candidateRunIds));

  for (const audit of audits) {
    if (!audit.agentRunId) continue;
    if (audit.eventType === "guidance" || audit.action.includes("guidance")) {
      guidanceAgentRunIds.add(audit.agentRunId);
    }
  }

  return guidanceAgentRunIds;
}

function accumulateProviderMonthlyRuns(
  runs: RunRecord[],
  providers: Map<string, ProviderAggregate>,
  guidanceAgentRunIds: Set<string>,
) {
  for (const run of runs) {
    const timestampMs = resolveRunTimestampMs(run);
    const modelRef = parseModelReference(run.modelUsed);
    const providerId = modelRef.providerId;
    const aggregate = providers.get(providerId) || createProviderAggregate(providerId);
    const monthlyBucket = getOrCreateMonthlyBucket(
      aggregate.monthly,
      bucketKeyForTimestamp("monthly", timestampMs),
    );
    monthlyBucket.tokenUsed += run.tokenUsed;
    monthlyBucket.totalRuns += 1;
    if (run.status === "completed") {
      monthlyBucket.completedRuns += 1;
    }
    if (run.status === "failed") {
      monthlyBucket.failedRuns += 1;
    }
    if (guidanceAgentRunIds.has(run.agentRunId)) {
      monthlyBucket.interventionRuns += 1;
    }
    providers.set(providerId, aggregate);
  }
}

function applyRunStatusToModelAndProvider(
  run: RunRecord,
  aggregate: ProviderAggregate,
  modelAggregate: ModelAggregate,
) {
  if (run.status === "completed") {
    aggregate.completedRuns += 1;
    modelAggregate.completedRuns += 1;
  }
  if (run.status === "failed") {
    aggregate.failedRuns += 1;
    modelAggregate.failedRuns += 1;
  }
  if (run.status === "stopped" || run.status === "terminated") {
    aggregate.stoppedRuns += 1;
    modelAggregate.stoppedRuns += 1;
  }
}

function applyRunInterventionToModelAndProvider(
  run: RunRecord,
  aggregate: ProviderAggregate,
  modelAggregate: ModelAggregate,
  guidanceAgentRunIds: Set<string>,
) {
  if (!guidanceAgentRunIds.has(run.agentRunId)) {
    return;
  }
  aggregate.interventionRuns += 1;
  modelAggregate.interventionRuns += 1;
}

function updateProviderTrend(
  aggregate: ProviderAggregate,
  range: DashboardRange,
  timestampMs: number,
  run: RunRecord,
) {
  const trendBucket = getOrCreateTrendBucket(
    aggregate.trend,
    bucketKeyForTimestamp(range, timestampMs),
  );
  trendBucket.tokenUsed += run.tokenUsed;
  if (run.status === "completed") {
    trendBucket.completedRuns += 1;
  }
}

function accumulateProviderCurrentRuns(
  runs: RunRecord[],
  range: DashboardRange,
  providers: Map<string, ProviderAggregate>,
  guidanceAgentRunIds: Set<string>,
) {
  for (const run of runs) {
    const timestampMs = resolveRunTimestampMs(run);
    const modelRef = parseModelReference(run.modelUsed);
    const providerId = modelRef.providerId;
    const aggregate = providers.get(providerId) || createProviderAggregate(providerId);
    aggregate.tokenUsed += run.tokenUsed;
    aggregate.totalRuns += 1;
    aggregate.latestRunAtMs =
      aggregate.latestRunAtMs == null
        ? timestampMs
        : Math.max(aggregate.latestRunAtMs, timestampMs);

    const modelAggregate = aggregate.models.get(modelRef.route) || createModelAggregate(modelRef);
    modelAggregate.tokenUsed += run.tokenUsed;
    modelAggregate.totalRuns += 1;
    modelAggregate.latestRunAtMs =
      modelAggregate.latestRunAtMs == null
        ? timestampMs
        : Math.max(modelAggregate.latestRunAtMs, timestampMs);

    applyRunStatusToModelAndProvider(run, aggregate, modelAggregate);
    applyRunInterventionToModelAndProvider(run, aggregate, modelAggregate, guidanceAgentRunIds);
    updateProviderTrend(aggregate, range, timestampMs, run);

    aggregate.models.set(modelRef.route, modelAggregate);
    providers.set(providerId, aggregate);
  }
}

function buildProviderMonthlySeries(aggregate: ProviderAggregate, monthlySeries: string[]) {
  return monthlySeries.map((month) => {
    const bucket = aggregate.monthly.get(month) || {
      tokenUsed: 0,
      completedRuns: 0,
      failedRuns: 0,
      interventionRuns: 0,
      totalRuns: 0,
    };
    return {
      month,
      tokenUsed: bucket.tokenUsed,
      completedRuns: bucket.completedRuns,
      failureRate: bucket.totalRuns > 0 ? bucket.failedRuns / bucket.totalRuns : 0,
      interventionRate: bucket.totalRuns > 0 ? bucket.interventionRuns / bucket.totalRuns : 0,
      avgTokensPerCompletedRun:
        bucket.completedRuns > 0 ? bucket.tokenUsed / bucket.completedRuns : 0,
    };
  });
}

function buildProviderModelItems(aggregate: ProviderAggregate): ProviderModelResponseItem[] {
  return Array.from(aggregate.models.values())
    .map((model) => {
      const failureRate = model.totalRuns > 0 ? model.failedRuns / model.totalRuns : 0;
      const interventionRate = model.totalRuns > 0 ? model.interventionRuns / model.totalRuns : 0;
      const avgTokensPerRun = model.totalRuns > 0 ? model.tokenUsed / model.totalRuns : 0;
      const avgTokensPerCompletedRun =
        model.completedRuns > 0 ? model.tokenUsed / model.completedRuns : 0;
      return {
        route: model.route,
        modelId: model.modelId,
        label: model.label,
        tokenUsed: model.tokenUsed,
        requestCount: model.totalRuns,
        tokenShareWithinProvider:
          aggregate.tokenUsed > 0 ? model.tokenUsed / aggregate.tokenUsed : 0,
        completedRuns: model.completedRuns,
        failedRuns: model.failedRuns,
        stoppedRuns: model.stoppedRuns,
        interventionRuns: model.interventionRuns,
        totalRuns: model.totalRuns,
        failureRate,
        interventionRate,
        avgTokensPerRun,
        avgTokensPerCompletedRun,
        latestRunAt: toIso(model.latestRunAtMs),
      };
    })
    .sort(
      (left, right) => right.tokenUsed - left.tokenUsed || right.requestCount - left.requestCount,
    );
}

function buildProviderResponseItem(args: {
  aggregate: ProviderAggregate;
  totalTokens: number;
  bucketSeries: string[];
  monthlySeries: string[];
  projectAvgTokensPerCompletedRun: number;
}): ProviderResponseItem {
  const { aggregate, totalTokens, bucketSeries, monthlySeries, projectAvgTokensPerCompletedRun } =
    args;
  const tokenShare = totalTokens > 0 ? aggregate.tokenUsed / totalTokens : 0;
  const failureRate = aggregate.totalRuns > 0 ? aggregate.failedRuns / aggregate.totalRuns : 0;
  const interventionRate =
    aggregate.totalRuns > 0 ? aggregate.interventionRuns / aggregate.totalRuns : 0;
  const avgTokensPerRun = aggregate.totalRuns > 0 ? aggregate.tokenUsed / aggregate.totalRuns : 0;
  const avgTokensPerCompletedRun =
    aggregate.completedRuns > 0 ? aggregate.tokenUsed / aggregate.completedRuns : 0;
  const monthly = buildProviderMonthlySeries(aggregate, monthlySeries);
  const { health, reasons } = computeHealth({
    failureRate,
    interventionRate,
    tokenUsed: aggregate.tokenUsed,
    currentWindowAvgTokensPerCompletedRun: avgTokensPerCompletedRun,
    projectAvgTokensPerCompletedRun,
    monthly,
  });
  const recommendation = computeRecommendation({
    tokenShare,
    failureRate,
    interventionRate,
    avgTokensPerCompletedRun,
    projectAvgTokensPerCompletedRun,
    health,
  });

  return {
    providerId: aggregate.providerId,
    label: aggregate.label,
    tokenUsed: aggregate.tokenUsed,
    requestCount: aggregate.totalRuns,
    tokenShare,
    completedRuns: aggregate.completedRuns,
    failedRuns: aggregate.failedRuns,
    stoppedRuns: aggregate.stoppedRuns,
    interventionRuns: aggregate.interventionRuns,
    totalRuns: aggregate.totalRuns,
    failureRate,
    interventionRate,
    avgTokensPerRun,
    avgTokensPerCompletedRun,
    latestRunAt: toIso(aggregate.latestRunAtMs),
    trend: bucketSeries.map((bucket) => {
      const item = aggregate.trend.get(bucket);
      return {
        bucket,
        tokenUsed: item?.tokenUsed ?? 0,
        completedRuns: item?.completedRuns ?? 0,
      };
    }),
    monthly,
    health,
    reasons,
    recommendationAction: recommendation.recommendationAction,
    recommendationLabel: recommendation.recommendationLabel,
    recommendationMessage: recommendation.recommendationMessage,
    models: buildProviderModelItems(aggregate),
  };
}

function buildProviderItems(args: {
  providers: Map<string, ProviderAggregate>;
  totalTokens: number;
  bucketSeries: string[];
  monthlySeries: string[];
  projectAvgTokensPerCompletedRun: number;
}): ProviderResponseItem[] {
  return Array.from(args.providers.values())
    .map((aggregate) =>
      buildProviderResponseItem({
        aggregate,
        totalTokens: args.totalTokens,
        bucketSeries: args.bucketSeries,
        monthlySeries: args.monthlySeries,
        projectAvgTokensPerCompletedRun: args.projectAvgTokensPerCompletedRun,
      }),
    )
    .sort(
      (left, right) => right.tokenUsed - left.tokenUsed || right.completedRuns - left.completedRuns,
    );
}

function buildMonthlyTotals(monthlyWindowRuns: RunRecord[], monthlySeries: string[]) {
  const totals = new Map<string, { tokenUsed: number; completedRuns: number }>();
  for (const run of monthlyWindowRuns) {
    const month = bucketKeyForTimestamp("monthly", resolveRunTimestampMs(run));
    const existing = totals.get(month) || { tokenUsed: 0, completedRuns: 0 };
    existing.tokenUsed += run.tokenUsed;
    if (run.status === "completed") {
      existing.completedRuns += 1;
    }
    totals.set(month, existing);
  }
  return monthlySeries.map((month) => ({
    month,
    tokenUsed: totals.get(month)?.tokenUsed ?? 0,
    completedRuns: totals.get(month)?.completedRuns ?? 0,
  }));
}

function createEmptyGovernanceOverview(
  range: DashboardRange,
  nowMs: number,
): GovernanceOverviewResponse {
  return {
    range,
    generatedAt: new Date(nowMs).toISOString(),
    summary: {
      blockedCount: 0,
      breakerCount: 0,
      activeLeaseCount: 0,
      topRiskTaskCount: 0,
      runningTaskCount: 0,
      activeSessionCount: 0,
      parallelTaskCount: 0,
      sequentialChainTaskCount: 0,
      recentTimelineItemCount: 0,
      pausedTaskCount: 0,
      failedTaskCount: 0,
      activeCandidateCount: 0,
      pendingChainStepCount: 0,
      toolTimelineItemCount: 0,
      decisionTimelineItemCount: 0,
    },
    topRiskTasks: [],
    recentEvents: [],
  };
}

function getAuditDetail(detail: unknown): Record<string, unknown> {
  return (detail || {}) as Record<string, unknown>;
}

function isRelevantGovernanceAudit(audit: GovernanceAuditRecord) {
  const detail = getAuditDetail(audit.detail);
  return (
    audit.action === "breaker_tripped" ||
    audit.action.includes("blocked") ||
    typeof detail.guardDecision === "string" ||
    typeof detail.guardReason === "string" ||
    typeof detail.breakerReason === "string"
  );
}

function resolveGovernanceEventKind(audit: GovernanceAuditRecord) {
  return audit.action === "breaker_tripped" ? ("breaker" as const) : ("guard" as const);
}

function resolveAuditReason(detail: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = detail[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return null;
}

function mapGovernanceRecentEvent(
  audit: GovernanceAuditRecord,
  taskById: Map<string, GovernanceTaskRecord>,
): GovernanceRecentEventItem {
  const detail = getAuditDetail(audit.detail);
  const task = audit.taskId ? taskById.get(audit.taskId) : undefined;
  const eventKind = resolveGovernanceEventKind(audit);
  return {
    id: audit.id,
    projectId: audit.projectId || task?.projectId || "",
    taskId: audit.taskId || null,
    title: task?.title || audit.taskId || audit.projectId || "未关联任务",
    runtimeSessionId: typeof audit.sessionId === "string" ? audit.sessionId : null,
    eventKind,
    action: audit.action,
    guardDecision: typeof detail.guardDecision === "string" ? detail.guardDecision : null,
    reason:
      eventKind === "breaker"
        ? resolveAuditReason(detail, ["breakerReason", "reason"])
        : resolveAuditReason(detail, ["guardReason", "reason"]),
    occurredAt: audit.ts,
  };
}

function buildGovernanceRecentEvents(
  audits: GovernanceAuditRecord[],
  taskById: Map<string, GovernanceTaskRecord>,
) {
  return audits
    .filter(isRelevantGovernanceAudit)
    .map((audit) => mapGovernanceRecentEvent(audit, taskById))
    .slice(0, 8);
}

function getLatestIso(current: string | null, candidate: string | null) {
  if (!current) return candidate;
  if (!candidate) return current;
  return Date.parse(current) >= Date.parse(candidate) ? current : candidate;
}

function createRiskTaskBase(args: {
  taskId: string;
  projectId: string;
  title: string;
  runtimeSessionId: string | null;
  dominantDriver: string;
  lastActivityAt: string | null;
}): MutableGovernanceTopRiskTaskItem {
  return {
    taskId: args.taskId,
    projectId: args.projectId,
    title: args.title,
    runtimeSessionId: args.runtimeSessionId,
    requestCount: 0,
    totalTokens: 0,
    costUsd: 0,
    blockedCount: 0,
    breakerCount: 0,
    judgeRequestCount: 0,
    hookRequestCount: 0,
    parallelCandidateCount: 0,
    riskScore: 0,
    dominantDriver: args.dominantDriver,
    lastGuardDecision: null,
    lastGuardReason: null,
    lastBreakerReason: null,
    lastActivityAt: args.lastActivityAt,
    lastGuardAuditAtMs: null,
    lastBreakerAuditAtMs: null,
  };
}

function getOrCreateRiskTaskFromLedger(
  taskMap: Map<string, MutableGovernanceTopRiskTaskItem>,
  ledger: GovernanceLedgerRecord,
  taskById: Map<string, GovernanceTaskRecord>,
) {
  if (!ledger.taskId) {
    return null;
  }
  const existing = taskMap.get(ledger.taskId);
  if (existing) {
    return existing;
  }
  const task = taskById.get(ledger.taskId);
  const created = createRiskTaskBase({
    taskId: ledger.taskId,
    projectId: ledger.projectId,
    title: task?.title || ledger.taskId,
    runtimeSessionId: task?.currentSessionId || ledger.runtimeSessionId || null,
    dominantDriver: "cost",
    lastActivityAt:
      task?.lastActivityAt || ledger.finishedAt || ledger.updatedAt || ledger.createdAt || null,
  });
  taskMap.set(ledger.taskId, created);
  return created;
}

function applyLedgerToRiskTask(
  item: MutableGovernanceTopRiskTaskItem,
  ledger: GovernanceLedgerRecord,
) {
  item.requestCount += ledger.requestCount;
  item.totalTokens += ledger.totalTokens;
  item.costUsd = Number((item.costUsd + ledger.costUsd).toFixed(4));
  item.judgeRequestCount += ledger.judgeRequestCount;
  item.hookRequestCount += ledger.hookRequestCount;
  const candidateCount = ledger.candidateCount ?? 1;
  if (candidateCount > 1) {
    item.parallelCandidateCount += Math.max(0, candidateCount - 1);
  }
  item.runtimeSessionId = item.runtimeSessionId || ledger.runtimeSessionId || null;
  item.lastActivityAt = getLatestIso(
    item.lastActivityAt,
    ledger.finishedAt || ledger.updatedAt || ledger.createdAt || null,
  );
}

function getOrCreateRiskTaskFromAudit(
  taskMap: Map<string, MutableGovernanceTopRiskTaskItem>,
  audit: GovernanceAuditRecord,
  taskById: Map<string, GovernanceTaskRecord>,
) {
  if (!audit.taskId) {
    return null;
  }
  const existing = taskMap.get(audit.taskId);
  if (existing) {
    return existing;
  }
  const task = taskById.get(audit.taskId);
  const created = createRiskTaskBase({
    taskId: audit.taskId,
    projectId: audit.projectId || task?.projectId || "",
    title: task?.title || audit.taskId,
    runtimeSessionId:
      task?.currentSessionId || (typeof audit.sessionId === "string" ? audit.sessionId : null),
    dominantDriver: "blocked",
    lastActivityAt: task?.lastActivityAt || audit.ts,
  });
  taskMap.set(audit.taskId, created);
  return created;
}

function updateBreakerState(
  item: MutableGovernanceTopRiskTaskItem,
  detail: Record<string, unknown>,
  auditTsMs: number | null,
) {
  item.breakerCount += 1;
  if (
    auditTsMs == null ||
    (item.lastBreakerAuditAtMs != null && auditTsMs < item.lastBreakerAuditAtMs)
  ) {
    return;
  }
  item.lastBreakerReason = resolveAuditReason(detail, ["breakerReason", "reason"]);
  item.lastBreakerAuditAtMs = auditTsMs;
}

function updateGuardState(
  item: MutableGovernanceTopRiskTaskItem,
  detail: Record<string, unknown>,
  action: string,
  auditTsMs: number | null,
) {
  const isGuardAudit =
    action.includes("blocked") ||
    typeof detail.guardDecision === "string" ||
    typeof detail.guardReason === "string";
  if (
    !isGuardAudit ||
    auditTsMs == null ||
    (item.lastGuardAuditAtMs != null && auditTsMs < item.lastGuardAuditAtMs)
  ) {
    return;
  }
  item.lastGuardDecision = typeof detail.guardDecision === "string" ? detail.guardDecision : null;
  item.lastGuardReason = typeof detail.guardReason === "string" ? detail.guardReason : null;
  item.lastGuardAuditAtMs = auditTsMs;
}

function applyAuditToRiskTask(
  item: MutableGovernanceTopRiskTaskItem,
  audit: GovernanceAuditRecord,
) {
  const detail = getAuditDetail(audit.detail);
  const auditTsMs = parseDateMs(audit.ts);
  if (audit.action.includes("blocked")) {
    item.blockedCount += 1;
  }
  if (audit.action === "breaker_tripped") {
    updateBreakerState(item, detail, auditTsMs);
  }
  updateGuardState(item, detail, audit.action, auditTsMs);
  item.lastActivityAt = getLatestIso(item.lastActivityAt, audit.ts || null);
}

function summarizeGovernanceAudits(audits: GovernanceAuditRecord[]): GovernanceSummaryCounts {
  return audits.reduce(
    (summary, audit) => {
      if (audit.action.includes("blocked")) {
        summary.blockedCount += 1;
      }
      if (audit.action === "breaker_tripped") {
        summary.breakerCount += 1;
      }
      return summary;
    },
    { blockedCount: 0, breakerCount: 0 },
  );
}

function finalizeRiskTasks(taskMap: Map<string, MutableGovernanceTopRiskTaskItem>) {
  return Array.from(taskMap.values())
    .map((item) => ({
      ...item,
      riskScore:
        item.blockedCount * 5 +
        item.breakerCount * 7 +
        item.parallelCandidateCount +
        item.judgeRequestCount +
        item.hookRequestCount +
        Math.min(10, Math.round(item.costUsd * 10)) +
        Math.round(item.requestCount / 2),
    }))
    .map((item) => ({
      ...item,
      dominantDriver: dominantGovernanceDriver(item),
    }))
    .sort((left, right) => {
      if (right.riskScore !== left.riskScore) return right.riskScore - left.riskScore;
      if (right.costUsd !== left.costUsd) return right.costUsd - left.costUsd;
      return right.requestCount - left.requestCount;
    })
    .map(
      ({
        lastGuardAuditAtMs: _lastGuardAuditAtMs,
        lastBreakerAuditAtMs: _lastBreakerAuditAtMs,
        ...item
      }) => item,
    )
    .slice(0, 5);
}

function buildGovernanceTopRiskTasks(args: {
  ledgers: GovernanceLedgerRecord[];
  audits: GovernanceAuditRecord[];
  taskById: Map<string, GovernanceTaskRecord>;
}) {
  const taskMap = new Map<string, MutableGovernanceTopRiskTaskItem>();

  for (const ledger of args.ledgers) {
    const item = getOrCreateRiskTaskFromLedger(taskMap, ledger, args.taskById);
    if (item) {
      applyLedgerToRiskTask(item, ledger);
    }
  }

  for (const audit of args.audits) {
    const item = getOrCreateRiskTaskFromAudit(taskMap, audit, args.taskById);
    if (item) {
      applyAuditToRiskTask(item, audit);
    }
  }

  return finalizeRiskTasks(taskMap);
}

function getOrCreateTrendBucket(map: ProviderAggregate["trend"], bucket: string) {
  const existing = map.get(bucket);
  if (existing) return existing;
  const created = { tokenUsed: 0, completedRuns: 0 };
  map.set(bucket, created);
  return created;
}

function getOrCreateMonthlyBucket(map: ProviderAggregate["monthly"], month: string) {
  const existing = map.get(month);
  if (existing) return existing;
  const created = {
    tokenUsed: 0,
    completedRuns: 0,
    failedRuns: 0,
    interventionRuns: 0,
    totalRuns: 0,
  };
  map.set(month, created);
  return created;
}

function computeHealth(args: {
  failureRate: number;
  interventionRate: number;
  tokenUsed: number;
  currentWindowAvgTokensPerCompletedRun: number;
  projectAvgTokensPerCompletedRun: number;
  monthly: ProviderMonthlyBucket[];
}) {
  const reasons: string[] = [];
  if (args.failureRate >= 0.3) {
    reasons.push("失败率偏高");
  }
  if (args.interventionRate >= 0.5) {
    reasons.push("人工介入率偏高");
  }
  if (
    args.currentWindowAvgTokensPerCompletedRun > 0 &&
    args.projectAvgTokensPerCompletedRun > 0 &&
    args.currentWindowAvgTokensPerCompletedRun >= args.projectAvgTokensPerCompletedRun * 1.5 &&
    args.tokenUsed >= 10_000
  ) {
    reasons.push("平均完成成本偏高");
  }

  const recentMonthly = args.monthly.slice(-2);
  if (
    recentMonthly.length === 2 &&
    recentMonthly.every(
      (item) =>
        item.avgTokensPerCompletedRun > 0 &&
        args.projectAvgTokensPerCompletedRun > 0 &&
        item.avgTokensPerCompletedRun >= args.projectAvgTokensPerCompletedRun * 1.3 &&
        item.failureRate < 0.3,
    )
  ) {
    reasons.push("连续两个月高消耗");
  }

  const health: ProviderHealth =
    reasons.length >= 2 ? "risk" : reasons.length === 1 ? "warn" : "healthy";
  return { health, reasons };
}

function computeRecommendation(args: {
  tokenShare: number;
  failureRate: number;
  interventionRate: number;
  avgTokensPerCompletedRun: number;
  projectAvgTokensPerCompletedRun: number;
  health: ProviderHealth;
}) {
  const costHeavy =
    args.avgTokensPerCompletedRun > 0 &&
    args.projectAvgTokensPerCompletedRun > 0 &&
    args.avgTokensPerCompletedRun >= args.projectAvgTokensPerCompletedRun * 1.2;
  const lowQuality = args.failureRate >= 0.2 || args.interventionRate >= 0.35;
  const highTraffic = args.tokenShare >= 0.35;

  if (highTraffic && costHeavy && lowQuality) {
    return {
      recommendationAction: "downgrade" as const,
      recommendationLabel: "建议降配",
      recommendationMessage: "高消耗且完成质量偏低，建议评估迁移到更轻模型或收紧适用任务。",
    };
  }

  if (args.health !== "healthy" || costHeavy || lowQuality) {
    return {
      recommendationAction: "observe" as const,
      recommendationLabel: "继续观察",
      recommendationMessage: "存在效率或质量波动，建议继续比较任务类型与模型分配。",
    };
  }

  return {
    recommendationAction: "keep" as const,
    recommendationLabel: "保持主力",
    recommendationMessage: "当前 token 消耗与完成质量匹配，可继续承载主流任务。",
  };
}

dashboardRoutes.get("/provider-tokens", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) {
    return c.json({ error: "projectId query param required" }, 400);
  }

  const user = c.get("user") as JWTPayload;
  if (!hasProjectAccess(user, projectId)) {
    return c.json({ error: "No access to this project" }, 403);
  }

  const range = parseRange(c.req.query("range"));
  const nowMs = Date.now();
  const bounds = getRangeBounds(range, nowMs);
  const taskRows = await db.query.tasks.findMany({
    where: eq(tasks.projectId, projectId),
    columns: { id: true },
  });
  const taskIds = taskRows.map((task) => task.id);

  const runRows =
    taskIds.length > 0
      ? await db
          .select({
            agentRunId: runtimeUsageLedgers.agentRunId,
            ledgerId: runtimeUsageLedgers.id,
            taskId: runtimeUsageLedgers.taskId,
            status: runtimeUsageLedgers.status,
            defaultProviderId: runtimeUsageLedgers.defaultProviderId,
            defaultModelId: runtimeUsageLedgers.defaultModelId,
            tokenUsed: runtimeUsageLedgers.totalTokens,
            startedAt: runtimeUsageLedgers.startedAt,
            finishedAt: runtimeUsageLedgers.finishedAt,
            createdAt: runtimeUsageLedgers.createdAt,
          })
          .from(runtimeUsageLedgers)
          .where(inArray(runtimeUsageLedgers.taskId, taskIds))
      : [];
  const scopedRunRows = runRows.map((run) => ({
    agentRunId: run.agentRunId || run.ledgerId,
    taskId: run.taskId || "",
    projectId,
    status:
      run.status === "cancelled"
        ? ("stopped" as const)
        : run.status === "failed"
          ? ("failed" as const)
          : run.status === "running"
            ? ("running" as const)
            : ("completed" as const),
    modelUsed:
      run.defaultProviderId && run.defaultModelId
        ? `${run.defaultProviderId}/${run.defaultModelId}`
        : (run.defaultModelId ?? run.defaultProviderId ?? null),
    tokenUsed: run.tokenUsed,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
  }));

  const candidateRuns = scopedRunRows.filter(
    (run) => resolveRunTimestampMs(run) >= bounds.previousStartMs,
  );
  const candidateRunIds = candidateRuns.map((run) => run.agentRunId).filter(Boolean);
  const guidanceAgentRunIds = await loadGuidanceAgentRunIds(candidateRunIds);

  const currentRuns = candidateRuns.filter((run) => {
    const timestampMs = resolveRunTimestampMs(run);
    return timestampMs >= bounds.currentStartMs && timestampMs < bounds.currentEndMs;
  });

  const bucketSeries = buildBucketSeries(range, nowMs);
  const monthlySeries = buildBucketSeries("monthly", nowMs);
  const monthlyStartMs = addUtcMonths(startOfUtcMonth(new Date(nowMs)), -5).getTime();
  const monthlyWindowRuns = candidateRuns.filter((run) => {
    const timestampMs = resolveRunTimestampMs(run);
    return timestampMs >= monthlyStartMs && timestampMs < bounds.currentEndMs;
  });
  const providers = new Map<string, ProviderAggregate>();
  accumulateProviderMonthlyRuns(monthlyWindowRuns, providers, guidanceAgentRunIds);
  accumulateProviderCurrentRuns(currentRuns, range, providers, guidanceAgentRunIds);

  const totalTokens = currentRuns.reduce((sum, run) => sum + run.tokenUsed, 0);
  const totalRuns = currentRuns.length;
  const completedRuns = currentRuns.filter((run) => run.status === "completed").length;
  const totalCompletedTokens = currentRuns
    .filter((run) => run.status === "completed")
    .reduce((sum, run) => sum + run.tokenUsed, 0);
  const projectAvgTokensPerCompletedRun =
    completedRuns > 0 ? totalCompletedTokens / completedRuns : 0;

  const providerItems = buildProviderItems({
    providers,
    totalTokens,
    bucketSeries,
    monthlySeries,
    projectAvgTokensPerCompletedRun,
  });

  const topProvider = providerItems[0] ?? null;
  const summary: SummaryResponse = {
    range,
    totalTokens,
    requestCount: totalRuns,
    totalRuns,
    completedRuns,
    topProviderId: topProvider?.providerId ?? null,
    topProviderShare: topProvider?.tokenShare ?? 0,
    avgTokensPerCompletedRun: projectAvgTokensPerCompletedRun,
    riskProviderCount: providerItems.filter((item) => item.health === "risk").length,
    monthlyTotals: buildMonthlyTotals(monthlyWindowRuns, monthlySeries),
  };

  return c.json({
    projectId,
    range,
    generatedAt: new Date(nowMs).toISOString(),
    summary,
    providers: providerItems,
  });
});

dashboardRoutes.get("/governance-overview", async (c) => {
  const user = c.get("user") as JWTPayload;
  const range = parseRange(c.req.query("range"));
  const nowMs = Date.now();
  const bounds = getRangeBounds(range, nowMs);
  const accessibleProjectIds = getAccessibleProjectIds(user);

  const projectRows = await db.query.projects.findMany({
    where: accessibleProjectIds == null ? undefined : inArray(projects.id, accessibleProjectIds),
    orderBy: [asc(projects.createdAt)],
  });
  const projectIds = projectRows.map((project) => project.id);

  if (projectIds.length === 0) {
    return c.json(createEmptyGovernanceOverview(range, nowMs));
  }

  const startIso = new Date(bounds.currentStartMs).toISOString();
  const endIso = new Date(bounds.currentEndMs).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  const [ledgers, audits, activeLeases, snapshotRows, recentTimelineRows] = await Promise.all([
    db.query.runtimeUsageLedgers.findMany({
      where: and(
        inArray(runtimeUsageLedgers.projectId, projectIds),
        gte(runtimeUsageLedgers.createdAt, startIso),
        lt(runtimeUsageLedgers.createdAt, endIso),
      ),
      orderBy: [desc(runtimeUsageLedgers.createdAt)],
    }),
    db.query.auditEvents.findMany({
      where: and(
        inArray(auditEvents.projectId, projectIds),
        eq(auditEvents.eventType, "paid_execution"),
        gte(auditEvents.ts, startIso),
        lt(auditEvents.ts, endIso),
      ),
      orderBy: [desc(auditEvents.ts)],
    }),
    db.query.paidExecutionLeases.findMany({
      where: and(
        inArray(paidExecutionLeases.projectId, projectIds),
        eq(paidExecutionLeases.status, "active"),
        gte(paidExecutionLeases.expiresAt, nowIso),
      ),
    }),
    db.query.taskSnapshots.findMany({
      where: inArray(taskSnapshots.projectId, projectIds),
    }),
    db
      .select({
        id: taskTimelineViews.id,
        sessionId: taskTimelineViews.sessionId,
        itemKind: taskTimelineViews.itemKind,
      })
      .from(taskTimelineViews)
      .where(
        and(
          inArray(taskTimelineViews.projectId, projectIds),
          gte(taskTimelineViews.sortAt, startIso),
          lt(taskTimelineViews.sortAt, endIso),
        ),
      ),
  ]);

  const relevantTaskIds = Array.from(
    new Set([
      ...ledgers
        .map((ledger) => ledger.taskId)
        .filter((taskId): taskId is string => Boolean(taskId)),
      ...audits.map((audit) => audit.taskId).filter((taskId): taskId is string => Boolean(taskId)),
    ]),
  );
  const taskRows = await loadGovernanceTaskRecords(relevantTaskIds);
  const taskById = new Map(taskRows.map((task) => [task.id, task]));
  const recentEvents = buildGovernanceRecentEvents(audits, taskById);
  const summaryCounts = summarizeGovernanceAudits(audits);
  const rankedTopRiskTasks = buildGovernanceTopRiskTasks({
    ledgers,
    audits,
    taskById,
  });
  const activeSessionIds = new Set(
    snapshotRows
      .map((snapshot) => snapshot.currentSessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );
  const runningTaskCount = snapshotRows.filter((snapshot) => {
    const status = normalizeDashboardTaskStatus(snapshot);
    return status === "running" || status === "paused";
  }).length;
  const parallelTaskCount = snapshotRows.filter(
    (snapshot) => normalizeDashboardExecutionMode(snapshot) === "parallel",
  ).length;
  const sequentialChainTaskCount = snapshotRows.filter(
    (snapshot) => normalizeDashboardExecutionMode(snapshot) === "sequential-chain",
  ).length;
  const pausedTaskCount = snapshotRows.filter(
    (snapshot) => normalizeDashboardTaskStatus(snapshot) === "paused",
  ).length;
  const failedTaskCount = snapshotRows.filter((snapshot) => {
    const status = normalizeDashboardTaskStatus(snapshot);
    return status === "failed" || status === "cancelled";
  }).length;
  const activeCandidateCount = snapshotRows.reduce(
    (sum, snapshot) => sum + (snapshot.activeCandidateCount ?? 0),
    0,
  );
  const pendingChainStepCount = snapshotRows.reduce(
    (sum, snapshot) =>
      sum + Math.max((snapshot.totalChainSteps ?? 0) - (snapshot.completedChainSteps ?? 0), 0),
    0,
  );
  const toolTimelineItemCount = recentTimelineRows.filter(
    (row) => row.itemKind === "operation",
  ).length;
  const decisionTimelineItemCount = recentTimelineRows.filter(
    (row) => row.itemKind === "task_lifecycle",
  ).length;

  const response: GovernanceOverviewResponse = {
    range,
    generatedAt: new Date(nowMs).toISOString(),
    summary: {
      blockedCount: summaryCounts.blockedCount,
      breakerCount: summaryCounts.breakerCount,
      activeLeaseCount: activeLeases.length,
      topRiskTaskCount: rankedTopRiskTasks.length,
      runningTaskCount,
      activeSessionCount: activeSessionIds.size,
      parallelTaskCount,
      sequentialChainTaskCount,
      recentTimelineItemCount: recentTimelineRows.length,
      pausedTaskCount,
      failedTaskCount,
      activeCandidateCount,
      pendingChainStepCount,
      toolTimelineItemCount,
      decisionTimelineItemCount,
    },
    topRiskTasks: rankedTopRiskTasks,
    recentEvents,
  };

  return c.json(response);
});
