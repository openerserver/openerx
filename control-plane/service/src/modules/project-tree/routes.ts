import { Hono } from "hono";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { listTaskTreeRecords, loadTaskTreeRecord } from "./task-view";

export const projectTreeRoutes = new Hono<AppEnv>();

projectTreeRoutes.use("*", authMiddleware);

projectTreeRoutes.get("/tasks", async (c) => {
  const projectId = c.req.query("projectId");
  const status = c.req.query("status");
  const repoId = c.req.query("repoId");
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);

  const data = await listTaskTreeRecords({
    projectId: projectId || undefined,
    status: status || undefined,
    repoId: repoId || undefined,
    limit,
  });

  return c.json({ data });
});

projectTreeRoutes.get("/tasks/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const task = await loadTaskTreeRecord(taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json(task);
});