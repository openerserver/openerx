/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  conversationMessageParts,
  conversationMessages,
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

async function loadTaskConversationMessageSyncModule(args?: {
  existingMessage?: { messageIndex: number } | null;
  latestMessage?: { messageIndex: number } | null;
}) {
  importCounter += 1;

  const insertedMessages: unknown[] = [];
  const insertedMessageParts: unknown[] = [];
  const deletedMessageParts: unknown[] = [];
  let conversationMessageFindFirstCount = 0;

  const fakeDb = {
    query: {
      conversationMessages: {
        findFirst: mock(async () => {
          conversationMessageFindFirstCount += 1;
          return conversationMessageFindFirstCount === 1
            ? (args?.existingMessage ?? null)
            : (args?.latestMessage ?? null);
        }),
      },
    },
    insert: mock((table: unknown) => {
      if (table === conversationMessages) {
        return createInsertChain((payload) => {
          insertedMessages.push(payload);
        });
      }

      if (table === conversationMessageParts) {
        return createInsertChain((payload) => {
          insertedMessageParts.push(payload);
        });
      }

      return createInsertChain(() => undefined);
    }),
    delete: mock((table: unknown) => {
      if (table === conversationMessageParts) {
        return createDeleteChain((payload) => {
          deletedMessageParts.push(payload);
        });
      }

      return createDeleteChain(() => undefined);
    }),
  };

  mock.module("../../control-plane/service/src/db", () => ({
    db: fakeDb,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-conversation-message-sync.ts?task-conversation-message-sync-test=${importCounter}`
  );

  return {
    ...module,
    fakeDb,
    insertedMessages,
    insertedMessageParts,
    deletedMessageParts,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task conversation message sync", () => {
  test("persists conversation messages, parts, and projection summaries for multipart assistant messages", async () => {
    const {
      createTaskConversationMessageSyncApi,
      insertedMessages,
      insertedMessageParts,
      deletedMessageParts,
    } = await loadTaskConversationMessageSyncModule({
      existingMessage: null,
      latestMessage: { messageIndex: 2 },
    });

    const appendTaskDomainEvent = mock(async () => ({ seq: 77 }));
    const api = createTaskConversationMessageSyncApi({ appendTaskDomainEvent });

    const result = await api.upsertConversationMessageRecord({
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
      messageId: "task_session:task-1:runtime-session-1:msg-1",
      sessionId: "task_session:task-1:runtime-session-1",
      seq: 77,
    });
    expect(insertedMessages[0]).toMatchObject({
      id: "task_session:task-1:runtime-session-1:msg-1",
      sessionId: "task_session:task-1:runtime-session-1",
      runtimeMessageId: "msg-1",
      role: "assistant",
      messageIndex: 3,
      textContent: "hello from assistant",
      summaryText: "hello from assistant",
      tokenUsed: 31,
      startedAt: "2025-01-01T00:01:00.000Z",
      completedAt: "2025-01-01T00:02:00.000Z",
    });
    expect(deletedMessageParts).toHaveLength(1);
    expect(insertedMessageParts).toHaveLength(1);
    expect(insertedMessageParts[0]).toEqual([
      expect.objectContaining({
        id: "task_session:task-1:runtime-session-1:msg-1:0",
        messageId: "task_session:task-1:runtime-session-1:msg-1",
        partIndex: 0,
        partType: "text",
        textContent: "hello from assistant",
      }),
      expect.objectContaining({
        partIndex: 1,
        partType: "tool_call",
        textContent: null,
      }),
      expect.objectContaining({
        partIndex: 2,
        partType: "file_reference",
        textContent: null,
      }),
    ]);
    expect(appendTaskDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        taskId: "task-1",
        sessionId: "task_session:task-1:runtime-session-1",
        eventType: "conversation.message.upserted",
        payload: expect.objectContaining({
          messageId: "task_session:task-1:runtime-session-1:msg-1",
          runtimeMessageId: "msg-1",
          role: "assistant",
          textContent: "hello from assistant",
          partTypes: ["text", "tool_call", "file_reference"],
          partSummaries: [
            expect.objectContaining({
              partIndex: 0,
              partType: "text",
              textContent: "hello from assistant",
            }),
            expect.objectContaining({
              partIndex: 1,
              partType: "tool_call",
              title: "工具调用 search_code",
              metadata: expect.objectContaining({
                toolName: "search_code",
                argumentsSummary: "query: task domain | includePattern: src/modules/tasks/**",
              }),
            }),
            expect.objectContaining({
              partIndex: 2,
              partType: "file_reference",
              title: "文件引用 docs/spec.md",
              metadata: expect.objectContaining({
                filePath: "docs/spec.md",
                locationSummary: "docs/spec.md:8-24",
              }),
            }),
          ],
        }),
        createdAt: "2025-01-01T00:01:00.000Z",
      }),
    );
  });

  test("reuses existing message index and persists standalone tool results as single-part messages", async () => {
    const { createTaskConversationMessageSyncApi, insertedMessages, insertedMessageParts } =
      await loadTaskConversationMessageSyncModule({
        existingMessage: { messageIndex: 4 },
        latestMessage: { messageIndex: 9 },
      });

    const appendTaskDomainEvent = mock(async () => ({ seq: 12 }));
    const api = createTaskConversationMessageSyncApi({ appendTaskDomainEvent });

    const result = await api.upsertConversationMessageRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "runtime-session-2",
      message: {
        id: "msg-tool-1",
        part: {
          type: "tool",
          name: "read_file",
          state: {
            status: "completed",
            output: "file contents",
          },
        },
      },
    });

    expect(result).toEqual({
      messageId: "task_session:task-1:runtime-session-2:msg-tool-1",
      sessionId: "task_session:task-1:runtime-session-2",
      seq: 12,
    });
    expect(insertedMessages[0]).toMatchObject({
      messageIndex: 4,
      role: "tool",
      textContent: "file contents",
      summaryText: "file contents",
    });
    expect(insertedMessageParts[0]).toEqual([
      expect.objectContaining({
        partIndex: 0,
        partType: "tool_result",
        textContent: "file contents",
      }),
    ]);
    expect(appendTaskDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          role: "tool",
          textContent: "file contents",
          partTypes: ["tool_result"],
        }),
      }),
    );
  });
});
