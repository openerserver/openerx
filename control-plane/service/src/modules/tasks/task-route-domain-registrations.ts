import { createTaskDomainRunAdoptionApi } from "./task-domain-run-adoption";
import type { buildTaskRouteBuilderShared } from "./task-route-builder-shared";

export function buildTaskDomainRegistrations(
  shared: ReturnType<typeof buildTaskRouteBuilderShared>,
) {
  const domainRunAdoptionApi = createTaskDomainRunAdoptionApi({
    loadTaskTreeBackedRecord: shared.sharedDeps.loadTaskTreeBackedRecord,
    resolveConversationTimelineSessionId: shared.runWriteApi.resolveConversationTimelineSessionId,
    appendTaskDomainEvent: shared.sharedDeps.appendTaskDomainEvent,
    buildTaskTreeSnapshotFromRecord: shared.sharedDeps.buildTaskTreeSnapshotFromRecord,
    upsertTaskTreeNode: shared.sharedDeps.upsertTaskTreeNode,
    syncTaskAggregateFromSnapshot: shared.aggregateSyncApi.syncTaskAggregateFromSnapshot,
  });

  return {
    adoptDomainRunCandidate: domainRunAdoptionApi.adoptDomainRunCandidate,
  };
}
