import { describe, expect, it } from "vitest";
import { createEmptyLiveAssistantState, type TaskConversationMessageItem } from "./message-normalize";
import {
  buildTaskConversationDisplayMessages,
  buildTaskConversationRenderState,
} from "./task-conversation-display";

function createAssistantItem(overrides?: Partial<TaskConversationMessageItem>): TaskConversationMessageItem {
  return {
    key: overrides?.key ?? "assistant-1",
    role: "assistant",
    text: overrides?.text ?? "persisted reply",
    toolCalls: overrides?.toolCalls ?? [],
    createdAt: overrides?.createdAt ?? "2026-04-08T03:18:17.218Z",
    raw: overrides?.raw ?? {},
    isStreaming: overrides?.isStreaming,
    agent: overrides?.agent,
    model: overrides?.model,
    status: overrides?.status,
    errorText: overrides?.errorText,
    thinkingText: overrides?.thinkingText,
    userInputText: overrides?.userInputText,
    finalSentText: overrides?.finalSentText,
  };
}

describe("task conversation display", () => {
  it("overlays live assistant text onto a persisted assistant item while authority is realtime", () => {
    const liveState = createEmptyLiveAssistantState();
    liveState.orderedAssistantMessageIds = ["assistant-1"];
    liveState.textById.set("assistant-1", "live reply extended");
    liveState.incompleteIds.add("assistant-1");

    const items = buildTaskConversationDisplayMessages({
      persistedItems: [createAssistantItem()],
      liveAssistantState: liveState,
      authority: "realtime",
      pendingAssistantDraft: null,
      activeSessionId: "session-1",
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "assistant-1",
      text: "live reply extended",
      isStreaming: true,
    });
  });

  it("does not overlay live assistant text once display authority is persisted", () => {
    const liveState = createEmptyLiveAssistantState();
    liveState.orderedAssistantMessageIds = ["assistant-1"];
    liveState.textById.set("assistant-1", "live reply extended");
    liveState.incompleteIds.add("assistant-1");

    const items = buildTaskConversationDisplayMessages({
      persistedItems: [createAssistantItem()],
      liveAssistantState: liveState,
      authority: "persisted",
      pendingAssistantDraft: null,
      activeSessionId: "session-1",
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "assistant-1",
      text: "persisted reply",
      isStreaming: undefined,
    });
  });

  it("creates a standalone streaming assistant draft when no persisted message exists yet", () => {
    const liveState = createEmptyLiveAssistantState();
    liveState.orderedAssistantMessageIds = ["assistant-2"];
    liveState.textById.set("assistant-2", "streaming reply");
    liveState.incompleteIds.add("assistant-2");

    const items = buildTaskConversationDisplayMessages({
      persistedItems: [],
      liveAssistantState: liveState,
      authority: "realtime",
      pendingAssistantDraft: null,
      activeSessionId: "session-1",
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "assistant-2",
      text: "streaming reply",
      isStreaming: true,
    });
  });

  it("creates a standalone streaming assistant draft from live thinking deltas", () => {
    const liveState = createEmptyLiveAssistantState();
    liveState.orderedAssistantMessageIds = ["assistant-3"];
    liveState.thinkingById.set("assistant-3", "先梳理 child session 的时序");
    liveState.incompleteIds.add("assistant-3");

    const items = buildTaskConversationDisplayMessages({
      persistedItems: [],
      liveAssistantState: liveState,
      authority: "realtime",
      pendingAssistantDraft: null,
      activeSessionId: "session-1",
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "assistant-3",
      thinkingText: "先梳理 child session 的时序",
      isStreaming: true,
    });
  });

  it("keeps a single assistant record while authority moves from realtime to persisted", () => {
    const liveState = createEmptyLiveAssistantState();
    liveState.orderedAssistantMessageIds = ["assistant-1"];
    liveState.textById.set("assistant-1", "live reply extended");
    liveState.incompleteIds.add("assistant-1");

    const realtimeState = buildTaskConversationRenderState({
      persistedItems: [createAssistantItem()],
      workflowItems: [],
      liveAssistantState: liveState,
      authority: "realtime",
      pendingAssistantDraft: null,
      activeSessionId: "session-1",
    });

    expect(realtimeState.orderedIds).toEqual(["assistant-1"]);
    expect(realtimeState.recordsById["assistant-1"]).toMatchObject({
      key: "assistant-1",
      kind: "message",
      authority: "realtime",
      renderStatus: "streaming",
      item: {
        key: "assistant-1",
        text: "live reply extended",
        isStreaming: true,
      },
    });

    const persistedState = buildTaskConversationRenderState({
      persistedItems: [
        createAssistantItem({
          key: "assistant-1",
          text: "persisted reply",
          createdAt: "2026-04-08T03:18:19.218Z",
        }),
      ],
      workflowItems: [],
      liveAssistantState: createEmptyLiveAssistantState(),
      authority: "persisted",
      pendingAssistantDraft: null,
      activeSessionId: "session-1",
    });

    expect(persistedState.orderedIds).toEqual(["assistant-1"]);
    expect(persistedState.recordsById["assistant-1"]).toMatchObject({
      key: "assistant-1",
      kind: "message",
      authority: "persisted",
      renderStatus: "persisted",
      item: {
        key: "assistant-1",
        text: "persisted reply",
      },
    });
  });
});