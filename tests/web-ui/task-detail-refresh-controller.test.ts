import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDetailRefreshRequest } from "../../control-plane/web-ui/src/lib/task-detail-refresh-policy";
import { useTaskDetailRefreshController } from "../../control-plane/web-ui/src/composables/useTaskDetailRefreshController";

describe("task detail refresh controller", () => {
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
    const forceMessagePolling = ref(false);
    const skipMessageRefreshEventId = ref<string | null>(null);
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
        forceMessagePolling,
        skipMessageRefreshEventId,
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
      controller,
      latestTaskRefreshRequest,
      refreshFlowSnapshot,
      refreshMessageSnapshot,
      refreshTaskSnapshot,
    };
  }

  it("forwards the request phaseId into message-only refreshes", async () => {
    const { latestTaskRefreshRequest, refreshMessageSnapshot } = mountController();

    latestTaskRefreshRequest.value = {
      eventId: "event-phase-messages-1",
      reason: "round-synced",
      phaseId: "phase-77",
      targets: {
        workflow: false,
        flow: false,
        messages: true,
      },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();
    vi.advanceTimersByTime(180);
    await nextTick();

    expect(refreshMessageSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshMessageSnapshot).toHaveBeenCalledWith("phase-77");
  });

  it.each([
    "phase-awaiting-adoption",
    "phase-paused",
    "phase-resumed",
    "phase-failed",
  ] as const)("dispatches %s requests to the flow-only refresh path", async (reason) => {
    const { latestTaskRefreshRequest, refreshFlowSnapshot, refreshMessageSnapshot, refreshTaskSnapshot } =
      mountController();

    latestTaskRefreshRequest.value = {
      eventId: `event-${reason}`,
      reason,
      phaseId: "phase-2",
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
    expect(refreshMessageSnapshot).not.toHaveBeenCalled();
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();
  });
});