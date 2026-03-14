import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { taskStageRuns, taskWorkflowRuns, workflowTemplateStages } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const taskWorkflowRoutes = new Hono<AppEnv>();

taskWorkflowRoutes.use("*", authMiddleware);
taskWorkflowRoutes.use("*", requireRole("developer"));

const initializeWorkflowSchema = z.object({
  templateId: z.string().min(1),
  currentStage: z.string().min(1).optional(),
});

const advanceWorkflowSchema = z.object({
  fromStage: z.string().min(1),
  toStage: z.string().min(1).optional(),
  status: z.enum(["running", "blocked", "waiting-approval", "failed", "completed"]),
  blockingReason: z.string().optional(),
  approvalState: z.enum(["not-required", "pending", "approved", "rejected", "expired", "cancelled"]).optional(),
});

const retryStageSchema = z.object({
  stageKey: z.string().min(1),
});

function getTaskId(c: { req: { param: (name: string) => string } }) {
  return c.req.param("taskId");
}

taskWorkflowRoutes.get("/", async (c) => {
  const taskId = getTaskId(c);
  const workflowRun = await db.query.taskWorkflowRuns.findFirst({ where: eq(taskWorkflowRuns.taskId, taskId) });

  if (!workflowRun) {
    return c.json({ data: { workflowRun: null, stages: [] } });
  }

  const stages = await db
    .select()
    .from(taskStageRuns)
    .where(eq(taskStageRuns.workflowRunId, workflowRun.id));

  return c.json({ data: { workflowRun, stages } });
});

taskWorkflowRoutes.post("/initialize", zValidator("json", initializeWorkflowSchema), async (c) => {
  const taskId = getTaskId(c);
  const body = c.req.valid("json");
  const now = new Date().toISOString();
  const workflowRunId = crypto.randomUUID();
  const templateStages = await db
    .select()
    .from(workflowTemplateStages)
    .where(eq(workflowTemplateStages.templateId, body.templateId));

  const currentStage = body.currentStage ?? templateStages[0]?.stageKey ?? "intake";

  await db.insert(taskWorkflowRuns).values({
    id: workflowRunId,
    taskId,
    templateId: body.templateId,
    currentStage,
    status: "running",
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  if (templateStages.length > 0) {
    await db.insert(taskStageRuns).values(
      templateStages.map((stage) => ({
        id: crypto.randomUUID(),
        workflowRunId,
        stageKey: stage.stageKey,
        status: stage.stageKey === currentStage ? "running" : "pending",
        primaryRoleAgentId: stage.primaryRoleAgentId,
        participantRoleAgentIdsJson: stage.participantRoleAgentIdsJson,
        startedAt: stage.stageKey === currentStage ? now : null,
        finishedAt: null,
        blockingReason: null,
        approvalState: "not-required",
        artifactsSummaryJson: null,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  const workflowRun = await db.query.taskWorkflowRuns.findFirst({ where: eq(taskWorkflowRuns.id, workflowRunId) });
  return c.json({ data: workflowRun }, 201);
});

taskWorkflowRoutes.post("/advance", zValidator("json", advanceWorkflowSchema), async (c) => {
  const taskId = getTaskId(c);
  const body = c.req.valid("json");
  const workflowRun = await db.query.taskWorkflowRuns.findFirst({ where: eq(taskWorkflowRuns.taskId, taskId) });
  if (!workflowRun) return c.json({ error: "Workflow run not found" }, 404);

  const now = new Date().toISOString();
  const currentStageRun = await db.query.taskStageRuns.findFirst({
    where: and(eq(taskStageRuns.workflowRunId, workflowRun.id), eq(taskStageRuns.stageKey, body.fromStage)),
  });
  if (currentStageRun) {
    await db
      .update(taskStageRuns)
      .set({
        status: body.status,
        blockingReason: body.blockingReason ?? null,
        approvalState: body.approvalState ?? currentStageRun.approvalState,
        finishedAt: body.status === "completed" ? now : currentStageRun.finishedAt,
        updatedAt: now,
      })
      .where(eq(taskStageRuns.id, currentStageRun.id));
  }

  if (body.toStage) {
    const nextStageRun = await db.query.taskStageRuns.findFirst({
      where: and(eq(taskStageRuns.workflowRunId, workflowRun.id), eq(taskStageRuns.stageKey, body.toStage)),
    });
    if (nextStageRun) {
      await db
        .update(taskStageRuns)
        .set({ status: "running", startedAt: nextStageRun.startedAt ?? now, updatedAt: now })
        .where(eq(taskStageRuns.id, nextStageRun.id));
    }
  }

  await db
    .update(taskWorkflowRuns)
    .set({ currentStage: body.toStage ?? body.fromStage, status: body.status, updatedAt: now })
    .where(eq(taskWorkflowRuns.id, workflowRun.id));

  const updated = await db.query.taskWorkflowRuns.findFirst({ where: eq(taskWorkflowRuns.id, workflowRun.id) });
  return c.json({ data: updated });
});

taskWorkflowRoutes.post("/retry-stage", zValidator("json", retryStageSchema), async (c) => {
  const taskId = getTaskId(c);
  const body = c.req.valid("json");
  const workflowRun = await db.query.taskWorkflowRuns.findFirst({ where: eq(taskWorkflowRuns.taskId, taskId) });
  if (!workflowRun) return c.json({ error: "Workflow run not found" }, 404);

  const stageRun = await db.query.taskStageRuns.findFirst({
    where: and(eq(taskStageRuns.workflowRunId, workflowRun.id), eq(taskStageRuns.stageKey, body.stageKey)),
  });
  if (!stageRun) return c.json({ error: "Stage run not found" }, 404);

  await db
    .update(taskStageRuns)
    .set({
      status: "running",
      blockingReason: null,
      approvalState: "not-required",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(taskStageRuns.id, stageRun.id));

  return c.json({ ok: true });
});