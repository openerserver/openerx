import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { agentRuns, taskEdges, taskNodes, tasks } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { recordAuditEvent } from "../audit/routes";

export const taskRoutes = new Hono<AppEnv>();

taskRoutes.use("*", authMiddleware);
taskRoutes.use("*", requireRole("developer"));

// ── Create Task ────────────────────────────────────────────────────

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  prompt: z.string().min(1).max(50000),
  projectId: z.string().min(1),
});

taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const user = c.get("user");
  const { title, prompt, projectId } = c.req.valid("json");

  const taskId = crypto.randomUUID();
  await db.insert(tasks).values({
    id: taskId,
    projectId,
    userId: user.sub,
    title,
    prompt,
    status: "pending",
  });

  await recordAuditEvent({
    userId: user.sub,
    projectId,
    taskId,
    eventType: "task.created",
    action: "create_task",
    target: title,
    detail: { prompt: prompt.slice(0, 200) },
  });

  return c.json({ id: taskId, status: "pending" }, 201);
});

// ── List Tasks ─────────────────────────────────────────────────────

taskRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);

  const conditions = [];
  if (projectId) conditions.push(eq(tasks.projectId, projectId));
  if (status) conditions.push(eq(tasks.status, status as (typeof tasks.status.enumValues)[number]));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select()
    .from(tasks)
    .where(where)
    .orderBy(desc(tasks.createdAt))
    .limit(limit);

  return c.json({ data: result });
});

// ── Get Task ───────────────────────────────────────────────────────

taskRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });

  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json(task);
});

// ── Update Task Status ─────────────────────────────────────────────

const updateStatusSchema = z.object({
  status: z.enum(["running", "paused", "completed", "failed", "cancelled"]),
  sessionId: z.string().optional(),
  agentRunId: z.string().optional(),
  result: z.string().optional(),
  category: z.enum(["quick", "deep", "ops", "security", "architecture"]).optional(),
  strategy: z.string().optional(),
});

taskRoutes.patch("/:taskId", zValidator("json", updateStatusSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");

  const existing = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });
  if (!existing) return c.json({ error: "Task not found" }, 404);

  const updates: Record<string, unknown> = { status: body.status };
  if (body.sessionId) updates.sessionId = body.sessionId;
  if (body.agentRunId) updates.agentRunId = body.agentRunId;
  if (body.result) updates.result = body.result;
  if (body.category) updates.category = body.category;
  if (body.strategy) updates.strategy = body.strategy;
  if (body.status === "running" && !existing.startedAt) {
    updates.startedAt = new Date().toISOString();
  }
  if (body.status === "completed" || body.status === "failed" || body.status === "cancelled") {
    updates.finishedAt = new Date().toISOString();
  }

  await db.update(tasks).set(updates).where(eq(tasks.id, taskId));

  return c.json({ id: taskId, ...updates });
});

// ── Task Graph (DAG nodes + edges) ─────────────────────────────────

taskRoutes.get("/:taskId/graph", async (c) => {
  const taskId = c.req.param("taskId");

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return c.json({ error: "Task not found" }, 404);

  const nodes = await db.select().from(taskNodes).where(eq(taskNodes.taskId, taskId));
  const edges = await db.select().from(taskEdges).where(eq(taskEdges.taskId, taskId));

  return c.json({ taskId, nodes, edges });
});

// ── Sync Nodes (bulk upsert from runtime) ──────────────────────────

const syncNodesSchema = z.object({
  graphId: z.string().min(1),
  nodes: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      status: z.enum([
        "pending",
        "in_progress",
        "completed",
        "failed",
        "blocked",
        "stopped",
        "paused",
        "waiting_approval",
      ]),
      agentType: z.string(),
      sessionId: z.string().nullable().optional(),
      retryCount: z.number().int().optional(),
      maxRetries: z.number().int().optional(),
      output: z.string().nullable().optional(),
      error: z.string().nullable().optional(),
      tokenUsed: z.number().int().optional(),
      startedAt: z.string().nullable().optional(),
      finishedAt: z.string().nullable().optional(),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.enum(["blocks", "informs"]).optional(),
    }),
  ),
});

taskRoutes.put("/:taskId/graph", zValidator("json", syncNodesSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return c.json({ error: "Task not found" }, 404);

  // Delete existing graph data for this task+graphId, then re-insert
  await db
    .delete(taskEdges)
    .where(and(eq(taskEdges.taskId, taskId), eq(taskEdges.graphId, body.graphId)));
  await db
    .delete(taskNodes)
    .where(and(eq(taskNodes.taskId, taskId), eq(taskNodes.graphId, body.graphId)));

  // Insert nodes
  if (body.nodes.length > 0) {
    await db.insert(taskNodes).values(
      body.nodes.map((n) => ({
        id: n.id,
        taskId,
        graphId: body.graphId,
        subject: n.subject,
        status: n.status,
        agentType: n.agentType,
        sessionId: n.sessionId ?? null,
        retryCount: n.retryCount ?? 0,
        maxRetries: n.maxRetries ?? 2,
        output: n.output ?? null,
        error: n.error ?? null,
        tokenUsed: n.tokenUsed ?? 0,
        startedAt: n.startedAt ?? null,
        finishedAt: n.finishedAt ?? null,
      })),
    );
  }

  // Insert edges
  if (body.edges.length > 0) {
    await db.insert(taskEdges).values(
      body.edges.map((e) => ({
        id: crypto.randomUUID(),
        taskId,
        graphId: body.graphId,
        fromNodeId: e.from,
        toNodeId: e.to,
        edgeType: e.type ?? "blocks",
      })),
    );
  }

  return c.json({ taskId, graphId: body.graphId, synced: true });
});

// ── Agent Runs ─────────────────────────────────────────────────────

taskRoutes.get("/:taskId/runs", async (c) => {
  const taskId = c.req.param("taskId");

  const runs = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.taskId, taskId))
    .orderBy(desc(agentRuns.createdAt));

  return c.json({ data: runs });
});

const createRunSchema = z.object({
  nodeId: z.string().optional(),
  sessionId: z.string().optional(),
  agentType: z.string().min(1),
});

taskRoutes.post("/:taskId/runs", zValidator("json", createRunSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) return c.json({ error: "Task not found" }, 404);

  const runId = crypto.randomUUID();
  await db.insert(agentRuns).values({
    id: runId,
    taskId,
    nodeId: body.nodeId ?? null,
    sessionId: body.sessionId ?? null,
    agentType: body.agentType,
    status: "pending",
  });

  return c.json({ id: runId, status: "pending" }, 201);
});

const updateRunSchema = z.object({
  status: z.enum(["running", "paused", "completed", "failed", "stopped", "terminated"]),
  modelUsed: z.string().optional(),
  tokenUsed: z.number().int().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
});

taskRoutes.patch("/:taskId/runs/:runId", zValidator("json", updateRunSchema), async (c) => {
  const runId = c.req.param("runId");
  const body = c.req.valid("json");

  const existing = await db.query.agentRuns.findFirst({ where: eq(agentRuns.id, runId) });
  if (!existing) return c.json({ error: "Agent run not found" }, 404);

  const updates: Record<string, unknown> = { status: body.status };
  if (body.modelUsed) updates.modelUsed = body.modelUsed;
  if (body.tokenUsed !== undefined) updates.tokenUsed = body.tokenUsed;
  if (body.result) updates.result = body.result;
  if (body.error) updates.error = body.error;
  if (body.status === "running" && !existing.startedAt) {
    updates.startedAt = new Date().toISOString();
  }
  if (["completed", "failed", "stopped", "terminated"].includes(body.status)) {
    updates.finishedAt = new Date().toISOString();
  }

  await db.update(agentRuns).set(updates).where(eq(agentRuns.id, runId));

  return c.json({ id: runId, ...updates });
});
