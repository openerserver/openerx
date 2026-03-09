import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { cpFetch, authHeader } from "../../lib/control-plane-client";
import { createSession } from "../agent-control/opencode-adapter";
import { wsBroadcaster } from "../realtime/ws-broadcaster";

// ── Task Routes (BFF) ──────────────────────────────────────────────

export const taskRoutes = new Hono();

// GET /api/tasks — List tasks
taskRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId") || "";
  const status = c.req.query("status") || "";
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);

  const result = await cpFetch(`/api/tasks?${params.toString()}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 502));
});

// GET /api/tasks/:taskId — Get task detail
taskRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// POST /api/tasks — Create a new task
const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  prompt: z.string().min(1).max(50000),
  projectId: z.string().min(1),
});

taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const body = c.req.valid("json");

  const result = await cpFetch<{ id: string; status: string }>("/api/tasks", {
    method: "POST",
    body,
    authorization: authHeader(c),
  });

  if (result.ok) {
    wsBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: "task.created",
      ts: new Date().toISOString(),
      taskId: result.data.id,
      projectId: body.projectId,
      data: { title: body.title },
    });
  }

  return c.json(result.data, result.ok ? 201 : (result.status as 400 | 401 | 502));
});

// POST /api/tasks/:taskId/execute — Start agent execution for a task
taskRoutes.post("/:taskId/execute", async (c) => {
  const taskId = c.req.param("taskId");

  // 1. Fetch the task from Control Plane
  const taskResult = await cpFetch<{
    id: string;
    prompt: string;
    status: string;
    projectId: string;
    title: string;
  }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    authorization: authHeader(c),
  });

  if (!taskResult.ok) {
    return c.json({ error: "Task not found" }, 404);
  }

  const task = taskResult.data;
  if (task.status !== "pending") {
    return c.json({ error: `Cannot execute: task status is ${task.status}` }, 400);
  }

  // 2. Create OpenCode session and send prompt
  const execResult = await createSession(taskId, task.projectId, task.prompt);

  if (!execResult.ok && !execResult.sessionId) {
    return c.json({ error: execResult.error || "Failed to start agent execution" }, 502);
  }

  // 3. Update task status in Control Plane
  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: {
      status: "running",
      sessionId: execResult.sessionId,
      agentRunId: execResult.agentRunId,
    },
    authorization: authHeader(c),
  });

  // 4. Broadcast events
  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "agent.started",
    ts: new Date().toISOString(),
    taskId,
    projectId: task.projectId,
    agentRunId: execResult.agentRunId,
    sessionId: execResult.sessionId,
    data: { taskId, title: task.title, agentRunId: execResult.agentRunId },
  });

  return c.json({
    taskId,
    sessionId: execResult.sessionId,
    agentRunId: execResult.agentRunId,
    status: "running",
  });
});

// GET /api/tasks/:taskId/graph — Get DAG visualization data
taskRoutes.get("/:taskId/graph", async (c) => {
  const taskId = c.req.param("taskId");
  return c.json({
    taskId,
    note: "Subscribe to task.node.updated events for real-time graph updates.",
  });
});
