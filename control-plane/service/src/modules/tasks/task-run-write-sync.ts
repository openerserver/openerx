import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  conversationSessions,
  tasks as taskAggregates,
  taskRunNodes,
  taskRuns,
} from "../../db/schema";
import type { TaskTreeRecord } from "../project-tree/task-view";
import type { AppendTaskDomainEventArgs } from "./task-domain-projector";
import { buildConversationSessionId } from "./task-session-read";

function mapAgentRunStatusToTaskDomainStatus(
  status: "pending" | "running" | "paused" | "completed" | "failed" | "stopped" | "terminated",
) {
  if (status === "stopped" || status === "terminated") {
    return "cancelled" as const;
  }

  return status;
}

function resolveTaskRunOrchestrationKind(task: TaskTreeRecord) {
  return task.executionMode ?? "single";
}

function buildTaskRunAggregateId(
  taskId: string,
  sessionId: string | null | undefined,
  agentRunId: string,
) {
  if (typeof sessionId === "string" && sessionId.trim()) {
    return `task_run:${taskId}:${sessionId}`;
  }

  return `task_run:${taskId}:agent:${agentRunId}`;
}

function buildTaskRunNodeKind(args: {
  orchestrationKind: "single" | "parallel" | "sequential-chain";
  agentType: string;
  candidateIndex?: number;
}) {
  const normalizedAgentType = args.agentType.trim().toLowerCase();

  if (normalizedAgentType.includes("judge")) {
    return "judge" as const;
  }
  if (normalizedAgentType.includes("hook")) {
    return "hook" as const;
  }
  if (normalizedAgentType.includes("resume")) {
    return "resume" as const;
  }
  if (args.orchestrationKind === "sequential-chain") {
    return "chain-step" as const;
  }
  if (args.orchestrationKind === "parallel" || args.candidateIndex !== undefined) {
    return "candidate" as const;
  }

  return "execution" as const;
}

function buildTaskRunNodeKey(nodeKind: string, agentRunId: string, candidateIndex?: number) {
  if (typeof candidateIndex === "number") {
    return `${nodeKind}:${candidateIndex}:${agentRunId}`;
  }

  return `${nodeKind}:${agentRunId}`;
}

function buildTaskRunNodeId(taskRunId: string, agentRunId: string) {
  return `${taskRunId}:node:${agentRunId}`;
}

type SyncExecutionFactsArgs = {
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

type PreparedSyncExecutionFacts = {
  args: SyncExecutionFactsArgs;
  now: string;
  orchestrationKind: "single" | "parallel" | "sequential-chain";
  taskRunStatus: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  taskRunId: string;
  taskRunNodeId: string;
  nodeKind: "execution" | "candidate" | "judge" | "chain-step" | "hook" | "resume";
  startedAt: string | null;
  finishedAt: string | null;
};

function resolveSyncExecutionTiming(args: SyncExecutionFactsArgs, now: string) {
  return {
    startedAt: args.startedAt ?? (args.status === "running" ? now : null),
    finishedAt:
      args.finishedAt ??
      (["completed", "failed", "stopped", "terminated"].includes(args.status) ? now : null),
  };
}

function prepareSyncExecutionFacts(args: SyncExecutionFactsArgs) {
  const now = new Date().toISOString();
  const orchestrationKind = resolveTaskRunOrchestrationKind(args.task);
  const taskRunStatus = mapAgentRunStatusToTaskDomainStatus(args.status);
  const taskRunId = buildTaskRunAggregateId(args.task.id, args.sessionId, args.agentRunId);
  const nodeKind = buildTaskRunNodeKind({
    orchestrationKind,
    agentType: args.agentType,
    candidateIndex: args.candidateIndex ?? undefined,
  });
  const taskRunNodeId = buildTaskRunNodeId(taskRunId, args.agentRunId);
  const { startedAt, finishedAt } = resolveSyncExecutionTiming(args, now);

  return {
    args,
    now,
    orchestrationKind,
    taskRunStatus,
    taskRunId,
    taskRunNodeId,
    nodeKind,
    startedAt,
    finishedAt,
  } satisfies PreparedSyncExecutionFacts;
}

function resolveCandidateCount(candidateIndex?: number | null) {
  return typeof candidateIndex === "number" ? Math.max(candidateIndex + 1, 1) : 1;
}

function buildTaskRunUpsertValues(prepared: PreparedSyncExecutionFacts) {
  const { args, now, orchestrationKind, taskRunStatus, taskRunId, startedAt, finishedAt } =
    prepared;

  return {
    id: taskRunId,
    taskId: args.task.id,
    projectId: args.task.projectId,
    orchestrationKind,
    triggerType: "user_execute" as const,
    sourceType: args.agentType,
    status: taskRunStatus,
    rootSessionId: args.sessionId ?? null,
    requestedModel: args.task.selectedModel,
    effectiveModel: args.modelUsed ?? args.task.selectedModel,
    candidateCount: resolveCandidateCount(args.candidateIndex),
    resultText: args.result ?? null,
    resultSummary: args.result ?? null,
    errorText: args.error ?? null,
    startedAt,
    finishedAt,
    createdAt: now,
    updatedAt: now,
  };
}

function buildTaskRunNodeUpsertValues(prepared: PreparedSyncExecutionFacts) {
  const { args, now, taskRunId, taskRunNodeId, nodeKind, taskRunStatus, startedAt, finishedAt } =
    prepared;

  return {
    id: taskRunNodeId,
    runId: taskRunId,
    taskId: args.task.id,
    projectId: args.task.projectId,
    nodeKind,
    nodeKey: buildTaskRunNodeKey(nodeKind, args.agentRunId, args.candidateIndex ?? undefined),
    title: args.task.title,
    instruction: args.task.prompt,
    candidateIndex: args.candidateIndex ?? null,
    agentType: args.agentType,
    modelUsed: args.modelUsed ?? args.task.selectedModel,
    sessionId: args.sessionId ?? null,
    agentRunId: args.linkAgentRun === false ? null : args.agentRunId,
    status: taskRunStatus,
    resultText: args.result ?? null,
    resultSummary: args.result ?? null,
    errorText: args.error ?? null,
    tokenUsed: args.tokenUsed ?? 0,
    startedAt,
    finishedAt,
    createdAt: now,
    updatedAt: now,
  };
}

function buildTaskAggregateSyncValues(prepared: PreparedSyncExecutionFacts) {
  const { args, now, taskRunId, taskRunStatus, startedAt, finishedAt } = prepared;

  return {
    currentRunId: taskRunId,
    currentSessionId: args.sessionId ?? args.task.sessionId,
    currentAgentRunId: args.agentRunId,
    status: taskRunStatus,
    latestResult: args.result ?? args.task.result,
    latestResultSummary: args.result ?? args.task.result,
    startedAt: startedAt ?? args.task.startedAt,
    finishedAt,
    updatedAt: now,
  };
}

function buildTaskRunNodeDomainEventArgs(
  prepared: PreparedSyncExecutionFacts,
  timelineSessionId: string | null,
): AppendTaskDomainEventArgs {
  const {
    args,
    orchestrationKind,
    taskRunId,
    taskRunNodeId,
    nodeKind,
    taskRunStatus,
    startedAt,
    finishedAt,
    now,
  } = prepared;

  return {
    projectId: args.task.projectId,
    taskId: args.task.id,
    runId: taskRunId,
    runNodeId: taskRunNodeId,
    sessionId: timelineSessionId,
    eventType: "task.run-node.upserted",
    payload: {
      taskRunId,
      taskRunNodeId,
      agentRunId: args.agentRunId,
      agentType: args.agentType,
      orchestrationKind,
      nodeKind,
      status: taskRunStatus,
      title: args.task.title,
      result: args.result ?? null,
      error: args.error ?? null,
      runtimeSessionId: args.sessionId ?? null,
      candidateIndex: args.candidateIndex ?? null,
      startedAt: startedAt ?? now,
      lastActivityAt: finishedAt ?? startedAt ?? now,
    },
    createdAt: finishedAt ?? startedAt ?? now,
  };
}

export function createTaskRunWriteSyncApi(deps: {
  appendTaskDomainEvent: (args: AppendTaskDomainEventArgs) => Promise<unknown>;
}) {
  async function resolveConversationTimelineSessionId(
    taskId: string,
    runtimeSessionId?: string | null,
  ) {
    if (!runtimeSessionId) {
      return null;
    }

    const conversationSessionId = buildConversationSessionId(taskId, runtimeSessionId);
    const existing = await db.query.conversationSessions.findFirst({
      where: eq(conversationSessions.id, conversationSessionId),
    });

    return existing?.id ?? null;
  }

  async function syncExecutionFactsForAgentRun(args: {
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
  }) {
    const prepared = prepareSyncExecutionFacts(args);
    const timelineSessionId = await resolveConversationTimelineSessionId(
      prepared.args.task.id,
      prepared.args.sessionId,
    );
    const taskRunValues = buildTaskRunUpsertValues(prepared);
    const taskRunNodeValues = buildTaskRunNodeUpsertValues(prepared);
    const aggregateValues = buildTaskAggregateSyncValues(prepared);

    await db.insert(taskRuns).values(taskRunValues).onConflictDoUpdate({
      target: taskRuns.id,
      set: taskRunValues,
    });

    await db.insert(taskRunNodes).values(taskRunNodeValues).onConflictDoUpdate({
      target: taskRunNodes.id,
      set: taskRunNodeValues,
    });

    await db.update(taskAggregates).set(aggregateValues).where(eq(taskAggregates.id, args.task.id));

    await deps.appendTaskDomainEvent(buildTaskRunNodeDomainEventArgs(prepared, timelineSessionId));

    return { taskRunId: prepared.taskRunId, taskRunNodeId: prepared.taskRunNodeId };
  }

  return {
    resolveConversationTimelineSessionId,
    syncExecutionFactsForAgentRun,
  };
}
