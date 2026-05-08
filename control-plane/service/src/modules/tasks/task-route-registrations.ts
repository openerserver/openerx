import { buildTaskRouteBuilderShared } from "./task-route-builder-shared";
import {
  buildTaskAgentRunWriteRegistrations,
  buildTaskCoreRegistrations,
} from "./task-route-core-registrations";
import { buildTaskProjectionRegistrations } from "./task-route-projection-registrations";
import { buildTaskSessionRegistrations } from "./task-route-session-registrations";
import { buildTaskRouteRegistrationsFromBuilders } from "./task-route-assembly";

export function buildTaskRouteRegistrationsWithBuilders(builders: {
  buildShared: typeof buildTaskRouteBuilderShared;
  buildCore: typeof buildTaskCoreRegistrations;
  buildAgentRunWrites: typeof buildTaskAgentRunWriteRegistrations;
  buildSessions: typeof buildTaskSessionRegistrations;
  buildProjections: typeof buildTaskProjectionRegistrations;
}) {
  return buildTaskRouteRegistrationsFromBuilders(builders);
}

export function buildTaskRouteRegistrations() {
  return buildTaskRouteRegistrationsWithBuilders({
    buildShared: buildTaskRouteBuilderShared,
    buildCore: buildTaskCoreRegistrations,
    buildAgentRunWrites: buildTaskAgentRunWriteRegistrations,
    buildSessions: buildTaskSessionRegistrations,
    buildProjections: buildTaskProjectionRegistrations,
  });
}
