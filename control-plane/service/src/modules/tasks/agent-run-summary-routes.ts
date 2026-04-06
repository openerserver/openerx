import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db";
import {
  approvalTickets,
  auditEvents,
  codeChanges,
  fileChanges,
  projects,
  tasks,
} from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { loadCanonicalAgentRun } from "./agent-run-compat";

export const agentRunRoutes = new Hono<AppEnv>();

agentRunRoutes.use("*", authMiddleware);
agentRunRoutes.use("*", requireRole("developer"));

function parseIsoMs(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

agentRunRoutes.get("/:agentRunId/summary", async (c) => {
  const agentRunId = c.req.param("agentRunId");

  const run = await loadCanonicalAgentRun(agentRunId);
  if (!run) {
    return c.json({ error: "Agent run not found" }, 404);
  }

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, run.taskId) });
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const [project, taskCodeChanges, taskApprovals, taskAudits] = await Promise.all([
    db.query.projects.findFirst({ where: eq(projects.id, task.projectId) }),
    db.query.codeChanges.findMany({
      where: eq(codeChanges.taskId, task.id),
      orderBy: [desc(codeChanges.createdAt)],
    }),
    db.query.approvalTickets.findMany({ where: eq(approvalTickets.taskId, task.id) }),
    db.query.auditEvents.findMany({
      where: and(eq(auditEvents.taskId, task.id), eq(auditEvents.projectId, task.projectId)),
      orderBy: [desc(auditEvents.ts)],
    }),
  ]);

  const changeIds = taskCodeChanges.map((change) => change.id);
  const fileRows =
    changeIds.length > 0
      ? await db.select().from(fileChanges).where(inArray(fileChanges.changeId, changeIds))
      : [];

  const latestChange = taskCodeChanges[0] ?? null;
  const startedAtMs = parseIsoMs(run.startedAt);
  const finishedAtMs = parseIsoMs(run.finishedAt);

  return c.json({
    agentRunId,
    taskId: task.id,
    taskTitle: task.title,
    projectId: task.projectId,
    projectName: project?.name ?? null,
    agentType: run.agentType,
    status: run.status,
    sessionId: run.sessionId,
    modelUsed: run.modelUsed,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    lastActivityAt: run.finishedAt ?? run.startedAt ?? run.createdAt,
    durationMs:
      startedAtMs != null && finishedAtMs != null && finishedAtMs >= startedAtMs
        ? finishedAtMs - startedAtMs
        : null,
    tokenUsed: run.tokenUsed,
    blockerType: null,
    blockerLabel: "",
    riskLevel: null,
    guidanceCount: 0,
    resultSummary: run.result ?? task.latestResultSummary ?? null,
    result: run.result ?? task.latestResult ?? null,
    error: run.error,
    longSummary: null,
    latestEvents: [],
    actionPermissions: {
      canPause: run.status === "running",
      canResume: run.status === "paused",
      canTerminate: run.status === "running" || run.status === "paused",
      canInjectGuidance: true,
      canViewApproval: true,
      canViewAudit: true,
      canViewCodeChanges: true,
      canExport: true,
    },
    governance: {
      approvalTickets: taskApprovals.length,
      pendingApprovals: taskApprovals.filter((ticket) => ticket.status === "pending").length,
      latestApprovalStatus: taskApprovals[0]?.status ?? null,
      recentAuditEvents: taskAudits.length,
      latestHighRiskAction: taskAudits[0]?.action ?? null,
    },
    codeChanges: {
      changeCount: taskCodeChanges.length,
      files: fileRows.length,
      insertions: fileRows.reduce((sum, row) => sum + row.insertions, 0),
      deletions: fileRows.reduce((sum, row) => sum + row.deletions, 0),
      latestSummary: latestChange?.summary ?? null,
    },
  });
});
