import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { budgetConfigs, costRecords, projects } from "../../db/schema";
import { type AppEnv, type JWTPayload, authMiddleware } from "../../middleware/auth";

export const costRoutes = new Hono<AppEnv>();

costRoutes.use("*", authMiddleware);

type ProjectRole = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  platform_admin: 5,
  org_admin: 4,
  project_admin: 3,
  developer: 2,
  viewer: 1,
};

function hasProjectAccess(user: JWTPayload, projectId: string, minRole: ProjectRole) {
  const globalLevel = ROLE_HIERARCHY[user.role as ProjectRole] ?? 0;
  if (globalLevel >= ROLE_HIERARCHY.org_admin) {
    return true;
  }

  const projectRole = user.projects?.find((item) => item.id === projectId)?.role as
    | ProjectRole
    | undefined;
  const projectLevel = projectRole ? ROLE_HIERARCHY[projectRole] : 0;
  return projectLevel >= ROLE_HIERARCHY[minRole];
}

// GET /api/cost/summary?projectId=&period=&groupBy=
costRoutes.get("/summary", async (c) => {
  const projectId = c.req.query("projectId");
  const period = c.req.query("period") || "monthly";
  const groupBy = c.req.query("groupBy") || "model"; // model | user | agent | task

  if (!projectId) return c.json({ error: "projectId query param required" }, 400);

  const user = c.get("user") as JWTPayload;
  if (!hasProjectAccess(user, projectId, "viewer")) {
    return c.json({ error: "No access to this project" }, 403);
  }

  // Get cost records for the project
  const records = await db.select().from(costRecords).where(eq(costRecords.projectId, projectId));

  // Group by requested dimension
  const grouped = new Map<
    string,
    { inputTokens: number; outputTokens: number; cost: number; count: number }
  >();

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

  const user = c.get("user") as JWTPayload;
  if (!hasProjectAccess(user, projectId, "viewer")) {
    return c.json({ error: "No access to this project" }, 403);
  }

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
  projectId: z.string().min(1),
  period: z.enum(["daily", "weekly", "monthly"]),
  limitAmount: z.number().positive(),
  warnThreshold: z.number().min(0).max(1).default(0.8),
  throttleThreshold: z.number().min(0).max(1).default(0.95),
});

const updateBudgetSchema = z.object({
  period: z.enum(["daily", "weekly", "monthly"]).optional(),
  limitAmount: z.number().positive().optional(),
  warnThreshold: z.number().min(0).max(1).optional(),
  throttleThreshold: z.number().min(0).max(1).optional(),
});

costRoutes.post("/budget", zValidator("json", budgetSchema), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user") as JWTPayload;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, body.projectId),
  });
  if (!project) return c.json({ error: "Project not found" }, 404);

  if (!hasProjectAccess(user, body.projectId, "project_admin")) {
    return c.json({ error: "Insufficient project permissions" }, 403);
  }

  await db.insert(budgetConfigs).values({
    id,
    projectId: body.projectId,
    period: body.period,
    limitAmount: body.limitAmount,
    warnThreshold: body.warnThreshold,
    throttleThreshold: body.throttleThreshold,
    createdAt,
  });

  return c.json({ id, ...body, createdAt }, 201);
});

// PATCH /api/cost/budget/:budgetId
costRoutes.patch("/budget/:budgetId", zValidator("json", updateBudgetSchema), async (c) => {
  const budgetId = c.req.param("budgetId");
  const body = c.req.valid("json");
  const user = c.get("user") as JWTPayload;

  const existing = await db.query.budgetConfigs.findFirst({
    where: eq(budgetConfigs.id, budgetId),
  });
  if (!existing) return c.json({ error: "Budget config not found" }, 404);

  if (!hasProjectAccess(user, existing.projectId, "project_admin")) {
    return c.json({ error: "Insufficient project permissions" }, 403);
  }

  await db
    .update(budgetConfigs)
    .set({
      ...(body.period !== undefined ? { period: body.period } : {}),
      ...(body.limitAmount !== undefined ? { limitAmount: body.limitAmount } : {}),
      ...(body.warnThreshold !== undefined ? { warnThreshold: body.warnThreshold } : {}),
      ...(body.throttleThreshold !== undefined
        ? { throttleThreshold: body.throttleThreshold }
        : {}),
    })
    .where(eq(budgetConfigs.id, budgetId));

  return c.json({
    id: budgetId,
    projectId: existing.projectId,
    period: body.period ?? existing.period,
    limitAmount: body.limitAmount ?? existing.limitAmount,
    warnThreshold: body.warnThreshold ?? existing.warnThreshold,
    throttleThreshold: body.throttleThreshold ?? existing.throttleThreshold,
  });
});

// GET /api/cost/detail?taskId=
costRoutes.get("/detail", async (c) => {
  const taskId = c.req.query("taskId");
  if (!taskId) return c.json({ error: "taskId query param required" }, 400);

  const records = await db.select().from(costRecords).where(eq(costRecords.taskId, taskId));

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
