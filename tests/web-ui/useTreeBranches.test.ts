import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useTreeBranches } from "../../control-plane/web-ui/src/composables/useTreeBranches";

const apiMocks = vi.hoisted(() => ({
  getProjectTree: vi.fn(),
  getProjectTreeBranches: vi.fn(),
  getProjectTreeNode: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    getProjectTree: apiMocks.getProjectTree,
    getProjectTreeBranches: apiMocks.getProjectTreeBranches,
    getProjectTreeNode: apiMocks.getProjectTreeNode,
  };
});

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useTreeBranches", () => {
  beforeEach(() => {
    apiMocks.getProjectTree.mockReset();
    apiMocks.getProjectTreeBranches.mockReset();
    apiMocks.getProjectTreeNode.mockReset();
  });

  it("keeps descendant sessions under the task subtree selectable", async () => {
    apiMocks.getProjectTreeBranches.mockResolvedValue([
      {
        id: "branch-1",
        projectId: "proj-1",
        taskNodeId: "task-node-1",
        branchName: "main",
        headNodeId: "session-node-root",
        isDefault: true,
      },
    ]);

    apiMocks.getProjectTreeNode.mockResolvedValue({
      id: "task-node-1",
      projectId: "proj-1",
      parentId: "project-root",
      path: "project-root.task-node-1",
      depth: 1,
      nodeType: "task",
      isActive: true,
    });

    apiMocks.getProjectTree.mockResolvedValue([
      {
        id: "session-node-root",
        projectId: "proj-1",
        parentId: "task-node-1",
        path: "project-root.task-node-1.session-node-root",
        depth: 2,
        nodeType: "session",
        runtimeSessionId: "ses-root",
        contentText: "主会话",
        branchName: "main",
        isActive: true,
      },
      {
        id: "session-node-child",
        projectId: "proj-1",
        parentId: "session-node-root",
        path: "project-root.task-node-1.session-node-root.session-node-child",
        depth: 3,
        nodeType: "session",
        runtimeSessionId: "ses-child",
        contentText: "分叉会话",
        branchName: "feature-a",
        isActive: true,
      },
      {
        id: "session-node-other-task",
        projectId: "proj-1",
        parentId: "task-node-2",
        path: "project-root.task-node-2.session-node-other-task",
        depth: 2,
        nodeType: "session",
        runtimeSessionId: "ses-other",
        contentText: "其他任务会话",
        branchName: "other",
        isActive: true,
      },
    ]);

    const state = useTreeBranches(
      ref("proj-1"),
      ref("task-node-1"),
      ref<string | undefined>("ses-child"),
    );

    await flushAsync();

    expect(apiMocks.getProjectTreeBranches).toHaveBeenCalledWith("proj-1");
    expect(apiMocks.getProjectTreeNode).toHaveBeenCalledWith("proj-1", "task-node-1");
    expect(apiMocks.getProjectTree).toHaveBeenCalledWith("proj-1", { nodeType: "session" });
    expect(state.flatNodes.value.map((node) => node.runtimeSessionId)).toEqual([
      "ses-root",
      "ses-child",
    ]);
    expect(state.selectedNode.value?.runtimeSessionId).toBe("ses-child");
  });
});