import type { ExecutionMode, Task } from "./api";
import {
  resolveEditableExecutionMode,
  resolveEditableParallelCandidates,
} from "./taskExecutionMode";

type DisplayTone = "success" | "processing" | "warning" | "error" | "default";

interface TaskStatusSource {
  status?: string | null;
  executionMode?: ExecutionMode;
  orchestrationKind?: string | null;
  currentRunCandidateCount?: number | null;
  winnerNodeId?: string | null;
  strategy?: string;
}

export interface TaskDisplayStatus {
  status: string;
  label: string;
  tagColor: string;
  badgeStatus: DisplayTone;
  needsAttention: boolean;
}

function buildAwaitingAdoptionDisplayStatus(): TaskDisplayStatus {
  return {
    status: "awaiting-adoption",
    label: "待采纳",
    tagColor: "gold",
    badgeStatus: "warning",
    needsAttention: true,
  };
}

function resolveParallelCandidateCount(task?: TaskStatusSource | Task | null): number {
  if (!task) {
    return 0;
  }

  if (
    typeof task.currentRunCandidateCount === "number" &&
    Number.isFinite(task.currentRunCandidateCount)
  ) {
    return task.currentRunCandidateCount;
  }

  return resolveEditableParallelCandidates(task).length;
}

function isParallelTask(task?: TaskStatusSource | Task | null): boolean {
  if (!task) {
    return false;
  }

  return (
    task.orchestrationKind === "parallel" ||
    resolveEditableExecutionMode(task) === "parallel" ||
    resolveParallelCandidateCount(task) > 1
  );
}

export function isTaskAwaitingParallelAdoption(task?: TaskStatusSource | null): boolean {
  if (!task || task.status !== "completed") {
    return false;
  }

  if (!isParallelTask(task)) {
    return false;
  }

  const candidateCount = resolveParallelCandidateCount(task);
  if (candidateCount < 2) {
    return false;
  }

  if (typeof task.winnerNodeId === "string" && task.winnerNodeId.trim()) {
    return false;
  }

  return true;
}

export function resolveTaskDisplayStatus(task?: TaskStatusSource | Task | null): TaskDisplayStatus {
  const explicitStatus = typeof task?.status === "string" ? task.status.trim() : "";

  if (explicitStatus === "awaiting_adoption") {
    return buildAwaitingAdoptionDisplayStatus();
  }

  switch (explicitStatus) {
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
        status: explicitStatus || "unknown",
        label: explicitStatus || "未知",
        tagColor: "default",
        badgeStatus: "default",
        needsAttention: false,
      };
  }
}
