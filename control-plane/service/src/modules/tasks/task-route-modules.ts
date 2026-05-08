import type { Hono } from "hono";
import type { AppEnv } from "../../middleware/auth";
import { registerTaskAgentRunReadRoutes } from "./task-agent-run-read-routes";
import { registerTaskAgentRunWriteRoutes } from "./task-agent-run-write-routes-canonical";
import { registerTaskCoreRoutes } from "./task-core-routes";
import { registerTaskProjectionRoutes } from "./task-projection-routes";
import { buildTaskRouteRegistrations } from "./task-route-registrations";
import { registerTaskSessionRoutes } from "./task-session-routes";
import { registerTaskRouteModulesFromRegistrars } from "./task-route-assembly";

export function registerTaskRouteModulesWithRegistrars(
  taskRoutes: Hono<AppEnv>,
  registrars: {
    buildRegistrations: typeof buildTaskRouteRegistrations;
    registerAgentRunReads: typeof registerTaskAgentRunReadRoutes;
    registerAgentRunWrites: typeof registerTaskAgentRunWriteRoutes;
    registerCore: typeof registerTaskCoreRoutes;
    registerSessions: typeof registerTaskSessionRoutes;
    registerProjections: typeof registerTaskProjectionRoutes;
  },
) {
  registerTaskRouteModulesFromRegistrars(taskRoutes, registrars);
}

export function registerTaskRouteModules(taskRoutes: Hono<AppEnv>) {
  registerTaskRouteModulesWithRegistrars(taskRoutes, {
    buildRegistrations: buildTaskRouteRegistrations,
    registerAgentRunReads: registerTaskAgentRunReadRoutes,
    registerAgentRunWrites: registerTaskAgentRunWriteRoutes,
    registerCore: registerTaskCoreRoutes,
    registerSessions: registerTaskSessionRoutes,
    registerProjections: registerTaskProjectionRoutes,
  });
}
