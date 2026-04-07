import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  projectTreeNodes,
  repositories,
  repositoryCredentials,
  taskSessions,
  taskSnapshots,
  tasks,
} from "../../db/schema";
import { fromStoredTaskExecutionMode } from "../tasks/task-execution-mode";
import type { TaskCategory, TaskExecutionMode, TaskStatus } from "./task-types";

export interface TaskTreeRecord {
  id: string;
  projectId: string;
  userId: string | null;
  title: string;
  prompt: string;
  status: TaskStatus;
  sessionId: string | null;
  agentRunId: string | null;
  result: string | null;
  category: TaskCategory | null;
  strategy: unknown;
  repoId: string | null;
  workspaceRoot: string | null;
  baseRevision: string | null;
  workingBranch: string | null;
  selectedModel: string | null;
  executionMode: TaskExecutionMode | null;
  autoAdvanceStages: boolean;
  credentialId: string | null;
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  gitCommitterName: string | null;
  gitCommitterEmail: string | null;
  finalCommitSha: string | null;
  finalBranchName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  orchestrationKind: string | null;
  currentRunId: string | null;
  currentRunStatus: string | null;
  currentRunStartedAt: string | null;
  currentRunFinishedAt: string | null;
  currentRunCandidateCount: number | null;
  currentRunPipelineStepCount: number | null;
  latestResultSummary: string | null;
  latestErrorText: string | null;
  activeCandidateCount: number;
  completedCandidateCount: number;
  failedCandidateCount: number;
  totalChainSteps: number;
  completedChainSteps: number;
  winnerNodeId: string | null;
  lastActivityAt: string | null;
  repoName: string | null;
  remoteUrl: string | null;
  credentialLabel: string | null;
}

function normalizeTaskCategory(value: unknown): TaskCategory | null {
  return value === "quick" ||
    value === "deep" ||
    value === "ops" ||
    value === "security" ||
    value === "architecture"
    ? (value as TaskCategory)
    : null;
}

type TaskAggregateRow = typeof tasks.$inferSelect;
type TaskSnapshotRow = typeof taskSnapshots.$inferSelect;
type TaskRepoRow = typeof repositories.$inferSelect;
type TaskCredentialRow = typeof repositoryCredentials.$inferSelect;
type MapTaskTreeNodeArgs = {
  node: typeof projectTreeNodes.$inferSelect;
  aggregate?: TaskAggregateRow;
  snapshot?: TaskSnapshotRow;
  sessionRuntimeIds: Map<string, string>;
  repos: Map<string, TaskRepoRow>;
  credentials: Map<string, TaskCredentialRow>;
};

function mapOrchestrationKindToExecutionMode(
  orchestrationKind: string | null | undefined,
): TaskExecutionMode | null {
  return fromStoredTaskExecutionMode(orchestrationKind);
}

function normalizeTaskStatusValue(value: string | null | undefined): TaskStatus | null {
  return value === "pending" ||
    value === "running" ||
    value === "paused" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : null;
}

function mapLifecycleStatusToTaskStatus(
  lifecycleStatus: string | null | undefined,
): TaskStatus | null {
  if (lifecycleStatus === "done") {
    return "completed";
  }
  if (lifecycleStatus === "active") {
    return "running";
  }
  if (lifecycleStatus === "archived") {
    return "cancelled";
  }
  if (lifecycleStatus === "draft") {
    return "pending";
  }

  return null;
}

function resolveSnapshotTaskStatus(
  snapshot?: TaskSnapshotRow,
  _aggregate?: TaskAggregateRow,
): TaskStatus {
  return (
    normalizeTaskStatusValue(snapshot?.currentExecutionStatus) ??
    mapLifecycleStatusToTaskStatus(snapshot?.lifecycleStatus) ??
    "pending"
  );
}

function resolveTaskReferenceIds(args: MapTaskTreeNodeArgs) {
  return {
    repoId: args.aggregate?.repoId ?? null,
    credentialId: args.aggregate?.credentialId ?? null,
    currentRunId: null,
  };
}

function resolveTaskStrategyFields(args: MapTaskTreeNodeArgs) {
  const strategy = args.aggregate?.strategyJson ?? null;
  const executionMode = mapOrchestrationKindToExecutionMode(args.snapshot?.currentExecutionMode);

  return {
    strategy,
    executionMode,
    autoAdvanceStages: false,
  };
}

function resolveTaskIdentityFields(args: MapTaskTreeNodeArgs) {
  return {
    id: args.node.id,
    projectId: args.aggregate?.projectId ?? args.snapshot?.projectId ?? args.node.projectId,
    userId: args.aggregate?.createdByUserId ?? null,
    title: args.aggregate?.title ?? args.node.contentText ?? args.node.id,
    prompt: args.aggregate?.prompt ?? "",
    category: normalizeTaskCategory(args.aggregate?.category),
    createdAt: args.aggregate?.createdAt ?? args.node.createdAt,
  };
}

function resolveTaskRepositoryFields(
  args: MapTaskTreeNodeArgs,
  refs: ReturnType<typeof resolveTaskReferenceIds>,
) {
  const repo = refs.repoId ? args.repos.get(refs.repoId) : undefined;
  const credential = refs.credentialId ? args.credentials.get(refs.credentialId) : undefined;

  return {
    repoId: refs.repoId,
    workspaceRoot: args.aggregate?.workspaceRoot ?? null,
    baseRevision: args.aggregate?.baseRevision ?? null,
    workingBranch: args.aggregate?.workingBranch ?? null,
    selectedModel: args.aggregate?.preferredModel ?? null,
    credentialId: refs.credentialId,
    gitAuthorName: args.aggregate?.gitAuthorName ?? credential?.gitAuthorName ?? null,
    gitAuthorEmail: args.aggregate?.gitAuthorEmail ?? credential?.gitAuthorEmail ?? null,
    gitCommitterName: args.aggregate?.gitCommitterName ?? null,
    gitCommitterEmail: args.aggregate?.gitCommitterEmail ?? null,
    finalCommitSha: args.aggregate?.finalCommitSha ?? null,
    finalBranchName: args.aggregate?.finalBranchName ?? null,
    // Tree payload no longer serves as a task business-fact fallback.
    repoName: repo?.name ?? null,
    remoteUrl: repo?.remoteUrl ?? null,
    credentialLabel: credential?.label ?? null,
  };
}

function resolveTaskRunFields(
  args: MapTaskTreeNodeArgs,
  refs: ReturnType<typeof resolveTaskReferenceIds>,
  strategyFields: ReturnType<typeof resolveTaskStrategyFields>,
) {
  const snapshotSessionId = args.snapshot?.currentSessionId
    ? (args.sessionRuntimeIds.get(args.snapshot.currentSessionId) ?? null)
    : null;

  return {
    status: resolveSnapshotTaskStatus(args.snapshot, args.aggregate),
    sessionId: snapshotSessionId,
    agentRunId: null,
    result:
      args.snapshot?.latestResultSummary ?? null,
    strategy: strategyFields.strategy,
    executionMode: strategyFields.executionMode,
    autoAdvanceStages: strategyFields.autoAdvanceStages,
    startedAt: args.aggregate?.activatedAt ?? null,
    finishedAt: args.aggregate?.doneAt ?? null,
    orchestrationKind: mapOrchestrationKindToExecutionMode(args.snapshot?.currentExecutionMode),
    currentRunId: refs.currentRunId,
    currentRunStatus: normalizeTaskStatusValue(args.snapshot?.currentExecutionStatus),
    currentRunStartedAt: null,
    currentRunFinishedAt: null,
    currentRunCandidateCount: null,
    currentRunPipelineStepCount: null,
    latestResultSummary:
      args.snapshot?.latestResultSummary ?? null,
    latestErrorText: args.snapshot?.latestErrorText ?? null,
    lastActivityAt: args.snapshot?.lastActivityAt ?? null,
  };
}

function resolveTaskSnapshotCountFields(args: MapTaskTreeNodeArgs) {
  return {
    activeCandidateCount: args.snapshot?.activeCandidateCount ?? 0,
    completedCandidateCount: 0,
    failedCandidateCount: 0,
    totalChainSteps: args.snapshot?.totalChainSteps ?? 0,
    completedChainSteps: args.snapshot?.completedChainSteps ?? 0,
    winnerNodeId: null,
  };
}

function resolveTaskExecutionFields(
  args: MapTaskTreeNodeArgs,
  refs: ReturnType<typeof resolveTaskReferenceIds>,
  strategyFields: ReturnType<typeof resolveTaskStrategyFields>,
) {
  return {
    ...resolveTaskRunFields(args, refs, strategyFields),
    ...resolveTaskSnapshotCountFields(args),
  };
}

async function loadTaskDomainMaps(taskIds: string[]) {
  if (taskIds.length === 0) {
    return {
      aggregates: new Map<string, TaskAggregateRow>(),
      snapshots: new Map<string, TaskSnapshotRow>(),
      sessionRuntimeIds: new Map<string, string>(),
    };
  }

  const [aggregateRows, snapshotRows] = await Promise.all([
    db.select().from(tasks).where(inArray(tasks.id, taskIds)),
    db.select().from(taskSnapshots).where(inArray(taskSnapshots.taskId, taskIds)),
  ]);

  const sessionIds = Array.from(
    new Set(
      snapshotRows
        .map((row) => row.currentSessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ),
  );
  const sessionRows =
    sessionIds.length > 0
      ? await db
          .select({ id: taskSessions.id, runtimeSessionId: taskSessions.runtimeSessionId })
          .from(taskSessions)
          .where(inArray(taskSessions.id, sessionIds))
      : [];

  return {
    aggregates: new Map(aggregateRows.map((row) => [row.id, row] as const)),
    snapshots: new Map(snapshotRows.map((row) => [row.taskId, row] as const)),
    sessionRuntimeIds: new Map(
      sessionRows.map((row) => [row.id, row.runtimeSessionId ?? row.id] as const),
    ),
  };
}

async function loadTaskReferenceMaps(
  taskRecords: Array<{ repoId: string | null; credentialId: string | null }>,
) {
  const repoIds = Array.from(
    new Set(taskRecords.map((record) => record.repoId).filter(Boolean)),
  ) as string[];
  const credentialIds = Array.from(
    new Set(taskRecords.map((record) => record.credentialId).filter(Boolean)),
  ) as string[];

  const [repoRows, credentialRows] = await Promise.all([
    repoIds.length > 0
      ? db.select().from(repositories).where(inArray(repositories.id, repoIds))
      : Promise.resolve([] as Array<typeof repositories.$inferSelect>),
    credentialIds.length > 0
      ? db
          .select()
          .from(repositoryCredentials)
          .where(inArray(repositoryCredentials.id, credentialIds))
      : Promise.resolve([] as Array<typeof repositoryCredentials.$inferSelect>),
  ]);

  return {
    repos: new Map(repoRows.map((row) => [row.id, row] as const)),
    credentials: new Map(credentialRows.map((row) => [row.id, row] as const)),
  };
}

function mapTaskTreeNodeToTaskRecord(args: MapTaskTreeNodeArgs): TaskTreeRecord {
  const refs = resolveTaskReferenceIds(args);
  const strategyFields = resolveTaskStrategyFields(args);

  return {
    ...resolveTaskIdentityFields(args),
    ...resolveTaskExecutionFields(args, refs, strategyFields),
    ...resolveTaskRepositoryFields(args, refs),
  };
}

async function queryTaskTreeNodes(args: { taskIds?: string[]; projectIds?: string[] }) {
  const conditions = [eq(projectTreeNodes.nodeType, "task")];
  if (args.taskIds && args.taskIds.length > 0) {
    conditions.push(inArray(projectTreeNodes.id, args.taskIds));
  }
  if (args.projectIds && args.projectIds.length > 0) {
    conditions.push(inArray(projectTreeNodes.projectId, args.projectIds));
  }

  return db
    .select()
    .from(projectTreeNodes)
    .where(and(...conditions))
    .orderBy(desc(projectTreeNodes.createdAt));
}

export async function loadExistingTaskTreeNodeIdsByProjectIds(projectIds: string[]) {
  if (projectIds.length === 0) {
    return [] as string[];
  }

  const rows = await db
    .select({ id: projectTreeNodes.id })
    .from(projectTreeNodes)
    .where(
      and(eq(projectTreeNodes.nodeType, "task"), inArray(projectTreeNodes.projectId, projectIds)),
    )
    .orderBy(desc(projectTreeNodes.createdAt));

  return rows.map((row) => row.id);
}

export async function listTaskTreeRecords(args: {
  projectId?: string;
  status?: string;
  repoId?: string;
  limit: number;
}): Promise<TaskTreeRecord[]> {
  let taskIds: string[] | undefined;

  if (args.projectId || args.status || args.repoId) {
    const statusFilter = args.status
      ? (() => {
          // Map old-style status to lifecycle + execution status filter
          const lifecycleStatus =
            args.status === "completed"
              ? "done"
              : args.status === "cancelled"
                ? "archived"
                : args.status === "pending"
                  ? "draft"
                  : "active";
          return eq(taskSnapshots.lifecycleStatus, lifecycleStatus);
        })()
      : undefined;

    if (args.status) {
      // When filtering by status, join snapshots
      const snapshotRows = await db
        .select({ id: taskSnapshots.taskId })
        .from(taskSnapshots)
        .innerJoin(tasks, eq(tasks.id, taskSnapshots.taskId))
        .where(
          and(
            statusFilter,
            ...(args.projectId ? [eq(tasks.projectId, args.projectId)] : []),
            ...(args.repoId ? [eq(tasks.repoId, args.repoId)] : []),
          ),
        )
        .orderBy(desc(taskSnapshots.lastActivityAt))
        .limit(args.limit);

      taskIds = snapshotRows.map((row) => row.id);
    } else {
      const aggregateRows = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            ...(args.projectId ? [eq(tasks.projectId, args.projectId)] : []),
            ...(args.repoId ? [eq(tasks.repoId, args.repoId)] : []),
          ),
        )
        .orderBy(desc(tasks.createdAt))
        .limit(args.limit);

      taskIds = aggregateRows.map((row) => row.id);
    }

    if (taskIds.length === 0) {
      return [];
    }
  }

  const treeRows = await db
    .select()
    .from(projectTreeNodes)
    .where(
      and(
        eq(projectTreeNodes.nodeType, "task"),
        ...(args.projectId && !taskIds ? [eq(projectTreeNodes.projectId, args.projectId)] : []),
        ...(taskIds ? [inArray(projectTreeNodes.id, taskIds)] : []),
      ),
    )
    .orderBy(desc(projectTreeNodes.createdAt))
    .limit(args.limit);

  const domainMaps = await loadTaskDomainMaps(treeRows.map((row) => row.id));
  const mergedRecords = treeRows.map((row) => ({
    repoId: domainMaps.aggregates.get(row.id)?.repoId ?? null,
    credentialId: domainMaps.aggregates.get(row.id)?.credentialId ?? null,
  }));
  const maps = await loadTaskReferenceMaps(mergedRecords);

  return treeRows.map((row) =>
    mapTaskTreeNodeToTaskRecord({
      node: row,
      aggregate: domainMaps.aggregates.get(row.id),
      snapshot: domainMaps.snapshots.get(row.id),
      sessionRuntimeIds: domainMaps.sessionRuntimeIds,
      repos: maps.repos,
      credentials: maps.credentials,
    }),
  );
}

export async function loadTaskTreeRecords(args: {
  taskIds?: string[];
  projectIds?: string[];
}): Promise<TaskTreeRecord[]> {
  if (
    (!args.taskIds || args.taskIds.length === 0) &&
    (!args.projectIds || args.projectIds.length === 0)
  ) {
    return [];
  }

  const treeRows = await queryTaskTreeNodes(args);
  const domainMaps = await loadTaskDomainMaps(treeRows.map((row) => row.id));
  const maps = await loadTaskReferenceMaps(
    treeRows.map((row) => ({
      repoId: domainMaps.aggregates.get(row.id)?.repoId ?? null,
      credentialId: domainMaps.aggregates.get(row.id)?.credentialId ?? null,
    })),
  );

  return treeRows.map((row) =>
    mapTaskTreeNodeToTaskRecord({
      node: row,
      aggregate: domainMaps.aggregates.get(row.id),
      snapshot: domainMaps.snapshots.get(row.id),
      sessionRuntimeIds: domainMaps.sessionRuntimeIds,
      repos: maps.repos,
      credentials: maps.credentials,
    }),
  );
}

export async function loadTaskTreeRecordMap(taskIds: string[]) {
  const rows = await loadTaskTreeRecords({ taskIds });
  return new Map(rows.map((row) => [row.id, row] as const));
}

export async function loadTaskTreeRecord(taskId: string) {
  const rows = await loadTaskTreeRecords({ taskIds: [taskId] });
  return rows[0] ?? null;
}
