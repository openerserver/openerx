import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  developerChangeRequests,
  projects,
  roleAggregateConclusions,
  tasks as taskAggregates,
  taskStageRuns,
  taskWorkflowRuns,
  workflowTemplateStages,
} from "../../db/schema";
import { type TaskTreeRecord, loadTaskTreeRecord } from "../project-tree/task-view";
import { resolvePublicTaskStatus } from "../tasks/public-task-status";

type JsonRecord = Record<string, unknown>;
type WorkflowStatus = typeof taskWorkflowRuns.$inferSelect.status | TaskTreeRecord["status"];

const legacyWorkflowMigrationInflight = new Map<string, Promise<TaskTreeRecord | null>>();
const LEGACY_UNSPECIFIED_WORKFLOW_TEMPLATE_ID = "legacy-unspecified";
const DEFAULT_WORKFLOW_TEMPLATE_ID = "workflow-template-default-delivery";

function resolveLegacyTaskExecutionMode(strategy: JsonRecord) {
  return strategy.executionMode === "single" ||
    strategy.executionMode === "parallel" ||
    strategy.executionMode === "sequential-chain"
    ? (strategy.executionMode as TaskTreeRecord["executionMode"])
    : null;
}

function resolveLegacyTaskCategory(row: typeof taskAggregates.$inferSelect) {
  return row.category === "quick" ||
    row.category === "deep" ||
    row.category === "ops" ||
    row.category === "security" ||
    row.category === "architecture"
    ? (row.category as TaskTreeRecord["category"])
    : null;
}

function resolveLegacyTaskIdentityFields(row: typeof taskAggregates.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.createdByUserId ?? null,
    title: row.title,
    prompt: row.prompt,
    status: resolvePublicTaskStatus({
      lifecycleStatus: row.lifecycleStatus,
    }) as TaskTreeRecord["status"],
    sessionId: null,
    agentRunId: null,
    result: null,
    category: resolveLegacyTaskCategory(row),
    createdAt: row.createdAt,
    startedAt: row.activatedAt ?? null,
    finishedAt: row.doneAt ?? null,
  };
}

function resolveLegacyTaskRepositoryFields(row: typeof taskAggregates.$inferSelect) {
  return {
    repoId: row.repoId ?? null,
    workspaceRoot: row.workspaceRoot ?? null,
    baseRevision: row.baseRevision ?? null,
    workingBranch: row.workingBranch ?? null,
    selectedModel: row.preferredModel ?? null,
    credentialId: row.credentialId ?? null,
    gitAuthorName: row.gitAuthorName ?? null,
    gitAuthorEmail: row.gitAuthorEmail ?? null,
    gitCommitterName: row.gitCommitterName ?? null,
    gitCommitterEmail: row.gitCommitterEmail ?? null,
    finalCommitSha: row.finalCommitSha ?? null,
    finalBranchName: row.finalBranchName ?? null,
    changesSummary: null,
  };
}

function resolveLegacyTaskRunFields(row: typeof taskAggregates.$inferSelect, strategy: JsonRecord) {
  return {
    strategy: row.strategyJson ?? null,
    executionMode: resolveLegacyTaskExecutionMode(strategy),
    autoAdvanceStages:
      typeof strategy.autoAdvanceStages === "boolean" ? strategy.autoAdvanceStages : false,
    orchestrationKind: null,
    currentRunId: null,
    currentRunStatus: null,
    currentRunStartedAt: null,
    currentRunFinishedAt: null,
    currentRunCandidateCount: null,
    currentRunPipelineStepCount: null,
    latestResultSummary: null,
    latestErrorText: null,
    activeCandidateCount: 0,
    completedCandidateCount: 0,
    failedCandidateCount: 0,
    totalChainSteps: 0,
    completedChainSteps: 0,
    winnerNodeId: null,
    lastActivityAt: null,
    repoName: null,
    remoteUrl: null,
    credentialLabel: null,
  };
}

function mapAggregateRowToWorkflowMigrationTask(
  row: typeof taskAggregates.$inferSelect,
): TaskTreeRecord {
  const strategy = parseTaskStrategy(row.strategyJson);

  return {
    ...resolveLegacyTaskIdentityFields(row),
    ...resolveLegacyTaskRepositoryFields(row),
    ...resolveLegacyTaskRunFields(row, strategy),
  };
}

async function loadWorkflowMigrationTask(taskId: string) {
  const treeTask = await loadTaskTreeRecord(taskId);
  if (treeTask) {
    return treeTask;
  }

  const aggregateRows = await db
    .select()
    .from(taskAggregates)
    .where(eq(taskAggregates.id, taskId))
    .limit(1);

  const aggregate = aggregateRows[0];
  return aggregate ? mapAggregateRowToWorkflowMigrationTask(aggregate) : null;
}

function parseTaskStrategy(raw: unknown) {
  if (!raw) {
    return {} as JsonRecord;
  }

  if (typeof raw === "string") {
    try {
      return parseTaskStrategy(JSON.parse(raw));
    } catch {
      return {} as JsonRecord;
    }
  }

  if (isNonEmptyObject(raw) && typeof raw.value === "string") {
    return parseTaskStrategy(raw.value);
  }

  return isNonEmptyObject(raw) ? raw : ({} as JsonRecord);
}

function normalizeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function hasOwnStrategyField(
  strategy: JsonRecord,
  field: "roleAggregateConclusions" | "developerChangeRequests",
) {
  return Object.prototype.hasOwnProperty.call(strategy, field);
}

function isNonEmptyObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function normalizeWorkflowTemplateId(value: unknown) {
  const templateId = readString(value);
  if (!templateId || templateId === LEGACY_UNSPECIFIED_WORKFLOW_TEMPLATE_ID) {
    return null;
  }

  return templateId;
}

async function loadProjectWorkflowTemplateId(projectId: string | null) {
  if (!projectId) {
    return null;
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  const settings = isNonEmptyObject(project?.settings) ? project.settings : null;
  return normalizeWorkflowTemplateId(settings?.workflowTemplateId);
}

async function resolveWorkflowTemplateId(task: TaskTreeRecord, strategy: JsonRecord) {
  return (
    normalizeWorkflowTemplateId(strategy.workflowTemplateId) ||
    normalizeWorkflowTemplateId(strategy.selectedTemplateId) ||
    (await loadProjectWorkflowTemplateId(task.projectId ?? null)) ||
    DEFAULT_WORKFLOW_TEMPLATE_ID
  );
}

async function loadWorkflowTemplateStageRows(templateId: string) {
  return db
    .select()
    .from(workflowTemplateStages)
    .where(eq(workflowTemplateStages.templateId, templateId));
}

function isStringMember<T extends readonly string[]>(
  value: unknown,
  members: T,
): value is T[number] {
  return typeof value === "string" && members.includes(value);
}

function readTimestamp(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function normalizeStringArray(value: unknown) {
  return normalizeArray(value).map((item) => String(item));
}

const LEGACY_AGGREGATION_STRATEGIES = [
  "first-pass",
  "majority",
  "merge-summary",
  "human-review",
] as const;

const LEGACY_CONCLUSION_STATUSES = [
  "aligned",
  "partially-aligned",
  "conflicted",
  "escalated",
  "blocked",
] as const;

const LEGACY_FINAL_DECISIONS = [
  "allow",
  "notify-developer",
  "needs-approval",
  "block",
  "observe",
  "human-review",
] as const;

const LEGACY_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

const LEGACY_CHANGE_REQUEST_STATUSES = [
  "open",
  "acknowledged",
  "in-progress",
  "resolved",
  "won't-fix",
] as const;

function normalizeLegacyRoleConclusion(
  item: unknown,
  taskId: string,
  now: string,
): typeof roleAggregateConclusions.$inferInsert {
  const entry = isNonEmptyObject(item) ? item : {};
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : crypto.randomUUID(),
    taskId,
    taskStageRunId: typeof entry.taskStageRunId === "string" ? entry.taskStageRunId : null,
    roleAgentId: typeof entry.roleAgentId === "string" ? entry.roleAgentId : "role.unknown",
    stage: typeof entry.stage === "string" ? entry.stage : "unknown",
    aggregationStrategy: isStringMember(entry.aggregationStrategy, LEGACY_AGGREGATION_STRATEGIES)
      ? entry.aggregationStrategy
      : "merge-summary",
    status: isStringMember(entry.status, LEGACY_CONCLUSION_STATUSES) ? entry.status : "aligned",
    finalDecision: isStringMember(entry.finalDecision, LEGACY_FINAL_DECISIONS)
      ? entry.finalDecision
      : "observe",
    aggregateRiskLevel: isStringMember(entry.aggregateRiskLevel, LEGACY_RISK_LEVELS)
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
    generatedAt: readTimestamp(entry.generatedAt, now),
    createdAt: readTimestamp(entry.createdAt, now),
    updatedAt: readTimestamp(entry.updatedAt, now),
  };
}

function normalizeLegacyChangeRequest(
  item: unknown,
  taskId: string,
  now: string,
): typeof developerChangeRequests.$inferInsert {
  const entry = isNonEmptyObject(item) ? item : {};
  const status = isStringMember(entry.status, LEGACY_CHANGE_REQUEST_STATUSES)
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
    priority: isStringMember(entry.priority, LEGACY_RISK_LEVELS) ? entry.priority : "medium",
    title: typeof entry.title === "string" ? entry.title : "",
    summary: typeof entry.summary === "string" ? entry.summary : "",
    requiredChangesJson: normalizeStringArray(entry.requiredChanges),
    relatedFindingKeysJson: normalizeStringArray(entry.relatedFindingKeys),
    blocking: Boolean(entry.blocking),
    approvalRequired: Boolean(entry.approvalRequired),
    status,
    resolutionNote: typeof entry.resolutionNote === "string" ? entry.resolutionNote : null,
    createdAt: readTimestamp(entry.createdAt, now),
    updatedAt: readTimestamp(entry.updatedAt, now),
    resolvedAt:
      status === "resolved" || status === "won't-fix" ? readTimestamp(entry.resolvedAt, now) : null,
  };
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

function inferWorkflowStatus(taskStatus?: WorkflowStatus | string | null) {
  switch (taskStatus) {
    case "running":
      return "running" as const;
    case "paused":
    case "blocked":
      return "blocked" as const;
    case "waiting-approval":
      return "waiting-approval" as const;
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

function inferCurrentStage(taskStatus: TaskTreeRecord["status"], legacyStage: string | null) {
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
  task: TaskTreeRecord,
  legacyStage: string | null,
  strategy: JsonRecord,
) {
  const existingStageRun = await db.query.taskStageRuns.findFirst({
    where: eq(taskStageRuns.workflowRunId, workflowRun.id),
  });
  if (existingStageRun) {
    return;
  }

  let effectiveWorkflowRun = workflowRun;
  let templateId = normalizeWorkflowTemplateId(workflowRun.templateId);
  let templateStages = templateId ? await loadWorkflowTemplateStageRows(templateId) : [];

  if (templateStages.length === 0) {
    templateId = await resolveWorkflowTemplateId(task, strategy);
    if (templateId !== workflowRun.templateId) {
      const updatedAt = new Date().toISOString();
      await db
        .update(taskWorkflowRuns)
        .set({
          templateId,
          updatedAt,
        })
        .where(eq(taskWorkflowRuns.id, workflowRun.id));
      effectiveWorkflowRun = {
        ...effectiveWorkflowRun,
        templateId,
        updatedAt,
      };
    }
    templateStages = await loadWorkflowTemplateStageRows(templateId);
  }

  if (templateStages.length === 0) {
    return;
  }

  const orderedStages = [...templateStages].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  );
  const fallbackStageKey = orderedStages[0]?.stageKey ?? effectiveWorkflowRun.currentStage;
  const activeStageKey = orderedStages.some(
    (stage) => stage.stageKey === effectiveWorkflowRun.currentStage,
  )
    ? effectiveWorkflowRun.currentStage
    : ((effectiveWorkflowRun.status === "completed"
        ? orderedStages[orderedStages.length - 1]?.stageKey
        : legacyStage) ?? fallbackStageKey);
  const activeIndex = Math.max(
    0,
    orderedStages.findIndex((stage) => stage.stageKey === activeStageKey),
  );
  const now = new Date().toISOString();
  const startedAt = effectiveWorkflowRun.startedAt ?? task.startedAt ?? task.createdAt ?? now;
  const finishedAt =
    effectiveWorkflowRun.finishedAt ??
    (effectiveWorkflowRun.status === "completed" ||
    effectiveWorkflowRun.status === "failed" ||
    effectiveWorkflowRun.status === "cancelled"
      ? now
      : null);

  const stagePayloads: Array<typeof taskStageRuns.$inferInsert> = orderedStages.map(
    (stage, index) => {
      const status = buildStageRunStatus(
        effectiveWorkflowRun.status,
        stage.stageKey,
        activeStageKey,
        index,
        activeIndex,
      );
      return {
        id: crypto.randomUUID(),
        workflowRunId: effectiveWorkflowRun.id,
        stageKey: stage.stageKey,
        status,
        primaryRoleAgentId: stage.primaryRoleAgentId,
        participantRoleAgentIdsJson: stage.participantRoleAgentIdsJson,
        startedAt: status === "pending" ? null : startedAt,
        finishedAt:
          status === "completed" || status === "failed" || status === "cancelled"
            ? (finishedAt ?? now)
            : null,
        blockingReason: status === "blocked" ? "历史任务暂停，待人工恢复" : null,
        approvalState: status === "waiting-approval" ? "pending" : "not-required",
        artifactsSummaryJson: null,
        createdAt: task.createdAt ?? now,
        updatedAt: now,
      };
    },
  );

  await db.insert(taskStageRuns).values(stagePayloads);
}

async function repairLegacyWorkflowRun(args: {
  workflowRun: typeof taskWorkflowRuns.$inferSelect;
  task: TaskTreeRecord;
  strategy: JsonRecord;
  legacyStage: string | null;
}) {
  const templateId = await resolveWorkflowTemplateId(args.task, args.strategy);
  const status = inferWorkflowStatus(args.task.status);
  const currentStage = inferCurrentStage(args.task.status, args.legacyStage);
  const updates: Partial<typeof taskWorkflowRuns.$inferInsert> = {};

  if (!normalizeWorkflowTemplateId(args.workflowRun.templateId)) {
    updates.templateId = templateId;
  }

  if (args.workflowRun.status !== status) {
    updates.status = status;
  }

  if (
    (!readString(args.workflowRun.currentStage) ||
      args.workflowRun.currentStage === "unknown" ||
      args.workflowRun.currentStage === "intake") &&
    args.workflowRun.currentStage !== currentStage
  ) {
    updates.currentStage = currentStage;
  }

  if (Object.keys(updates).length === 0) {
    return args.workflowRun;
  }

  const updatedAt = new Date().toISOString();
  await db
    .update(taskWorkflowRuns)
    .set({
      ...updates,
      updatedAt,
    })
    .where(eq(taskWorkflowRuns.id, args.workflowRun.id));

  return {
    ...args.workflowRun,
    ...updates,
    updatedAt,
  };
}

async function ensureLegacyTaskWorkflowRunMigrated(
  task: TaskTreeRecord,
  strategy: JsonRecord,
  legacyRoleConclusions: unknown[],
) {
  const existingWorkflowRun = await db.query.taskWorkflowRuns.findFirst({
    where: eq(taskWorkflowRuns.taskId, task.id),
  });
  const legacyStage = inferLegacyStage(strategy, legacyRoleConclusions);
  if (existingWorkflowRun) {
    const repairedWorkflowRun = await repairLegacyWorkflowRun({
      workflowRun: existingWorkflowRun,
      task,
      strategy,
      legacyStage,
    });
    await ensureWorkflowStageRunsMigrated(repairedWorkflowRun, task, legacyStage, strategy);
    return existingWorkflowRun;
  }

  const templateId = await resolveWorkflowTemplateId(task, strategy);
  const workflowStatus = inferWorkflowStatus(task.status);
  const currentStage = inferCurrentStage(task.status, legacyStage);
  const now = new Date().toISOString();
  const startedAt = task.startedAt ?? task.createdAt ?? now;
  const finishedAt =
    task.finishedAt ??
    (task.status === "completed" || task.status === "failed" || task.status === "cancelled"
      ? now
      : null);
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

  const createdWorkflowRun = await db.query.taskWorkflowRuns.findFirst({
    where: eq(taskWorkflowRuns.id, workflowRunId),
  });
  if (createdWorkflowRun) {
    await ensureWorkflowStageRunsMigrated(createdWorkflowRun, task, legacyStage, strategy);
  }

  return createdWorkflowRun;
}

async function clearLegacyWorkflowStrategyFields(
  taskId: string,
  strategy: JsonRecord,
  fields: Array<"roleAggregateConclusions" | "developerChangeRequests">,
) {
  const nextStrategy = { ...strategy };
  let changed = false;

  for (const field of fields) {
    if (!hasOwnStrategyField(nextStrategy, field)) {
      continue;
    }

    delete nextStrategy[field];
    changed = true;
  }

  if (!changed) {
    return;
  }

  await db
    .update(taskAggregates)
    .set({
      strategyJson: Object.keys(nextStrategy).length > 0 ? nextStrategy : {},
      updatedAt: new Date().toISOString(),
    })
    .where(eq(taskAggregates.id, taskId));
}

export async function ensureTaskWorkflowAvailable(taskId: string) {
  const task = await loadWorkflowMigrationTask(taskId);
  if (!task) {
    return null;
  }

  const existingWorkflowRun = await db.query.taskWorkflowRuns.findFirst({
    where: eq(taskWorkflowRuns.taskId, taskId),
  });
  if (!existingWorkflowRun) {
    return ensureLegacyRoleWorkflowMigrated(taskId);
  }

  const currentStage = readString(existingWorkflowRun.currentStage);
  const hasCanonicalTemplateId = Boolean(
    normalizeWorkflowTemplateId(existingWorkflowRun.templateId),
  );
  const hasWorkflowStatus = existingWorkflowRun.status === inferWorkflowStatus(task.status);
  const hasCanonicalCurrentStage = Boolean(
    currentStage && currentStage !== "unknown" && currentStage !== "intake",
  );
  const existingStageRun = await db.query.taskStageRuns.findFirst({
    where: eq(taskStageRuns.workflowRunId, existingWorkflowRun.id),
  });

  if (hasCanonicalTemplateId && hasWorkflowStatus && hasCanonicalCurrentStage && existingStageRun) {
    return task;
  }

  return ensureLegacyRoleWorkflowMigrated(taskId);
}

export async function ensureTaskWorkflowFactsAvailable(taskId: string) {
  const task = await loadWorkflowMigrationTask(taskId);
  if (!task) {
    return null;
  }

  const strategy = parseTaskStrategy(task.strategy);
  const legacyRoleConclusions = normalizeArray(strategy.roleAggregateConclusions);

  await ensureLegacyTaskWorkflowRunMigrated(task, strategy, legacyRoleConclusions);

  const existingRoleConclusions = await db
    .select({ id: roleAggregateConclusions.id })
    .from(roleAggregateConclusions)
    .where(eq(roleAggregateConclusions.taskId, taskId));
  if (existingRoleConclusions.length === 0 && legacyRoleConclusions.length > 0) {
    const now = new Date().toISOString();
    const migratedRoleConclusions = legacyRoleConclusions.map((item) =>
      normalizeLegacyRoleConclusion(item, taskId, now),
    );
    await db.insert(roleAggregateConclusions).values(migratedRoleConclusions).onConflictDoNothing();
  }

  await clearLegacyWorkflowStrategyFields(taskId, strategy, ["roleAggregateConclusions"]);

  return task;
}

export async function ensureRoleConclusionsAvailable(taskId: string) {
  const task = await loadWorkflowMigrationTask(taskId);
  if (!task) {
    return null;
  }

  const strategy = parseTaskStrategy(task.strategy);
  const legacyRoleConclusions = normalizeArray(strategy.roleAggregateConclusions);
  const existingRoleConclusions = await db
    .select({ id: roleAggregateConclusions.id })
    .from(roleAggregateConclusions)
    .where(eq(roleAggregateConclusions.taskId, taskId));

  if (existingRoleConclusions.length > 0) {
    await clearLegacyWorkflowStrategyFields(taskId, strategy, ["roleAggregateConclusions"]);
    return task;
  }

  if (legacyRoleConclusions.length === 0) {
    await clearLegacyWorkflowStrategyFields(taskId, strategy, ["roleAggregateConclusions"]);
    return task;
  }

  return ensureLegacyRoleWorkflowMigrated(taskId);
}

export async function ensureDeveloperChangeRequestsAvailable(taskId: string) {
  const task = await loadWorkflowMigrationTask(taskId);
  if (!task) {
    return null;
  }

  const strategy = parseTaskStrategy(task.strategy);
  const legacyChangeRequests = normalizeArray(strategy.developerChangeRequests);
  const existingChangeRequests = await db
    .select({ id: developerChangeRequests.id })
    .from(developerChangeRequests)
    .where(eq(developerChangeRequests.taskId, taskId));

  if (existingChangeRequests.length > 0) {
    await clearLegacyWorkflowStrategyFields(taskId, strategy, ["developerChangeRequests"]);
    return task;
  }

  if (legacyChangeRequests.length === 0) {
    await clearLegacyWorkflowStrategyFields(taskId, strategy, ["developerChangeRequests"]);
    return task;
  }

  return ensureLegacyRoleWorkflowMigrated(taskId);
}

async function ensureLegacyRoleWorkflowMigratedInternal(taskId: string) {
  const task = await loadWorkflowMigrationTask(taskId);
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
    const migratedRoleConclusions = legacyRoleConclusions.map((item) =>
      normalizeLegacyRoleConclusion(item, taskId, now),
    );
    await db.insert(roleAggregateConclusions).values(migratedRoleConclusions).onConflictDoNothing();
  }

  const existingChangeRequests = await db
    .select({ id: developerChangeRequests.id })
    .from(developerChangeRequests)
    .where(eq(developerChangeRequests.taskId, taskId));
  if (existingChangeRequests.length === 0 && legacyChangeRequests.length > 0) {
    const now = new Date().toISOString();
    const migratedChangeRequests = legacyChangeRequests.map((item) =>
      normalizeLegacyChangeRequest(item, taskId, now),
    );
    await db.insert(developerChangeRequests).values(migratedChangeRequests).onConflictDoNothing();
  }

  await clearLegacyWorkflowStrategyFields(taskId, strategy, [
    "roleAggregateConclusions",
    "developerChangeRequests",
  ]);

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
