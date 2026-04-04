import { eq } from "drizzle-orm";
import { db } from "../../db";
import { taskSessions, taskSnapshots, tasks as taskAggregates } from "../../db/schema";
import type { TaskTreeSnapshot } from "../project-tree/storage";
import type { TaskTreeRecord } from "../project-tree/task-view";

/**
 * Maps old task status values to the DB enum `task_lifecycle_status`.
 * Matches the migration 0022 CASE logic:
 *   completed → done, NULL → draft, everything else → active
 */
function toLifecycleStatus(
  status: string | null | undefined,
): "draft" | "active" | "done" | "archived" {
  if (!status) return "draft";
  if (status === "completed") return "done";
  return "active";
}

type TaskSnapshotCreateInput = {
  projectId: string;
  title: string;
  prompt: string;
  repoId?: string | null;
  workingBranch?: string | null;
  selectedModel?: string | null;
  credentialId?: string | null;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
  gitCommitterName?: string | null;
  gitCommitterEmail?: string | null;
};

export function buildTaskAggregateStrategyJson(
  strategy: TaskTreeSnapshot["strategy"],
  options?: {
    executionMode?: TaskTreeSnapshot["executionMode"];
    autoAdvanceStages?: boolean;
  },
) {
  let next: Record<string, unknown> | null = null;

  if (strategy && typeof strategy === "object" && !Array.isArray(strategy)) {
    next = { ...strategy };
  } else if (typeof strategy === "string" && strategy.trim()) {
    try {
      const parsed = JSON.parse(strategy) as unknown;
      next =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? ({ ...(parsed as Record<string, unknown>) } as Record<string, unknown>)
          : { value: strategy };
    } catch {
      next = { value: strategy };
    }
  }

  if (options?.executionMode) {
    next = { ...(next ?? {}), executionMode: options.executionMode };
  }

  if (options?.autoAdvanceStages) {
    next = { ...(next ?? {}), autoAdvanceStages: true };
  } else if (next && Object.prototype.hasOwnProperty.call(next, "autoAdvanceStages")) {
    next.autoAdvanceStages = undefined;
  }

  return next ?? {};
}

function buildTaskAggregateChangesSummaryJson(
  changesSummary: TaskTreeSnapshot["changesSummary"],
) {
  return changesSummary ? ({ ...changesSummary } as Record<string, unknown>) : null;
}

function resolveSnapshotStrategy(
  task: TaskTreeRecord,
  updates: Record<string, unknown>,
): TaskTreeSnapshot["strategy"] {
  if (
    typeof updates.strategy === "string" ||
    updates.strategy === null ||
    (updates.strategy && typeof updates.strategy === "object" && !Array.isArray(updates.strategy))
  ) {
    return typeof updates.strategy === "object" && updates.strategy !== null
      ? (updates.strategy as Record<string, unknown>)
      : updates.strategy;
  }

  if (task.strategy && typeof task.strategy === "object" && !Array.isArray(task.strategy)) {
    return { ...(task.strategy as Record<string, unknown>) };
  }

  return typeof task.strategy === "string" || task.strategy === null ? task.strategy : null;
}

function resolveSnapshotIdentityFields(task: TaskTreeRecord, updates: Record<string, unknown>) {
  return {
    id: task.id,
    projectId: task.projectId,
    userId: task.userId,
    title: task.title,
    prompt: task.prompt,
    status: (updates.status as TaskTreeSnapshot["status"] | undefined) ?? task.status,
    sessionId: (updates.sessionId as string | undefined) ?? task.sessionId,
    agentRunId: (updates.agentRunId as string | undefined) ?? task.agentRunId,
    result: (updates.result as string | undefined) ?? task.result,
    category: (updates.category as TaskTreeSnapshot["category"] | undefined) ?? task.category,
    strategy: resolveSnapshotStrategy(task, updates),
  };
}

function resolveSnapshotExecutionFields(task: TaskTreeRecord, updates: Record<string, unknown>) {
  return {
    repoId: task.repoId,
    workspaceRoot: (updates.workspaceRoot as string | undefined) ?? task.workspaceRoot,
    baseRevision: (updates.baseRevision as string | undefined) ?? task.baseRevision,
    workingBranch: (updates.workingBranch as string | undefined) ?? task.workingBranch,
    selectedModel: (updates.selectedModel as string | null | undefined) ?? task.selectedModel,
    executionMode:
      (updates.executionMode as TaskTreeSnapshot["executionMode"] | undefined) ??
      task.executionMode,
    autoAdvanceStages: (updates.autoAdvanceStages as boolean | undefined) ?? task.autoAdvanceStages,
    credentialId: (updates.credentialId as string | undefined) ?? task.credentialId,
  };
}

function resolveSnapshotGitFields(task: TaskTreeRecord, updates: Record<string, unknown>) {
  return {
    gitAuthorName: (updates.gitAuthorName as string | undefined) ?? task.gitAuthorName,
    gitAuthorEmail: (updates.gitAuthorEmail as string | undefined) ?? task.gitAuthorEmail,
    gitCommitterName: (updates.gitCommitterName as string | undefined) ?? task.gitCommitterName,
    gitCommitterEmail: (updates.gitCommitterEmail as string | undefined) ?? task.gitCommitterEmail,
    finalCommitSha: (updates.finalCommitSha as string | undefined) ?? task.finalCommitSha,
    finalBranchName: (updates.finalBranchName as string | undefined) ?? task.finalBranchName,
    changesSummary:
      (updates.changesSummary as TaskTreeSnapshot["changesSummary"] | undefined) ??
      task.changesSummary,
  };
}

function resolveSnapshotTimingFields(task: TaskTreeRecord, updates: Record<string, unknown>) {
  return {
    createdAt: task.createdAt,
    startedAt: (updates.startedAt as string | undefined) ?? task.startedAt,
    finishedAt: Object.prototype.hasOwnProperty.call(updates, "finishedAt")
      ? (updates.finishedAt as string | null)
      : task.finishedAt,
  };
}

export function buildTaskTreeSnapshotFromCreateInput(
  userId: string,
  taskId: string,
  body: TaskSnapshotCreateInput,
): TaskTreeSnapshot {
  const now = new Date().toISOString();

  return {
    id: taskId,
    projectId: body.projectId,
    userId,
    title: body.title,
    prompt: body.prompt,
    status: "pending",
    sessionId: null,
    agentRunId: null,
    result: null,
    category: null,
    strategy: null,
    repoId: body.repoId ?? null,
    workspaceRoot: null,
    baseRevision: null,
    workingBranch: body.workingBranch ?? null,
    selectedModel: body.selectedModel ?? null,
    executionMode: null,
    autoAdvanceStages: false,
    credentialId: body.credentialId ?? null,
    gitAuthorName: body.gitAuthorName ?? null,
    gitAuthorEmail: body.gitAuthorEmail ?? null,
    gitCommitterName: body.gitCommitterName ?? null,
    gitCommitterEmail: body.gitCommitterEmail ?? null,
    finalCommitSha: null,
    finalBranchName: null,
    changesSummary: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
}

export function buildTaskTreeSnapshotFromRecord(
  task: TaskTreeRecord,
  updates: Record<string, unknown>,
): TaskTreeSnapshot {
  return {
    ...resolveSnapshotIdentityFields(task, updates),
    ...resolveSnapshotExecutionFields(task, updates),
    ...resolveSnapshotGitFields(task, updates),
    ...resolveSnapshotTimingFields(task, updates),
  };
}

export function createTaskAggregateSyncApi() {
  async function syncTaskAggregateFromSnapshot(snapshot: TaskTreeSnapshot) {
    const updatedAt = snapshot.finishedAt ?? snapshot.startedAt ?? new Date().toISOString();

    // Validate sessionId exists in task_sessions before writing to task_snapshots (FK constraint).
    // Legacy tasks may carry a current_session_id that was never migrated to task_sessions.
    let validatedSessionId = snapshot.sessionId;
    if (validatedSessionId) {
      const [existing] = await db
        .select({ id: taskSessions.id })
        .from(taskSessions)
        .where(eq(taskSessions.id, validatedSessionId))
        .limit(1);
      if (!existing) {
        validatedSessionId = null;
      }
    }

    await db
      .insert(taskAggregates)
      .values({
        id: snapshot.id,
        projectId: snapshot.projectId,
        treeNodeId: snapshot.id,
        createdByUserId: snapshot.userId,
        title: snapshot.title,
        prompt: snapshot.prompt,
        status: snapshot.status,
        category: snapshot.category,
        currentRunId: null,
        currentSessionId: snapshot.sessionId,
        currentAgentRunId: snapshot.agentRunId,
        latestResult: snapshot.result,
        latestResultSummary: snapshot.result,
        selectedModel: snapshot.selectedModel,
        repoId: snapshot.repoId,
        workspaceRoot: snapshot.workspaceRoot,
        baseRevision: snapshot.baseRevision,
        workingBranch: snapshot.workingBranch,
        credentialId: snapshot.credentialId,
        gitAuthorName: snapshot.gitAuthorName,
        gitAuthorEmail: snapshot.gitAuthorEmail,
        gitCommitterName: snapshot.gitCommitterName,
        gitCommitterEmail: snapshot.gitCommitterEmail,
        strategyJson: buildTaskAggregateStrategyJson(snapshot.strategy, {
          executionMode: snapshot.executionMode,
          autoAdvanceStages: snapshot.autoAdvanceStages,
        }),
        finalCommitSha: snapshot.finalCommitSha,
        finalBranchName: snapshot.finalBranchName,
          changesSummaryJson: buildTaskAggregateChangesSummaryJson(snapshot.changesSummary),
        createdAt: snapshot.createdAt,
        startedAt: snapshot.startedAt,
        finishedAt: snapshot.finishedAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: taskAggregates.id,
        set: {
          projectId: snapshot.projectId,
          treeNodeId: snapshot.id,
          createdByUserId: snapshot.userId,
          title: snapshot.title,
          prompt: snapshot.prompt,
          status: snapshot.status,
          category: snapshot.category,
          currentSessionId: snapshot.sessionId,
          currentAgentRunId: snapshot.agentRunId,
          latestResult: snapshot.result,
          latestResultSummary: snapshot.result,
          selectedModel: snapshot.selectedModel,
          repoId: snapshot.repoId,
          workspaceRoot: snapshot.workspaceRoot,
          baseRevision: snapshot.baseRevision,
          workingBranch: snapshot.workingBranch,
          credentialId: snapshot.credentialId,
          gitAuthorName: snapshot.gitAuthorName,
          gitAuthorEmail: snapshot.gitAuthorEmail,
          gitCommitterName: snapshot.gitCommitterName,
          gitCommitterEmail: snapshot.gitCommitterEmail,
          strategyJson: buildTaskAggregateStrategyJson(snapshot.strategy, {
            executionMode: snapshot.executionMode,
            autoAdvanceStages: snapshot.autoAdvanceStages,
          }),
          finalCommitSha: snapshot.finalCommitSha,
          finalBranchName: snapshot.finalBranchName,
            changesSummaryJson: buildTaskAggregateChangesSummaryJson(snapshot.changesSummary),
          startedAt: snapshot.startedAt,
          finishedAt: snapshot.finishedAt,
          updatedAt,
        },
      });

    await db
      .insert(taskSnapshots)
      .values({
        taskId: snapshot.id,
        projectId: snapshot.projectId,
        lifecycleStatus: toLifecycleStatus(snapshot.status),
        currentExecutionMode: snapshot.executionMode ?? null,
        currentExecutionStatus: null,
        currentSessionId: validatedSessionId,
        latestSessionId: validatedSessionId,
        latestResultSummary: snapshot.result,
        latestErrorText: null,
        activeCandidateCount: 0,
        totalChainSteps: 0,
        completedChainSteps: 0,
        lastActivityAt: updatedAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: taskSnapshots.taskId,
        set: {
          projectId: snapshot.projectId,
          lifecycleStatus: toLifecycleStatus(snapshot.status),
          currentExecutionMode: snapshot.executionMode ?? null,
          currentSessionId: validatedSessionId,
          latestSessionId: validatedSessionId,
          latestResultSummary: snapshot.result,
          lastActivityAt: updatedAt,
          updatedAt,
        },
      });
  }

  return {
    syncTaskAggregateFromSnapshot,
  };
}
