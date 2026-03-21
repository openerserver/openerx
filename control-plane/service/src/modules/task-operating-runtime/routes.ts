import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import {
  bossDecisions,
  humanEscalations,
  projectTreeNodes,
  projects,
  taskOperatingModes,
  taskWorkflowRuns,
  workflowTemplates,
} from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";

export const taskOperatingRuntimeRoutes = new Hono<AppEnv>();

taskOperatingRuntimeRoutes.use("*", authMiddleware);
taskOperatingRuntimeRoutes.use("*", requireRole("developer"));

const collaborationModeSchema = z.enum(["solo", "team", "hybrid"]);
const autopilotLevelSchema = z.enum(["L0", "L1", "L2"]);
const bossParticipationModeSchema = z.enum([
  "disabled",
  "advisory",
  "exception-only",
  "full-manager",
]);
const operatingModeSourceSchema = z.enum([
  "system-default",
  "project-default",
  "task-override",
  "boss-decision",
]);

const operatingModeSchema = z.object({
  collaborationMode: collaborationModeSchema,
  autopilotLevel: autopilotLevelSchema,
  bossParticipationMode: bossParticipationModeSchema,
  selectedTemplateId: z.string().min(1).nullable().optional(),
  scenarioKey: z.string().min(1).optional(),
  source: operatingModeSourceSchema.default("task-override"),
});

const bossDecisionSchema = z.object({
  ts: z.string().datetime().optional(),
  decisionType: z.string().min(1),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  stageKey: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const escalationSchema = z.object({
  ts: z.string().datetime().optional(),
  reason: z.string().min(1),
  status: z.string().min(1).optional(),
  stageKey: z.string().min(1).optional(),
  requestedBy: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type OperatingModeSelection = z.infer<typeof operatingModeSchema>;

function requireTaskId(c: { req: { param: (name: string) => string | undefined } }) {
  return c.req.param("taskId") ?? "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asCollaborationMode(
  value: unknown,
): OperatingModeSelection["collaborationMode"] | undefined {
  return value === "solo" || value === "team" || value === "hybrid" ? value : undefined;
}

function asAutopilotLevel(value: unknown): OperatingModeSelection["autopilotLevel"] | undefined {
  return value === "L0" || value === "L1" || value === "L2" ? value : undefined;
}

function asBossParticipationMode(
  value: unknown,
): OperatingModeSelection["bossParticipationMode"] | undefined {
  return value === "disabled" ||
    value === "advisory" ||
    value === "exception-only" ||
    value === "full-manager"
    ? value
    : undefined;
}

function parseTaskStrategy(strategy: unknown) {
  if (!strategy) {
    return {} as Record<string, unknown>;
  }
  if (typeof strategy === "string") {
    try {
      return asRecord(JSON.parse(strategy)) || {};
    } catch {
      return {};
    }
  }
  return asRecord(strategy) || {};
}

async function getTaskOrNull(taskId: string) {
  const node = await db.query.projectTreeNodes.findFirst({
    where: and(eq(projectTreeNodes.id, taskId), eq(projectTreeNodes.nodeType, "task")),
  });

  if (!node) {
    return null;
  }

  const content =
    node.contentJson && typeof node.contentJson === "object"
      ? (node.contentJson as Record<string, unknown>)
      : {};

  return {
    id: node.id,
    projectId: node.projectId,
    strategy: content.strategy ?? null,
  };
}

async function getProjectDefaults(projectId: string): Promise<OperatingModeSelection | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const settings = (() => {
    if (!project?.settings) return null;
    if (typeof project.settings === "string") {
      try {
        return asRecord(JSON.parse(project.settings));
      } catch {
        return null;
      }
    }
    return asRecord(project.settings);
  })();

  if (!settings) {
    return null;
  }

  const collaborationMode = asCollaborationMode(settings.collaborationMode);
  const autopilotLevel = asAutopilotLevel(settings.autopilotLevel);
  const bossParticipationMode = asBossParticipationMode(settings.bossParticipationMode);
  if (collaborationMode && autopilotLevel && bossParticipationMode) {
    return {
      collaborationMode,
      autopilotLevel,
      bossParticipationMode,
      selectedTemplateId: asNonEmptyString(settings.preferredTemplateId) || null,
      scenarioKey: undefined,
      source: "project-default" as const,
    };
  }

  return null;
}

async function getTemplateStrategy(templateId: string, projectId: string) {
  const [template] = await db
    .select()
    .from(workflowTemplates)
    .where(eq(workflowTemplates.id, templateId))
    .limit(1);
  if (!template || !template.enabled) {
    return null;
  }

  const selectableForProject = template.selectableByProjects || template.projectId === projectId;
  if (!selectableForProject) {
    return null;
  }

  return template;
}

async function readCurrentStage(taskId: string) {
  const [row] = await db
    .select({ currentStage: taskWorkflowRuns.currentStage })
    .from(taskWorkflowRuns)
    .where(eq(taskWorkflowRuns.taskId, taskId))
    .orderBy(desc(taskWorkflowRuns.updatedAt))
    .limit(1);
  return row?.currentStage || undefined;
}

async function resolveEffectiveOperatingMode(
  taskId: string,
  projectId: string,
  strategy: Record<string, unknown>,
): Promise<OperatingModeSelection> {
  return (
    normalizeOperatingModeRow(await readOperatingModeRow(taskId)) ||
    extractLegacyOperatingMode(strategy) ||
    (await getProjectDefaults(projectId)) || {
      collaborationMode: "solo" as const,
      autopilotLevel: "L1" as const,
      bossParticipationMode: "advisory" as const,
      selectedTemplateId: null,
      scenarioKey: undefined,
      source: "project-default" as const,
    }
  );
}

function formatModeSummary(mode: OperatingModeSelection | null | undefined) {
  if (!mode) {
    return "未记录";
  }
  return `${mode.collaborationMode} / ${mode.autopilotLevel} / ${mode.bossParticipationMode}${mode.selectedTemplateId ? ` / ${mode.selectedTemplateId}` : ""}`;
}

async function createManualOverrideRecord(
  taskId: string,
  userId: string,
  action: "manual-override" | "clear-override" | "select-template",
  reason: string,
  previousMode: OperatingModeSelection | null,
  nextMode: OperatingModeSelection | null,
) {
  return {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    decisionType: action,
    reason,
    confidence: null,
    stageKey: (await readCurrentStage(taskId)) ?? null,
    metadata: {
      actorType: "human",
      actorId: userId,
      action,
      previousMode,
      nextMode,
    },
  };
}

async function applyBossTemplateSelection(
  taskId: string,
  taskProjectId: string,
  selectedTemplateId: string,
) {
  const task = await getTaskOrNull(taskId);
  if (!task) {
    return null;
  }
  const strategy = parseTaskStrategy(task.strategy);
  const currentMode = await resolveEffectiveOperatingMode(taskId, taskProjectId, strategy);
  const template = await getTemplateStrategy(selectedTemplateId, taskProjectId);
  if (!template) {
    return null;
  }

  const templateCollaborationMode = asCollaborationMode(template.defaultCollaborationMode);
  const templateAutopilotLevel = asAutopilotLevel(template.defaultAutopilotLevel);
  const templateBossParticipationMode = asBossParticipationMode(
    template.defaultBossParticipationMode,
  );

  const nextMode: OperatingModeSelection = {
    collaborationMode: templateCollaborationMode || currentMode.collaborationMode,
    autopilotLevel: templateAutopilotLevel || currentMode.autopilotLevel,
    bossParticipationMode: template.forceBossParticipation
      ? "full-manager"
      : templateBossParticipationMode || currentMode.bossParticipationMode,
    selectedTemplateId: template.id,
    scenarioKey: currentMode.scenarioKey,
    source: "boss-decision",
  };

  await insertOperatingMode(taskId, nextMode);
  return nextMode;
}

async function readOperatingModeRow(taskId: string) {
  const [row] = await db
    .select({
      collaborationMode: taskOperatingModes.collaborationMode,
      autopilotLevel: taskOperatingModes.autopilotLevel,
      bossParticipationMode: taskOperatingModes.bossParticipationMode,
      selectedTemplateId: taskOperatingModes.selectedTemplateId,
      scenarioKey: taskOperatingModes.scenarioKey,
      source: taskOperatingModes.source,
    })
    .from(taskOperatingModes)
    .where(eq(taskOperatingModes.taskId, taskId))
    .limit(1);
  return row ?? null;
}

function normalizeOperatingModeRow(
  row: {
    collaborationMode: string;
    autopilotLevel: string;
    bossParticipationMode: string;
    selectedTemplateId: string | null;
    scenarioKey: string | null;
    source: string;
  } | null,
): OperatingModeSelection | null {
  if (!row) {
    return null;
  }

  if (
    (row.collaborationMode !== "solo" &&
      row.collaborationMode !== "team" &&
      row.collaborationMode !== "hybrid") ||
    (row.autopilotLevel !== "L0" && row.autopilotLevel !== "L1" && row.autopilotLevel !== "L2") ||
    (row.bossParticipationMode !== "disabled" &&
      row.bossParticipationMode !== "advisory" &&
      row.bossParticipationMode !== "exception-only" &&
      row.bossParticipationMode !== "full-manager") ||
    (row.source !== "system-default" &&
      row.source !== "project-default" &&
      row.source !== "task-override" &&
      row.source !== "boss-decision")
  ) {
    return null;
  }

  return {
    collaborationMode: row.collaborationMode,
    autopilotLevel: row.autopilotLevel,
    bossParticipationMode: row.bossParticipationMode,
    selectedTemplateId: row.selectedTemplateId,
    scenarioKey: row.scenarioKey || undefined,
    source: row.source,
  };
}

function extractLegacyOperatingMode(
  strategy: Record<string, unknown>,
): OperatingModeSelection | null {
  const collaborationMode = strategy.collaborationMode;
  const autopilotLevel = strategy.autopilotLevel;
  const bossParticipationMode = strategy.bossParticipationMode;
  const source = strategy.operatingModeSource;
  if (
    (collaborationMode === "solo" ||
      collaborationMode === "team" ||
      collaborationMode === "hybrid") &&
    (autopilotLevel === "L0" || autopilotLevel === "L1" || autopilotLevel === "L2") &&
    (bossParticipationMode === "disabled" ||
      bossParticipationMode === "advisory" ||
      bossParticipationMode === "exception-only" ||
      bossParticipationMode === "full-manager")
  ) {
    return {
      collaborationMode,
      autopilotLevel,
      bossParticipationMode,
      selectedTemplateId:
        asNonEmptyString(strategy.selectedTemplateId) ||
        asNonEmptyString(strategy.workflowTemplateId) ||
        null,
      scenarioKey: asNonEmptyString(strategy.scenarioKey),
      source:
        source === "system-default" ||
        source === "project-default" ||
        source === "task-override" ||
        source === "boss-decision"
          ? source
          : "task-override",
    };
  }

  return null;
}

async function insertOperatingMode(taskId: string, value: OperatingModeSelection) {
  const now = new Date().toISOString();
  await db
    .insert(taskOperatingModes)
    .values({
      taskId,
      collaborationMode: value.collaborationMode,
      autopilotLevel: value.autopilotLevel,
      bossParticipationMode: value.bossParticipationMode,
      selectedTemplateId: value.selectedTemplateId ?? null,
      scenarioKey: value.scenarioKey ?? null,
      source: value.source,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskOperatingModes.taskId,
      set: {
        collaborationMode: value.collaborationMode,
        autopilotLevel: value.autopilotLevel,
        bossParticipationMode: value.bossParticipationMode,
        selectedTemplateId: value.selectedTemplateId ?? null,
        scenarioKey: value.scenarioKey ?? null,
        source: value.source,
        updatedAt: now,
      },
    });
}

async function countRows(tableName: "boss_decisions" | "human_escalations", taskId: string) {
  if (tableName === "boss_decisions") {
    const [row] = await db
      .select({ count: count() })
      .from(bossDecisions)
      .where(eq(bossDecisions.taskId, taskId));
    return Number(row?.count || 0);
  }

  const [row] = await db
    .select({ count: count() })
    .from(humanEscalations)
    .where(eq(humanEscalations.taskId, taskId));
  return Number(row?.count || 0);
}

function normalizeBossDecision(value: unknown, index: number) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    id: asNonEmptyString(record.id) || `boss-decision-${index + 1}`,
    ts: asNonEmptyString(record.ts) || new Date(0).toISOString(),
    decisionType: asNonEmptyString(record.decisionType) || "unknown",
    reason: asNonEmptyString(record.reason) || "",
    confidence: typeof record.confidence === "number" ? record.confidence : null,
    stageKey: asNonEmptyString(record.stageKey) || null,
    metadata: asRecord(record.metadata) || null,
  };
}

function normalizeEscalation(value: unknown, index: number) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    id: asNonEmptyString(record.id) || `human-escalation-${index + 1}`,
    ts: asNonEmptyString(record.ts) || new Date(0).toISOString(),
    reason: asNonEmptyString(record.reason) || "",
    status: asNonEmptyString(record.status) || null,
    stageKey: asNonEmptyString(record.stageKey) || null,
    requestedBy: asNonEmptyString(record.requestedBy) || null,
    metadata: asRecord(record.metadata) || null,
  };
}

async function insertBossDecision(
  taskId: string,
  value: ReturnType<typeof normalizeBossDecision> extends infer T ? T : never,
) {
  if (!value) {
    return;
  }
  await db
    .insert(bossDecisions)
    .values({
      id: value.id,
      taskId,
      ts: value.ts,
      decisionType: value.decisionType,
      reason: value.reason,
      confidence: value.confidence,
      stageKey: value.stageKey,
      metadataJson: value.metadata ?? null,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
}

async function insertEscalation(
  taskId: string,
  value: ReturnType<typeof normalizeEscalation> extends infer T ? T : never,
) {
  if (!value) {
    return;
  }
  await db
    .insert(humanEscalations)
    .values({
      id: value.id,
      taskId,
      ts: value.ts,
      reason: value.reason,
      status: value.status,
      stageKey: value.stageKey,
      requestedBy: value.requestedBy,
      metadataJson: value.metadata ?? null,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
}

async function migrateLegacyRuntime(taskId: string, strategy: Record<string, unknown>) {
  if (!(await readOperatingModeRow(taskId))) {
    const legacyMode = extractLegacyOperatingMode(strategy);
    if (legacyMode) {
      await insertOperatingMode(taskId, legacyMode);
    }
  }

  if ((await countRows("boss_decisions", taskId)) === 0 && Array.isArray(strategy.bossDecisions)) {
    for (const decision of strategy.bossDecisions.map(normalizeBossDecision)) {
      await insertBossDecision(taskId, decision);
    }
  }

  if (
    (await countRows("human_escalations", taskId)) === 0 &&
    Array.isArray(strategy.escalationRequests)
  ) {
    for (const escalation of strategy.escalationRequests.map(normalizeEscalation)) {
      await insertEscalation(taskId, escalation);
    }
  }
}

async function listBossDecisions(taskId: string) {
  const rows = await db
    .select()
    .from(bossDecisions)
    .where(eq(bossDecisions.taskId, taskId))
    .orderBy(desc(bossDecisions.ts), desc(bossDecisions.createdAt));
  return rows.map((row) => ({
    id: row.id,
    ts: row.ts,
    decisionType: row.decisionType,
    reason: row.reason,
    confidence: row.confidence ?? undefined,
    stageKey: row.stageKey ?? undefined,
    metadata: row.metadataJson ?? undefined,
  }));
}

async function listEscalations(taskId: string) {
  const rows = await db
    .select()
    .from(humanEscalations)
    .where(eq(humanEscalations.taskId, taskId))
    .orderBy(desc(humanEscalations.ts), desc(humanEscalations.createdAt));
  return rows.map((row) => ({
    id: row.id,
    ts: row.ts,
    reason: row.reason,
    status: row.status ?? undefined,
    stageKey: row.stageKey ?? undefined,
    requestedBy: row.requestedBy ?? undefined,
    metadata: row.metadataJson ?? undefined,
  }));
}

async function requireTask(taskId: string) {
  const task = await getTaskOrNull(taskId);
  if (!task) {
    return null;
  }
  await migrateLegacyRuntime(taskId, parseTaskStrategy(task.strategy));
  return task;
}

taskOperatingRuntimeRoutes.get("/state", async (c) => {
  const taskId = requireTaskId(c);
  const task = await requireTask(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const strategy = parseTaskStrategy(task.strategy);
  const mode =
    normalizeOperatingModeRow(await readOperatingModeRow(taskId)) ||
    extractLegacyOperatingMode(strategy) ||
    (await getProjectDefaults(task.projectId));
  const [workflowRun] = await db
    .select({ currentStage: taskWorkflowRuns.currentStage, status: taskWorkflowRuns.status })
    .from(taskWorkflowRuns)
    .where(eq(taskWorkflowRuns.taskId, taskId))
    .orderBy(desc(taskWorkflowRuns.updatedAt))
    .limit(1);

  return c.json({
    collaborationMode: mode?.collaborationMode,
    autopilotLevel: mode?.autopilotLevel,
    bossParticipationMode: mode?.bossParticipationMode,
    operatingModeSource: mode?.source,
    currentStageKey: workflowRun?.currentStage || asNonEmptyString(strategy.currentStageKey),
    currentStageStatus: workflowRun?.status || asNonEmptyString(strategy.currentStageStatus),
  });
});

taskOperatingRuntimeRoutes.get("/mode", async (c) => {
  const taskId = requireTaskId(c);
  const task = await requireTask(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json({
    data: normalizeOperatingModeRow(await readOperatingModeRow(taskId)),
  });
});

taskOperatingRuntimeRoutes.put("/mode", zValidator("json", operatingModeSchema), async (c) => {
  const taskId = requireTaskId(c);
  const task = await requireTask(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const body = c.req.valid("json");
  const strategy = parseTaskStrategy(task.strategy);
  const previousMode = await resolveEffectiveOperatingMode(taskId, task.projectId, strategy);
  await insertOperatingMode(taskId, body);

  if (body.source === "task-override") {
    const record = await createManualOverrideRecord(
      taskId,
      c.get("user").sub,
      "manual-override",
      `人工覆盖任务运行档位：${formatModeSummary(previousMode)} -> ${formatModeSummary(body)}`,
      previousMode,
      body,
    );
    await insertBossDecision(taskId, record);
  }

  return c.json({ ok: true, data: normalizeOperatingModeRow(await readOperatingModeRow(taskId)) });
});

taskOperatingRuntimeRoutes.delete("/mode", async (c) => {
  const taskId = requireTaskId(c);
  const task = await requireTask(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const strategy = parseTaskStrategy(task.strategy);
  const previousMode = await resolveEffectiveOperatingMode(taskId, task.projectId, strategy);
  await db.delete(taskOperatingModes).where(eq(taskOperatingModes.taskId, taskId));

  const restoredMode = await resolveEffectiveOperatingMode(taskId, task.projectId, strategy);
  const record = await createManualOverrideRecord(
    taskId,
    c.get("user").sub,
    "clear-override",
    `人工清除了任务级覆盖，恢复到默认档位：${formatModeSummary(restoredMode)}`,
    previousMode,
    restoredMode,
  );
  await insertBossDecision(taskId, record);
  return c.json({ ok: true });
});

taskOperatingRuntimeRoutes.get("/boss-decisions", async (c) => {
  const taskId = requireTaskId(c);
  const task = await requireTask(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json({ data: await listBossDecisions(taskId) });
});

taskOperatingRuntimeRoutes.post(
  "/boss-decisions",
  zValidator("json", bossDecisionSchema),
  async (c) => {
    const taskId = requireTaskId(c);
    const task = await requireTask(taskId);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const body = c.req.valid("json");
    const record = {
      id: crypto.randomUUID(),
      ts: body.ts || new Date().toISOString(),
      decisionType: body.decisionType,
      reason: body.reason,
      confidence: body.confidence ?? null,
      stageKey: body.stageKey ?? null,
      metadata: body.metadata ?? null,
    };
    await insertBossDecision(taskId, record);

    if (body.decisionType === "select-template") {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, task.projectId))
        .limit(1);
      const settings = (() => {
        if (!project?.settings) return null;
        if (typeof project.settings === "string") {
          try {
            return asRecord(JSON.parse(project.settings));
          } catch {
            return null;
          }
        }
        return asRecord(project.settings);
      })();
      const selectedTemplateId = asNonEmptyString(body.metadata?.selectedTemplateId);

      if (settings?.allowBossAutoTemplateSwitch && selectedTemplateId) {
        const nextMode = await applyBossTemplateSelection(
          taskId,
          task.projectId,
          selectedTemplateId,
        );
        if (nextMode) {
          return c.json(
            {
              ok: true,
              data: { ...record, metadata: { ...(record.metadata || {}), appliedMode: nextMode } },
            },
            201,
          );
        }
      }
    }

    return c.json({ ok: true, data: record }, 201);
  },
);

taskOperatingRuntimeRoutes.get("/escalations", async (c) => {
  const taskId = requireTaskId(c);
  const task = await requireTask(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json({ data: await listEscalations(taskId) });
});

taskOperatingRuntimeRoutes.post("/escalations", zValidator("json", escalationSchema), async (c) => {
  const taskId = requireTaskId(c);
  const task = await requireTask(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const body = c.req.valid("json");
  const record = {
    id: crypto.randomUUID(),
    ts: body.ts || new Date().toISOString(),
    reason: body.reason,
    status: body.status ?? null,
    stageKey: body.stageKey ?? null,
    requestedBy: body.requestedBy ?? null,
    metadata: body.metadata ?? null,
  };
  await insertEscalation(taskId, record);
  return c.json({ ok: true, data: record }, 201);
});
