import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  type ExecutionStatus,
  type TaskPhaseRole,
  type TaskSessionKind,
  type TaskSessionMode,
  type TaskSessionNodeType,
  type TaskSessionRunExecutionKind,
  type TaskSessionRunLaneRole,
  type TaskSessionRunTriggerType,
  type TaskSessionTriggerType,
  taskSessionRuns,
  taskSessions,
} from "../../db/schema";
import type { PublicTaskSessionSourceType } from "./task-session-public-source-type";

type TaskSessionSourceType = PublicTaskSessionSourceType | null | undefined;

export type UpsertTaskSessionRecordArgs = {
  task: {
    id: string;
    projectId: string;
  };
  runtimeSessionId: string;
  parentRuntimeSessionId?: string | null;
  forkedFromMessageId?: string | null;
  branchName?: string | null;
  sourceType?: TaskSessionSourceType;
  sessionKind?: TaskSessionKind | null;
  executionModeSnapshot?: TaskSessionMode | null;
  phaseId?: string | null;
  phaseRole?: TaskPhaseRole | null;
  phaseItemIndex?: number | null;
  isActive?: boolean;
  archivedAt?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  operationId?: string | null;
};

export function buildTaskSessionWriteId(taskId: string, runtimeSessionId: string) {
  return `task-session:${taskId}:${runtimeSessionId}`;
}

export function buildTaskSessionDefaultRunId(sessionId: string) {
  return `run_${sessionId}`;
}

function mapSourceTypeToTaskSessionKind(sourceType: TaskSessionSourceType): TaskSessionKind {
  if (sourceType === "parallel") {
    return "candidate";
  }
  if (sourceType === "fork") {
    return "manual_branch";
  }
  if (sourceType === "sub_session") {
    return "resume";
  }
  return "primary";
}

function resolveTaskSessionKind(args: {
  sourceType?: TaskSessionSourceType;
  sessionKind?: TaskSessionKind | null;
}) {
  return args.sessionKind ?? mapSourceTypeToTaskSessionKind(args.sourceType);
}

function mapTaskSessionNodeType(args: {
  sourceType?: TaskSessionSourceType;
  sessionKind?: TaskSessionKind | null;
  parentSessionId?: string | null;
}): TaskSessionNodeType {
  if (args.sourceType === "parallel" || args.sessionKind === "candidate") {
    return args.parentSessionId ? "follow_up" : "root";
  }
  if (args.sourceType === "fork" || args.sessionKind === "manual_branch") {
    return "manual_branch";
  }
  if (args.parentSessionId) {
    return "follow_up";
  }
  return "root";
}

function mapSourceTypeToTaskSessionTriggerType(
  sourceType: TaskSessionSourceType,
): TaskSessionTriggerType {
  if (sourceType === "parallel") {
    return "execute";
  }
  if (sourceType === "fork") {
    return "manual_branch";
  }
  if (sourceType === "sub_session") {
    return "continue";
  }
  return "execute";
}

function mapTaskSessionExecutionStatus(args: {
  isActive?: boolean;
  archivedAt?: string | null;
}): ExecutionStatus {
  if (args.archivedAt) {
    return "cancelled";
  }
  if (args.isActive) {
    return "running";
  }
  return "complete";
}

function shouldCompleteTaskSessionOnPassiveDeactivate(args: {
  existing: typeof taskSessions.$inferSelect | null;
  writeArgs: UpsertTaskSessionRecordArgs;
  hasExplicitLineage: boolean;
}) {
  if (args.hasExplicitLineage || args.writeArgs.archivedAt || args.writeArgs.isActive !== false) {
    return false;
  }

  return (
    args.existing?.executionStatus === "running" ||
    (args.existing?.status === "running" && Boolean(args.existing?.startedAt))
  );
}

function mapTaskSessionTriggerTypeToRunTriggerType(
  triggerType: TaskSessionTriggerType,
): TaskSessionRunTriggerType {
  if (triggerType === "continue") {
    return "assistant_reply";
  }
  if (triggerType === "resume") {
    return "resume";
  }
  if (triggerType === "workflow_spawn") {
    return "workflow_spawn";
  }
  if (triggerType === "manual_branch") {
    return "manual_branch";
  }
  return "user_prompt";
}

function mapTaskSessionKindToRunExecutionKind(
  sessionKind: TaskSessionKind,
): TaskSessionRunExecutionKind {
  if (sessionKind === "candidate") {
    return "parallel_candidate";
  }
  if (sessionKind === "judge") {
    return "judge";
  }
  if (sessionKind === "sequential_step") {
    return "workflow_step";
  }
  if (sessionKind === "resume") {
    return "resume";
  }
  if (sessionKind === "hook") {
    return "hook";
  }
  return "single";
}

function mapTaskSessionKindToRunLaneRole(sessionKind: TaskSessionKind): TaskSessionRunLaneRole {
  if (sessionKind === "candidate") {
    return "candidate";
  }
  if (sessionKind === "judge") {
    return "judge";
  }
  if (sessionKind === "resume") {
    return "resume";
  }
  if (sessionKind === "hook") {
    return "hook";
  }
  return "primary";
}

function mapTaskSessionKindToExecutorKind(sessionKind: TaskSessionKind) {
  if (sessionKind === "judge") {
    return "judge";
  }
  if (sessionKind === "hook") {
    return "hook";
  }
  return "assistant";
}

function mapTaskSessionKindToPhaseRole(sessionKind: TaskSessionKind): TaskPhaseRole {
  if (sessionKind === "candidate") {
    return "candidate";
  }
  if (sessionKind === "judge") {
    return "judge";
  }
  if (sessionKind === "sequential_step") {
    return "step";
  }
  if (sessionKind === "manual_branch" || sessionKind === "hook") {
    return "aux";
  }
  return "mainline";
}

function resolveTaskSessionMode(args: {
  executionModeSnapshot?: TaskSessionMode | null;
  sessionKind?: TaskSessionKind | null;
}) {
  if (args.executionModeSnapshot) {
    return args.executionModeSnapshot;
  }

  if (args.sessionKind === "candidate") {
    return "parallel";
  }

  return args.sessionKind === "sequential_step" ? "sequential_chain" : "single";
}

function sanitizeForkedFromMessageId(forkedFromMessageId?: string | null) {
  if (typeof forkedFromMessageId === "string" && forkedFromMessageId.trim()) {
    return forkedFromMessageId;
  }

  return null;
}

function buildTaskSessionMessageWriteId(sessionId: string, runtimeMessageId: string) {
  return `task-session-message:${sessionId}:${runtimeMessageId}`;
}

async function resolveParentAndRootSessionIds(args: {
  taskId: string;
  parentRuntimeSessionId?: string | null;
}) {
  const parentSessionId = args.parentRuntimeSessionId
    ? buildTaskSessionWriteId(args.taskId, args.parentRuntimeSessionId)
    : null;

  if (!parentSessionId) {
    return {
      parentSessionId: null,
      rootSessionId: null,
      parentDepth: 0,
      parentSortKey: null,
    };
  }

  const existingParent = await db.query.taskSessions.findFirst({
    where: eq(taskSessions.id, parentSessionId),
  });

  return {
    parentSessionId,
    rootSessionId: existingParent?.rootSessionId ?? parentSessionId,
    parentDepth: existingParent?.depth ?? 0,
    parentSortKey: existingParent?.sortKey ?? null,
  };
}

export function createTaskSessionWriteApi() {
  async function resolveTaskSessionId(taskId: string, runtimeSessionId?: string | null) {
    if (!runtimeSessionId) {
      return null;
    }

    return buildTaskSessionWriteId(taskId, runtimeSessionId);
  }

  async function resolveTaskSessionParentContext(args: {
    taskId: string;
    sessionId: string;
    existing: typeof taskSessions.$inferSelect | null;
    parentRuntimeSessionId?: string | null;
  }) {
    let parentSessionId = args.existing?.parentSessionId ?? null;
    let rootSessionId = args.existing?.rootSessionId ?? args.sessionId;
    let parentDepth = 0;
    let parentSortKey = null as string | null;

    if (args.parentRuntimeSessionId !== undefined) {
      const resolved = await resolveParentAndRootSessionIds({
        taskId: args.taskId,
        parentRuntimeSessionId: args.parentRuntimeSessionId,
      });
      parentSessionId = resolved.parentSessionId;
      rootSessionId = resolved.rootSessionId ?? args.sessionId;
      parentDepth = resolved.parentDepth;
      parentSortKey = resolved.parentSortKey;
    }

    return {
      parentSessionId,
      rootSessionId,
      parentDepth,
      parentSortKey,
    };
  }

  function resolveTaskSessionForkMetadata(args: {
    writeArgs: UpsertTaskSessionRecordArgs;
    existing: typeof taskSessions.$inferSelect | null;
  }) {
    return {
      branchName: args.writeArgs.branchName ?? args.existing?.branchName ?? null,
      forkedFromMessageId:
        args.writeArgs.forkedFromMessageId !== undefined
          ? sanitizeForkedFromMessageId(args.writeArgs.forkedFromMessageId)
          : (args.existing?.forkedFromMessageId ?? null),
    };
  }

  function resolveTaskSessionExecutionMetadata(args: {
    writeArgs: UpsertTaskSessionRecordArgs;
    existing: typeof taskSessions.$inferSelect | null;
  }) {
    const sessionKind =
      args.writeArgs.sessionKind ??
      args.existing?.sessionKind ??
      resolveTaskSessionKind(args.writeArgs);

    return {
      sessionKind,
      executionModeSnapshot:
        args.writeArgs.executionModeSnapshot ??
        args.existing?.executionModeSnapshot ??
        resolveTaskSessionMode({
          executionModeSnapshot: args.writeArgs.executionModeSnapshot,
          sessionKind,
        }),
      candidateIndex:
        args.writeArgs.candidateIndex !== undefined
          ? args.writeArgs.candidateIndex
          : (args.existing?.candidateIndex ?? null),
      stepIndex:
        args.writeArgs.stepIndex !== undefined
          ? args.writeArgs.stepIndex
          : (args.existing?.stepIndex ?? null),
      selectedModel:
        args.writeArgs.selectedModel !== undefined
          ? args.writeArgs.selectedModel
          : (args.existing?.selectedModel ?? null),
      phaseId:
        args.writeArgs.phaseId !== undefined
          ? args.writeArgs.phaseId
          : (args.existing?.phaseId ?? null),
      phaseRole:
        args.writeArgs.phaseRole ??
        args.existing?.phaseRole ??
        mapTaskSessionKindToPhaseRole(sessionKind),
      phaseItemIndex:
        args.writeArgs.phaseItemIndex !== undefined
          ? args.writeArgs.phaseItemIndex
          : args.existing?.phaseItemIndex ??
            (args.writeArgs.candidateIndex ?? args.existing?.candidateIndex ?? null) ??
            (args.writeArgs.stepIndex ?? args.existing?.stepIndex ?? null) ??
            0,
    };
  }

  function buildTaskSessionSortKey(
    existingSortKey: string | null | undefined,
    parentSortKey: string | null,
    sessionId: string,
  ) {
    return existingSortKey ?? (parentSortKey ? [parentSortKey, sessionId].join(".") : sessionId);
  }

  function buildTaskSessionDescriptor(args: {
    writeArgs: UpsertTaskSessionRecordArgs;
    existing: typeof taskSessions.$inferSelect | null;
    sessionId: string;
    parentSessionId: string | null;
    rootSessionId: string;
    parentDepth: number;
    parentSortKey: string | null;
  }) {
    const forkMetadata = resolveTaskSessionForkMetadata(args);
    const executionMetadata = resolveTaskSessionExecutionMetadata(args);
    const effectiveOperationId = args.writeArgs.operationId ?? args.existing?.operationId ?? null;
    const triggerType = mapSourceTypeToTaskSessionTriggerType(args.writeArgs.sourceType);
    const latestRunId = buildTaskSessionDefaultRunId(args.sessionId);
    const persistedLatestRunId = args.existing?.latestRunId ?? null;
    const sessionType = mapTaskSessionNodeType({
      sourceType: args.writeArgs.sourceType,
      sessionKind: executionMetadata.sessionKind,
      parentSessionId: args.parentSessionId,
    });
    const depth = args.parentSessionId ? args.parentDepth + 1 : 0;
    const sortKey = buildTaskSessionSortKey(
      args.existing?.sortKey,
      args.parentSortKey,
      args.sessionId,
    );
    const sourceMessageId =
      args.parentSessionId && forkMetadata.forkedFromMessageId
        ? buildTaskSessionMessageWriteId(args.parentSessionId, forkMetadata.forkedFromMessageId)
        : null;

    return {
      ...forkMetadata,
      ...executionMetadata,
      effectiveOperationId,
      triggerType,
      latestRunId,
      persistedLatestRunId,
      sessionType,
      depth,
      sortKey,
      sourceMessageId,
      treeNodeId: args.existing?.treeNodeId ?? null,
    };
  }

  function buildTaskSessionLifecycle(args: {
    writeArgs: UpsertTaskSessionRecordArgs;
    existing: typeof taskSessions.$inferSelect | null;
    now: string;
    hasExplicitLineage: boolean;
  }) {
    const shouldCompleteOnDeactivate = shouldCompleteTaskSessionOnPassiveDeactivate(args);
    const nodeStatus = args.writeArgs.archivedAt
      ? "archived"
      : args.writeArgs.isActive
        ? "running"
        : shouldCompleteOnDeactivate
          ? "completed"
          : (args.existing?.status ?? "running");
    const runCreatedAt = args.existing?.startedAt ?? args.existing?.createdAt ?? args.now;
    const runStartedAt = args.existing?.startedAt ?? (args.writeArgs.isActive ? args.now : null);
    const runFinishedAt =
      args.writeArgs.archivedAt ??
      (nodeStatus === "completed"
        ? (args.existing?.finishedAt ?? args.existing?.updatedAt ?? args.now)
        : null);

    return {
      nodeStatus,
      runCreatedAt,
      runStartedAt,
      runFinishedAt,
    };
  }

  async function buildTaskSessionWriteContext(
    args: UpsertTaskSessionRecordArgs,
    hasExplicitLineage: boolean,
  ) {
    const sessionId = buildTaskSessionWriteId(args.task.id, args.runtimeSessionId);
    const now = new Date().toISOString();
    const existing =
      (await db.query.taskSessions.findFirst({
        where: eq(taskSessions.id, sessionId),
      })) ?? null;
    const parentContext = await resolveTaskSessionParentContext({
      taskId: args.task.id,
      sessionId,
      existing,
      parentRuntimeSessionId: args.parentRuntimeSessionId,
    });
    const descriptor = buildTaskSessionDescriptor({
      writeArgs: args,
      existing,
      sessionId,
      ...parentContext,
    });
    const lifecycle = buildTaskSessionLifecycle({
      writeArgs: args,
      existing,
      now,
      hasExplicitLineage,
    });

    return {
      args,
      sessionId,
      now,
      existing,
      ...parentContext,
      ...descriptor,
      ...lifecycle,
    };
  }

  type TaskSessionWriteContext = Awaited<ReturnType<typeof buildTaskSessionWriteContext>>;

  function buildTaskSessionInsertValues(context: TaskSessionWriteContext) {
    return {
      id: context.sessionId,
      taskId: context.args.task.id,
      projectId: context.args.task.projectId,
      treeNodeId: context.treeNodeId,
      parentSessionId: context.parentSessionId,
      rootSessionId: context.rootSessionId,
      sourceMessageId: context.sourceMessageId,
      sessionType: context.sessionType,
      workflowStageKey: context.existing?.workflowStageKey ?? null,
      spawnTriggerType: context.triggerType,
      spawnRuleKey: context.existing?.spawnRuleKey ?? null,
      userPromptSummary: context.existing?.userPromptSummary ?? null,
      status: context.nodeStatus,
      headMessageId: context.existing?.headMessageId ?? null,
      latestRunId: context.persistedLatestRunId,
      depth: context.depth,
      sortKey: context.sortKey,
      phaseId: context.phaseId,
      phaseRole: context.phaseRole,
      phaseItemIndex: context.phaseItemIndex,
      operationId: context.effectiveOperationId,
      sessionKind: context.sessionKind,
      triggerType: context.triggerType,
      executionModeSnapshot: context.executionModeSnapshot,
      executionStatus: mapTaskSessionExecutionStatus(context.args),
      branchName: context.branchName,
      candidateIndex: context.candidateIndex,
      stepIndex: context.stepIndex,
      runtimeSessionId: context.args.runtimeSessionId,
      forkedFromMessageId: context.forkedFromMessageId,
      selectedModel: context.selectedModel,
      effectiveModel: null,
      winnerSessionId: null,
      judgeSessionId: null,
      resultText: null,
      resultSummary: null,
      errorText: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      lastActivityAt: context.now,
      startedAt: context.args.isActive ? context.now : null,
      finishedAt: context.runFinishedAt,
      createdAt: context.now,
      updatedAt: context.now,
      archivedAt: context.args.archivedAt ?? null,
    };
  }

  function buildTaskSessionUpdateValues(context: TaskSessionWriteContext) {
    return {
      projectId: context.args.task.projectId,
      treeNodeId: context.treeNodeId,
      parentSessionId: context.parentSessionId,
      rootSessionId: context.rootSessionId,
      sourceMessageId: context.sourceMessageId,
      sessionType: context.sessionType,
      spawnTriggerType: context.triggerType,
      latestRunId: context.persistedLatestRunId,
      depth: context.depth,
      sortKey: context.sortKey,
      phaseId: context.phaseId,
      phaseRole: context.phaseRole,
      phaseItemIndex: context.phaseItemIndex,
      operationId: context.effectiveOperationId,
      sessionKind: context.sessionKind,
      triggerType: context.triggerType,
      executionModeSnapshot: context.executionModeSnapshot,
      status: context.nodeStatus,
      executionStatus: mapTaskSessionExecutionStatus(context.args),
      branchName: context.branchName,
      candidateIndex: context.candidateIndex,
      stepIndex: context.stepIndex,
      runtimeSessionId: context.args.runtimeSessionId,
      forkedFromMessageId: context.forkedFromMessageId,
      selectedModel: context.selectedModel,
      lastActivityAt: context.now,
      finishedAt: context.runFinishedAt,
      updatedAt: context.now,
      archivedAt: context.args.archivedAt ?? null,
    };
  }

  function buildTaskSessionPassiveUpdateValues(context: TaskSessionWriteContext) {
    return {
      projectId: context.args.task.projectId,
      latestRunId: context.persistedLatestRunId,
      status: context.nodeStatus,
      executionStatus: mapTaskSessionExecutionStatus(context.args),
      runtimeSessionId: context.args.runtimeSessionId,
      lastActivityAt: context.now,
      finishedAt: context.runFinishedAt,
      updatedAt: context.now,
      archivedAt: context.args.archivedAt ?? null,
    };
  }

  function buildTaskSessionRunInsertValues(context: TaskSessionWriteContext) {
    return {
      id: context.latestRunId,
      taskId: context.args.task.id,
      sessionId: context.sessionId,
      phaseId: context.phaseId,
      attemptIndex: 1,
      runtimeSessionId: context.args.runtimeSessionId,
      triggerType: mapTaskSessionTriggerTypeToRunTriggerType(context.triggerType),
      executionKind: mapTaskSessionKindToRunExecutionKind(context.sessionKind),
      operationId: context.effectiveOperationId,
      candidateIndex: context.candidateIndex,
      laneRole: mapTaskSessionKindToRunLaneRole(context.sessionKind),
      executorKind: mapTaskSessionKindToExecutorKind(context.sessionKind),
      modelRoute: context.existing?.effectiveModel ?? context.selectedModel,
      workflowStageKey: context.existing?.workflowStageKey ?? null,
      status: context.nodeStatus,
      inputTokens: context.existing?.inputTokens ?? 0,
      outputTokens: context.existing?.outputTokens ?? 0,
      totalTokens: context.existing?.totalTokens ?? 0,
      costUsd: context.existing?.costUsd ?? 0,
      resultSummary: context.existing?.resultSummary ?? null,
      errorText: context.existing?.errorText ?? null,
      startedAt: context.runStartedAt,
      finishedAt: context.runFinishedAt,
      createdAt: context.runCreatedAt,
    };
  }

  function buildTaskSessionRunUpdateValues(context: TaskSessionWriteContext) {
    return {
      taskId: context.args.task.id,
      sessionId: context.sessionId,
      phaseId: context.phaseId,
      runtimeSessionId: context.args.runtimeSessionId,
      triggerType: mapTaskSessionTriggerTypeToRunTriggerType(context.triggerType),
      executionKind: mapTaskSessionKindToRunExecutionKind(context.sessionKind),
      operationId: context.effectiveOperationId,
      candidateIndex: context.candidateIndex,
      laneRole: mapTaskSessionKindToRunLaneRole(context.sessionKind),
      executorKind: mapTaskSessionKindToExecutorKind(context.sessionKind),
      modelRoute: context.existing?.effectiveModel ?? context.selectedModel,
      status: context.nodeStatus,
      resultSummary: context.existing?.resultSummary ?? null,
      errorText: context.existing?.errorText ?? null,
      startedAt: context.runStartedAt,
      finishedAt: context.runFinishedAt,
    };
  }

  function buildTaskSessionRunPassiveUpdateValues(context: TaskSessionWriteContext) {
    return {
      taskId: context.args.task.id,
      sessionId: context.sessionId,
      phaseId: context.phaseId,
      runtimeSessionId: context.args.runtimeSessionId,
      status: context.nodeStatus,
      resultSummary: context.existing?.resultSummary ?? null,
      errorText: context.existing?.errorText ?? null,
      startedAt: context.runStartedAt,
      finishedAt: context.runFinishedAt,
    };
  }

  function hasExplicitTaskSessionLineagePatch(args: UpsertTaskSessionRecordArgs) {
    return (
      args.parentRuntimeSessionId !== undefined ||
      args.forkedFromMessageId !== undefined ||
      args.branchName !== undefined ||
      args.sourceType !== undefined ||
      args.sessionKind !== undefined ||
      args.executionModeSnapshot !== undefined ||
      args.candidateIndex !== undefined ||
      args.stepIndex !== undefined ||
      args.selectedModel !== undefined ||
      args.phaseId !== undefined ||
      args.phaseRole !== undefined ||
      args.phaseItemIndex !== undefined ||
      args.operationId !== undefined
    );
  }

  async function upsertTaskSessionRecord(args: UpsertTaskSessionRecordArgs) {
    const hasExplicitLineage = hasExplicitTaskSessionLineagePatch(args);
    const context = await buildTaskSessionWriteContext(args, hasExplicitLineage);

    await db
      .insert(taskSessions)
      .values(buildTaskSessionInsertValues(context))
      .onConflictDoUpdate({
        target: taskSessions.id,
        set: hasExplicitLineage
          ? buildTaskSessionUpdateValues(context)
          : buildTaskSessionPassiveUpdateValues(context),
      });

    await db
      .insert(taskSessionRuns)
      .values(buildTaskSessionRunInsertValues(context))
      .onConflictDoUpdate({
        target: taskSessionRuns.id,
        set: hasExplicitLineage
          ? buildTaskSessionRunUpdateValues(context)
          : buildTaskSessionRunPassiveUpdateValues(context),
      });

    await db
      .update(taskSessions)
      .set({
        latestRunId: context.latestRunId,
        updatedAt: context.now,
      })
      .where(eq(taskSessions.id, context.sessionId));

    return context.sessionId;
  }

  return {
    resolveTaskSessionId,
    upsertTaskSessionRecord,
  };
}
