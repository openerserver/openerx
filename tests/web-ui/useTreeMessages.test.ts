import { flushPromises } from "@vue/test-utils";
import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyLiveAssistantState } from "../../control-plane/web-ui/src/lib/message-normalize";
import { useTreeMessages } from "../../control-plane/web-ui/src/composables/useTreeMessages";

const getTaskMessagesMock = vi.hoisted(() => vi.fn());
const taskMessageStoreState = vi.hoisted(() => ({
  latestTaskRefreshRequest: null as any,
  liveAssistantState: null as any,
  realtimeConnected: null as any,
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../control-plane/web-ui/src/lib/api")
  >();
  return {
    ...actual,
    getTaskMessages: getTaskMessagesMock,
  };
});

vi.mock("../../control-plane/web-ui/src/composables/useTaskMessageStore", () => ({
  useTaskMessageStore: () => ({
    latestTaskRefreshRequest: taskMessageStoreState.latestTaskRefreshRequest,
    liveAssistantState: taskMessageStoreState.liveAssistantState,
    realtimeConnected: taskMessageStoreState.realtimeConnected,
  }),
}));

describe("useTreeMessages", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    getTaskMessagesMock.mockResolvedValue({
      data: [],
      meta: {
        sessionId: "session-1",
      },
    });
    taskMessageStoreState.latestTaskRefreshRequest = ref(null);
    taskMessageStoreState.liveAssistantState = ref(createEmptyLiveAssistantState());
    taskMessageStoreState.realtimeConnected = ref(true);
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountComposable() {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    scope = effectScope();
    const composable = scope.run(() => useTreeMessages(taskId, sessionId));
    if (!composable) {
      throw new Error("expected useTreeMessages composable");
    }

    return {
      composable,
      sessionId,
      taskId,
    };
  }

  function mountComposableWithoutExplicitSession() {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>(undefined);
    scope = effectScope();
    const composable = scope.run(() => useTreeMessages(taskId, sessionId));
    if (!composable) {
      throw new Error("expected useTreeMessages composable");
    }

    return {
      composable,
      sessionId,
      taskId,
    };
  }

  it("shows a pending assistant draft immediately after seeding", async () => {
    const { composable } = mountComposable();
    await flushPromises();
    await nextTick();

    composable.seedPendingAssistantDraft("session-1");
    await nextTick();

    expect(composable.hasStreamingAssistant.value).toBe(true);
    expect(composable.conversationItems.value).toHaveLength(1);
    expect(composable.conversationItems.value[0]).toMatchObject({
      role: "assistant",
      text: "正在生成...",
      isStreaming: true,
    });
    expect(String(composable.conversationItems.value[0]?.key)).toContain("pending-assistant:");
  });

  it("uses the backend-resolved session when no explicit session is selected", async () => {
    const { composable } = mountComposableWithoutExplicitSession();
    await flushPromises();
    await nextTick();

    composable.seedPendingAssistantDraft("session-1");
    await nextTick();

    expect(composable.hasStreamingAssistant.value).toBe(true);
    expect(composable.conversationItems.value).toHaveLength(1);
    expect(composable.conversationItems.value[0]).toMatchObject({
      role: "assistant",
      text: "正在生成...",
      isStreaming: true,
    });
  });

  it("replaces the optimistic pending draft once a real assistant message starts", async () => {
    const { composable } = mountComposable();
    await flushPromises();
    await nextTick();

    composable.seedPendingAssistantDraft("session-1");
    await nextTick();

    const liveState = createEmptyLiveAssistantState();
    liveState.orderedAssistantMessageIds.push("assistant-1");
    liveState.metaById.set("assistant-1", {
      createdAt: "2026-04-08T03:18:17.218Z",
    });
    liveState.incompleteIds.add("assistant-1");
    taskMessageStoreState.liveAssistantState.value = liveState;

    await nextTick();

    expect(composable.conversationItems.value).toHaveLength(1);
    expect(composable.conversationItems.value[0]).toMatchObject({
      key: "assistant-1",
      role: "assistant",
      isStreaming: true,
    });
  });
});