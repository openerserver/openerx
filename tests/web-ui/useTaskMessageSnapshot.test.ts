import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import type { TaskPhaseRecord } from "../../control-plane/web-ui/src/lib/api";
import { normalizeSessionConversationItems } from "../../control-plane/web-ui/src/lib/message-normalize";
import { useTaskMessageSnapshot } from "../../control-plane/web-ui/src/composables/useTaskMessageSnapshot";

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

const apiMocks = vi.hoisted(() => ({
  getTaskPhases: vi.fn(),
  getTaskPhaseView: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    getTaskPhases: apiMocks.getTaskPhases,
    getTaskPhaseView: apiMocks.getTaskPhaseView,
  };
});

function createPhase(overrides?: Partial<TaskPhaseRecord>): TaskPhaseRecord {
  return {
    id: "phase-1",
    phaseIndex: 1,
    phaseKind: "single",
    triggerType: "continue",
    status: "completed",
    parentPhaseId: null,
    resumedFromPhaseId: null,
    awaitingAdoptionSince: null,
    anchorSessionId: null,
    coordinationKey: null,
    candidateCount: null,
    winnerSessionId: null,
    judgeSessionId: null,
    startedAt: "2026-04-13T08:00:00.000Z",
    finishedAt: "2026-04-13T08:00:01.000Z",
    createdAt: "2026-04-13T08:00:00.000Z",
    updatedAt: "2026-04-13T08:00:01.000Z",
    sessionIds: [],
    ...overrides,
  };
}

function createMessage(args: {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}) {
  return {
    id: args.id,
    sessionId: args.sessionId,
    role: args.role,
    status: "completed",
    text: args.text,
    parts: [],
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
  };
}

function createPhaseView(args: {
  phase: TaskPhaseRecord;
  currentSessionId?: string | null;
  sessions?: unknown[];
  messageGroups: Array<{
    taskSessionId?: string | null;
    runtimeSessionId?: string | null;
    phaseRole?: string | null;
    phaseItemIndex?: number | null;
    candidateIndex?: number | null;
    stepIndex?: number | null;
    title?: string | null;
    selectedModel?: string | null;
    executionStatus?: string | null;
    messages: unknown[];
  }>;
}) {
  const messageCount = args.messageGroups.reduce(
    (count, group) => count + (Array.isArray(group.messages) ? group.messages.length : 0),
    0,
  );
  return {
    data: {
      phase: args.phase,
      sessions: Array.isArray(args.sessions) ? args.sessions : [],
      messageGroups: args.messageGroups,
      meta: {
        currentSessionId: args.currentSessionId ?? null,
        currentPhaseId: args.phase.id,
        latestPhaseId: args.phase.id,
        phaseCount: 1,
        sessionCount: Array.isArray(args.sessions) ? args.sessions.length : 0,
        messageGroupCount: args.messageGroups.length,
        messageCount,
      },
    },
  };
}

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
    currentSessionId?: string | null;
    currentPhaseId?: string | null;
  }) {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>(options?.sessionId);
    const currentSessionId = ref<string | null>(options?.currentSessionId ?? null);
    const currentPhaseId = ref<string | null>(options?.currentPhaseId ?? null);
    scope = effectScope();
    const state = scope.run(() =>
      useTaskMessageSnapshot(taskId, sessionId, {
        includeLineage: options?.includeLineage,
        currentSessionId,
        currentPhaseId,
      }),
    );
    if (!state) {
      throw new Error("expected task message snapshot state");
    }

    await flushPromises();
    await flushPromises();

    return {
      currentPhaseId,
      currentSessionId,
      sessionId,
      state,
      taskId,
    };
  }

  it("uses explicit currentPhaseId and phase view when available", async () => {
    const phase1 = createPhase({
      id: "phase-1",
      phaseIndex: 1,
      sessionIds: ["task-session:task-1:ses-phase-1"],
    });
    const phase2 = createPhase({
      id: "phase-2",
      phaseIndex: 2,
      sessionIds: ["task-session:task-1:ses-phase-2"],
    });
    apiMocks.getTaskPhases.mockResolvedValue({ data: [phase1, phase2] });
    apiMocks.getTaskPhaseView.mockResolvedValue(
      createPhaseView({
        phase: phase2,
        currentSessionId: "ses-phase-2",
        messageGroups: [
          {
            runtimeSessionId: "ses-phase-2",
            phaseRole: "mainline",
            phaseItemIndex: 0,
            messages: [
              createMessage({
                id: "phase-2-user",
                sessionId: "ses-phase-2",
                role: "user",
                text: "第二阶段问题",
                createdAt: "2026-04-13T08:10:00.000Z",
              }),
              createMessage({
                id: "phase-2-assistant",
                sessionId: "ses-phase-2",
                role: "assistant",
                text: "第二阶段回复",
                createdAt: "2026-04-13T08:10:01.000Z",
              }),
            ],
          },
        ],
      }),
    );

    const { state } = await mountSnapshot({
      includeLineage: true,
      currentPhaseId: "phase-2",
      currentSessionId: "ses-phase-2",
    });

    expect(apiMocks.getTaskPhases).toHaveBeenCalledWith("task-1");
    expect(apiMocks.getTaskPhaseView).toHaveBeenCalledWith("task-1", "phase-2");
    expect(state.sourceMessages.value).toEqual([
      expect.objectContaining({ id: "phase-2-user", role: "user" }),
      expect.objectContaining({ id: "phase-2-assistant", role: "assistant" }),
    ]);
    expect(state.resolvedSessionId.value).toBe("ses-phase-2");
    expect(state.trace.value?.timelineMeta).toEqual(
      expect.objectContaining({
        readSource: "task-phase-first",
        includeLineage: false,
        itemCount: 2,
        snapshotVersion: 2,
        persistedThroughRevision: 2,
        reconcileRequired: false,
      }),
    );
  });

  it("falls back to the phase containing the selected session when currentPhaseId is absent", async () => {
    const rootPhase = createPhase({
      id: "phase-root",
      phaseIndex: 1,
      sessionIds: ["task-session:task-1:ses-root"],
    });
    const childPhase = createPhase({
      id: "phase-child",
      phaseIndex: 2,
      sessionIds: ["task-session:task-1:ses-child"],
    });
    apiMocks.getTaskPhases.mockResolvedValue({ data: [rootPhase, childPhase] });
    apiMocks.getTaskPhaseView.mockResolvedValue(
      createPhaseView({
        phase: childPhase,
        currentSessionId: "ses-child",
        messageGroups: [
          {
            runtimeSessionId: "ses-child",
            phaseRole: "mainline",
            phaseItemIndex: 0,
            messages: [
              createMessage({
                id: "child-message-1",
                sessionId: "ses-child",
                role: "assistant",
                text: "当前 phase 回复",
                createdAt: "2026-04-13T08:10:01.000Z",
              }),
            ],
          },
        ],
      }),
    );

    const { state } = await mountSnapshot({ sessionId: "ses-child" });

    expect(apiMocks.getTaskPhaseView).toHaveBeenCalledWith("task-1", "phase-child");
    expect(state.resolvedSessionId.value).toBe("ses-child");
    expect(state.sourceMessages.value).toEqual([
      expect.objectContaining({
        id: "child-message-1",
        role: "assistant",
        text: "当前 phase 回复",
      }),
    ]);
    expect(state.trace.value?.timelineMeta).toMatchObject({
      includeLineage: false,
      snapshotVersion: 1,
      persistedThroughRevision: 1,
    });
  });

  it("derives liveSessionIds from phase-local non-candidate sessions", async () => {
    const phase = createPhase({
      id: "phase-chain",
      phaseIndex: 2,
      phaseKind: "sequential_chain",
      sessionIds: ["session-main", "session-step-1", "session-candidate", "session-judge"],
    });
    apiMocks.getTaskPhases.mockResolvedValue({ data: [phase] });
    apiMocks.getTaskPhaseView.mockResolvedValue(
      createPhaseView({
        phase,
        currentSessionId: "session-main",
        sessions: [
          {
            id: "session-main",
            phaseId: phase.id,
            phaseRole: "mainline",
            title: "Mainline",
            isActive: false,
            summary: null,
            createdAt: null,
            updatedAt: null,
          },
          {
            id: "session-step-1",
            phaseId: phase.id,
            phaseRole: "step",
            stepIndex: 0,
            title: "Step 1",
            isActive: false,
            summary: null,
            createdAt: null,
            updatedAt: null,
          },
          {
            id: "session-candidate",
            phaseId: phase.id,
            phaseRole: "candidate",
            candidateIndex: 0,
            title: "Candidate",
            isActive: false,
            summary: null,
            createdAt: null,
            updatedAt: null,
          },
          {
            id: "session-judge",
            phaseId: phase.id,
            phaseRole: "judge",
            title: "Judge",
            isActive: false,
            summary: null,
            createdAt: null,
            updatedAt: null,
          },
        ],
        messageGroups: [
          {
            runtimeSessionId: "session-main",
            phaseRole: "mainline",
            phaseItemIndex: 0,
            messages: [
              createMessage({
                id: "phase-chain-user",
                sessionId: "session-main",
                role: "user",
                text: "顺序阶段问题",
                createdAt: "2026-04-13T08:20:00.000Z",
              }),
            ],
          },
        ],
      }),
    );

    const { state } = await mountSnapshot({
      currentPhaseId: "phase-chain",
      currentSessionId: "session-main",
    });

    expect(state.phaseSlices.value).toHaveLength(1);
    expect(state.phaseSlices.value[0]?.liveSessionIds).toEqual(["session-main", "session-step-1"]);
  });

  it("returns an empty phase-first snapshot when no phases exist", async () => {
    apiMocks.getTaskPhases.mockResolvedValue({ data: [] });

    const { state } = await mountSnapshot();

    expect(apiMocks.getTaskPhases).toHaveBeenCalledWith("task-1");
    expect(apiMocks.getTaskPhaseView).not.toHaveBeenCalled();
    expect(state.sourceMessages.value).toEqual([]);
    expect(state.resolvedSessionId.value).toBeUndefined();
    expect(state.trace.value?.timelineMeta).toMatchObject({
      includeLineage: false,
      itemCount: 0,
      snapshotVersion: 0,
      persistedThroughRevision: 0,
    });
  });

  it("keeps the previous phase above the latest phase after continue advances currentPhaseId", async () => {
    const rootPhase = createPhase({
      id: "phase-root",
      phaseIndex: 1,
      sessionIds: ["task-session:task-1:ses-root"],
    });
    const phase1 = createPhase({
      id: "phase-1",
      phaseIndex: 2,
      parentPhaseId: "phase-root",
      sessionIds: ["task-session:task-1:ses-round-1"],
    });
    const phase2 = createPhase({
      id: "phase-2",
      phaseIndex: 3,
      parentPhaseId: "phase-1",
      sessionIds: ["task-session:task-1:ses-round-2"],
    });
    apiMocks.getTaskPhases
      .mockResolvedValueOnce({ data: [rootPhase, phase1] })
      .mockResolvedValueOnce({ data: [rootPhase, phase1, phase2] });
    apiMocks.getTaskPhaseView
      .mockResolvedValueOnce(
        createPhaseView({
          phase: phase1,
          currentSessionId: "ses-round-1",
          messageGroups: [
            {
              runtimeSessionId: "ses-round-1",
              phaseRole: "mainline",
              phaseItemIndex: 0,
              messages: [
                createMessage({
                  id: "phase-1-user",
                  sessionId: "ses-round-1",
                  role: "user",
                  text: "第一阶段问题",
                  createdAt: "2026-04-13T08:00:00.000Z",
                }),
                createMessage({
                  id: "phase-1-assistant",
                  sessionId: "ses-round-1",
                  role: "assistant",
                  text: "第一阶段回复",
                  createdAt: "2026-04-13T08:00:01.000Z",
                }),
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createPhaseView({
          phase: phase2,
          currentSessionId: "ses-round-2",
          messageGroups: [
            {
              runtimeSessionId: "ses-round-2",
              phaseRole: "mainline",
              phaseItemIndex: 0,
              messages: [
                createMessage({
                  id: "phase-2-user",
                  sessionId: "ses-round-2",
                  role: "user",
                  text: "第二阶段问题",
                  createdAt: "2026-04-13T08:10:00.000Z",
                }),
                createMessage({
                  id: "phase-2-assistant",
                  sessionId: "ses-round-2",
                  role: "assistant",
                  text: "第二阶段回复",
                  createdAt: "2026-04-13T08:10:01.000Z",
                }),
              ],
            },
          ],
        }),
      );

    const mounted = await mountSnapshot();

    await mounted.state.refresh(true);
    await flushPromises();

    expect(mounted.state.sourceMessages.value.map((item) => (item as { id: string }).id)).toEqual([
      "phase-1-user",
      "phase-1-assistant",
      "phase-2-user",
      "phase-2-assistant",
    ]);
    expect(mounted.state.resolvedSessionId.value).toBe("ses-round-2");
    expect(mounted.state.hasOlderHistory.value).toBe(true);
    expect(mounted.state.trace.value?.timelineMeta).toMatchObject({
      snapshotVersion: 4,
      persistedThroughRevision: 4,
      itemCount: 4,
    });
  });

  it("keeps parallel candidate replies out of the top-level snapshot", async () => {
    const parallelPhase = createPhase({
      id: "phase-parallel",
      phaseIndex: 2,
      phaseKind: "parallel",
      status: "awaiting_adoption",
      candidateCount: 2,
      sessionIds: [
        "task-session:task-1:candidate-a",
        "task-session:task-1:candidate-b",
      ],
    });
    apiMocks.getTaskPhases.mockResolvedValue({ data: [parallelPhase] });
    apiMocks.getTaskPhaseView.mockResolvedValue(
      createPhaseView({
        phase: parallelPhase,
        currentSessionId: "candidate-a",
        messageGroups: [
          {
            runtimeSessionId: "candidate-a",
            phaseRole: "candidate",
            phaseItemIndex: 0,
            candidateIndex: 0,
            messages: [
              createMessage({
                id: "parallel-user",
                sessionId: "candidate-a",
                role: "user",
                text: "并行分支问题",
                createdAt: "2026-04-13T08:10:00.000Z",
              }),
              createMessage({
                id: "parallel-assistant-a",
                sessionId: "candidate-a",
                role: "assistant",
                text: "候选 A 回复",
                createdAt: "2026-04-13T08:10:01.000Z",
              }),
            ],
          },
          {
            runtimeSessionId: "candidate-b",
            phaseRole: "candidate",
            phaseItemIndex: 1,
            candidateIndex: 1,
            messages: [
              createMessage({
                id: "parallel-assistant-b",
                sessionId: "candidate-b",
                role: "assistant",
                text: "候选 B 回复",
                createdAt: "2026-04-13T08:10:02.000Z",
              }),
            ],
          },
        ],
      }),
    );

    const { state } = await mountSnapshot();

    expect(state.sourceMessages.value).toEqual([
      expect.objectContaining({
        id: "parallel-user",
        role: "user",
        text: "并行分支问题",
      }),
    ]);
  });

  it("prepends older parent phases when loading history upwards", async () => {
    const phase1 = createPhase({
      id: "phase-1",
      phaseIndex: 1,
      sessionIds: ["task-session:task-1:ses-round-1"],
    });
    const phase2 = createPhase({
      id: "phase-2",
      phaseIndex: 2,
      parentPhaseId: "phase-1",
      sessionIds: ["task-session:task-1:ses-round-2"],
    });
    apiMocks.getTaskPhases
      .mockResolvedValueOnce({ data: [phase1, phase2] })
      .mockResolvedValueOnce({ data: [phase1, phase2] });
    apiMocks.getTaskPhaseView
      .mockResolvedValueOnce(
        createPhaseView({
          phase: phase2,
          currentSessionId: "ses-round-2",
          messageGroups: [
            {
              runtimeSessionId: "ses-round-2",
              phaseRole: "mainline",
              phaseItemIndex: 0,
              messages: [
                createMessage({
                  id: "phase-2-user",
                  sessionId: "ses-round-2",
                  role: "user",
                  text: "第二阶段问题",
                  createdAt: "2026-04-13T08:10:00.000Z",
                }),
                createMessage({
                  id: "phase-2-assistant",
                  sessionId: "ses-round-2",
                  role: "assistant",
                  text: "第二阶段回复",
                  createdAt: "2026-04-13T08:10:01.000Z",
                }),
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createPhaseView({
          phase: phase1,
          currentSessionId: "ses-round-1",
          messageGroups: [
            {
              runtimeSessionId: "ses-round-1",
              phaseRole: "mainline",
              phaseItemIndex: 0,
              messages: [
                createMessage({
                  id: "phase-1-user",
                  sessionId: "ses-round-1",
                  role: "user",
                  text: "第一阶段问题",
                  createdAt: "2026-04-13T08:00:00.000Z",
                }),
                createMessage({
                  id: "phase-1-assistant",
                  sessionId: "ses-round-1",
                  role: "assistant",
                  text: "第一阶段回复",
                  createdAt: "2026-04-13T08:00:01.000Z",
                }),
              ],
            },
          ],
        }),
      );

    const { state } = await mountSnapshot();

    expect(state.hasOlderHistory.value).toBe(true);
    expect(state.historyLoading.value).toBe(false);

    const loadPromise = state.loadOlderHistory();
    expect(state.historyLoading.value).toBe(true);

    await loadPromise;
    await flushPromises();

    expect(state.historyLoading.value).toBe(false);
    expect(state.hasOlderHistory.value).toBe(false);
    expect(state.sourceMessages.value.map((item) => (item as { id: string }).id)).toEqual([
      "phase-1-user",
      "phase-1-assistant",
      "phase-2-user",
      "phase-2-assistant",
    ]);
    expect(apiMocks.getTaskPhaseView).toHaveBeenNthCalledWith(2, "task-1", "phase-1");
  });

  it("raises the current phase snapshot revision floor from persisted acks", async () => {
    const phase = createPhase({
      id: "phase-1",
      phaseIndex: 1,
      sessionIds: ["task-session:task-1:ses-round-1"],
    });
    apiMocks.getTaskPhases.mockResolvedValue({ data: [phase] });
    apiMocks.getTaskPhaseView.mockResolvedValue(
      createPhaseView({
        phase,
        currentSessionId: "ses-round-1",
        messageGroups: [
          {
            taskSessionId: "task-session:task-1:ses-round-1",
            runtimeSessionId: "ses-round-1",
            phaseRole: "mainline",
            phaseItemIndex: 0,
            messages: [
              createMessage({
                id: "phase-1-assistant",
                sessionId: "ses-round-1",
                role: "assistant",
                text: "第一阶段回复",
                createdAt: "2026-04-13T08:00:01.000Z",
              }),
            ],
          },
        ],
      }),
    );

    const { state } = await mountSnapshot({
      currentPhaseId: "phase-1",
      currentSessionId: "ses-round-1",
      sessionId: "ses-round-1",
    });

    expect(state.trace.value?.timelineMeta).toMatchObject({
      snapshotVersion: 1,
      persistedThroughRevision: 1,
    });

    state.applyPersistenceAck({
      sessionId: "ses-round-1",
      taskSessionId: "task-session:task-1:ses-round-1",
      persistedThroughRevision: 8,
      snapshotVersion: 8,
    });

    expect(state.trace.value?.timelineMeta).toMatchObject({
      snapshotVersion: 8,
      persistedThroughRevision: 8,
    });
  });

  it("refreshes only the current loaded phase for message-only refreshes", async () => {
    const phase = createPhase({
      id: "phase-2",
      phaseIndex: 2,
      sessionIds: ["task-session:task-1:ses-round-2"],
    });
    apiMocks.getTaskPhases.mockResolvedValue({ data: [phase] });
    apiMocks.getTaskPhaseView
      .mockResolvedValueOnce(
        createPhaseView({
          phase,
          currentSessionId: "ses-round-2",
          messageGroups: [
            {
              taskSessionId: "task-session:task-1:ses-round-2",
              runtimeSessionId: "ses-round-2",
              phaseRole: "mainline",
              phaseItemIndex: 0,
              messages: [
                createMessage({
                  id: "phase-2-assistant-v1",
                  sessionId: "ses-round-2",
                  role: "assistant",
                  text: "初始回复",
                  createdAt: "2026-04-13T08:10:01.000Z",
                }),
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createPhaseView({
          phase,
          currentSessionId: "ses-round-2",
          messageGroups: [
            {
              taskSessionId: "task-session:task-1:ses-round-2",
              runtimeSessionId: "ses-round-2",
              phaseRole: "mainline",
              phaseItemIndex: 0,
              messages: [
                createMessage({
                  id: "phase-2-assistant-v2",
                  sessionId: "ses-round-2",
                  role: "assistant",
                  text: "局部刷新后的回复",
                  createdAt: "2026-04-13T08:10:02.000Z",
                }),
              ],
            },
          ],
        }),
      );

    const { state } = await mountSnapshot({
      currentPhaseId: "phase-2",
      currentSessionId: "ses-round-2",
      sessionId: "ses-round-2",
    });

    apiMocks.getTaskPhases.mockClear();
    apiMocks.getTaskPhaseView.mockClear();

    await state.refreshCurrentPhase(true);
    await flushPromises();

    expect(apiMocks.getTaskPhases).not.toHaveBeenCalled();
    expect(apiMocks.getTaskPhaseView).toHaveBeenCalledTimes(1);
    expect(apiMocks.getTaskPhaseView).toHaveBeenCalledWith("task-1", "phase-2");
    expect(state.sourceMessages.value).toEqual([
      expect.objectContaining({
        id: "phase-2-assistant-v2",
        text: "局部刷新后的回复",
      }),
    ]);
  });

  it("falls back to the current focused phase when refreshCurrentPhase is called with a phaseId that is not loaded", async () => {
    const phase = createPhase({
      id: "phase-2",
      phaseIndex: 2,
      sessionIds: ["task-session:task-1:ses-round-2"],
    });
    apiMocks.getTaskPhases.mockResolvedValue({ data: [phase] });
    apiMocks.getTaskPhaseView.mockResolvedValue(
      createPhaseView({
        phase,
        currentSessionId: "ses-round-2",
        messageGroups: [
          {
            taskSessionId: "task-session:task-1:ses-round-2",
            runtimeSessionId: "ses-round-2",
            phaseRole: "mainline",
            phaseItemIndex: 0,
            messages: [
              createMessage({
                id: "phase-2-assistant",
                sessionId: "ses-round-2",
                role: "assistant",
                text: "focus fallback",
                createdAt: "2026-04-13T09:00:00.000Z",
              }),
            ],
          },
        ],
      }),
    );

    const { state } = await mountSnapshot({
      currentPhaseId: "phase-2",
      currentSessionId: "ses-round-2",
      sessionId: "ses-round-2",
    });

    apiMocks.getTaskPhases.mockClear();
    apiMocks.getTaskPhaseView.mockClear();

    await state.refreshCurrentPhase(true, "phase-unknown");
    await flushPromises();

    expect(apiMocks.getTaskPhaseView).toHaveBeenCalledTimes(1);
    expect(apiMocks.getTaskPhaseView).toHaveBeenCalledWith("task-1", "phase-2");
  });

  it("absorbs current phase persisted overlay updates into the current phase slice", async () => {
    const phase = createPhase({
      id: "phase-1",
      sessionIds: ["task-session:task-1:ses-round-1"],
    });
    apiMocks.getTaskPhases.mockResolvedValue({ data: [phase] });
    apiMocks.getTaskPhaseView.mockResolvedValue(
      createPhaseView({
        phase,
        currentSessionId: "ses-round-1",
        messageGroups: [
          {
            taskSessionId: "task-session:task-1:ses-round-1",
            runtimeSessionId: "ses-round-1",
            phaseRole: "mainline",
            phaseItemIndex: 0,
            messages: [
              createMessage({
                id: "phase-1-user",
                sessionId: "ses-round-1",
                role: "user",
                text: "第一阶段问题",
                createdAt: "2026-04-13T08:00:00.000Z",
              }),
              createMessage({
                id: "phase-1-assistant",
                sessionId: "ses-round-1",
                role: "assistant",
                text: "旧回复",
                createdAt: "2026-04-13T08:00:01.000Z",
              }),
            ],
          },
        ],
      }),
    );

    const { state } = await mountSnapshot({
      currentPhaseId: "phase-1",
      currentSessionId: "ses-round-1",
      sessionId: "ses-round-1",
    });

    state.applyPersistenceAck(
      {
        kind: "round-synced",
        sessionId: "ses-round-1",
        taskSessionId: "task-session:task-1:ses-round-1",
        snapshotVersion: 9,
        persistedThroughRevision: 9,
      },
      {
        realtimeSourceMessagesByPhaseId: {
          "phase-1": [
            {
              id: "phase-1-user-followup",
              role: "user",
              text: "继续排查第一阶段",
              createdAt: "2026-04-13T08:00:02.000Z",
            },
            {
              id: "phase-1-tool",
              role: "tool",
              parts: [
                {
                  type: "tool",
                  toolName: "read_file",
                  state: "completed",
                  input: { filePath: "docs/phase-1.md" },
                },
              ],
              createdAt: "2026-04-13T08:00:03.000Z",
            },
          ],
        },
        conversationItems: [
          {
            key: "phase-1-assistant",
            role: "assistant",
            text: "更新后的回复",
            thinkingText: "先重新整理上下文",
            toolCalls: [],
            createdAt: "2026-04-13T08:00:01.000Z",
            raw: null,
            isStreaming: false,
          },
        ] as any,
      },
    );

    const normalizedItems = normalizeSessionConversationItems(state.sourceMessages.value);
    expect(normalizedItems.map((item) => item.key)).toEqual([
      "phase-1-user",
      "phase-1-assistant",
      "phase-1-user-followup",
      "phase-1-tool",
    ]);
    expect(normalizedItems.find((item) => item.key === "phase-1-assistant")).toMatchObject({
      text: "更新后的回复",
      thinkingText: "先重新整理上下文",
    });
  });

  it("absorbs persisted updates into a non-current phase slice when an older-phase ack arrives", async () => {
    const phase1 = createPhase({
      id: "phase-1",
      phaseIndex: 1,
      sessionIds: ["task-session:task-1:ses-round-1"],
      startedAt: "2026-04-13T08:00:00.000Z",
      finishedAt: "2026-04-13T08:00:05.000Z",
      createdAt: "2026-04-13T08:00:00.000Z",
      updatedAt: "2026-04-13T08:00:05.000Z",
    });
    const phase2 = createPhase({
      id: "phase-2",
      phaseIndex: 2,
      sessionIds: ["task-session:task-1:ses-round-2"],
      startedAt: "2026-04-13T08:01:00.000Z",
      finishedAt: "2026-04-13T08:01:05.000Z",
      createdAt: "2026-04-13T08:01:00.000Z",
      updatedAt: "2026-04-13T08:01:05.000Z",
    });

    apiMocks.getTaskPhases.mockResolvedValue({ data: [phase1, phase2] });
    apiMocks.getTaskPhaseView.mockImplementation(async (_taskId: string, phaseId: string) => {
      if (phaseId === "phase-1") {
        return createPhaseView({
          phase: phase1,
          currentSessionId: "ses-round-1",
          messageGroups: [
            {
              taskSessionId: "task-session:task-1:ses-round-1",
              runtimeSessionId: "ses-round-1",
              phaseRole: "mainline",
              phaseItemIndex: 0,
              messages: [
                createMessage({
                  id: "phase-1-user",
                  sessionId: "ses-round-1",
                  role: "user",
                  text: "上一阶段的问题",
                  createdAt: "2026-04-13T08:00:00.000Z",
                }),
                createMessage({
                  id: "phase-1-assistant",
                  sessionId: "ses-round-1",
                  role: "assistant",
                  text: "旧阶段的旧回复",
                  createdAt: "2026-04-13T08:00:01.000Z",
                }),
              ],
            },
          ],
        });
      }
      return createPhaseView({
        phase: phase2,
        currentSessionId: "ses-round-2",
        messageGroups: [
          {
            taskSessionId: "task-session:task-1:ses-round-2",
            runtimeSessionId: "ses-round-2",
            phaseRole: "mainline",
            phaseItemIndex: 0,
            messages: [
              createMessage({
                id: "phase-2-user",
                sessionId: "ses-round-2",
                role: "user",
                text: "新阶段问题",
                createdAt: "2026-04-13T08:01:00.000Z",
              }),
              createMessage({
                id: "phase-2-assistant",
                sessionId: "ses-round-2",
                role: "assistant",
                text: "新阶段回复",
                createdAt: "2026-04-13T08:01:01.000Z",
              }),
            ],
          },
        ],
      });
    });

    const { state } = await mountSnapshot({
      currentPhaseId: "phase-2",
      currentSessionId: "ses-round-2",
      sessionId: "ses-round-2",
    });

    await state.loadOlderHistory();
    await flushPromises();

    expect(state.phaseSlices.value.map((slice) => slice.phase.id)).toEqual([
      "phase-1",
      "phase-2",
    ]);

    state.applyPersistenceAck(
      {
        kind: "round-synced",
        phaseId: "phase-1",
        sessionId: "ses-round-1",
        taskSessionId: "task-session:task-1:ses-round-1",
        snapshotVersion: 12,
        persistedThroughRevision: 12,
      },
      {
        realtimeSourceMessagesByPhaseId: {
          "phase-1": [
            {
              id: "phase-1-user-late",
              role: "user",
              text: "历史阶段补充追问",
              createdAt: "2026-04-13T08:00:04.000Z",
            },
          ],
          "phase-2": [
            {
              id: "phase-2-user-live",
              role: "user",
              text: "当前阶段实时消息",
              createdAt: "2026-04-13T08:01:02.000Z",
            },
          ],
        },
        conversationItems: [
          {
            key: "phase-1-assistant",
            role: "assistant",
            text: "旧阶段的新回复",
            thinkingText: "重新推理",
            toolCalls: [],
            createdAt: "2026-04-13T08:00:01.000Z",
            raw: null,
            isStreaming: false,
          },
          {
            key: "phase-2-assistant",
            role: "assistant",
            text: "当前阶段回复（不应落到历史阶段）",
            toolCalls: [],
            createdAt: "2026-04-13T08:01:01.000Z",
            raw: null,
            isStreaming: false,
          },
        ] as any,
      },
    );

    const slices = state.phaseSlices.value;
    const phase1Slice = slices.find((slice) => slice.phase.id === "phase-1");
    const phase2Slice = slices.find((slice) => slice.phase.id === "phase-2");
    if (!phase1Slice || !phase2Slice) {
      throw new Error("expected both phase slices to be loaded");
    }

    const phase1Items = normalizeSessionConversationItems(phase1Slice.sourceMessages);
    expect(phase1Items.map((item) => item.key)).toEqual([
      "phase-1-user",
      "phase-1-assistant",
      "phase-1-user-late",
    ]);
    expect(phase1Items.find((item) => item.key === "phase-1-assistant")).toMatchObject({
      text: "旧阶段的新回复",
      thinkingText: "重新推理",
    });

    const phase2Items = normalizeSessionConversationItems(phase2Slice.sourceMessages);
    expect(phase2Items.map((item) => item.key)).toEqual([
      "phase-2-user",
      "phase-2-assistant",
    ]);
  });
});
