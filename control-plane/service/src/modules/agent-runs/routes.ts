import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db";
import { agentRuns, approvalTickets, auditEvents, codeChanges, projects } from "../../db/schema";
import { type AppEnv, type JWTPayload, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import {
  loadExistingTaskTreeNodeIdsByProjectIds,
  loadTaskTreeRecords,
} from "../project-tree/task-view";

export const agentRunRoutes = new Hono<AppEnv>();

agentRunRoutes.use("*", authMiddleware);
agentRunRoutes.use("*", requireRole("developer"));

type Role = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";
type AgentRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped"
  | "terminated";
type QueueType = "attention" | "running" | "recent";
type BlockerType = "approval" | "stalled" | "manual_resume" | "failed" | "stopped" | null;
type RiskLevel = "low" | "medium" | "high" | "critical" | null;

interface RunFilterOptions {
  projectId?: string;
  taskId?: string;
  agentRunId?: string;
  from?: string;
  to?: string;
  agentType?: string;
  model?: string;
}

interface QueueFilterOptions {
  ownerScope?: string;
  status?: string;
  search?: string;
  requiresIntervention?: boolean;
  riskLevel?: string;
  approvalBlocked?: boolean;
}

const ROLE_HIERARCHY: Record<Role, number> = {
  platform_admin: 5,
  org_admin: 4,
  project_admin: 3,
  developer: 2,
  viewer: 1,
};

interface BaseRunRow {
  agentRunId: string;
  taskId: string;
  taskTitle: string;
  taskUserId: string | null;
  projectId: string;
  projectName: string | null;
  agentType: string;
  status: AgentRunStatus;
  sessionId: string | null;
  modelUsed: string | null;
  tokenUsed: number;
  result: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  taskResult: string | null;
  taskChangesSummary: {
    filesAdded?: number;
    filesModified?: number;
    filesDeleted?: number;
    totalInsertions?: number;
    totalDeletions?: number;
  } | null;
}

interface ApprovalRecord {
  id: string;
  agentRunId: string | null;
  status: string;
  actionType: string;
  riskLevel: RiskLevel;
  createdAt: string;
  resolvedAt: string | null;
}

interface AuditRecord {
  id: string;
  agentRunId: string | null;
  eventType: string;
  action: string;
  riskLevel: RiskLevel;
  ts: string;
  detail: Record<string, unknown> | null;
}

interface ChangeRecord {
  id: string;
  agentRunId: string | null;
  summary: string | null;
  createdAt: string;
}

interface HydratedQueueItem {
  agentRunId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string | null;
  agentType: string;
  status: AgentRunStatus;
  sessionId: string | null;
  currentStage: string | null;
  blockerType: BlockerType;
  blockerLabel: string;
  blockerReason: string | null;
  riskLevel: RiskLevel;
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
  primaryAttentionReason: string | null;
  quickActions: string[];
  actionPermissions: {
    canPause: boolean;
    canResume: boolean;
    canTerminate: boolean;
    canInjectGuidance: boolean;
    canViewApproval: boolean;
    canViewAudit: boolean;
    canViewCodeChanges: boolean;
    canExport: boolean;
  };
}

interface AnalyticsContext {
  baseRuns: BaseRunRow[];
  items: HydratedQueueItem[];
  scopedItems: HydratedQueueItem[];
  runsById: Map<string, BaseRunRow>;
}

function parseDate(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
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

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseTimestampQuery(value?: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseProviderId(modelUsed?: string | null) {
  const value = modelUsed?.trim();
  if (!value) return "";
  const colonIndex = value.indexOf(":");
  if (colonIndex > 0) return value.slice(0, colonIndex);
  const slashIndex = value.indexOf("/");
  if (slashIndex > 0) return value.slice(0, slashIndex);
  return value;
}

function roundPercentage(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function average(numbers: number[]) {
  if (numbers.length === 0) return null;
  return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function includesAny(text: string, candidates: string[]) {
  return candidates.some((candidate) => text.includes(candidate));
}

function isStoppedStatus(status: AgentRunStatus) {
  return status === "stopped" || status === "terminated";
}

function isFailedLikeStatus(status: AgentRunStatus) {
  return status === "failed" || isStoppedStatus(status);
}

function isEndedStatus(status: AgentRunStatus) {
  return status === "completed" || isFailedLikeStatus(status);
}

function incrementCounter(counter: Map<string, number>, key: string) {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function getItemActivityTimestamp(item: HydratedQueueItem) {
  return parseDate(item.finishedAt) ?? parseDate(item.lastActivityAt) ?? parseDate(item.startedAt);
}

function resolveViewScope(user: JWTPayload, ownerScope?: string, projectId?: string) {
  if (ownerScope === "mine") return "mine" as const;
  if (projectId) return "project" as const;
  return (ROLE_HIERARCHY[user.role as Role] ?? 0) >= ROLE_HIERARCHY.org_admin
    ? ("global" as const)
    : ("project" as const);
}

function buildActionPermissions(user: JWTPayload, status: AgentRunStatus) {
  const canOperate = user.role !== "viewer";
  const isAdmin = (ROLE_HIERARCHY[user.role as Role] ?? 0) >= ROLE_HIERARCHY.project_admin;
  return {
    canPause: canOperate && status === "running",
    canResume: canOperate && status === "paused",
    canTerminate: canOperate && (status === "running" || status === "paused"),
    canInjectGuidance: canOperate,
    canViewApproval: canOperate,
    canViewAudit: isAdmin,
    canViewCodeChanges: true,
    canExport: isAdmin,
  };
}

function maxRiskLevel(levels: RiskLevel[]): RiskLevel {
  const order: Record<Exclude<RiskLevel, null>, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return levels.reduce<RiskLevel>((current, candidate) => {
    if (!candidate) return current;
    if (!current) return candidate;
    return order[candidate] > order[current] ? candidate : current;
  }, null);
}

function formatChangesSummary(summary: BaseRunRow["taskChangesSummary"]): string | null {
  if (!summary) return null;
  const files =
    (summary.filesAdded ?? 0) + (summary.filesModified ?? 0) + (summary.filesDeleted ?? 0);
  const insertions = summary.totalInsertions ?? 0;
  const deletions = summary.totalDeletions ?? 0;
  if (!files && !insertions && !deletions) return null;
  return `代码变更 ${files} 个文件，+${insertions} / -${deletions}`;
}

function buildSummaryText(args: {
  run: BaseRunRow;
  latestApproval: ApprovalRecord | null;
  latestAudit: AuditRecord | null;
  latestChange: ChangeRecord | null;
  stalled: boolean;
}): string {
  if (args.run.error?.trim()) return args.run.error.trim();
  if (args.latestApproval?.status === "pending") {
    return `等待审批：${args.latestApproval.actionType}`;
  }
  if (args.latestChange?.summary?.trim()) return args.latestChange.summary.trim();
  if (typeof args.latestAudit?.detail?.message === "string") {
    return args.latestAudit.detail.message;
  }
  if (typeof args.latestAudit?.detail?.reason === "string") {
    return args.latestAudit.detail.reason;
  }
  if (args.run.result?.trim()) return args.run.result.trim().slice(0, 200);
  if (args.run.taskResult?.trim()) return args.run.taskResult.trim().slice(0, 200);
  if (args.stalled) return "运行时间较长且缺少新的持久化信号。";
  return formatChangesSummary(args.run.taskChangesSummary) || "暂无结构化摘要。";
}

function resolveQuickActions(status: AgentRunStatus, blockerType: BlockerType) {
  const actions: string[] = [];
  if (status === "running") actions.push("pause", "inject_guidance");
  if (status === "paused") actions.push("resume", "inject_guidance", "terminate");
  if (status === "failed" || blockerType === "approval" || blockerType === "stalled") {
    actions.push("review", "inject_guidance");
  }
  if (status === "running" || status === "paused") actions.push("terminate");
  return Array.from(new Set(actions));
}

function readRunFilters(c: {
  req: { query: (name: string) => string | undefined };
}): RunFilterOptions {
  return {
    projectId: c.req.query("projectId"),
    taskId: c.req.query("taskId"),
    agentRunId: c.req.query("agentRunId"),
    from: c.req.query("from"),
    to: c.req.query("to"),
    agentType: c.req.query("agentType"),
    model: c.req.query("model"),
  };
}

function readQueueFilters(c: {
  req: { query: (name: string) => string | undefined };
}): QueueFilterOptions {
  return {
    ownerScope: c.req.query("ownerScope") || undefined,
    status: c.req.query("status") || undefined,
    search: c.req.query("search") || undefined,
    requiresIntervention: parseBool(c.req.query("requiresIntervention")),
    riskLevel: c.req.query("riskLevel") || undefined,
    approvalBlocked: parseBool(c.req.query("approvalBlocked")),
  };
}

async function loadAnalyticsContext(
  user: JWTPayload,
  runFilters: RunFilterOptions,
  queueFilters: QueueFilterOptions,
): Promise<AnalyticsContext> {
  const baseRuns = await loadBaseRuns(user, runFilters);
  const runIds = baseRuns.map((run) => run.agentRunId);
  const related = await loadRelatedMaps(runIds);
  const items = baseRuns.map((run) =>
    hydrateQueueItem(
      user,
      run,
      related.approvalsByRunId.get(run.agentRunId) || [],
      related.auditsByRunId.get(run.agentRunId) || [],
      related.changesByRunId.get(run.agentRunId) || [],
    ),
  );
  const runsById = new Map(baseRuns.map((run) => [run.agentRunId, run]));
  const scopedItems = applySharedFilters(items, queueFilters, user.sub, runsById);
  return { baseRuns, items, scopedItems, runsById };
}

function normalizeFailureReason(item: HydratedQueueItem) {
  const text = `${item.blockerReason || ""} ${item.resultSummary || ""}`.toLowerCase();
  if (item.blockerType === "approval") return "审批阻塞";
  if (item.blockerType === "stalled") return "长时间无进展";
  if (item.blockerType === "manual_resume") return "等待人工恢复";
  if (item.blockerType === "stopped") return "人工停止待处理";
  if (includesAny(text, ["timeout", "超时"])) return "执行超时";
  if (includesAny(text, ["auth", "权限", "credential", "凭证"])) {
    return "认证或权限异常";
  }
  if (includesAny(text, ["model", "provider", "copilot"])) {
    return "模型或 Provider 异常";
  }
  if (includesAny(text, ["json", "schema", "parse", "结构化"])) {
    return "结构化结果异常";
  }
  return item.blockerType === "failed" || item.status === "failed" ? "执行失败" : "需要人工处理";
}

function buildBreakdownItems(entries: Array<[string, number]>, total: number) {
  return entries
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => ({
      key,
      label: key,
      count,
      share: roundPercentage(count, total),
    }));
}

function buildRanking(
  items: HydratedQueueItem[],
  keySelector: (item: HydratedQueueItem) => string,
  labelSelector: (item: HydratedQueueItem) => string,
) {
  const grouped = new Map<string, { label: string; items: HydratedQueueItem[] }>();
  for (const item of items) {
    const key = keySelector(item).trim() || "unknown";
    const existing = grouped.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    grouped.set(key, { label: labelSelector(item).trim() || key, items: [item] });
  }

  return Array.from(grouped.entries())
    .map(([key, group]) => {
      const ended = group.items.filter((item) =>
        ["completed", "failed", "stopped", "terminated"].includes(item.status),
      );
      const completedRuns = group.items.filter((item) => item.status === "completed").length;
      const failedRuns = group.items.filter((item) =>
        ["failed", "stopped", "terminated"].includes(item.status),
      ).length;
      const interventionCount = group.items.filter(
        (item) => item.guidanceCount > 0 || item.requiresIntervention,
      ).length;
      const durationValues = ended
        .map((item) => item.durationMs)
        .filter((value): value is number => value != null && Number.isFinite(value));
      const tokenValues = group.items
        .map((item) => item.tokenUsed)
        .filter((value) => Number.isFinite(value) && value > 0);
      return {
        key,
        label: group.label,
        totalRuns: group.items.length,
        completedRuns,
        failedRuns,
        attentionCount: group.items.filter((item) => item.requiresIntervention).length,
        interventionCount,
        successRate: roundPercentage(completedRuns, ended.length || group.items.length),
        failureRate: roundPercentage(failedRuns, ended.length || group.items.length),
        avgDurationMs: average(durationValues),
        avgTokenUsed: average(tokenValues),
      };
    })
    .sort((left, right) => right.totalRuns - left.totalRuns || right.failureRate - left.failureRate)
    .slice(0, 6);
}

function toTimelineBucketKey(timestamp: number, bucketUnit: "hour" | "day") {
  const date = new Date(timestamp);
  if (bucketUnit === "hour") {
    return `${date.toISOString().slice(0, 13)}:00:00.000Z`;
  }
  return date.toISOString().slice(0, 10);
}

function toTimelineLabel(bucketKey: string, bucketUnit: "hour" | "day") {
  return bucketUnit === "hour" ? bucketKey.slice(5, 13).replace("T", " ") : bucketKey.slice(5, 10);
}

function getLastActivityMs(args: {
  run: BaseRunRow;
  latestApproval: ApprovalRecord | null;
  latestAudit: AuditRecord | null;
  latestChange: ChangeRecord | null;
}) {
  const activityCandidates = [
    parseDate(args.run.finishedAt),
    parseDate(args.run.startedAt),
    parseDate(args.run.createdAt),
    parseDate(args.latestApproval?.resolvedAt),
    parseDate(args.latestApproval?.createdAt),
    parseDate(args.latestAudit?.ts),
    parseDate(args.latestChange?.createdAt),
  ].filter((value): value is number => value != null);

  return activityCandidates.length > 0 ? Math.max(...activityCandidates) : null;
}

function getDurationMs(run: BaseRunRow) {
  const finishedAtMs = parseDate(run.finishedAt);
  const startedAtMs = parseDate(run.startedAt);
  return startedAtMs != null ? Math.max(0, (finishedAtMs ?? Date.now()) - startedAtMs) : null;
}

function resolveBlockerState(args: {
  status: AgentRunStatus;
  pendingApproval: ApprovalRecord | null;
  stalled: boolean;
}) {
  if (args.pendingApproval) {
    return { blockerType: "approval" as const, blockerLabel: "审批阻塞" };
  }
  if (args.status === "failed") {
    return { blockerType: "failed" as const, blockerLabel: "执行失败" };
  }
  if (args.status === "paused") {
    return { blockerType: "manual_resume" as const, blockerLabel: "等待人工恢复" };
  }
  if (isStoppedStatus(args.status)) {
    return { blockerType: "stopped" as const, blockerLabel: "已停止待处理" };
  }
  if (args.stalled) {
    return { blockerType: "stalled" as const, blockerLabel: "长时间无进展" };
  }
  if (args.status === "completed") {
    return { blockerType: null, blockerLabel: "已完成" };
  }
  if (args.status === "running") {
    return { blockerType: null, blockerLabel: "推进中" };
  }

  return { blockerType: null, blockerLabel: "运行正常" };
}

function hydrateQueueItem(
  user: JWTPayload,
  run: BaseRunRow,
  approvals: ApprovalRecord[],
  audits: AuditRecord[],
  changes: ChangeRecord[],
): HydratedQueueItem {
  const latestApproval = approvals[0] ?? null;
  const latestAudit = audits[0] ?? null;
  const latestChange = changes[0] ?? null;
  const lastActivityMs = getLastActivityMs({ run, latestApproval, latestAudit, latestChange });
  const durationMs = getDurationMs(run);
  const stalled =
    run.status === "running" &&
    lastActivityMs != null &&
    Date.now() - lastActivityMs > 10 * 60 * 1000;
  const pendingApproval = approvals.find((approval) => approval.status === "pending") ?? null;
  const blockerState = resolveBlockerState({
    status: run.status,
    pendingApproval,
    stalled,
  });

  const riskLevel = maxRiskLevel([
    ...approvals.map((approval) => approval.riskLevel),
    ...audits.map((audit) => audit.riskLevel),
  ]);
  const guidanceCount = audits.filter(
    (audit) => audit.eventType === "guidance" || audit.action.includes("guidance"),
  ).length;
  const summary = buildSummaryText({ run, latestApproval, latestAudit, latestChange, stalled });

  return {
    agentRunId: run.agentRunId,
    taskId: run.taskId,
    taskTitle: run.taskTitle,
    projectId: run.projectId,
    projectName: run.projectName,
    agentType: run.agentType,
    status: run.status,
    sessionId: run.sessionId,
    currentStage: null,
    blockerType: blockerState.blockerType,
    blockerLabel: blockerState.blockerLabel,
    blockerReason: summary,
    riskLevel,
    approvalStatus: pendingApproval?.status || latestApproval?.status || null,
    requiresIntervention: blockerState.blockerType !== null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    lastActivityAt: lastActivityMs != null ? new Date(lastActivityMs).toISOString() : null,
    durationMs,
    modelUsed: run.modelUsed,
    tokenUsed: run.tokenUsed,
    resultSummary: summary,
    guidanceCount,
    primaryAttentionReason: blockerState.blockerType ? summary : null,
    quickActions: resolveQuickActions(run.status, blockerState.blockerType),
    actionPermissions: buildActionPermissions(user, run.status),
  };
}

function buildRunQueryConditions(user: JWTPayload, filters: RunFilterOptions) {
  const accessibleProjects = getAccessibleProjectIds(user);
  if (filters.projectId && !hasProjectAccess(user, filters.projectId)) {
    return { accessibleProjects, conditions: null as null };
  }
  if (accessibleProjects && accessibleProjects.length === 0) {
    return { accessibleProjects, conditions: null as null };
  }

  const conditions = [];
  if (filters.taskId) {
    conditions.push(eq(agentRuns.taskId, filters.taskId));
  }
  if (filters.agentRunId) {
    conditions.push(eq(agentRuns.id, filters.agentRunId));
  }

  return { accessibleProjects, conditions };
}

async function resolveScopedTaskIdsForRuns(
  accessibleProjects: string[] | null,
  filters: RunFilterOptions,
) {
  const scopedProjectIds = filters.projectId
    ? [filters.projectId]
    : accessibleProjects && accessibleProjects.length > 0
      ? accessibleProjects
      : null;

  if (!scopedProjectIds) {
    return null;
  }

  return loadExistingTaskTreeNodeIdsByProjectIds(scopedProjectIds);
}

function matchesRunFilters(
  row: BaseRunRow,
  normalizedAgentType: string | undefined,
  normalizedModel: string | undefined,
  fromMs: number | null,
  toMs: number | null,
) {
  if (normalizedAgentType && !row.agentType.toLowerCase().includes(normalizedAgentType)) {
    return false;
  }
  if (normalizedModel) {
    const modelUsed = row.modelUsed?.toLowerCase() || "";
    const providerId = parseProviderId(row.modelUsed).toLowerCase();
    if (!modelUsed.includes(normalizedModel) && providerId !== normalizedModel) {
      return false;
    }
  }

  const activityMs =
    parseDate(row.finishedAt) ?? parseDate(row.startedAt) ?? parseDate(row.createdAt);
  if (fromMs != null && activityMs != null && activityMs < fromMs) {
    return false;
  }
  if (toMs != null && activityMs != null && activityMs > toMs) {
    return false;
  }
  return true;
}

function groupAndSortByRunId<T extends { agentRunId: string | null }>(
  rows: T[],
  getTimestamp: (row: T) => string,
) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.agentRunId) continue;
    const items = grouped.get(row.agentRunId) || [];
    items.push(row);
    grouped.set(row.agentRunId, items);
  }
  for (const items of grouped.values()) {
    items.sort((left, right) => Date.parse(getTimestamp(right)) - Date.parse(getTimestamp(left)));
  }
  return grouped;
}

function toRiskLabel(riskLevel: RiskLevel) {
  if (riskLevel === "critical") return "严重风险";
  if (riskLevel === "high") return "高风险";
  if (riskLevel === "medium") return "中风险";
  return "低风险";
}

function createEmptyTimelineResponse() {
  return {
    generatedAt: new Date().toISOString(),
    bucketUnit: "day" as const,
    buckets: [],
  };
}

function buildTimelineBuckets(scopedItems: HydratedQueueItem[]) {
  const timestamps = scopedItems
    .map(getItemActivityTimestamp)
    .filter((value): value is number => value != null);

  if (timestamps.length === 0) {
    return null;
  }

  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const bucketUnit = maxTs - minTs <= 48 * 60 * 60 * 1000 ? "hour" : "day";
  const buckets = new Map<
    string,
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

  for (const item of scopedItems) {
    const timestamp = getItemActivityTimestamp(item);
    if (timestamp == null) continue;
    const bucket = toTimelineBucketKey(timestamp, bucketUnit);
    const existing = buckets.get(bucket) ?? {
      bucket,
      label: toTimelineLabel(bucket, bucketUnit),
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      attentionRuns: 0,
      interventionRuns: 0,
    };

    existing.totalRuns += 1;
    if (item.status === "completed") existing.completedRuns += 1;
    if (isFailedLikeStatus(item.status)) existing.failedRuns += 1;
    if (item.requiresIntervention) existing.attentionRuns += 1;
    if (item.guidanceCount > 0 || item.requiresIntervention) existing.interventionRuns += 1;
    buckets.set(bucket, existing);
  }

  return {
    generatedAt: new Date().toISOString(),
    bucketUnit,
    buckets: Array.from(buckets.values())
      .sort((left, right) => left.bucket.localeCompare(right.bucket))
      .slice(-12),
  };
}

function buildLatestEvents(
  approvals: ApprovalRecord[],
  audits: AuditRecord[],
  changes: ChangeRecord[],
) {
  return [
    ...approvals.map((approval) => ({
      ts: approval.resolvedAt || approval.createdAt,
      type: `approval.${approval.status}`,
      summary: `审批 ${approval.status} · ${approval.actionType}`,
    })),
    ...audits.map((audit) => ({
      ts: audit.ts,
      type: `${audit.eventType}.${audit.action}`,
      summary:
        (typeof audit.detail?.message === "string" && audit.detail.message) ||
        (typeof audit.detail?.reason === "string" && audit.detail.reason) ||
        audit.action,
    })),
    ...changes.map((change) => ({
      ts: change.createdAt,
      type: "code_change.recorded",
      summary: change.summary || "记录了新的代码变更。",
    })),
  ]
    .sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts))
    .slice(0, 12);
}

function buildGovernanceSummary(
  approvals: ApprovalRecord[],
  audits: AuditRecord[],
  latestApproval: ApprovalRecord | null,
  latestHighRiskAudit: AuditRecord | null,
) {
  return {
    approvalTickets: approvals.length,
    pendingApprovals: approvals.filter((approval) => approval.status === "pending").length,
    latestApprovalStatus: latestApproval?.status || null,
    recentAuditEvents: audits.length,
    latestHighRiskAction:
      (typeof latestHighRiskAudit?.detail?.message === "string" &&
        latestHighRiskAudit.detail.message) ||
      latestHighRiskAudit?.action ||
      null,
  };
}

function buildCodeChangesSummary(run: BaseRunRow, changes: ChangeRecord[]) {
  return {
    changeCount: changes.length,
    files:
      (run.taskChangesSummary?.filesAdded ?? 0) +
      (run.taskChangesSummary?.filesModified ?? 0) +
      (run.taskChangesSummary?.filesDeleted ?? 0),
    insertions: run.taskChangesSummary?.totalInsertions ?? 0,
    deletions: run.taskChangesSummary?.totalDeletions ?? 0,
    latestSummary: changes[0]?.summary || formatChangesSummary(run.taskChangesSummary),
  };
}

async function loadBaseRuns(
  user: JWTPayload,
  filters: RunFilterOptions = {},
): Promise<BaseRunRow[]> {
  const { conditions, accessibleProjects } = buildRunQueryConditions(user, filters);
  if (conditions === null) {
    return [];
  }

  const scopedTaskIds = filters.taskId
    ? [filters.taskId]
    : await resolveScopedTaskIdsForRuns(accessibleProjects, filters);

  if (scopedTaskIds && scopedTaskIds.length === 0) {
    return [];
  }

  if (scopedTaskIds) {
    conditions.push(inArray(agentRuns.taskId, scopedTaskIds));
  }

  const runRows = await db
    .select({
      agentRunId: agentRuns.id,
      taskId: agentRuns.taskId,
      agentType: agentRuns.agentType,
      status: agentRuns.status,
      sessionId: agentRuns.sessionId,
      modelUsed: agentRuns.modelUsed,
      tokenUsed: agentRuns.tokenUsed,
      result: agentRuns.result,
      error: agentRuns.error,
      startedAt: agentRuns.startedAt,
      finishedAt: agentRuns.finishedAt,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentRuns.createdAt));

  const taskIds = Array.from(new Set(runRows.map((row) => row.taskId).filter(Boolean)));
  const taskRows = await loadTaskTreeRecords({ taskIds });
  const visibleTasks = taskRows.filter((task) => {
    if (filters.projectId && task.projectId !== filters.projectId) {
      return false;
    }
    if (accessibleProjects && !accessibleProjects.includes(task.projectId)) {
      return false;
    }
    return true;
  });
  const taskById = new Map(visibleTasks.map((task) => [task.id, task] as const));
  const projectIds = Array.from(new Set(visibleTasks.map((task) => task.projectId)));
  const projectRows =
    projectIds.length > 0
      ? await db.query.projects.findMany({ where: inArray(projects.id, projectIds) })
      : [];
  const projectById = new Map(projectRows.map((project) => [project.id, project] as const));

  const rows = runRows.flatMap((run) => {
    const task = taskById.get(run.taskId);
    if (!task) {
      return [];
    }

    return [
      {
        agentRunId: run.agentRunId,
        taskId: task.id,
        taskTitle: task.title,
        taskUserId: task.userId,
        projectId: task.projectId,
        projectName: projectById.get(task.projectId)?.name ?? null,
        agentType: run.agentType,
        status: run.status,
        sessionId: run.sessionId,
        modelUsed: run.modelUsed,
        tokenUsed: run.tokenUsed,
        result: run.result,
        error: run.error,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
        taskResult: task.result,
        taskChangesSummary: task.changesSummary,
      } satisfies BaseRunRow,
    ];
  });

  const fromMs = parseTimestampQuery(filters.from);
  const toMs = parseTimestampQuery(filters.to);
  const normalizedAgentType = filters.agentType?.trim().toLowerCase();
  const normalizedModel = filters.model?.trim().toLowerCase();

  return (rows as BaseRunRow[]).filter((row) =>
    matchesRunFilters(row, normalizedAgentType, normalizedModel, fromMs, toMs),
  );
}

async function loadRelatedMaps(runIds: string[]) {
  if (runIds.length === 0) {
    return {
      approvalsByRunId: new Map<string, ApprovalRecord[]>(),
      auditsByRunId: new Map<string, AuditRecord[]>(),
      changesByRunId: new Map<string, ChangeRecord[]>(),
    };
  }

  const [approvalRows, auditRows, changeRows] = await Promise.all([
    db
      .select()
      .from(approvalTickets)
      .where(inArray(approvalTickets.agentRunId, runIds as string[])),
    db
      .select()
      .from(auditEvents)
      .where(inArray(auditEvents.agentRunId, runIds as string[])),
    db
      .select()
      .from(codeChanges)
      .where(inArray(codeChanges.agentRunId, runIds as string[])),
  ]);

  return {
    approvalsByRunId: groupAndSortByRunId(approvalRows as ApprovalRecord[], (row) => row.createdAt),
    auditsByRunId: groupAndSortByRunId(auditRows as AuditRecord[], (row) => row.ts),
    changesByRunId: groupAndSortByRunId(changeRows as ChangeRecord[], (row) => row.createdAt),
  };
}

function applySharedFilters(
  items: HydratedQueueItem[],
  filters: QueueFilterOptions,
  userId: string,
  runsById: Map<string, BaseRunRow>,
) {
  let filtered = items;
  if (filters.ownerScope === "mine") {
    filtered = filtered.filter((item) => runsById.get(item.agentRunId)?.taskUserId === userId);
  }

  if (filters.status) {
    filtered = filtered.filter((item) => item.status === filters.status);
  }
  if (filters.requiresIntervention !== undefined) {
    filtered = filtered.filter(
      (item) => item.requiresIntervention === filters.requiresIntervention,
    );
  }
  if (filters.riskLevel) {
    filtered = filtered.filter((item) => item.riskLevel === filters.riskLevel);
  }
  if (filters.approvalBlocked !== undefined) {
    filtered = filtered.filter(
      (item) => (item.blockerType === "approval") === filters.approvalBlocked,
    );
  }
  if (filters.search) {
    const search = filters.search.trim().toLowerCase();
    if (search) {
      filtered = filtered.filter((item) => {
        const run = runsById.get(item.agentRunId);
        return (
          item.agentRunId.toLowerCase().includes(search) ||
          item.agentType.toLowerCase().includes(search) ||
          item.taskId.toLowerCase().includes(search) ||
          item.taskTitle.toLowerCase().includes(search) ||
          (item.projectName || "").toLowerCase().includes(search) ||
          (run?.modelUsed || "").toLowerCase().includes(search)
        );
      });
    }
  }

  return filtered;
}

function filterQueueItems(
  items: HydratedQueueItem[],
  queue: QueueType,
  filters: QueueFilterOptions,
  userId: string,
  runsById: Map<string, BaseRunRow>,
) {
  const filtered = applySharedFilters(items, filters, userId, runsById);
  if (queue === "attention") {
    return filtered.filter((item) => item.requiresIntervention);
  }
  if (queue === "running") {
    return filtered.filter((item) => item.status === "running" && !item.requiresIntervention);
  }

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return filtered.filter((item) => {
    if (!["completed", "failed", "stopped", "terminated"].includes(item.status)) return false;
    const finishedAtMs = parseDate(item.finishedAt) ?? parseDate(item.lastActivityAt);
    return finishedAtMs != null && finishedAtMs >= cutoff;
  });
}

agentRunRoutes.get("/overview", async (c) => {
  const user = c.get("user");
  const filters = readRunFilters(c);
  const sharedFilters = readQueueFilters(c);
  const ownerScope = sharedFilters.ownerScope;
  const baseRuns = await loadBaseRuns(user, filters);
  const runIds = baseRuns.map((run) => run.agentRunId);
  const related = await loadRelatedMaps(runIds);
  const items = baseRuns.map((run) =>
    hydrateQueueItem(
      user,
      run,
      related.approvalsByRunId.get(run.agentRunId) || [],
      related.auditsByRunId.get(run.agentRunId) || [],
      related.changesByRunId.get(run.agentRunId) || [],
    ),
  );
  const runsById = new Map(baseRuns.map((run) => [run.agentRunId, run]));
  const scopedItems = applySharedFilters(items, sharedFilters, user.sub, runsById);
  const attention = filterQueueItems(items, "attention", sharedFilters, user.sub, runsById);
  const running = filterQueueItems(items, "running", sharedFilters, user.sub, runsById);
  const recent = filterQueueItems(items, "recent", sharedFilters, user.sub, runsById);
  const endedRecent = recent.filter((item) => isEndedStatus(item.status));
  const failedRecent = endedRecent.filter((item) => isFailedLikeStatus(item.status));
  const avgDurationMs =
    endedRecent.length > 0
      ? Math.round(
          endedRecent.reduce((sum, item) => sum + (item.durationMs || 0), 0) / endedRecent.length,
        )
      : null;
  const humanInterventionRate =
    scopedItems.length > 0
      ? Number(
          (
            (scopedItems.filter((item) => item.guidanceCount > 0 || item.requiresIntervention)
              .length /
              scopedItems.length) *
            100
          ).toFixed(2),
        )
      : 0;

  return c.json({
    viewScope: resolveViewScope(user, ownerScope, filters.projectId),
    summary: {
      attentionCount: attention.length,
      runningCount: running.length,
      completedCount: recent.filter((item) => item.status === "completed").length,
      failureRate:
        endedRecent.length > 0
          ? Number(((failedRecent.length / endedRecent.length) * 100).toFixed(2))
          : 0,
      avgDurationMs,
      humanInterventionRate,
    },
    queueCounts: {
      attention: attention.length,
      running: running.length,
      recent: recent.length,
    },
    blockerBreakdown: {
      failedHighRisk: scopedItems.filter(
        (item) =>
          item.blockerType === "failed" &&
          (item.riskLevel === "high" || item.riskLevel === "critical"),
      ).length,
      approvalBlocked: scopedItems.filter((item) => item.blockerType === "approval").length,
      pausedAwaitingResume: scopedItems.filter((item) => item.blockerType === "manual_resume")
        .length,
      stalled: scopedItems.filter((item) => item.blockerType === "stalled").length,
      stoppedPendingReview: scopedItems.filter((item) => item.blockerType === "stopped").length,
    },
    generatedAt: new Date().toISOString(),
  });
});

agentRunRoutes.get("/queues", async (c) => {
  const user = c.get("user");
  const filters = readRunFilters(c);
  const queue = (c.req.query("queue") || "attention") as QueueType;
  const page = parsePositiveInt(c.req.query("page"), 1);
  const pageSize = Math.min(parsePositiveInt(c.req.query("pageSize"), 20), 100);
  const filterOptions = readQueueFilters(c);

  const baseRuns = await loadBaseRuns(user, filters);
  const runIds = baseRuns.map((run) => run.agentRunId);
  const related = await loadRelatedMaps(runIds);
  const items = baseRuns.map((run) =>
    hydrateQueueItem(
      user,
      run,
      related.approvalsByRunId.get(run.agentRunId) || [],
      related.auditsByRunId.get(run.agentRunId) || [],
      related.changesByRunId.get(run.agentRunId) || [],
    ),
  );
  const runsById = new Map(baseRuns.map((run) => [run.agentRunId, run]));
  const filtered = filterQueueItems(items, queue, filterOptions, user.sub, runsById);

  filtered.sort((left, right) => {
    const rightTime =
      parseDate(right.lastActivityAt) ??
      parseDate(right.finishedAt) ??
      parseDate(right.startedAt) ??
      0;
    const leftTime =
      parseDate(left.lastActivityAt) ??
      parseDate(left.finishedAt) ??
      parseDate(left.startedAt) ??
      0;
    return rightTime - leftTime;
  });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);

  return c.json({ data, page, pageSize, total });
});

agentRunRoutes.get("/analytics/health", async (c) => {
  const user = c.get("user");
  const runFilters = readRunFilters(c);
  const queueFilters = readQueueFilters(c);
  const { scopedItems } = await loadAnalyticsContext(user, runFilters, queueFilters);
  const endedItems = scopedItems.filter((item) => isEndedStatus(item.status));
  const completedRuns = scopedItems.filter((item) => item.status === "completed").length;
  const failedRuns = scopedItems.filter((item) => isFailedLikeStatus(item.status)).length;
  const humanInterventionRuns = scopedItems.filter(
    (item) => item.guidanceCount > 0 || item.requiresIntervention,
  ).length;
  const durationValues = endedItems
    .map((item) => item.durationMs)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return c.json({
    viewScope: resolveViewScope(user, queueFilters.ownerScope, runFilters.projectId),
    generatedAt: new Date().toISOString(),
    totals: {
      totalRuns: scopedItems.length,
      completedRuns,
      failedRuns,
      stoppedRuns: scopedItems.filter(
        (item) => item.status === "stopped" || item.status === "terminated",
      ).length,
      humanInterventionRuns,
      attentionRuns: scopedItems.filter((item) => item.requiresIntervention).length,
      approvalBlockedRuns: scopedItems.filter((item) => item.blockerType === "approval").length,
      avgDurationMs: average(durationValues),
      failureRate: roundPercentage(failedRuns, endedItems.length || scopedItems.length),
      interventionRate: roundPercentage(humanInterventionRuns, scopedItems.length),
    },
    agentRanking: buildRanking(
      scopedItems,
      (item) => item.agentType,
      (item) => item.agentType,
    ),
    modelRanking: buildRanking(
      scopedItems,
      (item) => item.modelUsed || "unknown",
      (item) => item.modelUsed || "未记录模型",
    ),
  });
});

agentRunRoutes.get("/analytics/failures", async (c) => {
  const user = c.get("user");
  const runFilters = readRunFilters(c);
  const queueFilters = readQueueFilters(c);
  const { scopedItems } = await loadAnalyticsContext(user, runFilters, queueFilters);
  const attentionItems = scopedItems.filter((item) => item.requiresIntervention);
  const blockerCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();
  const riskCounts = new Map<string, number>();

  for (const item of attentionItems) {
    incrementCounter(blockerCounts, item.blockerLabel || "其他异常");
    incrementCounter(reasonCounts, normalizeFailureReason(item));
  }

  for (const item of scopedItems) {
    if (!item.riskLevel) continue;
    incrementCounter(riskCounts, toRiskLabel(item.riskLevel));
  }

  return c.json({
    generatedAt: new Date().toISOString(),
    totalAttentionRuns: attentionItems.length,
    blockerBreakdown: buildBreakdownItems(
      Array.from(blockerCounts.entries()),
      attentionItems.length,
    ),
    failureReasons: buildBreakdownItems(Array.from(reasonCounts.entries()), attentionItems.length),
    riskBreakdown: buildBreakdownItems(Array.from(riskCounts.entries()), scopedItems.length),
  });
});

agentRunRoutes.get("/analytics/timeline", async (c) => {
  const user = c.get("user");
  const runFilters = readRunFilters(c);
  const queueFilters = readQueueFilters(c);
  const { scopedItems } = await loadAnalyticsContext(user, runFilters, queueFilters);
  return c.json(buildTimelineBuckets(scopedItems) ?? createEmptyTimelineResponse());
});

agentRunRoutes.get("/:agentRunId/summary", async (c) => {
  const user = c.get("user");
  const agentRunId = c.req.param("agentRunId");
  const entryContext = c.req.query("entryContext") || undefined;
  const ownerScope = c.req.query("ownerScope") || undefined;
  const baseRuns = await loadBaseRuns(user, { agentRunId });
  const run = baseRuns.find((item) => item.agentRunId === agentRunId);
  if (!run) {
    return c.json({ error: "Agent run not found" }, 404);
  }

  const related = await loadRelatedMaps([agentRunId]);
  const approvals = related.approvalsByRunId.get(agentRunId) || [];
  const audits = related.auditsByRunId.get(agentRunId) || [];
  const changes = related.changesByRunId.get(agentRunId) || [];
  const item = hydrateQueueItem(user, run, approvals, audits, changes);
  const latestApproval = approvals[0] ?? null;
  const latestHighRiskAudit =
    audits.find((audit) => audit.riskLevel === "critical" || audit.riskLevel === "high") ?? null;

  return c.json({
    entryContext,
    viewScope: resolveViewScope(user, ownerScope, run.projectId ?? undefined),
    agentRunId: run.agentRunId,
    taskId: run.taskId,
    taskTitle: run.taskTitle,
    projectId: run.projectId,
    projectName: run.projectName,
    agentType: run.agentType,
    status: run.status,
    sessionId: run.sessionId,
    modelUsed: run.modelUsed,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    lastActivityAt: item.lastActivityAt,
    durationMs: item.durationMs,
    tokenUsed: run.tokenUsed,
    blockerType: item.blockerType,
    blockerLabel: item.blockerLabel,
    riskLevel: item.riskLevel,
    guidanceCount: item.guidanceCount,
    resultSummary: item.resultSummary,
    result: run.result || run.taskResult,
    error: run.error,
    longSummary: item.resultSummary,
    latestEvents: buildLatestEvents(approvals, audits, changes),
    actionPermissions: item.actionPermissions,
    governance: buildGovernanceSummary(approvals, audits, latestApproval, latestHighRiskAudit),
    codeChanges: buildCodeChangesSummary(run, changes),
  });
});
