import { computed, type Ref } from "vue";
import {
  isTaskMessagePatchEventRelevant,
  toTaskMessagePatchEvent,
  type TaskMessagePatchEvent,
} from "../lib/task-message-patch-event";
import { useRealtimeStore } from "../stores/realtime";

export function useTaskMessagePatchFeed(taskIds: Ref<string[]>) {
  const realtimeStore = useRealtimeStore();

  const taskPatchEvents = computed(() => {
    const taskIdSet = new Set(
      taskIds.value.filter((taskId) => typeof taskId === "string" && taskId.length > 0),
    );

    return realtimeStore.events
      .filter((event) => event.taskId && taskIdSet.has(event.taskId))
      .map((event) => toTaskMessagePatchEvent(event));
  });

  const relevantTaskPatchEvents = computed(() =>
    taskPatchEvents.value.filter(isTaskMessagePatchEventRelevant),
  );

  const taskPatchEventSignature = computed(() =>
    taskPatchEvents.value.map((event) => event.eventId).join("|"),
  );

  const realtimeConnected = computed(() => realtimeStore.connected);

  function getTaskPatchEvents(taskId: string) {
    return taskPatchEvents.value.filter((event) => event.taskId === taskId);
  }

  function getRelevantTaskPatchEvents(taskId: string) {
    return relevantTaskPatchEvents.value.filter((event) => event.taskId === taskId);
  }

  function getLatestRelevantTaskPatchEvent(taskId: string) {
    return getRelevantTaskPatchEvents(taskId)[0] ?? null;
  }

  return {
    taskPatchEvents,
    relevantTaskPatchEvents,
    taskPatchEventSignature,
    realtimeConnected,
    getTaskPatchEvents,
    getRelevantTaskPatchEvents,
    getLatestRelevantTaskPatchEvent,
  } satisfies {
    taskPatchEvents: typeof taskPatchEvents;
    relevantTaskPatchEvents: typeof relevantTaskPatchEvents;
    taskPatchEventSignature: typeof taskPatchEventSignature;
    realtimeConnected: typeof realtimeConnected;
    getTaskPatchEvents: (taskId: string) => TaskMessagePatchEvent[];
    getRelevantTaskPatchEvents: (taskId: string) => Exclude<
      TaskMessagePatchEvent,
      { kind: "ignored" }
    >[];
    getLatestRelevantTaskPatchEvent: (
      taskId: string,
    ) => Exclude<TaskMessagePatchEvent, { kind: "ignored" }> | null;
  };
}