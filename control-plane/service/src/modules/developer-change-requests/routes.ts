import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { developerChangeRequests } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { ensureLegacyRoleWorkflowMigrated } from "../task-workflows/legacy-role-workflow-storage";

export const developerChangeRequestRoutes = new Hono<AppEnv>();

developerChangeRequestRoutes.use("*", authMiddleware);
developerChangeRequestRoutes.use("*", requireRole("developer"));

const createDeveloperChangeRequestSchema = z.object({
  taskStageRunId: z.string().min(1).optional(),
  sourceRoleAgentId: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  requiredChanges: z.array(z.string()).min(1),
  relatedFindingKeys: z.array(z.string()).optional(),
  blocking: z.boolean(),
  approvalRequired: z.boolean(),
});

const patchDeveloperChangeRequestSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(["open", "acknowledged", "in-progress", "resolved", "won't-fix"]),
  resolutionNote: z.string().optional(),
});

function requireTaskId(c: { req: { param: (name: string) => string | undefined } }) {
  return c.req.param("taskId") ?? "";
}

developerChangeRequestRoutes.get("/", async (c) => {
  const taskId = requireTaskId(c);
  const task = await ensureLegacyRoleWorkflowMigrated(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);

  const rows = await db
    .select()
    .from(developerChangeRequests)
    .where(eq(developerChangeRequests.taskId, taskId))
    .orderBy(desc(developerChangeRequests.createdAt));

  return c.json({
    data: rows.map((row) => ({
      id: row.id,
      taskStageRunId: row.taskStageRunId,
      sourceRoleAgentId: row.sourceRoleAgentId,
      assignedRoleAgentId: row.assignedRoleAgentId,
      priority: row.priority,
      title: row.title,
      summary: row.summary,
      requiredChanges: row.requiredChangesJson ?? [],
      relatedFindingKeys: row.relatedFindingKeysJson ?? [],
      blocking: row.blocking,
      approvalRequired: row.approvalRequired,
      status: row.status,
      resolutionNote: row.resolutionNote,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      resolvedAt: row.resolvedAt,
    })),
  });
});

developerChangeRequestRoutes.post("/", zValidator("json", createDeveloperChangeRequestSchema), async (c) => {
  const taskId = requireTaskId(c);
  const body = c.req.valid("json");
  const task = await ensureLegacyRoleWorkflowMigrated(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);
  const requestId = crypto.randomUUID();
  const now = new Date().toISOString();
  const payload: typeof developerChangeRequests.$inferInsert = {
    id: requestId,
    taskId,
    taskStageRunId: body.taskStageRunId ?? null,
    sourceRoleAgentId: body.sourceRoleAgentId,
    assignedRoleAgentId: "role.developer",
    priority: body.priority,
    title: body.title,
    summary: body.summary,
    requiredChangesJson: body.requiredChanges,
    relatedFindingKeysJson: body.relatedFindingKeys ?? [],
    blocking: body.blocking,
    approvalRequired: body.approvalRequired,
    status: "open",
    resolutionNote: null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  };
  await db.insert(developerChangeRequests).values(payload);
  return c.json({ ok: true, id: requestId }, 201);
});

developerChangeRequestRoutes.patch("/", zValidator("json", patchDeveloperChangeRequestSchema), async (c) => {
  const taskId = requireTaskId(c);
  const body = c.req.valid("json");
  const task = await ensureLegacyRoleWorkflowMigrated(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);
  const existing = await db.query.developerChangeRequests.findFirst({
    where: and(
      eq(developerChangeRequests.taskId, taskId),
      eq(developerChangeRequests.id, body.requestId),
    ),
  });
  if (!existing) return c.json({ error: "Change request not found" }, 404);

  const now = new Date().toISOString();
  await db
    .update(developerChangeRequests)
    .set({
      status: body.status,
      resolutionNote: body.resolutionNote ?? existing.resolutionNote,
      updatedAt: now,
      resolvedAt: body.status === "resolved" || body.status === "won't-fix" ? now : null,
    })
    .where(eq(developerChangeRequests.id, body.requestId));

  return c.json({ ok: true });
});