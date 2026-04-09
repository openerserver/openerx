import { effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "../stores/realtime";
import { useTaskMessagePatchConsumer } from "./useTaskMessagePatchConsumer";

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

describe("useTaskMessagePatchConsumer", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    realtimeStoreMock.connected = true;
    realtimeStoreMock.events = [];
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountConsumer(taskIds: string[] = ["task-1"]) {
    const monitoredTaskIds = ref(taskIds);
    scope = effectScope();
    const consumer = scope.run(() => useTaskMessagePatchConsumer(monitoredTaskIds));
    if (!consumer) {
      throw new Error("expected task message patch consumer");
    }

    return {
      monitoredTaskIds,
      consumer,
    };
  }

  it("resets from history and then only consumes newer patch events for the same consumer", async () => {
    const { consumer } = mountConsumer();

    const startEvent = createEvent({
      id: "event-start",
      data: {
        message: {
          id: "assistant-1",
          role: "assistant",
          time: {
            created: "2026-04-08T03:18:17.218Z",
          },
        },
      },
    });
    realtimeStoreMock.events = [startEvent];

    await nextTick();

    const reset = consumer.replaceLiveAssistantStateFromHistory({
      consumerId: "consumer-1",
      taskId: "task-1",
      sessionId: "session-1",
    });
    expect(reset.liveAssistantState.orderedAssistantMessageIds).toEqual(["assistant-1"]);

    realtimeStoreMock.events = [
      createEvent({
        id: "event-delta",
        type: "task.message.delta",
        data: {
          part: {
            messageID: "assistant-1",
            type: "text",
            text: "你好",
          },
        },
      }),
      ...realtimeStoreMock.events,
    ];

    await nextTick();

    const consumed = consumer.consumePendingTaskPatchEvents({
      consumerId: "consumer-1",
      taskId: "task-1",
      sessionId: "session-1",
    });
    expect(consumed.pendingEvents.map((event) => event.eventId)).toEqual(["event-delta"]);
    expect(consumed.liveAssistantState?.textById.get("assistant-1")).toBe("你好");

    expect(
      consumer.consumePendingTaskPatchEvents({
        consumerId: "consumer-1",
        taskId: "task-1",
        sessionId: "session-1",
      }),
    ).toMatchObject({
      hasPendingEvents: false,
      pendingEvents: [],
      liveAssistantState: null,
    });
  });

  it("exposes latest patch events only for monitored tasks", async () => {
    const { consumer } = mountConsumer(["task-1"]);

    realtimeStoreMock.events = [
      createEvent({
        id: "event-other-task",
        taskId: "task-2",
        data: {
          message: {
            id: "assistant-2",
            role: "assistant",
            time: {
              created: "2026-04-08T03:18:17.218Z",
            },
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
            time: {
              created: "2026-04-08T03:18:17.218Z",
            },
          },
        },
      }),
    ];

    await nextTick();

    expect(consumer.taskPatchEventSignature.value).toBe("event-monitored-task");
    expect(consumer.getLatestTaskPatchEvent("task-1")).toMatchObject({
      eventId: "event-monitored-task",
      messageId: "assistant-1",
    });
    expect(consumer.getLatestTaskPatchEvent("task-2")).toBeNull();
  });
});