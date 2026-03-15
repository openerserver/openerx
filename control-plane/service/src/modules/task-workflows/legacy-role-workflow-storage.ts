import { eq } from "drizzle-orm";
import { db } from "../../db";
import { developerChangeRequests, roleAggregateConclusions, tasks } from "../../db/schema";

type JsonRecord = Record<string, unknown>;

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

export async function ensureLegacyRoleWorkflowMigrated(taskId: string) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) {
    return null;
  }

  const strategy = parseTaskStrategy(task.strategy);
  const legacyRoleConclusions = normalizeArray(strategy.roleAggregateConclusions);
  const legacyChangeRequests = normalizeArray(strategy.developerChangeRequests);

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