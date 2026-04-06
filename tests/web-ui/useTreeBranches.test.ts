import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useTreeBranches } from "../../control-plane/web-ui/src/composables/useTreeBranches";

const apiMocks = vi.hoisted(() => ({
  getTaskSessionLineage: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    getTaskSessionLineage: apiMocks.getTaskSessionLineage,
  };
});

describe("useTreeBranches", () => {
  beforeEach(() => {
    apiMocks.getTaskSessionLineage.mockReset();
  });

  it("maps task session lineage into flat nodes rooted at the task node", async () => {
    apiMocks.getTaskSessionLineage.mockResolvedValue({
      data: [
        {
          id: "task-session:task-1:ses-root",
          runtimeSessionId: "ses-root",
          parentRuntimeSessionId: null,
          forkedFromMessageId: null,
          forkedFromMessageRole: null,
          forkedFromMessagePreview: null,
          firstPromptAfterFork: null,
          branchName: "main",
          sourceType: "root",
          isActive: true,
          title: "主分支",
          summary: null,
          createdAt: "2026-03-22T00:00:00.000Z",
          updatedAt: "2026-03-22T00:05:00.000Z",
          children: [
            {
              id: "task-session:task-1:ses-child",
              runtimeSessionId: "ses-child",
              parentRuntimeSessionId: "ses-root",
              forkedFromMessageId: "msg-1",
              forkedFromMessageRole: "assistant",
              forkedFromMessagePreview: "fork preview",
              firstPromptAfterFork: "继续执行",
              branchName: "fork-a",
              sourceType: "fork",
              isActive: false,
              title: "分叉会话",
              summary: null,
              createdAt: "2026-03-22T00:06:00.000Z",
              updatedAt: "2026-03-22T00:07:00.000Z",
              children: [],
            },
          ],
        },
      ],
    });

    const taskId = ref("task-1");
    const rootNodeId = ref("node-task-1");
    const selectedSessionId = ref<string | undefined>("ses-child");
    const state = useTreeBranches(taskId, rootNodeId, selectedSessionId);

    await flushPromises();

    expect(apiMocks.getTaskSessionLineage).toHaveBeenCalledWith("task-1");
    expect(state.flatNodes.value).toEqual([
      {
        id: "task-session:task-1:ses-root",
        branchNodeId: "task-session:task-1:ses-root",
        runtimeSessionId: "ses-root",
        taskSessionId: null,
        parentId: "node-task-1",
        parentTaskSessionId: null,
        contentText: "主分支",
        branchName: "main",
        sourceType: "root",
        isActive: true,
        archivedAt: null,
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:05:00.000Z",
        summary: null,
        forkedFromMessageId: null,
      },
      {
        id: "task-session:task-1:ses-child",
        branchNodeId: "task-session:task-1:ses-child",
        runtimeSessionId: "ses-child",
        taskSessionId: null,
        parentId: "task-session:task-1:ses-root",
        parentTaskSessionId: null,
        contentText: "分叉会话",
        branchName: "fork-a",
        sourceType: "fork",
        isActive: false,
        archivedAt: null,
        createdAt: "2026-03-22T00:06:00.000Z",
        updatedAt: "2026-03-22T00:07:00.000Z",
        summary: null,
        forkedFromMessageId: "msg-1",
      },
    ]);
    expect(state.selectedNode.value?.runtimeSessionId).toBe("ses-child");
  });
});
