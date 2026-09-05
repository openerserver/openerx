import type {
  ExecutionRun,
  PermissionRequest,
  ToolCall,
  ToolRisk,
  WorkItem,
} from "@openerx/contracts";

const riskOrder: Record<ToolRisk, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };

export function riskAtMost(actual: ToolRisk, ceiling: ToolRisk): boolean {
  return riskOrder[actual] <= riskOrder[ceiling];
}

export function permissionIsUsable(
  request: PermissionRequest,
  payloadDigest: string,
  now = new Date(),
): boolean {
  return (
    request.status === "approved" &&
    request.payloadDigest === payloadDigest &&
    new Date(request.expiresAt).getTime() > now.getTime()
  );
}

export function projectWorkItemStatus(
  run: ExecutionRun,
  calls: readonly ToolCall[],
): WorkItem["status"] {
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "failed") return "failed";
  if (run.status === "completed") return "completed";
  if (calls.some((call) => call.status === "waiting_for_permission")) {
    return "waiting_for_permission";
  }
  if (run.status === "waiting_for_user") return "waiting_for_user";
  if (run.status === "queued") return "queued";
  return "running";
}

export function isTerminalToolCall(call: ToolCall): boolean {
  return ["completed", "failed", "cancelled"].includes(call.status);
}
