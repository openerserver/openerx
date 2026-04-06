import type { Hono } from "hono";
import type { AppEnv } from "../../middleware/auth";
import { listCanonicalTaskAgentRuns } from "./agent-run-compat";

export function registerTaskAgentRunReadRoutes(taskRoutes: Hono<AppEnv>) {
  taskRoutes.get("/:taskId/runs", async (c) => {
    const taskId = c.req.param("taskId");
    const rows = await listCanonicalTaskAgentRuns(taskId);

    return c.json({
      data: rows,
      meta: {
        taskId,
        count: rows.length,
      },
    });
  });
}
