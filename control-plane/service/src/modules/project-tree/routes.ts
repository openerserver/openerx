import { Hono } from "hono";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { listTaskTreeRecordPage, loadTaskTreeRecord } from "./task-view";

export const projectTreeRoutes = new Hono<AppEnv>();

projectTreeRoutes.use("*", authMiddleware);

projectTreeRoutes.get("/tasks", async (c) => {
  const projectId = c.req.query("projectId");
  const status = c.req.query("status");
  const repoId = c.req.query("repoId");
  const requestedLimit = Number(c.req.query("limit") || "50");
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 200))
    : 50;

  const result = await listTaskTreeRecordPage({
    projectId: projectId || undefined,
    status: status || undefined,
    repoId: repoId || undefined,
    limit,
  });

  return c.json(result);
});

projectTreeRoutes.get("/tasks/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const task = await loadTaskTreeRecord(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json(task);
});
