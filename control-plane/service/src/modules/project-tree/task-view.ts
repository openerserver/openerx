import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  projectTreeNodes,
  repositories,
  repositoryCredentials,
} from "../../db/schema";
import type {
  TaskCategory,
  TaskChangesSummary,
  TaskExecutionMode,
  TaskStatus,
} from "./task-types";

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
  executionPlan: string | null;
  parallelRunHistory: string | null;
  autoAdvanceStages: boolean;
  credentialId: string | null;
  gitAuthorName: string | null;
  gitAuthorEmail: string | null;
  gitCommitterName: string | null;
  gitCommitterEmail: string | null;
  finalCommitSha: string | null;
  finalBranchName: string | null;
  changesSummary: TaskChangesSummary | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  repoName: string | null;
  remoteUrl: string | null;
  credentialLabel: string | null;
}

function parseTaskTreeContent(content: unknown) {
  const record = content && typeof content === "object" ? (content as Record<string, unknown>) : {};

  return {
    userId: typeof record.userId === "string" ? record.userId : null,
    prompt: typeof record.prompt === "string" ? record.prompt : "",
    status: (
      record.status === "pending" ||
      record.status === "running" ||
      record.status === "paused" ||
      record.status === "completed" ||
      record.status === "failed" ||
      record.status === "cancelled"
        ? record.status
        : "pending") as TaskStatus,
    sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
    agentRunId: typeof record.agentRunId === "string" ? record.agentRunId : null,
    result: typeof record.result === "string" ? record.result : null,
    category: (
      record.category === "quick" ||
      record.category === "deep" ||
      record.category === "ops" ||
      record.category === "security" ||
      record.category === "architecture"
        ? record.category
        : null) as TaskCategory | null,
    strategy: record.strategy ?? null,
    repoId: typeof record.repoId === "string" ? record.repoId : null,
    workspaceRoot: typeof record.workspaceRoot === "string" ? record.workspaceRoot : null,
    baseRevision: typeof record.baseRevision === "string" ? record.baseRevision : null,
    workingBranch: typeof record.workingBranch === "string" ? record.workingBranch : null,
    selectedModel: typeof record.selectedModel === "string" ? record.selectedModel : null,
    executionMode: (
      record.executionMode === "single" ||
      record.executionMode === "parallel" ||
      record.executionMode === "sequential-chain"
        ? record.executionMode
        : null) as TaskExecutionMode | null,
    executionPlan: typeof record.executionPlan === "string" ? record.executionPlan : null,
    parallelRunHistory:
      typeof record.parallelRunHistory === "string" ? record.parallelRunHistory : null,
    autoAdvanceStages:
      typeof record.autoAdvanceStages === "boolean" ? record.autoAdvanceStages : false,
    credentialId: typeof record.credentialId === "string" ? record.credentialId : null,
    gitAuthorName: typeof record.gitAuthorName === "string" ? record.gitAuthorName : null,
    gitAuthorEmail: typeof record.gitAuthorEmail === "string" ? record.gitAuthorEmail : null,
    gitCommitterName:
      typeof record.gitCommitterName === "string" ? record.gitCommitterName : null,
    gitCommitterEmail:
      typeof record.gitCommitterEmail === "string" ? record.gitCommitterEmail : null,
    finalCommitSha: typeof record.finalCommitSha === "string" ? record.finalCommitSha : null,
    finalBranchName: typeof record.finalBranchName === "string" ? record.finalBranchName : null,
    changesSummary:
      record.changesSummary && typeof record.changesSummary === "object"
        ? (record.changesSummary as TaskChangesSummary)
        : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
    startedAt: typeof record.startedAt === "string" ? record.startedAt : null,
    finishedAt: typeof record.finishedAt === "string" ? record.finishedAt : null,
  };
}

async function loadTaskReferenceMaps(taskRecords: Array<ReturnType<typeof parseTaskTreeContent>>) {
  const repoIds = Array.from(new Set(taskRecords.map((record) => record.repoId).filter(Boolean))) as string[];
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

function mapTaskTreeNodeToTaskRecord(args: {
  node: typeof projectTreeNodes.$inferSelect;
  repos: Map<string, typeof repositories.$inferSelect>;
  credentials: Map<string, typeof repositoryCredentials.$inferSelect>;
}): TaskTreeRecord {
  const content = parseTaskTreeContent(args.node.contentJson);
  const repo = content.repoId ? args.repos.get(content.repoId) : undefined;
  const credential = content.credentialId ? args.credentials.get(content.credentialId) : undefined;

  return {
    id: args.node.id,
    projectId: args.node.projectId,
    userId: content.userId,
    title: args.node.contentText ?? args.node.id,
    prompt: content.prompt,
    status: content.status,
    sessionId: content.sessionId,
    agentRunId: content.agentRunId,
    result: content.result,
    category: content.category,
    strategy: content.strategy,
    repoId: content.repoId,
    workspaceRoot: content.workspaceRoot,
    baseRevision: content.baseRevision,
    workingBranch: content.workingBranch,
    selectedModel: content.selectedModel,
    executionMode: content.executionMode,
    executionPlan: content.executionPlan,
    parallelRunHistory: content.parallelRunHistory,
    autoAdvanceStages: content.autoAdvanceStages,
    credentialId: content.credentialId,
    gitAuthorName: content.gitAuthorName,
    gitAuthorEmail: content.gitAuthorEmail,
    gitCommitterName: content.gitCommitterName,
    gitCommitterEmail: content.gitCommitterEmail,
    finalCommitSha: content.finalCommitSha,
    finalBranchName: content.finalBranchName,
    changesSummary: content.changesSummary,
    createdAt: content.createdAt ?? args.node.createdAt,
    startedAt: content.startedAt,
    finishedAt: content.finishedAt,
    repoName: repo?.name ?? null,
    remoteUrl: repo?.remoteUrl ?? null,
    credentialLabel: credential?.label ?? null,
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
      and(
        eq(projectTreeNodes.nodeType, "task"),
        inArray(projectTreeNodes.projectId, projectIds),
      ),
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
  const treeRows = await db
    .select()
    .from(projectTreeNodes)
    .where(
      and(
        eq(projectTreeNodes.nodeType, "task"),
        ...(args.projectId ? [eq(projectTreeNodes.projectId, args.projectId)] : []),
        ...(args.status
          ? [sql<boolean>`${projectTreeNodes.contentJson} ->> 'status' = ${args.status}`]
          : []),
        ...(args.repoId
          ? [sql<boolean>`${projectTreeNodes.contentJson} ->> 'repoId' = ${args.repoId}`]
          : []),
      ),
    )
    .orderBy(desc(projectTreeNodes.createdAt))
    .limit(args.limit);

  const parsedRecords = treeRows.map((row) => parseTaskTreeContent(row.contentJson));
  const maps = await loadTaskReferenceMaps(parsedRecords);

  return treeRows.map((row) =>
    mapTaskTreeNodeToTaskRecord({ node: row, repos: maps.repos, credentials: maps.credentials }),
  );
}

export async function loadTaskTreeRecords(args: {
  taskIds?: string[];
  projectIds?: string[];
}): Promise<TaskTreeRecord[]> {
  if ((!args.taskIds || args.taskIds.length === 0) && (!args.projectIds || args.projectIds.length === 0)) {
    return [];
  }

  const treeRows = await queryTaskTreeNodes(args);
  const parsedRecords = treeRows.map((row) => parseTaskTreeContent(row.contentJson));
  const maps = await loadTaskReferenceMaps(parsedRecords);

  return treeRows.map((row) =>
    mapTaskTreeNodeToTaskRecord({ node: row, repos: maps.repos, credentials: maps.credentials }),
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