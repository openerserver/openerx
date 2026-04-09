import { describe, expect, it } from "vitest";
import type { TaskMessagePatchEvent } from "./task-message-patch-event";
import {
  getTaskMessagePatchEffects,
  shouldRefreshTaskDetailMessagesFromPoll,
  summarizeTaskMessagePatchEffects,
} from "./task-message-patch-effects";

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

describe("task message patch effects", () => {
  it("marks assistant completion as a canonical message refresh boundary", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("assistant-completed", {
          rawEventKind: "task.message.updated",
          messageId: "assistant-1",
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: true,
      shouldRefreshCanonicalMessages: true,
      shouldRefreshTaskDetailMessages: true,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: false,
    });
  });

  it("marks followup completion as trace and summary refresh without canonical message refresh", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("task-followup-completed", {
          rawEventKind: "task.followup.completed",
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: false,
      shouldRefreshTaskDetailMessages: false,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: true,
      shouldRefreshMonitorSummary: true,
    });
  });

  it("marks phase lifecycle events as flow refresh boundaries without message refresh", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("phase-awaiting-adoption", {
          rawEventKind: "task.phase.awaiting_adoption",
          phaseId: "phase-2",
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: false,
      shouldRefreshTaskDetailMessages: false,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: true,
    });
  });

  it("aggregates batch effects across multiple pending patch events", () => {
    expect(
      summarizeTaskMessagePatchEffects([
        createPatchEvent("assistant-delta", {
          rawEventKind: "task.message.delta",
          messageId: "assistant-1",
          textDelta: "hello",
        }),
        createPatchEvent("session-updated", {
          rawEventKind: "task.snapshot.updated",
        }),
      ]),
    ).toMatchObject({
      updatesLiveAssistantState: true,
      shouldRefreshCanonicalMessages: false,
      shouldRefreshTaskDetailMessages: true,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: true,
    });
  });

  it("only refreshes task detail messages from polling when realtime is disconnected", () => {
    expect(shouldRefreshTaskDetailMessagesFromPoll(true)).toBe(false);
    expect(shouldRefreshTaskDetailMessagesFromPoll(false)).toBe(true);
  });
});