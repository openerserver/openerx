import type { TaskMessagePatchEvent } from "./task-message-patch-event";
import {
  getTaskMessagePatchEffects,
  shouldRefreshTaskDetailMessagesFromPoll,
} from "./task-message-patch-effects";

export { shouldRefreshTaskDetailMessagesFromPoll };

export type TaskDetailRefreshRequest = {
  eventId: string;
  reason: TaskMessagePatchEvent["kind"];
  shouldRefreshMessages: boolean;
  shouldBumpTraceRefreshKey: boolean;
};

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
    shouldRefreshMessages: effects.shouldRefreshTaskDetailMessages,
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