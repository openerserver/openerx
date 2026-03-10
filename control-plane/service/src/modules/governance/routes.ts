import { Hono } from "hono";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { evaluateCodeChange, getTaskGovernanceSummary } from "./risk-engine";

export const governanceRoutes = new Hono<AppEnv>();

governanceRoutes.use("*", authMiddleware);
governanceRoutes.use("*", requireRole("developer"));

// POST /api/governance/evaluate/:changeId — Evaluate a specific code change
governanceRoutes.post("/evaluate/:changeId", async (c) => {
  const changeId = c.req.param("changeId");
  const user = c.get("user");

  try {
    const result = await evaluateCodeChange(changeId, user.sub);
    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

// GET /api/governance/tasks/:taskId/summary — Get governance summary for a task
governanceRoutes.get("/tasks/:taskId/summary", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await getTaskGovernanceSummary(taskId);
  return c.json(result);
});
