import type { Hono } from "hono";
import type { AppEnv } from "../../middleware/auth";
import { registerTaskAgentRunWriteRoutes } from "./task-agent-run-write-routes";
import { registerTaskBranchCompatRoutes } from "./task-branch-routes";
import { registerTaskCoreRoutes } from "./task-core-routes";
import { registerTaskDomainRunRoutes } from "./task-domain-run-routes";
import { registerTaskProjectionRoutes } from "./task-projection-routes";
import { buildTaskRouteRegistrations } from "./task-route-registrations";

export function registerTaskRouteModules(taskRoutes: Hono<AppEnv>) {
  const registrations = buildTaskRouteRegistrations();

  registerTaskCoreRoutes(taskRoutes, registrations.core);
  registerTaskDomainRunRoutes(taskRoutes, registrations.domainRuns);
  registerTaskAgentRunWriteRoutes(taskRoutes, registrations.agentRunWrites);
  registerTaskBranchCompatRoutes(taskRoutes, registrations.branchCompat);
  registerTaskProjectionRoutes(taskRoutes, registrations.projections);
}
