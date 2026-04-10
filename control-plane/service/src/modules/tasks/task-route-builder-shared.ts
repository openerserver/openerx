import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { taskSessions } from "../../db/schema";
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
import { createTaskPhaseWriteApi } from "./task-phase-write-api";
import { resolvePublicTaskSessionSourceType } from "./task-session-public-source-type";
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
  return resolvePublicTaskSessionSourceType({
    sourceType: null,
    sessionKind: session.sessionKind,
    parentSessionId: session.parentSessionId,
    forkedFromMessageId: session.forkedFromMessageId,
    candidateIndex: session.candidateIndex,
    executionModeSnapshot: session.executionModeSnapshot,
    phaseId: session.phaseId,
  });
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
    phaseId: session.phaseId,
    phaseRole: session.phaseRole,
    phaseItemIndex: session.phaseItemIndex,
    candidateIndex: session.candidateIndex,
    stepIndex: session.stepIndex,
    selectedModel: session.selectedModel,
    operationId: session.operationId,
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

async function appendTaskDomainEvent(args: {
  projectId: string;
  taskId: string;
  runId?: string | null;
  runNodeId?: string | null;
  sessionId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}) {
  const projector = await import("./task-domain-projector");
  return projector.appendTaskDomainEvent(args);
}

/**
 * Resolve taskId + projectId from a runtime session ID.
 * Checks task_sessions unique index on runtime_session_id.
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
    appendTaskDomainEvent,
    replayTaskDomainProjections,
    replayTaskDomainProjectionsByProject,
  };

  const aggregateSyncApi = createTaskAggregateSyncApi();

  const snapshotReadApi = createTaskSnapshotReadApi({
    loadTaskTreeBackedRecord: sharedDeps.loadTaskTreeBackedRecord,
  });
  const phaseWriteApi = createTaskPhaseWriteApi({
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
    phaseWriteApi,
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
