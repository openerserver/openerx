import { computed, effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyLiveAssistantState } from "../lib/message-normalize";
import { useTaskDetailParallelFlow } from "./useTaskDetailParallelFlow";

const getTaskAgentRunsMock = vi.fn();

vi.mock("../lib/api", () => ({
  getTaskAgentRuns: getTaskAgentRunsMock,
}));

vi.mock("./useTaskMessagePatchConsumer", () => ({
  useTaskMessagePatchConsumer: () => ({
    taskPatchEventSignature: computed(() => "signature"),
    getLiveAssistantState: () => createEmptyLiveAssistantState(),
  }),
}));

describe("useTaskDetailParallelFlow", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    getTaskAgentRunsMock.mockReset();
    getTaskAgentRunsMock.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountFlow() {
    const taskId = ref("task-1");
    const taskNodeId = ref("node-task-1");
    const task = ref({
      id: "task-1",
      sessionId: "session-1",
      status: "running",
      executionMode: "single",
    } as any);
    const taskSessionSummaries = ref([] as any[]);
    const flatNodes = ref([] as any[]);
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
        taskId,
        taskNodeId,
        task,
        taskSessionSummaries,
        flatNodes,
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
      flow,
      getTaskAgentRunsMock,
      refreshRuntimePermissions,
      refreshSessions,
      refreshTask,
      selectedSessionId,
    };
  }

  it("refreshes flow snapshot through the flow feature", async () => {
    const { flow, refreshRuntimePermissions, refreshSessions, refreshTask, selectedSessionId } =
      mountFlow();

    await flow.refreshFlowSnapshot();

    expect(refreshTask).toHaveBeenCalledWith(true);
    expect(refreshSessions).toHaveBeenCalledWith(true);
    expect(getTaskAgentRunsMock).toHaveBeenCalledWith("task-1");
    expect(refreshRuntimePermissions).toHaveBeenCalledWith(true);
    expect(selectedSessionId.value).toBe("session-1");
  });

  it("loads the initial flow snapshot without forcing a task refresh", async () => {
    const { flow, refreshRuntimePermissions, refreshSessions, refreshTask } = mountFlow();

    await flow.loadInitialFlowSnapshot();

    expect(refreshTask).not.toHaveBeenCalled();
    expect(refreshSessions).toHaveBeenCalledTimes(1);
    expect(refreshSessions).toHaveBeenCalledWith();
    expect(getTaskAgentRunsMock).toHaveBeenCalledWith("task-1");
    expect(refreshRuntimePermissions).toHaveBeenCalledWith(true);
  });
});
