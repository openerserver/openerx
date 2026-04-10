import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { codeChanges, fileChanges } from "../../db/schema";
import { type AppEnv, authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { loadTaskTreeRecord } from "../project-tree/task-view";
import { normalizeApiTimestampFields } from "../shared/api-timestamp";

export const codeChangeRoutes = new Hono<AppEnv>();

codeChangeRoutes.use("*", authMiddleware);
codeChangeRoutes.use("*", requireRole("developer"));

function normalizeCodeChangeRecord<T extends { createdAt?: string | null }>(change: T) {
  return normalizeApiTimestampFields(change, ["createdAt"] as const);
}

// ── List changes for a task ────────────────────────────────────────

codeChangeRoutes.get("/tasks/:taskId/changes", async (c) => {
  const taskId = c.req.param("taskId");
  const result = await db
    .select()
    .from(codeChanges)
    .where(eq(codeChanges.taskId, taskId))
    .orderBy(desc(codeChanges.createdAt));

  return c.json({ data: result.map((change) => normalizeCodeChangeRecord(change)) });
});

// ── Get files for a specific change ────────────────────────────────

codeChangeRoutes.get("/tasks/:taskId/changes/:changeId/files", async (c) => {
  const changeId = c.req.param("changeId");
  const taskId = c.req.param("taskId");

  const change = await db.query.codeChanges.findFirst({
    where: and(eq(codeChanges.id, changeId), eq(codeChanges.taskId, taskId)),
  });
  if (!change) return c.json({ error: "Change not found" }, 404);

  const files = await db.select().from(fileChanges).where(eq(fileChanges.changeId, changeId));

  return c.json({ data: files });
});

// ── Create a code change record (used by BFF) ─────────────────────

const createChangeSchema = z.object({
  taskId: z.string().min(1),
  repoId: z.string().optional(),
  agentRunId: z.string().optional(),
  changeSource: z.enum(["runtime_diff", "task_snapshot", "git_commit"]),
  commitSha: z.string().max(200).optional(),
  commitAuthorName: z.string().max(200).optional(),
  commitAuthorEmail: z.string().max(200).optional(),
  commitMessage: z.string().max(5000).optional(),
  branchName: z.string().max(200).optional(),
  summary: z.string().optional(),
  files: z.array(
    z.object({
      filePath: z.string().min(1),
      changeType: z.enum(["added", "modified", "deleted", "renamed"]),
      oldPath: z.string().optional(),
      insertions: z.number().int().min(0).default(0),
      deletions: z.number().int().min(0).default(0),
    }),
  ),
});

codeChangeRoutes.post("/code-changes", zValidator("json", createChangeSchema), async (c) => {
  const body = c.req.valid("json");
  const task = await loadTaskTreeRecord(body.taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }
  const changeId = crypto.randomUUID();

  await db.insert(codeChanges).values({
    id: changeId,
    taskId: body.taskId,
    repoId: body.repoId ?? null,
    agentRunId: body.agentRunId ?? null,
    changeSource: body.changeSource,
    commitSha: body.commitSha ?? null,
    commitAuthorName: body.commitAuthorName ?? null,
    commitAuthorEmail: body.commitAuthorEmail ?? null,
    commitMessage: body.commitMessage ?? null,
    branchName: body.branchName ?? null,
    summary: body.summary ?? null,
  });

  if (body.files.length > 0) {
    await db.insert(fileChanges).values(
      body.files.map((f) => ({
        id: crypto.randomUUID(),
        changeId,
        filePath: f.filePath,
        changeType: f.changeType,
        oldPath: f.oldPath ?? null,
        insertions: f.insertions,
        deletions: f.deletions,
      })),
    );
  }

  return c.json({ id: changeId, fileCount: body.files.length }, 201);
});
