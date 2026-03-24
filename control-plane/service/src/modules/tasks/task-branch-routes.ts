import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppEnv } from "../../middleware/auth";
import type { TaskTreeRecord } from "../project-tree/task-view";
import {
  type CreateTaskSessionInput,
  type PersistTaskSessionMessageInput,
  createTaskSessionSchema,
  persistTaskSessionMessageSchema,
} from "./task-branch-write";

export function registerTaskBranchRoutes(
  taskRoutes: Hono<AppEnv>,
  deps: {
    loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
    listTaskSessionTreeRecords: (
      taskId: string,
      projectId: string,
      options?: { includeArchived?: boolean },
    ) => Promise<unknown[]>;
    buildTaskSessionMessagesResponse: (args: {
      taskId: string;
      projectId: string;
      runtimeSessionId: string;
      includeLineage: boolean;
    }) => Promise<unknown>;
    buildTaskSessionEventsResponse: (args: {
      taskId: string;
      projectId: string;
      runtimeSessionId: string;
      includeLineage: boolean;
    }) => Promise<unknown>;
    buildTaskSessionTimelineResponse: (args: {
      taskId: string;
      projectId: string;
      runtimeSessionId: string;
      includeLineage: boolean;
    }) => Promise<unknown>;
    upsertTaskBranch: (
      taskId: string,
      body: CreateTaskSessionInput,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    persistTaskBranchMessage: (
      taskId: string,
      body: PersistTaskSessionMessageInput,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    activateTaskBranch: (
      taskId: string,
      tsId: string,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    archiveTaskBranch: (
      taskId: string,
      tsId: string,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
  },
) {
  taskRoutes.get("/:taskId/branches", async (c) => {
    const taskId = c.req.param("taskId");
    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);

    const rows = await deps.listTaskSessionTreeRecords(taskId, task.projectId, {
      includeArchived: true,
    });

    return c.json({ data: rows });
  });

  taskRoutes.post("/:taskId/branches", zValidator("json", createTaskSessionSchema), async (c) => {
    const taskId = c.req.param("taskId");
    const body = c.req.valid("json");
    const result = await deps.upsertTaskBranch(taskId, body);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200 | 201);
  });

  taskRoutes.post(
    "/:taskId/branches/messages",
    zValidator("json", persistTaskSessionMessageSchema),
    async (c) => {
      const taskId = c.req.param("taskId");
      const body = c.req.valid("json");
      const result = await deps.persistTaskBranchMessage(taskId, body);
      if (!result.ok) {
        return c.json({ error: result.error }, result.status as 404 | 500);
      }

      return c.json(result.data, result.status as 201 | 202);
    },
  );

  taskRoutes.get("/:taskId/branches/:runtimeSessionId/messages", async (c) => {
    const taskId = c.req.param("taskId");
    const runtimeSessionId = c.req.param("runtimeSessionId");
    const includeLineage = c.req.query("includeLineage") === "true";

    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);

    const response = await deps.buildTaskSessionMessagesResponse({
      taskId,
      projectId: task.projectId,
      runtimeSessionId,
      includeLineage,
    });

    return c.json(response);
  });

  taskRoutes.get("/:taskId/branches/:runtimeSessionId/events", async (c) => {
    const taskId = c.req.param("taskId");
    const runtimeSessionId = c.req.param("runtimeSessionId");
    const includeLineage = c.req.query("includeLineage") === "true";

    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);

    const response = await deps.buildTaskSessionEventsResponse({
      taskId,
      projectId: task.projectId,
      runtimeSessionId,
      includeLineage,
    });

    return c.json(response);
  });

  taskRoutes.get("/:taskId/branches/:runtimeSessionId/timeline", async (c) => {
    const taskId = c.req.param("taskId");
    const runtimeSessionId = c.req.param("runtimeSessionId");
    const includeLineage = c.req.query("includeLineage") === "true";

    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);

    const response = await deps.buildTaskSessionTimelineResponse({
      taskId,
      projectId: task.projectId,
      runtimeSessionId,
      includeLineage,
    });

    return c.json(response);
  });

  taskRoutes.post("/:taskId/branches/:tsId/activate", async (c) => {
    const taskId = c.req.param("taskId");
    const tsId = c.req.param("tsId");
    const result = await deps.activateTaskBranch(taskId, tsId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.post("/:taskId/branches/:tsId/archive", async (c) => {
    const taskId = c.req.param("taskId");
    const tsId = c.req.param("tsId");
    const result = await deps.archiveTaskBranch(taskId, tsId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });
}
