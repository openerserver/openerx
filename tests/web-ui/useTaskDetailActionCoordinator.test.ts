import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  adoptParallelCandidate: vi.fn(),
  continueTask: vi.fn(),
  forkTaskSession: vi.fn(),
  replyTaskRuntimePermission: vi.fn(),
  terminateAgent: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("ant-design-vue", () => ({
  message: messageMocks,
}));

vi.mock("../../control-plane/web-ui/src/lib/api", () => ({
  adoptParallelCandidate: apiMocks.adoptParallelCandidate,
  continueTask: apiMocks.continueTask,
  forkTaskSession: apiMocks.forkTaskSession,
  replyTaskRuntimePermission: apiMocks.replyTaskRuntimePermission,
  terminateAgent: apiMocks.terminateAgent,
}));

import { useTaskDetailActionCoordinator } from "../../control-plane/web-ui/src/composables/useTaskDetailActionCoordinator";

describe("useTaskDetailActionCoordinator", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    apiMocks.adoptParallelCandidate.mockReset();
    apiMocks.continueTask.mockReset();
    apiMocks.forkTaskSession.mockReset();
    apiMocks.replyTaskRuntimePermission.mockReset();
    apiMocks.terminateAgent.mockReset();
    messageMocks.error.mockReset();
    messageMocks.info.mockReset();
    messageMocks.success.mockReset();
    messageMocks.warning.mockReset();
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountCoordinator() {
    const taskId = ref("task-1");
    const task = ref<any>({
      id: "task-1",
      sessionId: "ses-parent",
      status: "completed",
      selectedModel: null,
    });
    const selectedSessionId = ref<string | undefined>("ses-history");
    const selectedSessionLabel = ref("主分支");
    const currentParallelRunRecord = ref(null);
    const editableExecutionMode = ref<any>("single");
    const isExecuting = ref(false);
    const hasStreamingAssistant = ref(false);
    const canTerminateExecution = ref(false);
    const baseConversationItems = ref<any[]>([
      { key: "user-first", role: "user", text: "first" },
      { key: "user-second", role: "user", text: "second" },
      { key: "assistant-final", role: "assistant", text: "reply" },
    ]);
    const messageTrace = ref<any>({ sessionId: "ses-parent" });
    const clearPendingAssistantDraft = vi.fn();
    const refreshTask = vi.fn(async () => undefined);
    const refreshSessions = vi.fn(async () => undefined);
    const refreshMessages = vi.fn(async () => {
      messageTrace.value = { sessionId: selectedSessionId.value };
    });
    const refreshTaskSnapshot = vi.fn(async () => undefined);
    const refreshRuntimePermissions = vi.fn(async () => undefined);
    const resolveTaskSessionRequestId = vi.fn((sessionId?: string | null) => sessionId ?? undefined);
    const seedPendingAssistantDraft = vi.fn();

    scope = effectScope();
    const coordinator = scope.run(() =>
      useTaskDetailActionCoordinator({
        taskId,
        task,
        selectedSessionId,
        selectedSessionLabel,
        currentParallelRunRecord,
        editableExecutionMode,
        isExecuting,
        hasStreamingAssistant,
        canTerminateExecution,
        baseConversationItems,
        messageTrace,
        clearPendingAssistantDraft,
        refreshTask,
        refreshSessions,
        refreshMessages,
        refreshTaskSnapshot,
        refreshRuntimePermissions,
        resolveTaskSessionRequestId,
        seedPendingAssistantDraft,
      }),
    );
    if (!coordinator) {
      throw new Error("expected task detail action coordinator");
    }

    return {
      coordinator,
      currentParallelRunRecord,
      isExecuting,
      refreshTaskSnapshot,
      resolveTaskSessionRequestId,
      seedPendingAssistantDraft,
      selectedSessionId,
      task,
    };
  }

  it("routes queued follow-ups to the latest returned child session before task refresh catches up", async () => {
    apiMocks.continueTask
      .mockResolvedValueOnce({ ok: true, sessionId: "ses-child-1" })
      .mockResolvedValueOnce({ ok: true, sessionId: "ses-child-2" });

    const {
      coordinator,
      isExecuting,
      resolveTaskSessionRequestId,
      seedPendingAssistantDraft,
      selectedSessionId,
      task,
    } = mountCoordinator();

    await coordinator.handleContinue("first");

    expect(resolveTaskSessionRequestId).toHaveBeenNthCalledWith(1, "ses-parent");
    expect(apiMocks.continueTask).toHaveBeenNthCalledWith(
      1,
      "task-1",
      "first",
      "ses-parent",
      "single",
    );
    expect(task.value.sessionId).toBe("ses-parent");
    expect(selectedSessionId.value).toBe("ses-child-1");
    expect(seedPendingAssistantDraft).toHaveBeenLastCalledWith("ses-child-1");

    isExecuting.value = true;
    await nextTick();
    await coordinator.handleContinue("second");
    expect(coordinator.queuedContinuations.value).toHaveLength(1);

    isExecuting.value = false;
    await nextTick();
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();

    expect(resolveTaskSessionRequestId).toHaveBeenNthCalledWith(2, "ses-child-1");
    expect(apiMocks.continueTask).toHaveBeenNthCalledWith(
      2,
      "task-1",
      "second",
      "ses-child-1",
      "single",
    );
    expect(selectedSessionId.value).toBe("ses-child-2");
    expect(seedPendingAssistantDraft).toHaveBeenLastCalledWith("ses-child-2");
    await vi.waitFor(() => {
      expect(coordinator.queuedContinuations.value).toHaveLength(0);
    });
  });

  it("adopts a parallel candidate with the canonical phase id from the current run", async () => {
    apiMocks.adoptParallelCandidate.mockResolvedValueOnce({ ok: true, winnerCandidateIndex: 1 });

    const { coordinator, currentParallelRunRecord, refreshTaskSnapshot } = mountCoordinator();
    currentParallelRunRecord.value = {
      parallelRunId: "task-session:phase-parallel-1",
      phaseId: "phase-parallel-1",
      startedAt: "2026-03-22T10:00:00.000Z",
      candidateSessions: [
        { label: "候选 A", status: "completed", sessionId: "ses-a" },
        { label: "候选 B", status: "completed", sessionId: "ses-b" },
      ],
    } as any;

    await coordinator.handleAdoptCandidate(1);

    expect(apiMocks.adoptParallelCandidate).toHaveBeenCalledWith(
      "task-1",
      "phase-parallel-1",
      1,
    );
    expect(refreshTaskSnapshot).toHaveBeenCalledWith({
      workflow: true,
      flow: true,
      messages: true,
    });
    expect(messageMocks.error).not.toHaveBeenCalled();
  });
});