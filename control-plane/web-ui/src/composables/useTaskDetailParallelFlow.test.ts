import { computed, effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyLiveAssistantState } from "../lib/message-normalize";
import { useTaskDetailParallelFlow } from "./useTaskDetailParallelFlow";

const patchConsumerState = {
  taskPatchEventSignature: "signature-0",
  patchEventsByTaskId: {} as Record<string, any[]>,
};

const getTaskAgentRunsMock = vi.fn();
const getTaskConversationMessagesMock = vi.fn();
const getTaskExecutionTraceViewMock = vi.fn();
const getTaskPhasesMock = vi.fn();
const getTaskPhaseViewMock = vi.fn();

vi.mock("../lib/api", () => ({
  getTaskAgentRuns: getTaskAgentRunsMock,
  getTaskConversationMessages: getTaskConversationMessagesMock,
  getTaskExecutionTraceView: getTaskExecutionTraceViewMock,
  getTaskPhases: getTaskPhasesMock,
  getTaskPhaseView: getTaskPhaseViewMock,
}));

vi.mock("./useTaskMessagePatchConsumer", () => ({
  useTaskMessagePatchConsumer: () => ({
    taskPatchEventSignature: computed(() => patchConsumerState.taskPatchEventSignature),
    getTaskPatchEvents: (taskId: string) => patchConsumerState.patchEventsByTaskId[taskId] ?? [],
    getLiveAssistantState: () => createEmptyLiveAssistantState(),
  }),
}));

describe("useTaskDetailParallelFlow", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    patchConsumerState.taskPatchEventSignature = "signature-0";
    patchConsumerState.patchEventsByTaskId = {};
    getTaskAgentRunsMock.mockReset();
    getTaskAgentRunsMock.mockResolvedValue({ data: [] });
    getTaskConversationMessagesMock.mockReset();
    getTaskConversationMessagesMock.mockResolvedValue({ data: [] });
    getTaskExecutionTraceViewMock.mockReset();
    getTaskExecutionTraceViewMock.mockRejectedValue(new Error("trace unavailable"));
    getTaskPhasesMock.mockReset();
    getTaskPhasesMock.mockResolvedValue({ data: [] });
    getTaskPhaseViewMock.mockReset();
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountFlow() {
    const currentPhaseId = ref<string | null>(null);
    const currentSessionId = ref<string | null>("session-1");
    const taskId = ref("task-1");
    const taskNodeId = ref("node-task-1");
    const task = ref({
      id: "task-1",
      sessionId: "session-1",
      status: "running",
      executionMode: "single",
    } as any);
    const taskSessionSummaries = ref([] as any[]);
    const flatNodes = ref([
      {
        id: "node-session-1",
        parentId: "node-task-1",
        runtimeSessionId: "session-1",
        isActive: true,
      },
    ] as any[]);
    const phaseSlices = ref([] as any[]);
    const selectedSessionId = ref<string | undefined>(undefined);
    const selectedSessionNode = ref(null as any);
    const baseConversationItems = ref([] as any[]);
    const configuredCandidates = ref([] as Array<{ label?: string; model?: string }>);
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
      getTaskAgentRunsMock,
      getTaskPhaseViewMock,
      getTaskPhasesMock,
      phaseSlices,
      refreshRuntimePermissions,
      refreshSessions,
      refreshTask,
      selectedSessionId,
    };
  }

  it("refreshes flow snapshot through the flow feature", async () => {
    const { flow, refreshRuntimePermissions, refreshSessions, refreshTask } = mountFlow();

    await flow.refreshFlowSnapshot();

    expect(refreshTask).toHaveBeenCalledWith(true);
    expect(refreshSessions).toHaveBeenCalledWith(true);
    expect(getTaskAgentRunsMock).toHaveBeenCalledWith("task-1");
    expect(getTaskPhasesMock).toHaveBeenCalledWith("task-1");
    expect(getTaskPhaseViewMock).not.toHaveBeenCalled();
    expect(refreshRuntimePermissions).toHaveBeenCalledWith(true);
  });

  it("loads the initial flow snapshot without forcing a task refresh", async () => {
    const { flow, refreshRuntimePermissions, refreshSessions, refreshTask } = mountFlow();

    await flow.loadInitialFlowSnapshot();

    expect(refreshTask).not.toHaveBeenCalled();
    expect(refreshSessions).toHaveBeenCalledTimes(1);
    expect(refreshSessions).toHaveBeenCalledWith();
    expect(getTaskAgentRunsMock).toHaveBeenCalledWith("task-1");
    expect(getTaskPhasesMock).toHaveBeenCalledWith("task-1");
    expect(getTaskPhaseViewMock).not.toHaveBeenCalled();
    expect(refreshRuntimePermissions).toHaveBeenCalledWith(true);
  });

  it("prefers phase-scoped parallel runs when phase DTO is available", async () => {
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

    const { currentPhaseId, flow } = mountFlow();
    currentPhaseId.value = "phase-2";

    await flow.refreshFlowSnapshot();

    expect(getTaskPhaseViewMock).toHaveBeenCalledWith("task-1", "phase-2");
    expect(flow.currentParallelRunRecord.value).toMatchObject({
      parallelRunId: "task-phase:phase-2",
      phaseId: "phase-2",
      winnerCandidateIndex: 1,
    });
  });

  it("seeds parallel candidate replies from phase view message groups", async () => {
    getTaskPhasesMock.mockResolvedValue({
      data: [
        {
          id: "phase-2",
          phaseIndex: 2,
          phaseKind: "parallel",
          triggerType: "execute",
          status: "awaiting_adoption",
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
          status: "awaiting_adoption",
          anchorSessionId: "session-1",
          startedAt: "2026-04-12T10:00:00.000Z",
          createdAt: "2026-04-12T10:00:00.000Z",
          updatedAt: "2026-04-12T10:06:30.000Z",
        },
        sessions: [
          {
            id: "candidate-1",
            runtimeSessionId: "runtime-candidate-1",
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
            runtimeSessionId: "runtime-candidate-2",
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
            runtimeSessionId: "runtime-candidate-1",
            phaseRole: "candidate",
            candidateIndex: 0,
            timelineMeta: {
              cacheState: "complete",
              complete: true,
              itemCount: 1,
            },
            messages: [
              {
                id: "candidate-1-user",
                role: "user",
                text: "候选一提示词",
                createdAt: "2026-04-12T10:00:11.000Z",
              },
              {
                id: "candidate-1-assistant",
                role: "assistant",
                text: "候选一回复",
                createdAt: "2026-04-12T10:00:12.000Z",
              },
            ],
          },
          {
            taskSessionId: "candidate-2",
            runtimeSessionId: "runtime-candidate-2",
            phaseRole: "candidate",
            candidateIndex: 1,
            timelineMeta: {
              cacheState: "complete",
              complete: true,
              itemCount: 1,
            },
            messages: [
              {
                id: "candidate-2-assistant",
                role: "assistant",
                text: "候选二回复",
                createdAt: "2026-04-12T10:00:21.000Z",
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
    await Promise.resolve();
    await Promise.resolve();

    expect(getTaskConversationMessagesMock).not.toHaveBeenCalled();
    expect(getTaskExecutionTraceViewMock).not.toHaveBeenCalled();

    const parallelItem = flow.conversationItems.value.find((item) => item.role === "parallel") as
      | {
          candidates?: Array<{ items: Array<{ text?: string }> }>;
        }
      | undefined;

    expect(parallelItem?.candidates?.map((candidate) => candidate.items.map((item) => item.text))).toEqual([
      ["候选一回复"],
      ["候选二回复"],
    ]);
  });

  it("applies current phase realtime user and tool patches to phase blocks", () => {
    const { currentPhaseId, flow, phaseSlices } = mountFlow();
    currentPhaseId.value = "phase-2";
    phaseSlices.value = [
      {
        phase: {
          id: "phase-1",
          phaseIndex: 1,
          phaseKind: "single",
          triggerType: "execute",
          status: "completed",
          startedAt: "2026-04-14T09:59:00.000Z",
        },
        sourceMessages: [
          {
            id: "phase-1-user",
            role: "user",
            text: "第一阶段问题",
            createdAt: "2026-04-14T09:59:01.000Z",
          },
        ],
      },
      {
        phase: {
          id: "phase-2",
          phaseIndex: 2,
          phaseKind: "single",
          triggerType: "continue",
          status: "running",
          startedAt: "2026-04-14T10:00:00.000Z",
        },
        sourceMessages: [
          {
            id: "phase-2-user",
            role: "user",
            text: "第二阶段问题",
            createdAt: "2026-04-14T10:00:01.000Z",
          },
        ],
      },
    ];
    patchConsumerState.patchEventsByTaskId = {
      "task-1": [
        {
          eventId: "evt-phase-1-tool",
          taskId: "task-1",
          phaseId: "phase-1",
          sessionId: "session-1",
          rawEventKind: "task.message.updated",
          kind: "tool-message",
          messageId: "phase-1-tool",
          rawMessage: {
            id: "phase-1-tool",
            role: "tool",
            parts: [
              {
                type: "tool",
                toolName: "grep_search",
                state: "completed",
                input: {
                  query: "phase-1 log",
                },
              },
            ],
            createdAt: "2026-04-14T09:59:02.000Z",
          },
        },
        {
          eventId: "evt-phase-2-tool",
          taskId: "task-1",
          phaseId: "phase-2",
          sessionId: "session-1",
          rawEventKind: "task.message.updated",
          kind: "tool-message",
          messageId: "phase-2-tool",
          rawMessage: {
            id: "phase-2-tool",
            role: "tool",
            parts: [
              {
                type: "tool",
                toolName: "read_file",
                state: "completed",
                input: {
                  filePath: "docs/phase-2.md",
                },
              },
            ],
            createdAt: "2026-04-14T10:00:03.000Z",
          },
        },
        {
          eventId: "evt-phase-2-user-followup",
          taskId: "task-1",
          phaseId: "phase-2",
          sessionId: "session-1",
          rawEventKind: "task.message.updated",
          kind: "user-message",
          messageId: "phase-2-user-followup",
          rawMessage: {
            id: "phase-2-user-followup",
            role: "user",
            text: "继续排查 phase-2",
            createdAt: "2026-04-14T10:00:02.000Z",
          },
        },
      ],
    };
    patchConsumerState.taskPatchEventSignature = "signature-1";

    expect(flow.phaseBlocks.value[0]?.items.map((item) => item.key)).toEqual(["phase-1-user"]);
    expect(flow.phaseBlocks.value[1]?.items.map((item) => item.key)).toEqual([
      "phase-2-user",
      "phase-2-user-followup",
      "phase-2-tool",
    ]);
  });
});
