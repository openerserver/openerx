import { computed, effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyLiveAssistantState } from "../../control-plane/web-ui/src/lib/message-normalize";
import { useTaskDetailParallelFlow } from "../../control-plane/web-ui/src/composables/useTaskDetailParallelFlow";

const {
  getTaskAgentRunsMock,
  getTaskPhasesMock,
  getTaskPhaseViewMock,
  getLiveAssistantStateMock,
} = vi.hoisted(() => ({
  getTaskAgentRunsMock: vi.fn(),
  getTaskPhasesMock: vi.fn(),
  getTaskPhaseViewMock: vi.fn(),
  getLiveAssistantStateMock: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => ({
  getTaskAgentRuns: getTaskAgentRunsMock,
  getTaskPhases: getTaskPhasesMock,
  getTaskPhaseView: getTaskPhaseViewMock,
}));

vi.mock("../../control-plane/web-ui/src/composables/useTaskMessagePatchConsumer", () => ({
  useTaskMessagePatchConsumer: () => ({
    taskPatchEventSignature: computed(() => "signature"),
    getLiveAssistantState: getLiveAssistantStateMock,
    getTaskPatchEvents: () => [],
  }),
}));

describe("useTaskDetailParallelFlow phase dto", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    getTaskAgentRunsMock.mockReset();
    getTaskAgentRunsMock.mockResolvedValue({ data: [] });
    getTaskPhasesMock.mockReset();
    getTaskPhaseViewMock.mockReset();
    getLiveAssistantStateMock.mockReset();
    getLiveAssistantStateMock.mockImplementation(() => createEmptyLiveAssistantState());
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountFlow(options?: {
    phaseSlices?: any[];
    baseConversationItems?: any[];
    currentPhaseId?: string | null;
  }) {
    const currentPhaseId = ref<string | null>(null);
    const currentSessionId = ref<string | null>("session-1");
    const taskId = ref("task-1");
    const taskNodeId = ref("node-task-1");
    const task = ref({
      id: "task-1",
      sessionId: "session-1",
      status: "running",
      executionMode: "parallel",
      orchestrationKind: "parallel",
    } as any);
    const taskSessionSummaries = ref([] as any[]);
    const flatNodes = ref([] as any[]);
    const phaseSlices = ref(options?.phaseSlices ?? []);
    const selectedSessionId = ref<string | undefined>(undefined);
    const selectedSessionNode = ref(null as any);
    const baseConversationItems = ref(options?.baseConversationItems ?? ([] as any[]));
    const configuredCandidates = ref([
      { label: "候选 1", model: "gpt-5.4-mini" },
      { label: "候选 2", model: "gpt-5.4" },
    ]);
    const refreshTask = vi.fn(async () => undefined);
    const refreshSessions = vi.fn(async () => undefined);
    const refreshRuntimePermissions = vi.fn(async () => undefined);

    scope = effectScope();
    const flow = scope.run(() =>
      useTaskDetailParallelFlow({
        currentPhaseId,
        currentSessionId,
        taskId,
        taskNodeId,
        task,
        taskSessionSummaries,
        flatNodes,
        phaseSlices,
        selectedSessionId,
        selectedSessionNode,
        baseConversationItems,
        configuredCandidates,
        refreshTask,
        refreshSessions,
        refreshRuntimePermissions,
      }),
    );
    if (!flow) {
      throw new Error("expected task detail parallel flow");
    }

    return {
      currentPhaseId,
      flow,
      phaseSlices,
      refreshRuntimePermissions,
      refreshSessions,
      refreshTask,
    };
  }

  it("loads phase dto runs before falling back to session inference", async () => {
    getTaskPhasesMock.mockResolvedValue({
      data: [
        {
          id: "phase-2",
          phaseIndex: 2,
          phaseKind: "parallel",
          triggerType: "execute",
          status: "awaiting_adoption",
          anchorSessionId: "session-1",
          winnerSessionId: "candidate-2",
          startedAt: "2026-04-12T10:00:00.000Z",
          createdAt: "2026-04-12T10:00:00.000Z",
          updatedAt: "2026-04-12T10:06:30.000Z",
        },
      ],
    });
    getTaskPhaseViewMock.mockResolvedValue({
      data: {
        phase: {
          id: "phase-2",
          phaseIndex: 2,
          phaseKind: "parallel",
          triggerType: "execute",
          status: "awaiting_adoption",
          anchorSessionId: "session-1",
          winnerSessionId: "candidate-2",
          startedAt: "2026-04-12T10:00:00.000Z",
          createdAt: "2026-04-12T10:00:00.000Z",
          updatedAt: "2026-04-12T10:06:30.000Z",
        },
        sessions: [
          {
            id: "candidate-1",
            title: "候选 1",
            phaseId: "phase-2",
            phaseRole: "candidate",
            candidateIndex: 0,
            executionStatus: "completed",
            selectedModel: "gpt-5.4-mini",
            isActive: false,
            summary: null,
            createdAt: "2026-04-12T10:00:10.000Z",
            updatedAt: "2026-04-12T10:06:00.000Z",
          },
          {
            id: "candidate-2",
            title: "候选 2",
            phaseId: "phase-2",
            phaseRole: "candidate",
            candidateIndex: 1,
            executionStatus: "completed",
            selectedModel: "gpt-5.4",
            isActive: false,
            summary: null,
            createdAt: "2026-04-12T10:00:20.000Z",
            updatedAt: "2026-04-12T10:06:30.000Z",
          },
        ],
        messageGroups: [],
        meta: {},
      },
    });

    const { currentPhaseId, flow, refreshRuntimePermissions, refreshSessions, refreshTask } =
      mountFlow();
    currentPhaseId.value = "phase-2";

    await flow.refreshFlowSnapshot();

    expect(refreshTask).toHaveBeenCalledWith(true);
    expect(refreshSessions).toHaveBeenCalledWith(true);
    expect(refreshRuntimePermissions).toHaveBeenCalledWith(true);
    expect(getTaskPhasesMock).toHaveBeenCalledWith("task-1");
    expect(getTaskPhaseViewMock).toHaveBeenCalledWith("task-1", "phase-2");
    expect(flow.currentParallelRunRecord.value).toMatchObject({
      parallelRunId: "task-phase:phase-2",
      phaseId: "phase-2",
      winnerCandidateIndex: 1,
    });
  });

  it("applies phase candidate baseline trace states to parallel cards before compat trace fallback settles", async () => {
    getTaskPhasesMock.mockResolvedValue({
      data: [
        {
          id: "phase-2",
          phaseIndex: 2,
          phaseKind: "parallel",
          triggerType: "execute",
          status: "running",
          anchorSessionId: "session-1",
          startedAt: "2026-04-12T10:00:00.000Z",
          createdAt: "2026-04-12T10:00:00.000Z",
          updatedAt: "2026-04-12T10:06:30.000Z",
        },
      ],
    });
    getTaskPhaseViewMock.mockResolvedValue({
      data: {
        phase: {
          id: "phase-2",
          phaseIndex: 2,
          phaseKind: "parallel",
          triggerType: "execute",
          status: "running",
          anchorSessionId: "session-1",
          startedAt: "2026-04-12T10:00:00.000Z",
          createdAt: "2026-04-12T10:00:00.000Z",
          updatedAt: "2026-04-12T10:06:30.000Z",
        },
        sessions: [
          {
            id: "candidate-1",
            title: "候选 1",
            phaseId: "phase-2",
            phaseRole: "candidate",
            candidateIndex: 0,
            executionStatus: "running",
            selectedModel: "gpt-5.4-mini",
            isActive: false,
            summary: null,
            createdAt: "2026-04-12T10:00:10.000Z",
            updatedAt: "2026-04-12T10:06:00.000Z",
          },
          {
            id: "candidate-2",
            title: "候选 2",
            phaseId: "phase-2",
            phaseRole: "candidate",
            candidateIndex: 1,
            executionStatus: "completed",
            selectedModel: "gpt-5.4",
            isActive: false,
            summary: null,
            createdAt: "2026-04-12T10:00:20.000Z",
            updatedAt: "2026-04-12T10:06:30.000Z",
          },
        ],
        messageGroups: [
          {
            taskSessionId: "candidate-1",
            runtimeSessionId: "candidate-1",
            phaseRole: "candidate",
            candidateIndex: 0,
            executionStatus: "running",
            timelineMeta: {
              cacheState: "partial",
              complete: false,
              itemCount: 1,
            },
            messages: [
              {
                id: "candidate-1-assistant",
                role: "assistant",
                text: "阶段视图里的进行中回复",
                createdAt: "2026-04-12T10:00:12.000Z",
              },
            ],
          },
          {
            taskSessionId: "candidate-2",
            runtimeSessionId: "candidate-2",
            phaseRole: "candidate",
            candidateIndex: 1,
            executionStatus: "completed",
            timelineMeta: {
              cacheState: "complete",
              complete: true,
              itemCount: 1,
            },
            messages: [
              {
                id: "candidate-2-assistant",
                role: "assistant",
                text: "阶段视图里的完成回复",
                createdAt: "2026-04-12T10:00:22.000Z",
              },
            ],
          },
        ],
        meta: {},
      },
    });

    const { currentPhaseId, flow } = mountFlow();
    currentPhaseId.value = "phase-2";

    await flow.refreshFlowSnapshot();

    const parallelItem = flow.conversationItems.value.find(
      (item) => item.role === "parallel",
    ) as any;
    expect(parallelItem).toBeTruthy();
    expect(parallelItem.candidates[0]).toMatchObject({
      traceState: "incomplete",
      traceNote: "当前候选只拿到了部分执行追踪，展示内容可能不完整。",
    });
    expect(parallelItem.candidates[0]?.items.map((item: { key: string }) => item.key)).toEqual([
      "candidate-1-assistant",
    ]);
  });

  it("stops using session/tree fallback once phase authority loads successfully with no parallel phases", async () => {
    getTaskPhasesMock.mockResolvedValue({ data: [] });
    getTaskPhaseViewMock.mockReset();

    const { currentPhaseId, flow } = mountFlow();
    currentPhaseId.value = null;

    await flow.refreshFlowSnapshot();

    expect(getTaskPhasesMock).toHaveBeenCalledWith("task-1");
    expect(getTaskPhaseViewMock).not.toHaveBeenCalled();
    expect(flow.isParallelComparisonMode.value).toBe(true);
    expect(flow.currentParallelRunRecord.value).toBeNull();
    expect(
      flow.conversationItems.value.some(
        (item) => (item as { type?: string }).type === "parallel-comparison",
      ),
    ).toBe(false);
  });

  it("projects non-current phase live assistant overlays into the matching phase block", () => {
    getLiveAssistantStateMock.mockImplementation((_taskId: string, sessionId: string | undefined) => {
      if (sessionId !== "session-phase-1") {
        return createEmptyLiveAssistantState();
      }

      return {
        orderedAssistantMessageIds: ["phase-1-assistant"],
        metaById: new Map(),
        textById: new Map([["phase-1-assistant", "第一阶段流式更新后的回复"]]),
        thinkingById: new Map(),
        incompleteIds: new Set(["phase-1-assistant"]),
      };
    });

    const { currentPhaseId, flow } = mountFlow({
      phaseSlices: [
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "single",
            triggerType: "execute",
            status: "running",
            sessionIds: ["session-phase-1"],
            startedAt: "2026-04-17T09:59:00.000Z",
          },
          sourceMessages: [
            {
              id: "phase-1-user",
              role: "user",
              text: "第一阶段问题",
              createdAt: "2026-04-17T09:59:01.000Z",
            },
            {
              id: "phase-1-assistant",
              role: "assistant",
              text: "第一阶段旧回复",
              createdAt: "2026-04-17T09:59:02.000Z",
            },
          ],
          resolvedSessionId: "session-phase-1",
        },
        {
          phase: {
            id: "phase-2",
            phaseIndex: 2,
            phaseKind: "single",
            triggerType: "continue",
            status: "running",
            sessionIds: ["session-1"],
            startedAt: "2026-04-17T10:00:00.000Z",
          },
          sourceMessages: [
            {
              id: "phase-2-user",
              role: "user",
              text: "第二阶段问题",
              createdAt: "2026-04-17T10:00:01.000Z",
            },
          ],
          resolvedSessionId: "session-1",
        },
      ],
      baseConversationItems: [
        {
          key: "phase-2-user",
          role: "user",
          text: "第二阶段问题",
          toolCalls: [],
          createdAt: "2026-04-17T10:00:01.000Z",
          raw: null,
        },
      ],
    });
    currentPhaseId.value = "phase-2";

    expect(flow.phaseBlocks.value.map((block) => block.phaseId)).toEqual(["phase-1", "phase-2"]);
    expect(flow.phaseBlocks.value[0]?.items[1]).toMatchObject({
      key: "phase-1-assistant",
      text: "第一阶段流式更新后的回复",
      isStreaming: true,
    });
    expect(flow.phaseBlocks.value[1]?.items.map((item) => item.key)).toEqual(["phase-2-user"]);
  });

  it("merges non-current phase live assistant overlays from phase-local liveSessionIds", () => {
    getLiveAssistantStateMock.mockImplementation((_taskId: string, sessionId: string | undefined) => {
      if (sessionId === "session-phase-1-step-1") {
        return {
          orderedAssistantMessageIds: ["phase-1-assistant-1"],
          metaById: new Map(),
          textById: new Map([["phase-1-assistant-1", "第一步流式更新后的回复"]]),
          thinkingById: new Map(),
          incompleteIds: new Set(["phase-1-assistant-1"]),
        };
      }
      if (sessionId === "session-phase-1-step-2") {
        return {
          orderedAssistantMessageIds: ["phase-1-assistant-2"],
          metaById: new Map(),
          textById: new Map([["phase-1-assistant-2", "第二步流式更新后的回复"]]),
          thinkingById: new Map(),
          incompleteIds: new Set(["phase-1-assistant-2"]),
        };
      }

      return createEmptyLiveAssistantState();
    });

    const { currentPhaseId, flow } = mountFlow({
      phaseSlices: [
        {
          phase: {
            id: "phase-1",
            phaseIndex: 1,
            phaseKind: "sequential_chain",
            triggerType: "execute",
            status: "running",
            sessionIds: ["session-current", "session-phase-1-step-1", "session-phase-1-step-2"],
            startedAt: "2026-04-17T09:59:00.000Z",
          },
          liveSessionIds: ["session-phase-1-step-1", "session-phase-1-step-2"],
          sourceMessages: [
            {
              id: "phase-1-user",
              role: "user",
              text: "第一阶段问题",
              createdAt: "2026-04-17T09:59:01.000Z",
            },
            {
              id: "phase-1-assistant-1",
              role: "assistant",
              text: "第一步旧回复",
              createdAt: "2026-04-17T09:59:02.000Z",
            },
            {
              id: "phase-1-assistant-2",
              role: "assistant",
              text: "第二步旧回复",
              createdAt: "2026-04-17T09:59:03.000Z",
            },
          ],
          resolvedSessionId: "session-current",
        },
        {
          phase: {
            id: "phase-2",
            phaseIndex: 2,
            phaseKind: "single",
            triggerType: "continue",
            status: "running",
            sessionIds: ["session-1"],
            startedAt: "2026-04-17T10:00:00.000Z",
          },
          sourceMessages: [
            {
              id: "phase-2-user",
              role: "user",
              text: "第二阶段问题",
              createdAt: "2026-04-17T10:00:01.000Z",
            },
          ],
          resolvedSessionId: "session-1",
        },
      ],
      baseConversationItems: [
        {
          key: "phase-2-user",
          role: "user",
          text: "第二阶段问题",
          toolCalls: [],
          createdAt: "2026-04-17T10:00:01.000Z",
          raw: null,
        },
      ],
    });
    currentPhaseId.value = "phase-2";

    expect(flow.phaseBlocks.value[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "phase-1-assistant-1",
          text: "第一步流式更新后的回复",
          isStreaming: true,
        }),
        expect.objectContaining({
          key: "phase-1-assistant-2",
          text: "第二步流式更新后的回复",
          isStreaming: true,
        }),
      ]),
    );
    expect(getLiveAssistantStateMock).toHaveBeenCalledWith("task-1", "session-phase-1-step-1");
    expect(getLiveAssistantStateMock).toHaveBeenCalledWith("task-1", "session-phase-1-step-2");
    expect(getLiveAssistantStateMock).not.toHaveBeenCalledWith("task-1", "session-current");
  });
});