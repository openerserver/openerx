import { effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "../stores/realtime";
import { useTreeMessages } from "./useTreeMessages";
import { useTaskMessageStore } from "./useTaskMessageStore";

const getCurrentTaskRoundMock = vi.fn();
const getTaskRoundsMock = vi.fn();
const getTaskRoundMessagesMock = vi.fn();

vi.mock("../lib/api", () => ({
  getCurrentTaskRound: getCurrentTaskRoundMock,
  getTaskRounds: getTaskRoundsMock,
  getTaskRoundMessages: getTaskRoundMessagesMock,
}));

const realtimeStoreMock = reactive({
  connected: true,
  events: [] as RealtimeEvent[],
});

vi.mock("../stores/realtime", () => ({
  useRealtimeStore: () => realtimeStoreMock,
}));

function createEvent(overrides: Partial<RealtimeEvent>): RealtimeEvent {
  return {
    id: overrides.id ?? "event-1",
    type: overrides.type ?? "task.message.updated",
    ts: overrides.ts ?? "2026-04-08T03:18:17.218Z",
    projectId: overrides.projectId,
    taskId: overrides.taskId ?? "task-1",
    sessionId: overrides.sessionId ?? "session-1",
    agentRunId: overrides.agentRunId,
    data: overrides.data ?? {},
  };
}

describe("useTaskMessageStore", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  function createRound(overrides?: Partial<Record<string, unknown>>) {
    return {
      id: "task-session:task-1:session-1",
      taskId: "task-1",
      sessionId: "session-1",
      kind: "continue",
      source: "continue",
      status: "completed",
      promptText: "Summarize progress",
      createdAt: "2026-04-08T03:18:17.218Z",
      updatedAt: "2026-04-08T03:18:24.437Z",
      ...overrides,
    };
  }

  beforeEach(() => {
    realtimeStoreMock.connected = true;
    realtimeStoreMock.events = [];
    getCurrentTaskRoundMock.mockReset();
    getTaskRoundsMock.mockReset();
    getTaskRoundMessagesMock.mockReset();
    getCurrentTaskRoundMock.mockResolvedValue({
      taskId: "task-1",
      round: createRound(),
    });
    getTaskRoundsMock.mockResolvedValue({
      taskId: "task-1",
      currentRoundId: "task-session:task-1:session-1",
      rounds: [createRound()],
    });
    getTaskRoundMessagesMock.mockResolvedValue({
      taskId: "task-1",
      round: createRound(),
      messages: [],
      snapshotVersion: 0,
      persistedThroughRevision: 0,
    });
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountStore() {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    scope = effectScope();
    const store = scope.run(() => useTaskMessageStore(taskId, sessionId));
    if (!store) {
      throw new Error("expected task message store");
    }

    return {
      taskId,
      sessionId,
      store,
    };
  }

  it("exposes the latest task detail refresh request for the active task", async () => {
    const { store } = mountStore();

    realtimeStoreMock.events = [
      createEvent({
        id: "event-other",
        taskId: "task-2",
        type: "task.round.synced",
        data: {
          roundId: "task-session:task-2:session-2",
          taskSessionId: "task-session:task-2:session-2",
          snapshotVersion: 6,
          persistedThroughRevision: 6,
        },
      }),
      createEvent({
        id: "event-1",
        type: "task.round.synced",
        taskId: "task-1",
        data: {
          roundId: "task-session:task-1:session-1",
          taskSessionId: "task-session:task-1:session-1",
          messageId: "assistant-1",
          snapshotVersion: 7,
          persistedThroughRevision: 7,
        },
      }),
    ];

    await nextTick();

    expect(store.latestTaskRefreshRequest.value).toEqual({
      eventId: "event-1",
      reason: "round-synced",
      shouldRefreshMessages: true,
      shouldBumpTraceRefreshKey: false,
    });
  });

  it("replays and updates live assistant state for the active session", async () => {
    const { store } = mountStore();

    realtimeStoreMock.events = [
      createEvent({
        id: "event-2",
        type: "task.message.delta",
        data: {
          part: {
            messageID: "assistant-1",
            type: "text",
            text: "你好",
          },
        },
      }),
      createEvent({
        id: "event-1",
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            agent: "coder",
            time: {
              created: "2026-04-08T03:18:17.218Z",
            },
          },
        },
      }),
    ];

    await nextTick();

    expect(store.liveAssistantState.value.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(store.liveAssistantState.value.textById.get("assistant-1")).toBe("你好");
    expect(store.liveAssistantState.value.incompleteIds.has("assistant-1")).toBe(true);
    expect(store.conversationAuthority.value).toBe("realtime");
    expect(store.latestPersistenceAck.value).toBeNull();

    realtimeStoreMock.events = [
      createEvent({
        id: "event-3",
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            time: {
              created: "2026-04-08T03:18:17.218Z",
              completed: "2026-04-08T03:18:24.437Z",
            },
          },
        },
      }),
      ...realtimeStoreMock.events,
    ];

    await nextTick();

    expect(store.liveAssistantState.value.incompleteIds.has("assistant-1")).toBe(false);
  });

  it("switches authority back to persisted when a round synced ack arrives", async () => {
    const { store } = mountStore();

    realtimeStoreMock.events = [
      createEvent({
        id: "event-1",
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            time: {
              created: "2026-04-08T03:18:17.218Z",
            },
          },
        },
      }),
    ];

    await nextTick();

    expect(store.conversationAuthority.value).toBe("realtime");

    realtimeStoreMock.events = [
      createEvent({
        id: "event-2",
        type: "task.round.synced",
        data: {
          roundId: "task-session:task-1:session-1",
          taskSessionId: "task-session:task-1:session-1",
          messageId: "assistant-1",
          snapshotVersion: 9,
          persistedThroughRevision: 9,
        },
      }),
      ...realtimeStoreMock.events,
    ];

    await nextTick();

    expect(store.conversationAuthority.value).toBe("persisted");
    expect(store.latestPersistenceAck.value).toEqual({
      eventId: "event-2",
      kind: "round-synced",
      sessionId: "session-1",
      roundId: "task-session:task-1:session-1",
      taskSessionId: "task-session:task-1:session-1",
      messageId: "assistant-1",
      persistedRevision: undefined,
      snapshotVersion: 9,
      persistedThroughRevision: 9,
    });
  });

  it("clears terminal pending drafts so later session snapshot updates cannot revive them", async () => {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    scope = effectScope();
    const messages = scope.run(() => useTreeMessages(taskId, sessionId));
    if (!messages) {
      throw new Error("expected tree messages composable");
    }

    await Promise.resolve();
    await nextTick();

    messages.seedPendingAssistantDraft("session-1");
    await nextTick();

    expect(messages.hasStreamingAssistant.value).toBe(true);
    expect(
      messages.conversationItems.value.some(
        (item) => item.role === "assistant" && item.key.startsWith("pending-assistant:"),
      ),
    ).toBe(true);

    realtimeStoreMock.events = [
      createEvent({
        id: "event-task-completed",
        type: "task.completed",
      }),
    ];

    await nextTick();

    expect(messages.hasStreamingAssistant.value).toBe(false);
    expect(
      messages.conversationItems.value.some(
        (item) => item.role === "assistant" && item.key.startsWith("pending-assistant:"),
      ),
    ).toBe(false);

    realtimeStoreMock.events = [
      createEvent({
        id: "event-session-updated",
        type: "task.snapshot.updated",
        data: {
          reason: "session.updated",
        },
      }),
      createEvent({
        id: "event-task-completed",
        type: "task.completed",
      }),
    ];

    await nextTick();

    expect(messages.hasStreamingAssistant.value).toBe(false);
    expect(
      messages.conversationItems.value.some(
        (item) => item.role === "assistant" && item.key.startsWith("pending-assistant:"),
      ),
    ).toBe(false);
  });

  it("loads persisted messages through the round facade for the selected session", async () => {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    getTaskRoundMessagesMock.mockResolvedValueOnce({
      taskId: "task-1",
      round: createRound(),
      messages: [
        {
          id: "user-1",
          roundId: "task-session:task-1:session-1",
          sessionId: "session-1",
          role: "user",
          status: "completed",
          text: "session-first prompt",
          parts: [
            {
              id: "part-user-1",
              partIndex: 0,
              partType: "text",
              text: "session-first prompt",
            },
          ],
          createdAt: "2026-04-08T03:18:17.218Z",
          updatedAt: "2026-04-08T03:18:17.218Z",
        },
        {
          id: "assistant-1",
          roundId: "task-session:task-1:session-1",
          sessionId: "session-1",
          role: "assistant",
          status: "completed",
          text: "session-first reply",
          parts: [
            {
              id: "part-assistant-1",
              partIndex: 0,
              partType: "text",
              text: "session-first reply",
            },
          ],
          createdAt: "2026-04-08T03:18:19.218Z",
          updatedAt: "2026-04-08T03:18:24.437Z",
          completedAt: "2026-04-08T03:18:24.437Z",
        },
      ],
      snapshotVersion: 4,
      persistedThroughRevision: 4,
    });

    scope = effectScope();
    const messages = scope.run(() => useTreeMessages(taskId, sessionId));
    if (!messages) {
      throw new Error("expected tree messages composable");
    }

    await Promise.resolve();
    await nextTick();

    expect(getTaskRoundsMock).toHaveBeenCalledWith("task-1");
    expect(getTaskRoundMessagesMock).toHaveBeenCalledWith(
      "task-1",
      "task-session:task-1:session-1",
    );
    expect(messages.conversationItems.value.map((item) => item.text)).toEqual([
      "session-first prompt",
      "session-first reply",
    ]);
    expect(messages.trace.value?.timelineMeta).toMatchObject({
      readSource: "task-domain-projection",
      roundId: "task-session:task-1:session-1",
      snapshotVersion: 4,
      persistedThroughRevision: 4,
    });
  });

  it("keeps realtime overlay until the persisted snapshot catches up to the latest ack", async () => {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    getTaskRoundMessagesMock
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: createRound(),
        messages: [],
        snapshotVersion: 0,
        persistedThroughRevision: 0,
      })
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: createRound(),
        messages: [
          {
            id: "assistant-1",
            roundId: "task-session:task-1:session-1",
            sessionId: "session-1",
            role: "assistant",
            status: "completed",
            text: "persisted reply",
            parts: [
              {
                id: "part-assistant-1",
                partIndex: 0,
                partType: "text",
                text: "persisted reply",
              },
            ],
            createdAt: "2026-04-08T03:18:19.218Z",
            updatedAt: "2026-04-08T03:18:24.437Z",
            completedAt: "2026-04-08T03:18:24.437Z",
          },
        ],
        snapshotVersion: 9,
        persistedThroughRevision: 9,
      });

    scope = effectScope();
    const messages = scope.run(() => useTreeMessages(taskId, sessionId));
    if (!messages) {
      throw new Error("expected tree messages composable");
    }

    await Promise.resolve();
    await nextTick();

    realtimeStoreMock.events = [
      createEvent({
        id: "event-progress",
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            time: {
              created: "2026-04-08T03:18:17.218Z",
            },
          },
        },
      }),
      createEvent({
        id: "event-delta",
        type: "task.message.delta",
        data: {
          part: {
            messageID: "assistant-1",
            type: "text",
            text: "live reply",
          },
        },
      }),
    ];

    await nextTick();

    expect(messages.conversationAuthority.value).toBe("realtime");
    expect(messages.hasStreamingAssistant.value).toBe(true);
    expect(
      messages.conversationItems.value.find((item) => item.role === "assistant")?.text,
    ).toBe("live reply");

    realtimeStoreMock.events = [
      createEvent({
        id: "event-ack",
        type: "task.round.synced",
        data: {
          roundId: "task-session:task-1:session-1",
          taskSessionId: "task-session:task-1:session-1",
          messageId: "assistant-1",
          snapshotVersion: 9,
          persistedThroughRevision: 9,
        },
      }),
      ...realtimeStoreMock.events,
    ];

    await nextTick();

    expect(messages.conversationAuthority.value).toBe("realtime");
    expect(messages.hasStreamingAssistant.value).toBe(true);
    expect(
      messages.conversationItems.value.find((item) => item.role === "assistant")?.text,
    ).toBe("live reply");

    await messages.refresh(true);
    await nextTick();

    expect(messages.conversationAuthority.value).toBe("persisted");
    expect(messages.hasStreamingAssistant.value).toBe(false);
    expect(
      messages.conversationItems.value.find((item) => item.role === "assistant")?.text,
    ).toBe("persisted reply");
  });
});