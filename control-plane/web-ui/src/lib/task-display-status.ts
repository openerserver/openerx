import type { ExecutionMode, ExecutionPlan, Task } from "./api";

type DisplayTone = "success" | "processing" | "warning" | "error" | "default";

interface TaskStatusSource {
  status?: string | null;
  executionMode?: ExecutionMode | null;
  executionPlan?: string | null;
}

export interface TaskDisplayStatus {
  status: string;
  label: string;
  tagColor: string;
  badgeStatus: DisplayTone;
  needsAttention: boolean;
}

function parseExecutionPlan(raw: string | null | undefined): ExecutionPlan | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ExecutionPlan;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function isTaskAwaitingParallelAdoption(task?: TaskStatusSource | null): boolean {
  if (!task || task.status !== "completed") {
    return false;
  }

  const plan = parseExecutionPlan(task.executionPlan);
  if (!plan || (plan.mode !== "parallel" && task.executionMode !== "parallel")) {
    return false;
  }

  if (!Array.isArray(plan.candidates) || plan.candidates.length < 2) {
    return false;
  }

  if (typeof plan.winnerCandidateIndex === "number") {
    return false;
  }

  const allTerminal = plan.candidates.every(
    (candidate) => candidate.status === "completed" || candidate.status === "failed",
  );
  const hasCompleted = plan.candidates.some((candidate) => candidate.status === "completed");
  return allTerminal && hasCompleted;
}

export function resolveTaskDisplayStatus(task?: TaskStatusSource | Task | null): TaskDisplayStatus {
  if (isTaskAwaitingParallelAdoption(task)) {
    return {
      status: "awaiting-adoption",
      label: "待采纳",
      tagColor: "gold",
      badgeStatus: "warning",
      needsAttention: true,
    };
  }

  switch (task?.status) {
    case "pending":
      return {
        status: "pending",
        label: "待执行",
        tagColor: "default",
        badgeStatus: "warning",
        needsAttention: true,
      };
    case "running":
      return {
        status: "running",
        label: "运行中",
        tagColor: "processing",
        badgeStatus: "processing",
        needsAttention: true,
      };
    case "paused":
      return {
        status: "paused",
        label: "已暂停",
        tagColor: "warning",
        badgeStatus: "warning",
        needsAttention: true,
      };
    case "completed":
      return {
        status: "completed",
        label: "已完成",
        tagColor: "green",
        badgeStatus: "success",
        needsAttention: false,
      };
    case "failed":
      return {
        status: "failed",
        label: "失败",
        tagColor: "red",
        badgeStatus: "error",
        needsAttention: false,
      };
    case "cancelled":
      return {
        status: "cancelled",
        label: "已取消",
        tagColor: "default",
        badgeStatus: "default",
        needsAttention: false,
      };
    default:
      return {
        status: task?.status || "unknown",
        label: task?.status || "未知",
        tagColor: "default",
        badgeStatus: "default",
        needsAttention: false,
      };
  }
}