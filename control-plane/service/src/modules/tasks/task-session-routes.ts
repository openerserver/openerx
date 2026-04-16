import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../middleware/auth";
import { createTaskBranchSchema, persistTaskBranchMessageSchema } from "./task-branch-write";
import { resolveTaskByRuntimeSessionId } from "./task-route-builder-shared";
import { postTaskSessionMessageSchema } from "./task-session-message-dto";

const upsertTaskPhaseSchema = z.object({
  id: z.string().min(1).optional(),
  parentPhaseId: z.string().min(1).nullable().optional(),
  phaseKind: z.enum(["root", "single", "parallel", "sequential_chain", "manual_branch", "hook"]),
  triggerType: z.enum([
    "execute",
    "continue",
    "resume",
    "workflow_spawn",
    "candidate_adopt",
    "manual_branch",
    "hook_spawn",
  ]),
  status: z
    .enum(["pending", "running", "paused", "awaiting_adoption", "completed", "failed", "cancelled"])
    .optional(),
  resumedFromPhaseId: z.string().min(1).nullable().optional(),
  anchorSessionId: z.string().min(1).nullable().optional(),
  anchorMessageId: z.string().min(1).nullable().optional(),
  candidateCount: z.number().int().min(0).nullable().optional(),
  winnerSessionId: z.string().min(1).nullable().optional(),
  judgeSessionId: z.string().min(1).nullable().optional(),
  requestedModel: z.string().min(1).nullable().optional(),
  effectiveModel: z.string().min(1).nullable().optional(),
  resultSummary: z.string().nullable().optional(),
  errorText: z.string().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  finishedAt: z.string().datetime().nullable().optional(),
  currentSessionId: z.string().min(1).nullable().optional(),
  latestSessionId: z.string().min(1).nullable().optional(),
});

const adoptTaskPhaseSchema = z.object({
  winnerSessionId: z.string().min(1),
});

const cancelTaskPhaseSchema = z.object({
  reason: z
    .enum(["winner_adopted", "user_cancelled", "runtime_terminated", "runtime_failed", "timeout", "superseded"])
    .default("user_cancelled"),
  terminateRunningSessions: z.boolean().optional(),
});

const resumeTaskPhaseSchema = z.object({
  mode: z.enum(["reuse"]).default("reuse"),
});

function getIncludeLineage(queryValue: string | undefined) {
  return queryValue !== "false";
}

export function registerTaskSessionRoutes(
  taskRoutes: Hono<AppEnv>,
  deps: {
    upsertTaskSession: (
      taskId: string,
      body: z.infer<typeof createTaskBranchSchema>,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    persistTaskSessionMessage: (
      taskId: string,
      body: z.infer<typeof persistTaskBranchMessageSchema>,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    postTaskSessionMessage: (args: {
      taskId: string;
      sessionId: string;
      client_message_id: string;
      text: string;
      attachments: Array<Record<string, unknown>>;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
      details?: unknown;
    }>;
    listTaskPhases: (taskId: string) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    getTaskPhaseView: (args: {
      taskId: string;
      phaseId: string;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    upsertTaskPhase: (
      taskId: string,
      body: z.infer<typeof upsertTaskPhaseSchema>,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    adoptTaskPhase: (args: {
      taskId: string;
      phaseId: string;
      winnerSessionId: string;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    cancelTaskPhase: (args: {
      taskId: string;
      phaseId: string;
      reason: "winner_adopted" | "user_cancelled" | "runtime_terminated" | "runtime_failed" | "timeout" | "superseded";
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    resumeTaskPhase: (args: {
      taskId: string;
      phaseId: string;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    activateTaskSession: (
      taskId: string,
      sessionId: string,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    archiveTaskSession: (
      taskId: string,
      sessionId: string,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    listTaskSessions: (taskId: string) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    getTaskSession: (
      taskId: string,
      sessionId: string,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    buildTaskConversationMessagesResponse: (args: {
      taskId: string;
      sessionId?: string | null;
      includeLineage: boolean;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    buildTaskNormalizedConversationQueryResponse: (args: {
      taskId: string;
      sessionId?: string | null;
      includeLineage: boolean;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    listTaskSessionMessages: (
      taskId: string,
      sessionId: string,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    listTaskSessionOperations: (
      taskId: string,
      sessionId: string,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    listTaskSessionArtifacts: (
      taskId: string,
      sessionId: string,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    listTaskUsageLedgerEntries: (
      taskId: string,
      sessionId?: string | null,
    ) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    buildTaskSessionTimelineViewResponse: (args: {
      taskId: string;
      sessionId?: string | null;
      includeLineage: boolean;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    buildTaskTreeResponse: (args: {
      taskId: string;
      sessionId?: string | null;
      includeLineage: boolean;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    buildTaskTimelineResponse: (args: {
      taskId: string;
      sessionId?: string | null;
      includeLineage: boolean;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
    buildTaskExecutionTraceResponse: (args: {
      taskId: string;
      sessionId?: string | null;
      includeLineage: boolean;
    }) => Promise<{
      ok: boolean;
      status: number;
      error?: string;
      data?: unknown;
    }>;
  },
) {
  // Lookup route — must come before /:taskId routes to avoid conflict.
  taskRoutes.get("/lookup/session-task/:runtimeSessionId", async (c) => {
    const runtimeSessionId = c.req.param("runtimeSessionId");
    const result = await resolveTaskByRuntimeSessionId(runtimeSessionId);
    if (!result) {
      return c.json({ error: "No task found for session" }, 404);
    }
    return c.json(result, 200);
  });

  taskRoutes.post("/:taskId/sessions", zValidator("json", createTaskBranchSchema), async (c) => {
    const taskId = c.req.param("taskId");
    const result = await deps.upsertTaskSession(taskId, c.req.valid("json"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200 | 201);
  });

  taskRoutes.post(
    "/:taskId/sessions/:sessionId/messages",
    zValidator("json", postTaskSessionMessageSchema),
    async (c) => {
      const result = await deps.postTaskSessionMessage({
        taskId: c.req.param("taskId"),
        sessionId: c.req.param("sessionId"),
        ...c.req.valid("json"),
      });
      if (!result.ok) {
        return c.json(
          { error: result.error, details: result.details },
          result.status as 400 | 404 | 409 | 500,
        );
      }

      return c.json(result.data, result.status as 200 | 201);
    },
  );
  taskRoutes.post(
    "/:taskId/sessions/messages",
    zValidator("json", persistTaskBranchMessageSchema),
    async (c) => {
      const taskId = c.req.param("taskId");
      const result = await deps.persistTaskSessionMessage(taskId, c.req.valid("json"));
      if (!result.ok) {
        return c.json({ error: result.error }, result.status as 404 | 500);
      }

      return c.json(result.data, result.status as 201 | 202);
    },
  );

  taskRoutes.get("/:taskId/sessions", async (c) => {
    const taskId = c.req.param("taskId");
    const result = await deps.listTaskSessions(taskId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/phases", async (c) => {
    const taskId = c.req.param("taskId");
    const result = await deps.listTaskPhases(taskId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/phases/:phaseId/view", async (c) => {
    const result = await deps.getTaskPhaseView({
      taskId: c.req.param("taskId"),
      phaseId: c.req.param("phaseId"),
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.post("/:taskId/phases", zValidator("json", upsertTaskPhaseSchema), async (c) => {
    const taskId = c.req.param("taskId");
    const result = await deps.upsertTaskPhase(taskId, c.req.valid("json"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 404 | 500);
    }

    return c.json(result.data, result.status as 200 | 201);
  });

  taskRoutes.post(
    "/:taskId/phases/:phaseId/adopt",
    zValidator("json", adoptTaskPhaseSchema),
    async (c) => {
      const result = await deps.adoptTaskPhase({
        taskId: c.req.param("taskId"),
        phaseId: c.req.param("phaseId"),
        winnerSessionId: c.req.valid("json").winnerSessionId,
      });
      if (!result.ok) {
        return c.json({ error: result.error }, result.status as 400 | 404 | 409 | 500);
      }

      return c.json(result.data, result.status as 200);
    },
  );

  taskRoutes.post(
    "/:taskId/phases/:phaseId/cancel",
    zValidator("json", cancelTaskPhaseSchema),
    async (c) => {
      const body = c.req.valid("json");
      const result = await deps.cancelTaskPhase({
        taskId: c.req.param("taskId"),
        phaseId: c.req.param("phaseId"),
        reason: body.reason,
      });
      if (!result.ok) {
        return c.json({ error: result.error }, result.status as 400 | 404 | 409 | 500);
      }

      return c.json(result.data, result.status as 200);
    },
  );

  taskRoutes.post(
    "/:taskId/phases/:phaseId/resume",
    zValidator("json", resumeTaskPhaseSchema),
    async (c) => {
      const result = await deps.resumeTaskPhase({
        taskId: c.req.param("taskId"),
        phaseId: c.req.param("phaseId"),
      });
      if (!result.ok) {
        return c.json({ error: result.error }, result.status as 404 | 409 | 500);
      }

      return c.json(result.data, result.status as 200);
    },
  );

  taskRoutes.get("/:taskId/sessions/:sessionId", async (c) => {
    const taskId = c.req.param("taskId");
    const sessionId = c.req.param("sessionId");
    const result = await deps.getTaskSession(taskId, sessionId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/sessions/:sessionId/messages", async (c) => {
    return c.json(
      {
        error:
          "Deprecated route. Use /tasks/:taskId/query/normalized-conversation?sessionId=:sessionId",
      },
      410,
    );
  });

  taskRoutes.get("/:taskId/messages", async (c) => {
    return c.json(
      {
        error: "Deprecated route. Use /tasks/:taskId/query/normalized-conversation",
      },
      410,
    );
  });

  taskRoutes.get("/:taskId/query/normalized-conversation", async (c) => {
    const taskId = c.req.param("taskId");
    const result = await deps.buildTaskNormalizedConversationQueryResponse({
      taskId,
      sessionId: c.req.query("sessionId") || null,
      includeLineage: getIncludeLineage(c.req.query("includeLineage")),
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/tree", async (c) => {
    const taskId = c.req.param("taskId");
    const result = await deps.buildTaskTreeResponse({
      taskId,
      sessionId: c.req.query("sessionId") || null,
      includeLineage: getIncludeLineage(c.req.query("includeLineage")),
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/timeline", async (c) => {
    const taskId = c.req.param("taskId");
    const result = await deps.buildTaskTimelineResponse({
      taskId,
      sessionId: c.req.query("sessionId") || null,
      includeLineage: getIncludeLineage(c.req.query("includeLineage")),
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/sessions/:sessionId/operations", async (c) => {
    const taskId = c.req.param("taskId");
    const sessionId = c.req.param("sessionId");
    const result = await deps.listTaskSessionOperations(taskId, sessionId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/sessions/:sessionId/artifacts", async (c) => {
    const taskId = c.req.param("taskId");
    const sessionId = c.req.param("sessionId");
    const result = await deps.listTaskSessionArtifacts(taskId, sessionId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/sessions/:sessionId/usage-ledger", async (c) => {
    const taskId = c.req.param("taskId");
    const sessionId = c.req.param("sessionId");
    const result = await deps.listTaskUsageLedgerEntries(taskId, sessionId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/sessions/:sessionId/timeline", async (c) => {
    const taskId = c.req.param("taskId");
    const sessionId = c.req.param("sessionId");
    const result = await deps.buildTaskSessionTimelineViewResponse({
      taskId,
      sessionId,
      includeLineage: getIncludeLineage(c.req.query("includeLineage")),
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.get("/:taskId/execution-trace", async (c) => {
    const taskId = c.req.param("taskId");
    const runtimeSessionId = c.req.query("runtimeSessionId");
    if (runtimeSessionId) {
      return c.json({ error: "runtimeSessionId query has been removed; use sessionId." }, 410);
    }

    const result = await deps.buildTaskExecutionTraceResponse({
      taskId,
      sessionId: c.req.query("sessionId") || null,
      includeLineage: getIncludeLineage(c.req.query("includeLineage")),
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.post("/:taskId/sessions/:sessionId/activate", async (c) => {
    const taskId = c.req.param("taskId");
    const sessionId = c.req.param("sessionId");
    const result = await deps.activateTaskSession(taskId, sessionId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });

  taskRoutes.post("/:taskId/sessions/:sessionId/archive", async (c) => {
    const taskId = c.req.param("taskId");
    const sessionId = c.req.param("sessionId");
    const result = await deps.archiveTaskSession(taskId, sessionId);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 500);
    }

    return c.json(result.data, result.status as 200);
  });
}
