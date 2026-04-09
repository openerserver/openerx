import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { db as importedDb } from "../../db/index";
import { openPostgresDatabase } from "../../db/postgres-client";
import {
  type TaskSessionMessageRole,
  type TaskTimelineItemKind,
  tasks as taskAggregates,
  taskSessions,
  taskSnapshots,
  taskTimelineViews,
} from "../../db/schema";
import * as schema from "../../db/schema";
import { fromStoredTaskExecutionMode, toStoredTaskExecutionMode } from "./task-execution-mode";

/**
 * Maps old task status values to the DB enum `task_lifecycle_status`.
 * Matches migration 0022: completed → done, NULL → draft, else → active.
 */
function toLifecycleStatus(
  status: string | null | undefined,
): "draft" | "active" | "done" | "archived" {
  if (!status) return "draft";
  if (status === "pending") return "draft";
  if (status === "completed") return "done";
  if (status === "cancelled") return "archived";
  return "active";
}

function getOptionalSchemaValue<T = any>(key: string) {
  return (schema as unknown as Record<string, T | undefined>)[key];
}

const taskDomainEvents = getOptionalSchemaValue("taskDomainEvents");

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

function buildTimelineItemKindFromMessageRole(_role: string) {
  return "message" as const;
}

function buildTimelineItemKindFromMessagePartType(partType: string) {
  if (partType === "tool_call") {
    return "operation" as const;
  }
  if (partType === "tool_result") {
    return "operation" as const;
  }
  if (partType === "thinking") {
    return "message" as const;
  }
  if (partType === "file_reference") {
    return "artifact" as const;
  }
  if (partType === "diff") {
    return "artifact" as const;
  }

  return null;
}

function buildTimelineItemKindFromRunNodeKind(_nodeKind: string) {
  return "operation" as const;
}

function buildTimelineItemKindFromRunNodeEvent(nodeKind: string, status: string) {
  if (status === "pending" || status === "running" || status === "paused") {
    return "task_lifecycle" as const;
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
      itemKind: "session" as const,
      title: branchName ?? "归档会话",
      displayText: branchName
        ? `归档会话 ${branchName}`
        : `归档会话 ${runtimeSessionId ?? "unknown"}`,
    };
  }

  if (sourceType === "fork" || sourceType === "sub_session") {
  if (sourceType === "parallel") {
    return {
      itemKind: "session" as const,
      title: branchName ?? "并行会话",
      displayText: branchName
        ? `切换到并行候选 ${branchName}`
        : `切换到并行会话 ${runtimeSessionId ?? "unknown"}`,
    };
  }

    return {
      itemKind: "session" as const,
      title: branchName ?? "派生会话",
      displayText: branchName
        ? `切换到分支 ${branchName}`
        : `切换到派生会话 ${runtimeSessionId ?? "unknown"}`,
    };
  }

  return {
    itemKind: "session" as const,
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

function buildRunNodeTimelineTitle(args: {
  title: string | null;
  nodeKind: string;
  candidateIndex: number | null;
  chainStepIndex: number | null;
  agentType: string | null;
}) {
  if (args.title) {
    return args.title;
  }
  if (args.nodeKind === "candidate" && args.candidateIndex !== null) {
    return `候选 ${args.candidateIndex + 1}`;
  }
  if (args.nodeKind === "judge") {
    return "Judge 决策";
  }
  if (args.nodeKind === "chain-step") {
    return `链式步骤 ${(args.chainStepIndex ?? args.candidateIndex ?? 0) + 1}`;
  }

  return args.agentType;
}

function buildRunNodeTimelineDisplayText(args: {
  payload: Record<string, unknown>;
  itemKind: TaskTimelineItemKind;
  title: string | null;
  status: string;
}) {
  return (
    asNullableString(args.payload.result) ??
    asNullableString(args.payload.error) ??
    (args.itemKind === "task_lifecycle"
      ? `${args.title ?? "执行节点"} 进入 ${args.status} 状态`
      : `${args.title ?? "执行节点"} 已${args.status}`)
  );
}

function describeRunNodeTimelineEvent(payload: Record<string, unknown>) {
  const nodeKind = asNullableString(payload.nodeKind) ?? "execution";
  const status = asNullableString(payload.status) ?? "pending";
  const title = asNullableString(payload.title);
  const candidateIndex = typeof payload.candidateIndex === "number" ? payload.candidateIndex : null;
  const chainStepIndex = typeof payload.chainStepIndex === "number" ? payload.chainStepIndex : null;
  const agentType = asNullableString(payload.agentType);
  const itemKind = buildTimelineItemKindFromRunNodeEvent(nodeKind, status);
  const defaultTitle = buildRunNodeTimelineTitle({
    title,
    nodeKind,
    candidateIndex,
    chainStepIndex,
    agentType,
  });

  return {
    itemKind,
    title: defaultTitle,
    displayText: buildRunNodeTimelineDisplayText({
      payload,
      itemKind,
      title: defaultTitle,
      status,
    }),
  };
}

function normalizeProjectionStatus(value: unknown) {
  if (
    value === "pending" ||
    value === "running" ||
    value === "paused" ||
    value === "awaiting_adoption" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return "pending" as const;
}

function fromProjectionLifecycleStatus(value: unknown) {
  if (value === "draft") {
    return "pending" as const;
  }
  if (value === "active") {
    return "running" as const;
  }
  if (value === "done") {
    return "completed" as const;
  }
  if (value === "archived") {
    return "cancelled" as const;
  }

  return normalizeProjectionStatus(value);
}

function fromProjectionExecutionStatus(value: unknown) {
  if (value === "queued") {
    return "pending" as const;
  }
  if (value === "complete") {
    return "completed" as const;
  }
  if (
    value === "running" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "awaiting_adoption"
  ) {
    return value;
  }

  return null;
}

function normalizeProjectionOrchestrationKind(value: unknown) {
  return fromStoredTaskExecutionMode(typeof value === "string" ? value : null);
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

async function resolveProjectedTaskSessionId(taskId: string, sessionId?: string | null) {
  const normalizedSessionId = asNullableString(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  if (normalizedSessionId.startsWith("task-session:")) {
    return normalizedSessionId;
  }

  const [runtimeSession] = await db
    .select({ id: taskSessions.id })
    .from(taskSessions)
    .where(and(eq(taskSessions.taskId, taskId), eq(taskSessions.runtimeSessionId, normalizedSessionId)));

  return runtimeSession?.id ?? null;
}

function normalizeMessageRole(value: unknown): TaskSessionMessageRole | null {
  return value === "user" || value === "assistant" || value === "system" || value === "tool"
    ? value
    : null;
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
  itemRole?: TaskSessionMessageRole | null;
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
    metadataJson: args.metadataJson ?? {},
    sortAt: args.sortAt,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
  };
  const updateSet = {
    projectId: values.projectId,
    taskId: values.taskId,
    runId: values.runId,
    runNodeId: values.runNodeId,
    sessionId: values.sessionId,
    messageId: values.messageId,
    itemKind: values.itemKind,
    itemRole: values.itemRole,
    title: values.title,
    displayText: values.displayText,
    metadataJson: values.metadataJson,
    sortAt: values.sortAt,
    updatedAt: values.updatedAt,
  };

  await db.insert(taskTimelineViews).values(values).onConflictDoUpdate({
    target: taskTimelineViews.id,
    set: updateSet,
  });
}

function buildTaskSnapshotProjectionValues(args: {
  taskId: string;
  projectId: string;
  currentStatus:
    | "pending"
    | "running"
    | "paused"
    | "awaiting_adoption"
    | "completed"
    | "failed"
    | "cancelled";
  orchestrationKind?: "single" | "parallel" | "sequential-chain" | null;
  currentSessionId?: string | null;
  latestResultSummary?: string | null;
  latestErrorText?: string | null;
  lastActivityAt?: string | null;
  now: string;
  activeCandidateCount: number;
  totalChainSteps: number;
  completedChainSteps: number;
}) {
  return {
    taskId: args.taskId,
    projectId: args.projectId,
    lifecycleStatus: toLifecycleStatus(args.currentStatus),
    currentExecutionMode: toStoredTaskExecutionMode(args.orchestrationKind),
    currentExecutionStatus:
      args.currentStatus === "awaiting_adoption" ? ("awaiting_adoption" as const) : null,
    currentSessionId: args.currentSessionId ?? null,
    latestSessionId: args.currentSessionId ?? null,
    latestResultSummary: args.latestResultSummary ?? null,
    latestErrorText: args.latestErrorText ?? null,
    activeCandidateCount: args.activeCandidateCount,
    totalChainSteps: args.totalChainSteps,
    completedChainSteps: args.completedChainSteps,
    lastActivityAt: args.lastActivityAt ?? args.now,
    updatedAt: args.now,
  };
}

async function syncTaskSnapshotProjection(args: {
  taskId: string;
  projectId: string;
  currentStatus:
    | "pending"
    | "running"
    | "paused"
    | "awaiting_adoption"
    | "completed"
    | "failed"
    | "cancelled";
  orchestrationKind?: "single" | "parallel" | "sequential-chain" | null;
  currentSessionId?: string | null;
  latestResultSummary?: string | null;
  latestErrorText?: string | null;
  lastActivityAt?: string | null;
}) {
  const now = new Date().toISOString();
  const projectionValues = buildTaskSnapshotProjectionValues({
    ...args,
    now,
    activeCandidateCount: 0,
    totalChainSteps: 0,
    completedChainSteps: 0,
  });

  await db.insert(taskSnapshots).values(projectionValues).onConflictDoUpdate({
    target: taskSnapshots.taskId,
    set: projectionValues,
  });
}

function getProjectionBaseStatus(args: {
  snapshotExecutionStatus?: string | null;
  snapshotLifecycleStatus?: string | null;
  aggregateLifecycleStatus?: string | null;
}) {
  return (
    fromProjectionExecutionStatus(args.snapshotExecutionStatus) ??
    fromProjectionLifecycleStatus(args.snapshotLifecycleStatus ?? args.aggregateLifecycleStatus)
  );
}

function getProjectionActiveStatus(
  snapshotExecutionStatus: string | null | undefined,
  snapshotLifecycleStatus: string | null | undefined,
  aggregateLifecycleStatus: string | null | undefined,
) {
  const baseStatus = getProjectionBaseStatus({
    snapshotExecutionStatus,
    snapshotLifecycleStatus,
    aggregateLifecycleStatus,
  });
  if (
    baseStatus === "awaiting_adoption" ||
    baseStatus === "completed" ||
    baseStatus === "failed" ||
    baseStatus === "cancelled"
  ) {
    return baseStatus;
  }

  return "running" as const;
}

async function syncSnapshotFromProjectionBase(args: {
  eventRecord: ProjectableTaskDomainEventRecord;
  currentSessionId?: string | null;
  latestResultSummary?: string | null;
  latestErrorText?: string | null;
  lastActivityAt: string;
}) {
  const { snapshotRecord, aggregateRecord } = await loadTaskProjectionBase(args.eventRecord.taskId);

  await syncTaskSnapshotProjection({
    taskId: args.eventRecord.taskId,
    projectId: args.eventRecord.projectId,
    currentStatus: getProjectionActiveStatus(
      snapshotRecord?.currentExecutionStatus,
      snapshotRecord?.lifecycleStatus,
      aggregateRecord?.lifecycleStatus,
    ),
    orchestrationKind: fromStoredTaskExecutionMode(snapshotRecord?.currentExecutionMode),
    currentSessionId: args.currentSessionId ?? snapshotRecord?.currentSessionId ?? null,
    latestResultSummary:
      args.latestResultSummary ??
      snapshotRecord?.latestResultSummary ??
      null,
    latestErrorText: args.latestErrorText ?? snapshotRecord?.latestErrorText ?? null,
    lastActivityAt: args.lastActivityAt,
  });
}

async function handleTaskAggregateUpsertedEvent(
  eventRecord: ProjectableTaskDomainEventRecord,
  payload: Record<string, unknown>,
) {
  const currentSessionId = await resolveProjectedTaskSessionId(
    eventRecord.taskId,
    asNullableString(payload.currentSessionId),
  );

  await syncTaskSnapshotProjection({
    taskId: eventRecord.taskId,
    projectId: eventRecord.projectId,
    currentStatus: normalizeProjectionStatus(payload.status),
    orchestrationKind: normalizeProjectionOrchestrationKind(payload.executionMode),
    currentSessionId,
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
    itemKind: "task_lifecycle",
    itemRole: null,
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
  const currentSessionId =
    eventRecord.sessionId ??
    (await resolveProjectedTaskSessionId(
      eventRecord.taskId,
      asNullableString(payload.runtimeSessionId),
    ));

  await upsertTaskTimelineViewRecord({
    id: `timeline:session:${eventRecord.sessionId ?? eventRecord.id}`,
    projectId: eventRecord.projectId,
    taskId: eventRecord.taskId,
    sessionId: eventRecord.sessionId,
    itemKind: sessionEvent.itemKind,
    itemRole: null,
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
    currentSessionId,
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
      itemRole: normalizeMessageRole(args.payload.role),
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
  const timelineMessageId = asNullableString(payload.messageId);
  const partSummaries = normalizeMessagePartSummaries(payload.partSummaries);
  const currentSessionId =
    eventRecord.sessionId ??
    (await resolveProjectedTaskSessionId(
      eventRecord.taskId,
      asNullableString(payload.runtimeSessionId),
    ));

  await upsertTaskTimelineViewRecord({
    id: `timeline:message:${asNullableString(payload.messageId) ?? eventRecord.id}`,
    projectId: eventRecord.projectId,
    taskId: eventRecord.taskId,
    sessionId: eventRecord.sessionId,
    messageId: timelineMessageId,
    itemKind: primaryItemKind,
    itemRole: normalizeMessageRole(payload.role),
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
    currentSessionId,
    lastActivityAt: asNullableString(payload.completedAt) ?? eventRecord.createdAt,
  });
}

async function handleTaskRunNodeUpsertedEvent(
  eventRecord: ProjectableTaskDomainEventRecord,
  payload: Record<string, unknown>,
) {
  const runNodeTimeline = describeRunNodeTimelineEvent(payload);
  const orchestrationKind = normalizeProjectionOrchestrationKind(payload.orchestrationKind);
  const explicitWinnerNodeId = asNullableString(payload.winnerNodeId);
  const shouldPreserveMainline = orchestrationKind === "parallel" && explicitWinnerNodeId == null;
  const currentSessionId = shouldPreserveMainline
    ? undefined
    : (eventRecord.sessionId ??
      (await resolveProjectedTaskSessionId(
        eventRecord.taskId,
        asNullableString(payload.runtimeSessionId),
      )));

  await syncTaskSnapshotProjection({
    taskId: eventRecord.taskId,
    projectId: eventRecord.projectId,
    currentStatus: normalizeProjectionStatus(payload.status),
    orchestrationKind,
    currentSessionId,
    latestResultSummary: shouldPreserveMainline ? undefined : asNullableString(payload.result),
    latestErrorText: asNullableString(payload.error),
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
    itemRole: null,
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

  if (!taskDomainEvents) {
    return {
      taskId,
      replayedEventCount: 0,
    };
  }

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

  if (!taskDomainEvents) {
    return {
      projectId,
      replayedTaskCount: taskIds.length,
      replayedEventCount: 0,
    };
  }

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
