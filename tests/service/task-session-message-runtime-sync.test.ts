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
}) {
  importCounter += 1;

  const insertCalls: Array<{ table: string; payload: unknown }> = [];
  const deleteCalls: Array<{ table: string; payload: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: unknown }> = [];
  const taskMessageFindFirstResults = [...(args?.taskMessageFindFirstResults ?? [])];

  const fakeDb = {
    select: mock(() => createSelectChain(() => taskMessageFindFirstResults.shift() ?? null)),
    query: {
      taskMessages: {
        findFirst: mock(async () => taskMessageFindFirstResults.shift() ?? null),
      },
      taskSessions: {
        findFirst: mock(async () => args?.sessionRecord ?? null),
      },
    },
    insert: mock((table: unknown) =>
      createInsertChain((payload) => {
        insertCalls.push({ table: resolveTableName(table), payload });
      }),
    ),
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
    `../../control-plane/service/src/modules/tasks/task-session-message-write-api.ts?task-session-message-runtime-sync-test=${importCounter}`
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

describe("task session message runtime sync", () => {
  test("writes assistant multipart runtime messages into canonical task-domain tables", async () => {
    const sessionId = "task-session:task-1:runtime-session-1";
    const { createTaskSessionMessageWriteApi, insertCalls, deleteCalls, updateCalls } =
      await loadTaskSessionMessageWriteModule({
        taskMessageFindFirstResults: [null, null],
        sessionRecord: {
          id: sessionId,
          latestRunId: null,
          runtimeSessionId: "runtime-session-1",
          triggerType: null,
          sessionKind: "primary",
          coordinationKey: sessionId,
          rootSessionId: sessionId,
          candidateIndex: null,
          workflowStageKey: null,
          effectiveModel: null,
          selectedModel: null,
          costUsd: 0,
          startedAt: "2025-01-01T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      });

    const upsertTaskSessionRecord = mock(async () => sessionId);
    const resolveTaskSessionRecordByRuntimeSessionId = mock(async () => null);
    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord,
      resolveTaskSessionRecordByRuntimeSessionId,
    });

    const result = await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "runtime-session-1",
      message: {
        id: "msg-1",
        info: {
          role: "assistant",
          time: {
            created: "2025-01-01T00:01:00.000Z",
            completed: "2025-01-01T00:02:00.000Z",
          },
          tokens: { total: 31 },
        },
        parts: [
          { type: "text", text: "hello from assistant" },
          {
            id: "tool-call-1",
            type: "tool_call",
            name: "search_code",
            input: { query: "task domain", includePattern: "src/modules/tasks/**" },
          },
          {
            type: "file_reference",
            filePath: "docs/spec.md",
            startLine: 8,
            endLine: 24,
          },
        ],
      },
    });

    expect(result).toEqual({
      messageId: `task-session-message:${sessionId}:msg-1`,
      sessionId,
      seq: 0,
    });
    expect(upsertTaskSessionRecord).toHaveBeenCalledWith({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "runtime-session-1",
      sourceType: "root",
      isActive: true,
    });
    expect(resolveTaskSessionRecordByRuntimeSessionId).not.toHaveBeenCalled();

    expect(insertCalls.map((call) => call.table)).toEqual(
      expect.arrayContaining([
        "task_session_runs",
        "task_messages",
        "task_message_parts",
        "task_operations",
        "task_timeline_views",
      ]),
    );
    expect(insertCalls.map((call) => call.table)).not.toContain("task_artifacts");

    const taskMessageInsert = insertCalls.find((call) => call.table === "task_messages")?.payload;
    expect(taskMessageInsert).toMatchObject({
      id: `task-session-message:${sessionId}:msg-1`,
      taskId: "task-1",
      sessionId,
      createdByRunId: `run_${sessionId}`,
      role: "assistant",
      messageKind: "reply",
      runtimeMessageId: "msg-1",
      seq: 0,
      textContent: "hello from assistant",
      textPreview: "hello from assistant",
      partCount: 3,
      tokenUsed: 31,
      status: "completed",
      startedAt: "2025-01-01T00:01:00.000Z",
      createdAt: "2025-01-01T00:01:00.000Z",
      completedAt: "2025-01-01T00:02:00.000Z",
    });

    const messagePartInsertCalls = insertCalls
      .filter((call) => call.table === "task_message_parts")
      .map((call) => call.payload);
    expect(messagePartInsertCalls).toEqual([
      expect.objectContaining({
        id: `task-session-message:${sessionId}:msg-1:0`,
        messageId: `task-session-message:${sessionId}:msg-1`,
        partIndex: 0,
        partType: "text",
        textContent: "hello from assistant",
      }),
      expect.objectContaining({
        id: `task-session-message:${sessionId}:msg-1:1`,
        partIndex: 1,
        partType: "tool_call",
        textContent: null,
      }),
      expect.objectContaining({
        id: `task-session-message:${sessionId}:msg-1:2`,
        partIndex: 2,
        partType: "file_reference",
        textContent: null,
      }),
    ]);

    const operationInsert = insertCalls.find((call) => call.table === "task_operations")?.payload;
    expect(operationInsert).toMatchObject({
      id: "task-operation:tool-call-1",
      taskId: "task-1",
      sessionId,
      runId: `run_${sessionId}`,
      messageId: `task-session-message:${sessionId}:msg-1`,
      runtimeOperationId: "tool-call-1",
      operationKind: "tool_call",
      toolName: "search_code",
      title: "search_code",
      status: "running",
      summaryJson: expect.objectContaining({
        source: "task-session-message-write",
        toolName: "search_code",
      }),
      startedAt: "2025-01-01T00:01:00.000Z",
      finishedAt: null,
      createdAt: "2025-01-01T00:01:00.000Z",
    });

    expect(deleteCalls.map((call) => call.table)).toEqual(
      expect.arrayContaining(["task_message_parts"]),
    );

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "task_sessions",
          payload: expect.objectContaining({
            latestRunId: `run_${sessionId}`,
            headMessageId: `task-session-message:${sessionId}:msg-1`,
            status: "completed",
          }),
        }),
      ]),
    );
  });

  test("reroutes the first candidate user prompt to the parent canonical session", async () => {
    const parentSessionId = "task-session:task-1:runtime-parent";
    const existingMessageId = `task-session-message:${parentSessionId}:msg-parent-1`;
    const { createTaskSessionMessageWriteApi, insertCalls, deleteCalls, updateCalls } =
      await loadTaskSessionMessageWriteModule({
        taskMessageFindFirstResults: [
          null,
          {
            id: existingMessageId,
            role: "user",
            runtimeMessageId: "msg-parent-1",
            status: "completed",
            clientMessageId: null,
            providerMessageId: null,
            seq: 2,
            textContent: "repeat this prompt",
            textPreview: "repeat this prompt",
            rawPayload: {
              id: "msg-parent-1",
              info: {
                role: "user",
                time: { created: "2025-01-01T00:01:00.000Z" },
              },
              parts: [{ type: "text", text: "repeat this prompt" }],
            },
            partCount: 1,
            tokenUsed: 0,
            startedAt: "2025-01-01T00:01:00.000Z",
            completedAt: null,
            errorText: null,
            createdAt: "2025-01-01T00:01:00.000Z",
            updatedAt: "2025-01-01T00:01:00.000Z",
          },
        ],
        sessionRecord: null,
      });

    const resolveTaskSessionRecordByRuntimeSessionId = mock(
      async (_taskId: string, _projectId: string, runtimeSessionId: string) => {
        if (runtimeSessionId === "runtime-child") {
          return {
            runtimeSessionId: "runtime-child",
            parentRuntimeSessionId: "runtime-parent",
            sessionKind: "candidate",
          };
        }
        if (runtimeSessionId === "runtime-parent") {
          return {
            runtimeSessionId: "runtime-parent",
            parentRuntimeSessionId: null,
            sessionKind: "primary",
          };
        }
        return null;
      },
    );
    const upsertTaskSessionRecord = mock(async () => {
      throw new Error("upsertTaskSessionRecord should not run when a parent message is reused");
    });
    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord,
      resolveTaskSessionRecordByRuntimeSessionId,
    });

    const result = await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "runtime-child",
      message: {
        id: "msg-child-1",
        info: {
          role: "user",
          time: { created: "2025-01-01T00:01:05.000Z" },
        },
        parts: [{ type: "text", text: "repeat this prompt" }],
      },
    });

    expect(result).toEqual({
      messageId: existingMessageId,
      sessionId: parentSessionId,
      seq: 0,
    });
    expect(resolveTaskSessionRecordByRuntimeSessionId).toHaveBeenCalledTimes(2);
    expect(resolveTaskSessionRecordByRuntimeSessionId).toHaveBeenNthCalledWith(
      1,
      "task-1",
      "project-1",
      "runtime-child",
    );
    expect(resolveTaskSessionRecordByRuntimeSessionId).toHaveBeenNthCalledWith(
      2,
      "task-1",
      "project-1",
      "runtime-parent",
    );
    expect(upsertTaskSessionRecord).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("keeps follow-up candidate user prompts in the child session once the child already has messages", async () => {
    const childSessionId = "task-session:task-1:runtime-child";
    const childAssistantMessageId = `task-session-message:${childSessionId}:msg-child-assistant-1`;
    const existingChildAssistantMessage = {
      id: childAssistantMessageId,
      role: "assistant",
      runtimeMessageId: "msg-child-assistant-1",
      status: "completed",
      clientMessageId: null,
      providerMessageId: null,
      seq: 0,
      textContent: "candidate answer",
      textPreview: "candidate answer",
      rawPayload: {
        id: "msg-child-assistant-1",
        info: {
          role: "assistant",
          time: {
            created: "2025-01-01T00:01:10.000Z",
            completed: "2025-01-01T00:01:12.000Z",
          },
        },
        parts: [{ type: "text", text: "candidate answer" }],
      },
      partCount: 1,
      tokenUsed: 0,
      startedAt: "2025-01-01T00:01:10.000Z",
      completedAt: "2025-01-01T00:01:12.000Z",
      errorText: null,
      createdAt: "2025-01-01T00:01:10.000Z",
      updatedAt: "2025-01-01T00:01:12.000Z",
    };
    const { createTaskSessionMessageWriteApi, insertCalls } = await loadTaskSessionMessageWriteModule({
      taskMessageFindFirstResults: [existingChildAssistantMessage, null, existingChildAssistantMessage],
      sessionRecord: {
        id: childSessionId,
        runtimeSessionId: "runtime-child",
        latestRunId: `run_${childSessionId}`,
        sessionKind: "candidate",
        triggerType: "execute",
        coordinationKey: childSessionId,
        executionStatus: "running",
        archivedAt: null,
        startedAt: "2025-01-01T00:01:00.000Z",
        createdAt: "2025-01-01T00:01:00.000Z",
        effectiveModel: null,
        selectedModel: null,
        workflowStageKey: null,
        candidateIndex: 0,
        costUsd: 0,
      },
    });

    const resolveTaskSessionRecordByRuntimeSessionId = mock(
      async (_taskId: string, _projectId: string, runtimeSessionId: string) => {
        if (runtimeSessionId === "runtime-child") {
          return {
            runtimeSessionId: "runtime-child",
            parentRuntimeSessionId: "runtime-parent",
            sessionKind: "candidate",
          };
        }
        if (runtimeSessionId === "runtime-parent") {
          return {
            runtimeSessionId: "runtime-parent",
            parentRuntimeSessionId: null,
            sessionKind: "primary",
          };
        }
        return null;
      },
    );
    const upsertTaskSessionRecord = mock(async () => childSessionId);
    const api = createTaskSessionMessageWriteApi({
      upsertTaskSessionRecord,
      resolveTaskSessionRecordByRuntimeSessionId,
    });

    const result = await api.upsertTaskSessionMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "runtime-child",
      message: {
        id: "msg-child-user-2",
        info: {
          role: "user",
          time: { created: "2025-01-01T00:01:20.000Z" },
        },
        parts: [{ type: "text", text: "follow up question" }],
      },
    });

    expect(result).toEqual({
      messageId: `task-session-message:${childSessionId}:msg-child-user-2`,
      sessionId: childSessionId,
      seq: 0,
    });
    expect(upsertTaskSessionRecord).toHaveBeenCalledWith({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "runtime-child",
      sourceType: "root",
      isActive: true,
    });
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "task_messages",
          payload: expect.objectContaining({
            id: `task-session-message:${childSessionId}:msg-child-user-2`,
            sessionId: childSessionId,
            role: "user",
            parentMessageId: childAssistantMessageId,
            replyToMessageId: childAssistantMessageId,
            textContent: "follow up question",
          }),
        }),
      ]),
    );
  });
});
