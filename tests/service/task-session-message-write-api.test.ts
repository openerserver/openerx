/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  taskMessageParts,
  taskMessages,
  taskSessionRuns,
  taskSessions,
  taskTimelineViews,
} from "../../control-plane/service/src/db/schema";

let importCounter = 0;

function createInsertChain(recorder: (payload: unknown) => void) {
  return {
    values(payload: unknown) {
      recorder(payload);
      return {
        onConflictDoUpdate: async () => undefined,
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
  if (table === taskMessages) return "task_messages";
  if (table === taskMessageParts) return "task_message_parts";
  if (table === taskSessionRuns) return "task_session_runs";
  if (table === taskSessions) return "task_sessions";
  if (table === taskTimelineViews) return "task_timeline_views";
  return "unknown";
}

async function loadTaskSessionMessageWriteModule() {
  importCounter += 1;

  const insertCalls: Array<{ table: string; payload: unknown }> = [];
  const deleteCalls: Array<{ table: string; payload: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: unknown }> = [];

  const fakeDb = {
    query: {
      taskMessages: {
        findFirst: mock(async () => null),
      },
      taskSessions: {
        findFirst: mock(async () => ({
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
        })),
      },
    },
    insert: mock((table: unknown) =>
      createInsertChain((payload) => {
        insertCalls.push({ table: resolveTableName(table), payload });
      })
    ),
    delete: mock((table: unknown) =>
      createDeleteChain((payload) => {
        deleteCalls.push({ table: resolveTableName(table), payload });
      })
    ),
    update: mock((table: unknown) =>
      createUpdateChain((payload) => {
        updateCalls.push({ table: resolveTableName(table), payload });
      })
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
    const {
      createTaskSessionMessageWriteApi,
      insertCalls,
      deleteCalls,
      updateCalls,
    } = await loadTaskSessionMessageWriteModule();

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

    const canonicalMessageInsert = insertCalls.find((call) => call.table === "task_messages")?.payload;
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
});