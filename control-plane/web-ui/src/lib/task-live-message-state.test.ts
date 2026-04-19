import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "../stores/realtime";
import {
  applyRealtimeEventToLiveAssistantState,
  mergeLiveAssistantStates,
  replayLiveAssistantState,
  replayPhaseLiveAssistantState,
  replayTaskMessagePatchEvents,
} from "./task-live-message-state";
import { createEmptyLiveAssistantState } from "./message-normalize";
import type { TaskMessagePatchEvent } from "./task-message-patch-event";

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

  it("hydrates initial assistant text from a message snapshot update", () => {
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

  it("hydrates initial assistant thinking from a message snapshot update", () => {
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
                type: "thinking",
                text: "先拆解问题。",
              },
            ],
          },
        },
      }),
      "session-1",
    );

    expect(state.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(state.thinkingById.get("assistant-1")).toBe("先拆解问题。");
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

  it("accumulates assistant thinking deltas independently from text", () => {
    const initial = createEmptyLiveAssistantState();
    const withThinking = applyRealtimeEventToLiveAssistantState(
      initial,
      createEvent({
        type: "task.message.delta",
        data: {
          part: {
            messageID: "assistant-1",
            type: "thinking",
            text: "先看日志",
          },
        },
      }),
      "session-1",
    );
    const withText = applyRealtimeEventToLiveAssistantState(
      withThinking,
      createEvent({
        type: "task.message.delta",
        data: {
          part: {
            messageID: "assistant-1",
            type: "text",
            text: "结论如下",
          },
        },
      }),
      "session-1",
    );

    expect(withText.thinkingById.get("assistant-1")).toBe("先看日志");
    expect(withText.textById.get("assistant-1")).toBe("结论如下");
    expect(withText.incompleteIds.has("assistant-1")).toBe(true);
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

function createAssistantPatchEvent(
  overrides: Partial<TaskMessagePatchEvent> & Pick<TaskMessagePatchEvent, "kind" | "eventId">,
): TaskMessagePatchEvent {
  const { eventId, kind, ...rest } = overrides;
  return {
    eventId,
    kind,
    taskId: overrides.taskId ?? "task-1",
    sessionId: overrides.sessionId ?? "session-1",
    rawEventKind: overrides.rawEventKind ?? "task.message.updated",
    ...rest,
  } as TaskMessagePatchEvent;
}

describe("task live message state phase replay", () => {
  it("replayTaskMessagePatchEvents filters by phaseId when scope provides one", () => {
    const events: TaskMessagePatchEvent[] = [
      createAssistantPatchEvent({
        eventId: "event-phase-b-delta",
        kind: "assistant-delta",
        rawEventKind: "task.message.delta",
        messageId: "assistant-2",
        textDelta: "b-text",
        phaseId: "phase-b",
        sessionId: "session-1",
      }),
      createAssistantPatchEvent({
        eventId: "event-phase-a-delta",
        kind: "assistant-delta",
        rawEventKind: "task.message.delta",
        messageId: "assistant-1",
        textDelta: "a-text",
        phaseId: "phase-a",
        sessionId: "session-1",
      }),
      createAssistantPatchEvent({
        eventId: "event-phase-a-start",
        kind: "assistant-progress",
        messageId: "assistant-1",
        createdAt: "2026-04-17T01:00:00.000Z",
        phaseId: "phase-a",
        sessionId: "session-1",
      }),
    ];

    const stateA = replayTaskMessagePatchEvents(events, {
      sessionId: "session-1",
      phaseId: "phase-a",
    });
    expect(stateA.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(stateA.textById.get("assistant-1")).toBe("a-text");
    expect(stateA.textById.has("assistant-2")).toBe(false);
  });

  it("replayTaskMessagePatchEvents keeps events without phaseId as legacy compatible", () => {
    const events: TaskMessagePatchEvent[] = [
      createAssistantPatchEvent({
        eventId: "event-delta",
        kind: "assistant-delta",
        rawEventKind: "task.message.delta",
        messageId: "assistant-1",
        textDelta: "legacy",
        sessionId: "session-1",
      }),
      createAssistantPatchEvent({
        eventId: "event-start",
        kind: "assistant-progress",
        messageId: "assistant-1",
        createdAt: "2026-04-17T01:00:00.000Z",
        sessionId: "session-1",
      }),
    ];

    const state = replayTaskMessagePatchEvents(events, {
      sessionId: "session-1",
      phaseId: "phase-a",
    });
    expect(state.textById.get("assistant-1")).toBe("legacy");
  });

  it("replayPhaseLiveAssistantState merges across multiple phase sessions", () => {
    const events: TaskMessagePatchEvent[] = [
      createAssistantPatchEvent({
        eventId: "event-session-2-delta",
        kind: "assistant-delta",
        rawEventKind: "task.message.delta",
        messageId: "assistant-2",
        textDelta: "second",
        phaseId: "phase-a",
        sessionId: "session-2",
      }),
      createAssistantPatchEvent({
        eventId: "event-session-2-start",
        kind: "assistant-progress",
        messageId: "assistant-2",
        createdAt: "2026-04-17T01:00:10.000Z",
        phaseId: "phase-a",
        sessionId: "session-2",
      }),
      createAssistantPatchEvent({
        eventId: "event-session-1-delta",
        kind: "assistant-delta",
        rawEventKind: "task.message.delta",
        messageId: "assistant-1",
        textDelta: "first",
        phaseId: "phase-a",
        sessionId: "session-1",
      }),
      createAssistantPatchEvent({
        eventId: "event-session-1-start",
        kind: "assistant-progress",
        messageId: "assistant-1",
        createdAt: "2026-04-17T01:00:00.000Z",
        phaseId: "phase-a",
        sessionId: "session-1",
      }),
    ];

    const merged = replayPhaseLiveAssistantState(events, {
      phaseId: "phase-a",
      sessionIds: ["session-1", "session-2"],
    });

    expect(merged.orderedAssistantMessageIds).toEqual(["assistant-1", "assistant-2"]);
    expect(merged.textById.get("assistant-1")).toBe("first");
    expect(merged.textById.get("assistant-2")).toBe("second");
  });

  it("replayPhaseLiveAssistantState ignores patches belonging to a different phase", () => {
    const events: TaskMessagePatchEvent[] = [
      createAssistantPatchEvent({
        eventId: "event-phase-b-delta",
        kind: "assistant-delta",
        rawEventKind: "task.message.delta",
        messageId: "assistant-2",
        textDelta: "b-text",
        phaseId: "phase-b",
        sessionId: "session-1",
      }),
      createAssistantPatchEvent({
        eventId: "event-phase-a-delta",
        kind: "assistant-delta",
        rawEventKind: "task.message.delta",
        messageId: "assistant-1",
        textDelta: "a-text",
        phaseId: "phase-a",
        sessionId: "session-1",
      }),
    ];

    const merged = replayPhaseLiveAssistantState(events, {
      phaseId: "phase-a",
      sessionIds: ["session-1"],
    });

    expect(merged.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(merged.textById.get("assistant-1")).toBe("a-text");
    expect(merged.textById.has("assistant-2")).toBe(false);
  });

  it("mergeLiveAssistantStates keeps the longest streaming text per message", () => {
    const first = createEmptyLiveAssistantState();
    first.orderedAssistantMessageIds.push("assistant-1");
    first.textById.set("assistant-1", "short");

    const second = createEmptyLiveAssistantState();
    second.orderedAssistantMessageIds.push("assistant-1");
    second.textById.set("assistant-1", "short+more");

    const merged = mergeLiveAssistantStates([first, second]);
    expect(merged.orderedAssistantMessageIds).toEqual(["assistant-1"]);
    expect(merged.textById.get("assistant-1")).toBe("short+more");
  });
});