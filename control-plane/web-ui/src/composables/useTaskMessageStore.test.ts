import { computed, effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TaskConversationMessageItem,
  TaskConversationWorkflowItem,
} from "../lib/message-normalize";
import { getTaskMessageSnapshotRevision } from "../lib/task-message-snapshot";
import type { RealtimeEvent } from "../stores/realtime";
import { useTaskMessageSnapshot } from "./useTaskMessageSnapshot";
import { useTaskMessageStore } from "./useTaskMessageStore";

const apiMocks = vi.hoisted(() => ({
  getCurrentTaskRound: vi.fn(),
  getTaskRoundMessages: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getCurrentTaskRound: apiMocks.getCurrentTaskRound,
  getTaskRoundMessages: apiMocks.getTaskRoundMessages,
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

  function createConversationItem(
    overrides?: Partial<TaskConversationMessageItem>,
  ): TaskConversationMessageItem {
    return {
      key: overrides?.key ?? "message-1",
      role: overrides?.role ?? "assistant",
      text: overrides?.text,
      createdAt: overrides?.createdAt ?? "2026-04-08T03:18:17.218Z",
      toolCalls: overrides?.toolCalls ?? [],
      raw: overrides?.raw ?? null,
      isStreaming: overrides?.isStreaming,
      agent: overrides?.agent,
      model: overrides?.model,
      status: overrides?.status,
      errorText: overrides?.errorText,
      thinkingText: overrides?.thinkingText,
      userInputText: overrides?.userInputText,
      finalSentText: overrides?.finalSentText,
    };
  }

  function createWorkflowItem(
    overrides?: Partial<TaskConversationWorkflowItem>,
  ): TaskConversationWorkflowItem {
    return {
      key: overrides?.key ?? "workflow-1",
      role: "workflow",
      createdAt: overrides?.createdAt,
      variant: overrides?.variant,
      label: overrides?.label,
      hint: overrides?.hint,
      steps: overrides?.steps ?? [],
      raw: overrides?.raw ?? null,
      toolCalls: [],
    };
  }

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
    apiMocks.getCurrentTaskRound.mockReset();
    apiMocks.getTaskRoundMessages.mockReset();
    apiMocks.getCurrentTaskRound.mockResolvedValue({
      taskId: "task-1",
      round: createRound(),
    });
    apiMocks.getTaskRoundMessages.mockResolvedValue({
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

  function mountStore(options?: Parameters<typeof useTaskMessageStore>[2]) {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    scope = effectScope();
    const store = scope.run(() => useTaskMessageStore(taskId, sessionId, options));
    if (!store) {
      throw new Error("expected task message store");
    }

    return {
      taskId,
      sessionId,
      store,
    };
  }

  function mountConversationState() {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    scope = effectScope();
    const state = scope.run(() => {
      const snapshot = useTaskMessageSnapshot(taskId, sessionId);
      const store = useTaskMessageStore(taskId, snapshot.activeSessionId, {
        sourceMessages: snapshot.sourceMessages,
        snapshotRevision: computed(() => getTaskMessageSnapshotRevision(snapshot.trace.value)),
      });

      return {
        clearPendingAssistantDraft: store.clearPendingAssistantDraft,
        conversationAuthority: store.displayConversationAuthority,
        conversationItems: store.conversationItems,
        hasStreamingAssistant: store.hasStreamingAssistant,
        refresh: snapshot.refresh,
        seedPendingAssistantDraft: store.seedPendingAssistantDraft,
        trace: snapshot.trace,
      };
    });
    if (!state) {
      throw new Error("expected task conversation state");
    }

    return {
      taskId,
      sessionId,
      state,
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
      targets: {
        workflow: false,
        flow: false,
        messages: true,
      },
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

  it("owns the regular conversation reducer and only cuts over after snapshot catch-up", async () => {
    const persistedItems = ref<TaskConversationMessageItem[]>([]);
    const snapshotRevision = ref(0);
    const { store } = mountStore({
      persistedItems,
      snapshotRevision,
    });

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

    expect(store.conversationAuthority.value).toBe("realtime");
    expect(store.displayConversationAuthority.value).toBe("realtime");
    expect(store.hasStreamingAssistant.value).toBe(true);
    expect(store.conversationState.value.orderedIds).toEqual(["assistant-1"]);
    expect(store.conversationState.value.recordsById["assistant-1"]).toMatchObject({
      key: "assistant-1",
      kind: "message",
      authority: "realtime",
      renderStatus: "streaming",
      item: {
        key: "assistant-1",
        text: "live reply",
        isStreaming: true,
      },
    });
    expect(store.items.value.map((item) => item.text)).toEqual(["live reply"]);

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

    expect(store.conversationAuthority.value).toBe("persisted");
    expect(store.displayConversationAuthority.value).toBe("realtime");
    expect(store.conversationState.value.orderedIds).toEqual(["assistant-1"]);
    expect(store.conversationState.value.recordsById["assistant-1"]).toMatchObject({
      key: "assistant-1",
      kind: "message",
      authority: "realtime",
      renderStatus: "streaming",
      item: {
        key: "assistant-1",
        text: "live reply",
        isStreaming: true,
      },
    });
    expect(store.items.value.map((item) => item.text)).toEqual(["live reply"]);

    persistedItems.value = [
      createConversationItem({
        key: "assistant-1",
        text: "persisted reply",
        createdAt: "2026-04-08T03:18:19.218Z",
      }),
    ];
    snapshotRevision.value = 9;

    await nextTick();

    expect(store.displayConversationAuthority.value).toBe("persisted");
    expect(store.hasStreamingAssistant.value).toBe(false);
    expect(store.conversationState.value.orderedIds).toEqual(["assistant-1"]);
    expect(store.conversationState.value.recordsById["assistant-1"]).toMatchObject({
      key: "assistant-1",
      kind: "message",
      authority: "persisted",
      renderStatus: "persisted",
      item: {
        key: "assistant-1",
        text: "persisted reply",
      },
    });
    expect(store.items.value.map((item) => item.text)).toEqual(["persisted reply"]);
  });

  it("owns pending assistant draft lifecycle inside the store contract", async () => {
    const persistedItems = ref<TaskConversationMessageItem[]>([
      createConversationItem({
        key: "user-1",
        role: "user",
        text: "continue",
      }),
    ]);
    const { store } = mountStore({
      persistedItems,
    });

    store.seedPendingAssistantDraft("session-1");

    await nextTick();

    expect(
      store.items.value.some((item) => item.key.startsWith("pending-assistant:session-1:")),
    ).toBe(true);
    expect(store.hasStreamingAssistant.value).toBe(true);

    store.clearPendingAssistantDraft("session-2");
    await nextTick();

    expect(
      store.items.value.some((item) => item.key.startsWith("pending-assistant:session-1:")),
    ).toBe(true);

    store.clearPendingAssistantDraft("session-1");
    await nextTick();

    expect(
      store.items.value.some((item) => item.key.startsWith("pending-assistant:session-1:")),
    ).toBe(false);

    store.seedPendingAssistantDraft("session-1");
    await nextTick();

    realtimeStoreMock.events = [
      createEvent({
        id: "event-task-completed",
        type: "task.completed",
      }),
    ];

    await nextTick();

    expect(
      store.items.value.some((item) => item.key.startsWith("pending-assistant:session-1:")),
    ).toBe(false);
  });

  it("builds workflow-aware conversation list items inside the store", async () => {
    const persistedItems = ref<TaskConversationMessageItem[]>([
      createConversationItem({ key: "user-1", role: "user", text: "prompt" }),
      createConversationItem({ key: "assistant-1", text: "reply" }),
    ]);
    const workflowItems = ref<TaskConversationWorkflowItem[]>([
      createWorkflowItem({ key: "workflow-1", label: "workflow" }),
    ]);
    const { store } = mountStore({
      persistedItems,
      workflowItems,
      hideWorkflowExecutionContextUsers: ref(true),
    });

    await nextTick();

    expect(store.items.value.map((item) => item.key)).toEqual(["user-1", "assistant-1"]);
    expect(store.conversationItems.value.map((item) => item.key)).toEqual([
      "user-1",
      "workflow-1",
      "assistant-1",
    ]);
  });

  it("clears terminal pending drafts so later session snapshot updates cannot revive them", async () => {
    const { state } = mountConversationState();

    await Promise.resolve();
    await nextTick();

    state.seedPendingAssistantDraft("session-1");
    await nextTick();

    expect(state.hasStreamingAssistant.value).toBe(true);
    expect(
      state.conversationItems.value.some(
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

    expect(state.hasStreamingAssistant.value).toBe(false);
    expect(
      state.conversationItems.value.some(
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

    expect(state.hasStreamingAssistant.value).toBe(false);
    expect(
      state.conversationItems.value.some(
        (item) => item.role === "assistant" && item.key.startsWith("pending-assistant:"),
      ),
    ).toBe(false);
  });

  it("loads persisted messages through the round facade for the selected session", async () => {
    apiMocks.getTaskRoundMessages.mockResolvedValueOnce({
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

    const { state } = mountConversationState();

    await Promise.resolve();
    await nextTick();

    expect(apiMocks.getTaskRoundMessages).toHaveBeenCalledWith(
      "task-1",
      "session-1",
    );
    expect(state.conversationItems.value.map((item) => item.text)).toEqual([
      "session-first prompt",
      "session-first reply",
    ]);
    expect(state.trace.value?.timelineMeta).toMatchObject({
      readSource: "task-domain-projection",
      roundId: "task-session:task-1:session-1",
      snapshotVersion: 4,
      persistedThroughRevision: 4,
    });
  });

  it("keeps realtime overlay until the persisted snapshot catches up to the latest ack", async () => {
    apiMocks.getTaskRoundMessages
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

    const { state } = mountConversationState();

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

    expect(state.conversationAuthority.value).toBe("realtime");
    expect(state.hasStreamingAssistant.value).toBe(true);
    expect(
      state.conversationItems.value.find((item) => item.role === "assistant")?.text,
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

    expect(state.conversationAuthority.value).toBe("realtime");
    expect(state.hasStreamingAssistant.value).toBe(true);
    expect(
      state.conversationItems.value.find((item) => item.role === "assistant")?.text,
    ).toBe("live reply");

    await state.refresh(true);
    await nextTick();

    expect(state.conversationAuthority.value).toBe("persisted");
    expect(state.hasStreamingAssistant.value).toBe(false);
    expect(
      state.conversationItems.value.find((item) => item.role === "assistant")?.text,
    ).toBe("persisted reply");
  });
});