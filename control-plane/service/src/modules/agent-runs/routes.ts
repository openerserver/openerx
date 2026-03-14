import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db";
import {
  agentRuns,
  approvalTickets,
  auditEvents,
  codeChanges,
  projects,
  taskNodes,
  tasks,
} from "../../db/schema";
import { type AppEnv, type JWTPayload, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const agentRunRoutes = new Hono<AppEnv>();

agentRunRoutes.use("*", authMiddleware);
agentRunRoutes.use("*", requireRole("developer"));

type Role = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";
type AgentRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "stopped" | "terminated";
type QueueType = "attention" | "running" | "recent";
type BlockerType = "approval" | "stalled" | "manual_resume" | "failed" | "stopped" | null;
type RiskLevel = "low" | "medium" | "high" | "critical" | null;

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
  taskUserId: string;
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
  const files = (summary.filesAdded ?? 0) + (summary.filesModified ?? 0) + (summary.filesDeleted ?? 0);
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

function hydrateQueueItem(
  run: BaseRunRow,
  approvals: ApprovalRecord[],
  audits: AuditRecord[],
  changes: ChangeRecord[],
): HydratedQueueItem {
  const latestApproval = approvals[0] ?? null;
  const latestAudit = audits[0] ?? null;
  const latestChange = changes[0] ?? null;
  const activityCandidates = [
    parseDate(run.finishedAt),
    parseDate(run.startedAt),
    parseDate(run.createdAt),
    parseDate(latestApproval?.resolvedAt),
    parseDate(latestApproval?.createdAt),
    parseDate(latestAudit?.ts),
    parseDate(latestChange?.createdAt),
  ].filter((value): value is number => value != null);
  const lastActivityMs = activityCandidates.length > 0 ? Math.max(...activityCandidates) : null;
  const finishedAtMs = parseDate(run.finishedAt);
  const startedAtMs = parseDate(run.startedAt);
  const durationMs = startedAtMs != null ? Math.max(0, (finishedAtMs ?? Date.now()) - startedAtMs) : null;
  const stalled = run.status === "running" && lastActivityMs != null && Date.now() - lastActivityMs > 10 * 60 * 1000;
  const pendingApproval = approvals.find((approval) => approval.status === "pending") ?? null;

  let blockerType: BlockerType = null;
  let blockerLabel = "运行正常";
  if (pendingApproval) {
    blockerType = "approval";
    blockerLabel = "审批阻塞";
  } else if (run.status === "failed") {
    blockerType = "failed";
    blockerLabel = "执行失败";
  } else if (run.status === "paused") {
    blockerType = "manual_resume";
    blockerLabel = "等待人工恢复";
  } else if (run.status === "stopped" || run.status === "terminated") {
    blockerType = "stopped";
    blockerLabel = "已停止待处理";
  } else if (stalled) {
    blockerType = "stalled";
    blockerLabel = "长时间无进展";
  } else if (run.status === "completed") {
    blockerLabel = "已完成";
  } else if (run.status === "running") {
    blockerLabel = "推进中";
  }

  const riskLevel = maxRiskLevel([
    ...approvals.map((approval) => approval.riskLevel),
    ...audits.map((audit) => audit.riskLevel),
  ]);
  const guidanceCount = audits.filter((audit) => audit.eventType === "guidance" || audit.action.includes("guidance")).length;
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
    blockerType,
    blockerLabel,
    blockerReason: summary,
    riskLevel,
    approvalStatus: pendingApproval?.status || latestApproval?.status || null,
    requiresIntervention: blockerType !== null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    lastActivityAt: lastActivityMs != null ? new Date(lastActivityMs).toISOString() : null,
    durationMs,
    modelUsed: run.modelUsed,
    tokenUsed: run.tokenUsed,
    resultSummary: summary,
    guidanceCount,
  };
}

async function loadBaseRuns(user: JWTPayload, projectId?: string): Promise<BaseRunRow[]> {
  if (projectId && !hasProjectAccess(user, projectId)) {
    return [];
  }

  const accessibleProjects = getAccessibleProjectIds(user);
  if (accessibleProjects && accessibleProjects.length === 0) {
    return [];
  }

  const conditions = [];
  if (projectId) {
    conditions.push(eq(tasks.projectId, projectId));
  } else if (accessibleProjects) {
    conditions.push(inArray(tasks.projectId, accessibleProjects));
  }

  const rows = await db
    .select({
      agentRunId: agentRuns.id,
      taskId: tasks.id,
      taskTitle: tasks.title,
      taskUserId: tasks.userId,
      projectId: tasks.projectId,
      projectName: projects.name,
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
      taskResult: tasks.result,
      taskChangesSummary: tasks.changesSummary,
    })
    .from(agentRuns)
    .innerJoin(tasks, eq(agentRuns.taskId, tasks.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentRuns.createdAt));

  const sessionIds = rows
    .map((row) => row.sessionId)
    .filter((value): value is string => Boolean(value));

  const tokenUsageBySessionId = new Map<string, number>();
  if (sessionIds.length > 0) {
    const nodeRows = await db
      .select({
        sessionId: taskNodes.sessionId,
        tokenUsed: taskNodes.tokenUsed,
      })
      .from(taskNodes)
      .where(inArray(taskNodes.sessionId, sessionIds));

    for (const row of nodeRows) {
      if (!row.sessionId) continue;
      tokenUsageBySessionId.set(
        row.sessionId,
        (tokenUsageBySessionId.get(row.sessionId) ?? 0) + (row.tokenUsed ?? 0),
      );
    }
  }

  return rows.map((row) => ({
    ...row,
    tokenUsed:
      row.tokenUsed > 0
        ? row.tokenUsed
        : row.sessionId
          ? (tokenUsageBySessionId.get(row.sessionId) ?? 0)
          : 0,
  })) as BaseRunRow[];
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
    db.select().from(approvalTickets).where(inArray(approvalTickets.agentRunId, runIds as string[])),
    db.select().from(auditEvents).where(inArray(auditEvents.agentRunId, runIds as string[])),
    db.select().from(codeChanges).where(inArray(codeChanges.agentRunId, runIds as string[])),
  ]);

  const approvalsByRunId = new Map<string, ApprovalRecord[]>();
  for (const row of approvalRows as ApprovalRecord[]) {
    if (!row.agentRunId) continue;
    const items = approvalsByRunId.get(row.agentRunId) || [];
    items.push(row);
    approvalsByRunId.set(row.agentRunId, items);
  }
  for (const items of approvalsByRunId.values()) {
    items.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  const auditsByRunId = new Map<string, AuditRecord[]>();
  for (const row of auditRows as AuditRecord[]) {
    if (!row.agentRunId) continue;
    const items = auditsByRunId.get(row.agentRunId) || [];
    items.push(row);
    auditsByRunId.set(row.agentRunId, items);
  }
  for (const items of auditsByRunId.values()) {
    items.sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts));
  }

  const changesByRunId = new Map<string, ChangeRecord[]>();
  for (const row of changeRows as ChangeRecord[]) {
    if (!row.agentRunId) continue;
    const items = changesByRunId.get(row.agentRunId) || [];
    items.push(row);
    changesByRunId.set(row.agentRunId, items);
  }
  for (const items of changesByRunId.values()) {
    items.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  return { approvalsByRunId, auditsByRunId, changesByRunId };
}

function filterQueueItems(
  items: HydratedQueueItem[],
  queue: QueueType,
  ownerScope: string | undefined,
  userId: string,
  runsById: Map<string, BaseRunRow>,
) {
  let filtered = items;
  if (ownerScope === "mine") {
    filtered = filtered.filter((item) => runsById.get(item.agentRunId)?.taskUserId === userId);
  }
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
  const projectId = c.req.query("projectId");
  const ownerScope = c.req.query("ownerScope");
  const baseRuns = await loadBaseRuns(user, projectId);
  const runIds = baseRuns.map((run) => run.agentRunId);
  const related = await loadRelatedMaps(runIds);
  const items = baseRuns.map((run) =>
    hydrateQueueItem(
      run,
      related.approvalsByRunId.get(run.agentRunId) || [],
      related.auditsByRunId.get(run.agentRunId) || [],
      related.changesByRunId.get(run.agentRunId) || [],
    ),
  );
  const runsById = new Map(baseRuns.map((run) => [run.agentRunId, run]));
  const attention = filterQueueItems(items, "attention", ownerScope, user.sub, runsById);
  const running = filterQueueItems(items, "running", ownerScope, user.sub, runsById);
  const recent = filterQueueItems(items, "recent", ownerScope, user.sub, runsById);
  const endedRecent = recent.filter((item) => ["completed", "failed", "stopped", "terminated"].includes(item.status));
  const failedRecent = endedRecent.filter((item) => ["failed", "stopped", "terminated"].includes(item.status));
  const avgDurationMs = endedRecent.length > 0
    ? Math.round(endedRecent.reduce((sum, item) => sum + (item.durationMs || 0), 0) / endedRecent.length)
    : null;
  const humanInterventionRate = items.length > 0
    ? Number(((items.filter((item) => item.guidanceCount > 0 || item.requiresIntervention).length / items.length) * 100).toFixed(2))
    : 0;

  return c.json({
    summary: {
      attentionCount: attention.length,
      runningCount: running.length,
      completedCount: recent.filter((item) => item.status === "completed").length,
      failureRate: endedRecent.length > 0 ? Number(((failedRecent.length / endedRecent.length) * 100).toFixed(2)) : 0,
      avgDurationMs,
      humanInterventionRate,
    },
    queueCounts: {
      attention: attention.length,
      running: running.length,
      recent: recent.length,
    },
    generatedAt: new Date().toISOString(),
  });
});

agentRunRoutes.get("/queues", async (c) => {
  const user = c.get("user");
  const projectId = c.req.query("projectId");
  const ownerScope = c.req.query("ownerScope");
  const queue = (c.req.query("queue") || "attention") as QueueType;
  const page = parsePositiveInt(c.req.query("page"), 1);
  const pageSize = Math.min(parsePositiveInt(c.req.query("pageSize"), 20), 100);
  const statusFilter = c.req.query("status");
  const search = (c.req.query("search") || "").trim().toLowerCase();
  const requiresIntervention = parseBool(c.req.query("requiresIntervention"));

  const baseRuns = await loadBaseRuns(user, projectId);
  const runIds = baseRuns.map((run) => run.agentRunId);
  const related = await loadRelatedMaps(runIds);
  const items = baseRuns.map((run) =>
    hydrateQueueItem(
      run,
      related.approvalsByRunId.get(run.agentRunId) || [],
      related.auditsByRunId.get(run.agentRunId) || [],
      related.changesByRunId.get(run.agentRunId) || [],
    ),
  );
  const runsById = new Map(baseRuns.map((run) => [run.agentRunId, run]));
  let filtered = filterQueueItems(items, queue, ownerScope, user.sub, runsById);

  if (statusFilter) {
    filtered = filtered.filter((item) => item.status === statusFilter);
  }
  if (requiresIntervention !== undefined) {
    filtered = filtered.filter((item) => item.requiresIntervention === requiresIntervention);
  }
  if (search) {
    filtered = filtered.filter((item) =>
      item.agentRunId.toLowerCase().includes(search) ||
      item.agentType.toLowerCase().includes(search) ||
      item.taskId.toLowerCase().includes(search) ||
      item.taskTitle.toLowerCase().includes(search),
    );
  }

  filtered.sort((left, right) => {
    const rightTime = parseDate(right.lastActivityAt) ?? parseDate(right.finishedAt) ?? parseDate(right.startedAt) ?? 0;
    const leftTime = parseDate(left.lastActivityAt) ?? parseDate(left.finishedAt) ?? parseDate(left.startedAt) ?? 0;
    return rightTime - leftTime;
  });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);

  return c.json({ data, page, pageSize, total });
});

agentRunRoutes.get("/:agentRunId/summary", async (c) => {
  const user = c.get("user");
  const agentRunId = c.req.param("agentRunId");
  const baseRuns = await loadBaseRuns(user);
  const run = baseRuns.find((item) => item.agentRunId === agentRunId);
  if (!run) {
    return c.json({ error: "Agent run not found" }, 404);
  }

  const related = await loadRelatedMaps([agentRunId]);
  const approvals = related.approvalsByRunId.get(agentRunId) || [];
  const audits = related.auditsByRunId.get(agentRunId) || [];
  const changes = related.changesByRunId.get(agentRunId) || [];
  const item = hydrateQueueItem(run, approvals, audits, changes);

  const latestEvents = [
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

  return c.json({
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
    latestEvents,
  });
});