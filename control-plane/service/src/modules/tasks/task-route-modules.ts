import type { Hono } from "hono";
import type { AppEnv } from "../../middleware/auth";
import { registerTaskCoreRoutes } from "./task-core-routes";
import { registerTaskProjectionRoutes } from "./task-projection-routes";
import { buildTaskRouteRegistrations } from "./task-route-registrations";
import { registerTaskSessionRoutes } from "./task-session-routes";

export function registerTaskRouteModules(taskRoutes: Hono<AppEnv>) {
  const registrations = buildTaskRouteRegistrations();

  registerTaskCoreRoutes(taskRoutes, registrations.core);
  registerTaskSessionRoutes(taskRoutes, registrations.sessions);
  registerTaskProjectionRoutes(taskRoutes, registrations.projections);
}
