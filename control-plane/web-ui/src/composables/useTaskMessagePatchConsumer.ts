import { createEmptyLiveAssistantState } from "../lib/message-normalize";
import {
  createTaskLiveAssistantStateManager,
  type ConsumePendingTaskPatchEventsOptions,
} from "../lib/task-live-assistant-state-manager";
import { summarizeTaskMessagePatchEffects } from "../lib/task-message-patch-effects";
import { useTaskMessagePatchFeed } from "./useTaskMessagePatchFeed";
import { type Ref } from "vue";

type TaskMessagePatchConsumerScope = Omit<
  ConsumePendingTaskPatchEventsOptions,
  "patchEvents"
>;

export function useTaskMessagePatchConsumer(taskIds: Ref<string[]>) {
  const liveAssistantStateManager = createTaskLiveAssistantStateManager();
  const {
    taskPatchEventSignature,
    realtimeConnected,
    getRelevantTaskPatchEvents,
    getLatestRelevantTaskPatchEvent,
  } = useTaskMessagePatchFeed(taskIds);

  function getTaskPatchEvents(taskId: string) {
    return getRelevantTaskPatchEvents(taskId);
  }

  function getLatestTaskPatchEvent(taskId: string) {
    return getLatestRelevantTaskPatchEvent(taskId);
  }

  function getLiveAssistantState(taskId: string, sessionId: string | undefined) {
    return liveAssistantStateManager.replaceLiveAssistantStateFromHistory(
      taskId,
      sessionId,
      getTaskPatchEvents(taskId),
    );
  }

  function replaceLiveAssistantStateFromHistory({
    consumerId,
    taskId,
    sessionId,
  }: TaskMessagePatchConsumerScope) {
    const latestTaskPatchEvent = getLatestTaskPatchEvent(taskId);
    if (!taskId || !sessionId) {
      liveAssistantStateManager.markConsumerHandled(
        consumerId,
        latestTaskPatchEvent?.eventId ?? null,
      );
      return {
        latestTaskPatchEvent,
        liveAssistantState: createEmptyLiveAssistantState(),
      };
    }

    const liveAssistantState = liveAssistantStateManager.replaceLiveAssistantStateFromHistory(
      taskId,
      sessionId,
      getTaskPatchEvents(taskId),
    );
    liveAssistantStateManager.markConsumerHandled(
      consumerId,
      latestTaskPatchEvent?.eventId ?? null,
    );

    return {
      latestTaskPatchEvent,
      liveAssistantState,
    };
  }

  function consumePendingTaskPatchEvents({
    consumerId,
    taskId,
    sessionId,
  }: TaskMessagePatchConsumerScope) {
    const latestTaskPatchEvent = getLatestTaskPatchEvent(taskId);
    const consumed = liveAssistantStateManager.consumePendingTaskPatchEvents({
      consumerId,
      taskId,
      sessionId,
      patchEvents: getTaskPatchEvents(taskId),
    });

    return {
      latestTaskPatchEvent,
      effects: summarizeTaskMessagePatchEffects(consumed.pendingEvents),
      ...consumed,
    };
  }

  function reset() {
    liveAssistantStateManager.reset();
  }

  return {
    taskPatchEventSignature,
    realtimeConnected,
    getTaskPatchEvents,
    getLatestTaskPatchEvent,
    getLiveAssistantState,
    replaceLiveAssistantStateFromHistory,
    consumePendingTaskPatchEvents,
    reset,
  };
}