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
});