import { Hono } from "hono";

// ── Task Routes (BFF) ──────────────────────────────────────────────
// Aggregates task graph + agent status from orchestration layer.

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || "http://localhost:4097";

export const taskRoutes = new Hono();

// GET /api/tasks — List tasks for the current user/project
taskRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");

  // Proxy to control plane; aggregate with task graph state from OpenCode
  try {
    const response = await fetch(
      `${CONTROL_PLANE_URL}/api/audit?projectId=${projectId || ""}&type=task.created&limit=50`,
      { headers: { Authorization: c.req.header("Authorization") || "" } },
    );
    const data = await response.json();
    return c.json(data);
  } catch (e) {
    return c.json({ error: `Failed to fetch tasks: ${e}` }, 502);
  }
});

// GET /api/tasks/:taskId — Get task detail with graph + agent status
taskRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");

  try {
    // Fetch task graph state from OpenCode (stored in .opencode/state/task-graphs/)
    const graphResponse = await fetch(
      `${CONTROL_PLANE_URL}/api/audit?taskId=${taskId}&limit=100`,
      { headers: { Authorization: c.req.header("Authorization") || "" } },
    );
    const auditData = await graphResponse.json();

    return c.json({
      taskId,
      audit: auditData,
    });
  } catch (e) {
    return c.json({ error: `Failed to fetch task: ${e}` }, 502);
  }
});

// GET /api/tasks/:taskId/graph — Get the DAG visualization data
taskRoutes.get("/:taskId/graph", async (c) => {
  const taskId = c.req.param("taskId");

  // The task graph is stored in OpenCode's state directory
  // In production, the orchestrator plugin would expose this via a tool
  return c.json({
    taskId,
    note: "Task graph data is managed by the orchestrator plugin. Subscribe to task.node.updated events for real-time updates.",
  });
});
