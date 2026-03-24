import { buildTaskBranchCompatRegistrations } from "./task-route-branch-registrations";
import { buildTaskRouteBuilderShared } from "./task-route-builder-shared";
import {
  buildTaskAgentRunWriteRegistrations,
  buildTaskCoreRegistrations,
} from "./task-route-core-registrations";
import { buildTaskDomainRegistrations } from "./task-route-domain-registrations";
import { buildTaskProjectionRegistrations } from "./task-route-projection-registrations";

export function buildTaskRouteRegistrations() {
  const shared = buildTaskRouteBuilderShared();

  return {
    core: buildTaskCoreRegistrations(shared),
    domainRuns: buildTaskDomainRegistrations(shared),
    agentRunWrites: buildTaskAgentRunWriteRegistrations(shared),
    branchCompat: buildTaskBranchCompatRegistrations(shared),
    projections: buildTaskProjectionRegistrations(shared),
  };
}
