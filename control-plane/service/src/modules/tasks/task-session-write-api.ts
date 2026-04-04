import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  taskSessionRuns,
  taskSessions,
  type ExecutionStatus,
  type TaskSessionKind,
  type TaskSessionMode,
  type TaskSessionNodeType,
  type TaskSessionRunExecutionKind,
  type TaskSessionRunLaneRole,
  type TaskSessionRunTriggerType,
  type TaskSessionTriggerType,
} from "../../db/schema";
import { getTaskBranchCompatNodeId } from "../project-tree/storage";

type TaskSessionSourceType = "root" | "fork" | "sub_session" | null | undefined;

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
  isActive?: boolean;
  archivedAt?: string | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  coordinationKey?: string | null;
  operationId?: string | null;
};

export function buildTaskSessionWriteId(taskId: string, runtimeSessionId: string) {
  return `task-session:${taskId}:${runtimeSessionId}`;
}

export function buildTaskSessionDefaultRunId(sessionId: string) {
  return `run_${sessionId}`;
}

function mapSourceTypeToTaskSessionKind(sourceType: TaskSessionSourceType): TaskSessionKind {
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

function resolveTaskSessionMode(args: {
  executionModeSnapshot?: TaskSessionMode | null;
  sessionKind?: TaskSessionKind | null;
}) {
  if (args.executionModeSnapshot) {
    return args.executionModeSnapshot;
  }

  return args.sessionKind === "sequential_step" ? "sequential_chain" : "single";
}

function sanitizeForkedFromMessageId(forkedFromMessageId?: string | null) {
  if (typeof forkedFromMessageId === "string" && forkedFromMessageId.trim()) {
    return forkedFromMessageId;
  }

  return null;
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

  async function upsertTaskSessionRecord(args: UpsertTaskSessionRecordArgs) {
    const sessionId = buildTaskSessionWriteId(args.task.id, args.runtimeSessionId);
    const now = new Date().toISOString();
    const existing = await db.query.taskSessions.findFirst({
      where: eq(taskSessions.id, sessionId),
    });

    let parentSessionId = existing?.parentSessionId ?? null;
    let rootSessionId = existing?.rootSessionId ?? sessionId;
    let parentDepth = 0;
    let parentSortKey = null as string | null;

    if (args.parentRuntimeSessionId !== undefined) {
      const resolved = await resolveParentAndRootSessionIds({
        taskId: args.task.id,
        parentRuntimeSessionId: args.parentRuntimeSessionId,
      });
      parentSessionId = resolved.parentSessionId;
      rootSessionId = resolved.rootSessionId ?? sessionId;
      parentDepth = resolved.parentDepth;
      parentSortKey = resolved.parentSortKey;
    }

    const branchName = args.branchName ?? existing?.branchName ?? null;
    const forkedFromMessageId =
      args.forkedFromMessageId !== undefined
        ? sanitizeForkedFromMessageId(args.forkedFromMessageId)
        : (existing?.forkedFromMessageId ?? null);
    const sessionKind =
      args.sessionKind ?? existing?.sessionKind ?? resolveTaskSessionKind(args);
    const executionModeSnapshot =
      args.executionModeSnapshot ??
      existing?.executionModeSnapshot ??
      resolveTaskSessionMode({
        executionModeSnapshot: args.executionModeSnapshot,
        sessionKind,
      });
    const candidateIndex =
      args.candidateIndex !== undefined ? args.candidateIndex : (existing?.candidateIndex ?? null);
    const stepIndex = args.stepIndex !== undefined ? args.stepIndex : (existing?.stepIndex ?? null);
    const selectedModel =
      args.selectedModel !== undefined ? args.selectedModel : (existing?.selectedModel ?? null);

    const effectiveCoordinationKey =
      args.coordinationKey ??
      existing?.coordinationKey ??
      rootSessionId;

    const effectiveOperationId =
      args.operationId ??
      existing?.operationId ??
      null;

    const triggerType = mapSourceTypeToTaskSessionTriggerType(args.sourceType);
    const latestRunId = buildTaskSessionDefaultRunId(sessionId);
    const persistedLatestRunId = existing?.latestRunId ?? null;
    const sessionType = mapTaskSessionNodeType({
      sourceType: args.sourceType,
      sessionKind,
      parentSessionId,
    });
    const depth = parentSessionId ? parentDepth + 1 : 0;
    const sortKey =
      existing?.sortKey ?? (parentSortKey ? `${parentSortKey}.${sessionId}` : sessionId);
    const sourceMessageId = parentSessionId ? forkedFromMessageId : null;
    const nodeStatus = args.archivedAt
      ? "archived"
      : args.isActive
        ? "running"
        : (existing?.status ?? "running");
    const runCreatedAt = existing?.startedAt ?? existing?.createdAt ?? now;
    const runStartedAt = existing?.startedAt ?? (args.isActive ? now : null);
    const runFinishedAt =
      args.archivedAt ??
      (nodeStatus === "completed" ? existing?.finishedAt ?? existing?.updatedAt ?? now : null);

    const treeNodeId = getTaskBranchCompatNodeId(args.task.id, args.runtimeSessionId);

    await db
      .insert(taskSessions)
      .values({
        id: sessionId,
        taskId: args.task.id,
        projectId: args.task.projectId,
        treeNodeId,
        parentSessionId,
        rootSessionId,
        sourceMessageId,
        sessionType,
        workflowStageKey: existing?.workflowStageKey ?? null,
        spawnTriggerType: triggerType,
        spawnRuleKey: existing?.spawnRuleKey ?? null,
        userPromptSummary: existing?.userPromptSummary ?? null,
        status: nodeStatus,
        headMessageId: existing?.headMessageId ?? null,
        latestRunId: persistedLatestRunId,
        depth,
        sortKey,
        coordinationKey: effectiveCoordinationKey,
        operationId: effectiveOperationId,
        sessionKind,
        triggerType,
        executionModeSnapshot,
        executionStatus: mapTaskSessionExecutionStatus(args),
        branchName,
        candidateIndex,
        stepIndex,
        runtimeSessionId: args.runtimeSessionId,
        forkedFromMessageId,
        selectedModel,
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
        lastActivityAt: now,
        startedAt: args.isActive ? now : null,
        finishedAt: args.archivedAt ?? null,
        createdAt: now,
        updatedAt: now,
        archivedAt: args.archivedAt ?? null,
      })
      .onConflictDoUpdate({
        target: taskSessions.id,
        set: {
          projectId: args.task.projectId,
          treeNodeId,
          parentSessionId,
          rootSessionId,
          sourceMessageId,
          sessionType,
          spawnTriggerType: triggerType,
          latestRunId: persistedLatestRunId,
          depth,
          sortKey,
          coordinationKey: effectiveCoordinationKey,
          operationId: effectiveOperationId,
          sessionKind,
          triggerType,
          executionModeSnapshot,
          status: nodeStatus,
          executionStatus: mapTaskSessionExecutionStatus(args),
          branchName,
          candidateIndex,
          stepIndex,
          runtimeSessionId: args.runtimeSessionId,
          forkedFromMessageId,
          selectedModel,
          lastActivityAt: now,
          finishedAt: args.archivedAt ?? null,
          updatedAt: now,
          archivedAt: args.archivedAt ?? null,
        },
      });

    await db
      .insert(taskSessionRuns)
      .values({
        id: latestRunId,
        taskId: args.task.id,
        sessionId,
        attemptIndex: 1,
        runtimeSessionId: args.runtimeSessionId,
        triggerType: mapTaskSessionTriggerTypeToRunTriggerType(triggerType),
        executionKind: mapTaskSessionKindToRunExecutionKind(sessionKind),
        coordinationKey: effectiveCoordinationKey,
        operationId: effectiveOperationId,
        candidateIndex,
        laneRole: mapTaskSessionKindToRunLaneRole(sessionKind),
        executorKind: mapTaskSessionKindToExecutorKind(sessionKind),
        modelRoute: existing?.effectiveModel ?? selectedModel,
        workflowStageKey: existing?.workflowStageKey ?? null,
        status: nodeStatus,
        inputTokens: existing?.inputTokens ?? 0,
        outputTokens: existing?.outputTokens ?? 0,
        totalTokens: existing?.totalTokens ?? 0,
        costUsd: existing?.costUsd ?? 0,
        resultSummary: existing?.resultSummary ?? null,
        errorText: existing?.errorText ?? null,
        startedAt: runStartedAt,
        finishedAt: runFinishedAt,
        createdAt: runCreatedAt,
      })
      .onConflictDoUpdate({
        target: taskSessionRuns.id,
        set: {
          taskId: args.task.id,
          sessionId,
          runtimeSessionId: args.runtimeSessionId,
          triggerType: mapTaskSessionTriggerTypeToRunTriggerType(triggerType),
          executionKind: mapTaskSessionKindToRunExecutionKind(sessionKind),
          coordinationKey: effectiveCoordinationKey,
          operationId: effectiveOperationId,
          candidateIndex,
          laneRole: mapTaskSessionKindToRunLaneRole(sessionKind),
          executorKind: mapTaskSessionKindToExecutorKind(sessionKind),
          modelRoute: existing?.effectiveModel ?? selectedModel,
          status: nodeStatus,
          resultSummary: existing?.resultSummary ?? null,
          errorText: existing?.errorText ?? null,
          startedAt: runStartedAt,
          finishedAt: runFinishedAt,
        },
      });

    await db
      .update(taskSessions)
      .set({
        latestRunId,
        updatedAt: now,
      })
      .where(eq(taskSessions.id, sessionId));

    return sessionId;
  }

  return {
    resolveTaskSessionId,
    upsertTaskSessionRecord,
  };
}