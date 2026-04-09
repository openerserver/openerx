import { describe, expect, it } from "vitest";
import {
  createTaskLiveAssistantStateManager,
  type ConsumePendingTaskPatchEventsOptions,
} from "./task-live-assistant-state-manager";
import type { TaskMessagePatchEvent } from "./task-message-patch-event";

function createPatchEvent(
  overrides: Partial<TaskMessagePatchEvent> & Pick<TaskMessagePatchEvent, "kind" | "eventId">,
): TaskMessagePatchEvent {
  return {
    eventId: overrides.eventId,
    taskId: overrides.taskId ?? "task-1",
    sessionId: overrides.sessionId ?? "session-1",
    rawEventKind: overrides.rawEventKind ?? "task.message.updated",
    ...overrides,
  } as TaskMessagePatchEvent;
}

function createConsumptionOptions(
  patchEvents: TaskMessagePatchEvent[],
): ConsumePendingTaskPatchEventsOptions {
  return {
    consumerId: "task-1",
    taskId: "task-1",
    sessionId: "session-1",
    patchEvents,
  };
}

describe("task live assistant state manager", () => {
  it("replays history and applies only new assistant patches for a consumer", () => {
    const manager = createTaskLiveAssistantStateManager();
    const start = createPatchEvent({
      eventId: "event-start",
      kind: "assistant-progress",
      messageId: "assistant-1",
      createdAt: "2026-04-08T03:18:17.218Z",
    });

    const initialState = manager.replaceLiveAssistantStateFromHistory("task-1", "session-1", [start]);
    expect(initialState.orderedAssistantMessageIds).toEqual(["assistant-1"]);

    manager.markConsumerHandled("task-1", "event-start");

    const delta = createPatchEvent({
      eventId: "event-delta",
      kind: "assistant-delta",
      rawEventKind: "task.message.delta",
      messageId: "assistant-1",
      textDelta: "你好",
    });
    const complete = createPatchEvent({
      eventId: "event-complete",
      kind: "assistant-completed",
      messageId: "assistant-1",
      createdAt: "2026-04-08T03:18:17.218Z",
      completedAt: "2026-04-08T03:18:24.437Z",
    });

    const consumed = manager.consumePendingTaskPatchEvents(
      createConsumptionOptions([complete, delta, start]),
    );

    expect(consumed.hasPendingEvents).toBe(true);
    expect(consumed.pendingEvents.map((event) => event.eventId)).toEqual([
      "event-delta",
      "event-complete",
    ]);
    expect(consumed.liveAssistantState?.textById.get("assistant-1")).toBe("你好");
    expect(consumed.liveAssistantState?.incompleteIds.has("assistant-1")).toBe(false);

    expect(
      manager.consumePendingTaskPatchEvents(createConsumptionOptions([complete, delta, start])),
    ).toEqual({
      hasPendingEvents: false,
      pendingEvents: [],
      liveAssistantState: null,
    });
  });

  it("advances the consumer cursor for non-assistant task patches without mutating live state", () => {
    const manager = createTaskLiveAssistantStateManager();
    const start = createPatchEvent({
      eventId: "event-start",
      kind: "assistant-progress",
      messageId: "assistant-1",
      createdAt: "2026-04-08T03:18:17.218Z",
    });
    const completedTask = createPatchEvent({
      eventId: "event-task-completed",
      kind: "task-completed",
      rawEventKind: "task.completed",
    });

    manager.replaceLiveAssistantStateFromHistory("task-1", "session-1", [start]);
    manager.markConsumerHandled("task-1", "event-start");

    const consumed = manager.consumePendingTaskPatchEvents(
      createConsumptionOptions([completedTask, start]),
    );

    expect(consumed.hasPendingEvents).toBe(true);
    expect(consumed.pendingEvents.map((event) => event.eventId)).toEqual([
      "event-task-completed",
    ]);
    expect(consumed.liveAssistantState).toBeNull();
    expect(manager.getLiveAssistantState("task-1", "session-1", [completedTask, start])).toMatchObject({
      orderedAssistantMessageIds: ["assistant-1"],
    });
  });
});