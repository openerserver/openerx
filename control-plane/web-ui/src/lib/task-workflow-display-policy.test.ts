import { describe, expect, it } from "vitest";
import {
  fallbackWorkflowStageLabel,
  resolveWorkflowStageLabel,
  resolveWorkflowStatusDisplay,
  resolveWorkflowStepStatus,
} from "./task-workflow-display-policy";

describe("task-workflow-display-policy", () => {
  it("falls back known stage keys to localized labels", () => {
    expect(fallbackWorkflowStageLabel("verify")).toBe("集成验证");
    expect(fallbackWorkflowStageLabel("unknown")).toBe("未知阶段");
  });

  it("prefers explicit stage labels before fallback labels", () => {
    expect(
      resolveWorkflowStageLabel("implement", [
        { stageKey: "implement", stageLabel: "实现" },
      ]),
    ).toBe("实现");
    expect(resolveWorkflowStageLabel("verify", [])).toBe("集成验证");
    expect(resolveWorkflowStageLabel("", [], "阶段待同步")).toBe("阶段待同步");
  });

  it("normalizes workflow and stage status displays through one policy", () => {
    expect(resolveWorkflowStatusDisplay("running")).toEqual({
      status: "running",
      label: "进行中",
      tagColor: "processing",
    });
    expect(resolveWorkflowStatusDisplay("running", "stage")).toEqual({
      status: "running",
      label: "进行中",
      tagColor: "blue",
    });
    expect(resolveWorkflowStatusDisplay(undefined)).toEqual({
      status: "",
      label: "未开始",
      tagColor: "default",
    });
    expect(resolveWorkflowStatusDisplay(undefined, "workflow", "未记录")).toEqual({
      status: "",
      label: "未记录",
      tagColor: "default",
    });
  });

  it("keeps the overview step projector semantics", () => {
    expect(
      resolveWorkflowStepStatus({ stageKey: "implement", status: "running" }, "implement"),
    ).toBe("process");
    expect(resolveWorkflowStepStatus({ stageKey: "verify", status: "failed" }, "plan")).toBe(
      "error",
    );
    expect(
      resolveWorkflowStepStatus({ stageKey: "review", status: "completed" }, "implement"),
    ).toBe("finish");
  });
});