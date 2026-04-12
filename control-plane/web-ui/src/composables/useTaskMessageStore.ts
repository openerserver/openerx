import { type Ref, computed, ref, watch } from "vue";
import { createEmptyLiveAssistantState } from "../lib/message-normalize";
import { getTaskDetailRefreshRequest } from "../lib/task-detail-refresh-policy";
import type { TaskMessagePatchEvent } from "../lib/task-message-patch-event";
import { useTaskMessagePatchConsumer } from "./useTaskMessagePatchConsumer";

export type TaskConversationAuthority = "persisted" | "realtime";

export type TaskConversationPersistenceAck = {
  eventId: string;
  kind: "message-persisted" | "round-synced";
  sessionId?: string;
  roundId?: string;
  taskSessionId?: string;
  messageId?: string;
  persistedRevision?: number;
  snapshotVersion?: number;
  persistedThroughRevision?: number;
};

function isMatchingConversationSession(
  patchEvent: TaskMessagePatchEvent,
  sessionId: string | undefined,
) {
  if (!sessionId) {
    return true;
  }

  return (
    !patchEvent.sessionId ||
    patchEvent.sessionId === sessionId ||
    ("taskSessionId" in patchEvent && patchEvent.taskSessionId === sessionId) ||
    ("roundId" in patchEvent && patchEvent.roundId === sessionId)
  );
}

function toPersistenceAck(
  patchEvent: Extract<
    TaskMessagePatchEvent,
    { kind: "message-persisted" } | { kind: "round-synced" }
  >,
): TaskConversationPersistenceAck {
  return {
    eventId: patchEvent.eventId,
    kind: patchEvent.kind,
    sessionId: patchEvent.sessionId,
    roundId: patchEvent.roundId,
    taskSessionId: patchEvent.taskSessionId,
    messageId: patchEvent.messageId,
    persistedRevision:
      patchEvent.kind === "message-persisted" ? patchEvent.persistedRevision : undefined,
    snapshotVersion: patchEvent.snapshotVersion,
    persistedThroughRevision: patchEvent.persistedThroughRevision,
  };
}

function isRealtimeAuthorityPatch(patchEvent: TaskMessagePatchEvent) {
  return (
    patchEvent.kind === "assistant-progress" ||
    patchEvent.kind === "assistant-completed" ||
    patchEvent.kind === "assistant-delta"
  );
}

function isPersistedAuthorityPatch(
  patchEvent: TaskMessagePatchEvent,
): patchEvent is Extract<
  TaskMessagePatchEvent,
  { kind: "message-persisted" } | { kind: "round-synced" }
> {
  return patchEvent.kind === "message-persisted" || patchEvent.kind === "round-synced";
}

function resolveConversationAuthorityState(
  patchEvents: TaskMessagePatchEvent[],
  sessionId: string | undefined,
) {
  for (const patchEvent of patchEvents) {
    if (!isMatchingConversationSession(patchEvent, sessionId)) {
      continue;
    }

    if (isPersistedAuthorityPatch(patchEvent)) {
      return {
        authority: "persisted" as const,
        latestPersistenceAck: toPersistenceAck(patchEvent),
      };
    }

    if (isRealtimeAuthorityPatch(patchEvent)) {
      return {
        authority: "realtime" as const,
        latestPersistenceAck: null,
      };
    }
  }

  return {
    authority: "persisted" as const,
    latestPersistenceAck: null,
  };
}

function reduceConversationAuthorityState(args: {
  pendingEvents: TaskMessagePatchEvent[];
  sessionId: string | undefined;
  currentAuthority: TaskConversationAuthority;
  currentAck: TaskConversationPersistenceAck | null;
}) {
  let authority = args.currentAuthority;
  let latestPersistenceAck = args.currentAck;

  for (const patchEvent of args.pendingEvents) {
    if (!isMatchingConversationSession(patchEvent, args.sessionId)) {
      continue;
    }

    if (isPersistedAuthorityPatch(patchEvent)) {
      authority = "persisted";
      latestPersistenceAck = toPersistenceAck(patchEvent);
      continue;
    }

    if (isRealtimeAuthorityPatch(patchEvent)) {
      authority = "realtime";
      latestPersistenceAck = null;
    }
  }

  return {
    authority,
    latestPersistenceAck,
  };
}

export function useTaskMessageStore(
  taskId: Ref<string>,
  sessionId: Ref<string | undefined>,
) {
  const liveAssistantState = ref(createEmptyLiveAssistantState());
  const conversationAuthority = ref<TaskConversationAuthority>("persisted");
  const latestPersistenceAck = ref<TaskConversationPersistenceAck | null>(null);
  const taskIds = computed(() => (taskId.value ? [taskId.value] : []));
  const {
    realtimeConnected,
    getTaskPatchEvents,
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

    const authorityState = resolveConversationAuthorityState(
      getTaskPatchEvents(taskId.value),
      sessionId.value,
    );
    conversationAuthority.value = authorityState.authority;
    latestPersistenceAck.value = authorityState.latestPersistenceAck;
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
      if (consumed.hasPendingEvents) {
        const authorityState = reduceConversationAuthorityState({
          pendingEvents: consumed.pendingEvents,
          sessionId: sessionId.value,
          currentAuthority: conversationAuthority.value,
          currentAck: latestPersistenceAck.value,
        });
        conversationAuthority.value = authorityState.authority;
        latestPersistenceAck.value = authorityState.latestPersistenceAck;
      }

      if (!consumed.hasPendingEvents || !consumed.liveAssistantState) {
        return;
      }

      liveAssistantState.value = consumed.liveAssistantState;
    },
  );

  return {
    conversationAuthority,
    latestTaskRefreshRequest,
    latestPersistenceAck,
    liveAssistantState,
    realtimeConnected,
  };
}