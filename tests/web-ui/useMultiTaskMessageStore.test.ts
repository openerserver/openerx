import { effectScope, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "../../control-plane/web-ui/src/stores/realtime";
import { useMultiTaskMessageStore } from "../../control-plane/web-ui/src/composables/useMultiTaskMessageStore";

const realtimeStoreStateRaw = vi.hoisted(() => ({
  events: [] as RealtimeEvent[],
}));

const realtimeStoreState = reactive(realtimeStoreStateRaw);

vi.mock("../../control-plane/web-ui/src/stores/realtime", () => ({
  useRealtimeStore: () => realtimeStoreState,
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

describe("useMultiTaskMessageStore", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    realtimeStoreState.events = [];
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountStore(taskIds: string[] = ["task-1"]) {
    const monitoredTaskIds = ref(taskIds);
    scope = effectScope();
    const store = scope.run(() => useMultiTaskMessageStore(monitoredTaskIds));
    if (!store) {
      throw new Error("expected multi task message store");
    }

    return {
      monitoredTaskIds,
      store,
    };
  }

  it("filters normalized task patch events to monitored tasks", () => {
    const { store } = mountStore(["task-1"]);

    realtimeStoreState.events = [
      createEvent({
        id: "event-ignored-task",
        taskId: "task-2",
        data: {
          message: {
            id: "assistant-2",
            role: "assistant",
            time: { created: "2026-04-08T03:18:17.218Z" },
          },
        },
      }),
      createEvent({
        id: "event-monitored-task",
        taskId: "task-1",
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            time: { created: "2026-04-08T03:18:17.218Z" },
          },
        },
      }),
    ];

    expect(store.taskPatchEventSignature.value).toBe("event-monitored-task");
    expect(store.getLiveAssistantState("task-1", "session-1").orderedAssistantMessageIds).toEqual([
      "assistant-1",
    ]);
    expect(store.getLiveAssistantState("task-2", "session-1").orderedAssistantMessageIds).toEqual(
      [],
    );
  });

  it("replays live assistant state for a task session using the shared reducer semantics", () => {
    const { store } = mountStore(["task-1"]);

    realtimeStoreState.events = [
      createEvent({
        id: "event-complete",
        taskId: "task-1",
        sessionId: "session-1",
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            agent: "coder",
            model: {
              providerID: "github-copilot",
              modelID: "gpt-5-mini",
            },
            time: {
              created: "2026-04-08T03:18:17.218Z",
              completed: "2026-04-08T03:18:24.437Z",
            },
          },
        },
      }),
      createEvent({
        id: "event-delta",
        taskId: "task-1",
        sessionId: "session-1",
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
        id: "event-start",
        taskId: "task-1",
        sessionId: "session-1",
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            agent: "coder",
            modelLabel: "github-copilot:gpt-5-mini",
            time: {
              created: "2026-04-08T03:18:17.218Z",
            },
          },
        },
      }),
    ];

    const liveAssistantState = store.getLiveAssistantState("task-1", "session-1");

    expect(liveAssistantState.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(liveAssistantState.textById.get("assistant-1")).toBe("你好");
    expect(liveAssistantState.incompleteIds.has("assistant-1")).toBe(false);
    expect(liveAssistantState.metaById.get("assistant-1")).toMatchObject({
      agent: "coder",
      modelLabel: "github-copilot:gpt-5-mini",
    });
  });

  it("tracks and advances the per-task pending patch cursor independently", () => {
    const { store } = mountStore(["task-1", "task-2"]);

    realtimeStoreState.events = [
      createEvent({
        id: "event-task-1-newest",
        taskId: "task-1",
        sessionId: "session-1",
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            time: { created: "2026-04-08T03:18:18.000Z" },
          },
        },
      }),
      createEvent({
        id: "event-task-1-older",
        taskId: "task-1",
        sessionId: "session-1",
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
        id: "event-task-2-only",
        taskId: "task-2",
        sessionId: "session-2",
        data: {
          message: {
            id: "assistant-2",
            role: "assistant",
            time: { created: "2026-04-08T03:18:19.000Z" },
          },
        },
      }),
    ];

    const firstBatch = store.consumeMonitoredTaskPatchEvents((taskId) =>
      taskId === "task-1" ? "session-1" : "session-2",
    );
    expect(firstBatch).toEqual([
      {
        taskId: "task-1",
        sessionId: "session-1",
        shouldRefreshPersistedMessages: false,
        shouldRefreshSummary: false,
      },
      {
        taskId: "task-2",
        sessionId: "session-2",
        shouldRefreshPersistedMessages: false,
        shouldRefreshSummary: false,
      },
    ]);

    realtimeStoreState.events = [
      createEvent({
        id: "event-task-2-follow-up",
        taskId: "task-2",
        sessionId: "session-2",
        type: "task.message.delta",
        data: {
          part: {
            messageID: "assistant-2",
            type: "text",
            text: "继续",
          },
        },
      }),
      ...realtimeStoreState.events,
    ];

    const secondBatch = store.consumeMonitoredTaskPatchEvents((taskId) =>
      taskId === "task-1" ? "session-1" : "session-2",
    );
    expect(secondBatch).toEqual([
      {
        taskId: "task-2",
        sessionId: "session-2",
        shouldRefreshPersistedMessages: false,
        shouldRefreshSummary: false,
      },
    ]);
  });

  it("consumes pending assistant patches and reports a persisted refresh boundary", () => {
    const { store } = mountStore(["task-1"]);

    realtimeStoreState.events = [
      createEvent({
        id: "event-complete",
        taskId: "task-1",
        sessionId: "session-1",
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
      createEvent({
        id: "event-delta",
        taskId: "task-1",
        sessionId: "session-1",
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
        id: "event-start",
        taskId: "task-1",
        sessionId: "session-1",
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

    expect(store.consumeMonitoredTaskPatchEvents(() => "session-1")).toEqual([
      {
        taskId: "task-1",
        sessionId: "session-1",
        shouldRefreshPersistedMessages: true,
        shouldRefreshSummary: false,
      },
    ]);

    const liveAssistantState = store.getLiveAssistantState("task-1", "session-1");
    expect(liveAssistantState.textById.get("assistant-1")).toBe("你好");
    expect(liveAssistantState.incompleteIds.has("assistant-1")).toBe(false);

    expect(store.consumeMonitoredTaskPatchEvents(() => "session-1")).toEqual([]);
  });

  it("requests a summary refresh for non-message task patch events", () => {
    const { store } = mountStore(["task-1"]);

    realtimeStoreState.events = [
      createEvent({
        id: "event-session-updated",
        taskId: "task-1",
        sessionId: "session-1",
        type: "task.snapshot.updated",
        data: {
          reason: "session.updated",
        },
      }),
    ];

    expect(store.consumeMonitoredTaskPatchEvents(() => "session-1")).toEqual([
      {
        taskId: "task-1",
        sessionId: "session-1",
        shouldRefreshPersistedMessages: false,
        shouldRefreshSummary: true,
      },
    ]);
  });

  it("processes monitored task patch refreshes through shared callbacks", async () => {
    const { store } = mountStore(["task-1"]);

    realtimeStoreState.events = [
      createEvent({
        id: "event-complete",
        taskId: "task-1",
        sessionId: "session-1",
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
      createEvent({
        id: "event-session-updated",
        taskId: "task-1",
        sessionId: "session-1",
        type: "task.snapshot.updated",
        data: {
          reason: "session.updated",
        },
      }),
    ];

    const calls: string[] = [];
    const consumptions = await store.processMonitoredTaskPatchEvents({
      resolveSessionId: () => "session-1",
      refreshSummary: async (taskId) => {
        calls.push(`summary:${taskId}`);
      },
      refreshPersistedMessages: async (taskId, sessionId) => {
        calls.push(`messages:${taskId}:${sessionId}`);
      },
      rebuildSummary: (taskId) => {
        calls.push(`rebuild:${taskId}`);
      },
    });

    expect(consumptions).toEqual([
      {
        taskId: "task-1",
        sessionId: "session-1",
        shouldRefreshPersistedMessages: true,
        shouldRefreshSummary: true,
      },
    ]);
    expect(calls).toEqual([
      "summary:task-1",
      "messages:task-1:session-1",
      "rebuild:task-1",
    ]);
  });
});