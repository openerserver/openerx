import { effectScope, nextTick, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskDetailRefreshRequest } from "../lib/task-detail-refresh-policy";
import { useTaskDetailTaskStatusSync } from "./useTaskDetailTaskStatusSync";

const FIXED_TIMESTAMP = "2026-04-12T12:00:00.000Z";

describe("useTaskDetailTaskStatusSync", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountSync() {
    const latestTaskRefreshRequest = ref<TaskDetailRefreshRequest | null>(null);
    const task = ref<any>({
      id: "task-1",
      nodeId: "task-1",
      projectId: "proj-1",
      status: "running",
      finishedAt: undefined,
    });

    scope = effectScope();
    scope.run(() =>
      useTaskDetailTaskStatusSync({
        getCurrentTimestamp: () => FIXED_TIMESTAMP,
        latestTaskRefreshRequest,
        task,
      }),
    );

    return {
      latestTaskRefreshRequest,
      task,
    };
  }

  it("marks the task completed immediately when a completed refresh request arrives", async () => {
    const { latestTaskRefreshRequest, task } = mountSync();

    latestTaskRefreshRequest.value = {
      eventId: "evt-1",
      reason: "task-completed",
      targets: { flow: false, messages: false, workflow: true },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();

    expect(task.value.status).toBe("completed");
    expect(task.value.finishedAt).toBe(FIXED_TIMESTAMP);
  });

  it("marks the task failed immediately when a failed refresh request arrives", async () => {
    const { latestTaskRefreshRequest, task } = mountSync();

    latestTaskRefreshRequest.value = {
      eventId: "evt-2",
      reason: "task-failed",
      targets: { flow: false, messages: false, workflow: true },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();

    expect(task.value.status).toBe("failed");
    expect(task.value.finishedAt).toBe(FIXED_TIMESTAMP);
  });

  it("restores running status and clears finishedAt when a continued refresh request arrives", async () => {
    const { latestTaskRefreshRequest, task } = mountSync();
    task.value = {
      ...task.value,
      status: "completed",
      finishedAt: "2026-04-12T11:59:00.000Z",
    };

    latestTaskRefreshRequest.value = {
      eventId: "evt-3",
      reason: "task-continued",
      targets: { flow: false, messages: false, workflow: true },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();

    expect(task.value.status).toBe("running");
    expect(task.value.finishedAt).toBeUndefined();
  });

  it("keeps the existing finishedAt when the task already has one", async () => {
    const { latestTaskRefreshRequest, task } = mountSync();
    task.value = {
      ...task.value,
      finishedAt: "2026-04-12T11:58:00.000Z",
    };

    latestTaskRefreshRequest.value = {
      eventId: "evt-4",
      reason: "task-completed",
      targets: { flow: false, messages: false, workflow: true },
      shouldBumpTraceRefreshKey: false,
    };

    await nextTick();

    expect(task.value.finishedAt).toBe("2026-04-12T11:58:00.000Z");
  });
});