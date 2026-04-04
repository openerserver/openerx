import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import type { TaskTreeRecord } from "../project-tree/task-view";

const replayTaskDomainProjectionSchema = z
  .object({
    scope: z.enum(["task", "project"]),
    taskId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    reason: z.string().trim().min(12),
    confirm: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "task") {
      if (!value.taskId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "taskId is required for task replay",
          path: ["taskId"],
        });
      }
      if (value.projectId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "projectId is not allowed for task replay",
          path: ["projectId"],
        });
      }
      return;
    }

    if (!value.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "projectId is required for project replay",
        path: ["projectId"],
      });
    }
    if (value.taskId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "taskId is not allowed for project replay",
        path: ["taskId"],
      });
    }
    if (value.confirm !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "confirm=true is required for project replay",
        path: ["confirm"],
      });
    }
  });

export function registerTaskProjectionRoutes(
  taskRoutes: Hono<AppEnv>,
  deps: {
    loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
    listTaskSnapshots: (args: {
      projectId?: string;
      status?: string;
      limit?: number;
    }) => Promise<unknown>;
    getTaskSnapshot: (taskId: string) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    buildTaskProjectionTimelineViewResponse: (args: {
      taskId: string;
      projectId: string;
      sessionId?: string | null;
      includeLineage: boolean;
    }) => Promise<unknown>;
    replayTaskDomainProjections: (taskId: string) => Promise<Record<string, unknown>>;
    replayTaskDomainProjectionsByProject: (projectId: string) => Promise<Record<string, unknown>>;
  },
) {
  taskRoutes.get("/snapshots", async (c) => {
    const projectId = c.req.query("projectId") || undefined;
    const status = c.req.query("status") || undefined;
    const limitValue = Number(c.req.query("limit") || "200");
    const response = await deps.listTaskSnapshots({ projectId, status, limit: limitValue });

    return c.json(response);
  });

  taskRoutes.get("/:taskId/snapshot", async (c) => {
    const taskId = c.req.param("taskId");
    const result = await deps.getTaskSnapshot(taskId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/timeline-view", async (c) => {
    const taskId = c.req.param("taskId");
    const runtimeSessionId = c.req.query("runtimeSessionId");
    if (runtimeSessionId) {
      return c.json({ error: "runtimeSessionId query has been removed; use sessionId." }, 410);
    }

    const sessionId = c.req.query("sessionId") || null;
    const includeLineage = c.req.query("includeLineage") !== "false";

    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) return c.json({ error: "Task not found" }, 404);

    const response = await deps.buildTaskProjectionTimelineViewResponse({
      taskId,
      projectId: task.projectId,
      sessionId,
      includeLineage,
    });

    return c.json(response);
  });

  taskRoutes.post(
    "/projections/replay",
    requireRole("org_admin"),
    zValidator("json", replayTaskDomainProjectionSchema),
    async (c) => {
      const body = c.req.valid("json");

      if (body.scope === "task") {
        if (!body.taskId) {
          return c.json({ error: "taskId is required for task replay" }, 400);
        }

        const result = await deps.replayTaskDomainProjections(body.taskId);
        return c.json({ scope: "task", reason: body.reason, ...result });
      }

      if (!body.projectId) {
        return c.json({ error: "projectId is required for project replay" }, 400);
      }

      const result = await deps.replayTaskDomainProjectionsByProject(body.projectId);
      return c.json({
        scope: "project",
        reason: body.reason,
        confirmed: body.confirm === true,
        ...result,
      });
    },
  );
}
