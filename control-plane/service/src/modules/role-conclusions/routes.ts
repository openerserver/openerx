import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { tasks } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const roleConclusionRoutes = new Hono<AppEnv>();

roleConclusionRoutes.use("*", authMiddleware);
roleConclusionRoutes.use("*", requireRole("developer"));

const roleConclusionSchema = z.object({
  roleAgentId: z.string().min(1),
  stage: z.string().min(1),
  aggregationStrategy: z.enum(["first-pass", "majority", "merge-summary", "human-review"]),
  status: z.enum(["aligned", "partially-aligned", "conflicted", "escalated", "blocked"]),
  finalDecision: z.enum(["allow", "notify-developer", "needs-approval", "block", "observe", "human-review"]),
  aggregateRiskLevel: z.enum(["low", "medium", "high", "critical"]),
  confidenceScore: z.number(),
  consensusScore: z.number(),
  winningRationale: z.string(),
  mergedFindings: z.array(z.any()).optional(),
  minorityFindings: z.array(z.any()).optional(),
  conflicts: z.array(z.any()).optional(),
  approvalRecommendation: z.any().optional(),
});

function parseTaskStrategy(raw: string | null | undefined) {
  if (!raw) return {} as Record<string, unknown>;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

roleConclusionRoutes.get("/", async (c) => {
  const taskId = c.req.param("taskId");
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return c.json({ error: "Task not found" }, 404);
  const strategy = parseTaskStrategy(task.strategy);
  return c.json({ data: (strategy.roleAggregateConclusions as unknown[]) ?? [] });
});

roleConclusionRoutes.post("/", zValidator("json", roleConclusionSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return c.json({ error: "Task not found" }, 404);
  const strategy = parseTaskStrategy(task.strategy);
  const existing = Array.isArray(strategy.roleAggregateConclusions)
    ? [...(strategy.roleAggregateConclusions as Record<string, unknown>[])]
    : [];
  const next = existing.filter(
    (item) => !(item.roleAgentId === body.roleAgentId && item.stage === body.stage),
  );
  next.push({ ...body, generatedAt: new Date().toISOString() });
  await db.update(tasks).set({ strategy: JSON.stringify({ ...strategy, roleAggregateConclusions: next }) }).where(eq(tasks.id, taskId));
  return c.json({ ok: true, data: next });
});