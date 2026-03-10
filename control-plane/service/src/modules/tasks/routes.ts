import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import {
  agentRuns,
  repositories,
  repositoryCredentials,
  taskEdges,
  taskNodes,
  tasks,
} from "../../db/schema";
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
  repoId: z.string().min(1).optional(),
  workingBranch: z.string().min(1).max(100).optional(),
  credentialId: z.string().min(1).optional(),
  selectedModel: z.string().max(200).optional(),
  gitAuthorName: z.string().max(200).optional(),
  gitAuthorEmail: z.string().email().max(200).optional(),
  gitCommitterName: z.string().max(200).optional(),
  gitCommitterEmail: z.string().email().max(200).optional(),
});

type CreateTaskInput = z.infer<typeof createTaskSchema>;

async function validateTaskRepository(projectId: string, repoId?: string) {
  if (!repoId) {
    return null;
  }

  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.projectId, projectId)),
  });

  if (!repo) {
    return { error: "Repository not found in this project" as const };
  }

  if (repo.status !== "active") {
    return { error: "Repository is not active" as const };
  }

  return null;
}

async function validateTaskCredential(projectId: string, credentialId?: string) {
  if (!credentialId) {
    return null;
  }

  const credential = await db.query.repositoryCredentials.findFirst({
    where: and(
      eq(repositoryCredentials.id, credentialId),
      eq(repositoryCredentials.projectId, projectId),
      eq(repositoryCredentials.status, "active"),
    ),
  });

  if (!credential) {
    return { error: "Credential not found or inactive in this project" as const };
  }

  return null;
}

async function validateTaskCreateInput(body: CreateTaskInput) {
  const repoValidation = await validateTaskRepository(body.projectId, body.repoId);
  if (repoValidation) {
    return repoValidation;
  }

  const credentialValidation = await validateTaskCredential(body.projectId, body.credentialId);
  if (credentialValidation) {
    return credentialValidation;
  }

  return null;
}

async function insertTask(userId: string, body: CreateTaskInput) {
  const taskId = crypto.randomUUID();

  await db.insert(tasks).values({
    id: taskId,
    projectId: body.projectId,
    userId,
    title: body.title,
    prompt: body.prompt,
    status: "pending",
    repoId: body.repoId ?? null,
    workingBranch: body.workingBranch ?? null,
    credentialId: body.credentialId ?? null,
    selectedModel: body.selectedModel ?? null,
    gitAuthorName: body.gitAuthorName ?? null,
    gitAuthorEmail: body.gitAuthorEmail ?? null,
    gitCommitterName: body.gitCommitterName ?? null,
    gitCommitterEmail: body.gitCommitterEmail ?? null,
  });

  return taskId;
}

async function recordTaskCreatedAudit(userId: string, taskId: string, body: CreateTaskInput) {
  await recordAuditEvent({
    userId,
    projectId: body.projectId,
    taskId,
    eventType: "task.created",
    action: "create_task",
    target: body.title,
    detail: { prompt: body.prompt.slice(0, 200) },
  });
}

taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const validationError = await validateTaskCreateInput(body);
  if (validationError) {
    return c.json(validationError, 400);
  }

  const taskId = await insertTask(user.sub, body);
  await recordTaskCreatedAudit(user.sub, taskId, body);

  return c.json({ id: taskId, status: "pending" }, 201);
});

// ── List Tasks ─────────────────────────────────────────────────────

taskRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  const status = c.req.query("status");
  const repoId = c.req.query("repoId");
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);

  const conditions = [];
  if (projectId) conditions.push(eq(tasks.projectId, projectId));
  if (status) conditions.push(eq(tasks.status, status as (typeof tasks.status.enumValues)[number]));
  if (repoId) conditions.push(eq(tasks.repoId, repoId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db
    .select()
    .from(tasks)
    .leftJoin(repositories, eq(tasks.repoId, repositories.id))
    .leftJoin(repositoryCredentials, eq(tasks.credentialId, repositoryCredentials.id))
    .where(where)
    .orderBy(desc(tasks.createdAt))
    .limit(limit);

  const data = result.map((r) => ({
    ...r.tasks,
    repoName: r.repositories?.name ?? null,
    remoteUrl: r.repositories?.remoteUrl ?? null,
    credentialLabel: r.repository_credentials?.label ?? null,
  }));

  return c.json({ data });
});

// ── Get Task ───────────────────────────────────────────────────────

taskRoutes.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await db
    .select()
    .from(tasks)
    .leftJoin(repositories, eq(tasks.repoId, repositories.id))
    .leftJoin(repositoryCredentials, eq(tasks.credentialId, repositoryCredentials.id))
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (result.length === 0) return c.json({ error: "Task not found" }, 404);
  const row = result[0];
  if (!row) return c.json({ error: "Task not found" }, 404);

  const task = {
    ...row.tasks,
    repoName: row.repositories?.name ?? null,
    remoteUrl: row.repositories?.remoteUrl ?? null,
    credentialLabel: row.repository_credentials?.label ?? null,
  };
  return c.json(task);
});

// ── Update Task Status ─────────────────────────────────────────────

const updateStatusSchema = z.object({
  status: z.enum(["running", "paused", "completed", "failed", "cancelled"]).optional(),
  sessionId: z.string().optional(),
  agentRunId: z.string().optional(),
  result: z.string().optional(),
  category: z.enum(["quick", "deep", "ops", "security", "architecture"]).optional(),
  strategy: z.string().optional(),
  workspaceRoot: z.string().optional(),
  baseRevision: z.string().optional(),
  workingBranch: z.string().optional(),
  // Identity snapshot (frozen at execution start)
  credentialId: z.string().optional(),
  gitAuthorName: z.string().max(200).optional(),
  gitAuthorEmail: z.string().email().max(200).optional(),
  gitCommitterName: z.string().max(200).optional(),
  gitCommitterEmail: z.string().email().max(200).optional(),
  // Post-execution facts
  finalCommitSha: z.string().max(200).optional(),
  finalBranchName: z.string().max(200).optional(),
  changesSummary: z
    .object({
      filesAdded: z.number().int().optional(),
      filesModified: z.number().int().optional(),
      filesDeleted: z.number().int().optional(),
      totalInsertions: z.number().int().optional(),
      totalDeletions: z.number().int().optional(),
    })
    .optional(),
});

type TaskStatusUpdate = z.infer<typeof updateStatusSchema>;

const directTaskUpdateKeys = [
  "sessionId",
  "agentRunId",
  "result",
  "category",
  "strategy",
  "workspaceRoot",
  "baseRevision",
  "workingBranch",
  "credentialId",
  "gitAuthorName",
  "gitAuthorEmail",
  "gitCommitterName",
  "gitCommitterEmail",
  "finalCommitSha",
  "finalBranchName",
  "changesSummary",
] as const;

function shouldSetFinishedAt(status: TaskStatusUpdate["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function buildTaskUpdates(body: TaskStatusUpdate, existing: typeof tasks.$inferSelect) {
  const updates: Record<string, unknown> = {};

  if (body.status !== undefined) {
    updates.status = body.status;
  }

  for (const key of directTaskUpdateKeys) {
    const value = body[key];
    if (value !== undefined) {
      updates[key] = value;
    }
  }

  if (body.status === "running" && !existing.startedAt) {
    updates.startedAt = new Date().toISOString();
  }

  if (shouldSetFinishedAt(body.status)) {
    updates.finishedAt = new Date().toISOString();
  }

  return updates;
}

taskRoutes.patch("/:taskId", zValidator("json", updateStatusSchema), async (c) => {
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");

  const existing = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });
  if (!existing) return c.json({ error: "Task not found" }, 404);

  const updates = buildTaskUpdates(body, existing);

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
