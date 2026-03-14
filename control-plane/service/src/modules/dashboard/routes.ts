import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db";
import { agentRuns, auditEvents, projects, tasks } from "../../db/schema";
import { type AppEnv, type JWTPayload, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.use("*", authMiddleware);
dashboardRoutes.use("*", requireRole("developer"));

type Role = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";
type DashboardRange = "24h" | "7d" | "30d" | "monthly";
type AgentRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "stopped" | "terminated";
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
  monthly: Map<string, {
    tokenUsed: number;
    completedRuns: number;
    failedRuns: number;
    interventionRuns: number;
    totalRuns: number;
  }>;
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
      series.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`);
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

function resolveRunTimestampMs(run: RunRecord) {
  return parseDateMs(run.finishedAt) ?? parseDateMs(run.startedAt) ?? parseDateMs(run.createdAt) ?? 0;
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
    args.currentWindowAvgTokensPerCompletedRun > 0
    && args.projectAvgTokensPerCompletedRun > 0
    && args.currentWindowAvgTokensPerCompletedRun >= args.projectAvgTokensPerCompletedRun * 1.5
    && args.tokenUsed >= 10_000
  ) {
    reasons.push("平均完成成本偏高");
  }

  const recentMonthly = args.monthly.slice(-2);
  if (
    recentMonthly.length === 2
    && recentMonthly.every(
      (item) =>
        item.avgTokensPerCompletedRun > 0
        && args.projectAvgTokensPerCompletedRun > 0
        && item.avgTokensPerCompletedRun >= args.projectAvgTokensPerCompletedRun * 1.3
        && item.failureRate < 0.3,
    )
  ) {
    reasons.push("连续两个月高消耗");
  }

  const health: ProviderHealth = reasons.length >= 2 ? "risk" : reasons.length === 1 ? "warn" : "healthy";
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
    args.avgTokensPerCompletedRun > 0
    && args.projectAvgTokensPerCompletedRun > 0
    && args.avgTokensPerCompletedRun >= args.projectAvgTokensPerCompletedRun * 1.2;
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
  const accessibleProjectIds = getAccessibleProjectIds(user);

  const projectWhere = accessibleProjectIds == null
    ? eq(tasks.projectId, projectId)
    : and(eq(tasks.projectId, projectId), inArray(tasks.projectId, accessibleProjectIds));

  const runRows = await db
    .select({
      agentRunId: agentRuns.id,
      taskId: agentRuns.taskId,
      projectId: tasks.projectId,
      status: agentRuns.status,
      modelUsed: agentRuns.modelUsed,
      tokenUsed: agentRuns.tokenUsed,
      startedAt: agentRuns.startedAt,
      finishedAt: agentRuns.finishedAt,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .innerJoin(tasks, eq(agentRuns.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(projectWhere);

  const candidateRuns = runRows.filter((run) => resolveRunTimestampMs(run) >= bounds.previousStartMs);
  const candidateRunIds = candidateRuns.map((run) => run.agentRunId).filter(Boolean);

  const guidanceAgentRunIds = new Set<string>();
  if (candidateRunIds.length > 0) {
    const audits = await db
      .select({ agentRunId: auditEvents.agentRunId, eventType: auditEvents.eventType, action: auditEvents.action })
      .from(auditEvents)
      .where(inArray(auditEvents.agentRunId, candidateRunIds));

    for (const audit of audits) {
      if (!audit.agentRunId) continue;
      if (audit.eventType === "guidance" || audit.action.includes("guidance")) {
        guidanceAgentRunIds.add(audit.agentRunId);
      }
    }
  }

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

  for (const run of monthlyWindowRuns) {
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

  for (const run of currentRuns) {
    const timestampMs = resolveRunTimestampMs(run);
    const modelRef = parseModelReference(run.modelUsed);
    const providerId = modelRef.providerId;
    const aggregate = providers.get(providerId) || createProviderAggregate(providerId);
    aggregate.tokenUsed += run.tokenUsed;
    aggregate.totalRuns += 1;
    aggregate.latestRunAtMs = aggregate.latestRunAtMs == null ? timestampMs : Math.max(aggregate.latestRunAtMs, timestampMs);

    const modelAggregate = aggregate.models.get(modelRef.route) || createModelAggregate(modelRef);
    modelAggregate.tokenUsed += run.tokenUsed;
    modelAggregate.totalRuns += 1;
    modelAggregate.latestRunAtMs = modelAggregate.latestRunAtMs == null ? timestampMs : Math.max(modelAggregate.latestRunAtMs, timestampMs);

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
    if (guidanceAgentRunIds.has(run.agentRunId)) {
      aggregate.interventionRuns += 1;
      modelAggregate.interventionRuns += 1;
    }

    const trendBucket = getOrCreateTrendBucket(aggregate.trend, bucketKeyForTimestamp(range, timestampMs));
    trendBucket.tokenUsed += run.tokenUsed;
    if (run.status === "completed") {
      trendBucket.completedRuns += 1;
    }

    aggregate.models.set(modelRef.route, modelAggregate);
    providers.set(providerId, aggregate);
  }

  const totalTokens = currentRuns.reduce((sum, run) => sum + run.tokenUsed, 0);
  const totalRuns = currentRuns.length;
  const completedRuns = currentRuns.filter((run) => run.status === "completed").length;
  const totalCompletedTokens = currentRuns
    .filter((run) => run.status === "completed")
    .reduce((sum, run) => sum + run.tokenUsed, 0);
  const projectAvgTokensPerCompletedRun = completedRuns > 0 ? totalCompletedTokens / completedRuns : 0;

  const providerItems: ProviderResponseItem[] = Array.from(providers.values())
    .map((aggregate) => {
      const tokenShare = totalTokens > 0 ? aggregate.tokenUsed / totalTokens : 0;
      const failureRate = aggregate.totalRuns > 0 ? aggregate.failedRuns / aggregate.totalRuns : 0;
      const interventionRate = aggregate.totalRuns > 0 ? aggregate.interventionRuns / aggregate.totalRuns : 0;
      const avgTokensPerRun = aggregate.totalRuns > 0 ? aggregate.tokenUsed / aggregate.totalRuns : 0;
      const avgTokensPerCompletedRun = aggregate.completedRuns > 0 ? aggregate.tokenUsed / aggregate.completedRuns : 0;
      const monthly = monthlySeries.map((month) => {
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

      const models = Array.from(aggregate.models.values())
        .map((model) => {
          const modelFailureRate = model.totalRuns > 0 ? model.failedRuns / model.totalRuns : 0;
          const modelInterventionRate = model.totalRuns > 0 ? model.interventionRuns / model.totalRuns : 0;
          const modelAvgTokensPerRun = model.totalRuns > 0 ? model.tokenUsed / model.totalRuns : 0;
          const modelAvgTokensPerCompletedRun = model.completedRuns > 0 ? model.tokenUsed / model.completedRuns : 0;
          return {
            route: model.route,
            modelId: model.modelId,
            label: model.label,
            tokenUsed: model.tokenUsed,
            requestCount: model.totalRuns,
            tokenShareWithinProvider: aggregate.tokenUsed > 0 ? model.tokenUsed / aggregate.tokenUsed : 0,
            completedRuns: model.completedRuns,
            failedRuns: model.failedRuns,
            stoppedRuns: model.stoppedRuns,
            interventionRuns: model.interventionRuns,
            totalRuns: model.totalRuns,
            failureRate: modelFailureRate,
            interventionRate: modelInterventionRate,
            avgTokensPerRun: modelAvgTokensPerRun,
            avgTokensPerCompletedRun: modelAvgTokensPerCompletedRun,
            latestRunAt: toIso(model.latestRunAtMs),
          };
        })
        .sort((left, right) => right.tokenUsed - left.tokenUsed || right.requestCount - left.requestCount);

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
        models,
      };
    })
    .sort((left, right) => right.tokenUsed - left.tokenUsed || right.completedRuns - left.completedRuns);

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
    monthlyTotals: monthlySeries.map((month) => {
      const monthRuns = monthlyWindowRuns.filter((run) => bucketKeyForTimestamp("monthly", resolveRunTimestampMs(run)) === month);
      return {
        month,
        tokenUsed: monthRuns.reduce((sum, run) => sum + run.tokenUsed, 0),
        completedRuns: monthRuns.filter((run) => run.status === "completed").length,
      };
    }),
  };

  return c.json({
    projectId,
    range,
    generatedAt: new Date(nowMs).toISOString(),
    summary,
    providers: providerItems,
  });
});