import {
  archiveTaskBranchCompatTreeNode,
  upsertTaskBranchCompatTreeNode,
  upsertTaskTreeNode,
} from "../project-tree/storage";
import { loadTaskTreeRecord } from "../project-tree/task-view";
import { buildTaskTreeSnapshotFromRecord, createTaskAggregateSyncApi } from "./task-aggregate-sync";
import { createTaskConversationMessageSyncApi } from "./task-conversation-message-sync";
import { createTaskConversationSessionSyncApi } from "./task-conversation-session-sync";
import {
  appendTaskDomainEvent,
  replayTaskDomainProjections,
  replayTaskDomainProjectionsByProject,
} from "./task-domain-projector";
import { createTaskRunWriteSyncApi } from "./task-run-write-sync";
import {
  buildTaskBranchCompatEventsResponse,
  buildTaskBranchCompatMessagesResponse,
  buildTaskBranchCompatTimelineResponse,
  listTaskBranchCompatTreeRecords,
  resolveTaskBranchCompatRecord,
  resolveTaskBranchCompatRecordByRuntimeSessionId,
} from "./task-branch-compat-read";
import { createTaskSnapshotReadApi } from "./task-snapshot-read";

async function loadTaskTreeBackedRecord(taskId: string) {
  return loadTaskTreeRecord(taskId);
}

export function buildTaskRouteBuilderShared() {
  const sharedDeps = {
    loadTaskTreeBackedRecord,
    appendTaskDomainEvent,
    buildTaskTreeSnapshotFromRecord,
    upsertTaskTreeNode,
    syncTaskBranchCompatTreeNode: upsertTaskBranchCompatTreeNode,
    archiveTaskBranchCompatTreeNode,
    resolveTaskBranchCompatRecord,
    resolveTaskBranchCompatRecordByRuntimeSessionId,
    buildTaskBranchCompatMessagesResponse,
    buildTaskBranchCompatEventsResponse,
    buildTaskBranchCompatTimelineResponse,
    listTaskBranchCompatTreeRecords,
    replayTaskDomainProjections,
    replayTaskDomainProjectionsByProject,
  };

  const runWriteApi = createTaskRunWriteSyncApi({
    appendTaskDomainEvent: sharedDeps.appendTaskDomainEvent,
  });

  const aggregateSyncApi = createTaskAggregateSyncApi({
    appendTaskDomainEvent: sharedDeps.appendTaskDomainEvent,
    resolveConversationTimelineSessionId: runWriteApi.resolveConversationTimelineSessionId,
  });

  const snapshotReadApi = createTaskSnapshotReadApi({
    loadTaskTreeBackedRecord: sharedDeps.loadTaskTreeBackedRecord,
  });

  const conversationMessageSyncApi = createTaskConversationMessageSyncApi({
    appendTaskDomainEvent: sharedDeps.appendTaskDomainEvent,
  });

  const conversationSessionSyncApi = createTaskConversationSessionSyncApi({
    appendTaskDomainEvent: sharedDeps.appendTaskDomainEvent,
  });

  return {
    sharedDeps,
    runWriteApi,
    aggregateSyncApi,
    snapshotReadApi,
    conversationMessageSyncApi,
    conversationSessionSyncApi,
  };
}
