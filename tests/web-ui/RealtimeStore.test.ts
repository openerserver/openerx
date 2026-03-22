import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getProjectTreeEvents: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    getProjectTreeEvents: apiMocks.getProjectTreeEvents,
  };
});

describe("useRealtimeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.getProjectTreeEvents.mockReset();
  });

  it("maps project tree message backfill into existing realtime message shape", async () => {
    const { useRealtimeStore } = await import("../../control-plane/web-ui/src/stores/realtime");
    const store = useRealtimeStore();

    apiMocks.getProjectTreeEvents.mockResolvedValue({
      items: [
        {
          id: "evt-1",
          projectId: "proj-1",
          nodeId: "node-1",
          taskId: "task-1",
          runtimeSessionId: "session-1",
          branchName: "branch-a",
          eventType: "session.message.snapshot",
          seq: 3,
          createdAt: "2026-03-21T10:00:00.000Z",
          payload: {
            messageId: "msg-1",
            role: "assistant",
            text: "backfilled assistant output",
          },
        },
      ],
      nextCursor: {
        after: "2026-03-21T10:00:00.000Z",
        afterId: "evt-1",
      },
      hasMore: false,
    });

    store.authToken = "token";
    await store.backfillProject("proj-1");

    expect(apiMocks.getProjectTreeEvents).toHaveBeenCalledWith("proj-1", {
      after: undefined,
      afterId: undefined,
      limit: 200,
    });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      id: "project-tree:evt-1",
      type: "message.updated",
      projectId: "proj-1",
      taskId: "task-1",
      sessionId: "session-1",
      data: {
        rawType: "message.updated",
        projectTreeEventType: "session.message.snapshot",
        projectTreeBackfill: true,
        delta: "backfilled assistant output",
        part: {
          type: "text",
          text: "backfilled assistant output",
          messageID: "msg-1",
        },
      },
    });
    expect(store.projectEventCursors["proj-1"]).toEqual({
      after: "2026-03-21T10:00:00.000Z",
      afterId: "evt-1",
    });
  });

  it("deduplicates backfilled events that have already been recorded", async () => {
    const { useRealtimeStore } = await import("../../control-plane/web-ui/src/stores/realtime");
    const store = useRealtimeStore();

    store.pushEvent({
      id: "project-tree:evt-1",
      type: "message.updated",
      ts: "2026-03-21T10:00:00.000Z",
      projectId: "proj-1",
      taskId: "task-1",
      sessionId: "session-1",
      data: {
        projectTreeEventId: "evt-1",
      },
    });

    apiMocks.getProjectTreeEvents.mockResolvedValue({
      items: [
        {
          id: "evt-1",
          projectId: "proj-1",
          nodeId: "node-1",
          taskId: "task-1",
          runtimeSessionId: "session-1",
          eventType: "session.message.snapshot",
          seq: 3,
          createdAt: "2026-03-21T10:00:00.000Z",
          payload: {
            messageId: "msg-1",
            role: "assistant",
            text: "backfilled assistant output",
          },
        },
      ],
      nextCursor: {
        after: "2026-03-21T10:00:00.000Z",
        afterId: "evt-1",
      },
      hasMore: false,
    });

    store.authToken = "token";
    await store.backfillProject("proj-1");

    expect(store.events).toHaveLength(1);
    expect(store.projectEventCursors["proj-1"]).toEqual({
      after: "2026-03-21T10:00:00.000Z",
      afterId: "evt-1",
    });
  });
});
