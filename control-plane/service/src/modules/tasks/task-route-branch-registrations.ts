import { createTaskBranchWriteApi } from "./task-branch-write";
import type { buildTaskRouteBuilderShared } from "./task-route-builder-shared";

export function buildTaskBranchCompatRegistrations(
  shared: ReturnType<typeof buildTaskRouteBuilderShared>,
) {
  const branchWriteApi = createTaskBranchWriteApi({
    loadTaskTreeBackedRecord: shared.sharedDeps.loadTaskTreeBackedRecord,
    resolveTaskBranchCompatRecord: shared.sharedDeps.resolveTaskBranchCompatRecord,
    resolveTaskBranchCompatRecordByRuntimeSessionId:
      shared.sharedDeps.resolveTaskBranchCompatRecordByRuntimeSessionId,
    syncTaskBranchCompatTreeNode: shared.sharedDeps.syncTaskBranchCompatTreeNode,
    archiveTaskBranchCompatTreeNode: shared.sharedDeps.archiveTaskBranchCompatTreeNode,
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
    listTaskBranchCompatTreeRecords: shared.sharedDeps.listTaskBranchCompatTreeRecords,
    buildTaskBranchCompatMessagesResponse:
      shared.sharedDeps.buildTaskBranchCompatMessagesResponse,
    buildTaskBranchCompatEventsResponse: shared.sharedDeps.buildTaskBranchCompatEventsResponse,
    buildTaskBranchCompatTimelineResponse:
      shared.sharedDeps.buildTaskBranchCompatTimelineResponse,
    upsertTaskBranch: branchWriteApi.upsertTaskBranch,
    persistTaskBranchMessage: branchWriteApi.persistTaskBranchMessage,
    activateTaskBranch: branchWriteApi.activateTaskBranch,
    archiveTaskBranch: branchWriteApi.archiveTaskBranch,
  };
}
