import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  taskOperations,
  taskSessionRuns,
  type TaskSessionNodeStatus,
  type TaskUsageEntryKind,
} from "../../db/schema";
import type { TaskTreeRecord } from "../project-tree/task-view";
import {
  buildTaskSessionDefaultRunId,
  type UpsertTaskSessionRecordArgs,
} from "./task-session-write-api";
import type { TaskTreeSnapshot } from "../project-tree/task-types";

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

function buildSessionOperationWriteId(taskId: string, agentRunId: string) {
  return `session-operation:${taskId}:${agentRunId}`;
}

function normalizeRuntimeSessionId(taskId: string, sessionId?: string | null) {
  if (!sessionId) {
    return null;
  }

  const prefix = `task-session:${taskId}:`;
  return sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : sessionId;
}

export function createSessionOperationWriteApi(deps: {
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
}) {
  async function syncExecutionFactsForAgentRun(args: SyncExecutionFactsForAgentRunArgs) {
    const runtimeSessionId =
      normalizeRuntimeSessionId(args.task.id, args.sessionId) ?? `agent-run:${args.agentRunId}`;
    const taskSessionId = await deps.upsertTaskSessionRecord({
      task: args.task,
      runtimeSessionId,
      sourceType: "root",
      isActive: args.status === "running" || args.status === "pending" || args.status === "paused",
      archivedAt:
        args.status === "stopped" || args.status === "terminated"
          ? args.finishedAt ?? new Date().toISOString()
          : null,
    });

    const sessionOperationId = buildSessionOperationWriteId(args.task.id, args.agentRunId);
    const existing = await db.query.taskOperations.findFirst({
      where: eq(taskOperations.id, sessionOperationId),
    });
    const latestOperation = await db.query.taskOperations.findFirst({
      where: eq(taskOperations.sessionId, taskSessionId),
      orderBy: [desc(taskOperations.operationIndex)],
    });
    const operationIndex = existing?.operationIndex ?? (latestOperation?.operationIndex ?? -1) + 1;
    const tokenUsed = args.tokenUsed ?? 0;
    const taskNodeStatus = mapAgentRunStatusToTaskNodeStatus(args.status);
    const defaultRunId = buildTaskSessionDefaultRunId(taskSessionId);
    const now = new Date().toISOString();

    await db
      .insert(taskSessionRuns)
      .values({
        id: defaultRunId,
        taskId: args.task.id,
        sessionId: taskSessionId,
        attemptIndex: 1,
        runtimeSessionId,
        triggerType: "user_prompt",
        executionKind: mapAgentTypeToTaskOperationKind(args.agentType) === "judge" ? "judge" : "single",
        coordinationKey: taskSessionId,
        candidateIndex: args.candidateIndex ?? null,
        laneRole: mapAgentTypeToTaskOperationKind(args.agentType) === "judge" ? "judge" : "primary",
        executorKind: args.agentType,
        modelRoute: args.modelUsed ?? null,
        workflowStageKey: null,
        status: taskNodeStatus,
        inputTokens: 0,
        outputTokens: tokenUsed,
        totalTokens: tokenUsed,
        costUsd: 0,
        resultSummary: args.result ?? null,
        errorText: args.error ?? null,
        startedAt: args.startedAt ?? null,
        finishedAt: args.finishedAt ?? null,
        createdAt: args.startedAt ?? now,
      })
      .onConflictDoUpdate({
        target: taskSessionRuns.id,
        set: {
          runtimeSessionId,
          candidateIndex: args.candidateIndex ?? null,
          executorKind: args.agentType,
          modelRoute: args.modelUsed ?? null,
          status: taskNodeStatus,
          outputTokens: tokenUsed,
          totalTokens: tokenUsed,
          resultSummary: args.result ?? null,
          errorText: args.error ?? null,
          startedAt: args.startedAt ?? null,
          finishedAt: args.finishedAt ?? null,
        },
      });

    await db
      .insert(taskOperations)
      .values({
        id: sessionOperationId,
        taskId: args.task.id,
        sessionId: taskSessionId,
        runId: defaultRunId,
        messageId: null,
        parentOperationId: null,
        runtimeOperationId: `agent-run:${args.agentRunId}`,
        operationIndex,
        operationKind: mapAgentTypeToTaskOperationKind(args.agentType),
        toolName: null,
        title: args.agentType,
        status: taskNodeStatus,
        summaryJson: {
          agentRunId: args.agentRunId,
          candidateIndex: args.candidateIndex ?? null,
          linkAgentRun: args.linkAgentRun ?? false,
        },
        startedAt: args.startedAt ?? null,
        finishedAt: args.finishedAt ?? null,
        createdAt: args.startedAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: taskOperations.id,
        set: {
          sessionId: taskSessionId,
          runId: defaultRunId,
          runtimeOperationId: `agent-run:${args.agentRunId}`,
          operationKind: mapAgentTypeToTaskOperationKind(args.agentType),
          title: args.agentType,
          status: taskNodeStatus,
          summaryJson: {
            agentRunId: args.agentRunId,
            candidateIndex: args.candidateIndex ?? null,
            linkAgentRun: args.linkAgentRun ?? false,
          },
          startedAt: args.startedAt ?? null,
          finishedAt: args.finishedAt ?? null,
          updatedAt: now,
        },
      });

    await deps.appendTaskUsageLedgerEntry({
      taskId: args.task.id,
      projectId: args.task.projectId,
      sessionId: taskSessionId,
      operationId: sessionOperationId,
      entryKind: mapAgentTypeToUsageEntryKind(args.agentType),
      modelId: args.modelUsed ?? null,
      requestCount: 1,
      outputTokens: tokenUsed,
      costUsd: 0,
      metadataJson: {
        agentRunId: args.agentRunId,
        status: args.status,
      },
    });

    if (deps.buildTaskTreeSnapshotFromRecord && deps.syncTaskAggregateFromSnapshot) {
      const snapshot = deps.buildTaskTreeSnapshotFromRecord(args.task, {
        status: mapAgentRunStatusToTaskStatus(args.status),
        sessionId: runtimeSessionId,
        agentRunId: args.agentRunId,
        result: args.result ?? args.task.result,
        selectedModel: args.modelUsed ?? args.task.selectedModel,
        startedAt: args.startedAt ?? args.task.startedAt,
        finishedAt: args.finishedAt ?? args.task.finishedAt,
      });
      await deps.syncTaskAggregateFromSnapshot(snapshot);
    }

    return {
      taskSessionId,
      sessionOperationId,
    };
  }

  return {
    syncExecutionFactsForAgentRun,
  };
}