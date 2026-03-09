import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { authHeader, cpFetch } from "../../lib/control-plane-client";
import { classifyIntent } from "../../lib/intent-classifier";
import {
  continueSession,
  createSession,
  getSessionMessages,
  listSessions,
} from "../agent-control/opencode-adapter";
import { syncGraphsForSessionTask, syncGraphsForTask } from "../realtime/dag-sync";
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

  const classification = classifyIntent(task.prompt);
  const executionAgent = classification.requiresPlan
    ? "sisyphus-enterprise"
    : classification.suggestedAgents[0] || "build";

  // 2. Create OpenCode session and send prompt
  const execResult = await createSession(taskId, task.projectId, task.prompt, {
    agent: executionAgent,
  });

  if (!execResult.ok && !execResult.sessionId) {
    return c.json({ error: execResult.error || "Failed to start agent execution" }, 502);
  }

  // 3. Update task status in Control Plane (with intent classification)
  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: {
      status: "running",
      sessionId: execResult.sessionId,
      agentRunId: execResult.agentRunId,
      category: classification.category,
      strategy: JSON.stringify({
        complexity: classification.complexity,
        suggestedAgents: classification.suggestedAgents,
        requiresPlan: classification.requiresPlan,
        confidence: classification.confidence,
      }),
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
  const taskResult = await cpFetch<{ sessionId?: string }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    authorization: authHeader(c),
  });

  // Sync latest runtime DAG state before returning
  await syncGraphsForSessionTask(taskId, taskResult.ok ? taskResult.data?.sessionId : undefined).catch(
    () => {},
  );
  await syncGraphsForTask(taskId).catch(() => {});
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/graph`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// GET /api/tasks/:taskId/runs — Get agent run history
taskRoutes.get("/:taskId/runs", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/runs`, {
    authorization: authHeader(c),
  });
  return c.json(result.data, result.ok ? 200 : (result.status as 401 | 404 | 502));
});

// GET /api/tasks/:taskId/pipeline — Get planning pipeline results
// Fetches session messages and extracts planning stage outputs (prometheus/metis/momus)
const PIPELINE_AGENTS = ["prometheus-enterprise", "metis-enterprise", "momus-enterprise"];

taskRoutes.get("/:taskId/pipeline", async (c) => {
  const taskId = c.req.param("taskId");

  // Fetch the task to get its sessionId
  const taskResult = await cpFetch<{ sessionId?: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    { authorization: authHeader(c) },
  );
  if (!taskResult.ok || !taskResult.data?.sessionId) {
    return c.json({ stages: [] });
  }

  // Fetch messages from the OpenCode session
  const msgResult = await getSessionMessages(taskResult.data.sessionId);
  if (!msgResult.ok || !Array.isArray(msgResult.data)) {
    return c.json({ stages: [] });
  }

  const messages = msgResult.data as Array<{
    info: { role: string; agent?: string; tokens?: { input: number; output: number } };
    parts: Array<{ type: string; text?: string }>;
  }>;

  // Extract planning pipeline stages from assistant messages
  const stages = PIPELINE_AGENTS.map((agentName) => {
    const agentMsgs = messages.filter(
      (m) => m.info.role === "assistant" && m.info.agent === agentName,
    );
    const lastMsg = agentMsgs[agentMsgs.length - 1];
    const output =
      lastMsg?.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n") || null;
    return {
      agent: agentName,
      label: agentName.replace("-enterprise", ""),
      status: agentMsgs.length > 0 ? (output ? "completed" : "running") : "pending",
      messageCount: agentMsgs.length,
      output: output ? (output.length > 2000 ? `${output.slice(0, 2000)}…` : output) : null,
      tokens: lastMsg?.info.tokens || null,
    };
  });

  return c.json({ stages });
});

// ═══════════════════════════════════════════════════════════════════
// SESSION ROUTES — Expose OpenCode session operations
// ═══════════════════════════════════════════════════════════════════

// GET /api/tasks/:taskId/sessions — List sessions related to a task
taskRoutes.get("/:taskId/sessions", async (c) => {
  const taskId = c.req.param("taskId");

  // Get task to find its sessionId
  const taskResult = await cpFetch<{ sessionId?: string; title?: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    { authorization: authHeader(c) },
  );

  if (!taskResult.ok) {
    return c.json({ data: [] });
  }

  // List recent sessions from OpenCode and filter by task reference
  const sessResult = await listSessions(50);
  if (!sessResult.ok || !Array.isArray(sessResult.data)) {
    return c.json({ data: [] });
  }

  const taskPrefix = `[Task ${taskId.slice(0, 8)}]`;
  const sessions = (
    sessResult.data as Array<{
      id: string;
      title?: string;
      version?: string;
      summary?: { additions: number; deletions: number; files: number };
      time?: { created: number; updated: number };
    }>
  )
    .filter((s) => s.id === taskResult.data?.sessionId || s.title?.includes(taskPrefix))
    .map((s) => ({
      id: s.id,
      title: s.title || "",
      isActive: s.id === taskResult.data?.sessionId,
      summary: s.summary || null,
      createdAt: s.time?.created ? new Date(s.time.created).toISOString() : null,
      updatedAt: s.time?.updated ? new Date(s.time.updated).toISOString() : null,
    }));

  return c.json({ data: sessions });
});

// GET /api/tasks/:taskId/sessions/:sessionId/messages — Get session messages
taskRoutes.get("/:taskId/sessions/:sessionId/messages", async (c) => {
  const sessionId = c.req.param("sessionId") as string;
  const result = await getSessionMessages(sessionId);
  if (!result.ok) {
    return c.json({ data: [] });
  }
  return c.json({ data: result.data });
});

// POST /api/tasks/:taskId/continue — Continue a task (send follow-up prompt to its session)
const continueSchema = z.object({
  prompt: z.string().min(1).max(50000),
  sessionId: z.string().optional(),
});

taskRoutes.post("/:taskId/continue", zValidator("json", continueSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const { prompt, sessionId: overrideSessionId } = c.req.valid("json");

  // Get the task's session
  const taskResult = await cpFetch<{ sessionId?: string; projectId: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    { authorization: authHeader(c) },
  );

  if (!taskResult.ok) return c.json({ error: "Task not found" }, 404);

  const sid = overrideSessionId || taskResult.data?.sessionId;
  if (!sid) return c.json({ error: "No session associated with this task" }, 400);

  const result = await continueSession(sid, prompt);
  if (!result.ok) return c.json({ error: result.error || "Failed to continue session" }, 502);

  // Update task status back to running
  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: { status: "running" },
    authorization: authHeader(c),
  });

  wsBroadcaster.broadcast({
    id: crypto.randomUUID(),
    type: "task.continued",
    ts: new Date().toISOString(),
    taskId,
    projectId: taskResult.data?.projectId,
    data: { sessionId: sid },
  });

  return c.json({ ok: true, sessionId: sid });
});
