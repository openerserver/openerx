import type { Hono } from "hono";
import type { AppEnv } from "../../middleware/auth";
import { registerTaskAgentRunWriteRoutes } from "./task-agent-run-write-routes";
import { registerTaskBranchRoutes } from "./task-branch-routes";
import { registerTaskCoreRoutes } from "./task-core-routes";
import { registerTaskDomainRunRoutes } from "./task-domain-run-routes";
import { registerTaskProjectionRoutes } from "./task-projection-routes";
import { buildTaskRouteRegistrations } from "./task-route-registrations";

export function registerTaskRouteModules(taskRoutes: Hono<AppEnv>) {
  const registrations = buildTaskRouteRegistrations();

  registerTaskCoreRoutes(taskRoutes, registrations.core);
  registerTaskDomainRunRoutes(taskRoutes, registrations.domainRuns);
  registerTaskAgentRunWriteRoutes(taskRoutes, registrations.agentRunWrites);
  registerTaskBranchRoutes(taskRoutes, registrations.branches);
  registerTaskProjectionRoutes(taskRoutes, registrations.projections);
}
