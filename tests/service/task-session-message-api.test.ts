/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

let importCounter = 0;

function createInsertChain() {
  return {
    values() {
      return {
        onConflictDoUpdate: async () => undefined,
      };
    },
  };
}

function createSelectChain(resolveRow: () => unknown) {
  return {
    from() {
      return {
        where() {
          return {
            limit: async () => {
              const row = resolveRow();
              return row == null ? [] : [row];
            },
          };
        },
      };
    },
  };
}

async function loadTaskSessionMessageApiModule(args?: {
  session?: Record<string, unknown> | null;
  canonicalMessagesByCall?: unknown[];
  operationRowsByCall?: unknown[];
}) {
  importCounter += 1;

  let canonicalMessageCall = 0;
  let operationCall = 0;

  const fakeDb = {
    select: mock(() => createSelectChain(() => {
      const row = args?.canonicalMessagesByCall?.[canonicalMessageCall] ?? null;
      canonicalMessageCall += 1;
      return row;
    })),
    query: {
      taskSessions: {
        findFirst: mock(
          async () =>
            args?.session ?? {
              id: "session-1",
              taskId: "task-1",
              projectId: "project-1",
              archivedAt: null,
            },
        ),
      },
      taskMessages: {
        findFirst: mock(async () => {
          const row = args?.canonicalMessagesByCall?.[canonicalMessageCall] ?? null;
          canonicalMessageCall += 1;
          return row;
        }),
      },
      taskOperations: {
        findFirst: mock(async () => {
          const row = args?.operationRowsByCall?.[operationCall] ?? null;
          operationCall += 1;
          return row;
        }),
      },
    },
    insert: mock(() => createInsertChain()),
  };

  mock.module("../../control-plane/service/src/db", () => ({
    db: fakeDb,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-session-message-api.ts?task-session-message-api-test=${importCounter}`
  );

  return {
    ...module,
    fakeDb,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task session message api", () => {
  test("reads existing canonical task_messages rows directly", async () => {
    const existingOperation = {
      id: "session-operation:task-1:model-request:cli-1",
      operationIndex: 4,
      status: "queued",
    };
    const { createTaskSessionMessageApi, fakeDb } = await loadTaskSessionMessageApiModule({
      canonicalMessagesByCall: [
        {
          id: "task-session-message:session-1:user:cli-1",
          role: "user",
          status: "completed",
          clientMessageId: "cli-1",
          runtimeMessageId: "user:cli-1",
          seq: 8,
          textContent: "hello canonical",
          textPreview: "hello canonical",
          rawPayload: {},
          errorText: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          completedAt: "2025-01-01T00:00:01.000Z",
        },
      ],
      operationRowsByCall: [existingOperation, null, existingOperation],
    });
    const upsertTaskSessionMessageRecord = mock(async () => {
      throw new Error("should not upsert when canonical rows already exist");
    });
    const api = createTaskSessionMessageApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
      upsertTaskSessionMessageRecord,
    });

    const result = await api.postTaskSessionMessage({
      taskId: "task-1",
      sessionId: "session-1",
      client_message_id: "cli-1",
      text: "hello canonical",
      attachments: [],
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        task_id: "task-1",
        session_id: "session-1",
        user_message: {
          id: "task-session-message:session-1:user:cli-1",
          client_message_id: "cli-1",
          role: "user",
          status: "completed",
          text: "hello canonical",
          message_index: 8,
          created_at: "2025-01-01T00:00:00.000Z",
          completed_at: "2025-01-01T00:00:01.000Z",
        },
        assistant_message: null,
        operation: {
          id: "session-operation:task-1:model-request:cli-1",
          kind: "model_request",
          status: "queued",
        },
      },
    });
    expect(upsertTaskSessionMessageRecord).not.toHaveBeenCalled();
  });

  test("does not backfill canonical message summaries from rawPayload legacy fields", async () => {
    const existingOperation = {
      id: "session-operation:task-1:model-request:cli-legacy",
      operationIndex: 4,
      status: "queued",
    };
    const { createTaskSessionMessageApi } = await loadTaskSessionMessageApiModule({
      canonicalMessagesByCall: [
        {
          id: "task-session-message:session-1:user:cli-legacy",
          role: "user",
          status: "completed",
          clientMessageId: "cli-legacy",
          runtimeMessageId: "user:cli-legacy",
          seq: 9,
          textContent: null,
          textPreview: null,
          rawPayload: {
            text: "stale legacy text",
            errorText: "stale legacy error",
          },
          errorText: null,
          createdAt: "2025-01-01T00:05:00.000Z",
          updatedAt: "2025-01-01T00:05:00.000Z",
          completedAt: "2025-01-01T00:05:01.000Z",
        },
      ],
      operationRowsByCall: [existingOperation, null, existingOperation],
    });
    const api = createTaskSessionMessageApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
      upsertTaskSessionMessageRecord: mock(async () => {
        throw new Error("should not upsert when canonical rows already exist");
      }),
    });

    const result = await api.postTaskSessionMessage({
      taskId: "task-1",
      sessionId: "session-1",
      client_message_id: "cli-legacy",
      text: "request text",
      attachments: [],
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        task_id: "task-1",
        session_id: "session-1",
        user_message: {
          id: "task-session-message:session-1:user:cli-legacy",
          client_message_id: "cli-legacy",
          role: "user",
          status: "completed",
          text: null,
          message_index: 9,
          created_at: "2025-01-01T00:05:00.000Z",
          completed_at: "2025-01-01T00:05:01.000Z",
        },
        assistant_message: null,
        operation: {
          id: "session-operation:task-1:model-request:cli-legacy",
          kind: "model_request",
          status: "queued",
        },
      },
    });
  });

  test("creates canonical session messages when canonical rows are absent", async () => {
    const { createTaskSessionMessageApi, fakeDb } = await loadTaskSessionMessageApiModule({
      canonicalMessagesByCall: [
        null,
        {
          id: "task-session-message:session-1:user:cli-2",
          role: "user",
          status: "completed",
          clientMessageId: "cli-2",
          runtimeMessageId: "user:cli-2",
          seq: 10,
          textContent: "hello canonical create",
          textPreview: "hello canonical create",
          rawPayload: {},
          errorText: null,
          createdAt: "2025-01-01T00:10:00.000Z",
          updatedAt: "2025-01-01T00:10:00.000Z",
          completedAt: "2025-01-01T00:10:01.000Z",
        },
      ],
      operationRowsByCall: [
        null,
        null,
        {
          id: "session-operation:task-1:model-request:cli-2",
          operationIndex: 5,
          status: "queued",
        },
      ],
    });
    const upsertTaskSessionMessageRecord = mock(
      async (args: { message: Record<string, unknown> }) => {
        const runtimeMessageId = String(args.message.runtimeMessageId ?? args.message.id);
        return {
          messageId: `task-session-message:session-1:${runtimeMessageId}`,
          sessionId: "session-1",
          seq: runtimeMessageId.startsWith("user:") ? 10 : 11,
        };
      },
    );
    const api = createTaskSessionMessageApi({
      loadTaskTreeBackedRecord: mock(async () => ({ id: "task-1", projectId: "project-1" })),
      upsertTaskSessionMessageRecord,
    });

    const result = await api.postTaskSessionMessage({
      taskId: "task-1",
      sessionId: "session-1",
      client_message_id: "cli-2",
      text: "hello canonical create",
      attachments: [],
    });

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        task_id: "task-1",
        session_id: "session-1",
        user_message: {
          id: "task-session-message:session-1:user:cli-2",
          client_message_id: "cli-2",
          role: "user",
          status: "completed",
          text: "hello canonical create",
          message_index: 10,
          created_at: "2025-01-01T00:10:00.000Z",
          completed_at: "2025-01-01T00:10:01.000Z",
        },
        assistant_message: null,
        operation: {
          id: "session-operation:task-1:model-request:cli-2",
          kind: "model_request",
          status: "queued",
        },
      },
    });
    expect(upsertTaskSessionMessageRecord).toHaveBeenCalledTimes(1);
    expect(fakeDb.select).toHaveBeenCalled();
  });
});
