import { buildTaskProjectionTimelineViewResponse } from "./task-projection-read";
import type { buildTaskRouteBuilderShared } from "./task-route-builder-shared";

export function buildTaskProjectionRegistrations(
  shared: ReturnType<typeof buildTaskRouteBuilderShared>,
) {
  return {
    loadTaskTreeBackedRecord: shared.sharedDeps.loadTaskTreeBackedRecord,
    listTaskSnapshots: shared.snapshotReadApi.listTaskSnapshots,
    getTaskSnapshot: shared.snapshotReadApi.getTaskSnapshot,
    buildTaskProjectionTimelineViewResponse,
    replayTaskDomainProjections: shared.sharedDeps.replayTaskDomainProjections,
    replayTaskDomainProjectionsByProject: shared.sharedDeps.replayTaskDomainProjectionsByProject,
  };
}
