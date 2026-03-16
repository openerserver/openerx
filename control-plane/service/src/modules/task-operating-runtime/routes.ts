import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db, sqlite } from "../../db";
import { projects, tasks, workflowTemplates } from "../../db/schema";
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

function asCollaborationMode(value: unknown): OperatingModeSelection["collaborationMode"] | undefined {
  return value === "solo" || value === "team" || value === "hybrid" ? value : undefined;
}

function asAutopilotLevel(value: unknown): OperatingModeSelection["autopilotLevel"] | undefined {
  return value === "L0" || value === "L1" || value === "L2" ? value : undefined;
}

function asBossParticipationMode(value: unknown): OperatingModeSelection["bossParticipationMode"] | undefined {
  return value === "disabled"
    || value === "advisory"
    || value === "exception-only"
    || value === "full-manager"
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
  return db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });
}

async function getProjectDefaults(projectId: string): Promise<OperatingModeSelection | null> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
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
  const template = await db.query.workflowTemplates.findFirst({
    where: eq(workflowTemplates.id, templateId),
  });
  if (!template || !template.enabled) {
    return null;
  }

  const selectableForProject = template.selectableByProjects || template.projectId === projectId;
  if (!selectableForProject) {
    return null;
  }

  return template;
}

function readCurrentStage(taskId: string) {
  const row = sqlite
    .query(
      `SELECT current_stage
       FROM task_workflow_runs
       WHERE task_id = ?1
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(taskId) as { current_stage: string | null } | null;
  return row?.current_stage || undefined;
}

async function resolveEffectiveOperatingMode(
  taskId: string,
  projectId: string,
  strategy: Record<string, unknown>,
): Promise<OperatingModeSelection> {
  return normalizeOperatingModeRow(readOperatingModeRow(taskId))
    || extractLegacyOperatingMode(strategy)
    || (await getProjectDefaults(projectId))
    || {
      collaborationMode: "solo" as const,
      autopilotLevel: "L1" as const,
      bossParticipationMode: "advisory" as const,
      selectedTemplateId: null,
      scenarioKey: undefined,
      source: "project-default" as const,
    };
}

function formatModeSummary(mode: OperatingModeSelection | null | undefined) {
  if (!mode) {
    return "未记录";
  }
  return `${mode.collaborationMode} / ${mode.autopilotLevel} / ${mode.bossParticipationMode}${mode.selectedTemplateId ? ` / ${mode.selectedTemplateId}` : ""}`;
}

function createManualOverrideRecord(
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
    stageKey: readCurrentStage(taskId) ?? null,
    metadata: {
      actorType: "human",
      actorId: userId,
      action,
      previousMode,
      nextMode,
    },
  };
}

async function applyBossTemplateSelection(taskId: string, taskProjectId: string, selectedTemplateId: string) {
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
  const templateBossParticipationMode = asBossParticipationMode(template.defaultBossParticipationMode);

  const nextMode: OperatingModeSelection = {
    collaborationMode: templateCollaborationMode || currentMode.collaborationMode,
    autopilotLevel: templateAutopilotLevel || currentMode.autopilotLevel,
    bossParticipationMode: template.forceBossParticipation
      ? "full-manager"
      : (templateBossParticipationMode || currentMode.bossParticipationMode),
    selectedTemplateId: template.id,
    scenarioKey: currentMode.scenarioKey,
    source: "boss-decision",
  };

  insertOperatingMode(taskId, nextMode);
  return nextMode;
}

function readOperatingModeRow(taskId: string) {
  return sqlite
    .query(
      `SELECT collaboration_mode, autopilot_level, boss_participation_mode, selected_template_id, scenario_key, source
       FROM task_operating_modes
       WHERE task_id = ?1
       LIMIT 1`,
    )
    .get(taskId) as
    | {
        collaboration_mode: string;
        autopilot_level: string;
        boss_participation_mode: string;
        selected_template_id: string | null;
        scenario_key: string | null;
        source: string;
      }
    | null;
}

function normalizeOperatingModeRow(
  row:
    | {
        collaboration_mode: string;
        autopilot_level: string;
        boss_participation_mode: string;
        selected_template_id: string | null;
        scenario_key: string | null;
        source: string;
      }
    | null,
): OperatingModeSelection | null {
  if (!row) {
    return null;
  }

  if (
    (row.collaboration_mode !== "solo" && row.collaboration_mode !== "team" && row.collaboration_mode !== "hybrid")
    || (row.autopilot_level !== "L0" && row.autopilot_level !== "L1" && row.autopilot_level !== "L2")
    || (row.boss_participation_mode !== "disabled"
      && row.boss_participation_mode !== "advisory"
      && row.boss_participation_mode !== "exception-only"
      && row.boss_participation_mode !== "full-manager")
    || (row.source !== "system-default"
      && row.source !== "project-default"
      && row.source !== "task-override"
      && row.source !== "boss-decision")
  ) {
    return null;
  }

  return {
    collaborationMode: row.collaboration_mode,
    autopilotLevel: row.autopilot_level,
    bossParticipationMode: row.boss_participation_mode,
    selectedTemplateId: row.selected_template_id,
    scenarioKey: row.scenario_key || undefined,
    source: row.source,
  };
}

function extractLegacyOperatingMode(strategy: Record<string, unknown>): OperatingModeSelection | null {
  const collaborationMode = strategy.collaborationMode;
  const autopilotLevel = strategy.autopilotLevel;
  const bossParticipationMode = strategy.bossParticipationMode;
  const source = strategy.operatingModeSource;
  if (
    (collaborationMode === "solo" || collaborationMode === "team" || collaborationMode === "hybrid")
    && (autopilotLevel === "L0" || autopilotLevel === "L1" || autopilotLevel === "L2")
    && (bossParticipationMode === "disabled"
      || bossParticipationMode === "advisory"
      || bossParticipationMode === "exception-only"
      || bossParticipationMode === "full-manager")
  ) {
    return {
      collaborationMode,
      autopilotLevel,
      bossParticipationMode,
      selectedTemplateId: asNonEmptyString(strategy.selectedTemplateId) || asNonEmptyString(strategy.workflowTemplateId) || null,
      scenarioKey: asNonEmptyString(strategy.scenarioKey),
      source:
        source === "system-default"
        || source === "project-default"
        || source === "task-override"
        || source === "boss-decision"
          ? source
          : "task-override",
    };
  }

  return null;
}

function insertOperatingMode(taskId: string, value: OperatingModeSelection) {
  const now = new Date().toISOString();
  sqlite
    .query(
      `INSERT INTO task_operating_modes (
        task_id, collaboration_mode, autopilot_level, boss_participation_mode,
        selected_template_id, scenario_key, source, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
      ON CONFLICT(task_id) DO UPDATE SET
        collaboration_mode = excluded.collaboration_mode,
        autopilot_level = excluded.autopilot_level,
        boss_participation_mode = excluded.boss_participation_mode,
        selected_template_id = excluded.selected_template_id,
        scenario_key = excluded.scenario_key,
        source = excluded.source,
        updated_at = excluded.updated_at`,
    )
    .run(
      taskId,
      value.collaborationMode,
      value.autopilotLevel,
      value.bossParticipationMode,
      value.selectedTemplateId ?? null,
      value.scenarioKey ?? null,
      value.source,
      now,
    );
}

function countRows(tableName: "boss_decisions" | "human_escalations", taskId: string) {
  const row = sqlite
    .query(`SELECT COUNT(1) as count FROM ${tableName} WHERE task_id = ?1`)
    .get(taskId) as { count: number } | null;
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

function insertBossDecision(taskId: string, value: ReturnType<typeof normalizeBossDecision> extends infer T ? T : never) {
  if (!value) {
    return;
  }
  sqlite
    .query(
      `INSERT OR IGNORE INTO boss_decisions (
        id, task_id, ts, decision_type, reason, confidence, stage_key, metadata_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .run(
      value.id,
      taskId,
      value.ts,
      value.decisionType,
      value.reason,
      value.confidence,
      value.stageKey,
      value.metadata ? JSON.stringify(value.metadata) : null,
      new Date().toISOString(),
    );
}

function insertEscalation(taskId: string, value: ReturnType<typeof normalizeEscalation> extends infer T ? T : never) {
  if (!value) {
    return;
  }
  sqlite
    .query(
      `INSERT OR IGNORE INTO human_escalations (
        id, task_id, ts, reason, status, stage_key, requested_by, metadata_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .run(
      value.id,
      taskId,
      value.ts,
      value.reason,
      value.status,
      value.stageKey,
      value.requestedBy,
      value.metadata ? JSON.stringify(value.metadata) : null,
      new Date().toISOString(),
    );
}

async function migrateLegacyRuntime(taskId: string, strategy: Record<string, unknown>) {
  if (!readOperatingModeRow(taskId)) {
    const legacyMode = extractLegacyOperatingMode(strategy);
    if (legacyMode) {
      insertOperatingMode(taskId, legacyMode);
    }
  }

  if (countRows("boss_decisions", taskId) === 0 && Array.isArray(strategy.bossDecisions)) {
    strategy.bossDecisions
      .map(normalizeBossDecision)
      .forEach((decision) => insertBossDecision(taskId, decision));
  }

  if (countRows("human_escalations", taskId) === 0 && Array.isArray(strategy.escalationRequests)) {
    strategy.escalationRequests
      .map(normalizeEscalation)
      .forEach((escalation) => insertEscalation(taskId, escalation));
  }
}

function listBossDecisions(taskId: string) {
  const rows = sqlite
    .query(
      `SELECT id, ts, decision_type, reason, confidence, stage_key, metadata_json
       FROM boss_decisions
       WHERE task_id = ?1
       ORDER BY ts DESC, created_at DESC`,
    )
    .all(taskId) as Array<{
      id: string;
      ts: string;
      decision_type: string;
      reason: string;
      confidence: number | null;
      stage_key: string | null;
      metadata_json: string | null;
    }>;
  return rows.map((row) => ({
    id: row.id,
    ts: row.ts,
    decisionType: row.decision_type,
    reason: row.reason,
    confidence: row.confidence ?? undefined,
    stageKey: row.stage_key ?? undefined,
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : undefined,
  }));
}

function listEscalations(taskId: string) {
  const rows = sqlite
    .query(
      `SELECT id, ts, reason, status, stage_key, requested_by, metadata_json
       FROM human_escalations
       WHERE task_id = ?1
       ORDER BY ts DESC, created_at DESC`,
    )
    .all(taskId) as Array<{
      id: string;
      ts: string;
      reason: string;
      status: string | null;
      stage_key: string | null;
      requested_by: string | null;
      metadata_json: string | null;
    }>;
  return rows.map((row) => ({
    id: row.id,
    ts: row.ts,
    reason: row.reason,
    status: row.status ?? undefined,
    stageKey: row.stage_key ?? undefined,
    requestedBy: row.requested_by ?? undefined,
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : undefined,
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
  const mode = normalizeOperatingModeRow(readOperatingModeRow(taskId))
    || extractLegacyOperatingMode(strategy)
    || (await getProjectDefaults(task.projectId));
  const workflowRun = sqlite
    .query(
      `SELECT current_stage, status
       FROM task_workflow_runs
       WHERE task_id = ?1
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(taskId) as { current_stage: string | null; status: string | null } | null;

  return c.json({
    collaborationMode: mode?.collaborationMode,
    autopilotLevel: mode?.autopilotLevel,
    bossParticipationMode: mode?.bossParticipationMode,
    operatingModeSource: mode?.source,
    currentStageKey: workflowRun?.current_stage || asNonEmptyString(strategy.currentStageKey),
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
    data: normalizeOperatingModeRow(readOperatingModeRow(taskId)),
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
  insertOperatingMode(taskId, body);

  if (body.source === "task-override") {
    const record = createManualOverrideRecord(
      taskId,
      c.get("user").sub,
      "manual-override",
      `人工覆盖任务运行档位：${formatModeSummary(previousMode)} -> ${formatModeSummary(body)}`,
      previousMode,
      body,
    );
    insertBossDecision(taskId, record);
  }

  return c.json({ ok: true, data: normalizeOperatingModeRow(readOperatingModeRow(taskId)) });
});

taskOperatingRuntimeRoutes.delete("/mode", async (c) => {
  const taskId = requireTaskId(c);
  const task = await requireTask(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const strategy = parseTaskStrategy(task.strategy);
  const previousMode = await resolveEffectiveOperatingMode(taskId, task.projectId, strategy);
  sqlite.query(`DELETE FROM task_operating_modes WHERE task_id = ?1`).run(taskId);

  const restoredMode = await resolveEffectiveOperatingMode(taskId, task.projectId, strategy);
  const record = createManualOverrideRecord(
    taskId,
    c.get("user").sub,
    "clear-override",
    `人工清除了任务级覆盖，恢复到默认档位：${formatModeSummary(restoredMode)}`,
    previousMode,
    restoredMode,
  );
  insertBossDecision(taskId, record);
  return c.json({ ok: true });
});

taskOperatingRuntimeRoutes.get("/boss-decisions", async (c) => {
  const taskId = requireTaskId(c);
  const task = await requireTask(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json({ data: listBossDecisions(taskId) });
});

taskOperatingRuntimeRoutes.post("/boss-decisions", zValidator("json", bossDecisionSchema), async (c) => {
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
  insertBossDecision(taskId, record);

  if (body.decisionType === "select-template") {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, task.projectId),
    });
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
      const nextMode = await applyBossTemplateSelection(taskId, task.projectId, selectedTemplateId);
      if (nextMode) {
        return c.json({ ok: true, data: { ...record, metadata: { ...(record.metadata || {}), appliedMode: nextMode } } }, 201);
      }
    }
  }

  return c.json({ ok: true, data: record }, 201);
});

taskOperatingRuntimeRoutes.get("/escalations", async (c) => {
  const taskId = requireTaskId(c);
  const task = await requireTask(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json({ data: listEscalations(taskId) });
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
  insertEscalation(taskId, record);
  return c.json({ ok: true, data: record }, 201);
});