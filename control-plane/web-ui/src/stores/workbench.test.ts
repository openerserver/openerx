import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkbenchStore } from "./workbench";

describe("useWorkbenchStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("restores a cleared workbench from snapshot", () => {
    const store = useWorkbenchStore();

    store.openTask("task-primary", "主任务", "running");
    store.openTaskInSecondary("task-secondary", "副任务", "completed");

    const snapshot = store.createSnapshot();

    store.clearWorkbench();
    expect(store.tabs).toHaveLength(0);
    expect(store.activeTaskId).toBe("");
    expect(store.splitMode).toBe(false);

    store.restoreSnapshot(snapshot);

    expect(store.tabs).toEqual([
      { taskId: "task-primary", title: "主任务", status: "running" },
      { taskId: "task-secondary", title: "副任务", status: "completed" },
    ]);
    expect(store.activeTaskId).toBe("task-primary");
    expect(store.splitMode).toBe(true);
    expect(store.secondaryPane).toEqual({ taskId: "task-secondary" });
  });

  it("drops invalid secondary pane entries when restoring", () => {
    const store = useWorkbenchStore();

    store.restoreSnapshot({
      tabs: [{ taskId: "task-primary", title: "主任务", status: "running" }],
      activeTaskId: "task-primary",
      secondaryPane: { taskId: "missing-task" },
      splitMode: true,
    });

    expect(store.tabs).toEqual([{ taskId: "task-primary", title: "主任务", status: "running" }]);
    expect(store.activeTaskId).toBe("task-primary");
    expect(store.splitMode).toBe(false);
    expect(store.secondaryPane).toBeNull();
  });
});