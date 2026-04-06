import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { taskSessions, tasks } from "../../db/schema";
import {
  archiveTaskBranchCompatTreeNode,
  upsertTaskBranchCompatTreeNode,
  upsertTaskTreeNode,
} from "../project-tree/storage";
import { loadTaskTreeRecord } from "../project-tree/task-view";
import { createTaskOperationWriteApi } from "./session-operation-write-api";
import { buildTaskTreeSnapshotFromRecord, createTaskAggregateSyncApi } from "./task-aggregate-sync";
import { createTaskArtifactWriteApi } from "./task-artifact-write-api";
import { createTaskBranchWriteApi } from "./task-branch-write";
import { createTaskSessionMessageApi } from "./task-session-message-api";
import { createTaskSessionMessageWriteApi } from "./task-session-message-write-api";
import { createTaskSessionReadApi } from "./task-session-read";
import { createTaskSessionWriteApi } from "./task-session-write-api";
import { createTaskSnapshotReadApi } from "./task-snapshot-read";
import { createTaskUsageLedgerWriteApi } from "./task-usage-ledger-write-api";

async function loadTaskTreeBackedRecord(taskId: string) {
  return loadTaskTreeRecord(taskId);
}

function mapTaskSessionSourceType(session: typeof taskSessions.$inferSelect) {
  if (session.sessionKind === "manual_branch") {
    return "fork" as const;
  }
  if (session.sessionKind === "resume") {
    return "sub_session" as const;
  }
  return "root" as const;
}

function stripTaskSessionWritePrefix(taskId: string, sessionId: string | null) {
  if (!sessionId) {
    return null;
  }

  const prefix = `task-session:${taskId}:`;
  return sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : sessionId;
}

function mapTaskSessionCompatRecord(session: typeof taskSessions.$inferSelect) {
  return {
    runtimeSessionId: session.runtimeSessionId ?? session.id,
    parentRuntimeSessionId: stripTaskSessionWritePrefix(session.taskId, session.parentSessionId),
    forkedFromMessageId: session.forkedFromMessageId,
    branchName: session.branchName,
    sourceType: mapTaskSessionSourceType(session),
    sessionKind: session.sessionKind,
    executionModeSnapshot: session.executionModeSnapshot,
    candidateIndex: session.candidateIndex,
    stepIndex: session.stepIndex,
    selectedModel: session.selectedModel,
    isActive: session.executionStatus === "running" && !session.archivedAt,
  };
}

async function resolveTaskSessionRecord(taskId: string, projectId: string, sessionId: string) {
  const session = await db.query.taskSessions.findFirst({
    where: and(
      eq(taskSessions.id, sessionId),
      eq(taskSessions.taskId, taskId),
      eq(taskSessions.projectId, projectId),
    ),
  });

  return session ? mapTaskSessionCompatRecord(session) : null;
}

async function resolveTaskSessionRecordByRuntimeSessionId(
  taskId: string,
  projectId: string,
  runtimeSessionId: string,
) {
  const session = await db.query.taskSessions.findFirst({
    where: and(
      eq(taskSessions.runtimeSessionId, runtimeSessionId),
      eq(taskSessions.taskId, taskId),
      eq(taskSessions.projectId, projectId),
    ),
  });

  return session ? mapTaskSessionCompatRecord(session) : null;
}

async function replayTaskDomainProjections(taskId: string) {
  const projector = await import("./task-domain-projector");
  return projector.replayTaskDomainProjections(taskId);
}

async function replayTaskDomainProjectionsByProject(projectId: string) {
  const projector = await import("./task-domain-projector");
  return projector.replayTaskDomainProjectionsByProject(projectId);
}

/**
 * Resolve taskId + projectId from a runtime session ID.
 * Checks task_sessions first (unique index on runtime_session_id),
 * then falls back to tasks.current_session_id (legacy).
 */
export async function resolveTaskByRuntimeSessionId(
  runtimeSessionId: string,
): Promise<{ taskId: string; projectId: string } | null> {
  const session = await db.query.taskSessions.findFirst({
    where: eq(taskSessions.runtimeSessionId, runtimeSessionId),
    columns: { taskId: true, projectId: true },
  });
  if (session) {
    return { taskId: session.taskId, projectId: session.projectId };
  }

  const task = await db.query.tasks.findFirst({
    where: eq(tasks.currentSessionId, runtimeSessionId),
    columns: { id: true, projectId: true },
  });
  if (task) {
    return { taskId: task.id, projectId: task.projectId };
  }

  return null;
}

export function buildTaskRouteBuilderShared() {
  const sharedDeps = {
    loadTaskTreeBackedRecord,
    buildTaskTreeSnapshotFromRecord,
    upsertTaskTreeNode,
    syncTaskBranchCompatTreeNode: upsertTaskBranchCompatTreeNode,
    archiveTaskBranchCompatTreeNode,
    resolveTaskSessionRecord,
    resolveTaskSessionRecordByRuntimeSessionId,
    replayTaskDomainProjections,
    replayTaskDomainProjectionsByProject,
  };

  const aggregateSyncApi = createTaskAggregateSyncApi();

  const snapshotReadApi = createTaskSnapshotReadApi({
    loadTaskTreeBackedRecord: sharedDeps.loadTaskTreeBackedRecord,
  });

  const taskUsageLedgerWriteApi = createTaskUsageLedgerWriteApi();
  const taskArtifactWriteApi = createTaskArtifactWriteApi();
  const sessionWriteApi = createTaskSessionWriteApi();
  const sessionMessageWriteApi = createTaskSessionMessageWriteApi({
    upsertTaskSessionRecord: sessionWriteApi.upsertTaskSessionRecord,
    resolveTaskSessionRecordByRuntimeSessionId:
      sharedDeps.resolveTaskSessionRecordByRuntimeSessionId,
  });
  const sessionMessageApi = createTaskSessionMessageApi({
    loadTaskTreeBackedRecord: sharedDeps.loadTaskTreeBackedRecord,
    upsertTaskSessionMessageRecord: sessionMessageWriteApi.upsertTaskSessionMessageRecord,
  });
  const taskOperationWriteApi = createTaskOperationWriteApi({
    upsertTaskSessionRecord: sessionWriteApi.upsertTaskSessionRecord,
    buildTaskTreeSnapshotFromRecord: sharedDeps.buildTaskTreeSnapshotFromRecord,
    syncTaskAggregateFromSnapshot: aggregateSyncApi.syncTaskAggregateFromSnapshot,
    appendTaskUsageLedgerEntry: taskUsageLedgerWriteApi.appendTaskUsageLedgerEntry,
  });
  const sessionReadApi = createTaskSessionReadApi({
    loadTaskTreeBackedRecord: sharedDeps.loadTaskTreeBackedRecord,
  });
  const branchWriteApi = createTaskBranchWriteApi({
    loadTaskTreeBackedRecord: sharedDeps.loadTaskTreeBackedRecord,
    resolveTaskBranchCompatRecord: sharedDeps.resolveTaskSessionRecord,
    resolveTaskBranchCompatRecordByRuntimeSessionId:
      sharedDeps.resolveTaskSessionRecordByRuntimeSessionId,
    syncTaskBranchCompatTreeNode: sharedDeps.syncTaskBranchCompatTreeNode,
    archiveTaskBranchCompatTreeNode: sharedDeps.archiveTaskBranchCompatTreeNode,
    upsertConversationSessionRecord: sessionWriteApi.upsertTaskSessionRecord,
    upsertConversationMessageRecord: sessionMessageWriteApi.upsertTaskSessionMessageRecord,
    buildTaskTreeSnapshotFromRecord: sharedDeps.buildTaskTreeSnapshotFromRecord,
    upsertTaskTreeNode: sharedDeps.upsertTaskTreeNode,
    syncTaskAggregateFromSnapshot: aggregateSyncApi.syncTaskAggregateFromSnapshot,
  });

  return {
    sharedDeps,
    aggregateSyncApi,
    snapshotReadApi,
    sessionWriteApi,
    sessionMessageApi,
    sessionMessageWriteApi,
    taskOperationWriteApi,
    sessionReadApi,
    branchWriteApi,
    taskArtifactWriteApi,
    taskUsageLedgerWriteApi,
  };
}
