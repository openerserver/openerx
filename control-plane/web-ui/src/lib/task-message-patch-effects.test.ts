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
  it("keeps message persisted as an authority ack without forcing a snapshot refresh", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("message-persisted", {
          rawEventKind: "task.message.persisted",
          messageId: "assistant-1",
          roundId: "task-session:task-1:session-1",
          taskSessionId: "task-session:task-1:session-1",
          persistedRevision: 7,
          snapshotVersion: 7,
          persistedThroughRevision: 7,
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: true,
      shouldRefreshTaskDetailMessages: false,
      shouldScheduleTaskDetailRefresh: false,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: false,
    });
  });

  it("keeps assistant completion on the realtime authority without forcing persisted refresh", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("assistant-completed", {
          rawEventKind: "task.message.updated",
          messageId: "assistant-1",
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: true,
      shouldRefreshCanonicalMessages: false,
      shouldRefreshTaskDetailMessages: false,
      shouldScheduleTaskDetailRefresh: false,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: false,
    });
  });

  it("treats round synced as the persisted refresh boundary for task detail", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("round-synced", {
          rawEventKind: "task.round.synced",
          roundId: "task-session:task-1:session-1",
          taskSessionId: "task-session:task-1:session-1",
          snapshotVersion: 8,
          persistedThroughRevision: 8,
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: true,
      shouldRefreshTaskDetailMessages: true,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: false,
    });
  });

  it("treats message reconcile required as a direct message refresh boundary", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("message-reconcile-required", {
          rawEventKind: "task.reconcile.required",
          roundId: "task-session:task-1:session-1",
          reason: "snapshot_lag",
          expectedRevision: 9,
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: true,
      shouldRefreshTaskDetailMessages: true,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: false,
    });
  });

  it("treats tool message updates as a task detail message refresh boundary", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("tool-message", {
          rawEventKind: "task.message.updated",
          messageId: "tool-1",
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: false,
      shouldRefreshTaskDetailMessages: true,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: false,
    });
  });

  it("treats user message updates as a task detail message refresh boundary", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("user-message", {
          rawEventKind: "task.message.updated",
          messageId: "user-1",
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: false,
      shouldRefreshTaskDetailMessages: true,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: false,
    });
  });

  it("treats workflow reconcile required as a workflow-only snapshot refresh boundary", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("workflow-reconcile-required", {
          rawEventKind: "task.reconcile.required",
          reason: "projection_rebuilt",
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: false,
      shouldRefreshTaskDetailMessages: false,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: false,
    });
  });

  it("treats flow reconcile required as a flow-only snapshot refresh boundary", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("flow-reconcile-required", {
          rawEventKind: "task.reconcile.required",
          reason: "projection_rebuilt",
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: false,
      shouldRefreshTaskDetailMessages: false,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: false,
    });
  });

  it("treats task reconcile required as a task-wide refresh boundary", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("task-reconcile-required", {
          rawEventKind: "task.reconcile.required",
          reason: "internal_repair",
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: true,
      shouldRefreshTaskDetailMessages: true,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: true,
    });
  });

  it("keeps session snapshots out of task detail refresh scheduling", () => {
    expect(
      getTaskMessagePatchEffects(
        createPatchEvent("session-created", {
          rawEventKind: "task.snapshot.updated",
        }),
      ),
    ).toMatchObject({
      updatesLiveAssistantState: false,
      shouldRefreshCanonicalMessages: false,
      shouldRefreshTaskDetailMessages: false,
      shouldScheduleTaskDetailRefresh: false,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: true,
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
        createPatchEvent("round-synced", {
          rawEventKind: "task.round.synced",
          roundId: "task-session:task-1:session-1",
          taskSessionId: "task-session:task-1:session-1",
          snapshotVersion: 9,
          persistedThroughRevision: 9,
        }),
      ]),
    ).toMatchObject({
      updatesLiveAssistantState: true,
      shouldRefreshCanonicalMessages: true,
      shouldRefreshTaskDetailMessages: true,
      shouldScheduleTaskDetailRefresh: true,
      shouldBumpTaskDetailTraceRefreshKey: false,
      shouldRefreshMonitorSummary: false,
    });
  });

  it("only refreshes task detail messages from polling when realtime is disconnected", () => {
    expect(shouldRefreshTaskDetailMessagesFromPoll(true)).toBe(false);
    expect(shouldRefreshTaskDetailMessagesFromPoll(false)).toBe(true);
  });
});