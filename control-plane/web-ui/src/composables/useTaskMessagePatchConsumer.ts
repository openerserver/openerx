import { createEmptyLiveAssistantState } from "../lib/message-normalize";
import {
  summarizeLiveAssistantState,
  summarizeTaskPatchEffects,
  summarizeTaskPatchEvent,
  summarizeTaskPatchEvents,
  traceTaskDetailRealtime,
} from "../lib/task-detail-realtime-debug";
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
    getTaskPatchEvents: getMappedTaskPatchEvents,
    getRelevantTaskPatchEvents,
    getLatestRelevantTaskPatchEvent,
  } = useTaskMessagePatchFeed(taskIds);

  function getTaskPatchEvents(taskId: string) {
    return getRelevantTaskPatchEvents(taskId);
  }

  function getPhaseTaskPatchEvents(taskId: string, phaseId: string | null | undefined) {
    const events = getRelevantTaskPatchEvents(taskId);
    if (!phaseId) {
      return events;
    }
    return events.filter((event) => !event.phaseId || event.phaseId === phaseId);
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

  function getPhaseLiveAssistantState(options: {
    taskId: string;
    phaseId: string | null | undefined;
    sessionIds: string[];
  }) {
    return liveAssistantStateManager.replaceLiveAssistantStateFromPhaseHistory({
      taskId: options.taskId,
      phaseId: options.phaseId,
      sessionIds: options.sessionIds,
      patchEvents: getTaskPatchEvents(options.taskId),
    });
  }

  function replaceLiveAssistantStateFromHistory({
    consumerId,
    taskId,
    sessionId,
  }: TaskMessagePatchConsumerScope) {
    const latestTaskPatchEvent = getLatestTaskPatchEvent(taskId);
    const patchEvents = getTaskPatchEvents(taskId);
    const mappedPatchEvents = getMappedTaskPatchEvents(taskId);
    if (!taskId || !sessionId) {
      liveAssistantStateManager.markConsumerHandled(
        consumerId,
        latestTaskPatchEvent?.eventId ?? null,
      );
      traceTaskDetailRealtime("consumer:replay-history-skipped", {
        consumerId,
        taskId,
        sessionId,
        patchEventCount: patchEvents.length,
        mappedPatchEventCount: mappedPatchEvents.length,
        latestMappedTaskPatchEvent: summarizeTaskPatchEvent(mappedPatchEvents[0] ?? null),
        latestTaskPatchEvent: summarizeTaskPatchEvent(latestTaskPatchEvent),
      }, { taskId });
      return {
        latestTaskPatchEvent,
        liveAssistantState: createEmptyLiveAssistantState(),
      };
    }

    const liveAssistantState = liveAssistantStateManager.replaceLiveAssistantStateFromHistory(
      taskId,
      sessionId,
      patchEvents,
    );
    liveAssistantStateManager.markConsumerHandled(
      consumerId,
      latestTaskPatchEvent?.eventId ?? null,
    );

    traceTaskDetailRealtime("consumer:replay-history", {
      consumerId,
      taskId,
      sessionId,
      patchEventCount: patchEvents.length,
      mappedPatchEventCount: mappedPatchEvents.length,
      latestMappedTaskPatchEvent: summarizeTaskPatchEvent(mappedPatchEvents[0] ?? null),
      latestTaskPatchEvent: summarizeTaskPatchEvent(latestTaskPatchEvent),
      liveAssistantState: summarizeLiveAssistantState(liveAssistantState),
    }, { taskId });

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
    const patchEvents = getTaskPatchEvents(taskId);
    const mappedPatchEvents = getMappedTaskPatchEvents(taskId);
    const consumed = liveAssistantStateManager.consumePendingTaskPatchEvents({
      consumerId,
      taskId,
      sessionId,
      patchEvents,
    });
    const effects = summarizeTaskMessagePatchEffects(consumed.pendingEvents);

    traceTaskDetailRealtime("consumer:consume-pending", {
      consumerId,
      taskId,
      sessionId,
      patchEventCount: patchEvents.length,
      mappedPatchEventCount: mappedPatchEvents.length,
      latestMappedTaskPatchEvent: summarizeTaskPatchEvent(mappedPatchEvents[0] ?? null),
      latestTaskPatchEvent: summarizeTaskPatchEvent(latestTaskPatchEvent),
      pendingEventCount: consumed.pendingEvents.length,
      pendingEvents: summarizeTaskPatchEvents(consumed.pendingEvents),
      effects: summarizeTaskPatchEffects(effects),
      liveAssistantState: summarizeLiveAssistantState(consumed.liveAssistantState),
    }, { taskId });

    return {
      latestTaskPatchEvent,
      effects,
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
    getPhaseTaskPatchEvents,
    getLatestTaskPatchEvent,
    getLiveAssistantState,
    getPhaseLiveAssistantState,
    replaceLiveAssistantStateFromHistory,
    consumePendingTaskPatchEvents,
    reset,
  };
}