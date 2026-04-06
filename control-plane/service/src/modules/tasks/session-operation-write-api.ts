import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  type TaskSessionNodeStatus,
  type TaskUsageEntryKind,
  taskOperations,
  taskSessionRuns,
} from "../../db/schema";
import type { TaskTreeSnapshot } from "../project-tree/task-types";
import type { TaskTreeRecord } from "../project-tree/task-view";
import {
  type UpsertTaskSessionRecordArgs,
  buildTaskSessionDefaultRunId,
} from "./task-session-write-api";

type SyncExecutionFactsForAgentRunArgs = {
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
};

function mapAgentRunStatusToTaskStatus(status: SyncExecutionFactsForAgentRunArgs["status"]) {
  if (status === "completed") {
    return "completed" as const;
  }
  if (status === "failed") {
    return "failed" as const;
  }
  if (status === "stopped" || status === "terminated") {
    return "cancelled" as const;
  }
  if (status === "running" || status === "paused") {
    return "running" as const;
  }

  return "pending" as const;
}

function mapAgentRunStatusToTaskNodeStatus(
  status: SyncExecutionFactsForAgentRunArgs["status"],
): TaskSessionNodeStatus {
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "stopped" || status === "terminated") {
    return "cancelled";
  }
  if (status === "running" || status === "paused") {
    return "running";
  }

  return "queued";
}

function mapAgentTypeToUsageEntryKind(agentType: string): TaskUsageEntryKind {
  const normalized = agentType.toLowerCase();
  if (normalized.includes("judge")) {
    return "judge_request";
  }
  if (normalized.includes("hook")) {
    return "hook_request";
  }
  if (normalized.includes("tool")) {
    return "tool_request";
  }

  return "model_request";
}

function mapAgentTypeToTaskOperationKind(agentType: string) {
  const normalized = agentType.toLowerCase();
  if (normalized.includes("judge")) {
    return "judge" as const;
  }
  if (normalized.includes("hook")) {
    return "hook" as const;
  }
  if (normalized.includes("resume")) {
    return "resume" as const;
  }
  if (normalized.includes("system")) {
    return "system" as const;
  }

  return "model_request" as const;
}

function buildTaskOperationWriteId(taskId: string, agentRunId: string) {
  return `session-operation:${taskId}:${agentRunId}`;
}

function buildTaskOperationSummary(args: SyncExecutionFactsForAgentRunArgs) {
  return {
    agentRunId: args.agentRunId,
    agentType: args.agentType,
    candidateIndex: args.candidateIndex ?? null,
    linkAgentRun: args.linkAgentRun ?? false,
    modelUsed: args.modelUsed ?? null,
    tokenUsed: args.tokenUsed ?? 0,
    resultText: args.result ?? null,
    errorText: args.error ?? null,
    status: args.status,
  } satisfies Record<string, unknown>;
}

function normalizeRuntimeSessionId(taskId: string, sessionId?: string | null) {
  if (!sessionId) {
    return null;
  }

  const prefix = `task-session:${taskId}:`;
  return sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : sessionId;
}

type CreateTaskOperationWriteApiDeps = {
  upsertTaskSessionRecord: (args: UpsertTaskSessionRecordArgs) => Promise<string>;
  buildTaskTreeSnapshotFromRecord?: (
    task: TaskTreeRecord,
    updates: Record<string, unknown>,
  ) => TaskTreeSnapshot;
  syncTaskAggregateFromSnapshot?: (snapshot: TaskTreeSnapshot) => Promise<void>;
  appendTaskUsageLedgerEntry: (args: {
    taskId: string;
    projectId: string;
    sessionId?: string | null;
    operationId?: string | null;
    entryKind: TaskUsageEntryKind;
    providerId?: string | null;
    modelId?: string | null;
    requestCount?: number;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    metadataJson?: Record<string, unknown>;
  }) => Promise<{ id: string }>;
};

type AgentRunWriteContext = {
  runtimeSessionId: string;
  taskOperationId: string;
  taskSessionId: string;
  operationIndex: number;
  tokenUsed: number;
  taskNodeStatus: TaskSessionNodeStatus;
  defaultRunId: string;
  now: string;
  operationKind: ReturnType<typeof mapAgentTypeToTaskOperationKind>;
  usageEntryKind: TaskUsageEntryKind;
  isJudgeOperation: boolean;
};

function isAgentRunSessionActive(status: SyncExecutionFactsForAgentRunArgs["status"]) {
  return status === "running" || status === "pending" || status === "paused";
}

function resolveAgentRunArchivedAt(args: SyncExecutionFactsForAgentRunArgs) {
  if (args.status !== "stopped" && args.status !== "terminated") {
    return null;
  }

  return args.finishedAt ?? new Date().toISOString();
}

function resolveTaskSessionRunExecutionKind(isJudgeOperation: boolean) {
  return isJudgeOperation ? "judge" : "single";
}

function resolveTaskSessionRunLaneRole(isJudgeOperation: boolean) {
  return isJudgeOperation ? "judge" : "primary";
}

async function ensureTaskSessionForAgentRun(
  deps: CreateTaskOperationWriteApiDeps,
  args: SyncExecutionFactsForAgentRunArgs,
  taskOperationId: string,
  runtimeSessionId: string,
) {
  return deps.upsertTaskSessionRecord({
    task: args.task,
    runtimeSessionId,
    sourceType: "root",
    operationId: taskOperationId,
    isActive: isAgentRunSessionActive(args.status),
    archivedAt: resolveAgentRunArchivedAt(args),
  });
}

async function resolveTaskOperationIndex(taskOperationId: string, taskSessionId: string) {
  const existing = await db.query.taskOperations.findFirst({
    where: eq(taskOperations.id, taskOperationId),
  });
  const latestOperation = await db.query.taskOperations.findFirst({
    where: eq(taskOperations.sessionId, taskSessionId),
    orderBy: [desc(taskOperations.operationIndex)],
  });

  return existing?.operationIndex ?? (latestOperation?.operationIndex ?? -1) + 1;
}

async function buildAgentRunWriteContext(
  deps: CreateTaskOperationWriteApiDeps,
  args: SyncExecutionFactsForAgentRunArgs,
): Promise<AgentRunWriteContext> {
  const runtimeSessionId =
    normalizeRuntimeSessionId(args.task.id, args.sessionId) ?? `agent-run:${args.agentRunId}`;
  const taskOperationId = buildTaskOperationWriteId(args.task.id, args.agentRunId);
  const taskSessionId = await ensureTaskSessionForAgentRun(
    deps,
    args,
    taskOperationId,
    runtimeSessionId,
  );
  const operationKind = mapAgentTypeToTaskOperationKind(args.agentType);
  const isJudgeOperation = operationKind === "judge";

  return {
    runtimeSessionId,
    taskOperationId,
    taskSessionId,
    operationIndex: await resolveTaskOperationIndex(taskOperationId, taskSessionId),
    tokenUsed: args.tokenUsed ?? 0,
    taskNodeStatus: mapAgentRunStatusToTaskNodeStatus(args.status),
    defaultRunId: buildTaskSessionDefaultRunId(taskSessionId),
    now: new Date().toISOString(),
    operationKind,
    usageEntryKind: mapAgentTypeToUsageEntryKind(args.agentType),
    isJudgeOperation,
  };
}

async function upsertTaskSessionRunFacts(
  args: SyncExecutionFactsForAgentRunArgs,
  context: AgentRunWriteContext,
) {
  await db
    .insert(taskSessionRuns)
    .values({
      id: context.defaultRunId,
      taskId: args.task.id,
      sessionId: context.taskSessionId,
      attemptIndex: 1,
      runtimeSessionId: context.runtimeSessionId,
      triggerType: "user_prompt",
      executionKind: resolveTaskSessionRunExecutionKind(context.isJudgeOperation),
      coordinationKey: context.taskSessionId,
      candidateIndex: args.candidateIndex ?? null,
      laneRole: resolveTaskSessionRunLaneRole(context.isJudgeOperation),
      executorKind: args.agentType,
      modelRoute: args.modelUsed ?? null,
      workflowStageKey: null,
      status: context.taskNodeStatus,
      inputTokens: 0,
      outputTokens: context.tokenUsed,
      totalTokens: context.tokenUsed,
      costUsd: 0,
      resultSummary: args.result ?? null,
      errorText: args.error ?? null,
      startedAt: args.startedAt ?? null,
      finishedAt: args.finishedAt ?? null,
      createdAt: args.startedAt ?? context.now,
    })
    .onConflictDoUpdate({
      target: taskSessionRuns.id,
      set: {
        runtimeSessionId: context.runtimeSessionId,
        candidateIndex: args.candidateIndex ?? null,
        executorKind: args.agentType,
        modelRoute: args.modelUsed ?? null,
        status: context.taskNodeStatus,
        outputTokens: context.tokenUsed,
        totalTokens: context.tokenUsed,
        resultSummary: args.result ?? null,
        errorText: args.error ?? null,
        startedAt: args.startedAt ?? null,
        finishedAt: args.finishedAt ?? null,
      },
    });
}

async function upsertTaskOperationFacts(
  args: SyncExecutionFactsForAgentRunArgs,
  context: AgentRunWriteContext,
) {
  await db
    .insert(taskOperations)
    .values({
      id: context.taskOperationId,
      taskId: args.task.id,
      sessionId: context.taskSessionId,
      runId: context.defaultRunId,
      messageId: null,
      parentOperationId: null,
      runtimeOperationId: `agent-run:${args.agentRunId}`,
      operationIndex: context.operationIndex,
      operationKind: context.operationKind,
      toolName: null,
      title: args.agentType,
      status: context.taskNodeStatus,
      summaryJson: buildTaskOperationSummary(args),
      startedAt: args.startedAt ?? null,
      finishedAt: args.finishedAt ?? null,
      createdAt: args.startedAt ?? context.now,
      updatedAt: context.now,
    })
    .onConflictDoUpdate({
      target: taskOperations.id,
      set: {
        sessionId: context.taskSessionId,
        runId: context.defaultRunId,
        runtimeOperationId: `agent-run:${args.agentRunId}`,
        operationKind: context.operationKind,
        title: args.agentType,
        status: context.taskNodeStatus,
        summaryJson: buildTaskOperationSummary(args),
        startedAt: args.startedAt ?? null,
        finishedAt: args.finishedAt ?? null,
        updatedAt: context.now,
      },
    });
}

async function appendAgentRunUsageEntry(
  deps: CreateTaskOperationWriteApiDeps,
  args: SyncExecutionFactsForAgentRunArgs,
  context: AgentRunWriteContext,
) {
  await deps.appendTaskUsageLedgerEntry({
    taskId: args.task.id,
    projectId: args.task.projectId,
    sessionId: context.taskSessionId,
    operationId: context.taskOperationId,
    entryKind: context.usageEntryKind,
    modelId: args.modelUsed ?? null,
    requestCount: 1,
    outputTokens: context.tokenUsed,
    costUsd: 0,
    metadataJson: {
      agentRunId: args.agentRunId,
      status: args.status,
    },
  });
}

async function syncTaskAggregateSnapshotFromAgentRun(
  deps: CreateTaskOperationWriteApiDeps,
  args: SyncExecutionFactsForAgentRunArgs,
  context: AgentRunWriteContext,
) {
  if (!deps.buildTaskTreeSnapshotFromRecord || !deps.syncTaskAggregateFromSnapshot) {
    return;
  }

  const snapshot = deps.buildTaskTreeSnapshotFromRecord(args.task, {
    status: mapAgentRunStatusToTaskStatus(args.status),
    sessionId: context.runtimeSessionId,
    agentRunId: args.agentRunId,
    result: args.result ?? args.task.result,
    selectedModel: args.modelUsed ?? args.task.selectedModel,
    startedAt: args.startedAt ?? args.task.startedAt,
    finishedAt: args.finishedAt ?? args.task.finishedAt,
  });
  await deps.syncTaskAggregateFromSnapshot(snapshot);
}

export function createTaskOperationWriteApi(deps: CreateTaskOperationWriteApiDeps) {
  async function syncExecutionFactsForAgentRun(args: SyncExecutionFactsForAgentRunArgs) {
    const context = await buildAgentRunWriteContext(deps, args);

    await upsertTaskSessionRunFacts(args, context);
    await upsertTaskOperationFacts(args, context);
    await appendAgentRunUsageEntry(deps, args, context);
    await syncTaskAggregateSnapshotFromAgentRun(deps, args, context);

    return {
      taskSessionId: context.taskSessionId,
      taskOperationId: context.taskOperationId,
    };
  }

  return {
    syncExecutionFactsForAgentRun,
  };
}
