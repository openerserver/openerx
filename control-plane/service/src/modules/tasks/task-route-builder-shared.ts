import {
  archiveTaskSessionTreeNode,
  upsertTaskSessionTreeNode,
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
  buildTaskSessionEventsResponse,
  buildTaskSessionMessagesResponse,
  buildTaskSessionTimelineResponse,
  listTaskSessionTreeRecords,
  resolveTaskSessionRecord,
  resolveTaskSessionRecordByRuntimeSessionId,
} from "./task-session-read";
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
    syncTaskSessionTreeNode: upsertTaskSessionTreeNode,
    archiveTaskSessionTreeNode,
    resolveTaskSessionRecord,
    resolveTaskSessionRecordByRuntimeSessionId,
    buildTaskSessionMessagesResponse,
    buildTaskSessionEventsResponse,
    buildTaskSessionTimelineResponse,
    listTaskSessionTreeRecords,
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
