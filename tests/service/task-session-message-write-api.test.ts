/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  taskArtifacts,
  taskMessageParts,
  taskMessages,
  taskOperations,
  taskSessionRuns,
  taskSessions,
  taskTimelineViews,
} from "../../control-plane/service/src/db/schema";

let importCounter = 0;

function createInsertChain(
  recorder: (payload: unknown) => void,
  onConflictDoUpdateHook?: (payload: unknown) => void | Promise<void>,
) {
  return {
    values(payload: unknown) {
      recorder(payload);
      return {
        onConflictDoUpdate: async () => onConflictDoUpdateHook?.(payload),
      };
    },
  };
}

function createDeleteChain(recorder: (payload: unknown) => void) {
  return {
    where(payload: unknown) {
      recorder(payload);
      return Promise.resolve(undefined);
    },
  };
}

function createUpdateChain(recorder: (payload: unknown) => void) {
  return {
    set(payload: unknown) {
      recorder(payload);
      return {
        where: async () => undefined,
      };
    },
  };
}

function resolveTableName(table: unknown) {
  if (table === taskArtifacts) return "task_artifacts";
  if (table === taskMessages) return "task_messages";
  if (table === taskMessageParts) return "task_message_parts";
  if (table === taskOperations) return "task_operations";
  if (table === taskSessionRuns) return "task_session_runs";
  if (table === taskSessions) return "task_sessions";
  if (table === taskTimelineViews) return "task_timeline_views";
  return "unknown";
}

async function loadTaskSessionMessageWriteModule(args?: {
  taskMessageFindFirstResults?: unknown[];
  sessionRecord?: Record<string, unknown> | null;
  insertHooks?: Partial<Record<string, Array<(payload: unknown) => void | Promise<void>>>>;
}) {
  importCounter += 1;

  const insertCalls: Array<{ table: string; payload: unknown }> = [];
  const deleteCalls: Array<{ table: string; payload: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: unknown }> = [];
  const taskMessageFindFirstResults = [...(args?.taskMessageFindFirstResults ?? [])];
  const insertHooks = Object.fromEntries(
    Object.entries(args?.insertHooks ?? {}).map(([table, hooks]) => [table, [...hooks]]),
  ) as Partial<Record<string, Array<(payload: unknown) => void | Promise<void>>>>;
  const defaultSessionRecord = {
    id: "session-1",
    latestRunId: null,
    runtimeSessionId: "runtime-session-1",
    triggerType: null,
    sessionKind: "primary",
    coordinationKey: "session-1",
    rootSessionId: "session-1",
    candidateIndex: null,
    workflowStageKey: null,
    effectiveModel: null,
    selectedModel: null,
    costUsd: 0,
    startedAt: "2025-01-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
  };

  const fakeDb = {
    query: {
      taskMessages: {
        findFirst: mock(async () => taskMessageFindFirstResults.shift() ?? null),
      },
      taskSessions: {
        findFirst: mock(async () => args?.sessionRecord ?? defaultSessionRecord),
      },
    },
    insert: mock((table: unknown) => {
      const tableName = resolveTableName(table);
      return createInsertChain(
        (payload) => {
          insertCalls.push({ table: tableName, payload });
        },
        async (payload) => {
          const hook = insertHooks[tableName]?.shift();
          if (hook) {
            await hook(payload);
          }
        },
      );
    }),
    delete: mock((table: unknown) =>
      createDeleteChain((payload) => {
        deleteCalls.push({ table: resolveTableName(table), payload });
      }),
    ),
    update: mock((table: unknown) =>
      createUpdateChain((payload) => {
        updateCalls.push({ table: resolveTableName(table), payload });
      }),
    ),
  };

  mock.module("../../control-plane/service/src/db", () => ({
    db: fakeDb,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-session-message-write-api.ts?task-session-message-write-api-test=${importCounter}`
  );

  return {
    ...module,
    insertCalls,
    deleteCalls,
    updateCalls,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task session message write api", () => {
  test("writes canonical message tables and skips legacy task_session message dual-write", async () => {
    const { createTaskSessionMessageWriteApi, insertCalls, deleteCalls, updateCalls } =
      await loadTaskSessionMessageWriteModule();

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    const result = await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      sessionId: "session-1",
      message: {
        info: {
          id: "msg-1",
          role: "assistant",
          time: {
            created: "2025-01-01T00:00:00.000Z",
            completed: "2025-01-01T00:00:01.000Z",
          },
        },
        parts: [{ type: "text", text: "hello" }],
      },
    });

    expect(result).toEqual({
      messageId: "task-session-message:session-1:msg-1",
      sessionId: "session-1",
      seq: 0,
    });

    expect(insertCalls.map((call) => call.table)).toEqual(
      expect.arrayContaining([
        "task_session_runs",
        "task_messages",
        "task_message_parts",
        "task_timeline_views",
      ]),
    );
    expect(insertCalls.map((call) => call.table)).not.toContain("task_session_messages");
    expect(insertCalls.map((call) => call.table)).not.toContain("task_session_message_parts");

    expect(deleteCalls.map((call) => call.table)).toEqual(
      expect.arrayContaining(["task_message_parts"]),
    );
    expect(deleteCalls.map((call) => call.table)).not.toContain("task_session_message_parts");

    const canonicalMessageInsert = insertCalls.find(
      (call) => call.table === "task_messages",
    )?.payload;
    expect(canonicalMessageInsert).toMatchObject({
      id: "task-session-message:session-1:msg-1",
      sessionId: "session-1",
      taskId: "task-1",
      runtimeMessageId: "msg-1",
      seq: 0,
      textContent: "hello",
      textPreview: "hello",
      status: "completed",
    });

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "task_sessions",
          payload: expect.objectContaining({
            latestRunId: "run_session-1",
            status: "completed",
          }),
        }),
      ]),
    );
  });

  test("retries task message seq allocation when a concurrent insert wins first", async () => {
    const latestMessageAfterConflict = {
      id: "task-session-message:session-1:msg-existing",
      role: "assistant",
      runtimeMessageId: "msg-existing",
      status: "completed",
      clientMessageId: null,
      providerMessageId: null,
      seq: 0,
      textContent: "existing",
      rawPayload: {
        info: {
          id: "msg-existing",
          role: "assistant",
        },
        parts: [{ type: "text", text: "existing" }],
      },
      tokenUsed: 0,
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:01.000Z",
      errorText: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:01.000Z",
    };

    const { createTaskSessionMessageWriteApi, insertCalls } =
      await loadTaskSessionMessageWriteModule({
        taskMessageFindFirstResults: [null, null, null, latestMessageAfterConflict],
        insertHooks: {
          task_messages: [() => {
            throw new Error(
              'duplicate key value violates unique constraint "idx_task_messages_session_seq"',
            );
          }],
        },
      });

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    const result = await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      sessionId: "session-1",
      message: {
        info: {
          id: "msg-1",
          role: "assistant",
          time: {
            created: "2025-01-01T00:00:02.000Z",
            completed: "2025-01-01T00:00:03.000Z",
          },
        },
        parts: [{ type: "text", text: "hello after retry" }],
      },
    });

    expect(result).toEqual({
      messageId: "task-session-message:session-1:msg-1",
      sessionId: "session-1",
      seq: 0,
    });

    const taskMessageInsertCalls = insertCalls.filter((call) => call.table === "task_messages");
    expect(taskMessageInsertCalls).toHaveLength(2);
    expect(taskMessageInsertCalls[0]?.payload).toMatchObject({
      id: "task-session-message:session-1:msg-1",
      seq: 0,
    });
    expect(taskMessageInsertCalls[1]?.payload).toMatchObject({
      id: "task-session-message:session-1:msg-1",
      seq: 1,
    });
  });

  test("normalizes top-level tool part into message parts, task operations, and task artifacts", async () => {
    const { createTaskSessionMessageWriteApi, insertCalls, updateCalls } =
      await loadTaskSessionMessageWriteModule();

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    const result = await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      sessionId: "session-1",
      message: {
        info: {
          id: "tool-msg-1",
          role: "tool",
          time: {
            created: "2025-01-01T00:03:00.000Z",
            completed: "2025-01-01T00:03:02.000Z",
          },
        },
        part: {
          id: "tool-call-1",
          type: "tool",
          name: "read_file",
          input: { filePath: "docs/spec.md" },
          state: {
            status: "completed",
            output: "file contents",
          },
        },
      },
    });

    expect(result).toEqual({
      messageId: "task-session-message:session-1:tool-msg-1",
      sessionId: "session-1",
      seq: 0,
    });

    const canonicalMessageInsert = insertCalls.find(
      (call) => call.table === "task_messages",
    )?.payload;
    expect(canonicalMessageInsert).toMatchObject({
      id: "task-session-message:session-1:tool-msg-1",
      role: "tool",
      textContent: "file contents",
      textPreview: "file contents",
      partCount: 1,
      status: "completed",
    });

    const messagePartInsertCalls = insertCalls
      .filter((call) => call.table === "task_message_parts")
      .map((call) => call.payload);
    expect(messagePartInsertCalls).toEqual([
      expect.objectContaining({
        id: "task-session-message:session-1:tool-msg-1:0",
        messageId: "task-session-message:session-1:tool-msg-1",
        partType: "tool_result",
        textContent: "file contents",
      }),
    ]);

    const operationInsert = insertCalls.find((call) => call.table === "task_operations")?.payload;
    expect(operationInsert).toMatchObject({
      id: "task-operation:tool-call-1",
      taskId: "task-1",
      sessionId: "session-1",
      runId: "run_session-1",
      messageId: "task-session-message:session-1:tool-msg-1",
      runtimeOperationId: "tool-call-1",
      operationKind: "tool_call",
      toolName: "read_file",
      title: "read_file",
      status: "completed",
      summaryJson: expect.objectContaining({
        source: "task-session-message-write",
        toolName: "read_file",
        outputText: "file contents",
      }),
    });

    const artifactInsert = insertCalls.find((call) => call.table === "task_artifacts")?.payload;
    expect(artifactInsert).toMatchObject({
      id: "task-artifact:tool-call-1",
      taskId: "task-1",
      projectId: "project-1",
      sessionId: "session-1",
      messageId: "task-session-message:session-1:tool-msg-1",
      operationId: "task-operation:tool-call-1",
      artifactKind: "result",
      storageKind: "inline",
      title: "read_file result",
      mimeType: "text/plain",
      contentText: "file contents",
      payloadJson: expect.objectContaining({
        source: "task-session-message-write",
        toolName: "read_file",
      }),
    });

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "task_sessions",
          payload: expect.not.objectContaining({
            status: "completed",
            headMessageId: "task-session-message:session-1:tool-msg-1",
          }),
        }),
      ]),
    );
  });
});
