import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  developerChangeRequests,
  roleAggregateConclusions,
  taskStageRuns,
  taskWorkflowRuns,
  tasks,
  workflowTemplateStages,
} from "../../db/schema";

type JsonRecord = Record<string, unknown>;
type WorkflowStatus = typeof taskWorkflowRuns.$inferSelect.status | typeof tasks.$inferSelect.status;

const legacyWorkflowMigrationInflight = new Map<string, Promise<typeof tasks.$inferSelect | null>>();

function parseTaskStrategy(raw: string | null | undefined) {
  if (!raw) {
    return {} as JsonRecord;
  }

  try {
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return {} as JsonRecord;
  }
}

function normalizeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function isNonEmptyObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serializeTaskStrategy(strategy: JsonRecord) {
  return Object.keys(strategy).length > 0 ? JSON.stringify(strategy) : null;
}

function parseExecutionPlan(raw: string | null | undefined) {
  if (!raw) {
    return {} as JsonRecord;
  }

  try {
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return {} as JsonRecord;
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function inferWorkflowTemplateId(strategy: JsonRecord, executionPlan: JsonRecord) {
  return (
    readString(strategy.workflowTemplateId)
    || readString(strategy.selectedTemplateId)
    || readString(executionPlan.templateId)
    || "legacy-unspecified"
  );
}

function inferLegacyStage(strategy: JsonRecord, legacyRoleConclusions: unknown[]) {
  const strategyStage = readString(strategy.currentStage);
  if (strategyStage) {
    return strategyStage;
  }

  const lastConclusion = [...legacyRoleConclusions].reverse().find((item) => {
    const entry = isNonEmptyObject(item) ? item : null;
    return Boolean(entry && typeof entry.stage === "string" && entry.stage);
  });
  if (isNonEmptyObject(lastConclusion) && typeof lastConclusion.stage === "string") {
    return lastConclusion.stage;
  }

  return null;
}

function inferWorkflowStatus(taskStatus: typeof tasks.$inferSelect.status) {
  switch (taskStatus) {
    case "running":
      return "running" as const;
    case "paused":
      return "blocked" as const;
    case "completed":
      return "completed" as const;
    case "failed":
      return "failed" as const;
    case "cancelled":
      return "cancelled" as const;
    default:
      return "pending" as const;
  }
}

function inferCurrentStage(taskStatus: typeof tasks.$inferSelect.status, legacyStage: string | null) {
  switch (taskStatus) {
    case "completed":
      return "done";
    case "cancelled":
      return "cancelled";
    case "running":
    case "paused":
    case "failed":
      return legacyStage ?? "unknown";
    default:
      return legacyStage ?? "intake";
  }
}

function buildStageRunStatus(
  taskStatus: WorkflowStatus,
  stageKey: string,
  currentStage: string,
  index: number,
  currentIndex: number,
) {
  if (taskStatus === "completed") {
    return "completed" as const;
  }

  if (index < currentIndex) {
    return "completed" as const;
  }

  if (stageKey !== currentStage) {
    return "pending" as const;
  }

  switch (taskStatus) {
    case "running":
      return "running" as const;
    case "paused":
    case "blocked":
      return "blocked" as const;
    case "waiting-approval":
      return "waiting-approval" as const;
    case "failed":
      return "failed" as const;
    case "cancelled":
      return "cancelled" as const;
    default:
      return "pending" as const;
  }
}

async function ensureWorkflowStageRunsMigrated(
  workflowRun: typeof taskWorkflowRuns.$inferSelect,
  task: typeof tasks.$inferSelect,
  legacyStage: string | null,
) {
  const existingStageRun = await db.query.taskStageRuns.findFirst({
    where: eq(taskStageRuns.workflowRunId, workflowRun.id),
  });
  if (existingStageRun) {
    return;
  }

  const templateStages = await db
    .select()
    .from(workflowTemplateStages)
    .where(eq(workflowTemplateStages.templateId, workflowRun.templateId));

  if (templateStages.length === 0) {
    return;
  }

  const orderedStages = [...templateStages].sort((left, right) => left.orderIndex - right.orderIndex);
  const fallbackStageKey = orderedStages[0]?.stageKey ?? workflowRun.currentStage;
  const activeStageKey = orderedStages.some((stage) => stage.stageKey === workflowRun.currentStage)
    ? workflowRun.currentStage
    : (workflowRun.status === "completed" ? orderedStages[orderedStages.length - 1]?.stageKey : legacyStage) ?? fallbackStageKey;
  const activeIndex = Math.max(0, orderedStages.findIndex((stage) => stage.stageKey === activeStageKey));
  const now = new Date().toISOString();
  const startedAt = workflowRun.startedAt ?? task.startedAt ?? task.createdAt ?? now;
  const finishedAt = workflowRun.finishedAt
    ?? (workflowRun.status === "completed" || workflowRun.status === "failed" || workflowRun.status === "cancelled" ? now : null);

  const stagePayloads: Array<typeof taskStageRuns.$inferInsert> = orderedStages.map((stage, index) => {
    const status = buildStageRunStatus(workflowRun.status, stage.stageKey, activeStageKey, index, activeIndex);
    return {
      id: crypto.randomUUID(),
      workflowRunId: workflowRun.id,
      stageKey: stage.stageKey,
      status,
      primaryRoleAgentId: stage.primaryRoleAgentId,
      participantRoleAgentIdsJson: stage.participantRoleAgentIdsJson,
      startedAt: status === "pending" ? null : startedAt,
      finishedAt:
        status === "completed" || status === "failed" || status === "cancelled"
          ? finishedAt ?? now
          : null,
      blockingReason: status === "blocked" ? "历史任务暂停，待人工恢复" : null,
      approvalState: status === "waiting-approval" ? "pending" : "not-required",
      artifactsSummaryJson: null,
      createdAt: task.createdAt ?? now,
      updatedAt: now,
    };
  });

  await db.insert(taskStageRuns).values(stagePayloads);
}

async function ensureLegacyTaskWorkflowRunMigrated(
  task: typeof tasks.$inferSelect,
  strategy: JsonRecord,
  legacyRoleConclusions: unknown[],
) {
  const existingWorkflowRun = await db.query.taskWorkflowRuns.findFirst({
    where: eq(taskWorkflowRuns.taskId, task.id),
  });
  if (existingWorkflowRun) {
    await ensureWorkflowStageRunsMigrated(existingWorkflowRun, task, inferLegacyStage(strategy, legacyRoleConclusions));
    return existingWorkflowRun;
  }

  const executionPlan = parseExecutionPlan(task.executionPlan);
  const templateId = inferWorkflowTemplateId(strategy, executionPlan);
  const legacyStage = inferLegacyStage(strategy, legacyRoleConclusions);
  const workflowStatus = inferWorkflowStatus(task.status);
  const currentStage = inferCurrentStage(task.status, legacyStage);
  const now = new Date().toISOString();
  const startedAt = task.startedAt ?? task.createdAt ?? now;
  const finishedAt = task.finishedAt ?? (task.status === "completed" || task.status === "failed" || task.status === "cancelled" ? now : null);
  const workflowRunId = crypto.randomUUID();

  await db.insert(taskWorkflowRuns).values({
    id: workflowRunId,
    taskId: task.id,
    templateId,
    currentStage,
    status: workflowStatus,
    startedAt,
    finishedAt,
    createdAt: task.createdAt ?? now,
    updatedAt: now,
  });

  const createdWorkflowRun = await db.query.taskWorkflowRuns.findFirst({ where: eq(taskWorkflowRuns.id, workflowRunId) });
  if (createdWorkflowRun) {
    await ensureWorkflowStageRunsMigrated(createdWorkflowRun, task, legacyStage);
  }

  return createdWorkflowRun;
}

async function ensureLegacyRoleWorkflowMigratedInternal(taskId: string) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) {
    return null;
  }

  const strategy = parseTaskStrategy(task.strategy);
  const legacyRoleConclusions = normalizeArray(strategy.roleAggregateConclusions);
  const legacyChangeRequests = normalizeArray(strategy.developerChangeRequests);

  await ensureLegacyTaskWorkflowRunMigrated(task, strategy, legacyRoleConclusions);

  const existingRoleConclusions = await db
    .select({ id: roleAggregateConclusions.id })
    .from(roleAggregateConclusions)
    .where(eq(roleAggregateConclusions.taskId, taskId));
  if (existingRoleConclusions.length === 0 && legacyRoleConclusions.length > 0) {
    const now = new Date().toISOString();
    const migratedRoleConclusions: Array<typeof roleAggregateConclusions.$inferInsert> =
      legacyRoleConclusions.map((item) => {
        const entry = isNonEmptyObject(item) ? item : {};
        return {
          id: typeof entry.id === "string" && entry.id ? entry.id : crypto.randomUUID(),
          taskId,
          taskStageRunId: typeof entry.taskStageRunId === "string" ? entry.taskStageRunId : null,
          roleAgentId: typeof entry.roleAgentId === "string" ? entry.roleAgentId : "role.unknown",
          stage: typeof entry.stage === "string" ? entry.stage : "unknown",
          aggregationStrategy:
            entry.aggregationStrategy === "first-pass"
            || entry.aggregationStrategy === "majority"
            || entry.aggregationStrategy === "merge-summary"
            || entry.aggregationStrategy === "human-review"
              ? entry.aggregationStrategy
              : "merge-summary",
          status:
            entry.status === "aligned"
            || entry.status === "partially-aligned"
            || entry.status === "conflicted"
            || entry.status === "escalated"
            || entry.status === "blocked"
              ? entry.status
              : "aligned",
          finalDecision:
            entry.finalDecision === "allow"
            || entry.finalDecision === "notify-developer"
            || entry.finalDecision === "needs-approval"
            || entry.finalDecision === "block"
            || entry.finalDecision === "observe"
            || entry.finalDecision === "human-review"
              ? entry.finalDecision
              : "observe",
          aggregateRiskLevel:
            entry.aggregateRiskLevel === "low"
            || entry.aggregateRiskLevel === "medium"
            || entry.aggregateRiskLevel === "high"
            || entry.aggregateRiskLevel === "critical"
              ? entry.aggregateRiskLevel
              : "medium",
          confidenceScore: typeof entry.confidenceScore === "number" ? entry.confidenceScore : 0,
          consensusScore: typeof entry.consensusScore === "number" ? entry.consensusScore : 0,
          winningRationale: typeof entry.winningRationale === "string" ? entry.winningRationale : "",
          mergedFindingsJson: normalizeArray(entry.mergedFindings) as JsonRecord[],
          minorityFindingsJson: normalizeArray(entry.minorityFindings) as JsonRecord[],
          conflictsJson: normalizeArray(entry.conflicts) as JsonRecord[],
          approvalRecommendationJson: isNonEmptyObject(entry.approvalRecommendation)
            ? entry.approvalRecommendation
            : null,
          generatedAt: typeof entry.generatedAt === "string" ? entry.generatedAt : now,
          createdAt: typeof entry.createdAt === "string" ? entry.createdAt : now,
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : now,
        };
      });
    await db.insert(roleAggregateConclusions).values(migratedRoleConclusions);
  }

  const existingChangeRequests = await db
    .select({ id: developerChangeRequests.id })
    .from(developerChangeRequests)
    .where(eq(developerChangeRequests.taskId, taskId));
  if (existingChangeRequests.length === 0 && legacyChangeRequests.length > 0) {
    const now = new Date().toISOString();
    const migratedChangeRequests: Array<typeof developerChangeRequests.$inferInsert> =
      legacyChangeRequests.map((item) => {
        const entry = isNonEmptyObject(item) ? item : {};
        const status =
          entry.status === "open"
          || entry.status === "acknowledged"
          || entry.status === "in-progress"
          || entry.status === "resolved"
          || entry.status === "won't-fix"
            ? entry.status
            : "open";
        return {
          id: typeof entry.id === "string" && entry.id ? entry.id : crypto.randomUUID(),
          taskId,
          taskStageRunId: typeof entry.taskStageRunId === "string" ? entry.taskStageRunId : null,
          sourceRoleAgentId:
            typeof entry.sourceRoleAgentId === "string" ? entry.sourceRoleAgentId : "role.unknown",
          assignedRoleAgentId:
            typeof entry.assignedRoleAgentId === "string" && entry.assignedRoleAgentId
              ? entry.assignedRoleAgentId
              : "role.developer",
          priority:
            entry.priority === "low"
            || entry.priority === "medium"
            || entry.priority === "high"
            || entry.priority === "critical"
              ? entry.priority
              : "medium",
          title: typeof entry.title === "string" ? entry.title : "",
          summary: typeof entry.summary === "string" ? entry.summary : "",
          requiredChangesJson: normalizeArray(entry.requiredChanges).map((change) => String(change)),
          relatedFindingKeysJson: normalizeArray(entry.relatedFindingKeys).map((key) => String(key)),
          blocking: Boolean(entry.blocking),
          approvalRequired: Boolean(entry.approvalRequired),
          status,
          resolutionNote: typeof entry.resolutionNote === "string" ? entry.resolutionNote : null,
          createdAt: typeof entry.createdAt === "string" ? entry.createdAt : now,
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : now,
          resolvedAt:
            status === "resolved" || status === "won't-fix"
              ? (typeof entry.resolvedAt === "string" ? entry.resolvedAt : now)
              : null,
        };
      });
    await db.insert(developerChangeRequests).values(migratedChangeRequests);
  }

  if ("roleAggregateConclusions" in strategy || "developerChangeRequests" in strategy) {
    delete strategy.roleAggregateConclusions;
    delete strategy.developerChangeRequests;
    await db
      .update(tasks)
      .set({ strategy: serializeTaskStrategy(strategy) })
      .where(eq(tasks.id, taskId));
  }

  return task;
}

export async function ensureLegacyRoleWorkflowMigrated(taskId: string) {
  const existingPromise = legacyWorkflowMigrationInflight.get(taskId);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = ensureLegacyRoleWorkflowMigratedInternal(taskId).finally(() => {
    legacyWorkflowMigrationInflight.delete(taskId);
  });
  legacyWorkflowMigrationInflight.set(taskId, promise);
  return promise;
}