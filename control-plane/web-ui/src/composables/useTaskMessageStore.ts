import { type Ref, computed, ref, watch } from "vue";
import { createEmptyLiveAssistantState } from "../lib/message-normalize";
import { getTaskDetailRefreshRequest } from "../lib/task-detail-refresh-policy";
import { useTaskMessagePatchConsumer } from "./useTaskMessagePatchConsumer";

export function useTaskMessageStore(
  taskId: Ref<string>,
  sessionId: Ref<string | undefined>,
) {
  const liveAssistantState = ref(createEmptyLiveAssistantState());
  const taskIds = computed(() => (taskId.value ? [taskId.value] : []));
  const {
    realtimeConnected,
    getLatestTaskPatchEvent,
    replaceLiveAssistantStateFromHistory,
    consumePendingTaskPatchEvents,
  } = useTaskMessagePatchConsumer(taskIds);
  const latestTaskPatchEvent = computed(() => getLatestTaskPatchEvent(taskId.value));
  const latestTaskRefreshRequest = computed(() =>
    getTaskDetailRefreshRequest(latestTaskPatchEvent.value),
  );

  function resetLiveAssistantStateFromHistory() {
    liveAssistantState.value = replaceLiveAssistantStateFromHistory({
      consumerId: "task-message-store",
      taskId: taskId.value,
      sessionId: sessionId.value,
    }).liveAssistantState;
  }

  watch([taskId, sessionId], resetLiveAssistantStateFromHistory, { immediate: true });

  watch(
    () => latestTaskPatchEvent.value?.eventId,
    () => {
      const consumed = consumePendingTaskPatchEvents({
        consumerId: "task-message-store",
        taskId: taskId.value,
        sessionId: sessionId.value,
      });
      if (!consumed.hasPendingEvents || !consumed.liveAssistantState) {
        return;
      }

      liveAssistantState.value = consumed.liveAssistantState;
    },
  );

  return {
    latestTaskRefreshRequest,
    liveAssistantState,
    realtimeConnected,
  };
}