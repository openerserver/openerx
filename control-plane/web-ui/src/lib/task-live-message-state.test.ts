import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "../stores/realtime";
import {
  applyRealtimeEventToLiveAssistantState,
  replayLiveAssistantState,
} from "./task-live-message-state";
import { createEmptyLiveAssistantState } from "./message-normalize";

function createEvent(overrides: Partial<RealtimeEvent>): RealtimeEvent {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    type: overrides.type ?? "task.message.updated",
    ts: overrides.ts ?? "2026-04-08T03:18:17.218Z",
    projectId: overrides.projectId,
    taskId: overrides.taskId ?? "task-1",
    sessionId: overrides.sessionId ?? "session-1",
    agentRunId: overrides.agentRunId,
    data: overrides.data ?? {},
  };
}

describe("task live message state", () => {
  it("tracks an in-progress assistant update", () => {
    const state = applyRealtimeEventToLiveAssistantState(
      createEmptyLiveAssistantState(),
      createEvent({
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            agent: "coder",
            time: {
              created: "2026-04-08T03:18:17.218Z",
            },
          },
        },
      }),
      "session-1",
    );

    expect(state.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(state.metaById.get("assistant-1")).toMatchObject({ agent: "coder" });
    expect(state.incompleteIds.has("assistant-1")).toBe(true);
  });

  it("accumulates assistant deltas before completion", () => {
    const initial = createEmptyLiveAssistantState();
    const withFirstDelta = applyRealtimeEventToLiveAssistantState(
      initial,
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
      "session-1",
    );
    const withSecondDelta = applyRealtimeEventToLiveAssistantState(
      withFirstDelta,
      createEvent({
        type: "task.message.delta",
        data: {
          part: {
            messageID: "assistant-1",
            type: "text",
            text: "，世界",
          },
        },
      }),
      "session-1",
    );

    expect(withSecondDelta.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(withSecondDelta.textById.get("assistant-1")).toBe("你好，世界");
    expect(withSecondDelta.incompleteIds.has("assistant-1")).toBe(true);
  });

  it("marks an assistant as completed once the terminal update arrives", () => {
    const inFlight = applyRealtimeEventToLiveAssistantState(
      createEmptyLiveAssistantState(),
      createEvent({
        type: "task.message.delta",
        data: {
          part: {
            messageID: "assistant-1",
            type: "text",
            text: "测试完成",
          },
        },
      }),
      "session-1",
    );
    const completed = applyRealtimeEventToLiveAssistantState(
      inFlight,
      createEvent({
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            time: {
              created: "2026-04-08T03:18:17.218Z",
              completed: "2026-04-08T03:18:24.437Z",
            },
          },
        },
      }),
      "session-1",
    );

    expect(completed.incompleteIds.has("assistant-1")).toBe(false);
  });

  it("ignores events from other sessions", () => {
    const state = applyRealtimeEventToLiveAssistantState(
      createEmptyLiveAssistantState(),
      createEvent({
        sessionId: "session-2",
        data: {
          message: {
            id: "assistant-1",
            role: "assistant",
            time: { created: "2026-04-08T03:18:17.218Z" },
          },
        },
      }),
      "session-1",
    );

    expect(state.orderedAssistantMessageIds).toEqual([]);
  });

  it("replays a stored event history in chronological order", () => {
    const state = replayLiveAssistantState(
      [
        createEvent({
          id: "event-2",
          type: "task.message.delta",
          ts: "2026-04-08T03:18:18.000Z",
          data: {
            part: {
              messageID: "assistant-1",
              type: "text",
              text: "，世界",
            },
          },
        }),
        createEvent({
          id: "event-1",
          ts: "2026-04-08T03:18:17.000Z",
          data: {
            message: {
              id: "assistant-1",
              role: "assistant",
              time: {
                created: "2026-04-08T03:18:17.000Z",
              },
            },
          },
        }),
      ],
      "session-1",
    );

    expect(state.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(state.textById.get("assistant-1")).toBe("，世界");
    expect(state.incompleteIds.has("assistant-1")).toBe(true);
  });
});