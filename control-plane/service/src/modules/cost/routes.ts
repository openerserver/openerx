import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { costRecords, budgetConfigs, projects } from "../../db/schema";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const costRoutes = new Hono();

costRoutes.use("*", authMiddleware);

// GET /api/cost/summary?projectId=&period=&groupBy=
costRoutes.get("/summary", async (c) => {
  const projectId = c.req.query("projectId");
  const period = c.req.query("period") || "monthly";
  const groupBy = c.req.query("groupBy") || "model"; // model | user | agent | task

  if (!projectId) return c.json({ error: "projectId query param required" }, 400);

  // Get cost records for the project
  const records = await db
    .select()
    .from(costRecords)
    .where(eq(costRecords.projectId, projectId));

  // Group by requested dimension
  const grouped = new Map<string, { inputTokens: number; outputTokens: number; cost: number; count: number }>();

  for (const record of records) {
    let key: string;
    switch (groupBy) {
      case "user":
        key = record.userId || "unknown";
        break;
      case "agent":
        key = record.agentRunId || "unknown";
        break;
      case "task":
        key = record.taskId || "unknown";
        break;
      default:
        key = record.modelId;
    }

    const existing = grouped.get(key) || { inputTokens: 0, outputTokens: 0, cost: 0, count: 0 };
    existing.inputTokens += record.inputTokens;
    existing.outputTokens += record.outputTokens;
    existing.cost += record.cost;
    existing.count += 1;
    grouped.set(key, existing);
  }

  const summary = Array.from(grouped.entries()).map(([key, value]) => ({
    [groupBy]: key,
    ...value,
  }));

  const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
  const totalTokens = records.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);

  return c.json({
    projectId,
    period,
    groupBy,
    totalCost,
    totalTokens,
    breakdown: summary,
  });
});

// GET /api/cost/budget?projectId=
costRoutes.get("/budget", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId query param required" }, 400);

  const configs = await db.query.budgetConfigs.findMany({
    where: eq(budgetConfigs.projectId, projectId),
  });

  // Calculate current spend for each budget period
  const budgetStatus = await Promise.all(
    configs.map(async (config) => {
      const records = await db
        .select()
        .from(costRecords)
        .where(eq(costRecords.projectId, projectId));

      const currentSpend = records.reduce((sum, r) => sum + r.cost, 0);
      const usage = currentSpend / config.limitAmount;

      let status: "ok" | "warn" | "throttle" | "blocked";
      if (usage >= 1) status = "blocked";
      else if (usage >= config.throttleThreshold) status = "throttle";
      else if (usage >= config.warnThreshold) status = "warn";
      else status = "ok";

      return {
        id: config.id,
        period: config.period,
        limit: config.limitAmount,
        currentSpend,
        usage: Math.round(usage * 10000) / 100, // percentage with 2 decimals
        status,
        warnThreshold: config.warnThreshold,
        throttleThreshold: config.throttleThreshold,
      };
    }),
  );

  return c.json(budgetStatus);
});

// POST /api/cost/budget
const budgetSchema = z.object({
  projectId: z.string().uuid(),
  period: z.enum(["daily", "weekly", "monthly"]),
  limitAmount: z.number().positive(),
  warnThreshold: z.number().min(0).max(1).default(0.8),
  throttleThreshold: z.number().min(0).max(1).default(0.95),
});

costRoutes.post(
  "/budget",
  requireRole("project_admin"),
  zValidator("json", budgetSchema),
  async (c) => {
    const body = c.req.valid("json");
    const id = crypto.randomUUID();

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, body.projectId),
    });
    if (!project) return c.json({ error: "Project not found" }, 404);

    await db.insert(budgetConfigs).values({
      id,
      projectId: body.projectId,
      period: body.period,
      limitAmount: body.limitAmount,
      warnThreshold: body.warnThreshold,
      throttleThreshold: body.throttleThreshold,
    });

    return c.json({ id, ...body }, 201);
  },
);

// GET /api/cost/detail?taskId=
costRoutes.get("/detail", async (c) => {
  const taskId = c.req.query("taskId");
  if (!taskId) return c.json({ error: "taskId query param required" }, 400);

  const records = await db
    .select()
    .from(costRecords)
    .where(eq(costRecords.taskId, taskId));

  const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
  const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);

  return c.json({
    taskId,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    records,
  });
});
