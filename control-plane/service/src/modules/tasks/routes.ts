import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../../db";
import { tasks } from "../../db/schema";
import { authMiddleware, type AppEnv } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { recordAuditEvent } from "../audit/routes";

export const taskRoutes = new Hono<AppEnv>();

taskRoutes.use("*", authMiddleware);
taskRoutes.use("*", requireRole("developer"));

// ── Create Task ────────────────────────────────────────────────────

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  prompt: z.string().min(1).max(50000),
  projectId: z.string().min(1),
});

taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const user = c.get("user");
  const { title, prompt, projectId } = c.req.valid("json");

  const taskId = crypto.randomUUID();
  await db.insert(tasks).values({
    id: taskId,
    projectId,
    userId: user.sub,
    title,
    prompt,
    status: "pending",
  });

  await recordAuditEvent({
    userId: user.sub,
    projectId,
    taskId,
    eventType: "task.created",
    action: "create_task",
    target: title,
    detail: { prompt: prompt.slice(0, 200) },
  });

  return c.json({ id: taskId, status: "pending" }, 201);
});

// ── List Tasks ─────────────────────────────────────────────────────

taskRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);

  const conditions = [];
  if (projectId) conditions.push(eq(tasks.projectId, projectId));
  if (status) conditions.push(eq(tasks.status, status as typeof tasks.status.enumValues[number]));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select()
    .from(tasks)
    .where(where)
    .orderBy(desc(tasks.createdAt))
    .limit(limit);

  return c.json({ data: result });
});

// ── Get Task ───────────────────────────────────────────────────────

taskRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });

  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json(task);
});

// ── Update Task Status ─────────────────────────────────────────────

const updateStatusSchema = z.object({
  status: z.enum(["running", "paused", "completed", "failed", "cancelled"]),
  sessionId: z.string().optional(),
  agentRunId: z.string().optional(),
  result: z.string().optional(),
});

taskRoutes.patch(
  "/:taskId",
  zValidator("json", updateStatusSchema),
  async (c) => {
    const taskId = c.req.param("taskId");
    const body = c.req.valid("json");

    const existing = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });
    if (!existing) return c.json({ error: "Task not found" }, 404);

    const updates: Record<string, unknown> = { status: body.status };
    if (body.sessionId) updates.sessionId = body.sessionId;
    if (body.agentRunId) updates.agentRunId = body.agentRunId;
    if (body.result) updates.result = body.result;
    if (body.status === "running" && !existing.startedAt) {
      updates.startedAt = new Date().toISOString();
    }
    if (body.status === "completed" || body.status === "failed" || body.status === "cancelled") {
      updates.finishedAt = new Date().toISOString();
    }

    await db.update(tasks).set(updates).where(eq(tasks.id, taskId));

    return c.json({ id: taskId, ...updates });
  },
);
