import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { taskRuns } from "../../db/schema";
import type { AppEnv } from "../../middleware/auth";
import { listTaskRunDetailNodes } from "./task-run-detail";

const adoptDomainRunCandidateSchema = z.object({
  stoppedCandidates: z
    .array(
      z.object({
        candidateIndex: z.number().int().nonnegative(),
        status: z.enum(["failed", "cancelled"]).optional(),
        resultText: z.string().optional(),
        errorText: z.string().optional(),
      }),
    )
    .optional(),
});

export function registerTaskDomainRunRoutes(
  taskRoutes: Hono<AppEnv>,
  deps: {
    adoptDomainRunCandidate: (args: {
      taskId: string;
      runId: string;
      candidateIndex: number;
      stoppedCandidates?: Array<{
        candidateIndex: number;
        status?: "failed" | "cancelled";
        resultText?: string;
        errorText?: string;
      }>;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
  },
) {
  taskRoutes.get("/:taskId/domain-runs", async (c) => {
    const taskId = c.req.param("taskId");

    const runs = await db
      .select()
      .from(taskRuns)
      .where(eq(taskRuns.taskId, taskId))
      .orderBy(desc(taskRuns.createdAt));

    return c.json({ data: runs });
  });

  taskRoutes.get("/:taskId/domain-runs/:runId", async (c) => {
    const taskId = c.req.param("taskId");
    const runId = c.req.param("runId");

    const run = await db.query.taskRuns.findFirst({
      where: and(eq(taskRuns.taskId, taskId), eq(taskRuns.id, runId)),
    });

    if (!run) {
      return c.json({ error: "Task domain run not found" }, 404);
    }

    const nodeDetail = await listTaskRunDetailNodes({
      taskId,
      runId,
      winnerNodeId: run.winnerNodeId,
    });

    return c.json({
      data: {
        run,
        ...nodeDetail,
      },
    });
  });

  taskRoutes.post(
    "/:taskId/domain-runs/:runId/candidates/:candidateIndex/adopt",
    zValidator("json", adoptDomainRunCandidateSchema),
    async (c) => {
      const taskId = c.req.param("taskId");
      const runId = c.req.param("runId");
      const candidateIndex = Number(c.req.param("candidateIndex"));
      if (Number.isNaN(candidateIndex) || candidateIndex < 0) {
        return c.json({ error: "Invalid candidate index" }, 400);
      }

      const body = c.req.valid("json");
      const result = await deps.adoptDomainRunCandidate({
        taskId,
        runId,
        candidateIndex,
        stoppedCandidates: body.stoppedCandidates,
      });
      if (!result.ok) {
        return c.json({ error: result.error }, result.status as 400 | 404 | 500);
      }

      return c.json({ data: result.data });
    },
  );
}
