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

  it("keeps assistant completion on realtime state until a persisted ack arrives", () => {
    const event = createPatchEvent("assistant-completed", {
      rawEventKind: "task.message.updated",
      messageId: "assistant-1",
      createdAt: "2026-04-08T03:18:17.218Z",
      completedAt: "2026-04-08T03:18:24.437Z",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(false);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
    expect(getTaskDetailRefreshRequest(event)).toBeNull();
  });

  it("refreshes when a round synced ack confirms persisted messages are ready", () => {
    const event = createPatchEvent("round-synced", {
      rawEventKind: "task.round.synced",
      roundId: "task-session:task-1:session-1",
      taskSessionId: "task-session:task-1:session-1",
      snapshotVersion: 8,
      persistedThroughRevision: 8,
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(true);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
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

  it("refreshes messages when reconcile required asks for a silent catch-up", () => {
    const event = createPatchEvent("message-reconcile-required", {
      rawEventKind: "task.reconcile.required",
      roundId: "task-session:task-1:session-1",
      reason: "snapshot_lag",
      expectedRevision: 9,
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(true);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
      eventId: "event-1",
      reason: "message-reconcile-required",
      targets: {
        workflow: false,
        flow: false,
        messages: true,
      },
      shouldBumpTraceRefreshKey: false,
    });
  });

  it("keeps message-only refresh targets for sequence gaps", () => {
    const event = createPatchEvent("message-reconcile-required", {
      rawEventKind: "task.reconcile.required",
      roundId: "task-session:task-1:session-1",
      reason: "sequence_gap",
      expectedRevision: 12,
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(true);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
      eventId: "event-1",
      reason: "message-reconcile-required",
      targets: {
        workflow: false,
        flow: false,
        messages: true,
      },
      shouldBumpTraceRefreshKey: false,
    });
  });

  it("refreshes workflow only when reconcile required targets the sidebar", () => {
    const event = createPatchEvent("workflow-reconcile-required", {
      rawEventKind: "task.reconcile.required",
      reason: "projection_rebuilt",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
      eventId: "event-1",
      reason: "workflow-reconcile-required",
      targets: {
        workflow: true,
        flow: false,
        messages: false,
      },
      shouldBumpTraceRefreshKey: false,
    });
  });

  it("refreshes flow only when reconcile required targets compare and trace surfaces", () => {
    const event = createPatchEvent("flow-reconcile-required", {
      rawEventKind: "task.reconcile.required",
      reason: "projection_rebuilt",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
      eventId: "event-1",
      reason: "flow-reconcile-required",
      targets: {
        workflow: false,
        flow: true,
        messages: false,
      },
      shouldBumpTraceRefreshKey: false,
    });
  });

  it("refreshes workflow, flow and messages when reconcile required targets the whole task", () => {
    const event = createPatchEvent("task-reconcile-required", {
      rawEventKind: "task.reconcile.required",
      reason: "internal_repair",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(true);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
      eventId: "event-1",
      reason: "task-reconcile-required",
      targets: {
        workflow: true,
        flow: true,
        messages: true,
      },
      shouldBumpTraceRefreshKey: false,
    });
  });

  it("does not schedule a snapshot refresh on message persisted before the round sync arrives", () => {
    const event = createPatchEvent("message-persisted", {
      rawEventKind: "task.message.persisted",
      messageId: "assistant-1",
      roundId: "task-session:task-1:session-1",
      taskSessionId: "task-session:task-1:session-1",
      persistedRevision: 7,
      snapshotVersion: 7,
      persistedThroughRevision: 7,
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(false);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
    expect(getTaskDetailRefreshRequest(event)).toBeNull();
  });

  it("does not treat tool message updates as a persisted refresh boundary", () => {
    const event = createPatchEvent("tool-message", {
      rawEventKind: "task.message.updated",
      messageId: "tool-1",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(false);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
    expect(getTaskDetailRefreshRequest(event)).toBeNull();
  });

  it("refreshes on session creation snapshots without forcing message reload", () => {
    const event = createPatchEvent("session-created", {
      rawEventKind: "task.snapshot.updated",
    });

    expect(shouldScheduleTaskDetailRefresh(event)).toBe(true);
    expect(shouldRefreshTaskDetailMessages(event)).toBe(false);
    expect(getTaskDetailRefreshRequest(event)).toEqual({
      eventId: "event-1",
      reason: "session-created",
      targets: {
        workflow: true,
        flow: true,
        messages: false,
      },
      shouldBumpTraceRefreshKey: false,
    });
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
      targets: {
        workflow: false,
        flow: true,
        messages: false,
      },
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