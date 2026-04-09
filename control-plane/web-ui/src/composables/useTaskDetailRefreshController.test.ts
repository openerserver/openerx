import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDetailRefreshRequest } from "../lib/task-detail-refresh-policy";
import {
  toTaskDetailRefreshSnapshotOptions,
  useTaskDetailRefreshController,
} from "./useTaskDetailRefreshController";

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
    const realtimeConnected = ref(true);
    const shouldPollRunningStatus = ref(false);
    const refreshTaskSnapshot = vi.fn(async () => undefined);

    scope = effectScope();
    const controller = scope.run(() =>
      useTaskDetailRefreshController({
        taskId,
        latestTaskRefreshRequest,
        realtimeConnected,
        shouldPollRunningStatus,
        refreshTaskSnapshot,
      }),
    );
    if (!controller) {
      throw new Error("expected task detail refresh controller");
    }

    return {
      latestTaskRefreshRequest,
      realtimeConnected,
      shouldPollRunningStatus,
      refreshTaskSnapshot,
      controller,
    };
  }

  it("maps refresh requests into task snapshot options", () => {
    expect(
      toTaskDetailRefreshSnapshotOptions({
        eventId: "event-1",
        reason: "session-created",
        shouldRefreshMessages: true,
        shouldBumpTraceRefreshKey: false,
      }),
    ).toEqual({
      workflow: true,
      flow: true,
      messages: true,
    });
  });

  it("schedules delayed task snapshot refreshes from refresh requests", async () => {
    const { latestTaskRefreshRequest, refreshTaskSnapshot } = mountController();

    latestTaskRefreshRequest.value = {
      eventId: "event-1",
      reason: "assistant-completed",
      shouldRefreshMessages: true,
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();
    vi.advanceTimersByTime(259);
    expect(refreshTaskSnapshot).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await nextTick();
    expect(refreshTaskSnapshot).toHaveBeenCalledWith({
      workflow: true,
      flow: false,
      messages: true,
    });
  });

  it("bumps the trace refresh key for trace refresh requests", async () => {
    const { latestTaskRefreshRequest, controller } = mountController();

    latestTaskRefreshRequest.value = {
      eventId: "event-2",
      reason: "task-followup-completed",
      shouldRefreshMessages: false,
      shouldBumpTraceRefreshKey: true,
    };

    await nextTick();

    expect(controller.traceRefreshKey.value).toBe(1);
  });

  it("polls running status and gates message refresh on realtime connectivity", async () => {
    const {
      realtimeConnected,
      shouldPollRunningStatus,
      refreshTaskSnapshot,
    } = mountController();

    shouldPollRunningStatus.value = true;
    await nextTick();

    vi.advanceTimersByTime(2000);
    await nextTick();
    expect(refreshTaskSnapshot).toHaveBeenNthCalledWith(1, {
      flow: true,
      messages: false,
    });

    realtimeConnected.value = false;
    vi.advanceTimersByTime(2000);
    await nextTick();
    expect(refreshTaskSnapshot).toHaveBeenNthCalledWith(2, {
      flow: true,
      messages: true,
    });

    shouldPollRunningStatus.value = false;
    await nextTick();
    vi.advanceTimersByTime(2000);
    await nextTick();
    expect(refreshTaskSnapshot).toHaveBeenCalledTimes(2);
  });
});