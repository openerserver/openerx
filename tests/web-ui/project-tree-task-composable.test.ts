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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
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
      toApiError: () => null,
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

  test("maps a missing task to the historical-database guidance message", async () => {
    const getTask = vi.fn(async () => {
      throw {
        status: 404,
        code: "TASK_NOT_FOUND",
        error: "Task not found",
      };
    });
    const getProjectTreeNode = vi.fn(async () => null);
    const getProjectTreeAncestors = vi.fn(async () => []);

    vi.doMock("../../control-plane/web-ui/src/lib/api", async () => {
      const actual = await import("../../control-plane/web-ui/src/lib/api");
      return {
        ...actual,
        toApiError: (error: unknown) =>
          typeof error === "object" && error !== null ? (error as { status?: number }) : null,
        getTask,
        getProjectTreeNode,
        getProjectTreeAncestors,
      };
    });

    const { MISSING_TASK_LOAD_ERROR, useProjectTreeTask } = await loadComposableModule();
    const state = useProjectTreeTask(ref("task-missing"));
    await settle();

    expect(state.task.value).toBeNull();
    expect(state.node.value).toBeNull();
    expect(state.ancestors.value).toEqual([]);
    expect(state.error.value).toBe(MISSING_TASK_LOAD_ERROR);
    expect(getProjectTreeNode).not.toHaveBeenCalled();
    expect(getProjectTreeAncestors).not.toHaveBeenCalled();
  });

  test("ignores stale task refresh responses that finish after a newer refresh", async () => {
    const firstTask = createDeferred<{
      id: string;
      projectId: string;
      title: string;
      prompt: string;
      status: string;
      sessionId: string;
      createdAt: string;
    }>();
    const secondTask = createDeferred<{
      id: string;
      projectId: string;
      title: string;
      prompt: string;
      status: string;
      sessionId: string;
      createdAt: string;
    }>();

    const getTask = vi
      .fn()
      .mockImplementationOnce(() => firstTask.promise)
      .mockImplementationOnce(() => secondTask.promise);
    const getProjectTreeNode = vi.fn(async () => ({
      id: "node-task-1",
      projectId: "proj-1",
      parentId: null,
      nodeType: "task",
      contentType: "json",
      contentText: "Tree task title",
      contentJson: null,
      runtimeSessionId: "ses-root",
      branchName: null,
      isActive: true,
      sortOrder: 0,
      createdAt: "2026-03-12T10:00:00.000Z",
      updatedAt: "2026-03-12T10:00:00.000Z",
      archivedAt: null,
    }));
    const getProjectTreeAncestors = vi.fn(async () => []);

    vi.doMock("../../control-plane/web-ui/src/lib/api", async () => {
      const actual = await import("../../control-plane/web-ui/src/lib/api");
      return {
        ...actual,
        toApiError: () => null,
        getTask,
        getProjectTreeNode,
        getProjectTreeAncestors,
      };
    });

    const { useProjectTreeTask } = await loadComposableModule();
    const state = useProjectTreeTask(ref("task-1"));
    await settle();

    void state.refresh(true);

    secondTask.resolve({
      id: "task-1",
      projectId: "proj-1",
      title: "new task",
      prompt: "new prompt",
      status: "running",
      sessionId: "child-1",
      createdAt: "2026-03-12T10:00:00.000Z",
    });

    await settle();
    expect(state.task.value?.sessionId).toBe("child-1");

    firstTask.resolve({
      id: "task-1",
      projectId: "proj-1",
      title: "old task",
      prompt: "old prompt",
      status: "running",
      sessionId: "parent-1",
      createdAt: "2026-03-12T10:00:00.000Z",
    });

    await settle();
    expect(state.task.value?.title).toBe("new task");
    expect(state.task.value?.sessionId).toBe("child-1");
  });
});
