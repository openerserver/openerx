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
import { listCanonicalAgentRuns, loadCanonicalAgentRun } from "./agent-run-compat";

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

function durationMs(startedAt?: string | null, finishedAt?: string | null) {
  const startedAtMs = parseIsoMs(startedAt);
  const finishedAtMs = parseIsoMs(finishedAt);
  return startedAtMs != null && finishedAtMs != null && finishedAtMs >= startedAtMs
    ? finishedAtMs - startedAtMs
    : null;
}

agentRunRoutes.get("/summaries", async (c) => {
  const rows = await listCanonicalAgentRuns();
  const taskIds = Array.from(new Set(rows.map((run) => run.taskId)));
  const taskRows =
    taskIds.length > 0 ? await db.query.tasks.findMany({ where: inArray(tasks.id, taskIds) }) : [];
  const projectIds = Array.from(new Set(taskRows.map((task) => task.projectId)));
  const projectRows =
    projectIds.length > 0
      ? await db.query.projects.findMany({ where: inArray(projects.id, projectIds) })
      : [];
  const taskById = new Map(taskRows.map((task) => [task.id, task]));
  const projectById = new Map(projectRows.map((project) => [project.id, project]));

  return c.json({
    data: rows
      .map((run) => {
        const task = taskById.get(run.taskId);
        if (!task) return null;
        const project = projectById.get(task.projectId);
        return {
          agentRunId: run.id,
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
          durationMs: durationMs(run.startedAt, run.finishedAt),
          tokenUsed: run.tokenUsed,
          blockerType: null,
          blockerLabel: "",
          riskLevel: null,
          guidanceCount: 0,
          resultSummary: run.result ?? null,
          result: run.result ?? null,
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
          governance: null,
          codeChanges: null,
        };
      })
      .filter(Boolean),
  });
});

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
    durationMs: durationMs(run.startedAt, run.finishedAt),
    tokenUsed: run.tokenUsed,
    blockerType: null,
    blockerLabel: "",
    riskLevel: null,
    guidanceCount: 0,
    resultSummary: run.result ?? null,
    result: run.result ?? null,
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
