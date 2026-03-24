import { asc, eq, inArray } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { db as importedDb } from "../../db/index";
import { openPostgresDatabase } from "../../db/postgres-client";
import {
  type TaskTimelineItemKind,
  conversationMessages,
  tasks as taskAggregates,
  taskDomainEvents,
  taskRunNodes,
  taskSnapshots,
  taskTimelineViews,
} from "../../db/schema";
import * as schema from "../../db/schema";

type TaskDomainProjectionEventRecord = {
  id: string;
  projectId: string;
  taskId: string | null;
  runId: string | null;
  runNodeId: string | null;
  sessionId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  seq: number;
  createdAt: string;
};

type ProjectableTaskDomainEventRecord = TaskDomainProjectionEventRecord & {
  taskId: string;
};

export type AppendTaskDomainEventArgs = {
  projectId: string;
  taskId: string;
  runId?: string | null;
  runNodeId?: string | null;
  sessionId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt?: string;
};

let taskDomainEventSeqBase = 0;
let taskDomainEventSeqOffset = 0;
let projectorDbFallback: typeof importedDb | null = null;

function getProjectorDb() {
  if (
    typeof importedDb.select === "function" &&
    typeof importedDb.delete === "function" &&
    typeof importedDb.insert === "function" &&
    importedDb.query?.taskSnapshots &&
    importedDb.query?.tasks
  ) {
    return importedDb;
  }

  if (!projectorDbFallback) {
    const postgresRuntime = openPostgresDatabase({ logPrefix: "[db:postgres:projector]" });
    projectorDbFallback = drizzlePostgres(postgresRuntime.sql, { schema });
  }

  return projectorDbFallback;
}

const db = new Proxy({} as typeof importedDb, {
  get(_target, property, receiver) {
    return Reflect.get(getProjectorDb(), property, receiver);
  },
});

function nextTaskDomainEventSeq() {
  const base = Date.now() * 1000;
  if (taskDomainEventSeqBase === base) {
    taskDomainEventSeqOffset += 1;
  } else {
    taskDomainEventSeqBase = base;
    taskDomainEventSeqOffset = 0;
  }

  return base + taskDomainEventSeqOffset;
}

function buildTimelineItemKindFromMessageRole(role: string) {
  if (role === "user") {
    return "user-input";
  }
  if (role === "assistant") {
    return "assistant-output";
  }
  if (role === "tool") {
    return "tool-output";
  }

  return "system-event";
}

function buildTimelineItemKindFromMessagePartType(partType: string) {
  if (partType === "tool_call") {
    return "tool-call" as const;
  }
  if (partType === "tool_result") {
    return "tool-output" as const;
  }
  if (partType === "thinking") {
    return "thinking" as const;
  }
  if (partType === "file_reference") {
    return "file-reference" as const;
  }
  if (partType === "diff") {
    return "diff" as const;
  }

  return null;
}

function buildTimelineItemKindFromRunNodeKind(nodeKind: string) {
  if (nodeKind === "candidate") {
    return "candidate-result" as const;
  }
  if (nodeKind === "judge") {
    return "judge-decision" as const;
  }
  if (nodeKind === "chain-step") {
    return "chain-step-result" as const;
  }

  return "run-node" as const;
}

function buildTimelineItemKindFromRunNodeEvent(nodeKind: string, status: string) {
  if (status === "pending" || status === "running" || status === "paused") {
    return "status-transition" as const;
  }

  return buildTimelineItemKindFromRunNodeKind(nodeKind);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function describeSessionTimelineEvent(payload: Record<string, unknown>) {
  const branchName = asNullableString(payload.branchName);
  const sourceType = asNullableString(payload.sourceType) ?? "root";
  const runtimeSessionId = asNullableString(payload.runtimeSessionId);

  if (asNullableString(payload.archivedAt)) {
    return {
      itemKind: "session-archive" as const,
      title: branchName ?? "归档会话",
      displayText: branchName
        ? `归档会话 ${branchName}`
        : `归档会话 ${runtimeSessionId ?? "unknown"}`,
    };
  }

  if (sourceType === "fork" || sourceType === "sub_session") {
    return {
      itemKind: "session-branch" as const,
      title: branchName ?? "派生会话",
      displayText: branchName
        ? `切换到分支 ${branchName}`
        : `切换到派生会话 ${runtimeSessionId ?? "unknown"}`,
    };
  }

  return {
    itemKind: "session-activate" as const,
    title: branchName ?? "激活会话",
    displayText: branchName
      ? `激活会话 ${branchName}`
      : `激活会话 ${runtimeSessionId ?? "unknown"}`,
  };
}

function normalizeMessagePartSummaries(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<{
      partIndex: number;
      partType: string;
      textContent: string | null;
      title: string | null;
      metadata: Record<string, unknown> | null;
    }>;
  }

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      return {
        partIndex:
          typeof record.partIndex === "number" && Number.isFinite(record.partIndex)
            ? record.partIndex
            : index,
        partType: typeof record.partType === "string" ? record.partType : "text",
        textContent: asNullableString(record.textContent),
        title: asNullableString(record.title),
        metadata: asRecord(record.metadata),
      };
    })
    .filter(
      (
        part,
      ): part is {
        partIndex: number;
        partType: string;
        textContent: string | null;
        title: string | null;
        metadata: Record<string, unknown> | null;
      } => Boolean(part),
    );
}

function describeMessagePartTimelineEvent(partSummary: {
  partIndex: number;
  partType: string;
  textContent: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
}) {
  const metadata = partSummary.metadata;

  if (partSummary.partType === "tool_call") {
    return {
      title: partSummary.title,
      displayText:
        asNullableString(metadata?.argumentsSummary) ??
        partSummary.textContent ??
        partSummary.title,
      metadata,
    };
  }

  if (partSummary.partType === "tool_result") {
    return {
      title: partSummary.title,
      displayText:
        asNullableString(metadata?.outputSummary) ?? partSummary.textContent ?? partSummary.title,
      metadata,
    };
  }

  if (partSummary.partType === "file_reference") {
    return {
      title: partSummary.title,
      displayText:
        asNullableString(metadata?.locationSummary) ?? partSummary.textContent ?? partSummary.title,
      metadata,
    };
  }

  if (partSummary.partType === "diff") {
    return {
      title: partSummary.title,
      displayText:
        asNullableString(metadata?.diffSummary) ?? partSummary.textContent ?? partSummary.title,
      metadata,
    };
  }

  return {
    title: partSummary.title,
    displayText: partSummary.textContent ?? partSummary.title,
    metadata,
  };
}

function describeRunNodeTimelineEvent(payload: Record<string, unknown>) {
  const nodeKind = asNullableString(payload.nodeKind) ?? "execution";
  const status = asNullableString(payload.status) ?? "pending";
  const title = asNullableString(payload.title);
  const candidateIndex = typeof payload.candidateIndex === "number" ? payload.candidateIndex : null;
  const agentType = asNullableString(payload.agentType);
  const itemKind = buildTimelineItemKindFromRunNodeEvent(nodeKind, status);

  let defaultTitle = title;
  if (!defaultTitle && itemKind === "candidate-result" && candidateIndex !== null) {
    defaultTitle = `候选 ${candidateIndex + 1}`;
  }
  if (!defaultTitle && itemKind === "judge-decision") {
    defaultTitle = "Judge 决策";
  }
  if (!defaultTitle && itemKind === "chain-step-result" && candidateIndex !== null) {
    defaultTitle = `链式步骤 ${candidateIndex + 1}`;
  }
  if (!defaultTitle && agentType) {
    defaultTitle = agentType;
  }

  const displayText =
    asNullableString(payload.result) ??
    asNullableString(payload.error) ??
    (itemKind === "status-transition"
      ? `${defaultTitle ?? "执行节点"} 进入 ${status} 状态`
      : `${defaultTitle ?? "执行节点"} 已${status}`);

  return {
    itemKind,
    title: defaultTitle,
    displayText,
  };
}

function normalizeProjectionStatus(value: unknown) {
  if (
    value === "pending" ||
    value === "running" ||
    value === "paused" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return "pending" as const;
}

function normalizeProjectionOrchestrationKind(value: unknown) {
  if (value === "single" || value === "parallel" || value === "sequential-chain") {
    return value;
  }

  return null;
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

async function loadTaskProjectionBase(taskId: string) {
  const [snapshotRecord, aggregateRecord] = await Promise.all([
    db.query.taskSnapshots.findFirst({ where: eq(taskSnapshots.taskId, taskId) }),
    db.query.tasks.findFirst({ where: eq(taskAggregates.id, taskId) }),
  ]);

  return { snapshotRecord, aggregateRecord };
}

async function upsertTaskTimelineViewRecord(args: {
  id: string;
  projectId: string;
  taskId: string;
  runId?: string | null;
  runNodeId?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  itemKind: TaskTimelineItemKind;
  itemRole?: string | null;
  title?: string | null;
  displayText?: string | null;
  metadataJson?: Record<string, unknown> | null;
  sortAt: string;
  createdAt: string;
}) {
  const values = {
    id: args.id,
    projectId: args.projectId,
    taskId: args.taskId,
    runId: args.runId ?? null,
    runNodeId: args.runNodeId ?? null,
    sessionId: args.sessionId ?? null,
    messageId: args.messageId ?? null,
    itemKind: args.itemKind,
    itemRole: args.itemRole ?? null,
    title: args.title ?? null,
    displayText: args.displayText ?? null,
    metadataJson: args.metadataJson ?? null,
    sortAt: args.sortAt,
    createdAt: args.createdAt,
  };

  await db.insert(taskTimelineViews).values(values).onConflictDoUpdate({
    target: taskTimelineViews.id,
    set: values,
  });
}

async function resolveProjectionConversationMessageId(messageId: string | null) {
  if (!messageId) {
    return null;
  }

  const existingMessage = await db.query.conversationMessages.findFirst({
    where: eq(conversationMessages.id, messageId),
    columns: { id: true },
  });

  return existingMessage?.id ?? null;
}

function countRunNodesByKindAndStatus(
  runNodes: Array<{ nodeKind: string; status: string }>,
  nodeKind: string,
  statuses?: string[],
) {
  return runNodes.filter(
    (node) => node.nodeKind === nodeKind && (!statuses || statuses.includes(node.status)),
  ).length;
}

function resolveProjectionWinnerNodeId(
  runNodes: Array<{ id: string; nodeKind: string; status: string }>,
  winnerNodeId?: string | null,
) {
  return (
    winnerNodeId ??
    runNodes.find((node) => node.nodeKind === "candidate" && node.status === "completed")?.id ??
    runNodes.find((node) => node.nodeKind === "execution" && node.status === "completed")?.id ??
    null
  );
}

function buildTaskSnapshotProjectionValues(args: {
  taskId: string;
  projectId: string;
  currentStatus: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  orchestrationKind?: "single" | "parallel" | "sequential-chain" | null;
  currentRunId?: string | null;
  currentSessionId?: string | null;
  latestResult?: string | null;
  latestResultSummary?: string | null;
  latestErrorText?: string | null;
  winnerNodeId?: string | null;
  lastActivityAt?: string | null;
  now: string;
  activeCandidateCount: number;
  completedCandidateCount: number;
  failedCandidateCount: number;
  totalChainSteps: number;
  completedChainSteps: number;
}) {
  return {
    taskId: args.taskId,
    projectId: args.projectId,
    currentStatus: args.currentStatus,
    orchestrationKind: args.orchestrationKind ?? null,
    currentRunId: args.currentRunId ?? null,
    currentSessionId: args.currentSessionId ?? null,
    latestResult: args.latestResult ?? null,
    latestResultSummary: args.latestResultSummary ?? null,
    latestErrorText: args.latestErrorText ?? null,
    activeCandidateCount: args.activeCandidateCount,
    completedCandidateCount: args.completedCandidateCount,
    failedCandidateCount: args.failedCandidateCount,
    totalChainSteps: args.totalChainSteps,
    completedChainSteps: args.completedChainSteps,
    winnerNodeId: args.winnerNodeId ?? null,
    lastActivityAt: args.lastActivityAt ?? args.now,
    updatedAt: args.now,
  };
}

async function syncTaskSnapshotProjection(args: {
  taskId: string;
  projectId: string;
  currentStatus: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  orchestrationKind?: "single" | "parallel" | "sequential-chain" | null;
  currentRunId?: string | null;
  currentSessionId?: string | null;
  latestResult?: string | null;
  latestResultSummary?: string | null;
  latestErrorText?: string | null;
  winnerNodeId?: string | null;
  lastActivityAt?: string | null;
}) {
  const runNodes = args.currentRunId
    ? await db
        .select({
          id: taskRunNodes.id,
          nodeKind: taskRunNodes.nodeKind,
          status: taskRunNodes.status,
        })
        .from(taskRunNodes)
        .where(eq(taskRunNodes.runId, args.currentRunId))
    : [];

  const activeCandidateCount = countRunNodesByKindAndStatus(runNodes, "candidate", [
    "pending",
    "running",
    "paused",
  ]);
  const completedCandidateCount = countRunNodesByKindAndStatus(runNodes, "candidate", [
    "completed",
  ]);
  const failedCandidateCount = countRunNodesByKindAndStatus(runNodes, "candidate", [
    "failed",
    "cancelled",
  ]);
  const totalChainSteps = countRunNodesByKindAndStatus(runNodes, "chain-step");
  const completedChainSteps = countRunNodesByKindAndStatus(runNodes, "chain-step", ["completed"]);
  const winnerNodeId = resolveProjectionWinnerNodeId(runNodes, args.winnerNodeId);
  const now = new Date().toISOString();
  const projectionValues = buildTaskSnapshotProjectionValues({
    ...args,
    now,
    activeCandidateCount,
    completedCandidateCount,
    failedCandidateCount,
    totalChainSteps,
    completedChainSteps,
    winnerNodeId,
  });

  await db.insert(taskSnapshots).values(projectionValues).onConflictDoUpdate({
    target: taskSnapshots.taskId,
    set: projectionValues,
  });
}

function getProjectionBaseStatus(
  snapshotStatus: string | null | undefined,
  aggregateStatus: string | null | undefined,
) {
  return normalizeProjectionStatus(snapshotStatus ?? aggregateStatus);
}

async function syncSnapshotFromProjectionBase(args: {
  eventRecord: ProjectableTaskDomainEventRecord;
  currentSessionId?: string | null;
  currentRunId?: string | null;
  latestResult?: string | null;
  latestResultSummary?: string | null;
  latestErrorText?: string | null;
  winnerNodeId?: string | null;
  lastActivityAt: string;
}) {
  const { snapshotRecord, aggregateRecord } = await loadTaskProjectionBase(args.eventRecord.taskId);

  await syncTaskSnapshotProjection({
    taskId: args.eventRecord.taskId,
    projectId: args.eventRecord.projectId,
    currentStatus: getProjectionBaseStatus(snapshotRecord?.currentStatus, aggregateRecord?.status),
    orchestrationKind: snapshotRecord?.orchestrationKind ?? null,
    currentRunId:
      args.currentRunId ?? snapshotRecord?.currentRunId ?? aggregateRecord?.currentRunId ?? null,
    currentSessionId: args.currentSessionId ?? snapshotRecord?.currentSessionId ?? null,
    latestResult:
      args.latestResult ?? snapshotRecord?.latestResult ?? aggregateRecord?.latestResult ?? null,
    latestResultSummary:
      args.latestResultSummary ??
      snapshotRecord?.latestResultSummary ??
      aggregateRecord?.latestResultSummary ??
      null,
    latestErrorText: args.latestErrorText ?? snapshotRecord?.latestErrorText ?? null,
    winnerNodeId: args.winnerNodeId ?? snapshotRecord?.winnerNodeId ?? null,
    lastActivityAt: args.lastActivityAt,
  });
}

async function handleTaskAggregateUpsertedEvent(
  eventRecord: ProjectableTaskDomainEventRecord,
  payload: Record<string, unknown>,
) {
  await syncTaskSnapshotProjection({
    taskId: eventRecord.taskId,
    projectId: eventRecord.projectId,
    currentStatus: normalizeProjectionStatus(payload.status),
    orchestrationKind: normalizeProjectionOrchestrationKind(payload.executionMode),
    currentRunId: asNullableString(payload.currentRunId),
    currentSessionId: asNullableString(payload.currentSessionId),
    latestResult: asNullableString(payload.result),
    latestResultSummary:
      asNullableString(payload.resultSummary) ?? asNullableString(payload.result),
    latestErrorText: asNullableString(payload.latestErrorText),
    lastActivityAt: asNullableString(payload.lastActivityAt) ?? eventRecord.createdAt,
  });

  await upsertTaskTimelineViewRecord({
    id: `timeline:task-status:${eventRecord.id}`,
    projectId: eventRecord.projectId,
    taskId: eventRecord.taskId,
    sessionId: eventRecord.sessionId,
    itemKind: "status-transition",
    itemRole: asNullableString(payload.status),
    title: "任务状态",
    displayText:
      asNullableString(payload.resultSummary) ??
      asNullableString(payload.result) ??
      `任务进入 ${normalizeProjectionStatus(payload.status)} 状态`,
    metadataJson: {
      executionMode: asNullableString(payload.executionMode),
      selectedModel: asNullableString(payload.selectedModel),
    },
    sortAt: asNullableString(payload.lastActivityAt) ?? eventRecord.createdAt,
    createdAt: eventRecord.createdAt,
  });
}

async function handleConversationSessionUpsertedEvent(
  eventRecord: ProjectableTaskDomainEventRecord,
  payload: Record<string, unknown>,
) {
  const sessionEvent = describeSessionTimelineEvent(payload);

  await upsertTaskTimelineViewRecord({
    id: `timeline:session:${eventRecord.sessionId ?? eventRecord.id}`,
    projectId: eventRecord.projectId,
    taskId: eventRecord.taskId,
    sessionId: eventRecord.sessionId,
    itemKind: sessionEvent.itemKind,
    itemRole: asNullableString(payload.sourceType),
    title: sessionEvent.title,
    displayText: sessionEvent.displayText,
    metadataJson: {
      branchName: asNullableString(payload.branchName),
      runtimeSessionId: asNullableString(payload.runtimeSessionId),
      parentRuntimeSessionId: asNullableString(payload.parentRuntimeSessionId),
      forkedFromMessageId: asNullableString(payload.forkedFromMessageId),
      archivedAt: asNullableString(payload.archivedAt),
    },
    sortAt: asNullableString(payload.archivedAt) ?? eventRecord.createdAt,
    createdAt: eventRecord.createdAt,
  });

  if (payload.isActive !== true) {
    return;
  }

  await syncSnapshotFromProjectionBase({
    eventRecord,
    currentSessionId: asNullableString(payload.runtimeSessionId),
    lastActivityAt: eventRecord.createdAt,
  });
}

async function upsertConversationMessagePartTimelineRecords(args: {
  eventRecord: ProjectableTaskDomainEventRecord;
  payload: Record<string, unknown>;
  primaryItemKind: ReturnType<typeof buildTimelineItemKindFromMessageRole>;
  timelineMessageId: string | null;
  partSummaries: ReturnType<typeof normalizeMessagePartSummaries>;
}) {
  for (const partSummary of args.partSummaries) {
    const itemKind = buildTimelineItemKindFromMessagePartType(partSummary.partType);
    if (!itemKind || itemKind === args.primaryItemKind) {
      continue;
    }

    const partTimeline = describeMessagePartTimelineEvent(partSummary);

    await upsertTaskTimelineViewRecord({
      id: `timeline:message-part:${asNullableString(args.payload.messageId) ?? args.eventRecord.id}:${partSummary.partIndex}`,
      projectId: args.eventRecord.projectId,
      taskId: args.eventRecord.taskId,
      sessionId: args.eventRecord.sessionId,
      messageId: args.timelineMessageId,
      itemKind,
      itemRole: asNullableString(args.payload.role),
      title: partTimeline.title,
      displayText: partTimeline.displayText,
      metadataJson: {
        partIndex: partSummary.partIndex,
        partType: partSummary.partType,
        runtimeMessageId: asNullableString(args.payload.runtimeMessageId),
        ...(partTimeline.metadata ?? {}),
      },
      sortAt: asNullableString(args.payload.completedAt) ?? args.eventRecord.createdAt,
      createdAt: args.eventRecord.createdAt,
    });
  }
}

async function handleConversationMessageUpsertedEvent(
  eventRecord: ProjectableTaskDomainEventRecord,
  payload: Record<string, unknown>,
) {
  const primaryItemKind = buildTimelineItemKindFromMessageRole(
    asNullableString(payload.role) ?? "assistant",
  );
  const timelineMessageId = await resolveProjectionConversationMessageId(
    asNullableString(payload.messageId),
  );
  const partSummaries = normalizeMessagePartSummaries(payload.partSummaries);

  await upsertTaskTimelineViewRecord({
    id: `timeline:message:${asNullableString(payload.messageId) ?? eventRecord.id}`,
    projectId: eventRecord.projectId,
    taskId: eventRecord.taskId,
    sessionId: eventRecord.sessionId,
    messageId: timelineMessageId,
    itemKind: primaryItemKind,
    itemRole: asNullableString(payload.role),
    title: asNullableString(payload.role),
    displayText: asNullableString(payload.textContent),
    metadataJson: {
      runtimeMessageId: asNullableString(payload.runtimeMessageId),
      tokenUsed: payload.tokenUsed ?? 0,
      partTypes: Array.isArray(payload.partTypes) ? payload.partTypes : [],
      partSummaries,
    },
    sortAt: asNullableString(payload.completedAt) ?? eventRecord.createdAt,
    createdAt: eventRecord.createdAt,
  });

  await upsertConversationMessagePartTimelineRecords({
    eventRecord,
    payload,
    primaryItemKind,
    timelineMessageId,
    partSummaries,
  });

  await syncSnapshotFromProjectionBase({
    eventRecord,
    currentSessionId: asNullableString(payload.runtimeSessionId),
    lastActivityAt: asNullableString(payload.completedAt) ?? eventRecord.createdAt,
  });
}

async function handleTaskRunNodeUpsertedEvent(
  eventRecord: ProjectableTaskDomainEventRecord,
  payload: Record<string, unknown>,
) {
  const runNodeTimeline = describeRunNodeTimelineEvent(payload);

  await syncTaskSnapshotProjection({
    taskId: eventRecord.taskId,
    projectId: eventRecord.projectId,
    currentStatus: normalizeProjectionStatus(payload.status),
    orchestrationKind: normalizeProjectionOrchestrationKind(payload.orchestrationKind),
    currentRunId: asNullableString(payload.taskRunId),
    currentSessionId: asNullableString(payload.runtimeSessionId),
    latestResult: asNullableString(payload.result),
    latestResultSummary: asNullableString(payload.result),
    latestErrorText: asNullableString(payload.error),
    winnerNodeId: asNullableString(payload.winnerNodeId),
    lastActivityAt: asNullableString(payload.lastActivityAt) ?? eventRecord.createdAt,
  });

  await upsertTaskTimelineViewRecord({
    id: `timeline:run-node:${asNullableString(payload.taskRunNodeId) ?? eventRecord.id}`,
    projectId: eventRecord.projectId,
    taskId: eventRecord.taskId,
    runId: asNullableString(payload.taskRunId),
    runNodeId: asNullableString(payload.taskRunNodeId),
    sessionId: eventRecord.sessionId,
    itemKind: runNodeTimeline.itemKind,
    itemRole: asNullableString(payload.status),
    title: runNodeTimeline.title,
    displayText: runNodeTimeline.displayText,
    metadataJson: {
      agentRunId: asNullableString(payload.agentRunId),
      agentType: asNullableString(payload.agentType),
      nodeKind: asNullableString(payload.nodeKind),
      status: asNullableString(payload.status),
      candidateIndex: payload.candidateIndex ?? null,
      orchestrationKind: asNullableString(payload.orchestrationKind),
    },
    sortAt: asNullableString(payload.lastActivityAt) ?? eventRecord.createdAt,
    createdAt: asNullableString(payload.startedAt) ?? eventRecord.createdAt,
  });
}

export async function projectTaskDomainEvent(eventRecord: TaskDomainProjectionEventRecord) {
  if (!eventRecord.taskId) {
    return;
  }

  const projectableEventRecord = eventRecord as ProjectableTaskDomainEventRecord;
  const handlers: Record<
    string,
    (event: ProjectableTaskDomainEventRecord, payload: Record<string, unknown>) => Promise<void>
  > = {
    "task.aggregate.upserted": handleTaskAggregateUpsertedEvent,
    "conversation.session.upserted": handleConversationSessionUpsertedEvent,
    "conversation.message.upserted": handleConversationMessageUpsertedEvent,
    "task.run-node.upserted": handleTaskRunNodeUpsertedEvent,
  };
  const handler = handlers[eventRecord.eventType];

  if (handler) {
    await handler(projectableEventRecord, eventRecord.payload);
  }
}

export async function appendTaskDomainEvent(args: AppendTaskDomainEventArgs) {
  const eventRecord = {
    id: crypto.randomUUID(),
    projectId: args.projectId,
    taskId: args.taskId,
    runId: args.runId ?? null,
    runNodeId: args.runNodeId ?? null,
    sessionId: args.sessionId ?? null,
    eventType: args.eventType,
    payload: args.payload,
    seq: nextTaskDomainEventSeq(),
    createdAt: args.createdAt ?? new Date().toISOString(),
  } satisfies TaskDomainProjectionEventRecord;

  await db.insert(taskDomainEvents).values(eventRecord);
  await projectTaskDomainEvent(eventRecord);
  return eventRecord;
}

export async function replayTaskDomainProjections(taskId: string) {
  await db.delete(taskTimelineViews).where(eq(taskTimelineViews.taskId, taskId));
  await db.delete(taskSnapshots).where(eq(taskSnapshots.taskId, taskId));

  const events = await db
    .select({
      id: taskDomainEvents.id,
      projectId: taskDomainEvents.projectId,
      taskId: taskDomainEvents.taskId,
      runId: taskDomainEvents.runId,
      runNodeId: taskDomainEvents.runNodeId,
      sessionId: taskDomainEvents.sessionId,
      eventType: taskDomainEvents.eventType,
      payload: taskDomainEvents.payload,
      seq: taskDomainEvents.seq,
      createdAt: taskDomainEvents.createdAt,
    })
    .from(taskDomainEvents)
    .where(eq(taskDomainEvents.taskId, taskId))
    .orderBy(asc(taskDomainEvents.seq), asc(taskDomainEvents.createdAt));

  for (const eventRecord of events) {
    await projectTaskDomainEvent(eventRecord);
  }

  return {
    taskId,
    replayedEventCount: events.length,
  };
}

export async function replayTaskDomainProjectionsByProject(projectId: string) {
  const projectTasks = await db
    .select({ id: taskAggregates.id })
    .from(taskAggregates)
    .where(eq(taskAggregates.projectId, projectId))
    .orderBy(asc(taskAggregates.createdAt));

  const taskIds = projectTasks.map((task) => task.id);
  if (taskIds.length === 0) {
    return {
      projectId,
      replayedTaskCount: 0,
      replayedEventCount: 0,
    };
  }

  await db.delete(taskTimelineViews).where(inArray(taskTimelineViews.taskId, taskIds));
  await db.delete(taskSnapshots).where(inArray(taskSnapshots.taskId, taskIds));

  const events = await db
    .select({
      id: taskDomainEvents.id,
      projectId: taskDomainEvents.projectId,
      taskId: taskDomainEvents.taskId,
      runId: taskDomainEvents.runId,
      runNodeId: taskDomainEvents.runNodeId,
      sessionId: taskDomainEvents.sessionId,
      eventType: taskDomainEvents.eventType,
      payload: taskDomainEvents.payload,
      seq: taskDomainEvents.seq,
      createdAt: taskDomainEvents.createdAt,
    })
    .from(taskDomainEvents)
    .where(eq(taskDomainEvents.projectId, projectId))
    .orderBy(asc(taskDomainEvents.seq), asc(taskDomainEvents.createdAt));

  for (const eventRecord of events) {
    await projectTaskDomainEvent(eventRecord);
  }

  return {
    projectId,
    replayedTaskCount: taskIds.length,
    replayedEventCount: events.length,
  };
}
