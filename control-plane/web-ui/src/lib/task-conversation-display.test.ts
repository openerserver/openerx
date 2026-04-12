import { describe, expect, it } from "vitest";
import { createEmptyLiveAssistantState, type TaskConversationMessageItem } from "./message-normalize";
import { buildTaskConversationDisplayMessages } from "./task-conversation-display";

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
});