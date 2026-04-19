import {
  createEmptyLiveAssistantState,
  type LiveAssistantState,
} from "./message-normalize";
import {
  applyTaskMessagePatchEventToLiveAssistantState,
  cloneLiveAssistantState,
  replayPhaseLiveAssistantState,
  replayTaskMessagePatchEvents,
} from "./task-live-message-state";
import { type TaskMessagePatchEvent } from "./task-message-patch-event";

export type ReplaceLiveAssistantStateFromPhaseHistoryOptions = {
  taskId: string;
  phaseId: string | null | undefined;
  sessionIds: string[];
  patchEvents: TaskMessagePatchEvent[];
};

export type ConsumePendingTaskPatchEventsOptions = {
  consumerId: string;
  taskId: string;
  sessionId: string | undefined;
  patchEvents: TaskMessagePatchEvent[];
};

export type ConsumePendingTaskPatchEventsResult = {
  hasPendingEvents: boolean;
  pendingEvents: TaskMessagePatchEvent[];
  liveAssistantState: LiveAssistantState | null;
};

function buildLiveAssistantStateKey(taskId: string, sessionId: string | undefined) {
  return `${taskId}:${sessionId || "none"}`;
}

function isAssistantPatchEvent(patchEvent: TaskMessagePatchEvent) {
  return (
    patchEvent.kind === "assistant-progress" ||
    patchEvent.kind === "assistant-completed" ||
    patchEvent.kind === "assistant-delta"
  );
}

function getConsumablePatchEvents(
  patchEvents: TaskMessagePatchEvent[],
  sessionId: string | undefined,
) {
  return patchEvents
    .filter((event) => !sessionId || !event.sessionId || event.sessionId === sessionId)
    .slice()
    .reverse();
}

export function createTaskLiveAssistantStateManager() {
  const lastHandledPatchEventIds = new Map<string, string>();
  const liveAssistantStates = new Map<string, LiveAssistantState>();

  function getOrReplayLiveAssistantState(
    taskId: string,
    sessionId: string | undefined,
    patchEvents: TaskMessagePatchEvent[],
  ) {
    if (!taskId || !sessionId) {
      return createEmptyLiveAssistantState();
    }

    const stateKey = buildLiveAssistantStateKey(taskId, sessionId);
    const cachedState = liveAssistantStates.get(stateKey);
    if (cachedState) {
      return cachedState;
    }

    const replayedState = replayTaskMessagePatchEvents(patchEvents, sessionId);
    liveAssistantStates.set(stateKey, replayedState);
    return replayedState;
  }

  function getLiveAssistantState(
    taskId: string,
    sessionId: string | undefined,
    patchEvents: TaskMessagePatchEvent[],
  ) {
    return cloneLiveAssistantState(
      getOrReplayLiveAssistantState(taskId, sessionId, patchEvents),
    );
  }

  function replaceLiveAssistantStateFromHistory(
    taskId: string,
    sessionId: string | undefined,
    patchEvents: TaskMessagePatchEvent[],
  ) {
    if (!taskId || !sessionId) {
      return createEmptyLiveAssistantState();
    }

    const replayedState = replayTaskMessagePatchEvents(patchEvents, sessionId);
    liveAssistantStates.set(buildLiveAssistantStateKey(taskId, sessionId), replayedState);
    return cloneLiveAssistantState(replayedState);
  }

  function replaceLiveAssistantStateFromPhaseHistory({
    taskId,
    phaseId,
    sessionIds,
    patchEvents,
  }: ReplaceLiveAssistantStateFromPhaseHistoryOptions) {
    const normalizedSessionIds = sessionIds.filter(
      (sessionId): sessionId is string =>
        typeof sessionId === "string" && sessionId.trim().length > 0,
    );
    if (!taskId || normalizedSessionIds.length === 0) {
      return createEmptyLiveAssistantState();
    }

    return replayPhaseLiveAssistantState(patchEvents, {
      phaseId: phaseId ?? null,
      sessionIds: normalizedSessionIds,
    });
  }

  function markConsumerHandled(consumerId: string, eventId: string | null | undefined) {
    if (!consumerId) {
      return;
    }

    if (eventId) {
      lastHandledPatchEventIds.set(consumerId, eventId);
      return;
    }

    lastHandledPatchEventIds.delete(consumerId);
  }

  function consumePendingTaskPatchEvents({
    consumerId,
    taskId,
    sessionId,
    patchEvents,
  }: ConsumePendingTaskPatchEventsOptions): ConsumePendingTaskPatchEventsResult {
    const relevantEvents = getConsumablePatchEvents(patchEvents, sessionId);
    if (relevantEvents.length === 0) {
      return {
        hasPendingEvents: false,
        pendingEvents: [],
        liveAssistantState: null,
      };
    }

    const lastHandledEventId = lastHandledPatchEventIds.get(consumerId);
    const lastHandledIndex = lastHandledEventId
      ? relevantEvents.findIndex((event) => event.eventId === lastHandledEventId)
      : -1;
    const pendingEvents =
      lastHandledIndex >= 0 ? relevantEvents.slice(lastHandledIndex + 1) : relevantEvents;

    if (pendingEvents.length === 0) {
      return {
        hasPendingEvents: false,
        pendingEvents: [],
        liveAssistantState: null,
      };
    }

    let nextLiveAssistantState: LiveAssistantState | null = null;
    for (const patchEvent of pendingEvents) {
      if (!sessionId || !isAssistantPatchEvent(patchEvent)) {
        continue;
      }

      const baseState: LiveAssistantState =
        nextLiveAssistantState ?? getOrReplayLiveAssistantState(taskId, sessionId, patchEvents);
      const appliedState = applyTaskMessagePatchEventToLiveAssistantState(
        baseState,
        patchEvent,
        sessionId,
      );
      if (appliedState === baseState) {
        continue;
      }

      nextLiveAssistantState = appliedState;
    }

    if (taskId && sessionId && nextLiveAssistantState) {
      liveAssistantStates.set(
        buildLiveAssistantStateKey(taskId, sessionId),
        nextLiveAssistantState,
      );
    }

    markConsumerHandled(consumerId, pendingEvents[pendingEvents.length - 1]?.eventId);

    return {
      hasPendingEvents: true,
      pendingEvents,
      liveAssistantState: nextLiveAssistantState
        ? cloneLiveAssistantState(nextLiveAssistantState)
        : null,
    };
  }

  function reset() {
    lastHandledPatchEventIds.clear();
    liveAssistantStates.clear();
  }

  return {
    consumePendingTaskPatchEvents,
    getLiveAssistantState,
    markConsumerHandled,
    replaceLiveAssistantStateFromHistory,
    replaceLiveAssistantStateFromPhaseHistory,
    reset,
  };
}