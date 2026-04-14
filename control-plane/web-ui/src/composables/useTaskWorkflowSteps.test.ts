import { effectScope, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { useTaskWorkflowSteps } from "./useTaskWorkflowSteps";

describe("useTaskWorkflowSteps", () => {
  let scope: ReturnType<typeof effectScope> | null = null;

  afterEach(() => {
    scope?.stop();
    scope = null;
  });

  it("derives workflow summary, stages and the current stage label", () => {
    const workflowView = ref({
      taskId: "task-1",
      workflow: {
        currentStage: "implement",
        status: "running",
        stages: [
          { stageKey: "plan", stageLabel: "规划" },
          { stageKey: "implement", stageLabel: "实现" },
        ],
      },
    } as any);

    scope = effectScope();
    const steps = scope.run(() => useTaskWorkflowSteps({ workflowView }));
    if (!steps) {
      throw new Error("expected workflow steps");
    }

    expect(steps.workflowSummary.value?.currentStage).toBe("implement");
    expect(steps.workflowStages.value).toHaveLength(2);
    expect(steps.currentStageLabel.value).toBe("实现");
  });

  it("falls back to the shared stage label policy when no label matches", () => {
    const workflowView = ref({
      taskId: "task-1",
      workflow: {
        currentStage: "verify",
        status: "running",
        stages: [{ stageKey: "implement", stageLabel: "实现" }],
      },
    } as any);

    scope = effectScope();
    const steps = scope.run(() => useTaskWorkflowSteps({ workflowView }));
    if (!steps) {
      throw new Error("expected workflow steps");
    }

    expect(steps.currentStageLabel.value).toBe("集成验证");
  });
});