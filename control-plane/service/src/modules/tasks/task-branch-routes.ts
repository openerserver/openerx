import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppEnv } from "../../middleware/auth";
import type { TaskTreeRecord } from "../project-tree/task-view";
import {
  type CreateTaskBranchInput,
  type PersistTaskBranchMessageInput,
  createTaskBranchSchema,
  persistTaskBranchMessageSchema,
} from "./task-branch-write";

export function registerTaskBranchCompatRoutes(
  taskRoutes: Hono<AppEnv>,
  deps: {
    loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
    listTaskBranchCompatTreeRecords: (
      taskId: string,
      projectId: string,
      options?: { includeArchived?: boolean },
    ) => Promise<unknown[]>;
    buildTaskBranchCompatMessagesResponse: (args: {
      taskId: string;
      projectId: string;
      runtimeSessionId: string;
      includeLineage: boolean;
    }) => Promise<unknown>;
    buildTaskBranchCompatEventsResponse: (args: {
      taskId: string;
      projectId: string;
      runtimeSessionId: string;
      includeLineage: boolean;
    }) => Promise<unknown>;
    buildTaskBranchCompatTimelineResponse: (args: {
      taskId: string;
      projectId: string;
      runtimeSessionId: string;
      includeLineage: boolean;
    }) => Promise<unknown>;
    upsertTaskBranch: (
      taskId: string,
      body: CreateTaskBranchInput,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    persistTaskBranchMessage: (
      taskId: string,
      body: PersistTaskBranchMessageInput,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    activateTaskBranch: (
      taskId: string,
      branchId: string,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    archiveTaskBranch: (
      taskId: string,
      branchId: string,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
  },
) {
  // These routes preserve runtime-session lineage/history access for compat and
  // diagnostics. Public execution trace reads use the projection routes instead.
  taskRoutes.get("/:taskId/branches", async (c) => {
    const taskId = c.req.param("taskId");
    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);

    const rows = await deps.listTaskBranchCompatTreeRecords(taskId, task.projectId, {
      includeArchived: true,
    });

    return c.json({ data: rows });
  });

  taskRoutes.post("/:taskId/branches", zValidator("json", createTaskBranchSchema), async (c) => {
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
    zValidator("json", persistTaskBranchMessageSchema),
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

    const response = await deps.buildTaskBranchCompatMessagesResponse({
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

    const response = await deps.buildTaskBranchCompatEventsResponse({
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

    const response = await deps.buildTaskBranchCompatTimelineResponse({
      taskId,
      projectId: task.projectId,
      runtimeSessionId,
      includeLineage,
    });

    return c.json(response);
  });

  taskRoutes.post("/:taskId/branches/:branchId/activate", async (c) => {
    const taskId = c.req.param("taskId");
    const branchId = c.req.param("branchId");
    const result = await deps.activateTaskBranch(taskId, branchId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.post("/:taskId/branches/:branchId/archive", async (c) => {
    const taskId = c.req.param("taskId");
    const branchId = c.req.param("branchId");
    const result = await deps.archiveTaskBranch(taskId, branchId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });
}
