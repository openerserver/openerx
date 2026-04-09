import { type Ref } from "vue";
import { useTaskMessagePatchConsumer } from "./useTaskMessagePatchConsumer";

type MonitoredTaskPatchConsumption = {
  taskId: string;
  sessionId: string | undefined;
  shouldRefreshPersistedMessages: boolean;
  shouldRefreshSummary: boolean;
};

export function useMultiTaskMessageStore(taskIds: Ref<string[]>) {
  const {
    taskPatchEventSignature,
    getLiveAssistantState: getLiveAssistantStateForTask,
    consumePendingTaskPatchEvents: consumeTaskPatchEventsForConsumer,
    reset,
  } = useTaskMessagePatchConsumer(taskIds);

  function getLiveAssistantState(taskId: string, sessionId: string | undefined) {
    return getLiveAssistantStateForTask(taskId, sessionId);
  }

  function consumePendingTaskPatchEventsForTask(taskId: string, sessionId: string | undefined) {
    const consumed = consumeTaskPatchEventsForConsumer({
      consumerId: taskId,
      taskId,
      sessionId,
    });
    if (!consumed.hasPendingEvents) {
      return {
        hasPendingEvents: false,
        shouldRefreshPersistedMessages: false,
        shouldRefreshSummary: false,
      };
    }

    return {
      hasPendingEvents: true,
      shouldRefreshPersistedMessages:
        Boolean(sessionId) && consumed.effects.shouldRefreshCanonicalMessages,
      shouldRefreshSummary: consumed.effects.shouldRefreshMonitorSummary,
    };
  }

  function consumeMonitoredTaskPatchEvents(
    resolveSessionId: (taskId: string) => string | undefined,
  ) {
    const consumptions: MonitoredTaskPatchConsumption[] = [];

    for (const taskId of new Set(taskIds.value.filter(Boolean))) {
      const sessionId = resolveSessionId(taskId);
      const {
        hasPendingEvents,
        shouldRefreshPersistedMessages,
        shouldRefreshSummary,
      } = consumePendingTaskPatchEventsForTask(taskId, sessionId);
      if (!hasPendingEvents) {
        continue;
      }

      consumptions.push({
        taskId,
        sessionId,
        shouldRefreshPersistedMessages,
        shouldRefreshSummary,
      });
    }

    return consumptions;
  }

  async function processMonitoredTaskPatchEvents(args: {
    resolveSessionId: (taskId: string) => string | undefined;
    refreshSummary: (taskId: string) => void | Promise<void>;
    refreshPersistedMessages: (taskId: string, sessionId: string) => Promise<void>;
    rebuildSummary: (taskId: string) => void;
  }) {
    const consumptions = consumeMonitoredTaskPatchEvents(args.resolveSessionId);

    for (const consumption of consumptions) {
      if (consumption.shouldRefreshSummary) {
        void args.refreshSummary(consumption.taskId);
      }

      if (consumption.shouldRefreshPersistedMessages && consumption.sessionId) {
        await args.refreshPersistedMessages(consumption.taskId, consumption.sessionId);
      }

      args.rebuildSummary(consumption.taskId);
    }

    return consumptions;
  }

  return {
    taskPatchEventSignature,
    getLiveAssistantState,
    consumeMonitoredTaskPatchEvents,
    processMonitoredTaskPatchEvents,
    reset,
  };
}