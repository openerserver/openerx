import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { db } from "../../db";
import { agentRuns } from "../../db/schema";
import type { AppEnv, JWTPayload } from "../../middleware/auth";
import type { TaskTreeSnapshot } from "../project-tree/storage";
import type { TaskTreeRecord } from "../project-tree/task-view";
import { type CreateTaskInput, createTaskSchema } from "./task-create";
import { type TaskStatusUpdate, updateStatusSchema } from "./task-status-update";

export function registerTaskCoreRoutes(
  taskRoutes: Hono<AppEnv>,
  deps: {
    validateTaskCreateInput: (body: CreateTaskInput) => Promise<unknown>;
    insertTask: (userId: string, body: CreateTaskInput) => Promise<string>;
    recordTaskCreatedAudit: (
      userId: string,
      taskId: string,
      body: CreateTaskInput,
    ) => Promise<unknown>;
    loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
    buildTaskUpdates: (body: TaskStatusUpdate, existing: TaskTreeRecord) => Record<string, unknown>;
    buildTaskTreeSnapshotFromRecord: (
      task: TaskTreeRecord,
      updates: Record<string, unknown>,
    ) => TaskTreeSnapshot;
    upsertTaskTreeNode: (snapshot: TaskTreeSnapshot) => Promise<unknown>;
    syncTaskAggregateFromSnapshot: (snapshot: TaskTreeSnapshot) => Promise<unknown>;
  },
) {
  taskRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
    const user = c.get("user") as JWTPayload;
    const body = c.req.valid("json") as CreateTaskInput;
    const validationError = await deps.validateTaskCreateInput(body);
    if (validationError) {
      return c.json(validationError, 400);
    }

    const taskId = await deps.insertTask(user.sub, body);
    await deps.recordTaskCreatedAudit(user.sub, taskId, body);

    return c.json({ id: taskId, nodeId: taskId, status: "pending" }, 201);
  });

  taskRoutes.patch("/:taskId", zValidator("json", updateStatusSchema), async (c) => {
    const taskId = c.req.param("taskId");
    const body = c.req.valid("json") as TaskStatusUpdate;

    const existing = await deps.loadTaskTreeBackedRecord(taskId);
    if (!existing) return c.json({ error: "Task not found" }, 404);

    const updates = deps.buildTaskUpdates(body, existing);
    const snapshot = deps.buildTaskTreeSnapshotFromRecord(existing, updates);

    await deps.upsertTaskTreeNode(snapshot);
    await deps.syncTaskAggregateFromSnapshot(snapshot);

    return c.json({ id: taskId, ...updates });
  });

  taskRoutes.get("/:taskId/runs", async (c) => {
    const taskId = c.req.param("taskId");

    const runs = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.taskId, taskId))
      .orderBy(desc(agentRuns.createdAt));

    return c.json({ data: runs });
  });
}
