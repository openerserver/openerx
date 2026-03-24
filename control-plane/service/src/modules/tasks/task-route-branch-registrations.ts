import { createTaskBranchWriteApi } from "./task-branch-write";
import type { buildTaskRouteBuilderShared } from "./task-route-builder-shared";

export function buildTaskBranchRegistrations(
  shared: ReturnType<typeof buildTaskRouteBuilderShared>,
) {
  const branchWriteApi = createTaskBranchWriteApi({
    loadTaskTreeBackedRecord: shared.sharedDeps.loadTaskTreeBackedRecord,
    resolveTaskSessionRecord: shared.sharedDeps.resolveTaskSessionRecord,
    resolveTaskSessionRecordByRuntimeSessionId:
      shared.sharedDeps.resolveTaskSessionRecordByRuntimeSessionId,
    upsertTaskSessionTreeNode: shared.sharedDeps.syncTaskSessionTreeNode,
    archiveTaskSessionTreeNode: shared.sharedDeps.archiveTaskSessionTreeNode,
    upsertConversationSessionRecord:
      shared.conversationSessionSyncApi.upsertConversationSessionRecord,
    upsertConversationMessageRecord:
      shared.conversationMessageSyncApi.upsertConversationMessageRecord,
    buildTaskTreeSnapshotFromRecord: shared.sharedDeps.buildTaskTreeSnapshotFromRecord,
    upsertTaskTreeNode: shared.sharedDeps.upsertTaskTreeNode,
    syncTaskAggregateFromSnapshot: shared.aggregateSyncApi.syncTaskAggregateFromSnapshot,
  });

  return {
    loadTaskTreeBackedRecord: shared.sharedDeps.loadTaskTreeBackedRecord,
    listTaskSessionTreeRecords: shared.sharedDeps.listTaskSessionTreeRecords,
    buildTaskSessionMessagesResponse: shared.sharedDeps.buildTaskSessionMessagesResponse,
    buildTaskSessionEventsResponse: shared.sharedDeps.buildTaskSessionEventsResponse,
    buildTaskSessionTimelineResponse: shared.sharedDeps.buildTaskSessionTimelineResponse,
    upsertTaskBranch: branchWriteApi.upsertTaskBranch,
    persistTaskBranchMessage: branchWriteApi.persistTaskBranchMessage,
    activateTaskBranch: branchWriteApi.activateTaskBranch,
    archiveTaskBranch: branchWriteApi.archiveTaskBranch,
  };
}
