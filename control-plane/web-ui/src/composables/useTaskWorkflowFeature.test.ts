import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskWorkflowFeature } from "./useTaskWorkflowFeature";

const { getModelsListMock, getTaskWorkflowViewMock, updateTaskMock } = vi.hoisted(() => ({
  getModelsListMock: vi.fn(),
  getTaskWorkflowViewMock: vi.fn(),
  updateTaskMock: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getModelsList: getModelsListMock,
  getTaskWorkflowView: getTaskWorkflowViewMock,
  updateTask: updateTaskMock,
}));

describe("useTaskWorkflowFeature", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  beforeEach(() => {
    getModelsListMock.mockReset();
    getTaskWorkflowViewMock.mockReset();
    updateTaskMock.mockReset();
    getModelsListMock.mockResolvedValue({
      data: [{ id: "model-a", name: "Model A", provider: "Provider A" }],
    });
    getTaskWorkflowViewMock.mockResolvedValue({
      meta: {
        snapshotVersion: 8,
        reconcileRequired: false,
      },
      workflow: {
        currentStage: "stage-2",
        stages: [
          { stageKey: "stage-1", stageLabel: "阶段一" },
          { stageKey: "stage-2", stageLabel: "阶段二" },
        ],
      },
    });
    updateTaskMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  function mountFeature() {
    const taskId = ref("task-1");
    const task = ref<any>(null);
    const taskSessionSummaries = ref<any[]>([]);
    const editableExecutionMode = ref<any>("single");
    const refreshTask = vi.fn(async () => undefined);

    scope = effectScope();
    const feature = scope.run(() =>
      useTaskWorkflowFeature({
        editableExecutionMode,
        taskId,
        task,
        taskSessionSummaries,
        refreshTask,
      }),
    );
    if (!feature) {
      throw new Error("expected task workflow feature");
    }

    return {
      feature,
      editableExecutionMode,
      refreshTask,
      task,
      taskId,
      taskSessionSummaries,
    };
  }

  it("refreshes workflow snapshot after silently refreshing the task", async () => {
    const { feature, refreshTask } = mountFeature();

    await feature.refreshWorkflowSnapshot();

    expect(refreshTask).toHaveBeenCalledWith(true);
    expect(getTaskWorkflowViewMock).toHaveBeenCalledWith("task-1");
    expect(feature.workflowSummary.value?.currentStage).toBe("stage-2");
    expect(feature.currentStageLabel.value).toBe("阶段二");
    expect(feature.workflowReconcileRequired.value).toBe(false);
  });

  it("keeps newer workflow snapshots when an older response arrives later", async () => {
    const { feature } = mountFeature();

    feature.workflowView.value = {
      meta: { snapshotVersion: 9, reconcileRequired: false },
      workflow: {
        currentStage: "stage-2",
        stages: [{ stageKey: "stage-2", stageLabel: "阶段二" }],
      },
    } as never;

    getTaskWorkflowViewMock.mockResolvedValueOnce({
      meta: { snapshotVersion: 7, reconcileRequired: false },
      workflow: {
        currentStage: "stage-1",
        stages: [{ stageKey: "stage-1", stageLabel: "阶段一" }],
      },
    });

    await feature.refreshWorkflowSnapshot();

    expect(feature.workflowView.value).toMatchObject({
      meta: { snapshotVersion: 9, reconcileRequired: false },
      workflow: { currentStage: "stage-2" },
    });
  });

  it("keeps a complete snapshot when an equal-version partial response arrives later", async () => {
    const { feature } = mountFeature();

    feature.workflowView.value = {
      meta: { snapshotVersion: 8, reconcileRequired: false },
      workflow: {
        currentStage: "stage-2",
        stages: [{ stageKey: "stage-2", stageLabel: "阶段二" }],
      },
    } as never;

    getTaskWorkflowViewMock.mockResolvedValueOnce({
      meta: { snapshotVersion: 8, reconcileRequired: true },
      workflow: {
        currentStage: "stage-1",
        stages: [{ stageKey: "stage-1", stageLabel: "阶段一" }],
      },
    });

    await feature.refreshWorkflowSnapshot();

    expect(feature.workflowView.value).toMatchObject({
      meta: { snapshotVersion: 8, reconcileRequired: false },
      workflow: { currentStage: "stage-2" },
    });
    expect(feature.workflowReconcileRequired.value).toBe(false);
  });

  it("exposes reconcile required when the workflow snapshot is partial", async () => {
    const { feature } = mountFeature();

    feature.workflowView.value = {
      meta: { snapshotVersion: 8, reconcileRequired: false },
      workflow: {
        currentStage: "stage-1",
        stages: [{ stageKey: "stage-1", stageLabel: "阶段一" }],
      },
    } as never;

    getTaskWorkflowViewMock.mockResolvedValueOnce({
      meta: { snapshotVersion: 9, reconcileRequired: true },
      workflow: {
        currentStage: "stage-2",
        stages: [{ stageKey: "stage-2", stageLabel: "阶段二" }],
      },
    });

    await feature.refreshWorkflowSnapshot();

    expect(feature.workflowReconcileRequired.value).toBe(true);
  });

  it("loads the initial workflow snapshot without forcing a task refresh", async () => {
    const { feature, refreshTask } = mountFeature();

    await feature.loadInitialWorkflowSnapshot();

    expect(refreshTask).not.toHaveBeenCalled();
    expect(getTaskWorkflowViewMock).toHaveBeenCalledWith("task-1");
  });

  it("exposes editable sequential steps from task strategy as part of the workflow facade", () => {
    const { feature, task } = mountFeature();

    task.value = {
      strategy: JSON.stringify({
        sequentialSteps: [{ id: "step-1", title: "规划", instruction: "先整理需求" }],
      }),
    };

    expect(feature.editableSequentialSteps.value).toEqual([
      { id: "step-1", title: "规划", instruction: "先整理需求" },
    ]);
  });

  it("exposes execution mode modal state and model options through the workflow facade", async () => {
    const { feature } = mountFeature();

    await feature.loadModels();

    expect(feature.modelOptions.value).toEqual([
      { value: "Provider A:model-a", label: "model-a (Model A / Provider A)" },
    ]);

    feature.handleChooseMode();

    expect(feature.showExecutionModeModal.value).toBe(true);
    expect(getModelsListMock).toHaveBeenCalled();

    feature.setExecutionModeModalOpen(false);

    expect(feature.showExecutionModeModal.value).toBe(false);
  });

  it("resets workflow snapshot state", async () => {
    const { feature } = mountFeature();

    await feature.refreshWorkflowSnapshot();
    feature.resetWorkflowState();

    expect(feature.workflowView.value).toBeNull();
  });

  it("resets workflow action state together with workflow state", async () => {
    const { feature } = mountFeature();

    await feature.loadModels();
    feature.setExecutionModeModalOpen(true);
    feature.resetWorkflowState();

    expect(feature.modelOptions.value).toEqual([]);
    expect(feature.modelsLoading.value).toBe(false);
    expect(feature.showExecutionModeModal.value).toBe(false);
    expect(feature.executionModeSaving.value).toBe(false);
  });
});
