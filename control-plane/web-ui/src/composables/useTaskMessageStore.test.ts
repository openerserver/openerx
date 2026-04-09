import { effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "../stores/realtime";
import { useTaskMessageStore } from "./useTaskMessageStore";

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

  beforeEach(() => {
    realtimeStoreMock.connected = true;
    realtimeStoreMock.events = [];
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
        data: {
          message: {
            id: "assistant-2",
            role: "assistant",
            time: {
              created: "2026-04-08T03:18:17.218Z",
              completed: "2026-04-08T03:18:24.437Z",
            },
          },
        },
      }),
      createEvent({
        id: "event-1",
        taskId: "task-1",
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
    ];

    await nextTick();

    expect(store.latestTaskRefreshRequest.value).toEqual({
      eventId: "event-1",
      reason: "assistant-completed",
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
});