import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskMessageSnapshot } from "../../control-plane/web-ui/src/composables/useTaskMessageSnapshot";

const apiMocks = vi.hoisted(() => ({
  getCurrentTaskRound: vi.fn(),
  getTaskRoundMessages: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => ({
  getCurrentTaskRound: apiMocks.getCurrentTaskRound,
  getTaskRoundMessages: apiMocks.getTaskRoundMessages,
}));

function createRound(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "task-session:task-1:session-1",
    taskId: "task-1",
    sessionId: "session-1",
    kind: "continue",
    source: "continue",
    status: "completed",
    promptText: "Summarize progress",
    createdAt: "2026-04-08T03:18:17.218Z",
    updatedAt: "2026-04-08T03:18:24.437Z",
    ...overrides,
  };
}

function createAssistantMessage(args: {
  id: string;
  roundId: string;
  sessionId: string;
  text: string;
  createdAt: string;
  completedAt: string;
}) {
  return {
    id: args.id,
    roundId: args.roundId,
    sessionId: args.sessionId,
    role: "assistant",
    status: "completed",
    text: args.text,
    parts: [
      {
        id: `part-${args.id}`,
        partIndex: 0,
        partType: "text",
        text: args.text,
      },
    ],
    createdAt: args.createdAt,
    updatedAt: args.completedAt,
    completedAt: args.completedAt,
  };
}

describe("useTaskMessageSnapshot history continuity", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    apiMocks.getCurrentTaskRound.mockReset();
    apiMocks.getTaskRoundMessages.mockReset();
    apiMocks.getCurrentTaskRound.mockResolvedValue({
      taskId: "task-1",
      round: createRound(),
    });
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  it("keeps loaded lineage history when the active session advances to a child round", async () => {
    apiMocks.getTaskRoundMessages
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: createRound({
          id: "task-session:task-1:session-1",
          sessionId: "session-1",
          parentRoundId: "task-session:task-1:session-root",
        }),
        messages: [
          createAssistantMessage({
            id: "assistant-current",
            roundId: "task-session:task-1:session-1",
            sessionId: "session-1",
            text: "current reply",
            createdAt: "2026-04-08T03:18:19.218Z",
            completedAt: "2026-04-08T03:18:24.437Z",
          }),
        ],
        snapshotVersion: 2,
        persistedThroughRevision: 2,
      })
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: createRound({
          id: "task-session:task-1:session-root",
          sessionId: "session-root",
          parentRoundId: undefined,
        }),
        messages: [
          createAssistantMessage({
            id: "assistant-root",
            roundId: "task-session:task-1:session-root",
            sessionId: "session-root",
            text: "root reply",
            createdAt: "2026-04-08T03:18:10.218Z",
            completedAt: "2026-04-08T03:18:12.437Z",
          }),
        ],
        snapshotVersion: 1,
        persistedThroughRevision: 1,
      })
      .mockResolvedValueOnce({
        taskId: "task-1",
        round: createRound({
          id: "task-session:task-1:session-2",
          sessionId: "session-2",
          parentRoundId: "task-session:task-1:session-1",
        }),
        messages: [
          createAssistantMessage({
            id: "assistant-child",
            roundId: "task-session:task-1:session-2",
            sessionId: "session-2",
            text: "child reply",
            createdAt: "2026-04-08T03:18:30.218Z",
            completedAt: "2026-04-08T03:18:36.437Z",
          }),
        ],
        snapshotVersion: 3,
        persistedThroughRevision: 3,
      });

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("session-1");
    scope = effectScope();
    const snapshot = scope.run(() => useTaskMessageSnapshot(taskId, sessionId));
    if (!snapshot) {
      throw new Error("expected message snapshot");
    }

    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(snapshot.sourceMessages.value.map((item: any) => item.text)).toEqual(["current reply"]);

    await snapshot.loadOlderHistory();
    await Promise.resolve();
    await nextTick();

    expect(apiMocks.getTaskRoundMessages).toHaveBeenNthCalledWith(2, "task-1", "task-session:task-1:session-root");
    expect(snapshot.sourceMessages.value.map((item: any) => item.text)).toEqual([
      "root reply",
      "current reply",
    ]);

    sessionId.value = "session-2";
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(snapshot.sourceMessages.value.map((item: any) => item.text)).toEqual([
      "root reply",
      "current reply",
      "child reply",
    ]);
  });
});
