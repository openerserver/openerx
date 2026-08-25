import { effectScope, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  TaskExecutionReconcileEnvelope,
  TaskExecutionTrace,
  TaskSessionRecord,
} from "../lib/api";
import type { TaskConversationListItem } from "../lib/message-normalize";
import { useTaskConversationActions } from "./useTaskConversationActions";

const continueTaskMock = vi.hoisted(() => vi.fn());
const forkTaskSessionMock = vi.hoisted(() => vi.fn());
const terminateTaskExecutionMock = vi.hoisted(() => vi.fn());
const messageSuccessMock = vi.hoisted(() => vi.fn());
const messageErrorMock = vi.hoisted(() => vi.fn());
const messageWarningMock = vi.hoisted(() => vi.fn());

vi.mock("ant-design-vue", () => ({
  message: {
    success: messageSuccessMock,
    error: messageErrorMock,
    warning: messageWarningMock,
  },
}));

vi.mock("../lib/api", () => ({
  continueTask: continueTaskMock,
  forkTaskSession: forkTaskSessionMock,
  terminateTaskExecution: terminateTaskExecutionMock,
}));

describe("useTaskConversationActions", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
    continueTaskMock.mockReset();
    forkTaskSessionMock.mockReset();
    terminateTaskExecutionMock.mockReset();
    messageSuccessMock.mockReset();
    messageErrorMock.mockReset();
    messageWarningMock.mockReset();
  });

  function mountActions(overrides?: {
    isExecuting?: boolean;
    hasStreamingAssistant?: boolean;
    baseConversationItems?: TaskConversationListItem[];
    messageTrace?: TaskExecutionTrace | null;
  }) {
    const taskId = ref("task-1");
    const task = ref({
      id: "task-1",
      sessionId: "session-1",
      status: "idle",
      title: "Task",
    } as any);
    const stopPhaseId = ref<string | null>(null);
    const selectedSessionId = ref<string | undefined>("session-1");
    const selectedSessionLabel = ref("main");
    const editableExecutionMode = ref("single" as any);
    const isExecuting = ref(Boolean(overrides?.isExecuting));
    const hasStreamingAssistant = ref(Boolean(overrides?.hasStreamingAssistant));
    const canTerminateExecution = ref(true);
    const taskSessionSummaries = ref<TaskSessionRecord[]>([
      {
        id: "session-1",
        taskSessionId: "task-session-1",
        title: "main",
        isActive: true,
        summary: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    const baseConversationItems = ref<TaskConversationListItem[]>(
      overrides?.baseConversationItems ?? [],
    );
    const messageTrace = ref<TaskExecutionTrace | null | undefined>(
      overrides?.messageTrace ?? null,
    );
    const conversationFocusToken = ref(0);
    const handleSwitchRound = vi.fn((sessionId?: string, options?: { focus?: boolean }) => {
      selectedSessionId.value = sessionId;
      if (options?.focus === true) {
        conversationFocusToken.value += 1;
      }
    });
    const bumpConversationFocus = vi.fn((sessionId?: string) => {
      if (typeof sessionId !== "undefined") {
        selectedSessionId.value = sessionId;
      }
      conversationFocusToken.value += 1;
    });
    const clearPendingAssistantDraft = vi.fn();
    const refreshTask = vi.fn(async () => undefined);
    const refreshSessions = vi.fn(async () => undefined);
    const refreshTaskSnapshot = vi.fn(async () => undefined);
    const reconcileExecutionEnvelope = vi.fn(async (envelope?: TaskExecutionReconcileEnvelope | null) => {
      const nextSessionId =
        envelope && typeof envelope.nextSessionId === "string" ? envelope.nextSessionId : undefined;
      if (nextSessionId) {
        selectedSessionId.value = nextSessionId;
        conversationFocusToken.value += 1;
      }
    });
    const resolveTaskSessionRequestId = vi.fn((sessionId?: string | null) =>
      sessionId === "session-1" ? "task-session-1" : sessionId ?? undefined,
    );
    const seedPendingAssistantDraft = vi.fn();

    scope = effectScope();
    const actions = scope.run(() =>
      useTaskConversationActions({
        taskId,
        task,
        stopPhaseId,
        selectedSessionId,
        selectedSessionLabel,
        editableExecutionMode,
        isExecuting,
        hasStreamingAssistant,
        canTerminateExecution,
        baseConversationItems,
        messageTrace,
        bumpConversationFocus,
        clearPendingAssistantDraft,
        refreshTask,
        refreshSessions,
        refreshTaskSnapshot,
        reconcileExecutionEnvelope,
        handleSwitchRound,
        resolveTaskSessionRequestId,
        seedPendingAssistantDraft,
      }),
    );

    if (!actions) {
      throw new Error("expected conversation actions");
    }

    return {
      actions,
      task,
      stopPhaseId,
      isExecuting,
      hasStreamingAssistant,
      canTerminateExecution,
      baseConversationItems,
      messageTrace,
      clearPendingAssistantDraft,
      refreshTask,
      refreshSessions,
      refreshTaskSnapshot,
      reconcileExecutionEnvelope,
      seedPendingAssistantDraft,
      selectedSessionId,
      conversationFocusToken,
      bumpConversationFocus,
      handleSwitchRound,
      resolveTaskSessionRequestId,
    };
  }

  it("dispatches continue directly when the conversation is idle", async () => {
    continueTaskMock.mockResolvedValue({
      sessionId: "session-2",
      execution: {
        action: "continue",
        nextSessionId: "session-2",
        taskSessionId: "task-session:task-1:session-2",
        roundId: "task-session:task-1:session-2",
        acceptedRevision: 7,
        refreshTargets: { workflow: true, flow: true, messages: true },
      },
    });

    const prompt = "follow up prompt";
    const {
      actions,
      reconcileExecutionEnvelope,
      seedPendingAssistantDraft,
      selectedSessionId,
      resolveTaskSessionRequestId,
    } =
      mountActions({
        baseConversationItems: [
          {
            key: "user-1",
            role: "user",
            text: prompt,
            toolCalls: [],
            createdAt: "2026-04-08T03:18:17.218Z",
            raw: {},
          },
        ],
        messageTrace: {
          taskId: "task-1",
          sessionId: "session-2",
          segments: [],
          hookExecutions: [],
          followupExecutions: [],
        },
      });

    await actions.handleContinue(prompt);
    await nextTick();

    expect(resolveTaskSessionRequestId).toHaveBeenCalledWith("session-1");
    expect(continueTaskMock).toHaveBeenCalledWith("task-1", prompt, "task-session-1", "single");
    expect(seedPendingAssistantDraft).toHaveBeenCalledWith("session-2");
    expect(reconcileExecutionEnvelope).toHaveBeenCalledWith({
      action: "continue",
      nextSessionId: "session-2",
      taskSessionId: "task-session:task-1:session-2",
      roundId: "task-session:task-1:session-2",
      acceptedRevision: 7,
      refreshTargets: { workflow: true, flow: true, messages: true },
    });
    expect(selectedSessionId.value).toBe("session-2");
    expect(messageSuccessMock).toHaveBeenCalledWith("续跑指令已发送");
  });

  it("queues continue while execution is active and auto-dispatches once idle", async () => {
    continueTaskMock.mockResolvedValue({
      sessionId: "session-2",
      execution: {
        action: "continue",
        nextSessionId: "session-2",
        taskSessionId: "task-session:task-1:session-2",
        roundId: "task-session:task-1:session-2",
        acceptedRevision: 3,
        refreshTargets: { workflow: true, flow: true, messages: true },
      },
    });

    const prompt = "queued prompt";
    const { actions, isExecuting, reconcileExecutionEnvelope, seedPendingAssistantDraft } = mountActions({
      isExecuting: true,
      baseConversationItems: [
        {
          key: "user-1",
          role: "user",
          text: prompt,
          toolCalls: [],
          createdAt: "2026-04-08T03:18:17.218Z",
          raw: {},
        },
      ],
      messageTrace: {
        taskId: "task-1",
        sessionId: "session-2",
        segments: [],
        hookExecutions: [],
        followupExecutions: [],
      },
    });

    await actions.handleContinue(prompt);
    await nextTick();

    expect(actions.queuedContinuations.value).toHaveLength(1);
    expect(continueTaskMock).not.toHaveBeenCalled();

    isExecuting.value = false;
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(continueTaskMock).toHaveBeenCalledWith("task-1", prompt, "task-session-1", "single");
  expect(continueTaskMock).toHaveBeenCalledTimes(1);
    expect(actions.queuedContinuations.value).toHaveLength(0);
    expect(seedPendingAssistantDraft).toHaveBeenCalledWith("session-2");
    expect(reconcileExecutionEnvelope).toHaveBeenCalledTimes(1);
    expect(messageSuccessMock).toHaveBeenCalledWith("已自动发送排队中的输入");
  });

  it("dispatches queued follow-ups against the latest child session before task refresh catches up", async () => {
    continueTaskMock
      .mockResolvedValueOnce({
        sessionId: "session-2",
        execution: {
          action: "continue",
          nextSessionId: "session-2",
          taskSessionId: "task-session:task-1:session-2",
          roundId: "task-session:task-1:session-2",
          acceptedRevision: 4,
          refreshTargets: { workflow: true, flow: true, messages: true },
        },
      })
      .mockResolvedValueOnce({
        sessionId: "session-3",
        execution: {
          action: "continue",
          nextSessionId: "session-3",
          taskSessionId: "task-session:task-1:session-3",
          roundId: "task-session:task-1:session-3",
          acceptedRevision: 5,
          refreshTargets: { workflow: true, flow: true, messages: true },
        },
      });

    const { actions, isExecuting, resolveTaskSessionRequestId, seedPendingAssistantDraft, selectedSessionId, task } =
      mountActions({
        baseConversationItems: [
          {
            key: "user-1",
            role: "user",
            text: "first",
            toolCalls: [],
            createdAt: "2026-04-08T03:18:17.218Z",
            raw: {},
          },
          {
            key: "user-2",
            role: "user",
            text: "second",
            toolCalls: [],
            createdAt: "2026-04-08T03:19:17.218Z",
            raw: {},
          },
        ],
        messageTrace: {
          taskId: "task-1",
          sessionId: "session-2",
          segments: [],
          hookExecutions: [],
          followupExecutions: [],
        },
      });

    await actions.handleContinue("first");

    expect(resolveTaskSessionRequestId).toHaveBeenNthCalledWith(1, "session-1");
    expect(continueTaskMock).toHaveBeenNthCalledWith(
      1,
      "task-1",
      "first",
      "task-session-1",
      "single",
    );
    expect(task.value.sessionId).toBe("session-1");
    expect(selectedSessionId.value).toBe("session-2");
    expect(seedPendingAssistantDraft).toHaveBeenLastCalledWith("session-2");

    isExecuting.value = true;
    await nextTick();
    await actions.handleContinue("second");
    expect(actions.queuedContinuations.value).toHaveLength(1);

    isExecuting.value = false;
    await nextTick();
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();

    expect(resolveTaskSessionRequestId).toHaveBeenNthCalledWith(2, "session-2");
    expect(continueTaskMock).toHaveBeenNthCalledWith(
      2,
      "task-1",
      "second",
      "session-2",
      "single",
    );
    expect(selectedSessionId.value).toBe("session-3");
    expect(seedPendingAssistantDraft).toHaveBeenLastCalledWith("session-3");
    expect(actions.queuedContinuations.value).toHaveLength(0);
  });

  it("terminates through the unified execution envelope when a running task has a current phase", async () => {
    terminateTaskExecutionMock.mockResolvedValue({
      ok: true,
      phaseId: "phase-live-1",
      status: "cancelled",
      execution: {
        action: "terminate",
        nextSessionId: "session-1",
        taskSessionId: "task-session-1",
        roundId: "task-session-1",
        acceptedRevision: null,
        phaseId: "phase-live-1",
        status: "cancelled",
        refreshTargets: { workflow: true, flow: true, messages: true },
      },
    });

    const {
      actions,
      canTerminateExecution,
      clearPendingAssistantDraft,
      reconcileExecutionEnvelope,
      selectedSessionId,
      stopPhaseId,
      task,
    } = mountActions();

    canTerminateExecution.value = true;
    stopPhaseId.value = "phase-live-1";
    task.value.status = "running";
    task.value.agentRunId = undefined;

    await actions.handleTerminate();

    expect(terminateTaskExecutionMock).toHaveBeenCalledWith("task-1", {
      phaseId: "phase-live-1",
      agentRunId: undefined,
      sessionId: "session-1",
      reason: "user_cancelled",
    });
    expect(clearPendingAssistantDraft).toHaveBeenCalledWith(selectedSessionId.value);
    expect(reconcileExecutionEnvelope).toHaveBeenCalledWith({
      action: "terminate",
      nextSessionId: "session-1",
      taskSessionId: "task-session-1",
      roundId: "task-session-1",
      acceptedRevision: null,
      phaseId: "phase-live-1",
      status: "cancelled",
      refreshTargets: { workflow: true, flow: true, messages: true },
    });
    expect(task.value.status).toBe("cancelled");
  });

  it("exposes switch round as a conversation action", async () => {
    const { actions, selectedSessionId, handleSwitchRound } = mountActions();

    actions.handleSwitchRound("session-2", { focus: true });
    await nextTick();

    expect(handleSwitchRound).toHaveBeenCalledWith("session-2", { focus: true });
    expect(selectedSessionId.value).toBe("session-2");
  });
});
