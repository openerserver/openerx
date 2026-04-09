import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useTreeBranches } from "../../control-plane/web-ui/src/composables/useTreeBranches";

const apiMocks = vi.hoisted(() => ({
  getTaskTreeSessionContext: vi.fn(),
}));

vi.mock("../../control-plane/web-ui/src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../control-plane/web-ui/src/lib/api")>();
  return {
    ...actual,
    getTaskTreeSessionContext: apiMocks.getTaskTreeSessionContext,
  };
});

describe("useTreeBranches", () => {
  beforeEach(() => {
    apiMocks.getTaskTreeSessionContext.mockReset();
  });

  it("maps canonical task-tree session context into flat nodes and summaries", async () => {
    apiMocks.getTaskTreeSessionContext.mockResolvedValue({
      data: {
        currentSessionId: "ses-root",
        sessionSummaries: [
          {
            id: "ses-root",
            taskSessionId: "task-session-root",
            title: "主分支",
            isActive: true,
            summary: null,
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:05:00.000Z",
            coordinationKey: null,
            winnerSessionId: null,
            executionStatus: "completed",
            sessionKind: "root",
            candidateIndex: null,
            stepIndex: null,
            selectedModel: null,
            executionModeSnapshot: null,
          },
          {
            id: "ses-child",
            taskSessionId: "task-session-child",
            title: "分叉会话",
            isActive: false,
            summary: null,
            createdAt: "2026-03-22T00:06:00.000Z",
            updatedAt: "2026-03-22T00:07:00.000Z",
            coordinationKey: null,
            winnerSessionId: null,
            executionStatus: "completed",
            sessionKind: "fork",
            candidateIndex: null,
            stepIndex: null,
            selectedModel: null,
            executionModeSnapshot: null,
          },
        ],
        sessionLineage: [
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
      },
    });

    const taskId = ref("task-1");
    const rootNodeId = ref("node-task-1");
    const selectedSessionId = ref<string | undefined>("ses-child");
    const state = useTreeBranches(taskId, rootNodeId, selectedSessionId);

    await flushPromises();

    expect(apiMocks.getTaskTreeSessionContext).toHaveBeenCalledWith("task-1");
    expect(state.sessionSummaries.value).toEqual([
      {
        id: "ses-root",
        taskSessionId: "task-session-root",
        title: "主分支",
        isActive: true,
        summary: null,
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:05:00.000Z",
        coordinationKey: null,
        winnerSessionId: null,
        executionStatus: "completed",
        sessionKind: "root",
        candidateIndex: null,
        stepIndex: null,
        selectedModel: null,
        executionModeSnapshot: null,
      },
      {
        id: "ses-child",
        taskSessionId: "task-session-child",
        title: "分叉会话",
        isActive: false,
        summary: null,
        createdAt: "2026-03-22T00:06:00.000Z",
        updatedAt: "2026-03-22T00:07:00.000Z",
        coordinationKey: null,
        winnerSessionId: null,
        executionStatus: "completed",
        sessionKind: "fork",
        candidateIndex: null,
        stepIndex: null,
        selectedModel: null,
        executionModeSnapshot: null,
      },
    ]);
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

  it("keeps the previous session context when a silent refresh fails", async () => {
    apiMocks.getTaskTreeSessionContext
      .mockResolvedValueOnce({
        data: {
          currentSessionId: "ses-root",
          sessionSummaries: [
            {
              id: "ses-root",
              taskSessionId: "task-session-root",
              title: "主分支",
              isActive: true,
              summary: null,
              createdAt: "2026-03-22T00:00:00.000Z",
              updatedAt: "2026-03-22T00:05:00.000Z",
              coordinationKey: null,
              winnerSessionId: null,
              executionStatus: "completed",
              sessionKind: "root",
              candidateIndex: null,
              stepIndex: null,
              selectedModel: null,
              executionModeSnapshot: null,
            },
          ],
          sessionLineage: [
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
              children: [],
            },
          ],
        },
      })
      .mockRejectedValueOnce(new Error("tree unavailable"));

    const taskId = ref("task-1");
    const rootNodeId = ref("node-task-1");
    const selectedSessionId = ref<string | undefined>("ses-root");
    const state = useTreeBranches(taskId, rootNodeId, selectedSessionId);

    await flushPromises();

    await state.refresh(true);

    expect(state.sessionSummaries.value).toEqual([
      {
        id: "ses-root",
        taskSessionId: "task-session-root",
        title: "主分支",
        isActive: true,
        summary: null,
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:05:00.000Z",
        coordinationKey: null,
        winnerSessionId: null,
        executionStatus: "completed",
        sessionKind: "root",
        candidateIndex: null,
        stepIndex: null,
        selectedModel: null,
        executionModeSnapshot: null,
      },
    ]);
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
    ]);
  });
});
