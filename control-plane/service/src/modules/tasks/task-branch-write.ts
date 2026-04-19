import { z } from "zod";
import type { TaskTreeSnapshot } from "../project-tree/storage";
import type { TaskTreeRecord } from "../project-tree/task-view";
import { normalizePublicTaskStatusValue } from "./public-task-status";
import {
  extractTaskSessionMessageRuntimeId,
  taskSessionRuntimeMessageSchema,
  type TaskSessionRuntimeMessageInput,
} from "./task-session-runtime-message-schema";
import { shouldPersistStandalonePartEvent } from "./task-session-read";

export const createTaskBranchSchema = z.object({
  runtimeSessionId: z.string().min(1),
  parentRuntimeSessionId: z.string().optional(),
  forkedFromMessageId: z.string().optional(),
  branchName: z.string().max(200).optional(),
  sourceType: z.enum(["root", "fork", "sub_session", "parallel"]).optional(),
  sessionKind: z
    .enum(["primary", "candidate", "judge", "sequential_step", "resume", "manual_branch", "hook"])
    .optional(),
  executionModeSnapshot: z.enum(["single", "parallel", "sequential_chain"]).optional(),
  phaseId: z.string().min(1).optional(),
  phaseRole: z.enum(["mainline", "candidate", "judge", "step", "aux"]).optional(),
  phaseItemIndex: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  candidateIndex: z.number().int().min(0).optional(),
  stepIndex: z.number().int().min(0).optional(),
  selectedModel: z.string().max(200).optional(),
  operationId: z.string().max(200).optional(),
});

export const persistTaskBranchMessageSchema = z.object({
  runtimeSessionId: z.string().min(1),
  message: taskSessionRuntimeMessageSchema,
});

export type CreateTaskBranchInput = z.infer<typeof createTaskBranchSchema>;
export type PersistTaskBranchMessageInput = z.infer<typeof persistTaskBranchMessageSchema>;

type TaskBranchCompatRecord = {
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  branchName: string | null;
  sourceType: "root" | "fork" | "sub_session" | "parallel" | null;
  sessionKind?:
    | "primary"
    | "candidate"
    | "judge"
    | "sequential_step"
    | "resume"
    | "manual_branch"
    | "hook"
    | null;
  executionModeSnapshot?: "single" | "parallel" | "sequential_chain" | null;
  phaseId?: string | null;
  phaseRole?: "mainline" | "candidate" | "judge" | "step" | "aux" | null;
  phaseItemIndex?: number | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  operationId?: string | null;
  isActive: boolean;
};

type ResolvedTaskBranchState = {
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  branchName: string | null;
  sourceType: "root" | "fork" | "sub_session" | "parallel" | null;
  sessionKind?:
    | "primary"
    | "candidate"
    | "judge"
    | "sequential_step"
    | "resume"
    | "manual_branch"
    | "hook"
    | null;
  executionModeSnapshot?: "single" | "parallel" | "sequential_chain" | null;
  phaseId?: string | null;
  phaseRole?: "mainline" | "candidate" | "judge" | "step" | "aux" | null;
  phaseItemIndex?: number | null;
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  isActive: boolean;
  operationId?: string;
};

function hasMaterializedTaskBranchRecord(record: TaskBranchCompatRecord | null) {
  if (!record) {
    return false;
  }

  return Boolean(
    record.branchName ||
      record.parentRuntimeSessionId ||
      record.forkedFromMessageId ||
      record.sourceType === "parallel" ||
      record.sourceType === "fork" ||
      record.sourceType === "sub_session" ||
        record.phaseId ||
        record.phaseRole ||
        record.phaseItemIndex != null ||
      record.candidateIndex != null ||
      record.stepIndex != null ||
      record.selectedModel,
  );
}

function shouldPreserveCandidateActiveState(record: TaskBranchCompatRecord | null) {
  if (!record) {
    return false;
  }

  return (
    record.sourceType === "parallel" ||
    record.sessionKind === "candidate" ||
    record.phaseRole === "candidate" ||
    record.executionModeSnapshot === "parallel" ||
    record.candidateIndex != null
  );
}

function resolveTaskBranchState(
  body: CreateTaskBranchInput,
  existingRecord: TaskBranchCompatRecord | null,
): ResolvedTaskBranchState {
  return {
    runtimeSessionId: body.runtimeSessionId,
    parentRuntimeSessionId:
      body.parentRuntimeSessionId ?? existingRecord?.parentRuntimeSessionId ?? null,
    forkedFromMessageId: body.forkedFromMessageId ?? existingRecord?.forkedFromMessageId ?? null,
    branchName: body.branchName ?? existingRecord?.branchName ?? null,
    sourceType: body.sourceType ?? existingRecord?.sourceType ?? null,
    sessionKind: body.sessionKind ?? existingRecord?.sessionKind ?? null,
    executionModeSnapshot:
      body.executionModeSnapshot ?? existingRecord?.executionModeSnapshot ?? null,
    phaseId: body.phaseId ?? existingRecord?.phaseId ?? null,
    phaseRole: body.phaseRole ?? existingRecord?.phaseRole ?? null,
    phaseItemIndex: body.phaseItemIndex ?? existingRecord?.phaseItemIndex ?? null,
    candidateIndex: body.candidateIndex ?? existingRecord?.candidateIndex ?? null,
    stepIndex: body.stepIndex ?? existingRecord?.stepIndex ?? null,
    selectedModel: body.selectedModel ?? existingRecord?.selectedModel ?? null,
    isActive: body.isActive ?? existingRecord?.isActive ?? false,
    operationId: body.operationId,
  };
}

function buildTaskBranchResponse(args: {
  sessionId: string;
  taskId: string;
  runtimeSessionId: string;
  updated: boolean;
}) {
  return args.updated
    ? {
        id: args.sessionId,
        taskId: args.taskId,
        runtimeSessionId: args.runtimeSessionId,
        updated: true,
      }
    : {
        id: args.sessionId,
        taskId: args.taskId,
        runtimeSessionId: args.runtimeSessionId,
      };
}

function isTerminalTaskRecord(task: Pick<TaskTreeRecord, "status" | "finishedAt">) {
  const normalizedStatus = normalizePublicTaskStatusValue(task.status);
  return (
    normalizedStatus === "completed" ||
    normalizedStatus === "failed" ||
    normalizedStatus === "cancelled" ||
    Boolean(task.finishedAt)
  );
}

export function createTaskBranchWriteApi(deps: {
  loadTaskTreeBackedRecord: (taskId: string) => Promise<TaskTreeRecord | null>;
  resolveTaskBranchCompatRecord: (
    taskId: string,
    projectId: string,
    branchId: string,
  ) => Promise<TaskBranchCompatRecord | null>;
  resolveTaskBranchCompatRecordByRuntimeSessionId: (
    taskId: string,
    projectId: string,
    runtimeSessionId: string,
  ) => Promise<TaskBranchCompatRecord | null>;
  syncTaskBranchCompatTreeNode: (args: {
    taskId: string;
    runtimeSessionId: string;
    parentRuntimeSessionId?: string | null;
    forkedFromMessageId?: string | null;
    branchName?: string | null;
    sourceType?: "root" | "fork" | "sub_session" | "parallel" | null;
    isActive?: boolean;
    archivedAt?: string | null;
  }) => Promise<string>;
  archiveTaskBranchCompatTreeNode: (taskId: string, runtimeSessionId: string) => Promise<unknown>;
  upsertConversationSessionRecord: (args: {
    task: { id: string; projectId: string };
    runtimeSessionId: string;
    parentRuntimeSessionId?: string | null;
    forkedFromMessageId?: string | null;
    branchName?: string | null;
    sourceType?: "root" | "fork" | "sub_session" | "parallel" | null;
    sessionKind?:
      | "primary"
      | "candidate"
      | "judge"
      | "sequential_step"
      | "resume"
      | "manual_branch"
      | "hook"
      | null;
    executionModeSnapshot?: "single" | "parallel" | "sequential_chain" | null;
    phaseId?: string | null;
    phaseRole?: "mainline" | "candidate" | "judge" | "step" | "aux" | null;
    phaseItemIndex?: number | null;
    isActive?: boolean;
    archivedAt?: string | null;
    candidateIndex?: number | null;
    stepIndex?: number | null;
    selectedModel?: string | null;
    operationId?: string | null;
  }) => Promise<string>;
  upsertConversationMessageRecord: (args: {
    task: { id: string; projectId: string };
    runtimeSessionId: string;
    message: TaskSessionRuntimeMessageInput;
  }) => Promise<{ messageId: string; sessionId: string; seq: number }>;
  buildTaskTreeSnapshotFromRecord: (
    task: TaskTreeRecord,
    updates: Record<string, unknown>,
  ) => TaskTreeSnapshot;
  upsertTaskTreeNode: (snapshot: TaskTreeSnapshot) => Promise<unknown>;
  syncTaskAggregateFromSnapshot: (snapshot: TaskTreeSnapshot) => Promise<unknown>;
}) {
  async function upsertTaskBranch(taskId: string, body: CreateTaskBranchInput) {
    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const existingRecord = await deps.resolveTaskBranchCompatRecordByRuntimeSessionId(
      taskId,
      task.projectId,
      body.runtimeSessionId,
    );
    const resolvedBranchState = resolveTaskBranchState(body, existingRecord);
    const branchState = {
      ...resolvedBranchState,
      isActive: isTerminalTaskRecord(task) ? false : resolvedBranchState.isActive,
    };

    await deps.syncTaskBranchCompatTreeNode({
      taskId,
      runtimeSessionId: branchState.runtimeSessionId,
      parentRuntimeSessionId: branchState.parentRuntimeSessionId,
      forkedFromMessageId: branchState.forkedFromMessageId,
      branchName: branchState.branchName,
      sourceType: branchState.sourceType,
      isActive: branchState.isActive,
      archivedAt: null,
    });

    const sessionId = await deps.upsertConversationSessionRecord({
      task,
      runtimeSessionId: branchState.runtimeSessionId,
      parentRuntimeSessionId: branchState.parentRuntimeSessionId,
      forkedFromMessageId: branchState.forkedFromMessageId,
      branchName: branchState.branchName,
      sourceType: branchState.sourceType,
      sessionKind: branchState.sessionKind,
      executionModeSnapshot: branchState.executionModeSnapshot,
      phaseId: branchState.phaseId,
      phaseRole: branchState.phaseRole,
      phaseItemIndex: branchState.phaseItemIndex,
      isActive: branchState.isActive,
      archivedAt: null,
      candidateIndex: branchState.candidateIndex,
      stepIndex: branchState.stepIndex,
      selectedModel: branchState.selectedModel,
      operationId: branchState.operationId,
    });

    if (branchState.isActive) {
      const taskSnapshot = deps.buildTaskTreeSnapshotFromRecord(task, {
        status: "running",
        sessionId: branchState.runtimeSessionId,
      });
      await deps.upsertTaskTreeNode(taskSnapshot);
      await deps.syncTaskAggregateFromSnapshot(taskSnapshot);
    }

    return {
      ok: true as const,
      status: hasMaterializedTaskBranchRecord(existingRecord) ? (200 as const) : (201 as const),
      data: buildTaskBranchResponse({
        sessionId,
        taskId,
        runtimeSessionId: branchState.runtimeSessionId,
        updated: Boolean(existingRecord),
      }),
    };
  }

  async function persistTaskBranchMessage(taskId: string, body: PersistTaskBranchMessageInput) {
    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    if (!extractTaskSessionMessageRuntimeId(body.message)) {
      return {
        ok: false as const,
        status: 400 as const,
        error: "Task session message write requires stable runtimeMessageId",
      };
    }

    const existingRecord = await deps.resolveTaskBranchCompatRecordByRuntimeSessionId(
      taskId,
      task.projectId,
      body.runtimeSessionId,
    );
    const isActive = shouldPreserveCandidateActiveState(existingRecord)
      ? existingRecord?.isActive ?? false
      : task.sessionId === body.runtimeSessionId;
    const effectiveIsActive = isTerminalTaskRecord(task) ? false : isActive;
    const existingCompatLineage = existingRecord
      ? {
          ...(existingRecord.parentRuntimeSessionId
            ? { parentRuntimeSessionId: existingRecord.parentRuntimeSessionId }
            : {}),
          ...(existingRecord.forkedFromMessageId
            ? { forkedFromMessageId: existingRecord.forkedFromMessageId }
            : {}),
          ...(existingRecord.branchName ? { branchName: existingRecord.branchName } : {}),
          ...(existingRecord.sourceType ? { sourceType: existingRecord.sourceType } : {}),
        }
      : {};
    const existingSessionLineage = existingRecord
      ? {
          ...(existingRecord.parentRuntimeSessionId
            ? { parentRuntimeSessionId: existingRecord.parentRuntimeSessionId }
            : {}),
          ...(existingRecord.forkedFromMessageId
            ? { forkedFromMessageId: existingRecord.forkedFromMessageId }
            : {}),
          ...(existingRecord.branchName ? { branchName: existingRecord.branchName } : {}),
          ...(existingRecord.sourceType ? { sourceType: existingRecord.sourceType } : {}),
          ...(existingRecord.sessionKind ? { sessionKind: existingRecord.sessionKind } : {}),
          ...(existingRecord.executionModeSnapshot
            ? { executionModeSnapshot: existingRecord.executionModeSnapshot }
            : {}),
          ...(existingRecord.phaseId ? { phaseId: existingRecord.phaseId } : {}),
          ...(existingRecord.phaseRole ? { phaseRole: existingRecord.phaseRole } : {}),
          ...(existingRecord.phaseItemIndex != null
            ? { phaseItemIndex: existingRecord.phaseItemIndex }
            : {}),
          ...(existingRecord.candidateIndex != null
            ? { candidateIndex: existingRecord.candidateIndex }
            : {}),
          ...(existingRecord.stepIndex != null ? { stepIndex: existingRecord.stepIndex } : {}),
          ...(existingRecord.selectedModel ? { selectedModel: existingRecord.selectedModel } : {}),
          ...(existingRecord.operationId ? { operationId: existingRecord.operationId } : {}),
        }
      : {};

    await deps.syncTaskBranchCompatTreeNode({
      taskId,
      runtimeSessionId: body.runtimeSessionId,
      ...existingCompatLineage,
      isActive: effectiveIsActive,
      archivedAt: null,
    });

    await deps.upsertConversationSessionRecord({
      task,
      runtimeSessionId: body.runtimeSessionId,
      ...existingSessionLineage,
      isActive: effectiveIsActive,
      archivedAt: null,
    });

    const standalonePart =
      body.message && typeof body.message === "object" && "part" in body.message;
    if (standalonePart && !shouldPersistStandalonePartEvent(body.message)) {
      return { ok: true as const, status: 202 as const, data: { ok: true, skipped: true } };
    }

    const persistedMessage = await deps.upsertConversationMessageRecord({
      task,
      runtimeSessionId: body.runtimeSessionId,
      message: body.message,
    });

    return {
      ok: true as const,
      status: 201 as const,
      data: {
        ok: true,
        messageId: persistedMessage.messageId,
        sessionId: persistedMessage.sessionId,
        seq: persistedMessage.seq,
      },
    };
  }

  async function activateTaskBranch(taskId: string, branchId: string) {
    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const record = await deps.resolveTaskBranchCompatRecord(taskId, task.projectId, branchId);
    if (!record) {
      return { ok: false as const, status: 404 as const, error: "Task branch not found" };
    }

    const effectiveIsActive = !isTerminalTaskRecord(task);

    await deps.upsertConversationSessionRecord({
      task,
      runtimeSessionId: record.runtimeSessionId,
      parentRuntimeSessionId: record.parentRuntimeSessionId ?? null,
      forkedFromMessageId: record.forkedFromMessageId ?? null,
      branchName: record.branchName ?? null,
      sourceType: record.sourceType,
      phaseId: record.phaseId ?? null,
      phaseRole: record.phaseRole ?? null,
      phaseItemIndex: record.phaseItemIndex ?? null,
      isActive: effectiveIsActive,
      archivedAt: null,
    });

    if (effectiveIsActive) {
      const taskSnapshot = deps.buildTaskTreeSnapshotFromRecord(task, {
        status: "running",
        sessionId: record.runtimeSessionId,
      });
      await deps.syncTaskAggregateFromSnapshot(taskSnapshot);
    }

    return {
      ok: true as const,
      status: 200 as const,
      data: { ok: true, activatedSessionId: record.runtimeSessionId },
    };
  }

  async function archiveTaskBranch(taskId: string, branchId: string) {
    const task = await deps.loadTaskTreeBackedRecord(taskId);
    if (!task) {
      return { ok: false as const, status: 404 as const, error: "Task not found" };
    }

    const record = await deps.resolveTaskBranchCompatRecord(taskId, task.projectId, branchId);
    if (!record) {
      return { ok: false as const, status: 404 as const, error: "Task branch not found" };
    }

    await deps.archiveTaskBranchCompatTreeNode(taskId, record.runtimeSessionId);
    await deps.upsertConversationSessionRecord({
      task,
      runtimeSessionId: record.runtimeSessionId,
      parentRuntimeSessionId: record.parentRuntimeSessionId ?? null,
      forkedFromMessageId: record.forkedFromMessageId ?? null,
      branchName: record.branchName ?? null,
      sourceType: record.sourceType,
      phaseId: record.phaseId ?? null,
      phaseRole: record.phaseRole ?? null,
      phaseItemIndex: record.phaseItemIndex ?? null,
      isActive: false,
      archivedAt: new Date().toISOString(),
    });

    return { ok: true as const, status: 200 as const, data: { ok: true } };
  }

  return {
    upsertTaskBranch,
    persistTaskBranchMessage,
    activateTaskBranch,
    archiveTaskBranch,
  };
}
