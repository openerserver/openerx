import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useTaskDetailPollingStateMock, useTaskDetailRefreshControllerMock } = vi.hoisted(() => ({
  useTaskDetailPollingStateMock: vi.fn(),
  useTaskDetailRefreshControllerMock: vi.fn(),
}));

vi.mock("./useTaskDetailDerivedState", () => ({
  useTaskDetailPollingState: useTaskDetailPollingStateMock,
}));

vi.mock("./useTaskDetailRefreshController", () => ({
  useTaskDetailRefreshController: useTaskDetailRefreshControllerMock,
}));

import { useTaskDetailRealtimeFeature } from "./useTaskDetailRealtimeFeature";

describe("useTaskDetailRealtimeFeature", () => {
  beforeEach(() => {
    useTaskDetailPollingStateMock.mockReset();
    useTaskDetailRefreshControllerMock.mockReset();
  });

  it("pipes polling state into the realtime refresh controller", () => {
    const shouldPollRunningStatus = ref(true);
    const traceRefreshKey = ref(9);

    useTaskDetailPollingStateMock.mockReturnValue({
      shouldPollRunningStatus,
    });
    useTaskDetailRefreshControllerMock.mockReturnValue({
      traceRefreshKey,
    });

    const isExecuting = ref(true);
    const hasStreamingAssistant = ref(false);
    const continuing = ref(false);
    const forking = ref(false);
    const taskId = ref("task-1");
    const latestTaskRefreshRequest = ref(null);
    const messageReconcileRequired = ref(false);
    const workflowReconcileRequired = ref(false);
    const realtimeConnected = ref(true);
    const refreshFlowSnapshot = vi.fn();
    const refreshMessageSnapshot = vi.fn();
    const refreshTaskSnapshot = vi.fn();
    const refreshWorkflowSnapshot = vi.fn();

    const feature = useTaskDetailRealtimeFeature({
      polling: {
        isExecuting,
        hasStreamingAssistant,
        continuing,
        forking,
      },
      subscription: {
        taskId,
        latestTaskRefreshRequest,
        messageReconcileRequired,
        workflowReconcileRequired,
        realtimeConnected,
        refreshFlowSnapshot,
        refreshMessageSnapshot,
        refreshTaskSnapshot,
        refreshWorkflowSnapshot,
      },
    });

    expect(useTaskDetailPollingStateMock).toHaveBeenCalledWith({
      isExecuting,
      hasStreamingAssistant,
      continuing,
      forking,
    });
    expect(useTaskDetailRefreshControllerMock).toHaveBeenCalledWith({
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
    });
    expect(feature.shouldPollRunningStatus).toBe(shouldPollRunningStatus);
    expect(feature.traceRefreshKey).toBe(traceRefreshKey);
  });
});