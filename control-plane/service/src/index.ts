import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRoutes } from "./modules/auth/routes";
import { orgRoutes } from "./modules/orgs/routes";
import { projectRoutes } from "./modules/projects/routes";
import { envRoutes } from "./modules/envs/routes";
import { userRoutes } from "./modules/users/routes";
import { policyRoutes } from "./modules/policies/routes";
import { auditRoutes } from "./modules/audit/routes";
import { costRoutes } from "./modules/cost/routes";
import { approvalRoutes } from "./modules/approvals/routes";

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

// ── Start Server ───────────────────────────────────────────────────

const port = Number(process.env.PORT) || 4097;

export default {
  port,
  fetch: app.fetch,
};

console.log(`OpenerX Control Plane running on http://localhost:${port}`);
