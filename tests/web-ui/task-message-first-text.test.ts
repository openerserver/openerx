import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "../../control-plane/web-ui/src/stores/realtime";
import { createEmptyLiveAssistantState } from "../../control-plane/web-ui/src/lib/message-normalize";
import { toTaskMessagePatchEvent } from "../../control-plane/web-ui/src/lib/task-message-patch-event";
import { applyRealtimeEventToLiveAssistantState } from "../../control-plane/web-ui/src/lib/task-live-message-state";

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

describe("task message first text", () => {
  it("extracts inline assistant text from task.message.updated snapshots", () => {
    const patchEvent = toTaskMessagePatchEvent(
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
    );

    expect(patchEvent).toMatchObject({
      kind: "assistant-progress",
      messageId: "assistant-1",
      initialText: "首段正文",
    });
  });

  it("hydrates live assistant state from snapshot text before delta arrives", () => {
    const state = applyRealtimeEventToLiveAssistantState(
      createEmptyLiveAssistantState(),
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
      "session-1",
    );

    expect(state.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(state.textById.get("assistant-1")).toBe("首段正文");
    expect(state.incompleteIds.has("assistant-1")).toBe(true);
  });
});