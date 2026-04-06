import { buildTaskRouteBuilderShared } from "./task-route-builder-shared";
import {
  buildTaskAgentRunWriteRegistrations,
  buildTaskCoreRegistrations,
} from "./task-route-core-registrations";
import { buildTaskProjectionRegistrations } from "./task-route-projection-registrations";
import { buildTaskSessionRegistrations } from "./task-route-session-registrations";

export function buildTaskRouteRegistrations() {
  const shared = buildTaskRouteBuilderShared();

  return {
    agentRunCompat: buildTaskAgentRunWriteRegistrations(shared),
    core: buildTaskCoreRegistrations(shared),
    sessions: buildTaskSessionRegistrations(shared),
    projections: buildTaskProjectionRegistrations(shared),
  };
}
