import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { roleAggregateConclusions } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { ensureRoleConclusionsAvailability } from "../task-workflows/legacy-role-workflow-storage";

export const roleConclusionRoutes = new Hono<AppEnv>();

roleConclusionRoutes.use("*", authMiddleware);
roleConclusionRoutes.use("*", requireRole("developer"));

const roleConclusionSchema = z.object({
  roleAgentId: z.string().min(1),
  stage: z.string().min(1),
  aggregationStrategy: z.enum(["first-pass", "majority", "merge-summary", "human-review"]),
  status: z.enum(["aligned", "partially-aligned", "conflicted", "escalated", "blocked"]),
  finalDecision: z.enum([
    "allow",
    "notify-developer",
    "needs-approval",
    "block",
    "observe",
    "human-review",
  ]),
  aggregateRiskLevel: z.enum(["low", "medium", "high", "critical"]),
  confidenceScore: z.number(),
  consensusScore: z.number(),
  winningRationale: z.string(),
  mergedFindings: z.array(z.any()).optional(),
  minorityFindings: z.array(z.any()).optional(),
  conflicts: z.array(z.any()).optional(),
  approvalRecommendation: z.any().optional(),
});

function requireTaskId(c: { req: { param: (name: string) => string | undefined } }) {
  return c.req.param("taskId") ?? "";
}

roleConclusionRoutes.get("/", async (c) => {
  const taskId = requireTaskId(c);
  const availability = await ensureRoleConclusionsAvailability(taskId);
  if (!availability.task) return c.json({ error: "Task not found" }, 404);

  const rows = await db
    .select()
    .from(roleAggregateConclusions)
    .where(eq(roleAggregateConclusions.taskId, taskId))
    .orderBy(desc(roleAggregateConclusions.generatedAt));

  return c.json({
    data: rows.map((row) => ({
      id: row.id,
      roleAgentId: row.roleAgentId,
      stage: row.stage,
      aggregationStrategy: row.aggregationStrategy,
      status: row.status,
      finalDecision: row.finalDecision,
      aggregateRiskLevel: row.aggregateRiskLevel,
      confidenceScore: row.confidenceScore,
      consensusScore: row.consensusScore,
      winningRationale: row.winningRationale,
      mergedFindings: row.mergedFindingsJson ?? [],
      minorityFindings: row.minorityFindingsJson ?? [],
      conflicts: row.conflictsJson ?? [],
      approvalRecommendation: row.approvalRecommendationJson ?? null,
      generatedAt: row.generatedAt,
    })),
    meta: {
      workflowMigrated: availability.migrated,
    },
  });
});

roleConclusionRoutes.post("/", zValidator("json", roleConclusionSchema), async (c) => {
  const taskId = requireTaskId(c);
  const body = c.req.valid("json");
  const task = await ensureRoleConclusionsAvailability(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);
  const now = new Date().toISOString();
  const existing = await db.query.roleAggregateConclusions.findFirst({
    where: and(
      eq(roleAggregateConclusions.taskId, taskId),
      eq(roleAggregateConclusions.roleAgentId, body.roleAgentId),
      eq(roleAggregateConclusions.stage, body.stage),
    ),
  });

  if (existing) {
    await db
      .update(roleAggregateConclusions)
      .set({
        taskStageRunId: null,
        aggregationStrategy: body.aggregationStrategy,
        status: body.status,
        finalDecision: body.finalDecision,
        aggregateRiskLevel: body.aggregateRiskLevel,
        confidenceScore: body.confidenceScore,
        consensusScore: body.consensusScore,
        winningRationale: body.winningRationale,
        mergedFindingsJson: body.mergedFindings ?? [],
        minorityFindingsJson: body.minorityFindings ?? [],
        conflictsJson: body.conflicts ?? [],
        approvalRecommendationJson: body.approvalRecommendation ?? null,
        generatedAt: now,
        updatedAt: now,
      })
      .where(eq(roleAggregateConclusions.id, existing.id));
  } else {
    const payload: typeof roleAggregateConclusions.$inferInsert = {
      id: crypto.randomUUID(),
      taskId,
      taskStageRunId: null,
      roleAgentId: body.roleAgentId,
      stage: body.stage,
      aggregationStrategy: body.aggregationStrategy,
      status: body.status,
      finalDecision: body.finalDecision,
      aggregateRiskLevel: body.aggregateRiskLevel,
      confidenceScore: body.confidenceScore,
      consensusScore: body.consensusScore,
      winningRationale: body.winningRationale,
      mergedFindingsJson: body.mergedFindings ?? [],
      minorityFindingsJson: body.minorityFindings ?? [],
      conflictsJson: body.conflicts ?? [],
      approvalRecommendationJson: body.approvalRecommendation ?? null,
      generatedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(roleAggregateConclusions).values(payload);
  }

  const rows = await db
    .select()
    .from(roleAggregateConclusions)
    .where(eq(roleAggregateConclusions.taskId, taskId))
    .orderBy(desc(roleAggregateConclusions.generatedAt));

  return c.json({
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      roleAgentId: row.roleAgentId,
      stage: row.stage,
      aggregationStrategy: row.aggregationStrategy,
      status: row.status,
      finalDecision: row.finalDecision,
      aggregateRiskLevel: row.aggregateRiskLevel,
      confidenceScore: row.confidenceScore,
      consensusScore: row.consensusScore,
      winningRationale: row.winningRationale,
      mergedFindings: row.mergedFindingsJson ?? [],
      minorityFindings: row.minorityFindingsJson ?? [],
      conflicts: row.conflictsJson ?? [],
      approvalRecommendation: row.approvalRecommendationJson ?? null,
      generatedAt: row.generatedAt,
    })),
  });
});
