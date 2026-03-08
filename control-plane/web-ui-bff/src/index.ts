import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { realtimeRoutes } from "./modules/realtime/routes";
import { agentControlRoutes } from "./modules/agent-control/routes";
import { taskRoutes } from "./modules/tasks/routes";
import { approvalRoutes } from "./modules/approvals/routes";
import { authMiddleware } from "./middleware/auth";

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

// ── Routes (all require auth) ──────────────────────────────────────

app.use("/api/*", authMiddleware);
app.route("/api/realtime", realtimeRoutes);
app.route("/api/agents", agentControlRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/approvals", approvalRoutes);

// ── WebSocket upgrade for realtime ─────────────────────────────────

app.get("/ws", async (c) => {
  // WebSocket upgrade handled by Bun's native WebSocket support
  // See ws-broadcaster.ts for the handler
  return c.text("WebSocket endpoint — upgrade required", 426);
});

// ── Start Server ───────────────────────────────────────────────────

const port = Number(process.env.BFF_PORT) || 4098;

export default {
  port,
  fetch: app.fetch,
};

console.log(`OpenerX BFF running on http://localhost:${port}`);
