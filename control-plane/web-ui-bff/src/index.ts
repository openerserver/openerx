import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth";
import { agentControlRoutes } from "./modules/agent-control/routes";
import { approvalRoutes } from "./modules/approvals/routes";
import { auditRoutes } from "./modules/audit/routes";
import { authRoutes } from "./modules/auth/routes";
import { configRoutes } from "./modules/config/routes";
import { costRoutes } from "./modules/cost/routes";
import { credentialRoutes } from "./modules/credentials/routes";
import { envRoutes } from "./modules/envs/routes";
import { orgRoutes } from "./modules/orgs/routes";
import { policyRoutes } from "./modules/policies/routes";
import { projectRoutes } from "./modules/projects/routes";
import { realtimeRoutes } from "./modules/realtime/routes";
import { websocketHandler } from "./modules/realtime/ws-broadcaster";
import { repositoryRoutes } from "./modules/repositories/routes";
import { reconcileRunningTasksOnStartup } from "./modules/tasks/reconcile";
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

// ── Health Check ───────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok", service: "openerx-bff" }));

// ── Auth Routes (public — no authMiddleware) ──────────────────────

app.route("/api/auth", authRoutes);

// ── Routes (all require auth) ──────────────────────────────────────

app.use("/api/*", authMiddleware);
app.route("/api/audit", auditRoutes);
app.route("/api/realtime", realtimeRoutes);
app.route("/api/agents", agentControlRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/approvals", approvalRoutes);
app.route("/api/cost", costRoutes);
app.route("/api/envs", envRoutes);
app.route("/api/policies", policyRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/repositories", repositoryRoutes);
app.route("/api/credentials", credentialRoutes);
app.route("/api/orgs", orgRoutes);
app.route("/api/users", userRoutes);
app.route("/api/config", configRoutes);

// ── Start Server ───────────────────────────────────────────────────

const port = Number(process.env.BFF_PORT) || 4098;

void reconcileRunningTasksOnStartup();

export default {
  port,
  idleTimeout: 255,
  fetch(req: Request, server: { upgrade: (req: Request, opts?: unknown) => boolean }) {
    // Upgrade /ws requests to WebSocket
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

console.log(`OpenerX BFF running on http://localhost:${port}`);
