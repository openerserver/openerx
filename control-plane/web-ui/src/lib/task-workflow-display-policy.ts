import type { TaskStageViewModel } from "./api";

export type WorkflowStatusDisplayProfile = "workflow" | "stage";

export interface WorkflowStatusDisplay {
  status: string;
  label: string;
  tagColor: string;
}

type WorkflowStageLabelSource = Pick<TaskStageViewModel, "stageKey" | "stageLabel">;
type WorkflowStepSource = Pick<TaskStageViewModel, "stageKey" | "status">;

function normalizeValue(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function fallbackWorkflowStageLabel(stageKey?: string | null): string {
  const normalizedStageKey = normalizeValue(stageKey);
  if (!normalizedStageKey) {
    return "未开始";
  }

  switch (normalizedStageKey) {
    case "intake":
      return "需求进入";
    case "clarify":
      return "需求澄清";
    case "design":
      return "方案设计";
    case "plan":
      return "任务拆解";
    case "implement":
      return "实现开发";
    case "review":
      return "评审";
    case "verify":
      return "集成验证";
    case "fix":
      return "修复处理";
    case "release":
      return "发布执行";
    case "post-release":
      return "发布观察";
    case "retrospective":
      return "复盘沉淀";
    case "done":
      return "已完成";
    case "cancelled":
      return "已取消";
    case "unknown":
      return "未知阶段";
    default:
      return normalizedStageKey;
  }
}

export function resolveWorkflowStageLabel(
  stageKey: string | null | undefined,
  stages: readonly WorkflowStageLabelSource[],
  emptyLabel = "未开始",
): string {
  const normalizedStageKey = normalizeValue(stageKey);
  if (!normalizedStageKey) {
    return emptyLabel;
  }

  const matchedStage = stages.find((stage) => normalizeValue(stage.stageKey) === normalizedStageKey);
  const explicitLabel = normalizeValue(matchedStage?.stageLabel);
  return explicitLabel || fallbackWorkflowStageLabel(normalizedStageKey);
}

export function resolveWorkflowStatusDisplay(
  status?: string | null,
  profile: WorkflowStatusDisplayProfile = "workflow",
  emptyLabel = "未开始",
): WorkflowStatusDisplay {
  const normalizedStatus = normalizeValue(status);

  switch (normalizedStatus) {
    case "pending":
      return {
        status: "pending",
        label: "待开始",
        tagColor: "default",
      };
    case "running":
      return {
        status: "running",
        label: "进行中",
        tagColor: profile === "stage" ? "blue" : "processing",
      };
    case "blocked":
      return {
        status: "blocked",
        label: "已阻断",
        tagColor: profile === "stage" ? "red" : "error",
      };
    case "waiting-approval":
      return {
        status: "waiting-approval",
        label: "待审批",
        tagColor: profile === "stage" ? "orange" : "warning",
      };
    case "failed":
      return {
        status: "failed",
        label: "失败",
        tagColor: profile === "stage" ? "volcano" : "error",
      };
    case "completed":
      return {
        status: "completed",
        label: "已完成",
        tagColor: profile === "stage" ? "green" : "success",
      };
    case "cancelled":
      return {
        status: "cancelled",
        label: "已取消",
        tagColor: "default",
      };
    default:
      return {
        status: normalizedStatus,
        label: normalizedStatus || emptyLabel,
        tagColor: "default",
      };
  }
}

export function resolveWorkflowStepStatus(
  stage: WorkflowStepSource,
  currentStage: string | null | undefined,
): "finish" | "process" | "wait" | "error" {
  const normalizedStageStatus = normalizeValue(stage.status);
  if (normalizedStageStatus === "completed") {
    return "finish";
  }

  if (normalizeValue(stage.stageKey) === normalizeValue(currentStage)) {
    return "process";
  }

  if (normalizedStageStatus === "failed") {
    return "error";
  }

  return "wait";
}