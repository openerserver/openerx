import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { approvalRoutes } from "./modules/approvals/routes";
import { auditRoutes } from "./modules/audit/routes";
import { authRoutes } from "./modules/auth/routes";
import { codeChangeRoutes } from "./modules/code-changes/routes";
import { costRoutes } from "./modules/cost/routes";
import { credentialRoutes } from "./modules/credentials/routes";
import { envRoutes } from "./modules/envs/routes";
import { governanceRoutes } from "./modules/governance/routes";
import { orgRoutes } from "./modules/orgs/routes";
import { pluginRoutes } from "./modules/plugins/routes";
import { policyRoutes } from "./modules/policies/routes";
import { projectRoutes } from "./modules/projects/routes";
import { repositoryRoutes } from "./modules/repositories/routes";
import { taskRoutes } from "./modules/tasks/routes";
import { userRoutes } from "./modules/users/routes";

const app = new Hono();

// ── Global Middleware ──────────────────────────────────────────────

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

// ── Health Check ───────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok", service: "openerx-control-plane" }));

// ── Routes ─────────────────────────────────────────────────────────

app.route("/api/auth", authRoutes);
app.route("/api/orgs", orgRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/envs", envRoutes);
app.route("/api/users", userRoutes);
app.route("/api/policies", policyRoutes);
app.route("/api/audit", auditRoutes);
app.route("/api/cost", costRoutes);
app.route("/api/approvals", approvalRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/plugins", pluginRoutes);
app.route("/api/projects/:projectId/repositories", repositoryRoutes);
app.route("/api/projects/:projectId/credentials", credentialRoutes);
app.route("/api", codeChangeRoutes);
app.route("/api/governance", governanceRoutes);

// ── Start Server ───────────────────────────────────────────────────

const port = Number(process.env.PORT) || 4097;

export default {
  port,
  fetch: app.fetch,
};

console.log(`OpenerX Control Plane running on http://localhost:${port}`);
