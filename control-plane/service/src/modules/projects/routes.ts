import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { findUniqueConstraintMatch } from "../../db/unique-conflict";
import {
  type ProjectSettings,
  type ProjectTreeLinkType,
  type ProjectTreeNodeType,
  approvalTickets,
  auditEvents,
  budgetConfigs,
  costRecords,
  environments,
  organizations,
  projectModelFundLedger,
  projectModelFunds,
  projectRoles,
  projectTreeBranches,
  projectTreeLinks,
  projectTreeNodes,
  projects,
  repositories,
  repositoryCredentials,
  runtimeUsageBaselines,
  runtimeUsageLedgerSteps,
  runtimeUsageLedgers,
  tasks as taskAggregates,
  taskSnapshots,
  taskTimelineViews,
  users,
  workflowTemplates,
} from "../../db/schema";
import { type AppEnv, type JWTPayload, authMiddleware } from "../../middleware/auth";
import { requireProjectRole, requireRole } from "../../middleware/rbac";
import {
  createProjectTreeChildNode,
  ensureProjectRootNode,
  getProjectRootNodeId,
} from "../project-tree/storage";
import { loadTaskTreeRecords } from "../project-tree/task-view";
import { normalizeApiTimestamp, normalizeApiTimestampFields } from "../shared/api-timestamp";
import { resolvePublicTaskStatus } from "../tasks/public-task-status";
import { fromStoredTaskExecutionMode } from "../tasks/task-execution-mode";
import { validateConfiguredModelRoute } from "../../lib/configured-model-routes";

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.use("*", authMiddleware);

function isProjectSlugConflict(error: unknown) {
  return findUniqueConstraintMatch(error, ["idx_projects_org_slug"]) === "idx_projects_org_slug";
}

function isProjectMemberConflict(error: unknown) {
  return (
    findUniqueConstraintMatch(error, ["idx_project_roles_user_project"]) ===
    "idx_project_roles_user_project"
  );
}

const approvalPolicyModeSchema = z.enum(["balanced", "strict", "manual"]);

const environmentApprovalPolicyBindingSchema = z.object({
  approvalPolicy: approvalPolicyModeSchema.optional(),
  policyTemplateId: z.string().min(1).optional(),
});

const projectSettingsSchema = z.object({
  defaultModel: z.string().min(1).optional(),
  defaultEnvironmentId: z.string().min(1).optional(),
  workflowTemplateId: z.string().min(1).optional(),
  approvalPolicyTemplateId: z.string().min(1).optional(),
  projectGroupKey: z.string().min(1).nullable().optional(),
  projectGroupLabel: z.string().min(1).nullable().optional(),
  approvalPolicy: approvalPolicyModeSchema.optional(),
  environmentApprovalPolicies: z.record(environmentApprovalPolicyBindingSchema).optional(),
  maxConcurrency: z.number().int().min(1).max(100).optional(),
  budgetMonthly: z.number().min(0).optional(),
  budgetConfigId: z.string().min(1).optional(),
  warnThreshold: z.number().min(0).max(1).optional(),
  throttleThreshold: z.number().min(0).max(1).optional(),
  collaborationMode: z.enum(["solo", "team", "hybrid"]).optional(),
  autopilotLevel: z.enum(["L0", "L1", "L2"]).optional(),
  bossParticipationMode: z
    .enum(["disabled", "advisory", "exception-only", "full-manager"])
    .optional(),
  preferredTemplateId: z.string().min(1).nullable().optional(),
  allowBossAutoTemplateSwitch: z.boolean().optional(),
  allowHybridEscalation: z.boolean().optional(),
});

type Role = "platform_admin" | "org_admin" | "project_admin" | "developer" | "viewer";

const ROLE_HIERARCHY: Record<Role, number> = {
  platform_admin: 5,
  org_admin: 4,
  project_admin: 3,
  developer: 2,
  viewer: 1,
};

const createProjectSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  settings: projectSettingsSchema.optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  settings: projectSettingsSchema.optional(),
});

const projectMemberRoleSchema = z.enum(["project_admin", "developer", "viewer"]);

const addProjectMemberSchema = z.object({
  userId: z.string().min(1),
  role: projectMemberRoleSchema.default("developer"),
});

const updateProjectMemberSchema = z.object({
  role: projectMemberRoleSchema,
});

const workflowTemplateBindingSchema = z.object({
  workflowTemplateId: z.string().min(1).nullable(),
});

const projectFundGrantSchema = z.object({
  amountUsd: z.number().positive(),
  note: z.string().trim().max(500).optional(),
});

const projectFundAdjustSchema = z.object({
  amountUsd: z.number().refine((value) => Number.isFinite(value) && value !== 0, {
    message: "amountUsd must be a non-zero number",
  }),
  note: z.string().trim().max(500).optional(),
});

const projectFundExecutionMutationSchema = z.object({
  amountUsd: z.number().positive(),
  modelRoute: z.string().trim().min(1).max(200).optional(),
  taskId: z.string().trim().min(1).optional(),
  runtimeSessionId: z.string().trim().min(1).optional(),
  note: z.string().trim().max(500).optional(),
});

const projectFundLedgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).optional(),
});

const projectTreeNodeTypeSchema = z.enum([
  "project_root",
  "task",
  "session",
  "message",
  "context",
  "fork_point",
]);

const projectTreeLinkTypeSchema = z.enum([
  "depends-on",
  "blocks",
  "cites",
  "forked-from",
  "spawned",
  "related",
]);

const createProjectTreeChildNodeSchema = z.object({
  id: z.string().min(1).optional(),
  nodeType: projectTreeNodeTypeSchema,
  role: z.string().min(1).max(50).optional(),
  contentText: z.string().max(50000).optional(),
  contentJson: z.record(z.unknown()).optional(),
  tokenCount: z.number().int().min(0).optional(),
  runtimeSessionId: z.string().min(1).optional(),
  runtimeMessageId: z.string().min(1).optional(),
  branchName: z.string().max(200).optional(),
  isActive: z.boolean().optional(),
  archivedAt: z.string().min(1).optional(),
});

const createProjectTreeLinkSchema = z.object({
  targetNodeId: z.string().min(1),
  targetProjectId: z.string().min(1).optional(),
  linkType: projectTreeLinkTypeSchema,
  metadata: z.record(z.unknown()).optional(),
  bidirectional: z.boolean().optional(),
});

const updateProjectTreeBranchSchema = z.object({
  headNodeId: z.string().min(1),
  isDefault: z.boolean().optional(),
});

const runtimeUsageLedgerStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);
const runtimeUsageLedgerStepTypeSchema = z.enum(["execution", "judge", "hook", "resume", "other"]);
const runtimeUsageLedgerStepStatusSchema = z.enum(["pending", "completed", "failed", "skipped"]);

const runtimeUsageLedgerStepSyncSchema = z.object({
  id: z.string().min(1),
  stepType: runtimeUsageLedgerStepTypeSchema,
  triggerType: z.string().trim().min(1).optional(),
  hookId: z.string().trim().min(1).optional(),
  candidateIndex: z.number().int().min(0).optional(),
  requestIndex: z.number().int().min(0).default(0),
  providerId: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
  amplificationSource: z.string().trim().min(1).optional(),
  status: runtimeUsageLedgerStepStatusSchema.default("completed"),
  startedAt: z.string().trim().min(1).optional(),
  finishedAt: z.string().trim().min(1).optional(),
});

const syncRuntimeUsageLedgerSchema = z.object({
  taskId: z.string().min(1).optional(),
  agentRunId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  runNodeId: z.string().min(1).optional(),
  runtimeSessionId: z.string().min(1),
  executionSource: z.string().trim().min(1),
  entrypointType: z.string().trim().min(1),
  orchestrationFingerprint: z.string().trim().min(1).optional(),
  defaultProviderId: z.string().trim().min(1).optional(),
  defaultModelId: z.string().trim().min(1).optional(),
  requestCountDelta: z.number().int().min(0).default(1),
  stepCountDelta: z.number().int().min(0).default(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
  candidateCount: z.number().int().min(1).optional(),
  judgeRequestCountDelta: z.number().int().min(0).default(0),
  hookRequestCountDelta: z.number().int().min(0).default(0),
  status: runtimeUsageLedgerStatusSchema.default("completed"),
  startedAt: z.string().trim().min(1).optional(),
  finishedAt: z.string().trim().min(1).optional(),
  syncedAt: z.string().trim().min(1).optional(),
  step: runtimeUsageLedgerStepSyncSchema.optional(),
});

const runtimeUsageBaselineMatchScopeSchema = z.enum([
  "project+provider+model+entrypoint+fingerprint",
  "project+provider+model+entrypoint",
  "project+provider+model",
  "project+entrypoint",
  "project",
]);

function normalizeProjectSettings(settings: unknown): ProjectSettings | null | undefined {
  if (settings == null) {
    return settings as null | undefined;
  }

  if (typeof settings === "string") {
    try {
      return JSON.parse(settings) as ProjectSettings;
    } catch {
      return undefined;
    }
  }

  return settings as ProjectSettings;
}

function normalizeComparableTimestamp(value: string | null | undefined) {
  const normalized = normalizeApiTimestamp(value);
  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function normalizeProjectRecord<
  T extends {
    settings?: unknown;
    createdAt?: string | null;
    updatedAt?: string | null;
  },
>(
  project: T,
): Omit<T, "settings"> & {
  settings?: ProjectSettings | null;
} {
  const normalized = normalizeApiTimestampFields(project, ["createdAt", "updatedAt"] as const);

  return {
    ...normalized,
    settings: normalizeProjectSettings(project.settings),
  };
}

async function getProjectOrNull(projectId: string) {
  return db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
}

async function getWorkflowTemplateBinding(
  projectId: string,
  settings: ProjectSettings | null | undefined,
) {
  const workflowTemplateId = settings?.workflowTemplateId || null;
  if (!workflowTemplateId) {
    return {
      workflowTemplateId: null,
      template: null,
    };
  }

  const template = await db.query.workflowTemplates.findFirst({
    where: eq(workflowTemplates.id, workflowTemplateId),
  });

  if (!template) {
    return {
      workflowTemplateId,
      template: null,
    };
  }

  if (template.projectId && template.projectId !== projectId) {
    return {
      workflowTemplateId,
      template: null,
    };
  }

  return {
    workflowTemplateId,
    template,
  };
}

async function listProjectAdmins(projectId: string) {
  return db.query.projectRoles.findMany({
    where: eq(projectRoles.projectId, projectId),
  });
}

function hasGlobalProjectAccess(user: JWTPayload) {
  const level = ROLE_HIERARCHY[user.role as Role] ?? 0;
  return level >= ROLE_HIERARCHY.org_admin;
}

async function listVisibleProjects(user: JWTPayload, orgId?: string) {
  if (hasGlobalProjectAccess(user)) {
    return db.query.projects.findMany({
      ...(orgId ? { where: eq(projects.orgId, orgId) } : {}),
    });
  }

  const memberships = await db.query.projectRoles.findMany({
    where: eq(projectRoles.userId, user.sub),
  });
  const visibleProjectIds = memberships.map((membership) => membership.projectId);

  if (visibleProjectIds.length === 0) {
    return [];
  }

  return db.query.projects.findMany({
    where: orgId
      ? and(inArray(projects.id, visibleProjectIds), eq(projects.orgId, orgId))
      : inArray(projects.id, visibleProjectIds),
  });
}

async function getVisibleProjectOrNull(user: JWTPayload, projectId: string) {
  if (hasGlobalProjectAccess(user)) {
    return getProjectOrNull(projectId);
  }

  const membership = await db.query.projectRoles.findFirst({
    where: and(eq(projectRoles.userId, user.sub), eq(projectRoles.projectId, projectId)),
  });

  if (!membership) {
    return null;
  }

  return getProjectOrNull(projectId);
}

function normalizeRuntimeUsageLedgerRecord(ledger: typeof runtimeUsageLedgers.$inferSelect) {
  return {
    id: ledger.id,
    projectId: ledger.projectId,
    taskId: ledger.taskId,
    agentRunId: ledger.agentRunId,
    runId: ledger.runId,
    runNodeId: ledger.runNodeId,
    runtimeSessionId: ledger.runtimeSessionId,
    executionSource: ledger.executionSource,
    entrypointType: ledger.entrypointType,
    orchestrationFingerprint: ledger.orchestrationFingerprint,
    defaultProviderId: ledger.defaultProviderId,
    defaultModelId: ledger.defaultModelId,
    requestCount: ledger.requestCount,
    stepCount: ledger.stepCount,
    inputTokens: ledger.inputTokens,
    outputTokens: ledger.outputTokens,
    totalTokens: ledger.totalTokens,
    costUsd: ledger.costUsd,
    candidateCount: ledger.candidateCount,
    judgeRequestCount: ledger.judgeRequestCount,
    hookRequestCount: ledger.hookRequestCount,
    status: ledger.status,
    startedAt: normalizeApiTimestamp(ledger.startedAt),
    finishedAt: normalizeApiTimestamp(ledger.finishedAt),
    syncedAt: normalizeApiTimestamp(ledger.syncedAt),
    createdAt: normalizeApiTimestamp(ledger.createdAt),
    updatedAt: normalizeApiTimestamp(ledger.updatedAt),
  };
}

type ProjectModelFundRow = typeof projectModelFunds.$inferSelect;
type ProjectModelFundLedgerRow = typeof projectModelFundLedger.$inferSelect;
type ProjectModelFundMutationKind = "grant" | "reserve" | "consume" | "refund" | "adjust";

function roundUsd(value: number) {
  return Number(Number(value || 0).toFixed(4));
}

function computeProjectModelFundAvailable(values: {
  totalGranted: number;
  reserved: number;
  consumed: number;
}) {
  return roundUsd(values.totalGranted - values.reserved - values.consumed);
}

function resolveProjectModelFundStatus(available: number): "active" | "depleted" {
  return available > 0 ? "active" : "depleted";
}

function normalizeProjectModelFundRecord(projectId: string, fund?: ProjectModelFundRow | null) {
  const totalGranted = roundUsd(fund?.totalGranted ?? 0);
  const reserved = roundUsd(fund?.reserved ?? 0);
  const consumed = roundUsd(fund?.consumed ?? 0);
  const available = computeProjectModelFundAvailable({ totalGranted, reserved, consumed });

  return {
    id: fund?.id ?? null,
    projectId,
    currency: fund?.currency ?? "USD",
    totalGranted,
    reserved,
    consumed,
    available,
    status:
      fund?.status === "active" || fund?.status === "depleted"
        ? fund.status
        : resolveProjectModelFundStatus(available),
    createdAt: normalizeApiTimestamp(fund?.createdAt),
    updatedAt: normalizeApiTimestamp(fund?.updatedAt),
    hasFund: Boolean(fund),
  };
}

function normalizeProjectModelFundLedgerRecord(entry: ProjectModelFundLedgerRow) {
  return {
    id: entry.id,
    projectId: entry.projectId,
    fundId: entry.fundId,
    type: entry.type,
    amountUsd: roundUsd(entry.amountUsd),
    balanceAfter: roundUsd(entry.balanceAfter),
    modelRoute: entry.modelRoute,
    taskId: entry.taskId,
    runtimeSessionId: entry.runtimeSessionId,
    createdBy: entry.createdBy,
    createdAt: normalizeApiTimestamp(entry.createdAt) || entry.createdAt,
    note: entry.note,
  };
}

async function getProjectModelFundRecord(projectId: string) {
  return db.query.projectModelFunds.findFirst({
    where: eq(projectModelFunds.projectId, projectId),
  });
}

async function ensureProjectModelFundTx(tx: {
  select: typeof db.select;
  insert: typeof db.insert;
}, projectId: string, now: string): Promise<ProjectModelFundRow> {
  const [existing] = await tx
    .select()
    .from(projectModelFunds)
    .where(eq(projectModelFunds.projectId, projectId))
    .limit(1);

  if (existing) {
    return existing;
  }

  const created: ProjectModelFundRow = {
    id: crypto.randomUUID(),
    projectId,
    currency: "USD",
    totalGranted: 0,
    reserved: 0,
    consumed: 0,
    status: "depleted",
    createdAt: now,
    updatedAt: now,
  };

  await tx.insert(projectModelFunds).values(created);
  return created;
}

function applyProjectModelFundMutation(
  current: Pick<ProjectModelFundRow, "totalGranted" | "reserved" | "consumed">,
  type: ProjectModelFundMutationKind,
  amountUsd: number,
) {
  const totalGranted = roundUsd(current.totalGranted);
  const reserved = roundUsd(current.reserved);
  const consumed = roundUsd(current.consumed);
  const normalizedAmount = roundUsd(amountUsd);

  if (!Number.isFinite(normalizedAmount)) {
    throw new Error("Invalid project fund amount.");
  }

  const next = { totalGranted, reserved, consumed };

  switch (type) {
    case "grant":
      if (normalizedAmount <= 0) {
        throw new Error("Grant amount must be greater than 0.");
      }
      next.totalGranted = roundUsd(next.totalGranted + normalizedAmount);
      break;
    case "adjust":
      if (normalizedAmount === 0) {
        throw new Error("Adjustment amount must not be 0.");
      }
      next.totalGranted = roundUsd(next.totalGranted + normalizedAmount);
      break;
    case "reserve":
      if (normalizedAmount <= 0) {
        throw new Error("Reserve amount must be greater than 0.");
      }
      next.reserved = roundUsd(next.reserved + normalizedAmount);
      break;
    case "consume":
      if (normalizedAmount <= 0) {
        throw new Error("Consume amount must be greater than 0.");
      }
      {
        const coveredByReservation = Math.min(next.reserved, normalizedAmount);
        const overflow = roundUsd(normalizedAmount - coveredByReservation);
        if (overflow > computeProjectModelFundAvailable(next)) {
          throw new Error("Project fund balance is insufficient.");
        }
        next.reserved = roundUsd(next.reserved - coveredByReservation);
      }
      next.consumed = roundUsd(next.consumed + normalizedAmount);
      break;
    case "refund":
      if (normalizedAmount <= 0) {
        throw new Error("Refund amount must be greater than 0.");
      }
      if (next.reserved < normalizedAmount) {
        throw new Error("Reserved project fund is insufficient for refund.");
      }
      next.reserved = roundUsd(next.reserved - normalizedAmount);
      break;
  }

  const available = computeProjectModelFundAvailable(next);
  if (available < 0) {
    throw new Error("Project fund balance would become negative.");
  }

  return {
    ...next,
    available,
    status: resolveProjectModelFundStatus(available),
  };
}

async function mutateProjectModelFund(args: {
  projectId: string;
  type: ProjectModelFundMutationKind;
  amountUsd: number;
  createdBy?: string | null;
  note?: string | null;
  modelRoute?: string | null;
  taskId?: string | null;
  runtimeSessionId?: string | null;
}) {
  const now = new Date().toISOString();

  return db.transaction(async (tx) => {
    const current = await ensureProjectModelFundTx(tx, args.projectId, now);
    const next = applyProjectModelFundMutation(current, args.type, args.amountUsd);

    await tx
      .update(projectModelFunds)
      .set({
        totalGranted: next.totalGranted,
        reserved: next.reserved,
        consumed: next.consumed,
        status: next.status,
        updatedAt: now,
      })
      .where(eq(projectModelFunds.id, current.id));

    const ledger: ProjectModelFundLedgerRow = {
      id: crypto.randomUUID(),
      projectId: args.projectId,
      fundId: current.id,
      type: args.type,
      amountUsd: roundUsd(args.amountUsd),
      balanceAfter: next.available,
      modelRoute: args.modelRoute ?? null,
      taskId: args.taskId ?? null,
      runtimeSessionId: args.runtimeSessionId ?? null,
      createdBy: args.createdBy ?? null,
      createdAt: now,
      note: args.note ?? null,
    };

    await tx.insert(projectModelFundLedger).values(ledger);

    return {
      fund: {
        ...current,
        totalGranted: next.totalGranted,
        reserved: next.reserved,
        consumed: next.consumed,
        status: next.status,
        updatedAt: now,
      },
      ledger,
    };
  });
}

function normalizeRuntimeUsageLedgerStepRecord(step: typeof runtimeUsageLedgerSteps.$inferSelect) {
  return {
    id: step.id,
    ledgerId: step.ledgerId,
    projectId: step.projectId,
    taskId: step.taskId,
    agentRunId: step.agentRunId,
    runId: step.runId,
    runNodeId: step.runNodeId,
    runtimeSessionId: step.runtimeSessionId,
    stepType: step.stepType,
    triggerType: step.triggerType,
    hookId: step.hookId,
    candidateIndex: step.candidateIndex,
    requestIndex: step.requestIndex,
    providerId: step.providerId,
    modelId: step.modelId,
    inputTokens: step.inputTokens,
    outputTokens: step.outputTokens,
    totalTokens: step.totalTokens,
    costUsd: step.costUsd,
    amplificationSource: step.amplificationSource,
    status: step.status,
    startedAt: normalizeApiTimestamp(step.startedAt),
    finishedAt: normalizeApiTimestamp(step.finishedAt),
    createdAt: normalizeApiTimestamp(step.createdAt),
    updatedAt: normalizeApiTimestamp(step.updatedAt),
  };
}

function percentile(sortedValues: number[], ratio: number) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0] ?? null;
  const index = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sortedValues[lower] ?? sortedValues[sortedValues.length - 1] ?? 0;
  const upperValue = sortedValues[upper] ?? lowerValue;
  if (lower === upper) return lowerValue;
  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

function roundBaselineValue(value: number | null) {
  return value == null ? null : Number(value.toFixed(4));
}

type RuntimeUsageBaselineMatchScope = z.infer<typeof runtimeUsageBaselineMatchScopeSchema>;
type SyncRuntimeUsageLedgerPayload = z.infer<typeof syncRuntimeUsageLedgerSchema>;
type RuntimeUsageLedgerRow = typeof runtimeUsageLedgers.$inferSelect;

async function resolveRuntimeUsageRunBridge(body: SyncRuntimeUsageLedgerPayload) {
  if (body.runId || body.runNodeId) {
    return {
      runId: body.runId ?? null,
      runNodeId: body.runNodeId ?? null,
    };
  }

  return {
    runId: null,
    runNodeId: null,
  };
}

type RuntimeUsageBaselineView = {
  id: string;
  projectId: string;
  providerId: string | null;
  modelId: string | null;
  entrypointType: string | null;
  orchestrationFingerprint: string | null;
  matchScope: RuntimeUsageBaselineMatchScope;
  sampleSize: number;
  requestCount: { p50: number | null; p90: number | null };
  inputTokens: { p50: number | null; p90: number | null };
  outputTokens: { p50: number | null; p90: number | null };
  totalTokens: { p50: number | null; p90: number | null };
  costUsd: { p50: number | null; p90: number | null };
  lastLedgerAt: string | null;
  generatedAt: string;
};

function normalizeRuntimeUsageBaselineRecord(
  baseline: typeof runtimeUsageBaselines.$inferSelect,
): RuntimeUsageBaselineView {
  return {
    id: baseline.id,
    projectId: baseline.projectId,
    providerId: baseline.providerId || null,
    modelId: baseline.modelId || null,
    entrypointType: baseline.entrypointType || null,
    orchestrationFingerprint: baseline.orchestrationFingerprint || null,
    matchScope: baseline.matchScope,
    sampleSize: baseline.sampleSize,
    requestCount: {
      p50: roundBaselineValue(baseline.p50RequestCount),
      p90: roundBaselineValue(baseline.p90RequestCount),
    },
    inputTokens: {
      p50: roundBaselineValue(baseline.p50InputTokens),
      p90: roundBaselineValue(baseline.p90InputTokens),
    },
    outputTokens: {
      p50: roundBaselineValue(baseline.p50OutputTokens),
      p90: roundBaselineValue(baseline.p90OutputTokens),
    },
    totalTokens: {
      p50: roundBaselineValue(baseline.p50TotalTokens),
      p90: roundBaselineValue(baseline.p90TotalTokens),
    },
    costUsd: {
      p50: roundBaselineValue(baseline.p50CostUsd),
      p90: roundBaselineValue(baseline.p90CostUsd),
    },
    lastLedgerAt: normalizeApiTimestamp(baseline.lastLedgerAt),
    generatedAt: normalizeApiTimestamp(baseline.generatedAt) || baseline.generatedAt,
  };
}

function normalizeProjectTreeNodeRecord(node: typeof projectTreeNodes.$inferSelect) {
  return normalizeApiTimestampFields(node, ["createdAt", "updatedAt", "archivedAt"] as const);
}

function normalizeProjectTreeBranchRecord(branch: typeof projectTreeBranches.$inferSelect) {
  return normalizeApiTimestampFields(branch, ["createdAt", "updatedAt"] as const);
}

function normalizeProjectTreeLinkRecord(link: typeof projectTreeLinks.$inferSelect) {
  return normalizeApiTimestampFields(link, ["createdAt"] as const);
}

function buildRuntimeUsageBaselineId(args: {
  projectId: string;
  providerId: string;
  modelId: string;
  entrypointType: string;
  orchestrationFingerprint: string;
  matchScope: RuntimeUsageBaselineMatchScope;
}) {
  return [
    args.projectId,
    args.providerId || "all",
    args.modelId || "all",
    args.entrypointType || "all",
    args.orchestrationFingerprint || "all",
    args.matchScope,
  ].join("::");
}

function buildRuntimeUsageBaselineCandidates(args: {
  projectId: string;
  providerId?: string;
  modelId?: string;
  entrypointType?: string;
  orchestrationFingerprint?: string;
}) {
  const providerId = args.providerId || "";
  const modelId = args.modelId || "";
  const entrypointType = args.entrypointType || "";
  const orchestrationFingerprint = args.orchestrationFingerprint || "";
  const providerValue = args.providerId || null;
  const modelValue = args.modelId || null;

  return [
    {
      matchScope: "project+provider+model+entrypoint+fingerprint" as const,
      providerId,
      modelId,
      entrypointType,
      orchestrationFingerprint,
      matches: (ledger: RuntimeUsageLedgerRow) =>
        ledger.projectId === args.projectId &&
        ledger.defaultProviderId === providerValue &&
        ledger.defaultModelId === modelValue &&
        ledger.entrypointType === entrypointType &&
        (ledger.orchestrationFingerprint || "") === orchestrationFingerprint,
    },
    {
      matchScope: "project+provider+model+entrypoint" as const,
      providerId,
      modelId,
      entrypointType,
      orchestrationFingerprint: "",
      matches: (ledger: RuntimeUsageLedgerRow) =>
        ledger.projectId === args.projectId &&
        ledger.defaultProviderId === providerValue &&
        ledger.defaultModelId === modelValue &&
        ledger.entrypointType === entrypointType,
    },
    {
      matchScope: "project+provider+model" as const,
      providerId,
      modelId,
      entrypointType: "",
      orchestrationFingerprint: "",
      matches: (ledger: RuntimeUsageLedgerRow) =>
        ledger.projectId === args.projectId &&
        ledger.defaultProviderId === providerValue &&
        ledger.defaultModelId === modelValue,
    },
    {
      matchScope: "project+entrypoint" as const,
      providerId: "",
      modelId: "",
      entrypointType,
      orchestrationFingerprint: "",
      matches: (ledger: RuntimeUsageLedgerRow) =>
        ledger.projectId === args.projectId && ledger.entrypointType === entrypointType,
    },
    {
      matchScope: "project" as const,
      providerId: "",
      modelId: "",
      entrypointType: "",
      orchestrationFingerprint: "",
      matches: (ledger: RuntimeUsageLedgerRow) => ledger.projectId === args.projectId,
    },
  ];
}

function buildRuntimeUsageBaselineSeries(ledgers: RuntimeUsageLedgerRow[]) {
  const requestCounts = ledgers
    .map((ledger) => ledger.requestCount)
    .sort((left, right) => left - right);
  const inputTokens = ledgers
    .map((ledger) => ledger.inputTokens)
    .sort((left, right) => left - right);
  const outputTokens = ledgers
    .map((ledger) => ledger.outputTokens)
    .sort((left, right) => left - right);
  const totalTokens = ledgers
    .map((ledger) => ledger.totalTokens)
    .sort((left, right) => left - right);
  const costUsd = ledgers.map((ledger) => ledger.costUsd).sort((left, right) => left - right);
  const lastLedgerAt =
    ledgers
      .map((ledger) => ledger.finishedAt || ledger.updatedAt || ledger.createdAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;

  return {
    requestCounts,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    lastLedgerAt,
  };
}

function buildRuntimeUsageBaselineRecord(args: {
  projectId: string;
  candidate: ReturnType<typeof buildRuntimeUsageBaselineCandidates>[number];
  ledgers: RuntimeUsageLedgerRow[];
  now: string;
}) {
  const series = buildRuntimeUsageBaselineSeries(args.ledgers);
  return {
    id: buildRuntimeUsageBaselineId({
      projectId: args.projectId,
      providerId: args.candidate.providerId,
      modelId: args.candidate.modelId,
      entrypointType: args.candidate.entrypointType,
      orchestrationFingerprint: args.candidate.orchestrationFingerprint,
      matchScope: args.candidate.matchScope,
    }),
    projectId: args.projectId,
    providerId: args.candidate.providerId,
    modelId: args.candidate.modelId,
    entrypointType: args.candidate.entrypointType,
    orchestrationFingerprint: args.candidate.orchestrationFingerprint,
    matchScope: args.candidate.matchScope,
    sampleSize: args.ledgers.length,
    p50RequestCount: roundBaselineValue(percentile(series.requestCounts, 0.5)),
    p90RequestCount: roundBaselineValue(percentile(series.requestCounts, 0.9)),
    p50InputTokens: roundBaselineValue(percentile(series.inputTokens, 0.5)),
    p90InputTokens: roundBaselineValue(percentile(series.inputTokens, 0.9)),
    p50OutputTokens: roundBaselineValue(percentile(series.outputTokens, 0.5)),
    p90OutputTokens: roundBaselineValue(percentile(series.outputTokens, 0.9)),
    p50TotalTokens: roundBaselineValue(percentile(series.totalTokens, 0.5)),
    p90TotalTokens: roundBaselineValue(percentile(series.totalTokens, 0.9)),
    p50CostUsd: roundBaselineValue(percentile(series.costUsd, 0.5)),
    p90CostUsd: roundBaselineValue(percentile(series.costUsd, 0.9)),
    lastLedgerAt: series.lastLedgerAt,
    generatedAt: args.now,
    createdAt: args.now,
    updatedAt: args.now,
  };
}

async function upsertRuntimeUsageBaselineRecord(
  record: ReturnType<typeof buildRuntimeUsageBaselineRecord>,
  now: string,
) {
  await db
    .insert(runtimeUsageBaselines)
    .values(record)
    .onConflictDoUpdate({
      target: runtimeUsageBaselines.id,
      set: {
        sampleSize: record.sampleSize,
        p50RequestCount: record.p50RequestCount,
        p90RequestCount: record.p90RequestCount,
        p50InputTokens: record.p50InputTokens,
        p90InputTokens: record.p90InputTokens,
        p50OutputTokens: record.p50OutputTokens,
        p90OutputTokens: record.p90OutputTokens,
        p50TotalTokens: record.p50TotalTokens,
        p90TotalTokens: record.p90TotalTokens,
        p50CostUsd: record.p50CostUsd,
        p90CostUsd: record.p90CostUsd,
        lastLedgerAt: record.lastLedgerAt,
        generatedAt: now,
        updatedAt: now,
      },
    });
}

async function rebuildRuntimeUsageBaseline(args: {
  projectId: string;
  providerId?: string;
  modelId?: string;
  entrypointType?: string;
  orchestrationFingerprint?: string;
}) {
  const candidates = buildRuntimeUsageBaselineCandidates(args);

  const projectLedgers = await db.query.runtimeUsageLedgers.findMany({
    where: eq(runtimeUsageLedgers.projectId, args.projectId),
    orderBy: [desc(runtimeUsageLedgers.finishedAt), desc(runtimeUsageLedgers.updatedAt)],
  });

  const now = new Date().toISOString();
  const rebuilt: RuntimeUsageBaselineView[] = [];

  for (const candidate of candidates) {
    const ledgers = projectLedgers
      .filter(candidate.matches)
      .filter((ledger) => ledger.requestCount > 0 || ledger.totalTokens > 0);
    if (ledgers.length === 0) {
      continue;
    }

    const record = buildRuntimeUsageBaselineRecord({
      projectId: args.projectId,
      candidate,
      ledgers,
      now,
    });
    await upsertRuntimeUsageBaselineRecord(record, now);

    const stored = await db.query.runtimeUsageBaselines.findFirst({
      where: eq(runtimeUsageBaselines.id, record.id),
    });

    if (stored) {
      rebuilt.push(normalizeRuntimeUsageBaselineRecord(stored));
    }
  }

  return rebuilt;
}

type OverviewProjectStatus = "healthy" | "pending_config" | "archived" | "error";
type OverviewConfigStatus = "configured" | "pending" | "risk";
type OverviewSortBy = "last_activity_desc" | "created_at_desc" | "name_asc";

interface OverviewQueryParams {
  q: string;
  orgId?: string;
  statusFilter?: OverviewProjectStatus;
  configStatusFilter?: OverviewConfigStatus;
  onlyManaged: boolean;
  sortBy: OverviewSortBy;
  page: number;
  pageSize: number;
}

interface OverviewItem {
  id: string;
  orgId: string;
  orgName: string;
  name: string;
  slug: string;
  description: string | null | undefined;
  settings?: {
    projectGroupKey?: string | null;
    projectGroupLabel?: string | null;
  } | null;
  projectStatus: OverviewProjectStatus;
  completedCount: number;
  totalRequiredCount: number;
  completionPercent: number;
  risks: string[];
  runningTasks: number;
  activeSessionCount: number;
  parallelTaskCount: number;
  sequentialChainTaskCount: number;
  recentTimelineItemCount: number;
  failedTaskCount: number;
  pendingApprovals: number;
  failedTasksToday: number;
  lastActivityAt: string | null;
  memberCount: number;
  repositoryCount: number;
  environmentCount: number;
  currentUserRole: string | null;
  isCurrentUserManager: boolean;
  createdAt: string;
}

interface OverviewTaskSummary {
  id: string;
  projectId: string;
  status: string;
  currentSessionId: string | null;
  orchestrationKind: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  lastActivityAt: string | null;
}

function normalizeOverviewTaskStatus(args: {
  currentExecutionStatus?: string | null;
  lifecycleStatus?: string | null;
  fallbackStatus?: string | null;
}) {
  return resolvePublicTaskStatus({
    currentExecutionStatus: args.currentExecutionStatus,
    lifecycleStatus: args.lifecycleStatus,
    fallbackStatus: args.fallbackStatus,
  });
}

function normalizeOverviewExecutionMode(value: string | null | undefined) {
  return fromStoredTaskExecutionMode(value);
}

function parseOverviewParams(c: {
  req: { query: (key: string) => string | undefined };
}): OverviewQueryParams {
  const rawStatus = c.req.query("status") || "";
  const rawConfigStatus = c.req.query("configStatus") || "";
  const rawSortBy = c.req.query("sortBy") || "last_activity_desc";

  return {
    q: c.req.query("q") || "",
    orgId: c.req.query("orgId") || undefined,
    statusFilter:
      rawStatus === "healthy" ||
      rawStatus === "pending_config" ||
      rawStatus === "archived" ||
      rawStatus === "error"
        ? rawStatus
        : undefined,
    configStatusFilter:
      rawConfigStatus === "configured" ||
      rawConfigStatus === "pending" ||
      rawConfigStatus === "risk"
        ? rawConfigStatus
        : undefined,
    onlyManaged: c.req.query("onlyManaged") === "true",
    sortBy:
      rawSortBy === "created_at_desc" ||
      rawSortBy === "name_asc" ||
      rawSortBy === "last_activity_desc"
        ? rawSortBy
        : "last_activity_desc",
    page: Math.max(1, Number(c.req.query("page")) || 1),
    pageSize: Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20)),
  };
}

async function filterManagedProjects(
  user: JWTPayload,
  visibleProjects: (typeof projects.$inferSelect)[],
) {
  if (hasGlobalProjectAccess(user)) {
    return visibleProjects;
  }

  const managedIds = new Set<string>();
  const memberships = await db.query.projectRoles.findMany({
    where: and(eq(projectRoles.userId, user.sub), eq(projectRoles.role, "project_admin")),
  });

  for (const membership of memberships) {
    managedIds.add(membership.projectId);
  }

  return visibleProjects.filter((project) => managedIds.has(project.id));
}

async function getOverviewProjects(user: JWTPayload, params: OverviewQueryParams) {
  let visibleProjects = await listVisibleProjects(user, params.orgId);

  if (params.q) {
    const lower = params.q.toLowerCase();
    visibleProjects = visibleProjects.filter(
      (project) =>
        project.name.toLowerCase().includes(lower) || project.slug.toLowerCase().includes(lower),
    );
  }

  if (params.onlyManaged) {
    visibleProjects = await filterManagedProjects(user, visibleProjects);
  }

  return visibleProjects;
}

function emptyOverviewResponse(page: number, pageSize: number) {
  return {
    data: [],
    page,
    pageSize,
    total: 0,
    summary: {
      totalProjects: 0,
      pendingConfigCount: 0,
      riskCount: 0,
      activeProjectCount: 0,
      runningTaskCount: 0,
      activeSessionCount: 0,
      parallelTaskCount: 0,
      sequentialChainTaskCount: 0,
      failedTaskCount: 0,
      recentTimelineItemCount: 0,
    },
  };
}

function groupByProjectId<T extends { projectId: string }>(items: T[]) {
  const map = new Map<string, T[]>();

  for (const item of items) {
    const list = map.get(item.projectId) || [];
    list.push(item);
    map.set(item.projectId, list);
  }

  return map;
}

export function mergeOverviewTaskSummaries(args: {
  tasks: Array<{
    id: string;
    projectId: string;
    status: string | null;
    lifecycleStatus: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    updatedAt: string;
  }>;
  snapshots: Array<{
    taskId: string;
    currentExecutionStatus: string | null;
    lifecycleStatus: string | null;
    currentSessionId: string | null;
    currentExecutionMode: string | null;
    lastActivityAt: string | null;
  }>;
}) {
  const snapshotByTaskId = new Map(
    args.snapshots.map((snapshot) => [snapshot.taskId, snapshot] as const),
  );

  return args.tasks.map((task) => {
    const snapshot = snapshotByTaskId.get(task.id);
    const status = normalizeOverviewTaskStatus({
      currentExecutionStatus: snapshot?.currentExecutionStatus,
      lifecycleStatus: snapshot?.lifecycleStatus ?? task.lifecycleStatus,
      fallbackStatus: task.status,
    });
    const lastActivityAt =
      snapshot?.lastActivityAt ??
      task.finishedAt ??
      task.startedAt ??
      task.updatedAt ??
      task.createdAt;

    return {
      id: task.id,
      projectId: task.projectId,
      status,
      currentSessionId: snapshot?.currentSessionId ?? null,
      orchestrationKind: normalizeOverviewExecutionMode(snapshot?.currentExecutionMode),
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt:
        status === "completed" || status === "failed" || status === "cancelled"
          ? (snapshot?.lastActivityAt ?? task.finishedAt)
          : task.finishedAt,
      updatedAt: task.updatedAt,
      lastActivityAt,
    } satisfies OverviewTaskSummary;
  });
}

function mapApprovalsByProject(
  allTasks: Array<Pick<OverviewTaskSummary, "id" | "projectId">>,
  allPendingApprovals: (typeof approvalTickets.$inferSelect)[],
  projectIds: string[],
) {
  const taskProjectMap = new Map<string, string>();
  const approvalsByProject = new Map<string, typeof allPendingApprovals>();

  for (const task of allTasks) {
    taskProjectMap.set(task.id, task.projectId);
  }

  for (const approval of allPendingApprovals) {
    const projectId = taskProjectMap.get(approval.taskId);
    if (!projectId || !projectIds.includes(projectId)) {
      continue;
    }

    const list = approvalsByProject.get(projectId) || [];
    list.push(approval);
    approvalsByProject.set(projectId, list);
  }

  return approvalsByProject;
}

async function loadOverviewDependencies(projectIds: string[]) {
  const [
    allOrgs,
    allMembers,
    allEnvironments,
    allRepositories,
    allCredentials,
    allTasks,
    allTaskSnapshots,
    allTaskTimelineViews,
    allPendingApprovals,
    allBudgetConfigs,
    allCostRecords,
  ] = await Promise.all([
    db.query.organizations.findMany(),
    db.query.projectRoles.findMany({ where: inArray(projectRoles.projectId, projectIds) }),
    db.query.environments.findMany({ where: inArray(environments.projectId, projectIds) }),
    db.query.repositories.findMany({ where: inArray(repositories.projectId, projectIds) }),
    db.query.repositoryCredentials.findMany({
      where: inArray(repositoryCredentials.projectId, projectIds),
    }),
    db.query.tasks.findMany({ where: inArray(taskAggregates.projectId, projectIds) }),
    db.query.taskSnapshots.findMany({ where: inArray(taskSnapshots.projectId, projectIds) }),
    db.query.taskTimelineViews.findMany({
      where: inArray(taskTimelineViews.projectId, projectIds),
    }),
    db.query.approvalTickets.findMany({ where: eq(approvalTickets.status, "pending") }),
    db.query.budgetConfigs.findMany({ where: inArray(budgetConfigs.projectId, projectIds) }),
    db.query.costRecords.findMany({ where: inArray(costRecords.projectId, projectIds) }),
  ]);

  const overviewTasks = mergeOverviewTaskSummaries({
    tasks: allTasks.map((task) => ({
      id: task.id,
      projectId: task.projectId,
      status: null,
      lifecycleStatus: task.lifecycleStatus,
      createdAt: task.createdAt,
      startedAt: task.activatedAt ?? null,
      finishedAt: task.doneAt ?? null,
      updatedAt: task.updatedAt,
    })),
    snapshots: allTaskSnapshots.map((snapshot) => ({
      taskId: snapshot.taskId,
      currentExecutionStatus: snapshot.currentExecutionStatus ?? null,
      lifecycleStatus: snapshot.lifecycleStatus,
      currentSessionId: snapshot.currentSessionId ?? null,
      currentExecutionMode: snapshot.currentExecutionMode ?? null,
      lastActivityAt: snapshot.lastActivityAt ?? null,
    })),
  });

  return {
    orgMap: new Map(allOrgs.map((org) => [org.id, org])),
    membersByProject: groupByProjectId(allMembers),
    envsByProject: groupByProjectId(allEnvironments),
    reposByProject: groupByProjectId(allRepositories),
    credsByProject: groupByProjectId(allCredentials),
    tasksByProject: groupByProjectId(overviewTasks),
    timelineViewsByProject: groupByProjectId(allTaskTimelineViews),
    budgetsByProject: groupByProjectId(allBudgetConfigs),
    costsByProject: groupByProjectId(allCostRecords),
    approvalsByProject: mapApprovalsByProject(overviewTasks, allPendingApprovals, projectIds),
    allMembers,
  };
}

function buildUserRoleMap(userId: string, members: (typeof projectRoles.$inferSelect)[]) {
  return new Map(
    members
      .filter((membership) => membership.userId === userId)
      .map((membership) => [membership.projectId, membership.role]),
  );
}

function getBudgetRiskState(
  budgets: (typeof budgetConfigs.$inferSelect)[],
  costs: (typeof costRecords.$inferSelect)[],
) {
  const risks: string[] = [];
  let budgetBlocking = false;

  for (const budget of budgets) {
    const totalSpend = costs.reduce((sum, record) => sum + record.cost, 0);
    const usage = budget.limitAmount > 0 ? totalSpend / budget.limitAmount : 0;
    if (usage < budget.throttleThreshold) {
      continue;
    }

    budgetBlocking = true;
    risks.push(usage >= 1 ? "预算限流" : "预算预警");
  }

  return { risks, budgetBlocking };
}

function getCredentialRiskState(credentials: (typeof repositoryCredentials.$inferSelect)[]) {
  const hasExpiredDefault = credentials.some(
    (credential) => credential.isDefault && credential.status === "expired",
  );
  const hasActiveDefault = credentials.some(
    (credential) => credential.isDefault && credential.status === "active",
  );

  return {
    risks: hasExpiredDefault && !hasActiveDefault ? ["凭证已过期"] : [],
    hasExpiredDefault,
    hasActiveDefault,
  };
}

function getMissingConfigRisks(params: {
  hasRepo: boolean;
  hasCred: boolean;
  hasDefaultEnv: boolean;
  hasApprovalPolicy: boolean;
  hasEnv: boolean;
  hasMember: boolean;
  budgets: (typeof budgetConfigs.$inferSelect)[];
  budgetMonthly?: number;
}) {
  const risks: string[] = [];

  if (!params.hasRepo) risks.push("无仓库");
  if (!params.hasCred) risks.push("无凭证");
  if (!params.hasDefaultEnv) risks.push("无默认环境");
  if (!params.hasApprovalPolicy) risks.push("审批未绑定");
  if (!params.hasEnv) risks.push("无环境");
  if (!params.hasMember) risks.push("无成员");
  if (params.budgets.length === 0 && (params.budgetMonthly ?? 0) <= 0) {
    risks.push("预算未配置");
  }

  return risks;
}

function buildProjectRisks(params: {
  hasRepo: boolean;
  hasCred: boolean;
  hasDefaultEnv: boolean;
  hasApprovalPolicy: boolean;
  hasEnv: boolean;
  hasMember: boolean;
  budgets: (typeof budgetConfigs.$inferSelect)[];
  costs: (typeof costRecords.$inferSelect)[];
  credentials: (typeof repositoryCredentials.$inferSelect)[];
  budgetMonthly?: number;
}) {
  const budgetState = getBudgetRiskState(params.budgets, params.costs);
  const credentialState = getCredentialRiskState(params.credentials);
  const missingConfigRisks = getMissingConfigRisks({
    hasRepo: params.hasRepo,
    hasCred: params.hasCred,
    hasDefaultEnv: params.hasDefaultEnv,
    hasApprovalPolicy: params.hasApprovalPolicy,
    hasEnv: params.hasEnv,
    hasMember: params.hasMember,
    budgets: params.budgets,
    budgetMonthly: params.budgetMonthly,
  });

  return {
    risks: [...budgetState.risks, ...credentialState.risks, ...missingConfigRisks],
    budgetBlocking: budgetState.budgetBlocking,
    hasExpiredDefault: credentialState.hasExpiredDefault,
    hasActiveDefault: credentialState.hasActiveDefault,
  };
}

function deriveOverviewStatus(
  project: typeof projects.$inferSelect,
  completed: number,
  totalRequired: number,
  budgetBlocking: boolean,
  hasExpiredDefault: boolean,
  hasActiveDefault: boolean,
): OverviewProjectStatus {
  const dbStatus = (project as { status?: string }).status || "active";
  if (dbStatus === "archived") {
    return "archived";
  }

  if (budgetBlocking || (hasExpiredDefault && !hasActiveDefault)) {
    return "error";
  }

  if (completed < totalRequired) {
    return "pending_config";
  }

  return "healthy";
}

function getProjectLastActivity(
  project: typeof projects.$inferSelect,
  projectTasks: OverviewTaskSummary[],
  timelineViewsForProject: Array<Pick<typeof taskTimelineViews.$inferSelect, "sortAt">>,
) {
  let lastActivityAt: string | null = null;
  let lastActivityTime: number | null = null;

  for (const task of projectTasks) {
    const timestamp = normalizeApiTimestamp(
      task.lastActivityAt || task.finishedAt || task.startedAt || task.createdAt,
    );
    const timestampTime = normalizeComparableTimestamp(timestamp);
    if (timestamp && timestampTime != null && (lastActivityTime == null || timestampTime > lastActivityTime)) {
      lastActivityAt = timestamp;
      lastActivityTime = timestampTime;
    }
  }

  for (const item of timelineViewsForProject) {
    const sortAt = normalizeApiTimestamp(item.sortAt);
    const sortAtTime = normalizeComparableTimestamp(sortAt);
    if (sortAt && sortAtTime != null && (lastActivityTime == null || sortAtTime > lastActivityTime)) {
      lastActivityAt = sortAt;
      lastActivityTime = sortAtTime;
    }
  }

  const projectUpdatedAt = normalizeApiTimestamp((project as { updatedAt?: string }).updatedAt);
  const projectUpdatedAtTime = normalizeComparableTimestamp(projectUpdatedAt);
  if (
    projectUpdatedAt &&
    projectUpdatedAtTime != null &&
    (lastActivityTime == null || projectUpdatedAtTime > lastActivityTime)
  ) {
    lastActivityAt = projectUpdatedAt;
    lastActivityTime = projectUpdatedAtTime;
  }

  return lastActivityAt || normalizeApiTimestamp(project.createdAt);
}

function getProjectOverviewResources(
  projectId: string,
  dependencies: {
    membersByProject: Map<string, (typeof projectRoles.$inferSelect)[]>;
    envsByProject: Map<string, (typeof environments.$inferSelect)[]>;
    reposByProject: Map<string, (typeof repositories.$inferSelect)[]>;
    credsByProject: Map<string, (typeof repositoryCredentials.$inferSelect)[]>;
    tasksByProject: Map<string, OverviewTaskSummary[]>;
    timelineViewsByProject: Map<string, (typeof taskTimelineViews.$inferSelect)[]>;
    budgetsByProject: Map<string, (typeof budgetConfigs.$inferSelect)[]>;
    costsByProject: Map<string, (typeof costRecords.$inferSelect)[]>;
    approvalsByProject: Map<string, (typeof approvalTickets.$inferSelect)[]>;
  },
) {
  return {
    members: dependencies.membersByProject.get(projectId) || [],
    environmentsForProject: dependencies.envsByProject.get(projectId) || [],
    repositoriesForProject: dependencies.reposByProject.get(projectId) || [],
    credentialsForProject: dependencies.credsByProject.get(projectId) || [],
    tasksForProject: dependencies.tasksByProject.get(projectId) || [],
    timelineViewsForProject: dependencies.timelineViewsByProject.get(projectId) || [],
    budgetsForProject: dependencies.budgetsByProject.get(projectId) || [],
    costsForProject: dependencies.costsByProject.get(projectId) || [],
    approvalsForProject: dependencies.approvalsByProject.get(projectId) || [],
  };
}

function getProjectSetupCompletion(args: {
  settings: ProjectSettings;
  members: (typeof projectRoles.$inferSelect)[];
  environmentsForProject: (typeof environments.$inferSelect)[];
  repositoriesForProject: (typeof repositories.$inferSelect)[];
  credentialsForProject: (typeof repositoryCredentials.$inferSelect)[];
}) {
  const hasEnv = args.environmentsForProject.length > 0;
  const hasRepo = args.repositoriesForProject.some((repository) => repository.status === "active");
  const hasCred = args.credentialsForProject.some((credential) => credential.status === "active");
  const hasMember = args.members.length > 0;
  const hasDefaultEnv = Boolean(args.settings.defaultEnvironmentId);
  const hasApprovalPolicy = Boolean(args.settings.approvalPolicy);
  const totalRequiredCount = 6;
  const completedCount = [
    hasEnv,
    hasRepo,
    hasCred,
    hasMember,
    hasDefaultEnv,
    hasApprovalPolicy,
  ].filter(Boolean).length;

  return {
    hasEnv,
    hasRepo,
    hasCred,
    hasMember,
    hasDefaultEnv,
    hasApprovalPolicy,
    totalRequiredCount,
    completedCount,
  };
}

function resolveCurrentUserProjectRole(
  user: JWTPayload,
  projectId: string,
  userRoleMap: Map<string, string>,
) {
  return hasGlobalProjectAccess(user)
    ? userRoleMap.get(projectId) || "org_admin"
    : userRoleMap.get(projectId) || null;
}

function buildOverviewItem(
  user: JWTPayload,
  project: typeof projects.$inferSelect,
  dependencies: {
    orgMap: Map<string, typeof organizations.$inferSelect>;
    membersByProject: Map<string, (typeof projectRoles.$inferSelect)[]>;
    envsByProject: Map<string, (typeof environments.$inferSelect)[]>;
    reposByProject: Map<string, (typeof repositories.$inferSelect)[]>;
    credsByProject: Map<string, (typeof repositoryCredentials.$inferSelect)[]>;
    tasksByProject: Map<string, OverviewTaskSummary[]>;
    timelineViewsByProject: Map<string, (typeof taskTimelineViews.$inferSelect)[]>;
    budgetsByProject: Map<string, (typeof budgetConfigs.$inferSelect)[]>;
    costsByProject: Map<string, (typeof costRecords.$inferSelect)[]>;
    approvalsByProject: Map<string, (typeof approvalTickets.$inferSelect)[]>;
    userRoleMap: Map<string, string>;
  },
  todayIso: string,
): OverviewItem {
  const settings = normalizeProjectSettings(project.settings) ?? {};
  const resources = getProjectOverviewResources(project.id, dependencies);
  const completion = getProjectSetupCompletion({
    settings,
    members: resources.members,
    environmentsForProject: resources.environmentsForProject,
    repositoriesForProject: resources.repositoriesForProject,
    credentialsForProject: resources.credentialsForProject,
  });

  const { risks, budgetBlocking, hasExpiredDefault, hasActiveDefault } = buildProjectRisks({
    hasRepo: completion.hasRepo,
    hasCred: completion.hasCred,
    hasDefaultEnv: completion.hasDefaultEnv,
    hasApprovalPolicy: completion.hasApprovalPolicy,
    hasEnv: completion.hasEnv,
    hasMember: completion.hasMember,
    budgets: resources.budgetsForProject,
    costs: resources.costsForProject,
    credentials: resources.credentialsForProject,
    budgetMonthly: settings.budgetMonthly,
  });

  const projectStatus = deriveOverviewStatus(
    project,
    completion.completedCount,
    completion.totalRequiredCount,
    budgetBlocking,
    hasExpiredDefault,
    hasActiveDefault,
  );

  const currentUserRole = resolveCurrentUserProjectRole(user, project.id, dependencies.userRoleMap);

  return {
    id: project.id,
    orgId: project.orgId,
    orgName: dependencies.orgMap.get(project.orgId)?.name || "",
    name: project.name,
    slug: project.slug,
    description: project.description,
    settings: {
      projectGroupKey: settings.projectGroupKey ?? null,
      projectGroupLabel: settings.projectGroupLabel ?? null,
    },
    projectStatus,
    completedCount: completion.completedCount,
    totalRequiredCount: completion.totalRequiredCount,
    completionPercent: Math.round(
      (completion.completedCount / completion.totalRequiredCount) * 100,
    ),
    risks,
    runningTasks: resources.tasksForProject.filter((task) => task.status === "running").length,
    activeSessionCount: new Set(
      resources.tasksForProject
        .filter(
          (task) =>
            task.status === "running" || task.status === "paused" || task.status === "pending",
        )
        .map((task) => task.currentSessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ).size,
    parallelTaskCount: resources.tasksForProject.filter(
      (task) => task.orchestrationKind === "parallel",
    ).length,
    sequentialChainTaskCount: resources.tasksForProject.filter(
      (task) => task.orchestrationKind === "sequential-chain",
    ).length,
    recentTimelineItemCount: resources.timelineViewsForProject.filter(
      (item) => item.sortAt >= todayIso,
    ).length,
    failedTaskCount: resources.tasksForProject.filter(
      (task) => task.status === "failed" || task.status === "cancelled",
    ).length,
    pendingApprovals: resources.approvalsForProject.length,
    failedTasksToday: resources.tasksForProject.filter(
      (task) => task.status === "failed" && task.lastActivityAt && task.lastActivityAt >= todayIso,
    ).length,
    lastActivityAt: getProjectLastActivity(
      project,
      resources.tasksForProject,
      resources.timelineViewsForProject,
    ),
    memberCount: resources.members.length,
    repositoryCount: resources.repositoriesForProject.filter(
      (repository) => repository.status === "active",
    ).length,
    environmentCount: resources.environmentsForProject.length,
    currentUserRole,
    isCurrentUserManager:
      hasGlobalProjectAccess(user) || dependencies.userRoleMap.get(project.id) === "project_admin",
    createdAt: normalizeApiTimestamp(project.createdAt) ?? project.createdAt,
  };
}

async function ensureRuntimeUsageLedger(
  projectId: string,
  body: SyncRuntimeUsageLedgerPayload,
  now: string,
) {
  const bridge = await resolveRuntimeUsageRunBridge(body);
  const existingLedger = await db.query.runtimeUsageLedgers.findFirst({
    where: and(
      eq(runtimeUsageLedgers.projectId, projectId),
      eq(runtimeUsageLedgers.runtimeSessionId, body.runtimeSessionId),
    ),
  });
  const ledgerId = existingLedger?.id || crypto.randomUUID();

  if (!existingLedger) {
    await db.insert(runtimeUsageLedgers).values({
      id: ledgerId,
      projectId,
      taskId: body.taskId,
      agentRunId: body.agentRunId,
      runId: bridge.runId,
      runNodeId: bridge.runNodeId,
      runtimeSessionId: body.runtimeSessionId,
      executionSource: body.executionSource,
      entrypointType: body.entrypointType,
      orchestrationFingerprint: body.orchestrationFingerprint,
      defaultProviderId: body.defaultProviderId,
      defaultModelId: body.defaultModelId,
      requestCount: 0,
      stepCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      candidateCount: body.candidateCount ?? 1,
      judgeRequestCount: 0,
      hookRequestCount: 0,
      status: body.status,
      startedAt: body.startedAt,
      finishedAt: body.finishedAt,
      syncedAt: body.syncedAt || now,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { existingLedger, ledgerId };
}

async function insertRuntimeUsageLedgerStepIfNeeded(args: {
  projectId: string;
  ledgerId: string;
  body: SyncRuntimeUsageLedgerPayload;
  now: string;
}) {
  const bridge = await resolveRuntimeUsageRunBridge(args.body);
  const existingStep = args.body.step?.id
    ? await db.query.runtimeUsageLedgerSteps.findFirst({
        where: eq(runtimeUsageLedgerSteps.id, args.body.step.id),
      })
    : null;

  if (args.body.step && !existingStep) {
    await db.insert(runtimeUsageLedgerSteps).values({
      id: args.body.step.id,
      ledgerId: args.ledgerId,
      projectId: args.projectId,
      taskId: args.body.taskId,
      agentRunId: args.body.agentRunId,
      runId: bridge.runId,
      runNodeId: bridge.runNodeId,
      runtimeSessionId: args.body.runtimeSessionId,
      stepType: args.body.step.stepType,
      triggerType: args.body.step.triggerType,
      hookId: args.body.step.hookId,
      candidateIndex: args.body.step.candidateIndex,
      requestIndex: args.body.step.requestIndex,
      providerId: args.body.step.providerId,
      modelId: args.body.step.modelId,
      inputTokens: args.body.step.inputTokens,
      outputTokens: args.body.step.outputTokens,
      totalTokens: args.body.step.totalTokens,
      costUsd: args.body.step.costUsd,
      amplificationSource: args.body.step.amplificationSource,
      status: args.body.step.status,
      startedAt: args.body.step.startedAt,
      finishedAt: args.body.step.finishedAt,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }

  return existingStep;
}

function buildRuntimeUsageLedgerDeltaSet(
  body: SyncRuntimeUsageLedgerPayload,
  ledger: RuntimeUsageLedgerRow,
  now: string,
  bridge: { runId: string | null; runNodeId: string | null },
) {
  return {
    taskId: body.taskId ?? ledger.taskId,
    agentRunId: body.agentRunId ?? ledger.agentRunId,
    runId: bridge.runId ?? ledger.runId,
    runNodeId: bridge.runNodeId ?? ledger.runNodeId,
    executionSource: body.executionSource || ledger.executionSource,
    entrypointType: body.entrypointType || ledger.entrypointType,
    orchestrationFingerprint: body.orchestrationFingerprint ?? ledger.orchestrationFingerprint,
    defaultProviderId: body.defaultProviderId ?? ledger.defaultProviderId,
    defaultModelId: body.defaultModelId ?? ledger.defaultModelId,
    requestCount: ledger.requestCount + body.requestCountDelta,
    stepCount: ledger.stepCount + body.stepCountDelta,
    inputTokens: ledger.inputTokens + body.inputTokens,
    outputTokens: ledger.outputTokens + body.outputTokens,
    totalTokens: ledger.totalTokens + body.totalTokens,
    costUsd: Number((ledger.costUsd + body.costUsd).toFixed(4)),
    candidateCount: Math.max(ledger.candidateCount, body.candidateCount ?? 1),
    judgeRequestCount: ledger.judgeRequestCount + body.judgeRequestCountDelta,
    hookRequestCount: ledger.hookRequestCount + body.hookRequestCountDelta,
    status: body.status,
    startedAt: ledger.startedAt ?? body.startedAt,
    finishedAt: body.finishedAt ?? ledger.finishedAt,
    syncedAt: body.syncedAt || now,
    updatedAt: now,
  };
}

function buildRuntimeUsageLedgerTouchSet(
  body: SyncRuntimeUsageLedgerPayload,
  ledger: RuntimeUsageLedgerRow,
  now: string,
  bridge: { runId: string | null; runNodeId: string | null },
) {
  return {
    runId: bridge.runId ?? ledger.runId,
    runNodeId: bridge.runNodeId ?? ledger.runNodeId,
    syncedAt: body.syncedAt || now,
    updatedAt: now,
    status: body.status,
    finishedAt: body.finishedAt ?? ledger.finishedAt,
  };
}

async function applyRuntimeUsageLedgerSync(args: {
  ledgerId: string;
  body: SyncRuntimeUsageLedgerPayload;
  ledgerAfterInsert: RuntimeUsageLedgerRow;
  shouldApplyDelta: boolean;
  now: string;
}) {
  const bridge = await resolveRuntimeUsageRunBridge(args.body);
  await db
    .update(runtimeUsageLedgers)
    .set(
      args.shouldApplyDelta
        ? buildRuntimeUsageLedgerDeltaSet(args.body, args.ledgerAfterInsert, args.now, bridge)
        : buildRuntimeUsageLedgerTouchSet(args.body, args.ledgerAfterInsert, args.now, bridge),
    )
    .where(eq(runtimeUsageLedgers.id, args.ledgerId));
}

function filterAndSortOverviewItems(items: OverviewItem[], params: OverviewQueryParams) {
  let filtered = items;

  if (params.statusFilter) {
    filtered = filtered.filter((item) => item.projectStatus === params.statusFilter);
  }

  if (params.configStatusFilter === "configured") {
    filtered = filtered.filter(
      (item) => item.completedCount >= item.totalRequiredCount && item.risks.length === 0,
    );
  }

  if (params.configStatusFilter === "pending") {
    filtered = filtered.filter((item) => item.completedCount < item.totalRequiredCount);
  }

  if (params.configStatusFilter === "risk") {
    filtered = filtered.filter((item) => item.risks.length > 0);
  }

  if (params.sortBy === "created_at_desc") {
    filtered.sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""));
  } else if (params.sortBy === "name_asc") {
    filtered.sort((left, right) => left.name.localeCompare(right.name));
  } else {
    filtered.sort((left, right) =>
      (right.lastActivityAt || "").localeCompare(left.lastActivityAt || ""),
    );
  }

  return filtered;
}

function paginateOverviewItems(items: OverviewItem[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

// GET /api/projects/overview
projectRoutes.get("/overview", async (c) => {
  const user = c.get("user");
  const params = parseOverviewParams(c);
  const visibleProjects = await getOverviewProjects(user, params);
  if (visibleProjects.length === 0) {
    return c.json(emptyOverviewResponse(params.page, params.pageSize));
  }

  const projectIds = visibleProjects.map((p) => p.id);
  const dependencies = await loadOverviewDependencies(projectIds);
  const userRoleMap = buildUserRoleMap(user.sub, dependencies.allMembers);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const overviewItems = visibleProjects.map((project) =>
    buildOverviewItem(
      user,
      project,
      {
        orgMap: dependencies.orgMap,
        membersByProject: dependencies.membersByProject,
        envsByProject: dependencies.envsByProject,
        reposByProject: dependencies.reposByProject,
        credsByProject: dependencies.credsByProject,
        tasksByProject: dependencies.tasksByProject,
        timelineViewsByProject: dependencies.timelineViewsByProject,
        budgetsByProject: dependencies.budgetsByProject,
        costsByProject: dependencies.costsByProject,
        approvalsByProject: dependencies.approvalsByProject,
        userRoleMap,
      },
      todayIso,
    ),
  );
  const filtered = filterAndSortOverviewItems(overviewItems, params);
  const summary = {
    totalProjects: filtered.length,
    pendingConfigCount: filtered.filter((i) => i.projectStatus === "pending_config").length,
    riskCount: filtered.filter((i) => i.risks.length > 0).length,
    activeProjectCount: filtered.filter(
      (item) =>
        item.runningTasks > 0 || item.activeSessionCount > 0 || item.recentTimelineItemCount > 0,
    ).length,
    runningTaskCount: filtered.reduce((sum, item) => sum + item.runningTasks, 0),
    activeSessionCount: filtered.reduce((sum, item) => sum + item.activeSessionCount, 0),
    parallelTaskCount: filtered.reduce((sum, item) => sum + item.parallelTaskCount, 0),
    sequentialChainTaskCount: filtered.reduce(
      (sum, item) => sum + item.sequentialChainTaskCount,
      0,
    ),
    failedTaskCount: filtered.reduce((sum, item) => sum + item.failedTaskCount, 0),
    recentTimelineItemCount: filtered.reduce((sum, item) => sum + item.recentTimelineItemCount, 0),
  };
  const total = filtered.length;
  const data = paginateOverviewItems(filtered, params.page, params.pageSize);

  return c.json({ data, page: params.page, pageSize: params.pageSize, total, summary });
});

// GET /api/projects?orgId=
projectRoutes.get("/", async (c) => {
  const user = c.get("user");
  const orgId = c.req.query("orgId");
  const result = await listVisibleProjects(user, orgId || undefined);
  return c.json(result.map((project) => normalizeProjectRecord(project)));
});

// POST /api/projects
projectRoutes.post(
  "/",
  requireRole("org_admin"),
  zValidator("json", createProjectSchema),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const modelValidation = validateConfiguredModelRoute(
      body.settings?.defaultModel,
      "项目默认模型",
    );
    if (modelValidation) {
      return c.json({ error: modelValidation }, 400);
    }

    // Verify org exists
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, body.orgId),
    });
    if (!org) return c.json({ error: "Organization not found" }, 404);

    const existingBySlug = await db.query.projects.findFirst({
      where: and(eq(projects.orgId, body.orgId), eq(projects.slug, body.slug)),
    });
    if (existingBySlug) {
      return c.json({ error: "A project with this slug already exists in the organization" }, 409);
    }

    try {
      await db.insert(projects).values({
        id,
        orgId: body.orgId,
        name: body.name,
        slug: body.slug,
        description: body.description,
        settings: body.settings,
        createdAt,
      });
    } catch (error) {
      if (isProjectSlugConflict(error)) {
        return c.json({ error: "A project with this slug already exists in the organization" }, 409);
      }

      throw error;
    }

    await db.insert(projectRoles).values({
      id: crypto.randomUUID(),
      projectId: id,
      userId: user.sub,
      role: "project_admin",
    });

    await ensureProjectRootNode(id);

    return c.json({ id, rootNodeId: getProjectRootNodeId(id), ...body, createdAt }, 201);
  },
);

projectRoutes.get("/:projectId/tree", requireProjectRole("projectId", "viewer"), async (c) => {
  const projectId = c.req.param("projectId");
  const rawDepth = c.req.query("depth");
  const requestedNodeType = c.req.query("nodeType");
  const parsedDepth = rawDepth == null ? null : Number(rawDepth);

  await ensureProjectRootNode(projectId);

  const conditions = [eq(projectTreeNodes.projectId, projectId)];
  if (requestedNodeType) {
    conditions.push(
      eq(
        projectTreeNodes.nodeType,
        requestedNodeType as typeof projectTreeNodes.$inferSelect.nodeType,
      ),
    );
  }
  if (parsedDepth != null && Number.isFinite(parsedDepth) && parsedDepth >= 0) {
    conditions.push(lte(projectTreeNodes.depth, parsedDepth));
  }

  const nodes = await db
    .select()
    .from(projectTreeNodes)
    .where(and(...conditions))
    .orderBy(asc(projectTreeNodes.depth), asc(projectTreeNodes.createdAt));

  return c.json({ data: nodes.map(normalizeProjectTreeNodeRecord) });
});

projectRoutes.get(
  "/:projectId/tree/:nodeId",
  requireProjectRole("projectId", "viewer"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const nodeId = c.req.param("nodeId");

    const node = await db.query.projectTreeNodes.findFirst({
      where: and(eq(projectTreeNodes.projectId, projectId), eq(projectTreeNodes.id, nodeId)),
    });

    if (!node) {
      return c.json({ error: "Tree node not found" }, 404);
    }

    return c.json(normalizeProjectTreeNodeRecord(node));
  },
);

projectRoutes.get(
  "/:projectId/tree/:nodeId/children",
  requireProjectRole("projectId", "viewer"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const nodeId = c.req.param("nodeId");

    const node = await db.query.projectTreeNodes.findFirst({
      where: and(eq(projectTreeNodes.projectId, projectId), eq(projectTreeNodes.id, nodeId)),
    });

    if (!node) {
      return c.json({ error: "Tree node not found" }, 404);
    }

    const children = await db
      .select()
      .from(projectTreeNodes)
      .where(and(eq(projectTreeNodes.projectId, projectId), eq(projectTreeNodes.parentId, nodeId)))
      .orderBy(asc(projectTreeNodes.createdAt));

    return c.json({ data: children.map(normalizeProjectTreeNodeRecord) });
  },
);

projectRoutes.post(
  "/:projectId/tree/:nodeId/children",
  requireProjectRole("projectId", "developer"),
  zValidator("json", createProjectTreeChildNodeSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const nodeId = c.req.param("nodeId");
    const body = c.req.valid("json");

    const created = await createProjectTreeChildNode({
      projectId,
      parentId: nodeId,
      id: body.id,
      nodeType: body.nodeType as ProjectTreeNodeType,
      role: body.role ?? null,
      contentText: body.contentText ?? null,
      contentJson: body.contentJson ?? null,
      tokenCount: body.tokenCount ?? null,
      runtimeSessionId: body.runtimeSessionId ?? null,
      runtimeMessageId: body.runtimeMessageId ?? null,
      branchName: body.branchName ?? null,
      isActive: body.isActive ?? true,
      archivedAt: body.archivedAt ?? null,
    });

    return c.json(normalizeProjectTreeNodeRecord(created), 201);
  },
);

projectRoutes.get(
  "/:projectId/tree/:nodeId/ancestors",
  requireProjectRole("projectId", "viewer"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const nodeId = c.req.param("nodeId");

    const node = await db.query.projectTreeNodes.findFirst({
      where: and(eq(projectTreeNodes.projectId, projectId), eq(projectTreeNodes.id, nodeId)),
    });

    if (!node) {
      return c.json({ error: "Tree node not found" }, 404);
    }

    const ancestors = await db
      .select()
      .from(projectTreeNodes)
      .where(
        and(
          eq(projectTreeNodes.projectId, projectId),
          sql<boolean>`${projectTreeNodes.path} @> CAST(${node.path} AS ltree)`,
        ),
      )
      .orderBy(asc(projectTreeNodes.depth), asc(projectTreeNodes.createdAt));

    return c.json({ data: ancestors.map(normalizeProjectTreeNodeRecord) });
  },
);

projectRoutes.get("/:projectId/branches", requireProjectRole("projectId", "viewer"), async (c) => {
  const projectId = c.req.param("projectId");

  const branches = await db
    .select()
    .from(projectTreeBranches)
    .where(eq(projectTreeBranches.projectId, projectId))
    .orderBy(desc(projectTreeBranches.isDefault), asc(projectTreeBranches.branchName));

  return c.json({ data: branches.map(normalizeProjectTreeBranchRecord) });
});

projectRoutes.put(
  "/:projectId/branches/:branchId",
  requireProjectRole("projectId", "developer"),
  zValidator("json", updateProjectTreeBranchSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const branchId = c.req.param("branchId");
    const body = c.req.valid("json");
    const now = new Date().toISOString();

    const existing = await db.query.projectTreeBranches.findFirst({
      where: and(
        eq(projectTreeBranches.id, branchId),
        eq(projectTreeBranches.projectId, projectId),
      ),
    });
    if (!existing) {
      return c.json({ error: "Branch not found" }, 404);
    }

    const headNode = await db.query.projectTreeNodes.findFirst({
      where: and(
        eq(projectTreeNodes.id, body.headNodeId),
        eq(projectTreeNodes.projectId, projectId),
      ),
    });
    if (!headNode) {
      return c.json({ error: "Branch head node not found" }, 404);
    }

    if (body.isDefault) {
      await db
        .update(projectTreeBranches)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(projectTreeBranches.projectId, projectId));
    }

    await db
      .update(projectTreeBranches)
      .set({
        headNodeId: body.headNodeId,
        isDefault: body.isDefault ?? existing.isDefault,
        updatedAt: now,
      })
      .where(eq(projectTreeBranches.id, branchId));

    const updated = await db.query.projectTreeBranches.findFirst({
      where: eq(projectTreeBranches.id, branchId),
    });

    return c.json(updated ? normalizeProjectTreeBranchRecord(updated) : updated);
  },
);

projectRoutes.get(
  "/:projectId/tree/:nodeId/links",
  requireProjectRole("projectId", "viewer"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const nodeId = c.req.param("nodeId");

    const node = await db.query.projectTreeNodes.findFirst({
      where: and(eq(projectTreeNodes.projectId, projectId), eq(projectTreeNodes.id, nodeId)),
    });
    if (!node) {
      return c.json({ error: "Tree node not found" }, 404);
    }

    const links = await db
      .select()
      .from(projectTreeLinks)
      .where(
        or(eq(projectTreeLinks.sourceNodeId, nodeId), eq(projectTreeLinks.targetNodeId, nodeId)),
      )
      .orderBy(desc(projectTreeLinks.createdAt));

    return c.json({
      data: links.map((link) => ({
        ...normalizeProjectTreeLinkRecord(link),
        direction:
          link.sourceNodeId === nodeId
            ? link.targetNodeId === nodeId
              ? "self"
              : "outgoing"
            : "incoming",
      })),
    });
  },
);

projectRoutes.post(
  "/:projectId/tree/:nodeId/links",
  requireProjectRole("projectId", "developer"),
  zValidator("json", createProjectTreeLinkSchema),
  async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    const nodeId = c.req.param("nodeId");
    const body = c.req.valid("json");
    const targetProjectId = body.targetProjectId ?? projectId;

    const sourceNode = await db.query.projectTreeNodes.findFirst({
      where: and(eq(projectTreeNodes.projectId, projectId), eq(projectTreeNodes.id, nodeId)),
    });
    if (!sourceNode) {
      return c.json({ error: "Source tree node not found" }, 404);
    }

    const visibleTargetProject =
      targetProjectId === projectId
        ? await getProjectOrNull(projectId)
        : await getVisibleProjectOrNull(user, targetProjectId);
    if (!visibleTargetProject) {
      return c.json({ error: "Target project not found or inaccessible" }, 404);
    }

    const targetNode = await db.query.projectTreeNodes.findFirst({
      where: and(
        eq(projectTreeNodes.projectId, targetProjectId),
        eq(projectTreeNodes.id, body.targetNodeId),
      ),
    });
    if (!targetNode) {
      return c.json({ error: "Target tree node not found" }, 404);
    }

    const existing = await db.query.projectTreeLinks.findFirst({
      where: and(
        eq(projectTreeLinks.sourceNodeId, nodeId),
        eq(projectTreeLinks.targetNodeId, body.targetNodeId),
        eq(projectTreeLinks.linkType, body.linkType as ProjectTreeLinkType),
      ),
    });
    if (existing) {
      return c.json(existing, 200);
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.insert(projectTreeLinks).values({
      id,
      sourceNodeId: nodeId,
      sourceProjectId: projectId,
      targetNodeId: body.targetNodeId,
      targetProjectId,
      linkType: body.linkType as ProjectTreeLinkType,
      metadata: body.metadata ?? null,
      bidirectional: body.bidirectional ?? false,
      createdBy: user.sub,
      createdAt,
    });

    return c.json(
      normalizeApiTimestampFields(
        {
          id,
          sourceNodeId: nodeId,
          sourceProjectId: projectId,
          targetNodeId: body.targetNodeId,
          targetProjectId,
          linkType: body.linkType,
          metadata: body.metadata ?? null,
          bidirectional: body.bidirectional ?? false,
          createdBy: user.sub,
          createdAt,
        },
        ["createdAt"] as const,
      ),
      201,
    );
  },
);

projectRoutes.get("/:projectId/links", requireProjectRole("projectId", "viewer"), async (c) => {
  const projectId = c.req.param("projectId");

  const links = await db
    .select()
    .from(projectTreeLinks)
    .where(
      or(
        eq(projectTreeLinks.sourceProjectId, projectId),
        eq(projectTreeLinks.targetProjectId, projectId),
      ),
    )
    .orderBy(desc(projectTreeLinks.createdAt));

  return c.json({ data: links.map(normalizeProjectTreeLinkRecord) });
});

projectRoutes.delete(
  "/:projectId/links/:linkId",
  requireProjectRole("projectId", "developer"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const linkId = c.req.param("linkId");

    const existing = await db.query.projectTreeLinks.findFirst({
      where: eq(projectTreeLinks.id, linkId),
    });
    if (!existing) {
      return c.json({ error: "Link not found" }, 404);
    }

    if (existing.sourceProjectId !== projectId && existing.targetProjectId !== projectId) {
      return c.json({ error: "Link not found in this project" }, 404);
    }

    await db.delete(projectTreeLinks).where(eq(projectTreeLinks.id, linkId));
    return c.json({ ok: true });
  },
);

// GET /api/projects/:projectId/members
projectRoutes.get("/:projectId/members", requireProjectRole("projectId", "viewer"), async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getProjectOrNull(projectId);
  if (!project) return c.json({ error: "Project not found" }, 404);

  const members = await db
    .select({
      userId: projectRoles.userId,
      projectId: projectRoles.projectId,
      role: projectRoles.role,
      username: users.username,
      displayName: users.displayName,
      globalRole: users.role,
      createdAt: users.createdAt,
    })
    .from(projectRoles)
    .innerJoin(users, eq(projectRoles.userId, users.id))
    .where(eq(projectRoles.projectId, projectId));

  return c.json(members.map((member) => normalizeApiTimestampFields(member, ["createdAt"] as const)));
});

// GET /api/projects/:projectId/members/candidates
projectRoutes.get(
  "/:projectId/members/candidates",
  requireProjectRole("projectId", "project_admin"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const project = await getProjectOrNull(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const existingMembers = await db.query.projectRoles.findMany({
      where: eq(projectRoles.projectId, projectId),
    });
    const existingUserIds = new Set(existingMembers.map((item) => item.userId));

    const allUsers = await db.query.users.findMany({
      columns: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        createdAt: true,
        passwordHash: false,
      },
    });

    return c.json(
      allUsers
        .filter((user) => !existingUserIds.has(user.id))
        .map((user) => normalizeApiTimestampFields(user, ["createdAt"] as const)),
    );
  },
);

// POST /api/projects/:projectId/members
projectRoutes.post(
  "/:projectId/members",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", addProjectMemberSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");

    const project = await getProjectOrNull(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);

    const user = await db.query.users.findFirst({
      where: eq(users.id, body.userId),
      columns: { passwordHash: false },
    });
    if (!user) return c.json({ error: "User not found" }, 404);

    const existing = await db.query.projectRoles.findFirst({
      where: and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, body.userId)),
    });
    if (existing) return c.json({ error: "User is already a project member" }, 409);

    try {
      await db.insert(projectRoles).values({
        id: crypto.randomUUID(),
        projectId,
        userId: body.userId,
        role: body.role,
      });
    } catch (error) {
      if (isProjectMemberConflict(error)) {
        return c.json({ error: "User is already a project member" }, 409);
      }

      throw error;
    }

    return c.json(
      normalizeApiTimestampFields(
        {
          userId: user.id,
          projectId,
          role: body.role,
          username: user.username,
          displayName: user.displayName,
          globalRole: user.role,
          createdAt: user.createdAt,
        },
        ["createdAt"] as const,
      ),
      201,
    );
  },
);

// PATCH /api/projects/:projectId/members/:userId
projectRoutes.patch(
  "/:projectId/members/:userId",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", updateProjectMemberSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const userId = c.req.param("userId");
    const body = c.req.valid("json");

    const existing = await db.query.projectRoles.findFirst({
      where: and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)),
    });
    if (!existing) return c.json({ error: "Project member not found" }, 404);

    if (existing.role === "project_admin" && body.role !== "project_admin") {
      const admins = await listProjectAdmins(projectId);
      const adminCount = admins.filter((item) => item.role === "project_admin").length;
      if (adminCount <= 1) {
        return c.json({ error: "Project must retain at least one project_admin" }, 400);
      }
    }

    await db
      .update(projectRoles)
      .set({ role: body.role })
      .where(and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)));

    return c.json({ userId, projectId, role: body.role });
  },
);

// DELETE /api/projects/:projectId/members/:userId
projectRoutes.delete(
  "/:projectId/members/:userId",
  requireProjectRole("projectId", "project_admin"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const userId = c.req.param("userId");

    const existing = await db.query.projectRoles.findFirst({
      where: and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)),
    });
    if (!existing) return c.json({ error: "Project member not found" }, 404);

    if (existing.role === "project_admin") {
      const admins = await listProjectAdmins(projectId);
      const adminCount = admins.filter((item) => item.role === "project_admin").length;
      if (adminCount <= 1) {
        return c.json({ error: "Project must retain at least one project_admin" }, 400);
      }
    }

    await db
      .delete(projectRoles)
      .where(and(eq(projectRoles.projectId, projectId), eq(projectRoles.userId, userId)));

    return c.json({ ok: true });
  },
);

// PATCH /api/projects/:projectId/archive
projectRoutes.patch(
  "/:projectId/archive",
  requireProjectRole("projectId", "project_admin"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const user = c.get("user");

    const existing = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });
    if (!existing) return c.json({ error: "Project not found" }, 404);

    const now = new Date().toISOString();
    await db
      .update(projects)
      .set({ status: "archived", updatedAt: now })
      .where(eq(projects.id, projectId));

    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      ts: now,
      userId: user.sub,
      projectId,
      eventType: "project.archived",
      action: "archive_project",
      target: projectId,
      detail: { previousStatus: (existing as { status?: string }).status || "active" },
    });

    return c.json({ ok: true, id: projectId, status: "archived" });
  },
);

// GET /api/projects/:projectId/workflow-template
projectRoutes.get(
  "/:projectId/workflow-template",
  requireProjectRole("projectId", "viewer"),
  async (c) => {
    const projectId = c.req.param("projectId");
    const project = await getProjectOrNull(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const settings = normalizeProjectSettings(project.settings) ?? {};
    const binding = await getWorkflowTemplateBinding(projectId, settings);

    return c.json({
      projectId,
      workflowTemplateId: binding.workflowTemplateId,
      template: binding.template,
    });
  },
);

projectRoutes.get("/:projectId/fund", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getVisibleProjectOrNull(c.get("user"), projectId);
  if (!project) {
    return c.json({ error: "Project not found or access denied" }, 404);
  }

  const fund = await getProjectModelFundRecord(projectId);
  return c.json(normalizeProjectModelFundRecord(projectId, fund));
});

projectRoutes.post(
  "/:projectId/fund/grant",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", projectFundGrantSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const user = c.get("user");
    const body = c.req.valid("json");
    const project = await getProjectOrNull(projectId);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const result = await mutateProjectModelFund({
      projectId,
      type: "grant",
      amountUsd: body.amountUsd,
      createdBy: user.sub,
      note: body.note || null,
    });

    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      ts: result.ledger.createdAt,
      userId: user.sub,
      projectId,
      eventType: "project.model_fund.granted",
      action: "grant_project_model_fund",
      target: result.ledger.id,
      detail: {
        fundId: result.fund.id,
        amountUsd: body.amountUsd,
        balanceAfter: result.ledger.balanceAfter,
        note: body.note || null,
      },
      riskLevel: "low",
    });

    return c.json(
      {
        fund: normalizeProjectModelFundRecord(projectId, result.fund),
        ledgerEntry: normalizeProjectModelFundLedgerRecord(result.ledger),
      },
      201,
    );
  },
);

projectRoutes.post(
  "/:projectId/fund/adjust",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", projectFundAdjustSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const user = c.get("user");
    const body = c.req.valid("json");
    const project = await getProjectOrNull(projectId);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    try {
      const result = await mutateProjectModelFund({
        projectId,
        type: "adjust",
        amountUsd: body.amountUsd,
        createdBy: user.sub,
        note: body.note || null,
      });

      await db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        ts: result.ledger.createdAt,
        userId: user.sub,
        projectId,
        eventType: "project.model_fund.adjusted",
        action: "adjust_project_model_fund",
        target: result.ledger.id,
        detail: {
          fundId: result.fund.id,
          amountUsd: body.amountUsd,
          balanceAfter: result.ledger.balanceAfter,
          note: body.note || null,
        },
        riskLevel: body.amountUsd < 0 ? "medium" : "low",
      });

      return c.json(
        {
          fund: normalizeProjectModelFundRecord(projectId, result.fund),
          ledgerEntry: normalizeProjectModelFundLedgerRecord(result.ledger),
        },
        200,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Failed to adjust fund" }, 400);
    }
  },
);

projectRoutes.post(
  "/:projectId/fund/reserve",
  requireProjectRole("projectId", "developer"),
  zValidator("json", projectFundExecutionMutationSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const user = c.get("user");
    const body = c.req.valid("json");
    const project = await getProjectOrNull(projectId);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    try {
      const result = await mutateProjectModelFund({
        projectId,
        type: "reserve",
        amountUsd: body.amountUsd,
        createdBy: user.sub,
        note: body.note || null,
        modelRoute: body.modelRoute || null,
        taskId: body.taskId || null,
        runtimeSessionId: body.runtimeSessionId || null,
      });

      await db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        ts: result.ledger.createdAt,
        userId: user.sub,
        projectId,
        eventType: "project.model_fund.reserved",
        action: "reserve_project_model_fund",
        target: result.ledger.id,
        detail: {
          fundId: result.fund.id,
          amountUsd: body.amountUsd,
          balanceAfter: result.ledger.balanceAfter,
          modelRoute: body.modelRoute || null,
          taskId: body.taskId || null,
          runtimeSessionId: body.runtimeSessionId || null,
          note: body.note || null,
        },
        riskLevel: "medium",
      });

      return c.json(
        {
          fund: normalizeProjectModelFundRecord(projectId, result.fund),
          ledgerEntry: normalizeProjectModelFundLedgerRecord(result.ledger),
        },
        200,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Failed to reserve fund" }, 400);
    }
  },
);

projectRoutes.post(
  "/:projectId/fund/consume",
  requireProjectRole("projectId", "developer"),
  zValidator("json", projectFundExecutionMutationSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const user = c.get("user");
    const body = c.req.valid("json");
    const project = await getProjectOrNull(projectId);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    try {
      const result = await mutateProjectModelFund({
        projectId,
        type: "consume",
        amountUsd: body.amountUsd,
        createdBy: user.sub,
        note: body.note || null,
        modelRoute: body.modelRoute || null,
        taskId: body.taskId || null,
        runtimeSessionId: body.runtimeSessionId || null,
      });

      await db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        ts: result.ledger.createdAt,
        userId: user.sub,
        projectId,
        eventType: "project.model_fund.consumed",
        action: "consume_project_model_fund",
        target: result.ledger.id,
        detail: {
          fundId: result.fund.id,
          amountUsd: body.amountUsd,
          balanceAfter: result.ledger.balanceAfter,
          modelRoute: body.modelRoute || null,
          taskId: body.taskId || null,
          runtimeSessionId: body.runtimeSessionId || null,
          note: body.note || null,
        },
        riskLevel: "medium",
      });

      return c.json(
        {
          fund: normalizeProjectModelFundRecord(projectId, result.fund),
          ledgerEntry: normalizeProjectModelFundLedgerRecord(result.ledger),
        },
        200,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Failed to consume fund" }, 400);
    }
  },
);

projectRoutes.post(
  "/:projectId/fund/refund",
  requireProjectRole("projectId", "developer"),
  zValidator("json", projectFundExecutionMutationSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const user = c.get("user");
    const body = c.req.valid("json");
    const project = await getProjectOrNull(projectId);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    try {
      const result = await mutateProjectModelFund({
        projectId,
        type: "refund",
        amountUsd: body.amountUsd,
        createdBy: user.sub,
        note: body.note || null,
        modelRoute: body.modelRoute || null,
        taskId: body.taskId || null,
        runtimeSessionId: body.runtimeSessionId || null,
      });

      await db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        ts: result.ledger.createdAt,
        userId: user.sub,
        projectId,
        eventType: "project.model_fund.refunded",
        action: "refund_project_model_fund",
        target: result.ledger.id,
        detail: {
          fundId: result.fund.id,
          amountUsd: body.amountUsd,
          balanceAfter: result.ledger.balanceAfter,
          modelRoute: body.modelRoute || null,
          taskId: body.taskId || null,
          runtimeSessionId: body.runtimeSessionId || null,
          note: body.note || null,
        },
        riskLevel: "low",
      });

      return c.json(
        {
          fund: normalizeProjectModelFundRecord(projectId, result.fund),
          ledgerEntry: normalizeProjectModelFundLedgerRecord(result.ledger),
        },
        200,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Failed to refund fund" }, 400);
    }
  },
);

projectRoutes.get("/:projectId/fund/ledger", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getVisibleProjectOrNull(c.get("user"), projectId);
  if (!project) {
    return c.json({ error: "Project not found or access denied" }, 404);
  }

  const parsedQuery = projectFundLedgerQuerySchema.safeParse({
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
  });
  if (!parsedQuery.success) {
    return c.json({ error: "Invalid project fund ledger query" }, 400);
  }

  const cursor = normalizeApiTimestamp(parsedQuery.data.cursor) || parsedQuery.data.cursor;
  const whereClause = cursor
    ? and(
        eq(projectModelFundLedger.projectId, projectId),
        lt(projectModelFundLedger.createdAt, cursor),
      )
    : eq(projectModelFundLedger.projectId, projectId);

  const items = await db
    .select()
    .from(projectModelFundLedger)
    .where(whereClause)
    .orderBy(desc(projectModelFundLedger.createdAt), desc(projectModelFundLedger.id))
    .limit(parsedQuery.data.limit);

  const nextCursor =
    items.length === parsedQuery.data.limit
      ? (normalizeApiTimestamp(items[items.length - 1]?.createdAt) ||
          items[items.length - 1]?.createdAt ||
          null)
      : null;

  return c.json({
    projectId,
    items: items.map(normalizeProjectModelFundLedgerRecord),
    nextCursor,
  });
});

projectRoutes.post(
  "/:projectId/runtime-usage-ledgers/sync",
  requireProjectRole("projectId", "developer"),
  zValidator("json", syncRuntimeUsageLedgerSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");
    const project = await getProjectOrNull(projectId);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    if (body.taskId) {
      const [task] = await loadTaskTreeRecords({ taskIds: [body.taskId] });
      if (!task || task.projectId !== projectId) {
        return c.json({ error: "Task not found" }, 404);
      }
    }

    const now = new Date().toISOString();
    const { ledgerId } = await ensureRuntimeUsageLedger(projectId, body, now);
    const existingStep = await insertRuntimeUsageLedgerStepIfNeeded({
      projectId,
      ledgerId,
      body,
      now,
    });

    const shouldApplyDelta = !body.step || !existingStep;

    const ledgerAfterInsert = await db.query.runtimeUsageLedgers.findFirst({
      where: eq(runtimeUsageLedgers.id, ledgerId),
    });

    if (!ledgerAfterInsert) {
      return c.json({ error: "Failed to load runtime usage ledger after sync" }, 500);
    }

    await applyRuntimeUsageLedgerSync({
      ledgerId,
      body,
      ledgerAfterInsert,
      shouldApplyDelta,
      now,
    });

    const syncedLedger = await db.query.runtimeUsageLedgers.findFirst({
      where: eq(runtimeUsageLedgers.id, ledgerId),
    });

    return c.json({
      projectId,
      ledger: syncedLedger ? normalizeRuntimeUsageLedgerRecord(syncedLedger) : null,
      stepInserted: Boolean(body.step && !existingStep),
      deltaApplied: shouldApplyDelta,
    });
  },
);

projectRoutes.get("/:projectId/runtime-usage-ledgers", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getVisibleProjectOrNull(c.get("user"), projectId);
  if (!project) {
    return c.json({ error: "Project not found or access denied" }, 404);
  }

  const taskId = c.req.query("taskId") || undefined;
  const status = c.req.query("status") || undefined;
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 20), 1), 100);

  const ledgers = (
    await db.query.runtimeUsageLedgers.findMany({
      where: eq(runtimeUsageLedgers.projectId, projectId),
      orderBy: [desc(runtimeUsageLedgers.createdAt)],
    })
  )
    .filter((ledger) => (taskId ? ledger.taskId === taskId : true))
    .filter((ledger) => (status ? ledger.status === status : true))
    .slice(0, limit);

  const totals = ledgers.reduce(
    (acc, ledger) => {
      acc.requestCount += ledger.requestCount;
      acc.stepCount += ledger.stepCount;
      acc.inputTokens += ledger.inputTokens;
      acc.outputTokens += ledger.outputTokens;
      acc.totalTokens += ledger.totalTokens;
      acc.costUsd = Number((acc.costUsd + ledger.costUsd).toFixed(4));
      return acc;
    },
    {
      ledgerCount: ledgers.length,
      requestCount: 0,
      stepCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    },
  );

  return c.json({
    projectId,
    totals,
    items: ledgers.map(normalizeRuntimeUsageLedgerRecord),
  });
});

projectRoutes.get("/:projectId/runtime-usage-ledgers/:ledgerId", async (c) => {
  const projectId = c.req.param("projectId");
  const ledgerId = c.req.param("ledgerId");
  const project = await getVisibleProjectOrNull(c.get("user"), projectId);
  if (!project) {
    return c.json({ error: "Project not found or access denied" }, 404);
  }

  const ledger = await db.query.runtimeUsageLedgers.findFirst({
    where: and(eq(runtimeUsageLedgers.id, ledgerId), eq(runtimeUsageLedgers.projectId, projectId)),
  });

  if (!ledger) {
    return c.json({ error: "Runtime usage ledger not found" }, 404);
  }

  const steps = await db.query.runtimeUsageLedgerSteps.findMany({
    where: eq(runtimeUsageLedgerSteps.ledgerId, ledgerId),
    orderBy: [asc(runtimeUsageLedgerSteps.requestIndex), asc(runtimeUsageLedgerSteps.createdAt)],
  });

  const stepBreakdown = steps.reduce(
    (acc, step) => {
      acc[step.stepType] = (acc[step.stepType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return c.json({
    projectId,
    ledger: normalizeRuntimeUsageLedgerRecord(ledger),
    steps: steps.map(normalizeRuntimeUsageLedgerStepRecord),
    breakdown: {
      byStepType: stepBreakdown,
    },
  });
});

projectRoutes.get("/:projectId/runtime-usage-baselines", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getVisibleProjectOrNull(c.get("user"), projectId);
  if (!project) {
    return c.json({ error: "Project not found or access denied" }, 404);
  }

  const providerId = c.req.query("providerId")?.trim() || undefined;
  const modelId = c.req.query("modelId")?.trim() || undefined;
  const entrypointType = c.req.query("entrypointType")?.trim() || undefined;
  const orchestrationFingerprint = c.req.query("orchestrationFingerprint")?.trim() || undefined;

  const baselines = await rebuildRuntimeUsageBaseline({
    projectId,
    providerId,
    modelId,
    entrypointType,
    orchestrationFingerprint,
  });

  const preferredMatchOrder: RuntimeUsageBaselineMatchScope[] = [
    "project+provider+model+entrypoint+fingerprint",
    "project+provider+model+entrypoint",
    "project+provider+model",
    "project+entrypoint",
    "project",
  ];

  const baseline =
    preferredMatchOrder
      .map((scope) => baselines.find((item) => item.matchScope === scope))
      .find((item) => item && item.sampleSize > 0) || null;

  return c.json({
    projectId,
    query: {
      providerId: providerId || null,
      modelId: modelId || null,
      entrypointType: entrypointType || null,
      orchestrationFingerprint: orchestrationFingerprint || null,
    },
    baseline,
    candidates: baselines,
  });
});

projectRoutes.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await getVisibleProjectOrNull(c.get("user"), projectId);
  if (!project) {
    return c.json({ error: "Project not found or access denied" }, 404);
  }
  return c.json(normalizeProjectRecord(project));
});

// PUT /api/projects/:projectId/workflow-template
projectRoutes.put(
  "/:projectId/workflow-template",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", workflowTemplateBindingSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const user = c.get("user");
    const body = c.req.valid("json");

    const project = await getProjectOrNull(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    let template = null;
    if (body.workflowTemplateId) {
      template = await db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, body.workflowTemplateId),
      });

      if (!template) {
        return c.json({ error: "Workflow template not found" }, 404);
      }

      if (!template.enabled) {
        return c.json({ error: "Workflow template is disabled" }, 400);
      }

      const selectableForProject =
        template.selectableByProjects || template.projectId === projectId;
      if (!selectableForProject) {
        return c.json({ error: "Workflow template is not selectable for this project" }, 400);
      }
    }

    const existingSettings = normalizeProjectSettings(project.settings) ?? {};
    const nextSettings: ProjectSettings = { ...existingSettings };

    if (body.workflowTemplateId) {
      nextSettings.workflowTemplateId = body.workflowTemplateId;
    } else {
      nextSettings.workflowTemplateId = undefined;
    }

    const now = new Date().toISOString();
    await db
      .update(projects)
      .set({
        settings: nextSettings,
        updatedAt: now,
      })
      .where(eq(projects.id, projectId));

    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      ts: now,
      userId: user.sub,
      projectId,
      eventType: "project.workflow_template.updated",
      action: "bind_workflow_template",
      target: projectId,
      detail: {
        workflowTemplateId: body.workflowTemplateId,
      },
    });

    return c.json({
      projectId,
      workflowTemplateId: body.workflowTemplateId,
      template,
    });
  },
);

// PATCH /api/projects/:projectId
projectRoutes.patch(
  "/:projectId",
  requireProjectRole("projectId", "project_admin"),
  zValidator("json", updateProjectSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");
    const modelValidation = validateConfiguredModelRoute(
      body.settings?.defaultModel,
      "项目默认模型",
    );
    if (modelValidation) {
      return c.json({ error: modelValidation }, 400);
    }

    const existing = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });
    if (!existing) return c.json({ error: "Project not found" }, 404);

    const existingSettings = normalizeProjectSettings(existing.settings) ?? {};
    const nextSettings = body.settings
      ? { ...existingSettings, ...body.settings }
      : existingSettings;
    const updatedAt = new Date().toISOString();

    await db
      .update(projects)
      .set({
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.settings && { settings: nextSettings }),
        updatedAt,
      })
      .where(eq(projects.id, projectId));

    return c.json(
      normalizeProjectRecord({
        ...existing,
        ...body,
        id: projectId,
        settings: body.settings ? nextSettings : existingSettings,
        updatedAt,
      }),
    );
  },
);
