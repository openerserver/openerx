import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import type { TaskPhaseRecord } from "../lib/api";
import { normalizeSessionConversationItems } from "../lib/message-normalize";
import { useTaskMessageSnapshot } from "./useTaskMessageSnapshot";

const apiMocks = vi.hoisted(() => ({
  getTaskPhases: vi.fn(),
  getTaskPhaseView: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getTaskPhases: apiMocks.getTaskPhases,
  getTaskPhaseView: apiMocks.getTaskPhaseView,
}));

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
  messageGroups: Array<{
    taskSessionId?: string | null;
    runtimeSessionId?: string | null;
    phaseRole?: string | null;
    phaseItemIndex?: number | null;
    candidateIndex?: number | null;
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
      sessions: [],
      messageGroups: args.messageGroups,
      meta: {
        currentSessionId: args.currentSessionId ?? null,
        currentPhaseId: args.phase.id,
        latestPhaseId: args.phase.id,
        phaseCount: 1,
        sessionCount: 0,
        messageGroupCount: args.messageGroups.length,
        messageCount,
      },
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useTaskMessageSnapshot", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
    vi.clearAllMocks();
  });

  async function mountSnapshot() {
    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("ses-round-1");
    const currentSessionId = ref<string | null>("ses-round-1");
    const currentPhaseId = ref<string | null>("phase-1");
    scope = effectScope();
    const state = scope.run(() =>
      useTaskMessageSnapshot(taskId, sessionId, {
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
      state,
    };
  }

  it("raises the current phase snapshot revision floor from persisted acks", async () => {
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

    expect(state.trace.value?.timelineMeta).toMatchObject({
      snapshotVersion: 1,
      persistedThroughRevision: 1,
    });

    state.applyPersistenceAck({
      sessionId: "ses-round-1",
      taskSessionId: "task-session:task-1:ses-round-1",
      snapshotVersion: 8,
      persistedThroughRevision: 8,
    });

    expect(state.trace.value?.timelineMeta).toMatchObject({
      snapshotVersion: 8,
      persistedThroughRevision: 8,
    });
  });

  it("refreshes only the current loaded phase for message-only refreshes", async () => {
    const phase = createPhase({
      id: "phase-1",
      sessionIds: ["task-session:task-1:ses-round-1"],
    });
    apiMocks.getTaskPhases.mockResolvedValue({ data: [phase] });
    apiMocks.getTaskPhaseView
      .mockResolvedValueOnce(
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
                  id: "phase-1-assistant-v1",
                  sessionId: "ses-round-1",
                  role: "assistant",
                  text: "初始回复",
                  createdAt: "2026-04-13T08:00:01.000Z",
                }),
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
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
                  id: "phase-1-assistant-v2",
                  sessionId: "ses-round-1",
                  role: "assistant",
                  text: "局部刷新后的回复",
                  createdAt: "2026-04-13T08:00:02.000Z",
                }),
              ],
            },
          ],
        }),
      );

    const { state } = await mountSnapshot();

    apiMocks.getTaskPhases.mockClear();
    apiMocks.getTaskPhaseView.mockClear();

    await state.refreshCurrentPhase(true);
    await flushPromises();

    expect(apiMocks.getTaskPhases).not.toHaveBeenCalled();
    expect(apiMocks.getTaskPhaseView).toHaveBeenCalledTimes(1);
    expect(apiMocks.getTaskPhaseView).toHaveBeenCalledWith("task-1", "phase-1");
    expect(state.sourceMessages.value).toEqual([
      expect.objectContaining({
        id: "phase-1-assistant-v2",
        text: "局部刷新后的回复",
      }),
    ]);
  });

  it("absorbs current phase persisted updates into the local phase slice when an ack arrives", async () => {
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

    const { state } = await mountSnapshot();

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
                  input: {
                    filePath: "docs/phase-1.md",
                  },
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
    expect(state.trace.value?.timelineMeta).toMatchObject({
      snapshotVersion: 9,
      persistedThroughRevision: 9,
    });
  });

  it("dedupes equivalent parallel fan-out user prompts while absorbing current phase ack updates", async () => {
    const phase = createPhase({
      id: "phase-1",
      sessionIds: ["task-session:task-1:ses-round-1"],
    });
    apiMocks.getTaskPhases.mockResolvedValue({ data: [phase] });
    apiMocks.getTaskPhaseView.mockResolvedValue(
      createPhaseView({
        phase,
        currentSessionId: "ses-round-1",
        messageGroups: [],
      }),
    );

    const { state } = await mountSnapshot();

    state.applyPersistenceAck(
      {
        kind: "round-synced",
        sessionId: "ses-round-1",
        taskSessionId: "task-session:task-1:ses-round-1",
        snapshotVersion: 12,
        persistedThroughRevision: 12,
      },
      {
        realtimeSourceMessagesByPhaseId: {
          "phase-1": [
            {
              id: "task-session-message:task-session:task-1:ses-round-1:model-a:user-prompt",
              sessionId: "task-session:task-1:ses-round-1",
              role: "user",
              text: "pi-monorepo 项目 是什么？",
              userInputText: "pi-monorepo 项目 是什么？",
              finalSentText: "pi-monorepo 项目 是什么？",
              createdAt: "2026-04-16T03:44:35.409Z",
              info: {
                id: "task-session-message:task-session:task-1:ses-round-1:model-a:user-prompt",
                role: "user",
                time: {
                  created: "2026-04-16T03:44:35.409Z",
                  completed: "2026-04-16T03:44:35.409Z",
                },
              },
              parts: [{ type: "text", text: "pi-monorepo 项目 是什么？" }],
            },
            {
              id: "task-session-message:task-session:task-1:ses-round-1:model-b:user-prompt",
              sessionId: "task-session:task-1:ses-round-1",
              role: "user",
              text: "pi-monorepo 项目 是什么？",
              userInputText: "pi-monorepo 项目 是什么？",
              finalSentText: "pi-monorepo 项目 是什么？",
              createdAt: "2026-04-16T03:44:35.409Z",
              info: {
                id: "task-session-message:task-session:task-1:ses-round-1:model-b:user-prompt",
                role: "user",
                time: {
                  created: "2026-04-16T03:44:35.409Z",
                  completed: "2026-04-16T03:44:35.409Z",
                },
              },
              parts: [{ type: "text", text: "pi-monorepo 项目 是什么？" }],
            },
          ],
        },
        conversationItems: [],
      },
    );

    const normalizedItems = normalizeSessionConversationItems(state.sourceMessages.value);
    expect(normalizedItems.map((item) => item.key)).toEqual([
      "task-session-message:task-session:task-1:ses-round-1:model-a:user-prompt",
    ]);
    expect(normalizedItems[0]).toMatchObject({
      role: "user",
      text: "pi-monorepo 项目 是什么？",
      userInputText: "pi-monorepo 项目 是什么？",
      finalSentText: "pi-monorepo 项目 是什么？",
      createdAt: "2026-04-16T03:44:35.409Z",
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

    const taskId = ref("task-1");
    const sessionId = ref<string | undefined>("ses-round-2");
    const currentSessionId = ref<string | null>("ses-round-2");
    const currentPhaseId = ref<string | null>("phase-2");
    scope = effectScope();
    const state = scope.run(() =>
      useTaskMessageSnapshot(taskId, sessionId, {
        currentSessionId,
        currentPhaseId,
      }),
    );
    if (!state) {
      throw new Error("expected task message snapshot state");
    }

    await flushPromises();
    await flushPromises();

    await state.loadOlderHistory();
    await flushPromises();

    expect(state.phaseSlices.value.map((slice) => slice.phase.id)).toEqual([
      "phase-1",
      "phase-2",
    ]);

    state.applyPersistenceAck(
      {
        kind: "round-synced",
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