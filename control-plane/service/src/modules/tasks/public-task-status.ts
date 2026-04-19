import type { TaskStatus } from "../project-tree/task-types";

export function normalizePublicTaskStatusValue(
  value: string | null | undefined,
): TaskStatus | null {
  if (value === "complete" || value === "completed") {
    return "completed";
  }
  if (value === "queued" || value === "pending") {
    return "pending";
  }
  if (
    value === "running" ||
    value === "paused" ||
    value === "awaiting_adoption" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}

export function mapLifecycleStatusToPublicTaskStatus(
  lifecycleStatus: string | null | undefined,
): TaskStatus | null {
  if (lifecycleStatus === "done") {
    return "completed";
  }
  if (lifecycleStatus === "active") {
    return "running";
  }
  if (lifecycleStatus === "archived") {
    return "cancelled";
  }
  if (lifecycleStatus === "draft") {
    return "pending";
  }

  return null;
}

export function normalizeAuthoritativeTaskStatusValue(
  value: string | null | undefined,
): TaskStatus | null {
  const normalized = normalizePublicTaskStatusValue(value);
  return normalized === "completed" || normalized === "failed" || normalized === "cancelled"
    ? normalized
    : null;
}

export function resolvePublicTaskStatus(args: {
  authoritativeStatus?: string | null;
  currentExecutionStatus?: string | null;
  lifecycleStatus?: string | null;
  fallbackStatus?: string | null;
  defaultStatus?: TaskStatus;
}): TaskStatus {
  return (
    normalizeAuthoritativeTaskStatusValue(args.authoritativeStatus) ??
    normalizePublicTaskStatusValue(args.currentExecutionStatus) ??
    normalizePublicTaskStatusValue(args.fallbackStatus) ??
    mapLifecycleStatusToPublicTaskStatus(args.lifecycleStatus) ??
    args.defaultStatus ??
    "pending"
  );
}