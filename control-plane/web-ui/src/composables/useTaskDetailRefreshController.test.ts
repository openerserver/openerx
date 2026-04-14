import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDetailRefreshRequest } from "../lib/task-detail-refresh-policy";
import { useTaskDetailRefreshController } from "./useTaskDetailRefreshController";

describe("useTaskDetailRefreshController", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
    vi.useRealTimers();
  });

  function mountController() {
    const taskId = ref("task-1");
    const latestTaskRefreshRequest = ref<TaskDetailRefreshRequest | null>(null);
    const messageReconcileRequired = ref(false);
    const workflowReconcileRequired = ref(false);
    const realtimeConnected = ref(true);
    const shouldPollRunningStatus = ref(false);
    const refreshFlowSnapshot = vi.fn(async () => undefined);
    const refreshMessageSnapshot = vi.fn(async () => undefined);
    const refreshTaskSnapshot = vi.fn(async () => undefined);
    const refreshWorkflowSnapshot = vi.fn(async () => undefined);

    scope = effectScope();
    const controller = scope.run(() =>
      useTaskDetailRefreshController({
        taskId,
        latestTaskRefreshRequest,
        messageReconcileRequired,
        workflowReconcileRequired,
        realtimeConnected,
        shouldPollRunningStatus,
        refreshFlowSnapshot,
        refreshMessageSnapshot,
        refreshTaskSnapshot,
        refreshWorkflowSnapshot,
      }),
    );
    if (!controller) {
      throw new Error("expected task detail refresh controller");
    }

    return {
      latestTaskRefreshRequest,
      messageReconcileRequired,
      workflowReconcileRequired,
      realtimeConnected,
      shouldPollRunningStatus,
      refreshFlowSnapshot,
      refreshMessageSnapshot,
      refreshTaskSnapshot,
      refreshWorkflowSnapshot,
      controller,
    };
  }

  it("dispatches message-only refresh requests to the message path", async () => {
    const { latestTaskRefreshRequest, refreshMessageSnapshot, refreshTaskSnapshot } = mountController();

    latestTaskRefreshRequest.value = {
      eventId: "event-1",
      reason: "round-synced",
      targets: {
        workflow: false,
        flow: false,
        messages: true,
      },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();
    vi.advanceTimersByTime(179);
    expect(refreshMessageSnapshot).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await nextTick();
    expect(refreshMessageSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
  });

  it("dispatches flow-only refresh requests to the flow path", async () => {
    const { latestTaskRefreshRequest, refreshFlowSnapshot, refreshTaskSnapshot } = mountController();

    latestTaskRefreshRequest.value = {
      eventId: "event-phase-1",
      reason: "phase-awaiting-adoption",
      targets: {
        workflow: false,
        flow: true,
        messages: false,
      },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();
    vi.advanceTimersByTime(180);
    await nextTick();

    expect(refreshFlowSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
  });

  it("dispatches flow reconcile requests to the flow path", async () => {
    const { latestTaskRefreshRequest, refreshFlowSnapshot, refreshTaskSnapshot } = mountController();

    latestTaskRefreshRequest.value = {
      eventId: "event-flow-reconcile-1",
      reason: "flow-reconcile-required",
      targets: {
        workflow: false,
        flow: true,
        messages: false,
      },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();
    vi.advanceTimersByTime(180);
    await nextTick();

    expect(refreshFlowSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
  });

  it("dispatches workflow-only refresh requests to the workflow path", async () => {
    const { latestTaskRefreshRequest, refreshTaskSnapshot, refreshWorkflowSnapshot } = mountController();

    latestTaskRefreshRequest.value = {
      eventId: "event-workflow-1",
      reason: "task-followup-completed",
      targets: {
        workflow: true,
        flow: false,
        messages: false,
      },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();
    vi.advanceTimersByTime(180);
    await nextTick();

    expect(refreshWorkflowSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
  });

  it("uses the combined snapshot path when one request spans multiple refresh targets", async () => {
    const { latestTaskRefreshRequest, refreshFlowSnapshot, refreshTaskSnapshot, refreshWorkflowSnapshot } = mountController();

    latestTaskRefreshRequest.value = {
      eventId: "event-session-1",
      reason: "session-created",
      targets: {
        workflow: true,
        flow: true,
        messages: false,
      },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();
    vi.advanceTimersByTime(180);
    await nextTick();

    expect(refreshTaskSnapshot).toHaveBeenCalledWith({
      workflow: true,
      flow: true,
      messages: false,
    });
    expect(refreshWorkflowSnapshot).not.toHaveBeenCalled();
    expect(refreshFlowSnapshot).not.toHaveBeenCalled();
  });

  it("uses the combined snapshot path for task-wide reconcile requests", async () => {
    const { latestTaskRefreshRequest, refreshMessageSnapshot, refreshTaskSnapshot } = mountController();

    latestTaskRefreshRequest.value = {
      eventId: "event-task-reconcile-1",
      reason: "task-reconcile-required",
      targets: {
        workflow: true,
        flow: true,
        messages: true,
      },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();
    vi.advanceTimersByTime(180);
    await nextTick();

    expect(refreshTaskSnapshot).toHaveBeenCalledWith({
      workflow: true,
      flow: true,
      messages: true,
    });
    expect(refreshMessageSnapshot).not.toHaveBeenCalled();
  });

  it("bumps the trace refresh key for trace refresh requests", async () => {
    const { latestTaskRefreshRequest, controller } = mountController();

    latestTaskRefreshRequest.value = {
      eventId: "event-2",
      reason: "task-followup-completed",
      targets: {
        workflow: true,
        flow: false,
        messages: false,
      },
      shouldBumpTraceRefreshKey: true,
    };

    await nextTick();

    expect(controller.traceRefreshKey.value).toBe(1);
  });

  it("polls running status and gates message refresh on realtime connectivity", async () => {
    const {
      realtimeConnected,
      shouldPollRunningStatus,
      refreshFlowSnapshot,
      refreshTaskSnapshot,
    } = mountController();

    shouldPollRunningStatus.value = true;
    await nextTick();

    vi.advanceTimersByTime(2000);
    await nextTick();
    expect(refreshFlowSnapshot).toHaveBeenNthCalledWith(1);

    realtimeConnected.value = false;
    vi.advanceTimersByTime(2000);
    await nextTick();
    expect(refreshTaskSnapshot).toHaveBeenNthCalledWith(1, {
      workflow: false,
      flow: true,
      messages: true,
    });

    shouldPollRunningStatus.value = false;
    await nextTick();
    vi.advanceTimersByTime(2000);
    await nextTick();
    expect(refreshFlowSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshTaskSnapshot).toHaveBeenCalledTimes(1);
  });

  it("refreshes canonical messages once realtime reconnects", async () => {
    const { realtimeConnected, refreshMessageSnapshot, refreshTaskSnapshot } = mountController();

    realtimeConnected.value = false;
    await nextTick();

    realtimeConnected.value = true;
    await nextTick();
    vi.advanceTimersByTime(180);
    await nextTick();

    expect(refreshMessageSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
  });

  it("refreshes canonical messages when the snapshot reports reconcile required", async () => {
    const { messageReconcileRequired, refreshMessageSnapshot, refreshTaskSnapshot } = mountController();

    messageReconcileRequired.value = true;
    await nextTick();
    vi.advanceTimersByTime(180);
    await nextTick();

    expect(refreshMessageSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
  });

  it("refreshes workflow when the sidebar snapshot reports reconcile required", async () => {
    const { workflowReconcileRequired, refreshTaskSnapshot, refreshWorkflowSnapshot } = mountController();

    workflowReconcileRequired.value = true;
    await nextTick();
    vi.advanceTimersByTime(180);
    await nextTick();

    expect(refreshWorkflowSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
  });
});