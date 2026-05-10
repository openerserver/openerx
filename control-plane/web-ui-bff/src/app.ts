import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth";
import { agentControlRoutes } from "./modules/agent-control/routes";
import { approvalRoutes } from "./modules/approvals/routes";
import { auditRoutes } from "./modules/audit/routes";
import { authRoutes } from "./modules/auth/routes";
import { chatSettingsRoutes } from "./modules/chat-settings/routes";
import { configRoutes } from "./modules/config/routes";
import { costRoutes } from "./modules/cost/routes";
import { credentialRoutes } from "./modules/credentials/routes";
import {
  codeOwnerRoutes,
  commitRuntimeRoutes,
  contributorRoutes,
  crowdsourcedTaskRoutes,
} from "./modules/crowdsourced-development/routes";
import { dashboardRoutes } from "./modules/dashboard/routes";
import { envRoutes } from "./modules/envs/routes";
import { orgRoutes } from "./modules/orgs/routes";
import { policyRoutes } from "./modules/policies/routes";
import { projectRoutes } from "./modules/projects/routes";
import { realtimeRoutes } from "./modules/realtime/routes";
import { websocketHandler } from "./modules/realtime/ws-broadcaster";
import { repositoryRoutes } from "./modules/repositories/routes";
import { roleAgentRoutes } from "./modules/role-agents/routes";
import { reconcileRunningTasksOnStartup, startPeriodicReconcile } from "./modules/tasks/reconcile";
import { taskRoutes } from "./modules/tasks/routes";
import { userRoutes } from "./modules/users/routes";
import { workbenchRoutes } from "./modules/workbench/routes";
import { workflowTemplateRoutes } from "./modules/workflow-templates/routes";
import { workspaceFileRoutes } from "./modules/workspace-files/routes";

type ServerUpgrade = { upgrade: (req: Request, opts?: unknown) => boolean };

export function createBffApp(serviceName = "opener-x-bff") {
  const app = new Hono();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGIN || "http://localhost:5173",
      credentials: true,
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok", service: serviceName }));

  app.route("/api/auth", authRoutes);

  app.use("/api/*", authMiddleware);
  app.route("/api/audit", auditRoutes);
  app.route("/api/realtime", realtimeRoutes);
  app.route("/api/agents", agentControlRoutes);
  app.route("/api/tasks", crowdsourcedTaskRoutes);
  app.route("/api/tasks", taskRoutes);
  app.route("/api/approvals", approvalRoutes);
  app.route("/api/code-owners", codeOwnerRoutes);
  app.route("/api/commit-runtimes", commitRuntimeRoutes);
  app.route("/api/contributors", contributorRoutes);
  app.route("/api/cost", costRoutes);
  app.route("/api/dashboard", dashboardRoutes);
  app.route("/api/envs", envRoutes);
  app.route("/api/policies", policyRoutes);
  app.route("/api/projects", projectRoutes);
  app.route("/api/role-agents", roleAgentRoutes);
  app.route("/api/repositories", repositoryRoutes);
  app.route("/api/credentials", credentialRoutes);
  app.route("/api/projects/:projectId/credentials", credentialRoutes);
  app.route("/api/orgs", orgRoutes);
  app.route("/api/users", userRoutes);
  app.route("/api/config", configRoutes);
  app.route("/api/chat-settings", chatSettingsRoutes);
  app.route("/api/workflow-templates", workflowTemplateRoutes);
  app.route("/api/workbench", workbenchRoutes);
  app.route("/api/workspace-files", workspaceFileRoutes);

  return app;
}

export function createBffServer(
  options: { startBackgroundJobs?: boolean; serviceName?: string } = {},
) {
  const app = createBffApp(options.serviceName);

  if (options.startBackgroundJobs !== false) {
    void reconcileRunningTasksOnStartup();
    startPeriodicReconcile();
  }

  return {
    app,
    fetch(req: Request, server: ServerUpgrade) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const ok = server.upgrade(req, { data: req.url });
        if (ok) return undefined;
        return new Response("WebSocket upgrade failed", { status: 426 });
      }

      return app.fetch(req);
    },
    websocket: websocketHandler,
  };
}
