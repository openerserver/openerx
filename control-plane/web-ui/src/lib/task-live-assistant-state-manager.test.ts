import { describe, expect, it } from "vitest";
import {
  createTaskLiveAssistantStateManager,
  type ConsumePendingTaskPatchEventsOptions,
} from "./task-live-assistant-state-manager";
import type { TaskMessagePatchEvent } from "./task-message-patch-event";

function createPatchEvent(
  overrides: Partial<TaskMessagePatchEvent> & Pick<TaskMessagePatchEvent, "kind" | "eventId">,
): TaskMessagePatchEvent {
  const { eventId, taskId, sessionId, rawEventKind, ...rest } = overrides;
  return {
    ...rest,
    eventId,
    taskId: taskId ?? "task-1",
    sessionId: sessionId ?? "session-1",
    rawEventKind: rawEventKind ?? "task.message.updated",
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

  it("replaceLiveAssistantStateFromPhaseHistory merges phase-scoped assistant state across sessions without mutating the session cache", () => {
    const manager = createTaskLiveAssistantStateManager();

    const phaseAStart = createPatchEvent({
      eventId: "event-phase-a-start",
      kind: "assistant-progress",
      messageId: "assistant-a",
      createdAt: "2026-04-17T01:00:00.000Z",
      phaseId: "phase-a",
      sessionId: "session-a",
    });
    const phaseAChainStart = createPatchEvent({
      eventId: "event-phase-a-chain-start",
      kind: "assistant-progress",
      messageId: "assistant-a2",
      createdAt: "2026-04-17T01:00:05.000Z",
      phaseId: "phase-a",
      sessionId: "session-a-child",
    });
    const phaseBStart = createPatchEvent({
      eventId: "event-phase-b-start",
      kind: "assistant-progress",
      messageId: "assistant-b",
      createdAt: "2026-04-17T01:00:10.000Z",
      phaseId: "phase-b",
      sessionId: "session-a",
    });

    // Seed session-a cache via session-only replay containing both phase events.
    manager.replaceLiveAssistantStateFromHistory("task-1", "session-a", [
      phaseBStart,
      phaseAStart,
    ]);
    expect(
      manager.getLiveAssistantState("task-1", "session-a", [phaseBStart, phaseAStart])
        .orderedAssistantMessageIds,
    ).toEqual(["assistant-a", "assistant-b"]);

    const merged = manager.replaceLiveAssistantStateFromPhaseHistory({
      taskId: "task-1",
      phaseId: "phase-a",
      sessionIds: ["session-a", "session-a-child"],
      patchEvents: [phaseBStart, phaseAChainStart, phaseAStart],
    });

    expect(merged.orderedAssistantMessageIds).toEqual(["assistant-a", "assistant-a2"]);

    // Session-only cache must not be overwritten by the phase-scoped replay.
    expect(
      manager.getLiveAssistantState("task-1", "session-a", [phaseBStart, phaseAStart])
        .orderedAssistantMessageIds,
    ).toEqual(["assistant-a", "assistant-b"]);
  });

  it("replaceLiveAssistantStateFromPhaseHistory returns an empty state when sessionIds is empty", () => {
    const manager = createTaskLiveAssistantStateManager();
    const state = manager.replaceLiveAssistantStateFromPhaseHistory({
      taskId: "task-1",
      phaseId: "phase-a",
      sessionIds: [],
      patchEvents: [],
    });
    expect(state.orderedAssistantMessageIds).toEqual([]);
  });
});