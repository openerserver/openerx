import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { tasks } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

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

function parseTaskStrategy(raw: string | null | undefined) {
  if (!raw) return {} as Record<string, unknown>;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

developerChangeRequestRoutes.get("/", async (c) => {
  const taskId = c.req.param("taskId");
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return c.json({ error: "Task not found" }, 404);
  const strategy = parseTaskStrategy(task.strategy);
  return c.json({ data: (strategy.developerChangeRequests as unknown[]) ?? [] });
});

developerChangeRequestRoutes.post("/", zValidator("json", createDeveloperChangeRequestSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return c.json({ error: "Task not found" }, 404);
  const strategy = parseTaskStrategy(task.strategy);
  const existing = Array.isArray(strategy.developerChangeRequests)
    ? [...(strategy.developerChangeRequests as Record<string, unknown>[])]
    : [];
  const requestId = crypto.randomUUID();
  existing.push({
    id: requestId,
    ...body,
    status: "open",
    assignedRoleAgentId: "role.developer",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.update(tasks).set({ strategy: JSON.stringify({ ...strategy, developerChangeRequests: existing }) }).where(eq(tasks.id, taskId));
  return c.json({ ok: true, id: requestId }, 201);
});

developerChangeRequestRoutes.patch("/", zValidator("json", patchDeveloperChangeRequestSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return c.json({ error: "Task not found" }, 404);
  const strategy = parseTaskStrategy(task.strategy);
  const existing = Array.isArray(strategy.developerChangeRequests)
    ? [...(strategy.developerChangeRequests as Record<string, unknown>[])]
    : [];
  const next = existing.map((item) =>
    item.id === body.requestId
      ? { ...item, status: body.status, resolutionNote: body.resolutionNote ?? item.resolutionNote, updatedAt: new Date().toISOString() }
      : item,
  );
  await db.update(tasks).set({ strategy: JSON.stringify({ ...strategy, developerChangeRequests: next }) }).where(eq(tasks.id, taskId));
  return c.json({ ok: true });
});