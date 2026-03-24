/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test";
import type { TaskTreeSnapshot } from "../../control-plane/service/src/modules/project-tree/storage";
import { createTaskBranchWriteApi } from "../../control-plane/service/src/modules/tasks/task-branch-write";

function createTaskRecord(overrides?: Partial<{ sessionId: string | null }>) {
  return {
    id: "task-1",
    projectId: "project-1",
    title: "Task title",
    prompt: "Task prompt",
    status: "pending",
    sessionId: overrides?.sessionId ?? null,
    workingBranch: null,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
  } as never;
}

describe("task branch write", () => {
  test("upsertTaskBranch forwards only the session node lineage-only whitelist to storage sync", async () => {
    const syncTaskBranchCompatTreeNode = mock(async () => "task_session:task-1:fork-session-1");
    const upsertConversationSessionRecord = mock(async () => undefined);
    const buildTaskTreeSnapshotFromRecord = mock(
      (_task: unknown, updates: Record<string, unknown>) => updates as TaskTreeSnapshot,
    );
    const upsertTaskTreeNode = mock(async () => undefined);
    const syncTaskAggregateFromSnapshot = mock(async () => undefined);

    const api = createTaskBranchWriteApi({
      loadTaskTreeBackedRecord: mock(async () => createTaskRecord()),
      resolveTaskBranchCompatRecord: mock(async () => null),
      resolveTaskBranchCompatRecordByRuntimeSessionId: mock(async () => null),
      syncTaskBranchCompatTreeNode,
      archiveTaskBranchCompatTreeNode: mock(async () => undefined),
      upsertConversationSessionRecord,
      upsertConversationMessageRecord: mock(async () => ({ seq: 1 })),
      buildTaskTreeSnapshotFromRecord,
      upsertTaskTreeNode,
      syncTaskAggregateFromSnapshot,
    });

    const result = await api.upsertTaskBranch("task-1", {
      runtimeSessionId: "fork-session-1",
      parentRuntimeSessionId: "root-session-1",
      forkedFromMessageId: "msg-1",
      branchName: "feature/fork",
      sourceType: "fork",
      isActive: true,
    });

    expect(result.ok).toBe(true);
    expect(syncTaskBranchCompatTreeNode).toHaveBeenCalledTimes(1);

    const firstCallArg = syncTaskBranchCompatTreeNode.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstCallArg).toEqual({
      taskId: "task-1",
      runtimeSessionId: "fork-session-1",
      parentRuntimeSessionId: "root-session-1",
      forkedFromMessageId: "msg-1",
      branchName: "feature/fork",
      sourceType: "fork",
      isActive: true,
      archivedAt: null,
    });
    expect(Object.keys(firstCallArg).sort()).toEqual([
      "archivedAt",
      "branchName",
      "forkedFromMessageId",
      "isActive",
      "parentRuntimeSessionId",
      "runtimeSessionId",
      "sourceType",
      "taskId",
    ]);
    expect(firstCallArg).not.toHaveProperty("status");
    expect(firstCallArg).not.toHaveProperty("result");
    expect(firstCallArg).not.toHaveProperty("strategy");
    expect(firstCallArg).not.toHaveProperty("executionMode");
    expect(firstCallArg).not.toHaveProperty("changesSummary");

    expect(upsertConversationSessionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSessionId: "fork-session-1",
        parentRuntimeSessionId: "root-session-1",
        forkedFromMessageId: "msg-1",
        branchName: "feature/fork",
        sourceType: "fork",
        isActive: true,
        archivedAt: null,
      }),
    );
    expect(buildTaskTreeSnapshotFromRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
      { sessionId: "fork-session-1" },
    );
    expect(upsertTaskTreeNode).toHaveBeenCalledTimes(1);
    expect(syncTaskAggregateFromSnapshot).toHaveBeenCalledTimes(1);
  });

  test("activateTaskBranch forwards only the session node lineage-only whitelist to storage sync", async () => {
    const syncTaskBranchCompatTreeNode = mock(async () => "task_session:task-1:fork-session-1");
    const upsertConversationSessionRecord = mock(async () => undefined);
    const buildTaskTreeSnapshotFromRecord = mock(
      (_task: unknown, updates: Record<string, unknown>) => updates as TaskTreeSnapshot,
    );
    const upsertTaskTreeNode = mock(async () => undefined);
    const syncTaskAggregateFromSnapshot = mock(async () => undefined);

    const api = createTaskBranchWriteApi({
      loadTaskTreeBackedRecord: mock(async () => createTaskRecord()),
      resolveTaskBranchCompatRecord: mock(async () => ({
        runtimeSessionId: "fork-session-1",
        parentRuntimeSessionId: "root-session-1",
        forkedFromMessageId: "msg-activate-1",
        branchName: "feature/fork-activate",
        sourceType: "fork",
        isActive: false,
      })),
      resolveTaskBranchCompatRecordByRuntimeSessionId: mock(async () => null),
      syncTaskBranchCompatTreeNode,
      archiveTaskBranchCompatTreeNode: mock(async () => undefined),
      upsertConversationSessionRecord,
      upsertConversationMessageRecord: mock(async () => ({ seq: 1 })),
      buildTaskTreeSnapshotFromRecord,
      upsertTaskTreeNode,
      syncTaskAggregateFromSnapshot,
    });

    const result = await api.activateTaskBranch("task-1", "branch-node-1");

    expect(result.ok).toBe(true);
    expect(syncTaskBranchCompatTreeNode).toHaveBeenCalledTimes(1);

    const firstCallArg = syncTaskBranchCompatTreeNode.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstCallArg).toEqual({
      taskId: "task-1",
      runtimeSessionId: "fork-session-1",
      parentRuntimeSessionId: "root-session-1",
      forkedFromMessageId: "msg-activate-1",
      branchName: "feature/fork-activate",
      sourceType: "fork",
      isActive: true,
      archivedAt: null,
    });
    expect(Object.keys(firstCallArg).sort()).toEqual([
      "archivedAt",
      "branchName",
      "forkedFromMessageId",
      "isActive",
      "parentRuntimeSessionId",
      "runtimeSessionId",
      "sourceType",
      "taskId",
    ]);
    expect(firstCallArg).not.toHaveProperty("status");
    expect(firstCallArg).not.toHaveProperty("result");
    expect(firstCallArg).not.toHaveProperty("strategy");
    expect(firstCallArg).not.toHaveProperty("executionMode");
    expect(firstCallArg).not.toHaveProperty("changesSummary");

    expect(upsertConversationSessionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSessionId: "fork-session-1",
        parentRuntimeSessionId: "root-session-1",
        forkedFromMessageId: "msg-activate-1",
        branchName: "feature/fork-activate",
        sourceType: "fork",
        isActive: true,
        archivedAt: null,
      }),
    );
    expect(buildTaskTreeSnapshotFromRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
      { sessionId: "fork-session-1" },
    );
    expect(upsertTaskTreeNode).toHaveBeenCalledTimes(1);
    expect(syncTaskAggregateFromSnapshot).toHaveBeenCalledTimes(1);
  });

  test("archiveTaskBranch preserves the session node lineage-only whitelist by avoiding extra storage sync", async () => {
    const syncTaskBranchCompatTreeNode = mock(async () => "task_session:task-1:fork-session-1");
    const archiveTaskBranchCompatTreeNode = mock(async () => undefined);
    const upsertConversationSessionRecord = mock(async () => undefined);
    const buildTaskTreeSnapshotFromRecord = mock(
      (_task: unknown, updates: Record<string, unknown>) => updates as TaskTreeSnapshot,
    );
    const upsertTaskTreeNode = mock(async () => undefined);
    const syncTaskAggregateFromSnapshot = mock(async () => undefined);

    const api = createTaskBranchWriteApi({
      loadTaskTreeBackedRecord: mock(async () => createTaskRecord()),
      resolveTaskBranchCompatRecord: mock(async () => ({
        runtimeSessionId: "fork-session-1",
        parentRuntimeSessionId: "root-session-1",
        forkedFromMessageId: "msg-archive-1",
        branchName: "feature/fork-archive",
        sourceType: "fork",
        isActive: true,
      })),
      resolveTaskBranchCompatRecordByRuntimeSessionId: mock(async () => null),
      syncTaskBranchCompatTreeNode,
      archiveTaskBranchCompatTreeNode,
      upsertConversationSessionRecord,
      upsertConversationMessageRecord: mock(async () => ({ seq: 1 })),
      buildTaskTreeSnapshotFromRecord,
      upsertTaskTreeNode,
      syncTaskAggregateFromSnapshot,
    });

    const beforeArchive = Date.now();
    const result = await api.archiveTaskBranch("task-1", "branch-node-1");
    const afterArchive = Date.now();

    expect(result).toEqual({ ok: true, status: 200, data: { ok: true } });
    expect(archiveTaskBranchCompatTreeNode).toHaveBeenCalledTimes(1);
    expect(archiveTaskBranchCompatTreeNode).toHaveBeenCalledWith("task-1", "fork-session-1");
    expect(syncTaskBranchCompatTreeNode).not.toHaveBeenCalled();

    expect(upsertConversationSessionRecord).toHaveBeenCalledTimes(1);
    const sessionSyncArg = upsertConversationSessionRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sessionSyncArg).toMatchObject({
      runtimeSessionId: "fork-session-1",
      parentRuntimeSessionId: "root-session-1",
      forkedFromMessageId: "msg-archive-1",
      branchName: "feature/fork-archive",
      sourceType: "fork",
      isActive: false,
    });
    expect(typeof sessionSyncArg.archivedAt).toBe("string");
    const archivedAt = Date.parse(String(sessionSyncArg.archivedAt));
    expect(Number.isNaN(archivedAt)).toBe(false);
    expect(archivedAt).toBeGreaterThanOrEqual(beforeArchive - 1000);
    expect(archivedAt).toBeLessThanOrEqual(afterArchive + 1000);
    expect(Object.keys(sessionSyncArg).sort()).toEqual([
      "archivedAt",
      "branchName",
      "forkedFromMessageId",
      "isActive",
      "parentRuntimeSessionId",
      "runtimeSessionId",
      "sourceType",
      "task",
    ]);
    expect(sessionSyncArg).not.toHaveProperty("status");
    expect(sessionSyncArg).not.toHaveProperty("result");
    expect(sessionSyncArg).not.toHaveProperty("strategy");
    expect(sessionSyncArg).not.toHaveProperty("executionMode");
    expect(sessionSyncArg).not.toHaveProperty("changesSummary");

    expect(buildTaskTreeSnapshotFromRecord).not.toHaveBeenCalled();
    expect(upsertTaskTreeNode).not.toHaveBeenCalled();
    expect(syncTaskAggregateFromSnapshot).not.toHaveBeenCalled();
  });
});