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
  conflictRecorder?: (payload: { payload: unknown; args: unknown }) => void | Promise<void>,
  onConflictDoUpdateHook?: (payload: unknown) => void | Promise<void>,
) {
  return {
    values(payload: unknown) {
      recorder(payload);
      return {
        onConflictDoUpdate: async (args: unknown) => {
          await conflictRecorder?.({ payload, args });
          await onConflictDoUpdateHook?.(payload);
        },
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

function createSelectChain(resolveRow: () => unknown) {
  const limit = async () => {
    const row = resolveRow();
    return row == null ? [] : [row];
  };

  return {
    from() {
      return {
        where() {
          return {
            limit,
            orderBy() {
              return { limit };
            },
          };
        },
        orderBy() {
          return { limit };
        },
        limit,
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
  runRecord?: Record<string, unknown> | null;
  insertHooks?: Partial<Record<string, Array<(payload: unknown) => void | Promise<void>>>>;
}) {
  importCounter += 1;

  const insertCalls: Array<{ table: string; payload: unknown }> = [];
  const conflictUpdateCalls: Array<{
    table: string;
    payload: unknown;
    target: unknown;
    set: unknown;
  }> = [];
  const deleteCalls: Array<{ table: string; payload: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: unknown }> = [];
  const taskMessageFindFirstResults = [...(args?.taskMessageFindFirstResults ?? [])];
  const insertHooks = Object.fromEntries(
    Object.entries(args?.insertHooks ?? {}).map(([table, hooks]) => [table, [...hooks]]),
  ) as Partial<Record<string, Array<(payload: unknown) => void | Promise<void>>>>;
  const defaultSessionRecord = {
    id: "session-1",
    latestRunId: null,
    phaseId: "phase-session-1",
    runtimeSessionId: "runtime-session-1",
    triggerType: null,
    sessionKind: "primary",
    coordinationKey: null,
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
    select: mock(() => createSelectChain(() => taskMessageFindFirstResults.shift() ?? null)),
    query: {
      taskMessages: {
        findFirst: mock(async () => taskMessageFindFirstResults.shift() ?? null),
      },
      taskSessions: {
        findFirst: mock(async () => args?.sessionRecord ?? defaultSessionRecord),
      },
      taskSessionRuns: {
        findFirst: mock(async () => args?.runRecord ?? null),
      },
    },
    insert: mock((table: unknown) => {
      const tableName = resolveTableName(table);
      return createInsertChain(
        (payload) => {
          insertCalls.push({ table: tableName, payload });
        },
        async ({ payload, args }) => {
          const record =
            args && typeof args === "object"
              ? (args as { target?: unknown; set?: unknown })
              : {};
          conflictUpdateCalls.push({
            table: tableName,
            payload,
            target: record.target,
            set: record.set,
          });
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
    conflictUpdateCalls,
    deleteCalls,
    updateCalls,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task session message write api", () => {
  test("writes canonical message tables without any legacy dual-write", async () => {
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

    const taskSessionRunInsert = insertCalls.find(
      (call) => call.table === "task_session_runs",
    )?.payload;
    expect(taskSessionRunInsert).toMatchObject({
      id: "run_session-1",
      sessionId: "session-1",
      phaseId: "phase-session-1",
      coordinationKey: null,
      status: "completed",
    });

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "task_sessions",
          payload: expect.objectContaining({
            latestRunId: "run_session-1",
          }),
        }),
      ]),
    );
    expect(updateCalls).not.toContainEqual(
      expect.objectContaining({
        table: "task_sessions",
        payload: expect.objectContaining({
          status: "running",
          executionStatus: "running",
        }),
      }),
    );
  });

  test("fills completedAt for terminal user messages that only provide created time", async () => {
    const { createTaskSessionMessageWriteApi, insertCalls } =
      await loadTaskSessionMessageWriteModule();

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      sessionId: "session-1",
      message: {
        info: {
          id: "msg-user-1",
          role: "user",
          time: {
            created: "2025-01-01T00:00:00.000Z",
          },
        },
        parts: [{ type: "text", text: "hello user" }],
      },
    });

    const canonicalMessageInsert = insertCalls.find(
      (call) => call.table === "task_messages",
    )?.payload;
    expect(canonicalMessageInsert).toMatchObject({
      runtimeMessageId: "msg-user-1",
      status: "completed",
      createdAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:00:00.000Z",
    });
  });

  test("uses completed time as createdAt fallback for terminal assistant messages", async () => {
    const { createTaskSessionMessageWriteApi, insertCalls } =
      await loadTaskSessionMessageWriteModule();

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      sessionId: "session-1",
      message: {
        info: {
          id: "msg-assistant-1",
          role: "assistant",
          finish: "stop",
          time: {
            completed: "2025-01-01T00:00:05.000Z",
          },
        },
        parts: [{ type: "text", text: "hello assistant" }],
      },
    });

    const canonicalMessageInsert = insertCalls.find(
      (call) => call.table === "task_messages",
    )?.payload;
    expect(canonicalMessageInsert).toMatchObject({
      runtimeMessageId: "msg-assistant-1",
      status: "completed",
      createdAt: "2025-01-01T00:00:05.000Z",
      completedAt: "2025-01-01T00:00:05.000Z",
    });
  });

  test("overwrites placeholder createdAt on conflict updates for existing user messages", async () => {
    const existingUserMessage = {
      id: "task-session-message:session-1:session-1:user-prompt",
      taskId: "task-1",
      sessionId: "session-1",
      role: "user",
      runtimeMessageId: "session-1:user-prompt",
      status: "completed",
      clientMessageId: null,
      providerMessageId: null,
      seq: 0,
      textContent: "hello user",
      textPreview: "hello user",
      rawPayload: {
        info: {
          id: "session-1:user-prompt",
          role: "user",
          time: {
            created: "2025-01-01T00:10:00.000Z",
            completed: "2025-01-01T00:10:00.000Z",
          },
        },
        parts: [{ type: "text", text: "hello user" }],
      },
      tokenUsed: 0,
      startedAt: "2025-01-01T00:10:00.000Z",
      completedAt: "2025-01-01T00:10:00.000Z",
      errorText: null,
      createdAt: "2025-01-01T00:10:00.000Z",
      updatedAt: "2025-01-01T00:10:00.000Z",
    };

    const { createTaskSessionMessageWriteApi, insertCalls, conflictUpdateCalls } =
      await loadTaskSessionMessageWriteModule({
        taskMessageFindFirstResults: [existingUserMessage, existingUserMessage],
      });

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      sessionId: "session-1",
      message: {
        info: {
          id: "session-1:user-prompt",
          role: "user",
          time: {
            created: "2025-01-01T00:05:00.000Z",
            completed: "2025-01-01T00:05:00.000Z",
          },
        },
        parts: [{ type: "text", text: "hello user" }],
      },
    });

    const canonicalMessageInsert = insertCalls.find(
      (call) => call.table === "task_messages",
    )?.payload;
    expect(canonicalMessageInsert).toMatchObject({
      id: "task-session-message:session-1:session-1:user-prompt",
      runtimeMessageId: "session-1:user-prompt",
      createdAt: "2025-01-01T00:05:00.000Z",
      startedAt: "2025-01-01T00:05:00.000Z",
      completedAt: "2025-01-01T00:05:00.000Z",
    });

    const canonicalMessageConflictUpdate = conflictUpdateCalls.find(
      (call) => call.table === "task_messages",
    )?.set;
    expect(canonicalMessageConflictUpdate).toMatchObject({
      createdAt: "2025-01-01T00:05:00.000Z",
      startedAt: "2025-01-01T00:05:00.000Z",
      completedAt: "2025-01-01T00:05:00.000Z",
    });

    const timelineInsert = insertCalls.find(
      (call) => call.table === "task_timeline_views",
    )?.payload;
    expect(timelineInsert).toMatchObject({
      messageId: "task-session-message:session-1:session-1:user-prompt",
      createdAt: "2025-01-01T00:05:00.000Z",
      sortAt: "2025-01-01T00:05:00.000Z",
    });

    const timelineConflictUpdate = conflictUpdateCalls.find(
      (call) => call.table === "task_timeline_views",
    )?.set;
    expect(timelineConflictUpdate).toMatchObject({
      createdAt: "2025-01-01T00:05:00.000Z",
      sortAt: "2025-01-01T00:05:00.000Z",
    });
  });

  test("rejects writes that do not provide a stable runtime message id", async () => {
    const { createTaskSessionMessageWriteApi, insertCalls, deleteCalls, updateCalls } =
      await loadTaskSessionMessageWriteModule();

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    await expect(
      api.upsertTaskSessionMessageRecord({
        task: { id: "task-1", projectId: "project-1" },
        sessionId: "session-1",
        message: {
          info: {
            role: "assistant",
            time: {
              created: "2025-01-01T00:00:00.000Z",
              completed: "2025-01-01T00:00:01.000Z",
            },
          },
          parts: [{ type: "text", text: "hello" }],
        },
      }),
    ).rejects.toThrow("Task session message write requires stable runtimeMessageId");

    expect(insertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("rejects runtime messages that do not match the explicit schema", async () => {
    const { createTaskSessionMessageWriteApi, insertCalls, deleteCalls, updateCalls } =
      await loadTaskSessionMessageWriteModule();

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    await expect(
      api.upsertTaskSessionMessageRecord({
        task: { id: "task-1", projectId: "project-1" },
        sessionId: "session-1",
        message: {
          id: "msg-invalid-1",
          foo: "bar",
        },
      }),
    ).rejects.toThrow("Runtime message must include an explicit role");

    expect(insertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("rejects runtime messages with empty parts arrays", async () => {
    const { createTaskSessionMessageWriteApi, insertCalls, deleteCalls, updateCalls } =
      await loadTaskSessionMessageWriteModule();

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    await expect(
      api.upsertTaskSessionMessageRecord({
        task: { id: "task-1", projectId: "project-1" },
        sessionId: "session-1",
        message: {
          id: "msg-empty-1",
          role: "assistant",
          parts: [],
        },
      }),
    ).rejects.toThrow();

    expect(insertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("persists assistant error snapshots without explicit text parts", async () => {
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
        id: "msg-error-1",
        role: "assistant",
        parts: [],
        info: {
          id: "msg-error-1",
          role: "assistant",
          finish: "error",
          error: "provider overloaded",
          time: {
            created: "2025-01-01T00:00:05.000Z",
          },
        },
      },
    });

    expect(result).toEqual({
      messageId: "task-session-message:session-1:msg-error-1",
      sessionId: "session-1",
      seq: 0,
    });

    const canonicalMessageInsert = insertCalls.find(
      (call) => call.table === "task_messages",
    )?.payload;
    expect(canonicalMessageInsert).toMatchObject({
      id: "task-session-message:session-1:msg-error-1",
      taskId: "task-1",
      sessionId: "session-1",
      createdByRunId: "run_session-1",
      role: "assistant",
      messageKind: "reply",
      runtimeMessageId: "msg-error-1",
      seq: 0,
      textContent: null,
      textPreview: null,
      partCount: 0,
      tokenUsed: 0,
      status: "failed",
      startedAt: "2025-01-01T00:00:05.000Z",
      createdAt: "2025-01-01T00:00:05.000Z",
      completedAt: "2025-01-01T00:00:05.000Z",
      errorText: "provider overloaded",
    });

    const taskSessionRunInsert = insertCalls.find(
      (call) => call.table === "task_session_runs",
    )?.payload;
    expect(taskSessionRunInsert).toMatchObject({
      id: "run_session-1",
      sessionId: "session-1",
      status: "failed",
      errorText: "provider overloaded",
      startedAt: "2025-01-01T00:00:00.000Z",
      finishedAt: "2025-01-01T00:00:05.000Z",
    });

    expect(insertCalls.filter((call) => call.table === "task_message_parts")).toHaveLength(0);
    expect(insertCalls.filter((call) => call.table === "task_operations")).toHaveLength(0);
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "task_sessions",
          payload: expect.objectContaining({
            latestRunId: "run_session-1",
            status: "failed",
            executionStatus: "failed",
          }),
        }),
      ]),
    );
  });

  test("persists legacy assistant tool followups as distinct messages when runtime ids differ", async () => {
    const latestMessage = {
      id: "task-session-message:session-1:msg-tool-start",
      taskId: "task-1",
      sessionId: "session-1",
      role: "assistant",
      runtimeMessageId: "msg-tool-start",
      status: "streaming",
      clientMessageId: null,
      providerMessageId: null,
      seq: 0,
      textContent: "hello",
      textPreview: "hello",
      rawPayload: {
        id: "msg-tool-start",
        info: {
          id: "msg-tool-start",
          role: "assistant",
          finish: "tool-calls",
          parentID: "parent-1",
          time: {
            created: "2025-01-01T00:00:00.000Z",
          },
        },
        parts: [
          { type: "text", text: "hello" },
          {
            id: "tool-call-1",
            type: "tool",
            tool: "search_code",
            toolName: "search_code",
            callID: "tool-call-1",
            state: "completed",
            input: { query: "hello" },
          },
        ],
      },
      tokenUsed: 7,
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: null,
      errorText: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:01.000Z",
    };

    const { createTaskSessionMessageWriteApi, insertCalls } =
      await loadTaskSessionMessageWriteModule({
        taskMessageFindFirstResults: [null, latestMessage],
      });

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    const result = await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      sessionId: "session-1",
      message: {
        id: "msg-tool-finish",
        role: "assistant",
        clientMessageId: "client-2",
        providerMessageId: "provider-2",
        tokens: { total: 19 },
        info: {
          role: "assistant",
          parentID: "parent-1",
          time: {
            created: "2025-01-01T00:00:05.000Z",
            completed: "2025-01-01T00:00:08.000Z",
          },
        },
        parts: [{ type: "text", text: "hello" }],
      },
    });

    expect(result).toEqual({
      messageId: "task-session-message:session-1:msg-tool-finish",
      sessionId: "session-1",
      seq: 0,
    });

    const canonicalMessageInsert = insertCalls.find(
      (call) => call.table === "task_messages",
    )?.payload;
    expect(canonicalMessageInsert).toMatchObject({
      id: "task-session-message:session-1:msg-tool-finish",
      parentMessageId: "task-session-message:session-1:msg-tool-start",
      replyToMessageId: "task-session-message:session-1:msg-tool-start",
      runtimeMessageId: "msg-tool-finish",
      clientMessageId: "client-2",
      providerMessageId: "provider-2",
      seq: 1,
      textContent: "hello",
      partCount: 1,
      tokenUsed: 19,
      status: "completed",
      startedAt: "2025-01-01T00:00:05.000Z",
      completedAt: "2025-01-01T00:00:08.000Z",
      rawPayload: expect.objectContaining({
        id: "msg-tool-finish",
        info: expect.objectContaining({
          role: "assistant",
          parentID: "parent-1",
          time: expect.objectContaining({
            created: "2025-01-01T00:00:05.000Z",
            completed: "2025-01-01T00:00:08.000Z",
          }),
        }),
      }),
    });

    const partInserts = insertCalls
      .filter((call) => call.table === "task_message_parts")
      .map((call) => call.payload);
    expect(partInserts).toEqual([
      expect.objectContaining({
        messageId: "task-session-message:session-1:msg-tool-finish",
        partIndex: 0,
        partType: "text",
        textContent: "hello",
      }),
    ]);
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

  test("preserves a terminal latest run when a late tool snapshot lands on a completed session", async () => {
    const { createTaskSessionMessageWriteApi, insertCalls, conflictUpdateCalls, updateCalls } =
      await loadTaskSessionMessageWriteModule({
        sessionRecord: {
          id: "session-1",
          latestRunId: "run_session-1",
          phaseId: "phase-session-1",
          runtimeSessionId: "runtime-session-1",
          triggerType: null,
          sessionKind: "primary",
          coordinationKey: null,
          rootSessionId: "session-1",
          candidateIndex: null,
          workflowStageKey: null,
          effectiveModel: null,
          selectedModel: null,
          costUsd: 0,
          startedAt: "2025-01-01T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
          status: "completed",
          executionStatus: "complete",
        },
        runRecord: {
          id: "run_session-1",
          status: "completed",
          outputTokens: 123,
          totalTokens: 123,
          resultSummary: "assistant summary",
          errorText: null,
          startedAt: "2025-01-01T00:00:00.000Z",
          finishedAt: "2025-01-01T00:00:05.000Z",
        },
      });

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      sessionId: "session-1",
      message: {
        info: {
          id: "tool-msg-late-1",
          role: "tool",
          time: {
            created: "2025-01-01T00:00:06.000Z",
            completed: "2025-01-01T00:00:06.000Z",
          },
        },
        part: {
          id: "tool-call-late-1",
          type: "tool",
          toolName: "read_file",
          input: { filePath: "docs/spec.md" },
          state: {
            status: "completed",
            output: "late tool output",
          },
        },
      },
    });

    const taskSessionRunInsert = insertCalls.find(
      (call) => call.table === "task_session_runs",
    )?.payload;
    expect(taskSessionRunInsert).toMatchObject({
      id: "run_session-1",
      status: "completed",
      outputTokens: 123,
      totalTokens: 123,
      resultSummary: "assistant summary",
      finishedAt: "2025-01-01T00:00:05.000Z",
    });

    const taskSessionRunConflictUpdate = conflictUpdateCalls.find(
      (call) => call.table === "task_session_runs",
    );
    expect(taskSessionRunConflictUpdate?.set).toMatchObject({
      status: "completed",
      outputTokens: 123,
      totalTokens: 123,
      resultSummary: "assistant summary",
      finishedAt: "2025-01-01T00:00:05.000Z",
    });

    const taskSessionUpdate = updateCalls.find((call) => call.table === "task_sessions");
    expect(taskSessionUpdate?.payload).toMatchObject({
      latestRunId: "run_session-1",
    });
    expect(taskSessionUpdate?.payload).not.toMatchObject({
      status: "running",
      executionStatus: "running",
    });
  });

  test("accepts legacy string tool state values on runtime message parts", async () => {
    const { createTaskSessionMessageWriteApi, insertCalls, updateCalls } =
      await loadTaskSessionMessageWriteModule();

    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord: mock(async () => "session-1"),
      resolveTaskSessionRecordByRuntimeSessionId: mock(async () => null),
    });

    await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      sessionId: "session-1",
      message: {
        info: {
          id: "assistant-tool-legacy-1",
          role: "assistant",
          finish: "tool-calls",
          time: {
            created: "2025-01-01T00:04:00.000Z",
            completed: "2025-01-01T00:04:00.000Z",
          },
        },
        parts: [
          {
            id: "tool-call-legacy-1",
            type: "tool",
            tool: "webfetch",
            toolName: "webfetch",
            state: "completed",
            input: { url: "https://example.com/legacy" },
          },
          { type: "text", text: "legacy tool result" },
        ],
      },
    });

    const operationInsert = insertCalls.find((call) => call.table === "task_operations")?.payload;
    expect(operationInsert).toMatchObject({
      runtimeOperationId: "tool-call-legacy-1",
      operationKind: "tool_call",
      status: "completed",
    });

    const taskSessionRunInsert = insertCalls.find(
      (call) => call.table === "task_session_runs",
    )?.payload;
    expect(taskSessionRunInsert).toMatchObject({
      status: "running",
      finishedAt: null,
    });

    const messagePartInsertCalls = insertCalls
      .filter((call) => call.table === "task_message_parts")
      .map((call) => call.payload);
    expect(messagePartInsertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partType: "tool_result",
        }),
      ]),
    );

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "task_sessions",
          payload: expect.objectContaining({
            status: "running",
            executionStatus: "running",
          }),
        }),
      ]),
    );
    expect(updateCalls).not.toContainEqual(
      expect.objectContaining({
        table: "task_sessions",
        payload: expect.objectContaining({
          status: "completed",
          executionStatus: "complete",
        }),
      }),
    );
  });
});
