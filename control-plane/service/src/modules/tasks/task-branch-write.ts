import { z } from "zod";
import type { TaskTreeSnapshot } from "../project-tree/storage";
import type { TaskTreeRecord } from "../project-tree/task-view";
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
  sourceType: z.enum(["root", "fork", "sub_session"]).optional(),
  sessionKind: z
    .enum(["primary", "candidate", "judge", "sequential_step", "resume", "manual_branch", "hook"])
    .optional(),
  executionModeSnapshot: z.enum(["single", "parallel", "sequential_chain"]).optional(),
  isActive: z.boolean().optional(),
  candidateIndex: z.number().int().min(0).optional(),
  stepIndex: z.number().int().min(0).optional(),
  selectedModel: z.string().max(200).optional(),
  coordinationKey: z.string().max(500).optional(),
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
  sourceType: "root" | "fork" | "sub_session" | null;
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
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  isActive: boolean;
};

type ResolvedTaskBranchState = {
  runtimeSessionId: string;
  parentRuntimeSessionId: string | null;
  forkedFromMessageId: string | null;
  branchName: string | null;
  sourceType: "root" | "fork" | "sub_session" | null;
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
  candidateIndex?: number | null;
  stepIndex?: number | null;
  selectedModel?: string | null;
  isActive: boolean;
  coordinationKey?: string;
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
      record.sourceType === "fork" ||
      record.sourceType === "sub_session" ||
      record.candidateIndex != null ||
      record.stepIndex != null ||
      record.selectedModel,
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
    candidateIndex: body.candidateIndex ?? existingRecord?.candidateIndex ?? null,
    stepIndex: body.stepIndex ?? existingRecord?.stepIndex ?? null,
    selectedModel: body.selectedModel ?? existingRecord?.selectedModel ?? null,
    isActive: body.isActive ?? existingRecord?.isActive ?? false,
    coordinationKey: body.coordinationKey,
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
    sourceType?: "root" | "fork" | "sub_session" | null;
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
    sourceType?: "root" | "fork" | "sub_session" | null;
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
    isActive?: boolean;
    archivedAt?: string | null;
    candidateIndex?: number | null;
    stepIndex?: number | null;
    selectedModel?: string | null;
    coordinationKey?: string | null;
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
    const branchState = resolveTaskBranchState(body, existingRecord);

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
      isActive: branchState.isActive,
      archivedAt: null,
      candidateIndex: branchState.candidateIndex,
      stepIndex: branchState.stepIndex,
      selectedModel: branchState.selectedModel,
      coordinationKey: branchState.coordinationKey,
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
    const isActive = task.sessionId === body.runtimeSessionId;

    await deps.syncTaskBranchCompatTreeNode({
      taskId,
      runtimeSessionId: body.runtimeSessionId,
      parentRuntimeSessionId: existingRecord?.parentRuntimeSessionId ?? null,
      forkedFromMessageId: existingRecord?.forkedFromMessageId ?? null,
      branchName: existingRecord?.branchName ?? body.runtimeSessionId,
      sourceType: existingRecord?.sourceType ?? "root",
      isActive,
      archivedAt: null,
    });

    await deps.upsertConversationSessionRecord({
      task,
      runtimeSessionId: body.runtimeSessionId,
      parentRuntimeSessionId: existingRecord?.parentRuntimeSessionId ?? null,
      forkedFromMessageId: existingRecord?.forkedFromMessageId ?? null,
      branchName: existingRecord?.branchName ?? body.runtimeSessionId,
      sourceType: existingRecord?.sourceType ?? "root",
      isActive,
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

    await deps.syncTaskBranchCompatTreeNode({
      taskId,
      runtimeSessionId: record.runtimeSessionId,
      parentRuntimeSessionId: record.parentRuntimeSessionId ?? null,
      forkedFromMessageId: record.forkedFromMessageId ?? null,
      branchName: record.branchName ?? null,
      sourceType: record.sourceType,
      isActive: true,
      archivedAt: null,
    });

    await deps.upsertConversationSessionRecord({
      task,
      runtimeSessionId: record.runtimeSessionId,
      parentRuntimeSessionId: record.parentRuntimeSessionId ?? null,
      forkedFromMessageId: record.forkedFromMessageId ?? null,
      branchName: record.branchName ?? null,
      sourceType: record.sourceType,
      isActive: true,
      archivedAt: null,
    });

    const taskSnapshot = deps.buildTaskTreeSnapshotFromRecord(task, {
      status: "running",
      sessionId: record.runtimeSessionId,
    });
    await deps.upsertTaskTreeNode(taskSnapshot);
    await deps.syncTaskAggregateFromSnapshot(taskSnapshot);

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
