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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve,
  };
}

function buildMessage(args: {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  text: string;
  createdAt: string;
}) {
  return {
    id: args.id,
    sessionId: args.sessionId,
    taskId: "task-1",
    runtimeMessageId: args.id,
    role: args.role,
    status: "completed",
    messageIndex: 0,
    textContent: args.text,
    summaryText: args.text,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
    rawPayload: {
      info: {
        id: args.id,
        role: args.role,
        time: {
          created: args.createdAt,
          completed: args.createdAt,
        },
      },
      parts: [
        {
          type: "text",
          text: args.text,
        },
      ],
    },
    parts: [
      {
        id: `${args.id}:part:0`,
        messageId: args.id,
        partIndex: 0,
        type: "text",
        textContent: args.text,
        rawPayload: {
          type: "text",
          text: args.text,
        },
        createdAt: args.createdAt,
        updatedAt: args.createdAt,
      },
    ],
  };
}

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

  it("clears a terminal pending assistant draft even if later snapshot events arrive", async () => {
    const { composable } = mountComposable();
    await flushPromises();
    await nextTick();

    composable.seedPendingAssistantDraft("session-1");
    await nextTick();

    expect(composable.hasStreamingAssistant.value).toBe(true);
    expect(composable.conversationItems.value).toHaveLength(1);
    expect(String(composable.conversationItems.value[0]?.key)).toContain("pending-assistant:");

    taskMessageStoreState.latestTaskRefreshRequest.value = {
      eventId: "event-task-completed",
      reason: "task-completed",
      shouldRefreshMessages: true,
      shouldBumpTraceRefreshKey: false,
    };
    await nextTick();

    expect(composable.hasStreamingAssistant.value).toBe(false);
    expect(composable.conversationItems.value).toHaveLength(0);

    taskMessageStoreState.latestTaskRefreshRequest.value = {
      eventId: "event-session-updated",
      reason: "session-updated",
      shouldRefreshMessages: true,
      shouldBumpTraceRefreshKey: false,
    };
    await nextTick();

    expect(composable.hasStreamingAssistant.value).toBe(false);
    expect(composable.conversationItems.value).toHaveLength(0);
  });

  it("ignores stale task-wide responses after a newer session-scoped refresh", async () => {
    const taskWideResponse = createDeferred<{
      data: unknown[];
      meta: { sessionId?: string };
    }>();
    const scopedResponse = createDeferred<{
      data: unknown[];
      meta: { sessionId?: string };
    }>();

    getTaskMessagesMock
      .mockReset()
      .mockImplementationOnce(() => taskWideResponse.promise)
      .mockImplementationOnce(() => scopedResponse.promise);

    const { composable, sessionId } = mountComposableWithoutExplicitSession();

    expect(getTaskMessagesMock).toHaveBeenNthCalledWith(1, "task-1", {
      sessionId: undefined,
      includeLineage: undefined,
    });

    sessionId.value = "session-current";
    await nextTick();

    expect(getTaskMessagesMock).toHaveBeenNthCalledWith(2, "task-1", {
      sessionId: "session-current",
      includeLineage: undefined,
    });

    scopedResponse.resolve({
      data: [
        buildMessage({
          id: "assistant-current",
          sessionId: "session-current",
          role: "assistant",
          text: "current-session reply",
          createdAt: "2026-04-10T08:00:00.000Z",
        }),
      ],
      meta: { sessionId: "session-current" },
    });
    await flushPromises();
    await nextTick();

    expect(composable.conversationItems.value).toMatchObject([
      {
        key: "assistant-current",
        role: "assistant",
        text: "current-session reply",
      },
    ]);
    expect(composable.trace.value?.sessionId).toBe("session-current");

    taskWideResponse.resolve({
      data: [
        buildMessage({
          id: "assistant-task-wide",
          sessionId: "session-task-wide",
          role: "assistant",
          text: "task-wide duplicate reply",
          createdAt: "2026-04-10T07:59:00.000Z",
        }),
      ],
      meta: {},
    });
    await flushPromises();
    await nextTick();

    expect(composable.conversationItems.value).toMatchObject([
      {
        key: "assistant-current",
        role: "assistant",
        text: "current-session reply",
      },
    ]);
    expect(
      composable.conversationItems.value.some(
        (item) => item.role === "assistant" && item.text === "task-wide duplicate reply",
      ),
    ).toBe(false);
    expect(composable.trace.value?.sessionId).toBe("session-current");
  });
});