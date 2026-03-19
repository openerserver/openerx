import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { workflowTemplateStages, workflowTemplates } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const workflowTemplateRoutes = new Hono<AppEnv>();

workflowTemplateRoutes.use("*", authMiddleware);
workflowTemplateRoutes.use("*", requireRole("org_admin"));

const workflowTemplateSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  enabled: z.boolean(),
  selectableByProjects: z.boolean(),
  defaultCollaborationMode: z.enum(["solo", "team", "hybrid"]).optional(),
  defaultAutopilotLevel: z.enum(["L0", "L1", "L2"]).optional(),
  defaultBossParticipationMode: z
    .enum(["disabled", "advisory", "exception-only", "full-manager"])
    .optional(),
  forceBossParticipation: z.boolean().optional(),
  stageOrder: z.array(z.string()).min(1),
  defaultRoles: z.array(z.string()).optional(),
});

const workflowTemplatePatchSchema = workflowTemplateSchema.partial().omit({ id: true });

const initialTaskCandidateSchema = z.object({
  model: z.string().min(1),
  label: z.string().optional(),
});

const initialTaskStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  instruction: z.string().min(1),
  model: z.string().optional(),
});

const initialTaskDefinitionSchema = z.object({
  version: z.literal(1),
  titleTemplate: z.string().min(1),
  goalTemplate: z.string().min(1),
  instructionTemplate: z.string().min(1),
  doneWhen: z.array(z.string()).optional(),
  defaultExecutionMode: z.enum(["single", "parallel", "sequential-chain"]).optional(),
  defaultCandidates: z.array(initialTaskCandidateSchema).optional(),
  defaultSteps: z.array(initialTaskStepSchema).optional(),
  contextBindings: z
    .object({
      includeProjectBrief: z.boolean().optional(),
      includePreviousStageSummary: z.boolean().optional(),
      includeCurrentStageExitCriteria: z.boolean().optional(),
    })
    .optional(),
  outputContract: z
    .object({
      summaryLabel: z.string().optional(),
      artifactKeys: z.array(z.string()).optional(),
      requireStageCompleteMarker: z.boolean().optional(),
    })
    .optional(),
});

const workflowStageSchema = z.object({
  id: z.string().min(1),
  stageKey: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  mode: z.enum(["single", "parallel", "sequential-chain"]),
  primaryRoleAgentId: z.string().min(1),
  participantRoleAgentIds: z.array(z.string()).default([]),
  roleExecutionPolicies: z.array(z.any()).optional(),
  entryCriteria: z.array(z.string()).optional(),
  exitCriteria: z.array(z.string()).optional(),
  initialTaskDefinition: initialTaskDefinitionSchema.optional(),
  hooks: z.array(z.any()).optional(),
  gates: z.array(z.any()).optional(),
  approvals: z.array(z.any()).optional(),
  stageTemplateStrategy: z
    .object({
      onBlockedTemplateId: z.string().min(1).optional(),
      onWaitingApprovalTemplateId: z.string().min(1).optional(),
      note: z.string().optional(),
    })
    .optional(),
  failurePolicy: z.any().optional(),
  orderIndex: z.number().int().min(0).default(0),
});

const workflowStagePatchSchema = workflowStageSchema.partial().omit({ id: true });

workflowTemplateRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const rows = await db
    .select()
    .from(workflowTemplates)
    .where(projectId ? eq(workflowTemplates.projectId, projectId) : undefined);
  return c.json({ data: rows });
});

workflowTemplateRoutes.post("/", zValidator("json", workflowTemplateSchema), async (c) => {
  const body = c.req.valid("json");
  const now = new Date().toISOString();
  await db.insert(workflowTemplates).values({
    id: body.id,
    projectId: body.projectId ?? null,
    name: body.name,
    description: body.description ?? null,
    category: body.category ?? null,
    enabled: body.enabled,
    selectableByProjects: body.selectableByProjects,
    defaultCollaborationMode: body.defaultCollaborationMode ?? null,
    defaultAutopilotLevel: body.defaultAutopilotLevel ?? null,
    defaultBossParticipationMode: body.defaultBossParticipationMode ?? null,
    forceBossParticipation: body.forceBossParticipation ?? false,
    stageOrderJson: body.stageOrder,
    defaultRolesJson: body.defaultRoles ?? null,
    version: 1,
    createdBy: c.get("user").sub,
    updatedBy: c.get("user").sub,
    createdAt: now,
    updatedAt: now,
  });
  const created = await db.query.workflowTemplates.findFirst({
    where: eq(workflowTemplates.id, body.id),
  });
  return c.json(created, 201);
});

workflowTemplateRoutes.patch(
  "/:templateId",
  zValidator("json", workflowTemplatePatchSchema),
  async (c) => {
    const templateId = c.req.param("templateId");
    const body = c.req.valid("json");
    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
      updatedBy: c.get("user").sub,
    };
    if (body.projectId !== undefined) updates.projectId = body.projectId;
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.category !== undefined) updates.category = body.category;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.selectableByProjects !== undefined)
      updates.selectableByProjects = body.selectableByProjects;
    if (body.defaultCollaborationMode !== undefined)
      updates.defaultCollaborationMode = body.defaultCollaborationMode;
    if (body.defaultAutopilotLevel !== undefined)
      updates.defaultAutopilotLevel = body.defaultAutopilotLevel;
    if (body.defaultBossParticipationMode !== undefined) {
      updates.defaultBossParticipationMode = body.defaultBossParticipationMode;
    }
    if (body.forceBossParticipation !== undefined)
      updates.forceBossParticipation = body.forceBossParticipation;
    if (body.stageOrder !== undefined) updates.stageOrderJson = body.stageOrder;
    if (body.defaultRoles !== undefined) updates.defaultRolesJson = body.defaultRoles;
    await db.update(workflowTemplates).set(updates).where(eq(workflowTemplates.id, templateId));
    const updated = await db.query.workflowTemplates.findFirst({
      where: eq(workflowTemplates.id, templateId),
    });
    if (!updated) return c.json({ error: "Workflow template not found" }, 404);
    return c.json(updated);
  },
);

workflowTemplateRoutes.get("/:templateId/stages", async (c) => {
  const templateId = c.req.param("templateId");
  const rows = await db
    .select()
    .from(workflowTemplateStages)
    .where(eq(workflowTemplateStages.templateId, templateId));
  return c.json({ data: rows });
});

workflowTemplateRoutes.post(
  "/:templateId/stages",
  zValidator("json", workflowStageSchema),
  async (c) => {
    const templateId = c.req.param("templateId");
    const body = c.req.valid("json");
    await db.insert(workflowTemplateStages).values({
      id: body.id,
      templateId,
      stageKey: body.stageKey,
      name: body.name,
      enabled: body.enabled,
      mode: body.mode,
      primaryRoleAgentId: body.primaryRoleAgentId,
      participantRoleAgentIdsJson: body.participantRoleAgentIds,
      roleExecutionPoliciesJson: body.roleExecutionPolicies ?? null,
      entryCriteriaJson: body.entryCriteria ?? null,
      exitCriteriaJson: body.exitCriteria ?? null,
      initialTaskDefinitionJson: body.initialTaskDefinition ?? null,
      hooksJson: body.hooks ?? null,
      gatesJson: body.gates ?? null,
      approvalsJson: body.approvals ?? null,
      stageTemplateStrategyJson: body.stageTemplateStrategy ?? null,
      failurePolicyJson: body.failurePolicy ?? null,
      orderIndex: body.orderIndex,
    });
    const created = await db.query.workflowTemplateStages.findFirst({
      where: eq(workflowTemplateStages.id, body.id),
    });
    return c.json(created, 201);
  },
);

function buildWorkflowStageUpdates(body: z.infer<typeof workflowStagePatchSchema>) {
  return {
    ...(body.stageKey !== undefined ? { stageKey: body.stageKey } : {}),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.mode !== undefined ? { mode: body.mode } : {}),
    ...(body.primaryRoleAgentId !== undefined
      ? { primaryRoleAgentId: body.primaryRoleAgentId }
      : {}),
    ...(body.participantRoleAgentIds !== undefined
      ? { participantRoleAgentIdsJson: body.participantRoleAgentIds }
      : {}),
    ...(body.roleExecutionPolicies !== undefined
      ? { roleExecutionPoliciesJson: body.roleExecutionPolicies }
      : {}),
    ...(body.entryCriteria !== undefined ? { entryCriteriaJson: body.entryCriteria } : {}),
    ...(body.exitCriteria !== undefined ? { exitCriteriaJson: body.exitCriteria } : {}),
    ...(body.initialTaskDefinition !== undefined
      ? { initialTaskDefinitionJson: body.initialTaskDefinition }
      : {}),
    ...(body.hooks !== undefined ? { hooksJson: body.hooks } : {}),
    ...(body.gates !== undefined ? { gatesJson: body.gates } : {}),
    ...(body.approvals !== undefined ? { approvalsJson: body.approvals } : {}),
    ...(body.stageTemplateStrategy !== undefined
      ? { stageTemplateStrategyJson: body.stageTemplateStrategy }
      : {}),
    ...(body.failurePolicy !== undefined ? { failurePolicyJson: body.failurePolicy } : {}),
    ...(body.orderIndex !== undefined ? { orderIndex: body.orderIndex } : {}),
  } satisfies Record<string, unknown>;
}

workflowTemplateRoutes.patch(
  "/:templateId/stages/:stageId",
  zValidator("json", workflowStagePatchSchema),
  async (c) => {
    const templateId = c.req.param("templateId");
    const stageId = c.req.param("stageId");
    const body = c.req.valid("json");

    await db
      .update(workflowTemplateStages)
      .set(buildWorkflowStageUpdates(body))
      .where(
        and(
          eq(workflowTemplateStages.id, stageId),
          eq(workflowTemplateStages.templateId, templateId),
        ),
      );

    const updated = await db.query.workflowTemplateStages.findFirst({
      where: eq(workflowTemplateStages.id, stageId),
    });
    if (!updated) return c.json({ error: "Workflow template stage not found" }, 404);
    return c.json(updated);
  },
);

workflowTemplateRoutes.delete("/:templateId/stages/:stageId", async (c) => {
  const templateId = c.req.param("templateId");
  const stageId = c.req.param("stageId");

  const existing = await db.query.workflowTemplateStages.findFirst({
    where: and(
      eq(workflowTemplateStages.id, stageId),
      eq(workflowTemplateStages.templateId, templateId),
    ),
  });
  if (!existing) {
    return c.json({ error: "Workflow template stage not found" }, 404);
  }

  await db
    .delete(workflowTemplateStages)
    .where(
      and(
        eq(workflowTemplateStages.id, stageId),
        eq(workflowTemplateStages.templateId, templateId),
      ),
    );

  return c.json({ ok: true, id: stageId });
});
