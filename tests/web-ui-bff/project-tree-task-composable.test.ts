import { describe, expect, test } from "bun:test";

import { flattenTreeNodeToTask } from "../../control-plane/web-ui/src/composables/useProjectTreeTask";

describe("flattenTreeNodeToTask", () => {
  test("does not preserve legacy runtime plan or parallelRunHistory from tree node content", () => {
    const task = flattenTreeNodeToTask({
      id: "task-1",
      projectId: "proj-1",
      parentId: null,
      nodeType: "task",
      contentType: "json",
      contentText: "Runtime pipeline task",
      contentJson: {
        title: "Runtime pipeline task",
        prompt: "Summarize progress",
        status: "completed",
        executionMode: "parallel",
        executionPlan: { mode: "parallel", candidates: [] },
        parallelRunHistory: [{ parallelRunId: "legacy-run" }],
        currentRunId: "task_run:task-1:root",
        orchestrationKind: "parallel",
      },
      runtimeSessionId: "ses-root",
      branchName: null,
      isActive: true,
      sortOrder: 0,
      createdAt: "2026-03-12T10:00:00.000Z",
      updatedAt: "2026-03-12T10:00:00.000Z",
      archivedAt: null,
    });

    expect(task.executionPlan).toBeUndefined();
    expect(task.parallelRunHistory).toBeUndefined();
    expect(task.currentRunId).toBe("task_run:task-1:root");
    expect(task.orchestrationKind).toBe("parallel");
  });
});
