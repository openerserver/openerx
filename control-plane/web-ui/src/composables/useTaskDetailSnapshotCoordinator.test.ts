import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskDetailSnapshotCoordinator } from "./useTaskDetailSnapshotCoordinator";

const getTaskWorkflowViewMock = vi.fn();
const getTaskMemberViewMock = vi.fn();

vi.mock("../lib/api", () => ({
  getTaskWorkflowView: getTaskWorkflowViewMock,
  getTaskMemberView: getTaskMemberViewMock,
}));

describe("useTaskDetailSnapshotCoordinator", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    getTaskWorkflowViewMock.mockReset();
    getTaskMemberViewMock.mockReset();
    getTaskWorkflowViewMock.mockResolvedValue({ workflow: { stages: [] } });
    getTaskMemberViewMock.mockResolvedValue({ members: [] });
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountCoordinator() {
    const taskId = ref("task-1");
    const projectId = ref<string | null>("project-1");
    const task = ref<{ status?: string | null }>({ status: "running" });
    const isParallelComparisonMode = ref(false);
    const refreshTask = vi.fn(async () => undefined);
    const refreshSessions = vi.fn(async () => undefined);
    const refreshMessages = vi.fn(async () => undefined);
    const refreshTaskRunSummaries = vi.fn(async () => undefined);
    const refreshParallelCandidateMessages = vi.fn(async () => undefined);
    const clearParallelCandidateState = vi.fn();
    const refreshRuntimePermissions = vi.fn(async () => undefined);
    const ensureSelectedSession = vi.fn();
    const subscribeProject = vi.fn();
    const subscribeTask = vi.fn();

    scope = effectScope();
    const coordinator = scope.run(() =>
      useTaskDetailSnapshotCoordinator({
        taskId,
        projectId,
        task,
        isParallelComparisonMode: () => isParallelComparisonMode.value,
        refreshTask,
        refreshSessions,
        refreshMessages,
        refreshTaskRunSummaries,
        refreshParallelCandidateMessages,
        clearParallelCandidateState,
        refreshRuntimePermissions,
        ensureSelectedSession,
        subscribeProject,
        subscribeTask,
      }),
    );
    if (!coordinator) {
      throw new Error("expected task detail snapshot coordinator");
    }

    return {
      taskId,
      projectId,
      task,
      isParallelComparisonMode,
      refreshTask,
      refreshSessions,
      refreshMessages,
      refreshTaskRunSummaries,
      refreshParallelCandidateMessages,
      clearParallelCandidateState,
      refreshRuntimePermissions,
      ensureSelectedSession,
      subscribeProject,
      subscribeTask,
      coordinator,
    };
  }

  it("keeps flow refreshes off when the refresh request only targets workflow and messages", async () => {
    const {
      coordinator,
      refreshTask,
      refreshSessions,
      refreshMessages,
      refreshTaskRunSummaries,
      refreshParallelCandidateMessages,
      clearParallelCandidateState,
      refreshRuntimePermissions,
    } = mountCoordinator();

    await coordinator.refreshTaskSnapshot({
      workflow: true,
      flow: false,
      messages: true,
    });

    expect(refreshTask).toHaveBeenCalledWith(true);
    expect(getTaskWorkflowViewMock).toHaveBeenCalledWith("task-1");
    expect(getTaskMemberViewMock).toHaveBeenCalledWith("task-1");
    expect(refreshSessions).not.toHaveBeenCalled();
    expect(refreshTaskRunSummaries).not.toHaveBeenCalled();
    expect(refreshParallelCandidateMessages).not.toHaveBeenCalled();
    expect(clearParallelCandidateState).not.toHaveBeenCalled();
    expect(refreshRuntimePermissions).not.toHaveBeenCalled();
    expect(refreshMessages).toHaveBeenCalledWith(true);
  });

  it("centralizes flow refresh work and clears parallel state when comparison mode is off", async () => {
    const {
      coordinator,
      refreshSessions,
      refreshTaskRunSummaries,
      refreshParallelCandidateMessages,
      clearParallelCandidateState,
      refreshRuntimePermissions,
      ensureSelectedSession,
    } = mountCoordinator();

    coordinator.workflowView.value = { workflow: { stages: [] } } as never;

    await coordinator.refreshTaskSnapshot({
      workflow: false,
      flow: true,
      messages: false,
    });

    expect(refreshSessions).toHaveBeenCalledWith(true);
    expect(refreshTaskRunSummaries).toHaveBeenCalledWith("task-1", true);
    expect(refreshParallelCandidateMessages).not.toHaveBeenCalled();
    expect(clearParallelCandidateState).toHaveBeenCalledTimes(1);
    expect(ensureSelectedSession).toHaveBeenCalledTimes(2);
    expect(refreshRuntimePermissions).toHaveBeenCalledWith(true);
  });

  it("loads the initial task detail snapshot and subscribes realtime channels", async () => {
    const {
      coordinator,
      isParallelComparisonMode,
      refreshSessions,
      refreshTaskRunSummaries,
      refreshParallelCandidateMessages,
      refreshRuntimePermissions,
      subscribeProject,
      subscribeTask,
    } = mountCoordinator();

    isParallelComparisonMode.value = true;

    await coordinator.loadInitialSnapshot();

    expect(getTaskWorkflowViewMock).toHaveBeenCalledWith("task-1");
    expect(getTaskMemberViewMock).toHaveBeenCalledWith("task-1");
    expect(refreshSessions).toHaveBeenCalledTimes(1);
    expect(refreshSessions).toHaveBeenCalledWith();
    expect(refreshTaskRunSummaries).toHaveBeenCalledWith("task-1", true);
    expect(refreshParallelCandidateMessages).toHaveBeenCalledWith("task-1", true);
    expect(refreshRuntimePermissions).toHaveBeenCalledWith(true);
    expect(subscribeProject).toHaveBeenCalledWith("project-1");
    expect(subscribeTask).toHaveBeenCalledWith("task-1");
    expect(coordinator.memberViewLoading.value).toBe(false);
  });
});