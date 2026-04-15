import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { useTaskMessageSnapshot } from "../../control-plane/web-ui/src/composables/useTaskMessageSnapshot";

const apiMocks = vi.hoisted(() => ({
  getCurrentTaskRound: vi.fn(),
  getTaskRounds: vi.fn(),
  getTaskRoundMessages: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    getCurrentTaskRound: apiMocks.getCurrentTaskRound,
    getTaskRounds: apiMocks.getTaskRounds,
    getTaskRoundMessages: apiMocks.getTaskRoundMessages,
  };
});

describe("useTaskMessageSnapshot", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
    vi.clearAllMocks();
  });

  async function mountSnapshot(options?: {
    sessionId?: string;
    includeLineage?: boolean;
  }) {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>(options?.sessionId);
    scope = effectScope();
    const state = scope.run(() =>
      useTaskMessageSnapshot(taskId, sessionId, {
        includeLineage: options?.includeLineage,
      }),
    );
    if (!state) {
      throw new Error("expected task message snapshot state");
    }

    await flushPromises();
    await flushPromises();

    return state;
  }

  it("uses current round and round messages when no session is selected", async () => {
    apiMocks.getCurrentTaskRound.mockResolvedValue({
      taskId: "task-1",
      round: {
        id: "task-session:task-1:ses-history",
        taskId: "task-1",
        sessionId: "task-session:task-1:ses-history",
        kind: "continue",
        source: "continue",
        status: "completed",
        promptText: "旧问题",
        createdAt: "2026-04-13T08:00:00.000Z",
        updatedAt: "2026-04-13T08:00:01.000Z",
      },
    });
    apiMocks.getTaskRoundMessages.mockResolvedValue({
      taskId: "task-1",
      round: {
        id: "task-session:task-1:ses-history",
        taskId: "task-1",
        sessionId: "task-session:task-1:ses-history",
        kind: "continue",
        source: "continue",
        status: "completed",
        promptText: "旧问题",
        createdAt: "2026-04-13T08:00:00.000Z",
        updatedAt: "2026-04-13T08:00:01.000Z",
      },
      messages: [
        {
          id: "history-user",
          roundId: "task-session:task-1:ses-history",
          sessionId: "ses-history",
          role: "user",
          status: "completed",
          text: "旧问题",
          parts: [],
          createdAt: "2026-04-13T08:00:00.000Z",
          updatedAt: "2026-04-13T08:00:00.000Z",
        },
        {
          id: "history-assistant",
          roundId: "task-session:task-1:ses-history",
          sessionId: "ses-history",
          role: "assistant",
          status: "completed",
          text: "旧回复",
          parts: [],
          createdAt: "2026-04-13T08:00:01.000Z",
          updatedAt: "2026-04-13T08:00:01.000Z",
        },
      ],
      snapshotVersion: 19,
      persistedThroughRevision: 11,
    });

    const state = await mountSnapshot({ includeLineage: true });

    expect(apiMocks.getCurrentTaskRound).toHaveBeenCalledWith("task-1");
    expect(apiMocks.getTaskRounds).not.toHaveBeenCalled();
    expect(apiMocks.getTaskRoundMessages).toHaveBeenCalledWith(
      "task-1",
      "task-session:task-1:ses-history",
    );
    expect(state.sourceMessages.value).toEqual([
      expect.objectContaining({ id: "history-user", role: "user" }),
      expect.objectContaining({ id: "history-assistant", role: "assistant" }),
    ]);
    expect(state.resolvedSessionId.value).toBe("ses-history");
    expect(state.trace.value?.timelineMeta).toEqual(
      expect.objectContaining({
        readSource: "task-domain-projection",
        includeLineage: false,
        itemCount: 2,
        snapshotVersion: 19,
        persistedThroughRevision: 11,
        reconcileRequired: false,
      }),
    );
  });

  it("keeps selected-session reads on the round messages API", async () => {
    apiMocks.getCurrentTaskRound.mockRejectedValue(new Error("should not load current round"));
    apiMocks.getTaskRounds.mockRejectedValue(new Error("should not load rounds"));
    apiMocks.getTaskRoundMessages.mockResolvedValue({
      taskId: "task-1",
      round: {
        id: "task-session:task-1:ses-child",
        taskId: "task-1",
        sessionId: "task-session:task-1:ses-child",
        kind: "continue",
        source: "continue",
        status: "completed",
        promptText: "继续",
        createdAt: "2026-04-13T08:00:00.000Z",
        updatedAt: "2026-04-13T08:00:01.000Z",
      },
      messages: [
        {
          id: "round-message-1",
          roundId: "task-session:task-1:ses-child",
          sessionId: "ses-child",
          role: "assistant",
          status: "completed",
          text: "当前轮次回复",
          parts: [],
          createdAt: "2026-04-13T08:00:01.000Z",
          updatedAt: "2026-04-13T08:00:01.000Z",
        },
      ],
      snapshotVersion: 3,
      persistedThroughRevision: 3,
    });

    const state = await mountSnapshot({ sessionId: "ses-child" });

    expect(apiMocks.getTaskRoundMessages).toHaveBeenCalledWith("task-1", "ses-child");
    expect(apiMocks.getCurrentTaskRound).not.toHaveBeenCalled();
    expect(apiMocks.getTaskRounds).not.toHaveBeenCalled();
    expect(state.resolvedSessionId.value).toBe("ses-child");
    expect(state.sourceMessages.value).toEqual([
      expect.objectContaining({
        id: "round-message-1",
        role: "assistant",
        text: "当前轮次回复",
      }),
    ]);
    expect(state.trace.value?.timelineMeta).toMatchObject({
      includeLineage: false,
      roundId: "task-session:task-1:ses-child",
      snapshotVersion: 3,
      persistedThroughRevision: 3,
    });
  });

  it("returns an empty round-native snapshot when no current round exists", async () => {
    apiMocks.getCurrentTaskRound.mockResolvedValue({
      taskId: "task-1",
      round: null,
    });

    const state = await mountSnapshot();

    expect(apiMocks.getCurrentTaskRound).toHaveBeenCalledWith("task-1");
    expect(apiMocks.getTaskRoundMessages).not.toHaveBeenCalled();
    expect(state.sourceMessages.value).toEqual([]);
    expect(state.resolvedSessionId.value).toBeUndefined();
    expect(state.trace.value?.timelineMeta).toMatchObject({
      includeLineage: false,
      itemCount: 0,
      snapshotVersion: 0,
      persistedThroughRevision: 0,
    });
  });

  it("keeps the previous round above the latest round after continue creates a new current round", async () => {
    apiMocks.getCurrentTaskRound
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: {
          id: "task-session:task-1:ses-round-1",
          taskId: "task-1",
          sessionId: "task-session:task-1:ses-round-1",
          parentRoundId: "task-session:task-1:ses-root",
          parentSessionId: "task-session:task-1:ses-root",
          kind: "continue",
          source: "continue",
          status: "completed",
          promptText: "第一轮问题",
          createdAt: "2026-04-13T08:00:00.000Z",
          updatedAt: "2026-04-13T08:00:01.000Z",
        },
      })
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: {
          id: "task-session:task-1:ses-round-2",
          taskId: "task-1",
          sessionId: "task-session:task-1:ses-round-2",
          parentRoundId: "task-session:task-1:ses-round-1",
          parentSessionId: "task-session:task-1:ses-round-1",
          kind: "continue",
          source: "continue",
          status: "running",
          promptText: "第二轮问题",
          createdAt: "2026-04-13T08:10:00.000Z",
          updatedAt: "2026-04-13T08:10:01.000Z",
        },
      });
    apiMocks.getTaskRoundMessages
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: {
          id: "task-session:task-1:ses-round-1",
          taskId: "task-1",
          sessionId: "task-session:task-1:ses-round-1",
          parentRoundId: "task-session:task-1:ses-root",
          parentSessionId: "task-session:task-1:ses-root",
          kind: "continue",
          source: "continue",
          status: "completed",
          promptText: "第一轮问题",
          createdAt: "2026-04-13T08:00:00.000Z",
          updatedAt: "2026-04-13T08:00:01.000Z",
        },
        messages: [
          {
            id: "round-1-user",
            roundId: "task-session:task-1:ses-round-1",
            sessionId: "ses-round-1",
            role: "user",
            status: "completed",
            text: "第一轮问题",
            parts: [],
            createdAt: "2026-04-13T08:00:00.000Z",
            updatedAt: "2026-04-13T08:00:00.000Z",
          },
          {
            id: "round-1-assistant",
            roundId: "task-session:task-1:ses-round-1",
            sessionId: "ses-round-1",
            role: "assistant",
            status: "completed",
            text: "第一轮回复",
            parts: [],
            createdAt: "2026-04-13T08:00:01.000Z",
            updatedAt: "2026-04-13T08:00:01.000Z",
          },
        ],
        snapshotVersion: 11,
        persistedThroughRevision: 11,
      })
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: {
          id: "task-session:task-1:ses-round-2",
          taskId: "task-1",
          sessionId: "task-session:task-1:ses-round-2",
          parentRoundId: "task-session:task-1:ses-round-1",
          parentSessionId: "task-session:task-1:ses-round-1",
          kind: "continue",
          source: "continue",
          status: "running",
          promptText: "第二轮问题",
          createdAt: "2026-04-13T08:10:00.000Z",
          updatedAt: "2026-04-13T08:10:01.000Z",
        },
        messages: [
          {
            id: "round-2-user",
            roundId: "task-session:task-1:ses-round-2",
            sessionId: "ses-round-2",
            role: "user",
            status: "completed",
            text: "第二轮问题",
            parts: [],
            createdAt: "2026-04-13T08:10:00.000Z",
            updatedAt: "2026-04-13T08:10:00.000Z",
          },
          {
            id: "round-2-assistant",
            roundId: "task-session:task-1:ses-round-2",
            sessionId: "ses-round-2",
            role: "assistant",
            status: "streaming",
            text: "第二轮回复",
            parts: [],
            createdAt: "2026-04-13T08:10:01.000Z",
            updatedAt: "2026-04-13T08:10:01.000Z",
          },
        ],
        snapshotVersion: 19,
        persistedThroughRevision: 17,
      });

    const state = await mountSnapshot();

    await state.refresh(true);
    await flushPromises();

    expect(state.sourceMessages.value.map((item) => (item as { id: string }).id)).toEqual([
      "round-1-user",
      "round-1-assistant",
      "round-2-user",
      "round-2-assistant",
    ]);
    expect(state.resolvedSessionId.value).toBe("ses-round-2");
    expect(state.hasOlderHistory.value).toBe(true);
    expect(state.trace.value?.timelineMeta).toMatchObject({
      roundId: "task-session:task-1:ses-round-2",
      snapshotVersion: 19,
      persistedThroughRevision: 17,
      itemCount: 4,
    });
  });

  it("prepends older parent rounds when loading history upwards", async () => {
    apiMocks.getCurrentTaskRound.mockResolvedValue({
      taskId: "task-1",
      round: {
        id: "task-session:task-1:ses-round-2",
        taskId: "task-1",
        sessionId: "task-session:task-1:ses-round-2",
        parentRoundId: "task-session:task-1:ses-round-1",
        parentSessionId: "task-session:task-1:ses-round-1",
        kind: "continue",
        source: "continue",
        status: "completed",
        promptText: "第二轮问题",
        createdAt: "2026-04-13T08:10:00.000Z",
        updatedAt: "2026-04-13T08:10:01.000Z",
      },
    });
    apiMocks.getTaskRoundMessages
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: {
          id: "task-session:task-1:ses-round-2",
          taskId: "task-1",
          sessionId: "task-session:task-1:ses-round-2",
          parentRoundId: "task-session:task-1:ses-round-1",
          parentSessionId: "task-session:task-1:ses-round-1",
          kind: "continue",
          source: "continue",
          status: "completed",
          promptText: "第二轮问题",
          createdAt: "2026-04-13T08:10:00.000Z",
          updatedAt: "2026-04-13T08:10:01.000Z",
        },
        messages: [
          {
            id: "round-2-user",
            roundId: "task-session:task-1:ses-round-2",
            sessionId: "ses-round-2",
            role: "user",
            status: "completed",
            text: "第二轮问题",
            parts: [],
            createdAt: "2026-04-13T08:10:00.000Z",
            updatedAt: "2026-04-13T08:10:00.000Z",
          },
          {
            id: "round-2-assistant",
            roundId: "task-session:task-1:ses-round-2",
            sessionId: "ses-round-2",
            role: "assistant",
            status: "completed",
            text: "第二轮回复",
            parts: [],
            createdAt: "2026-04-13T08:10:01.000Z",
            updatedAt: "2026-04-13T08:10:01.000Z",
          },
        ],
        snapshotVersion: 8,
        persistedThroughRevision: 8,
      })
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: {
          id: "task-session:task-1:ses-round-1",
          taskId: "task-1",
          sessionId: "task-session:task-1:ses-round-1",
          parentRoundId: null,
          parentSessionId: null,
          kind: "continue",
          source: "continue",
          status: "completed",
          promptText: "第一轮问题",
          createdAt: "2026-04-13T08:00:00.000Z",
          updatedAt: "2026-04-13T08:00:01.000Z",
        },
        messages: [
          {
            id: "round-1-user",
            roundId: "task-session:task-1:ses-round-1",
            sessionId: "ses-round-1",
            role: "user",
            status: "completed",
            text: "第一轮问题",
            parts: [],
            createdAt: "2026-04-13T08:00:00.000Z",
            updatedAt: "2026-04-13T08:00:00.000Z",
          },
          {
            id: "round-1-assistant",
            roundId: "task-session:task-1:ses-round-1",
            sessionId: "ses-round-1",
            role: "assistant",
            status: "completed",
            text: "第一轮回复",
            parts: [],
            createdAt: "2026-04-13T08:00:01.000Z",
            updatedAt: "2026-04-13T08:00:01.000Z",
          },
        ],
        snapshotVersion: 5,
        persistedThroughRevision: 5,
      });

    const state = await mountSnapshot();

    expect(state.hasOlderHistory.value).toBe(true);
    expect(state.historyLoading.value).toBe(false);

    const loadPromise = state.loadOlderHistory();
    expect(state.historyLoading.value).toBe(true);

    await loadPromise;
    await flushPromises();

    expect(state.historyLoading.value).toBe(false);
    expect(state.hasOlderHistory.value).toBe(false);
    expect(state.sourceMessages.value.map((item) => (item as { id: string }).id)).toEqual([
      "round-1-user",
      "round-1-assistant",
      "round-2-user",
      "round-2-assistant",
    ]);
    expect(apiMocks.getTaskRoundMessages).toHaveBeenNthCalledWith(
      2,
      "task-1",
      "task-session:task-1:ses-round-1",
    );
  });
});