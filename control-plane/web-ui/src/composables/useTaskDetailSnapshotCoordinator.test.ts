import { effectScope, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTaskDetailSnapshotCoordinator } from "./useTaskDetailSnapshotCoordinator";

describe("useTaskDetailSnapshotCoordinator", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountCoordinator() {
    const taskId = ref("task-1");
    const projectId = ref<string | null>("project-1");
    const refreshMessages = vi.fn(async () => undefined);
    const refreshFlowSnapshot = vi.fn(async () => undefined);
    const refreshWorkflowSnapshot = vi.fn(async () => undefined);
    const loadInitialFlowSnapshot = vi.fn(async () => undefined);
    const loadInitialWorkflowSnapshot = vi.fn(async () => undefined);
    const resetFlowSnapshotState = vi.fn();
    const resetWorkflowTargetState = vi.fn();
    const subscribeProject = vi.fn();
    const subscribeTask = vi.fn();

    scope = effectScope();
    const coordinator = scope.run(() =>
      useTaskDetailSnapshotCoordinator({
        taskId,
        projectId,
        refreshMessages,
        refreshFlowSnapshot,
        refreshWorkflowSnapshot,
        loadInitialFlowSnapshot,
        loadInitialWorkflowSnapshot,
        resetFlowSnapshotState,
        resetWorkflowTargetState,
        subscribeProject,
        subscribeTask,
      }),
    );
    if (!coordinator) {
      throw new Error("expected task detail snapshot coordinator");
    }

    return {
      coordinator,
      loadInitialFlowSnapshot,
      loadInitialWorkflowSnapshot,
      refreshFlowSnapshot,
      refreshMessages,
      refreshWorkflowSnapshot,
      resetFlowSnapshotState,
      resetWorkflowTargetState,
      subscribeProject,
      subscribeTask,
    };
  }

  it("refreshes messages without touching workflow or flow state", async () => {
    const { coordinator, refreshFlowSnapshot, refreshMessages, refreshWorkflowSnapshot } =
      mountCoordinator();

    await coordinator.refreshMessageSnapshot();

    expect(refreshMessages).toHaveBeenCalledWith(true);
    expect(refreshFlowSnapshot).not.toHaveBeenCalled();
    expect(refreshWorkflowSnapshot).not.toHaveBeenCalled();
  });

  it("refreshes workflow and messages when both targets are requested", async () => {
    const { coordinator, refreshFlowSnapshot, refreshMessages, refreshWorkflowSnapshot } =
      mountCoordinator();

    await coordinator.refreshTaskSnapshot({
      workflow: true,
      flow: false,
      messages: true,
    });

    expect(refreshWorkflowSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshMessages).toHaveBeenCalledWith(true);
    expect(refreshFlowSnapshot).not.toHaveBeenCalled();
  });

  it("refreshes flow without touching workflow or messages when only flow is requested", async () => {
    const { coordinator, refreshFlowSnapshot, refreshMessages, refreshWorkflowSnapshot } =
      mountCoordinator();

    await coordinator.refreshTaskSnapshot({
      workflow: false,
      flow: true,
      messages: false,
    });

    expect(refreshFlowSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshWorkflowSnapshot).not.toHaveBeenCalled();
    expect(refreshMessages).not.toHaveBeenCalled();
  });

  it("loads initial workflow and flow state before subscribing realtime channels", async () => {
    const {
      coordinator,
      loadInitialFlowSnapshot,
      loadInitialWorkflowSnapshot,
      subscribeProject,
      subscribeTask,
    } = mountCoordinator();

    await coordinator.loadInitialSnapshot();

    expect(loadInitialWorkflowSnapshot).toHaveBeenCalledTimes(1);
    expect(loadInitialFlowSnapshot).toHaveBeenCalledTimes(1);
    expect(subscribeProject).toHaveBeenCalledWith("project-1");
    expect(subscribeTask).toHaveBeenCalledWith("task-1");
  });

  it("resets workflow and flow feature state together", () => {
    const { coordinator, resetFlowSnapshotState, resetWorkflowTargetState } = mountCoordinator();

    coordinator.resetSnapshotState();

    expect(resetWorkflowTargetState).toHaveBeenCalledTimes(1);
    expect(resetFlowSnapshotState).toHaveBeenCalledTimes(1);
  });
});
