import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, effectScope, ref } from "vue";
import { useTaskDetailCoreContext } from "../../control-plane/web-ui/src/composables/useTaskDetailCoreContext";

const mockState = vi.hoisted(() => ({
  patchEvents: [] as any[],
  patchSignature: null as { value: string } | null,
  applyPersistenceAck: vi.fn(),
  clearPendingAssistantDraft: vi.fn(),
  seedPendingAssistantDraft: vi.fn(),
  refreshTask: vi.fn(async () => undefined),
  refreshSessions: vi.fn(async () => undefined),
  taskStatusSync: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/composables/useProjectTreeTask", () => ({
  useProjectTreeTask: () => ({
    task: ref({ id: "task-1", status: "running" }),
    node: ref({ id: "task-node-1" }),
    ancestors: ref([]),
    projectId: ref("proj-1"),
    loading: ref(false),
    error: ref(null),
    refresh: mockState.refreshTask,
  }),
}));

vi.mock("../../control-plane/web-ui/src/composables/useTreeBranches", () => ({
  useTreeBranches: () => ({
    currentSessionId: ref("session-current"),
    currentPhaseId: ref("phase-current"),
    flatNodes: ref([]),
    sessionSummaries: ref([]),
    selectedNode: ref(null),
    refresh: mockState.refreshSessions,
  }),
}));

vi.mock("../../control-plane/web-ui/src/composables/useTaskMessagePatchConsumer", async () => {
  const { computed, ref } = await import("vue");
  mockState.patchSignature ??= ref("sig-0");
  return {
    useTaskMessagePatchConsumer: () => ({
      taskPatchEventSignature: computed(() => mockState.patchSignature?.value ?? "sig-0"),
      getTaskPatchEvents: () => mockState.patchEvents,
    }),
  };
});

vi.mock("../../control-plane/web-ui/src/composables/useTaskMessageSnapshot", () => ({
  useTaskMessageSnapshot: () => ({
    activeSessionId: ref("session-current"),
    applyPersistenceAck: mockState.applyPersistenceAck,
    error: ref(null),
    hasOlderHistory: ref(false),
    historyLoading: ref(false),
    loadOlderHistory: vi.fn(async () => undefined),
    loading: ref(false),
    phaseSlices: ref([
      {
        phase: { id: "phase-current", phaseIndex: 2 },
        sourceMessages: [],
        resolvedSessionId: "session-current",
      },
    ]),
    refresh: vi.fn(async () => undefined),
    refreshCurrentPhase: vi.fn(async () => undefined),
    resolvedSessionId: ref("session-current"),
    sourceMessages: ref([]),
    trace: ref({
      timelineMeta: {
        reconcileRequired: false,
        persistedThroughRevision: 1,
        snapshotVersion: 1,
      },
    }),
  }),
}));

vi.mock("../../control-plane/web-ui/src/composables/useTaskMessageStore", () => ({
  useTaskMessageStore: () => ({
    clearPendingAssistantDraft: mockState.clearPendingAssistantDraft,
    conversationItems: ref([
      {
        key: "assistant-current",
        role: "assistant",
        text: "当前阶段回复",
        toolCalls: [],
        createdAt: "2026-04-16T10:00:00.000Z",
        raw: null,
        isStreaming: false,
      },
    ]),
    hasStreamingAssistant: ref(false),
    latestPersistenceAck: ref(null),
    latestTaskRefreshRequest: ref(null),
    needsMessagePollingFallback: ref(false),
    realtimeConnected: ref(true),
    seedPendingAssistantDraft: mockState.seedPendingAssistantDraft,
  }),
}));

vi.mock("../../control-plane/web-ui/src/composables/useTaskDetailTaskStatusSync", () => ({
  useTaskDetailTaskStatusSync: mockState.taskStatusSync,
}));

describe("useTaskDetailCoreContext", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
    mockState.patchEvents = [];
    if (mockState.patchSignature) {
      mockState.patchSignature.value = "sig-0";
    }
    mockState.applyPersistenceAck.mockReset();
    mockState.clearPendingAssistantDraft.mockReset();
    mockState.seedPendingAssistantDraft.mockReset();
    mockState.refreshTask.mockReset();
    mockState.refreshSessions.mockReset();
    mockState.taskStatusSync.mockReset();
  });

  async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("forwards older-phase persistence acks from the task patch feed into snapshot ownership", async () => {
    scope = effectScope();
    const context = scope.run(() => useTaskDetailCoreContext(ref("task-1")));
    if (!context) {
      throw new Error("expected task detail core context");
    }

    await flushPromises();

    mockState.patchEvents = [
      {
        eventId: "event-user-old-phase",
        taskId: "task-1",
        phaseId: "phase-old",
        sessionId: "session-old",
        rawEventKind: "task.message.updated",
        kind: "user-message",
        messageId: "msg-old-user",
        rawMessage: {
          id: "msg-old-user",
          role: "user",
          text: "旧阶段补充问题",
          createdAt: "2026-04-16T10:00:01.000Z",
        },
      },
      {
        eventId: "event-round-synced-old-phase",
        taskId: "task-1",
        phaseId: "phase-old",
        sessionId: "session-old",
        rawEventKind: "task.round.synced",
        kind: "round-synced",
        roundId: "session-old",
        taskSessionId: "task-session:task-1:session-old",
        snapshotVersion: 8,
        persistedThroughRevision: 8,
      },
    ];
    if (!mockState.patchSignature) {
      throw new Error("expected patch signature ref");
    }
    mockState.patchSignature.value = "sig-1";

    await flushPromises();

    expect(mockState.applyPersistenceAck).toHaveBeenCalledTimes(1);
    expect(mockState.applyPersistenceAck).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-round-synced-old-phase",
        kind: "round-synced",
        phaseId: "phase-old",
        sessionId: "session-old",
        taskSessionId: "task-session:task-1:session-old",
        snapshotVersion: 8,
        persistedThroughRevision: 8,
      }),
      expect.objectContaining({
        realtimeSourceMessagesByPhaseId: expect.objectContaining({
          "phase-old": [
            expect.objectContaining({
              id: "msg-old-user",
              text: "旧阶段补充问题",
            }),
          ],
        }),
        conversationItems: expect.arrayContaining([
          expect.objectContaining({ key: "assistant-current" }),
        ]),
      }),
    );
  });
});