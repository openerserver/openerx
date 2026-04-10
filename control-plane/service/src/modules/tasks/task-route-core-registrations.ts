import { createTaskCreationApi } from "./task-create";
import type { buildTaskRouteBuilderShared } from "./task-route-builder-shared";
import { buildTaskUpdates } from "./task-status-update";

export function buildTaskCoreRegistrations(shared: ReturnType<typeof buildTaskRouteBuilderShared>) {
  const taskCreationApi = createTaskCreationApi({
    syncTaskAggregateFromSnapshot: shared.aggregateSyncApi.syncTaskAggregateFromSnapshot,
    appendTaskDomainEvent: shared.sharedDeps.appendTaskDomainEvent,
  });

  return {
    validateTaskCreateInput: taskCreationApi.validateTaskCreateInput,
    insertTask: taskCreationApi.insertTask,
    recordTaskCreatedAudit: taskCreationApi.recordTaskCreatedAudit,
    loadTaskTreeBackedRecord: shared.sharedDeps.loadTaskTreeBackedRecord,
    buildTaskUpdates,
    buildTaskTreeSnapshotFromRecord: shared.sharedDeps.buildTaskTreeSnapshotFromRecord,
    upsertTaskTreeNode: shared.sharedDeps.upsertTaskTreeNode,
    syncTaskAggregateFromSnapshot: shared.aggregateSyncApi.syncTaskAggregateFromSnapshot,
    upsertConversationSessionRecord: shared.sessionWriteApi.upsertTaskSessionRecord,
  };
}

export function buildTaskAgentRunWriteRegistrations(
  shared: ReturnType<typeof buildTaskRouteBuilderShared>,
) {
  return {
    loadTaskTreeBackedRecord: shared.sharedDeps.loadTaskTreeBackedRecord,
    syncExecutionFactsForAgentRun: shared.taskOperationWriteApi.syncExecutionFactsForAgentRun,
  };
}
