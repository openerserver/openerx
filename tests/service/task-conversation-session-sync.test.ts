/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { conversationSessions } from "../../control-plane/service/src/db/schema";

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

async function loadTaskConversationSessionSyncModule(args?: {
  existingParent?: { id: string; rootSessionId: string | null } | null;
}) {
  importCounter += 1;

  const insertedSessions: unknown[] = [];
  const updatedSessions: unknown[] = [];

  const fakeDb = {
    query: {
      conversationSessions: {
        findFirst: mock(async () => args?.existingParent ?? null),
      },
    },
    insert: mock((table: unknown) => {
      if (table === conversationSessions) {
        return createInsertChain((payload) => {
          insertedSessions.push(payload);
        });
      }

      return createInsertChain(() => undefined);
    }),
    update: mock((table: unknown) => {
      if (table === conversationSessions) {
        return createUpdateChain((payload) => {
          updatedSessions.push(payload);
        });
      }

      return createUpdateChain(() => undefined);
    }),
  };

  mock.module("../../control-plane/service/src/db", () => ({
    db: fakeDb,
  }));

  const module = await import(
    `../../control-plane/service/src/modules/tasks/task-conversation-session-sync.ts?task-conversation-session-sync-test=${importCounter}`
  );

  return {
    ...module,
    insertedSessions,
    updatedSessions,
  };
}

afterEach(() => {
  mock.restore();
});

describe("task conversation session sync", () => {
  test("deactivates previous sessions before upserting an active root session", async () => {
    const { createTaskConversationSessionSyncApi, insertedSessions, updatedSessions } =
      await loadTaskConversationSessionSyncModule();

    const appendTaskDomainEvent = mock(async () => undefined);
    const api = createTaskConversationSessionSyncApi({ appendTaskDomainEvent });

    const sessionId = await api.upsertConversationSessionRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "root-session-1",
      sourceType: "root",
      branchName: "main",
      isActive: true,
    });

    expect(sessionId).toBe("task_session:task-1:root-session-1");
    expect(updatedSessions[0]).toMatchObject({
      isActive: false,
    });
    expect(insertedSessions[0]).toMatchObject({
      id: "task_session:task-1:root-session-1",
      taskId: "task-1",
      projectId: "project-1",
      parentSessionId: null,
      rootSessionId: "task_session:task-1:root-session-1",
      sessionKind: "task-root",
      sourceType: "root",
      branchName: "main",
      isActive: true,
      runtimeSessionId: "root-session-1",
      treeNodeId: "task_session:task-1:root-session-1",
    });
    expect(appendTaskDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        taskId: "task-1",
        sessionId: "task_session:task-1:root-session-1",
        eventType: "conversation.session.upserted",
        payload: expect.objectContaining({
          runtimeSessionId: "root-session-1",
          sourceType: "root",
          isActive: true,
          branchName: "main",
        }),
      }),
    );
  });

  test("inherits root session id for forked child sessions and preserves archive metadata", async () => {
    const { createTaskConversationSessionSyncApi, insertedSessions, updatedSessions } =
      await loadTaskConversationSessionSyncModule({
        existingParent: {
          id: "task_session:task-1:parent-session-1",
          rootSessionId: "task_session:task-1:root-session-1",
        },
      });

    const appendTaskDomainEvent = mock(async () => undefined);
    const api = createTaskConversationSessionSyncApi({ appendTaskDomainEvent });

    const sessionId = await api.upsertConversationSessionRecord({
      task: { id: "task-1", projectId: "project-1" },
      runtimeSessionId: "child-session-1",
      parentRuntimeSessionId: "parent-session-1",
      forkedFromMessageId: "msg-1",
      sourceType: "sub_session",
      isActive: false,
      archivedAt: "2025-01-01T00:03:00.000Z",
    });

    expect(sessionId).toBe("task_session:task-1:child-session-1");
    expect(updatedSessions).toHaveLength(0);
    expect(insertedSessions[0]).toMatchObject({
      id: "task_session:task-1:child-session-1",
      parentSessionId: "task_session:task-1:parent-session-1",
      rootSessionId: "task_session:task-1:root-session-1",
      forkedFromMessageId: "msg-1",
      sessionKind: "resume",
      sourceType: "sub_session",
      isActive: false,
      archivedAt: "2025-01-01T00:03:00.000Z",
    });
    expect(appendTaskDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "task_session:task-1:child-session-1",
        payload: expect.objectContaining({
          parentRuntimeSessionId: "parent-session-1",
          forkedFromMessageId: "msg-1",
          sourceType: "sub_session",
          archivedAt: "2025-01-01T00:03:00.000Z",
        }),
      }),
    );
  });
});
