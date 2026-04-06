import { afterEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

async function loadComposableModule() {
  vi.resetModules();
  return import("../../control-plane/web-ui/src/composables/useProjectTreeTask");
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useProjectTreeTask", () => {
  test("keeps task business fields from the BFF read model even when tree payload contains legacy compat values", async () => {
    const getTask = vi.fn(async () => ({
      id: "task-1",
      projectId: "proj-1",
      title: "BFF task title",
      prompt: "BFF task prompt",
      status: "running",
      sessionId: "ses-1",
      agentRunId: "run-1",
      createdAt: "2026-03-12T10:00:00.000Z",
      autoAdvanceStages: false,
      executionMode: "single",
      orchestrationKind: "single",
      changesSummary: null,
      currentRunId: "task_run:task-1:root",
    }));
    const getProjectTreeNode = vi.fn(async () => ({
      id: "node-task-1",
      projectId: "proj-1",
      parentId: null,
      nodeType: "task",
      contentType: "json",
      contentText: "Tree task title",
      contentJson: {
        title: "Tree task title",
        executionMode: "parallel",
        autoAdvanceStages: true,
        changesSummary: { filesAdded: 99 },
        executionPlan: { mode: "parallel", candidates: [] },
        parallelRunHistory: [{ parallelRunId: "legacy-run" }],
      },
      runtimeSessionId: "ses-root",
      branchName: null,
      isActive: true,
      sortOrder: 0,
      createdAt: "2026-03-12T10:00:00.000Z",
      updatedAt: "2026-03-12T10:00:00.000Z",
      archivedAt: null,
    }));
    const getProjectTreeAncestors = vi.fn(async () => [{ id: "root-node" }]);

    vi.doMock("../../control-plane/web-ui/src/lib/api", () => ({
      getTask,
      getProjectTreeNode,
      getProjectTreeAncestors,
    }));

    const { useProjectTreeTask } = await loadComposableModule();
    const state = useProjectTreeTask(ref("task-1"));
    await settle();

    expect(state.task.value?.title).toBe("BFF task title");
    expect(state.task.value?.prompt).toBe("BFF task prompt");
    expect(state.task.value?.executionMode).toBe("single");
    expect(state.task.value?.autoAdvanceStages).toBe(false);
    expect(state.task.value?.changesSummary).toBeNull();
    expect((state.task.value as Record<string, unknown>)?.executionPlan).toBeUndefined();
    expect((state.task.value as Record<string, unknown>)?.parallelRunHistory).toBeUndefined();
    expect(state.task.value?.nodeId).toBe("node-task-1");
    expect(state.node.value?.id).toBe("node-task-1");
    expect(state.ancestors.value).toEqual([{ id: "root-node" }]);
  });
});
