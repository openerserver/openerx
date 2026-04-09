import { describe, expect, it } from "vitest";
import type { TaskMessagePatchEvent } from "./task-message-patch-event";
import {
  getTaskDetailRefreshRequest,
  shouldBumpTaskDetailTraceRefreshKey,
  shouldRefreshTaskDetailMessages,
  shouldRefreshTaskDetailMessagesFromPoll,
  shouldScheduleTaskDetailRefresh,
} from "./task-detail-refresh-policy";

function createPatchEvent(
  kind: TaskMessagePatchEvent["kind"],
  overrides?: Partial<TaskMessagePatchEvent>,
): TaskMessagePatchEvent {
  return {
    eventId: overrides?.eventId ?? "event-1",
    taskId: overrides?.taskId ?? "task-1",
    sessionId: overrides?.sessionId ?? "session-1",
    rawEventKind: overrides?.rawEventKind ?? kind,
    kind,
    ...overrides,
  } as TaskMessagePatchEvent;
}

describe("task detail refresh policy", () => {
  it("does not refresh on assistant deltas", () => {
    const event = createPatchEvent("assistant-delta", {
      rawEventKind: "task.message.delta",
      messageId: "assistant-1",
      textDelta: "hello",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(false);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
  });

  it("keeps in-progress assistant updates on realtime only", () => {
    const event = createPatchEvent("assistant-progress", {
      rawEventKind: "task.message.updated",
      messageId: "assistant-1",
      createdAt: "2026-04-08T03:18:17.218Z",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(false);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
    expect(getTaskDetailRefreshRequest(event)).toBeNull();
  });

  it("refreshes when an assistant reply reaches a completed boundary", () => {
    const event = createPatchEvent("assistant-completed", {
      rawEventKind: "task.message.updated",
      messageId: "assistant-1",
      createdAt: "2026-04-08T03:18:17.218Z",
      completedAt: "2026-04-08T03:18:24.437Z",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(true);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
      eventId: "event-1",
      reason: "assistant-completed",
      shouldRefreshMessages: true,
      shouldBumpTraceRefreshKey: false,
    });
  });

  it("refreshes persisted messages for tool message updates", () => {
    const event = createPatchEvent("tool-message", {
      rawEventKind: "task.message.updated",
      messageId: "tool-1",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(true);
  });

  it("refreshes on session creation snapshots", () => {
    const event = createPatchEvent("session-created", {
      rawEventKind: "task.snapshot.updated",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(true);
  });

  it("refreshes flow for phase lifecycle events without forcing message reload", () => {
    const event = createPatchEvent("phase-resumed", {
      rawEventKind: "task.phase.resumed",
      phaseId: "phase-2",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
      eventId: "event-1",
      reason: "phase-resumed",
      shouldRefreshMessages: false,
      shouldBumpTraceRefreshKey: false,
    });
  });

  it("bumps the trace refresh key for hook and followup events", () => {
    const event = createPatchEvent("task-followup-completed", {
      rawEventKind: "task.followup.completed",
    });

    expect(shouldBumpTaskDetailTraceRefreshKey(event)).toBe(true);
    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
  });

  it("uses polling for message refresh only when realtime is disconnected", () => {
    expect(shouldRefreshTaskDetailMessagesFromPoll(true)).toBe(false);
    expect(shouldRefreshTaskDetailMessagesFromPoll(false)).toBe(true);
  });
});