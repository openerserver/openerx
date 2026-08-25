/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { TaskTreeSnapshot } from "../../control-plane/service/src/modules/project-tree/storage";

let importCounter = 0;

async function loadTaskBranchWriteModule() {
  importCounter += 1;

  mock.module("../../control-plane/service/src/modules/tasks/task-session-read", () => ({
    createTaskSessionReadApi: mock(() => ({})),
    buildTaskSessionLineagePath: (
      records: Array<{ id: string; parentSessionId: string | null }>,
      sessionId: string,
    ) => {
      const byId = new Map(records.map((record) => [record.id, record]));
      const path: string[] = [];
      let cursor: string | null = sessionId;
      while (cursor) {
        path.unshift(cursor);
        cursor = byId.get(cursor)?.parentSessionId ?? null;
      }
      return path.length > 0 ? path : [sessionId];
    },
    toCanonicalTaskSessionId: (taskId: string, sessionId?: string | null) =>
      typeof sessionId === "string" && sessionId.trim()
        ? sessionId.startsWith("task-session:")
          ? sessionId
          : `task-session:${taskId}:${sessionId.trim()}`
        : null,
    resolveTaskSessionRecordId: (
      sessions: Array<{ id: string; runtimeSessionId?: string | null }>,
      sessionId?: string | null,
    ) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) {
        return null;
      }

      const normalizedSessionId = sessionId.trim();
      return (
        sessions.find((session) => session.id === normalizedSessionId)?.id ??
        sessions.find((session) => session.runtimeSessionId === normalizedSessionId)?.id ??
        null
      );
    },
    shouldPersistStandalonePartEvent: () => true,
  }));

  return import(
    `../../control-plane/service/src/modules/tasks/task-branch-write.ts?task-branch-write-test=${importCounter}`
  );
}

function createTaskRecord(
  overrides?: Partial<{ sessionId: string | null; status: string; finishedAt: string | null }>,
) {
  return {
    id: "task-1",
    projectId: "project-1",
    title: "Task title",
    prompt: "Task prompt",
    status: overrides?.status ?? "pending",
    sessionId: overrides?.sessionId ?? null,
    workingBranch: null,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    finishedAt: overrides?.finishedAt ?? null,
  } as never;
}

afterEach(() => {
  mock.restore();
});

describe("task branch write", () => {
  test("createTaskBranchSchema accepts explicit parallel sourceType for candidate sessions", async () => {
    const { createTaskBranchSchema } = await loadTaskBranchWriteModule();

    expect(
      createTaskBranchSchema.safeParse({
        runtimeSessionId: "candidate-session-1",
        parentRuntimeSessionId: "root-session-1",
        branchName: "parallel-candidate-1",
        sourceType: "parallel",
        sessionKind: "candidate",
        executionModeSnapshot: "parallel",
        candidateIndex: 0,
        isActive: false,
      }).success,
    ).toBe(true);
  });

  test("persistTaskBranchMessageSchema accepts real runtime message shapes and rejects arbitrary payloads", async () => {
    const { persistTaskBranchMessageSchema } = await loadTaskBranchWriteModule();

    expect(
      persistTaskBranchMessageSchema.safeParse({
        runtimeSessionId: "runtime-session-1",
        message: {
          info: {
            id: "runtime-session-1:user-prompt",
            role: "user",
            time: {
              created: "2026-03-24T00:00:00.000Z",
              completed: "2026-03-24T00:00:01.000Z",
            },
          },
          parts: [{ type: "text", text: "final prompt" }],
          promptDecomposition: {
            userInputText: "prompt",
            systemContextText: "system",
            finalSentText: "systemprompt",
          },
        },
      }).success,
    ).toBe(true);

    expect(
      persistTaskBranchMessageSchema.safeParse({
        runtimeSessionId: "runtime-session-1",
        message: {
          info: {
            id: "tool:call-1",
            role: "tool",
            sessionID: "runtime-session-1",
            time: { created: "2026-03-24T00:00:00.000Z" },
          },
          part: {
            id: "tool-part:call-1",
            type: "tool",
            tool: "read_file",
            callID: "call-1",
            messageID: "tool:call-1",
            state: { status: "running" },
          },
        },
      }).success,
    ).toBe(true);

    const invalid = persistTaskBranchMessageSchema.safeParse({
      runtimeSessionId: "runtime-session-1",
      message: {
        id: "msg-1",
        foo: "bar",
      },
    });
    expect(invalid.success).toBe(false);

    const emptyParts = persistTaskBranchMessageSchema.safeParse({
      runtimeSessionId: "runtime-session-1",
      message: {
        id: "msg-empty-1",
        role: "assistant",
        parts: [],
      },
    });
    expect(emptyParts.success).toBe(false);
  });

  test("upsertTaskBranch forwards only the session node lineage-only whitelist to storage sync", async () => {
    const { createTaskBranchWriteApi } = await loadTaskBranchWriteModule();
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
      { status: "running", sessionId: "fork-session-1" },
    );
    expect(upsertTaskTreeNode).toHaveBeenCalledTimes(1);
    expect(syncTaskAggregateFromSnapshot).toHaveBeenCalledTimes(1);
  });

  test("activateTaskBranch forwards only the session node lineage-only whitelist to storage sync", async () => {
    const { createTaskBranchWriteApi } = await loadTaskBranchWriteModule();
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
    expect(syncTaskBranchCompatTreeNode).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        runtimeSessionId: "fork-session-1",
        parentRuntimeSessionId: "root-session-1",
        forkedFromMessageId: "msg-activate-1",
        branchName: "feature/fork-activate",
        sourceType: "fork",
        isActive: true,
        archivedAt: null,
      }),
    );

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
      { status: "running", sessionId: "fork-session-1" },
    );
    expect(upsertTaskTreeNode).not.toHaveBeenCalled();
    expect(syncTaskAggregateFromSnapshot).toHaveBeenCalledTimes(1);
  });

  test("upsertTaskBranch keeps terminal tasks passive and does not rewrite the parent snapshot to running", async () => {
    const { createTaskBranchWriteApi } = await loadTaskBranchWriteModule();
    const syncTaskBranchCompatTreeNode = mock(async () => "task_session:task-1:fork-session-1");
    const upsertConversationSessionRecord = mock(async () => undefined);
    const buildTaskTreeSnapshotFromRecord = mock(
      (_task: unknown, updates: Record<string, unknown>) => updates as TaskTreeSnapshot,
    );
    const upsertTaskTreeNode = mock(async () => undefined);
    const syncTaskAggregateFromSnapshot = mock(async () => undefined);

    const api = createTaskBranchWriteApi({
      loadTaskTreeBackedRecord: mock(async () =>
        createTaskRecord({ status: "completed", finishedAt: "2026-03-24T00:10:00.000Z" }),
      ),
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
      branchName: "feature/fork",
      sourceType: "fork",
      isActive: true,
    });

    expect(result.ok).toBe(true);
    expect(syncTaskBranchCompatTreeNode).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeSessionId: "fork-session-1", isActive: false }),
    );
    expect(upsertConversationSessionRecord).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeSessionId: "fork-session-1", isActive: false }),
    );
    expect(buildTaskTreeSnapshotFromRecord).not.toHaveBeenCalled();
    expect(upsertTaskTreeNode).not.toHaveBeenCalled();
    expect(syncTaskAggregateFromSnapshot).not.toHaveBeenCalled();
  });

  test("upsertTaskBranch treats implicit root session placeholders as a first explicit create", async () => {
    const { createTaskBranchWriteApi } = await loadTaskBranchWriteModule();

    const api = createTaskBranchWriteApi({
      loadTaskTreeBackedRecord: mock(async () => createTaskRecord()),
      resolveTaskBranchCompatRecord: mock(async () => null),
      resolveTaskBranchCompatRecordByRuntimeSessionId: mock(async () => ({
        runtimeSessionId: "root-session-1",
        parentRuntimeSessionId: null,
        forkedFromMessageId: null,
        branchName: null,
        sourceType: "root",
        isActive: true,
      })),
      syncTaskBranchCompatTreeNode: mock(async () => undefined),
      archiveTaskBranchCompatTreeNode: mock(async () => undefined),
      upsertConversationSessionRecord: mock(async () => "task-session:task-1:root-session-1"),
      upsertConversationMessageRecord: mock(async () => ({ seq: 1 })),
      buildTaskTreeSnapshotFromRecord: mock(
        (_task: unknown, updates: Record<string, unknown>) => updates as TaskTreeSnapshot,
      ),
      upsertTaskTreeNode: mock(async () => undefined),
      syncTaskAggregateFromSnapshot: mock(async () => undefined),
    });

    const result = await api.upsertTaskBranch("task-1", {
      runtimeSessionId: "root-session-1",
      branchName: "explicit-root",
      sourceType: "root",
      isActive: true,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
  });

  test("archiveTaskBranch preserves the session node lineage-only whitelist by avoiding extra storage sync", async () => {
    const { createTaskBranchWriteApi } = await loadTaskBranchWriteModule();
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
    const sessionSyncArg = upsertConversationSessionRecord.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
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
      "phaseId",
      "phaseItemIndex",
      "phaseRole",
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

  test("persistTaskBranchMessage rejects ambiguous writes without a stable message id", async () => {
    const { createTaskBranchWriteApi } = await loadTaskBranchWriteModule();
    const syncTaskBranchCompatTreeNode = mock(async () => "task_session:task-1:runtime-session-1");
    const upsertConversationSessionRecord = mock(async () => undefined);
    const upsertConversationMessageRecord = mock(async () => ({ seq: 1 }));

    const api = createTaskBranchWriteApi({
      loadTaskTreeBackedRecord: mock(async () => createTaskRecord()),
      resolveTaskBranchCompatRecord: mock(async () => null),
      resolveTaskBranchCompatRecordByRuntimeSessionId: mock(async () => null),
      syncTaskBranchCompatTreeNode,
      archiveTaskBranchCompatTreeNode: mock(async () => undefined),
      upsertConversationSessionRecord,
      upsertConversationMessageRecord,
      buildTaskTreeSnapshotFromRecord: mock(
        (_task: unknown, updates: Record<string, unknown>) => updates as TaskTreeSnapshot,
      ),
      upsertTaskTreeNode: mock(async () => undefined),
      syncTaskAggregateFromSnapshot: mock(async () => undefined),
    });

    const result = await api.persistTaskBranchMessage("task-1", {
      runtimeSessionId: "runtime-session-1",
      message: {
        info: {
          role: "assistant",
          time: { created: "2026-03-24T00:00:00.000Z" },
        },
        parts: [{ type: "text", text: "hello" }],
      },
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Task session message write requires stable runtimeMessageId",
    });
    expect(syncTaskBranchCompatTreeNode).not.toHaveBeenCalled();
    expect(upsertConversationSessionRecord).not.toHaveBeenCalled();
    expect(upsertConversationMessageRecord).not.toHaveBeenCalled();
  });

  test("persistTaskBranchMessage does not fabricate root lineage for unknown child sessions", async () => {
    const { createTaskBranchWriteApi } = await loadTaskBranchWriteModule();
    const syncTaskBranchCompatTreeNode = mock(async () => "task_session:task-1:candidate-session-1");
    const upsertConversationSessionRecord = mock(async () => undefined);
    const upsertConversationMessageRecord = mock(async () => ({
      messageId: "task-session-message:task-session:task-1:candidate-session-1:msg-1",
      sessionId: "task-session:task-1:candidate-session-1",
      seq: 1,
    }));

    const api = createTaskBranchWriteApi({
      loadTaskTreeBackedRecord: mock(async () => createTaskRecord({ sessionId: "root-session-1" })),
      resolveTaskBranchCompatRecord: mock(async () => null),
      resolveTaskBranchCompatRecordByRuntimeSessionId: mock(async () => null),
      syncTaskBranchCompatTreeNode,
      archiveTaskBranchCompatTreeNode: mock(async () => undefined),
      upsertConversationSessionRecord,
      upsertConversationMessageRecord,
      buildTaskTreeSnapshotFromRecord: mock(
        (_task: unknown, updates: Record<string, unknown>) => updates as TaskTreeSnapshot,
      ),
      upsertTaskTreeNode: mock(async () => undefined),
      syncTaskAggregateFromSnapshot: mock(async () => undefined),
    });

    const result = await api.persistTaskBranchMessage("task-1", {
      runtimeSessionId: "candidate-session-1",
      message: {
        info: {
          id: "msg-1",
          role: "assistant",
          time: {
            created: "2026-03-24T00:00:00.000Z",
            completed: "2026-03-24T00:00:01.000Z",
          },
        },
        parts: [{ type: "text", text: "hello" }],
      },
    });

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        ok: true,
        messageId: "task-session-message:task-session:task-1:candidate-session-1:msg-1",
        sessionId: "task-session:task-1:candidate-session-1",
        seq: 1,
      },
    });

    expect(syncTaskBranchCompatTreeNode).toHaveBeenCalledWith({
      taskId: "task-1",
      runtimeSessionId: "candidate-session-1",
      isActive: false,
      archivedAt: null,
    });
    expect(upsertConversationSessionRecord).toHaveBeenCalledWith({
      task: expect.objectContaining({ id: "task-1", projectId: "project-1" }),
      runtimeSessionId: "candidate-session-1",
      isActive: false,
      archivedAt: null,
    });
  });

  test("persistTaskBranchMessage preserves registered active state for parallel candidates", async () => {
    const { createTaskBranchWriteApi } = await loadTaskBranchWriteModule();
    const syncTaskBranchCompatTreeNode = mock(async () => "task_session:task-1:candidate-session-1");
    const upsertConversationSessionRecord = mock(async () => undefined);
    const upsertConversationMessageRecord = mock(async () => ({
      messageId: "task-session-message:task-session:task-1:candidate-session-1:msg-2",
      sessionId: "task-session:task-1:candidate-session-1",
      seq: 2,
    }));

    const api = createTaskBranchWriteApi({
      loadTaskTreeBackedRecord: mock(async () => createTaskRecord({ sessionId: "root-session-1" })),
      resolveTaskBranchCompatRecord: mock(async () => null),
      resolveTaskBranchCompatRecordByRuntimeSessionId: mock(async () => ({
        runtimeSessionId: "candidate-session-1",
        parentRuntimeSessionId: "root-session-1",
        forkedFromMessageId: null,
        branchName: "候选 A",
        sourceType: "parallel",
        sessionKind: "candidate",
        executionModeSnapshot: "parallel",
        phaseId: "phase-1",
        phaseRole: "candidate",
        phaseItemIndex: 0,
        candidateIndex: 0,
        stepIndex: null,
        selectedModel: "github-copilot:gpt-5-mini",
        operationId: null,
        isActive: true,
      })),
      syncTaskBranchCompatTreeNode,
      archiveTaskBranchCompatTreeNode: mock(async () => undefined),
      upsertConversationSessionRecord,
      upsertConversationMessageRecord,
      buildTaskTreeSnapshotFromRecord: mock(
        (_task: unknown, updates: Record<string, unknown>) => updates as TaskTreeSnapshot,
      ),
      upsertTaskTreeNode: mock(async () => undefined),
      syncTaskAggregateFromSnapshot: mock(async () => undefined),
    });

    const result = await api.persistTaskBranchMessage("task-1", {
      runtimeSessionId: "candidate-session-1",
      message: {
        info: {
          id: "msg-2",
          role: "assistant",
          time: {
            created: "2026-03-24T00:00:02.000Z",
            completed: "2026-03-24T00:00:03.000Z",
          },
        },
        parts: [{ type: "text", text: "candidate still running" }],
      },
    });

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        ok: true,
        messageId: "task-session-message:task-session:task-1:candidate-session-1:msg-2",
        sessionId: "task-session:task-1:candidate-session-1",
        seq: 2,
      },
    });

    expect(syncTaskBranchCompatTreeNode).toHaveBeenCalledWith({
      taskId: "task-1",
      runtimeSessionId: "candidate-session-1",
      parentRuntimeSessionId: "root-session-1",
      branchName: "候选 A",
      sourceType: "parallel",
      isActive: true,
      archivedAt: null,
    });
    expect(upsertConversationSessionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSessionId: "candidate-session-1",
        parentRuntimeSessionId: "root-session-1",
        sourceType: "parallel",
        sessionKind: "candidate",
        executionModeSnapshot: "parallel",
        phaseId: "phase-1",
        phaseRole: "candidate",
        candidateIndex: 0,
        isActive: true,
        archivedAt: null,
      }),
    );
  });

  test("persistTaskBranchMessage forces terminal parallel candidates inactive", async () => {
    const { createTaskBranchWriteApi } = await loadTaskBranchWriteModule();
    const syncTaskBranchCompatTreeNode = mock(async () => "task_session:task-1:candidate-session-1");
    const upsertConversationSessionRecord = mock(async () => undefined);
    const upsertConversationMessageRecord = mock(async () => ({
      messageId: "task-session-message:task-session:task-1:candidate-session-1:msg-3",
      sessionId: "task-session:task-1:candidate-session-1",
      seq: 3,
    }));

    const api = createTaskBranchWriteApi({
      loadTaskTreeBackedRecord: mock(async () =>
        createTaskRecord({
          sessionId: "candidate-session-1",
          status: "completed",
          finishedAt: "2026-03-24T00:10:00.000Z",
        }),
      ),
      resolveTaskBranchCompatRecord: mock(async () => null),
      resolveTaskBranchCompatRecordByRuntimeSessionId: mock(async () => ({
        runtimeSessionId: "candidate-session-1",
        parentRuntimeSessionId: "root-session-1",
        forkedFromMessageId: null,
        branchName: "候选 A",
        sourceType: "parallel",
        sessionKind: "candidate",
        executionModeSnapshot: "parallel",
        phaseId: "phase-1",
        phaseRole: "candidate",
        phaseItemIndex: 0,
        candidateIndex: 0,
        stepIndex: null,
        selectedModel: "github-copilot:gpt-5-mini",
        operationId: null,
        isActive: true,
      })),
      syncTaskBranchCompatTreeNode,
      archiveTaskBranchCompatTreeNode: mock(async () => undefined),
      upsertConversationSessionRecord,
      upsertConversationMessageRecord,
      buildTaskTreeSnapshotFromRecord: mock(
        (_task: unknown, updates: Record<string, unknown>) => updates as TaskTreeSnapshot,
      ),
      upsertTaskTreeNode: mock(async () => undefined),
      syncTaskAggregateFromSnapshot: mock(async () => undefined),
    });

    const result = await api.persistTaskBranchMessage("task-1", {
      runtimeSessionId: "candidate-session-1",
      message: {
        info: {
          id: "msg-3",
          role: "assistant",
          time: {
            created: "2026-03-24T00:00:02.000Z",
            completed: "2026-03-24T00:00:03.000Z",
          },
        },
        parts: [{ type: "text", text: "candidate should stay settled" }],
      },
    });

    expect(result.ok).toBe(true);
    expect(syncTaskBranchCompatTreeNode).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeSessionId: "candidate-session-1", isActive: false }),
    );
    expect(upsertConversationSessionRecord).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeSessionId: "candidate-session-1", isActive: false }),
    );
  });

});
