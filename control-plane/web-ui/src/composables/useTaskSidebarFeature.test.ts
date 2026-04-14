import { effectScope, nextTick, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { useTaskSidebarFeature } from "./useTaskSidebarFeature";

describe("useTaskSidebarFeature", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountFeature() {
    const taskId = ref("route-task");
    const task = ref<any>(null);
    const selectedSessionId = ref<string | undefined>("session-1");
    const traceRefreshKey = ref(0);

    scope = effectScope();
    const feature = scope.run(() =>
      useTaskSidebarFeature({
        selectedSessionId,
        task,
        taskId,
        traceRefreshKey,
      }),
    );
    if (!feature) {
      throw new Error("expected sidebar feature");
    }

    return {
      feature,
      task,
      taskId,
    };
  }

  it("opens file preview and expands the sidebar", () => {
    const { feature } = mountFeature();

    feature.handleOpenFilePreview({ filePath: "/tmp/demo.txt", content: "hello" });

    expect(feature.collapsed.value).toBe(false);
    expect(feature.previewFile.value).toEqual({ filePath: "/tmp/demo.txt", content: "hello" });
  });

  it("resolves sidebar task id from the loaded task when available", () => {
    const { feature, task } = mountFeature();

    task.value = { id: "loaded-task" };

    expect(feature.taskId.value).toBe("loaded-task");
    expect(feature.memberReconcileRequired.value).toBe(false);
  });

  it("clears preview state when the route task changes", async () => {
    const { feature, taskId } = mountFeature();

    feature.handleOpenFilePreview({ filePath: "/tmp/demo.txt" });
    taskId.value = "route-task-2";
    await nextTick();

    expect(feature.previewFile.value).toBeNull();
    expect(feature.collapsed.value).toBe(false);
  });
});