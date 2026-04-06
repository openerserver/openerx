import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { taskStageRuns, taskWorkflowRuns, workflowTemplateStages } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { ensureTaskWorkflowAvailable } from "./legacy-role-workflow-storage";

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
  artifactsSummaryJson: z.any().optional(),
  approvalState: z
    .enum(["not-required", "pending", "approved", "rejected", "expired", "cancelled"])
    .optional(),
});

const retryStageSchema = z.object({
  stageKey: z.string().min(1),
});

function getTaskId(c: { req: { param: (name: string) => string } }) {
  return c.req.param("taskId") ?? "";
}

function buildAdvancedStageRunUpdates(args: {
  body: z.infer<typeof advanceWorkflowSchema>;
  currentStageRun: typeof taskStageRuns.$inferSelect;
  now: string;
}) {
  return {
    status: args.body.status,
    blockingReason: args.body.blockingReason ?? null,
    approvalState: args.body.approvalState ?? args.currentStageRun.approvalState,
    artifactsSummaryJson:
      args.body.artifactsSummaryJson !== undefined
        ? args.body.artifactsSummaryJson
        : args.currentStageRun.artifactsSummaryJson,
    finishedAt: args.body.status === "completed" ? args.now : args.currentStageRun.finishedAt,
    updatedAt: args.now,
  };
}

async function advanceNextStageRun(args: {
  workflowRunId: string;
  toStage?: string;
  now: string;
}) {
  if (!args.toStage) {
    return;
  }

  const nextStageRun = await db.query.taskStageRuns.findFirst({
    where: and(
      eq(taskStageRuns.workflowRunId, args.workflowRunId),
      eq(taskStageRuns.stageKey, args.toStage),
    ),
  });
  if (!nextStageRun) {
    return;
  }

  await db
    .update(taskStageRuns)
    .set({ status: "running", startedAt: nextStageRun.startedAt ?? args.now, updatedAt: args.now })
    .where(eq(taskStageRuns.id, nextStageRun.id));
}

function resolveNextWorkflowStatus(body: z.infer<typeof advanceWorkflowSchema>) {
  if (!body.toStage) {
    return body.status;
  }

  return body.status === "completed" ? "running" : body.status;
}

taskWorkflowRoutes.get("/", async (c) => {
  const taskId = getTaskId(c);
  const task = await ensureTaskWorkflowAvailable(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  const workflowRun = await db.query.taskWorkflowRuns.findFirst({
    where: eq(taskWorkflowRuns.taskId, taskId),
  });

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
    const stageRunPayloads: Array<typeof taskStageRuns.$inferInsert> = templateStages.map(
      (stage) => ({
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
      }),
    );
    await db.insert(taskStageRuns).values(stageRunPayloads);
  }

  const workflowRun = await db.query.taskWorkflowRuns.findFirst({
    where: eq(taskWorkflowRuns.id, workflowRunId),
  });
  return c.json({ data: workflowRun }, 201);
});

taskWorkflowRoutes.post("/advance", zValidator("json", advanceWorkflowSchema), async (c) => {
  const taskId = getTaskId(c);
  const body = c.req.valid("json");
  const task = await ensureTaskWorkflowAvailable(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);
  const workflowRun = await db.query.taskWorkflowRuns.findFirst({
    where: eq(taskWorkflowRuns.taskId, taskId),
  });
  if (!workflowRun) return c.json({ error: "Workflow run not found" }, 404);

  const now = new Date().toISOString();
  const currentStageRun = await db.query.taskStageRuns.findFirst({
    where: and(
      eq(taskStageRuns.workflowRunId, workflowRun.id),
      eq(taskStageRuns.stageKey, body.fromStage),
    ),
  });
  if (currentStageRun) {
    await db
      .update(taskStageRuns)
      .set(buildAdvancedStageRunUpdates({ body, currentStageRun, now }))
      .where(eq(taskStageRuns.id, currentStageRun.id));
  }

  await advanceNextStageRun({ workflowRunId: workflowRun.id, toStage: body.toStage, now });

  const nextStatus = resolveNextWorkflowStatus(body);
  await db
    .update(taskWorkflowRuns)
    .set({
      currentStage: body.toStage ?? body.fromStage,
      status: nextStatus,
      finishedAt: nextStatus === "completed" ? now : workflowRun.finishedAt,
      updatedAt: now,
    })
    .where(eq(taskWorkflowRuns.id, workflowRun.id));

  const updated = await db.query.taskWorkflowRuns.findFirst({
    where: eq(taskWorkflowRuns.id, workflowRun.id),
  });
  return c.json({ data: updated });
});

taskWorkflowRoutes.post("/retry-stage", zValidator("json", retryStageSchema), async (c) => {
  const taskId = getTaskId(c);
  const body = c.req.valid("json");
  const task = await ensureTaskWorkflowAvailable(taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);
  const workflowRun = await db.query.taskWorkflowRuns.findFirst({
    where: eq(taskWorkflowRuns.taskId, taskId),
  });
  if (!workflowRun) return c.json({ error: "Workflow run not found" }, 404);

  const stageRun = await db.query.taskStageRuns.findFirst({
    where: and(
      eq(taskStageRuns.workflowRunId, workflowRun.id),
      eq(taskStageRuns.stageKey, body.stageKey),
    ),
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
