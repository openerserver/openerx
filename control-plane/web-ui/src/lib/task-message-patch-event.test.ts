import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "../stores/realtime";
import { toTaskMessagePatchEvent } from "./task-message-patch-event";

function createEvent(overrides: Partial<RealtimeEvent>): RealtimeEvent {
  return {
    id: overrides.id ?? "event-1",
    type: overrides.type ?? "task.message.updated",
    ts: overrides.ts ?? "2026-04-08T03:18:17.218Z",
    projectId: overrides.projectId,
    taskId: overrides.taskId ?? "task-1",
    phaseId: overrides.phaseId,
    sessionId: overrides.sessionId ?? "session-1",
    agentRunId: overrides.agentRunId,
    data: overrides.data ?? {},
  };
}

describe("task message patch event", () => {
  it("maps an in-progress assistant update", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
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
              },
            },
          },
        }),
      ),
    ).toMatchObject({
      kind: "assistant-progress",
      messageId: "assistant-1",
      agent: "coder",
      modelLabel: "github-copilot:gpt-5-mini",
    });
  });

  it("maps a completed assistant update", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          data: {
            message: {
              id: "assistant-1",
              role: "assistant",
              modelLabel: "claude-sonnet-4",
              time: {
                created: "2026-04-08T03:18:17.218Z",
                completed: "2026-04-08T03:18:24.437Z",
              },
            },
          },
        }),
      ),
    ).toMatchObject({
      kind: "assistant-completed",
      messageId: "assistant-1",
      modelLabel: "claude-sonnet-4",
      completedAt: "2026-04-08T03:18:24.437Z",
    });
  });

  it("extracts inline assistant text from a message snapshot update", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          data: {
            message: {
              info: {
                id: "assistant-1",
                role: "assistant",
                time: {
                  created: "2026-04-08T03:18:17.218Z",
                },
              },
              parts: [
                {
                  type: "text",
                  text: "首段正文",
                },
              ],
            },
          },
        }),
      ),
    ).toMatchObject({
      kind: "assistant-progress",
      messageId: "assistant-1",
      initialText: "首段正文",
    });
  });

  it("maps a text delta into an assistant patch", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.message.delta",
          data: {
            part: {
              messageID: "assistant-1",
              type: "text",
              text: "你好",
            },
          },
        }),
      ),
    ).toMatchObject({
      kind: "assistant-delta",
      messageId: "assistant-1",
      partType: "text",
      textDelta: "你好",
    });
  });

  it("maps a thinking delta into an assistant patch", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.message.delta",
          data: {
            part: {
              messageID: "assistant-1",
              type: "thinking",
              text: "先分析上下文",
            },
          },
        }),
      ),
    ).toMatchObject({
      kind: "assistant-delta",
      messageId: "assistant-1",
      partType: "thinking",
      textDelta: "先分析上下文",
    });
  });

  it("maps persisted ack events into a stable task patch", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.message.persisted",
          data: {
            roundId: "task-session:task-1:session-1",
            taskSessionId: "task-session:task-1:session-1",
            messageId: "assistant-1",
            persistedRevision: 7,
            snapshotVersion: 7,
            persistedThroughRevision: 7,
          },
        }),
      ),
    ).toMatchObject({
      kind: "message-persisted",
      roundId: "task-session:task-1:session-1",
      taskSessionId: "task-session:task-1:session-1",
      messageId: "assistant-1",
      persistedRevision: 7,
      snapshotVersion: 7,
      persistedThroughRevision: 7,
    });
  });

  it("maps round synced events into a stable task patch", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.round.synced",
          data: {
            roundId: "task-session:task-1:session-1",
            taskSessionId: "task-session:task-1:session-1",
            messageId: "assistant-1",
            snapshotVersion: 8,
            persistedThroughRevision: 8,
          },
        }),
      ),
    ).toMatchObject({
      kind: "round-synced",
      roundId: "task-session:task-1:session-1",
      taskSessionId: "task-session:task-1:session-1",
      messageId: "assistant-1",
      snapshotVersion: 8,
      persistedThroughRevision: 8,
    });
  });

  it("maps message reconcile required events into a refresh patch", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.reconcile.required",
          data: {
            roundId: "task-session:task-1:session-1",
            scope: "messages",
            reason: "snapshot_lag",
            expectedRevision: 9,
          },
        }),
      ),
    ).toMatchObject({
      kind: "message-reconcile-required",
      roundId: "task-session:task-1:session-1",
      reason: "snapshot_lag",
      expectedRevision: 9,
    });
  });

  it("preserves alias_miss reconcile reasons on message refresh patches", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.reconcile.required",
          data: {
            roundId: "task-session:task-1:session-1",
            scope: "messages",
            reason: "alias_miss",
            expectedRevision: 10,
          },
        }),
      ),
    ).toMatchObject({
      kind: "message-reconcile-required",
      roundId: "task-session:task-1:session-1",
      reason: "alias_miss",
      expectedRevision: 10,
    });
  });

  it("maps workflow reconcile required events into a workflow refresh patch", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.reconcile.required",
          data: {
            scope: "workflow",
            reason: "projection_rebuilt",
          },
        }),
      ),
    ).toMatchObject({
      kind: "workflow-reconcile-required",
      reason: "projection_rebuilt",
    });
  });

  it("maps flow reconcile required events into a flow refresh patch", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.reconcile.required",
          data: {
            scope: "flow",
            reason: "projection_rebuilt",
          },
        }),
      ),
    ).toMatchObject({
      kind: "flow-reconcile-required",
      reason: "projection_rebuilt",
    });
  });

  it("maps task reconcile required events into a task-wide refresh patch", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.reconcile.required",
          data: {
            scope: "task",
            reason: "internal_repair",
          },
        }),
      ),
    ).toMatchObject({
      kind: "task-reconcile-required",
      reason: "internal_repair",
    });
  });

  it("maps session lifecycle snapshot reasons", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.snapshot.updated",
          data: {
            reason: "session.created",
          },
        }),
      ),
    ).toMatchObject({ kind: "session-created" });
  });

  it("maps phase lifecycle events and keeps the phase id", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.phase.completed",
          phaseId: "phase-2",
          data: {
            status: "completed",
          },
        }),
      ),
    ).toMatchObject({
      kind: "phase-completed",
      phaseId: "phase-2",
    });
  });

  it("maps phase snapshot reasons", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.snapshot.updated",
          phaseId: "phase-2",
          data: {
            reason: "phase.awaiting_adoption",
          },
        }),
      ),
    ).toMatchObject({
      kind: "phase-awaiting-adoption",
      phaseId: "phase-2",
    });
  });

  it("maps task followup events to task patch kinds", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.updated",
          data: {
            rawType: "task.followup.completed",
          },
        }),
      ),
    ).toMatchObject({ kind: "task-followup-completed" });
  });

  it("ignores unsupported realtime payloads", () => {
    expect(
      toTaskMessagePatchEvent(
        createEvent({
          type: "task.message.updated",
          data: {
            message: {
              id: "system-1",
              role: "system",
            },
          },
        }),
      ),
    ).toMatchObject({ kind: "ignored" });
  });
});