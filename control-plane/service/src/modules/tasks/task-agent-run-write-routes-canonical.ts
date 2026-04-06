import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../middleware/auth";
import type { TaskTreeRecord } from "../project-tree/task-view";
import { loadCanonicalAgentRun, type CanonicalAgentRunRecord } from "./agent-run-compat";

const TERMINAL_AGENT_RUN_STATUSES = ["completed", "failed", "stopped", "terminated"] as const;

const createRunSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  agentType: z.string().min(1),
  status: z
    .enum(["pending", "running", "paused", "completed", "failed", "stopped", "terminated"])
    .optional(),
  modelUsed: z.string().optional(),
  tokenUsed: z.number().int().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
  candidateIndex: z.number().int().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});

const updateRunSchema = z.object({
  status: z.enum(["running", "paused", "completed", "failed", "stopped", "terminated"]),
  modelUsed: z.string().optional(),
  tokenUsed: z.number().int().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});

type CreateRunInput = z.infer<typeof createRunSchema>;
type UpdateRunInput = z.infer<typeof updateRunSchema>;
type AgentRunStatus = NonNullable<CreateRunInput["status"]>;
type AgentRunRecord = CanonicalAgentRunRecord;

function isTerminalAgentRunStatus(status: AgentRunStatus) {
  return TERMINAL_AGENT_RUN_STATUSES.includes(
    status as (typeof TERMINAL_AGENT_RUN_STATUSES)[number],
  );
}

function resolveAgentRunTiming(args: {
  status: AgentRunStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  existingStartedAt?: string | null;
  existingFinishedAt?: string | null;
}) {
  const startedAt =
    args.startedAt ??
    (args.status === "running" && !args.existingStartedAt ? new Date().toISOString() : null);
  const finishedAt =
    args.finishedAt ??
    (isTerminalAgentRunStatus(args.status)
      ? new Date().toISOString()
      : (args.existingFinishedAt ?? null));

  return {
    startedAt: startedAt ?? args.existingStartedAt ?? null,
    finishedAt,
  };
}

function buildUpdateAgentRunValues(args: {
  body: UpdateRunInput;
  existing: AgentRunRecord;
}) {
  const timing = resolveAgentRunTiming({
    status: args.body.status,
    startedAt: args.body.startedAt ?? null,
    finishedAt: args.body.finishedAt ?? null,
    existingStartedAt: args.existing.startedAt,
    existingFinishedAt: args.existing.finishedAt,
  });

  const updates: Record<string, unknown> = {
    status: args.body.status,
    startedAt: timing.startedAt,
    finishedAt: timing.finishedAt,
  };

  if (args.body.modelUsed) updates.modelUsed = args.body.modelUsed;
  if (args.body.tokenUsed !== undefined) updates.tokenUsed = args.body.tokenUsed;
  if (args.body.result) updates.result = args.body.result;
  if (args.body.error) updates.error = args.body.error;

  return updates;
}

async function createTaskAgentRun(args: {
  taskId: string;
  body: CreateRunInput;
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
  syncExecutionFactsForAgentRun: (args: {
    task: TaskTreeRecord;
    agentRunId: string;
    linkAgentRun?: boolean;
    sessionId?: string | null;
    agentType: string;
    status: AgentRunStatus;
    modelUsed?: string | null;
    tokenUsed?: number | null;
    result?: string | null;
    error?: string | null;
    candidateIndex?: number | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }) => Promise<{
    taskSessionId: string;
    taskOperationId: string;
  }>;
}) {
  const task = await args.loadTaskTreeBackedRecord(args.taskId);
  if (!task) {
    return { ok: false as const, status: 404 as const, payload: { error: "Task not found" } };
  }

  const runId = args.body.id || crypto.randomUUID();
  const existing = await loadCanonicalAgentRun(runId);
  if (existing) {
    return { ok: true as const, status: 200 as const, payload: existing };
  }

  const status = args.body.status ?? "pending";
  await args.syncExecutionFactsForAgentRun({
    task,
    agentRunId: runId,
    linkAgentRun: false,
    sessionId: args.body.sessionId ?? null,
    agentType: args.body.agentType,
    status,
    modelUsed: args.body.modelUsed ?? null,
    tokenUsed: args.body.tokenUsed ?? 0,
    result: args.body.result ?? null,
    error: args.body.error ?? null,
    candidateIndex: args.body.candidateIndex ?? null,
    startedAt: args.body.startedAt ?? null,
    finishedAt: args.body.finishedAt ?? null,
  });

  return { ok: true as const, status: 201 as const, payload: { id: runId, status } };
}

async function updateTaskAgentRun(args: {
  taskId: string;
  runId: string;
  body: UpdateRunInput;
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
  syncExecutionFactsForAgentRun: (args: {
    task: TaskTreeRecord;
    agentRunId: string;
    linkAgentRun?: boolean;
    sessionId?: string | null;
    agentType: string;
    status: AgentRunStatus;
    modelUsed?: string | null;
    tokenUsed?: number | null;
    result?: string | null;
    error?: string | null;
    candidateIndex?: number | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }) => Promise<{
    taskSessionId: string;
    taskOperationId: string;
  }>;
}) {
  const existing = await loadCanonicalAgentRun(args.runId);
  if (!existing) {
    return { ok: false as const, status: 404 as const, payload: { error: "Agent run not found" } };
  }

  const task = await args.loadTaskTreeBackedRecord(args.taskId);
  if (!task) {
    return { ok: false as const, status: 404 as const, payload: { error: "Task not found" } };
  }

  const timing = resolveAgentRunTiming({
    status: args.body.status,
    startedAt: args.body.startedAt ?? null,
    finishedAt: args.body.finishedAt ?? null,
    existingStartedAt: existing.startedAt,
    existingFinishedAt: existing.finishedAt,
  });
  await args.syncExecutionFactsForAgentRun({
    task,
    agentRunId: args.runId,
    sessionId: existing.sessionId,
    agentType: existing.agentType,
    status: args.body.status,
    modelUsed: args.body.modelUsed ?? existing.modelUsed,
    tokenUsed: args.body.tokenUsed ?? existing.tokenUsed,
    result: args.body.result ?? existing.result,
    error: args.body.error ?? existing.error,
    candidateIndex: existing.candidateIndex,
    startedAt: timing.startedAt,
    finishedAt: timing.finishedAt,
  });

  const updates = buildUpdateAgentRunValues({
    body: args.body,
    existing,
  });

  return {
    ok: true as const,
    status: 200 as const,
    payload: { id: args.runId, ...updates },
  };
}

export function registerTaskAgentRunWriteRoutes(
  taskRoutes: Hono<AppEnv>,
  deps: {
    loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
    syncExecutionFactsForAgentRun: (args: {
      task: TaskTreeRecord;
      agentRunId: string;
      linkAgentRun?: boolean;
      sessionId?: string | null;
      agentType: string;
      status: "pending" | "running" | "paused" | "completed" | "failed" | "stopped" | "terminated";
      modelUsed?: string | null;
      tokenUsed?: number | null;
      result?: string | null;
      error?: string | null;
      candidateIndex?: number | null;
      startedAt?: string | null;
      finishedAt?: string | null;
    }) => Promise<{
      taskSessionId: string;
      taskOperationId: string;
    }>;
  },
) {
  taskRoutes.post("/:taskId/runs", zValidator("json", createRunSchema), async (c) => {
    const taskId = c.req.param("taskId");
    const body = c.req.valid("json") as CreateRunInput;
    const result = await createTaskAgentRun({
      taskId,
      body,
      loadTaskTreeBackedRecord: deps.loadTaskTreeBackedRecord,
      syncExecutionFactsForAgentRun: deps.syncExecutionFactsForAgentRun,
    });

    return c.json(result.payload, result.status);
  });

  taskRoutes.patch("/:taskId/runs/:runId", zValidator("json", updateRunSchema), async (c) => {
    const taskId = c.req.param("taskId");
    const runId = c.req.param("runId");
    const body = c.req.valid("json") as UpdateRunInput;
    const result = await updateTaskAgentRun({
      taskId,
      runId,
      body,
      loadTaskTreeBackedRecord: deps.loadTaskTreeBackedRecord,
      syncExecutionFactsForAgentRun: deps.syncExecutionFactsForAgentRun,
    });

    return c.json(result.payload, result.status);
  });
}
