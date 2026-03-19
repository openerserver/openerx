import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { agentRunRoutes } from "./modules/agent-runs/routes";
import { approvalRoutes } from "./modules/approvals/routes";
import { auditRoutes } from "./modules/audit/routes";
import { authRoutes } from "./modules/auth/routes";
import { codeChangeRoutes } from "./modules/code-changes/routes";
import { costRoutes } from "./modules/cost/routes";
import { credentialRoutes } from "./modules/credentials/routes";
import { dashboardRoutes } from "./modules/dashboard/routes";
import { developerChangeRequestRoutes } from "./modules/developer-change-requests/routes";
import { envRoutes } from "./modules/envs/routes";
import { governanceRoutes } from "./modules/governance/routes";
import { orgRoutes } from "./modules/orgs/routes";
import { pluginRoutes } from "./modules/plugins/routes";
import { policyRoutes } from "./modules/policies/routes";
import { projectRoutes } from "./modules/projects/routes";
import { repositoryRoutes } from "./modules/repositories/routes";
import { roleAgentRoutes } from "./modules/role-agents/routes";
import { roleConclusionRoutes } from "./modules/role-conclusions/routes";
import { taskOperatingRuntimeRoutes } from "./modules/task-operating-runtime/routes";
import { taskWorkflowRoutes } from "./modules/task-workflows/routes";
import { taskRoutes } from "./modules/tasks/routes";
import { userRoutes } from "./modules/users/routes";
import { workbenchRoutes } from "./modules/workbench/routes";
import { workflowTemplateRoutes } from "./modules/workflow-templates/routes";

export function createControlPlaneApp() {
  const app = new Hono();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGIN || "http://localhost:5173",
      credentials: true,
    }),
  );

  app.onError((error, c) => {
    console.error("[control-plane] uncaught error", error);
    return c.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, 500);
  });

  app.get("/health", (c) => c.json({ status: "ok", service: "opener-x-control-plane" }));

  app.route("/api/auth", authRoutes);
  app.route("/api/orgs", orgRoutes);
  app.route("/api/projects", projectRoutes);
  app.route("/api/envs", envRoutes);
  app.route("/api/users", userRoutes);
  app.route("/api/policies", policyRoutes);
  app.route("/api/audit", auditRoutes);
  app.route("/api/cost", costRoutes);
  app.route("/api/dashboard", dashboardRoutes);
  app.route("/api/approvals", approvalRoutes);
  app.route("/api/agent-runs", agentRunRoutes);
  app.route("/api/tasks", taskRoutes);
  app.route("/api/tasks/:taskId/operating-runtime", taskOperatingRuntimeRoutes);
  app.route("/api/plugins", pluginRoutes);
  app.route("/api/role-agents", roleAgentRoutes);
  app.route("/api/workflow-templates", workflowTemplateRoutes);
  app.route("/api/tasks/:taskId/workflow", taskWorkflowRoutes);
  app.route("/api/tasks/:taskId/role-conclusions", roleConclusionRoutes);
  app.route("/api/tasks/:taskId/developer-change-requests", developerChangeRequestRoutes);
  app.route("/api/projects/:projectId/repositories", repositoryRoutes);
  app.route("/api/projects/:projectId/credentials", credentialRoutes);
  app.route("/api", codeChangeRoutes);
  app.route("/api/governance", governanceRoutes);
  app.route("/api/workbench", workbenchRoutes);

  return app;
}
