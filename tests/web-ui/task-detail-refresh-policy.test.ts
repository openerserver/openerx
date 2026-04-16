import { describe, expect, it } from "vitest";
import type { TaskMessagePatchEvent } from "../../control-plane/web-ui/src/lib/task-message-patch-event";
import {
  getTaskDetailRefreshRequest,
  shouldRefreshTaskDetailMessages,
  shouldScheduleTaskDetailRefresh,
} from "../../control-plane/web-ui/src/lib/task-detail-refresh-policy";

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
  it("keeps assistant progress on realtime only", () => {
    const event = createPatchEvent("assistant-progress", {
      rawEventKind: "task.message.updated",
      messageId: "assistant-1",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(false);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
    expect(getTaskDetailRefreshRequest(event)).toBeNull();
  });

  it("refreshes messages when tool output arrives via task.message.updated", () => {
    const event = createPatchEvent("tool-message", {
      rawEventKind: "task.message.updated",
      messageId: "tool-1",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(true);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
      eventId: "event-1",
      reason: "tool-message",
      targets: {
        workflow: false,
        flow: false,
        messages: true,
      },
      shouldBumpTraceRefreshKey: false,
    });
  });

  it("refreshes messages when user message updates land in the current conversation", () => {
    const event = createPatchEvent("user-message", {
      rawEventKind: "task.message.updated",
      messageId: "user-1",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(true);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
      eventId: "event-1",
      reason: "user-message",
      targets: {
        workflow: false,
        flow: false,
        messages: true,
      },
      shouldBumpTraceRefreshKey: false,
    });
  });
});