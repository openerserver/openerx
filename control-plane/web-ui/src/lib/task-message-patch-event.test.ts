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
      textDelta: "你好",
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