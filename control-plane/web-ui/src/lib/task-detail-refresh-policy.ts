import type { TaskMessagePatchEvent } from "./task-message-patch-event";
import {
  getTaskMessagePatchEffects,
  shouldRefreshTaskDetailMessagesFromPoll,
} from "./task-message-patch-effects";

export { shouldRefreshTaskDetailMessagesFromPoll };

export type TaskDetailRefreshTargets = {
  workflow: boolean;
  flow: boolean;
  messages: boolean;
};

const WORKFLOW_REFRESH_REASONS = new Set<TaskMessagePatchEvent["kind"]>([
  "workflow-reconcile-required",
  "task-updated",
  "task-completed",
  "task-continued",
  "task-node-updated",
  "agent-started",
  "task-hooks-updated",
  "task-followup-started",
  "task-followup-completed",
  "task-followup-failed",
]);

const FLOW_REFRESH_REASONS = new Set<TaskMessagePatchEvent["kind"]>([
  "flow-reconcile-required",
  "phase-created",
  "phase-updated",
  "phase-awaiting-adoption",
  "phase-paused",
  "phase-resumed",
  "phase-cancelled",
  "phase-completed",
  "phase-failed",
]);

export type TaskDetailRefreshRequest = {
  eventId: string;
  reason: TaskMessagePatchEvent["kind"];
  targets: TaskDetailRefreshTargets;
  shouldBumpTraceRefreshKey: boolean;
};

function getTaskDetailRefreshTargets(
  kind: TaskMessagePatchEvent["kind"],
  shouldRefreshMessages: boolean,
): TaskDetailRefreshTargets {
  if (kind === "task-reconcile-required") {
    return {
      workflow: true,
      flow: true,
      messages: true,
    };
  }

  return {
    workflow: WORKFLOW_REFRESH_REASONS.has(kind),
    flow: FLOW_REFRESH_REASONS.has(kind),
    messages: shouldRefreshMessages,
  };
}

export function getTaskDetailRefreshRequest(
  patchEvent: TaskMessagePatchEvent | null | undefined,
): TaskDetailRefreshRequest | null {
  if (!patchEvent) {
    return null;
  }

  const effects = getTaskMessagePatchEffects(patchEvent);
  if (!effects.shouldScheduleTaskDetailRefresh) {
    return null;
  }

  return {
    eventId: patchEvent.eventId,
    reason: patchEvent.kind,
    targets: getTaskDetailRefreshTargets(
      patchEvent.kind,
      effects.shouldRefreshTaskDetailMessages,
    ),
    shouldBumpTraceRefreshKey: effects.shouldBumpTaskDetailTraceRefreshKey,
  };
}

export function shouldBumpTaskDetailTraceRefreshKey(
  patchEvent: TaskMessagePatchEvent | null | undefined,
) {
  return getTaskMessagePatchEffects(patchEvent).shouldBumpTaskDetailTraceRefreshKey;
}

export function shouldRefreshTaskDetailMessages(
  patchEvent: TaskMessagePatchEvent | null | undefined,
) {
  return getTaskMessagePatchEffects(patchEvent).shouldRefreshTaskDetailMessages;
}

export function shouldScheduleTaskDetailRefresh(
  patchEvent: TaskMessagePatchEvent | null | undefined,
) {
  return getTaskMessagePatchEffects(patchEvent).shouldScheduleTaskDetailRefresh;
}