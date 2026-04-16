import { type Ref, computed, ref, watch } from "vue";
import {
  createEmptyLiveAssistantState,
  normalizeMessage,
  normalizeWorkflowGroup,
  type TaskConversationListItem,
  type TaskConversationMessageItem,
  type TaskConversationWorkflowItem,
} from "../lib/message-normalize";
import { getTaskDetailRefreshRequest } from "../lib/task-detail-refresh-policy";
import type { TaskMessagePatchEvent } from "../lib/task-message-patch-event";
import {
  buildTaskConversationRenderState,
  collectAssistantMessageKeysFromRenderState,
  getTaskConversationRenderItems,
  getTaskConversationRenderMessageItems,
  type PendingAssistantDraftState,
} from "../lib/task-conversation-display";
import {
  summarizeLiveAssistantState,
  summarizeTaskPatchEvent,
  summarizeTaskRefreshRequest,
  traceTaskDetailRealtime,
} from "../lib/task-detail-realtime-debug";
import { useTaskMessagePatchConsumer } from "./useTaskMessagePatchConsumer";

export type TaskConversationAuthority = "persisted" | "realtime";

export type TaskConversationPersistenceAck = {
  eventId: string;
  kind: "message-persisted" | "round-synced";
  phaseId?: string;
  sessionId?: string;
  roundId?: string;
  taskSessionId?: string;
  messageId?: string;
  persistedRevision?: number;
  snapshotVersion?: number;
  persistedThroughRevision?: number;
};

type UseTaskMessageStoreOptions = {
  sourceMessages?: Ref<unknown[]>;
  persistedItems?: Ref<TaskConversationMessageItem[]>;
  snapshotRevision?: Ref<number>;
  hideWorkflowExecutionContextUsers?: Ref<boolean>;
  workflowItems?: Ref<TaskConversationWorkflowItem[]>;
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
    phaseId: patchEvent.phaseId,
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

function resolveAckRevision(args: {
  persistedRevision?: number;
  persistedThroughRevision?: number;
  snapshotVersion?: number;
}) {
  return args.persistedThroughRevision ?? args.snapshotVersion ?? args.persistedRevision ?? 0;
}

function hasPersistedAssistantPayloadCaughtUp(args: {
  persistedItems: TaskConversationMessageItem[];
  liveAssistantState: LiveAssistantState;
}) {
  const persistedAssistantById = new Map(
    args.persistedItems
      .filter((item) => item.role === "assistant")
      .map((item) => [item.key, item] as const),
  );

  for (const messageId of args.liveAssistantState.orderedAssistantMessageIds) {
    const liveText = args.liveAssistantState.textById.get(messageId)?.trim();
    const liveThinkingText = args.liveAssistantState.thinkingById.get(messageId)?.trim();
    const hasLivePayload =
      args.liveAssistantState.metaById.has(messageId) ||
      Boolean(liveText) ||
      Boolean(liveThinkingText) ||
      args.liveAssistantState.incompleteIds.has(messageId);

    if (!hasLivePayload) {
      continue;
    }

    const persistedItem = persistedAssistantById.get(messageId);
    if (!persistedItem) {
      return false;
    }

    if (liveText && !persistedItem.text?.trim()) {
      return false;
    }

    if (liveThinkingText && !persistedItem.thinkingText?.trim()) {
      return false;
    }
  }

  return true;
}

export function useTaskMessageStore(
  taskId: Ref<string>,
  sessionId: Ref<string | undefined>,
  options?: UseTaskMessageStoreOptions,
) {
  const liveAssistantState = ref(createEmptyLiveAssistantState());
  const conversationAuthority = ref<TaskConversationAuthority>("persisted");
  const latestPersistenceAck = ref<TaskConversationPersistenceAck | null>(null);
  const pendingAssistantDraft = ref<PendingAssistantDraftState | null>(null);
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
  const sourceMessages = computed(() => options?.sourceMessages?.value ?? []);
  const persistedItems = computed(() => {
    if (options?.persistedItems) {
      return options.persistedItems.value;
    }

    return sourceMessages.value
      .map((entry, index) => normalizeMessage(entry, index, createEmptyLiveAssistantState()))
      .filter((entry): entry is TaskConversationMessageItem => entry != null)
      .filter((entry) => entry.role !== "system");
  });
  const workflowItems = computed(() => {
    if (options?.workflowItems) {
      return options.workflowItems.value;
    }

    return sourceMessages.value
      .map((entry) => normalizeWorkflowGroup(entry))
      .filter((entry): entry is TaskConversationWorkflowItem => entry != null);
  });
  const hideWorkflowExecutionContextUsers = computed(
    () => options?.hideWorkflowExecutionContextUsers?.value ?? workflowItems.value.length > 0,
  );
  const persistedSnapshotRevision = computed(() => options?.snapshotRevision?.value ?? 0);
  const displayConversationAuthority = computed(() => {
    if (conversationAuthority.value !== "persisted") {
      return conversationAuthority.value;
    }

    const latestAckRevision = resolveAckRevision({
      persistedRevision: latestPersistenceAck.value?.persistedRevision,
      persistedThroughRevision: latestPersistenceAck.value?.persistedThroughRevision,
      snapshotVersion: latestPersistenceAck.value?.snapshotVersion,
    });
    if (latestAckRevision > persistedSnapshotRevision.value) {
      return "realtime" as const;
    }

    if (
      !hasPersistedAssistantPayloadCaughtUp({
        persistedItems: persistedItems.value,
        liveAssistantState: liveAssistantState.value,
      })
    ) {
      return "realtime" as const;
    }

    return "persisted" as const;
  });
  const displayLiveAssistantState = computed(() =>
    displayConversationAuthority.value === "realtime"
      ? liveAssistantState.value
      : createEmptyLiveAssistantState(),
  );
  const conversationState = computed(() =>
    buildTaskConversationRenderState({
      persistedItems: persistedItems.value,
      workflowItems: workflowItems.value,
      liveAssistantState: displayLiveAssistantState.value,
      authority: displayConversationAuthority.value,
      pendingAssistantDraft: pendingAssistantDraft.value,
      activeSessionId: sessionId.value,
      latestTaskRefreshReason: latestTaskRefreshRequest.value?.reason,
      hideWorkflowExecutionContextUsers: hideWorkflowExecutionContextUsers.value,
    }),
  );
  const assistantMessageKeys = computed(() =>
    collectAssistantMessageKeysFromRenderState(conversationState.value),
  );
  const items = computed(() => getTaskConversationRenderMessageItems(conversationState.value));
  const conversationItems = computed<TaskConversationListItem[]>(() =>
    getTaskConversationRenderItems(conversationState.value),
  );
  const hasVisiblePendingAssistantDraft = computed(() => {
    const pending = pendingAssistantDraft.value;
    if (!pending) {
      return false;
    }

    return items.value.some((item) => item.key === pending.key);
  });
  const hasLiveAssistantPatchActivity = computed(() => {
    const state = liveAssistantState.value;
    return (
      state.orderedAssistantMessageIds.length > 0 ||
      state.incompleteIds.size > 0 ||
      state.textById.size > 0 ||
      state.thinkingById.size > 0 ||
      state.metaById.size > 0
    );
  });
  const hasStreamingAssistant = computed(() =>
    conversationItems.value.some(
      (item) => item.role === "assistant" && Boolean(item.isStreaming),
    ),
  );
  const streamingAssistantKeys = computed(() =>
    conversationItems.value
      .filter((item) => item.role === "assistant" && Boolean(item.isStreaming))
      .map((item) => item.key),
  );
  const needsMessagePollingFallback = computed(
    () => hasVisiblePendingAssistantDraft.value && !hasLiveAssistantPatchActivity.value,
  );

  function seedPendingAssistantDraft(targetSessionId?: string) {
    if (!taskId.value || !targetSessionId) {
      return;
    }

    const createdAt = new Date().toISOString();
    pendingAssistantDraft.value = {
      key: `pending-assistant:${targetSessionId}:${createdAt}`,
      sessionId: targetSessionId,
      createdAt,
      knownAssistantKeys: new Set(assistantMessageKeys.value),
    };
    traceTaskDetailRealtime("store:seed-pending-draft", {
      taskId: taskId.value,
      sessionId: targetSessionId,
      pendingDraftKey: pendingAssistantDraft.value.key,
      knownAssistantKeys: [...pendingAssistantDraft.value.knownAssistantKeys],
    }, { taskId: taskId.value });
  }

  function clearPendingAssistantDraft(targetSessionId?: string) {
    if (!pendingAssistantDraft.value) {
      return;
    }

    if (targetSessionId && pendingAssistantDraft.value.sessionId !== targetSessionId) {
      return;
    }

    traceTaskDetailRealtime("store:clear-pending-draft", {
      taskId: taskId.value,
      sessionId: pendingAssistantDraft.value.sessionId,
      pendingDraftKey: pendingAssistantDraft.value.key,
      requestedSessionId: targetSessionId,
    }, { taskId: taskId.value });
    pendingAssistantDraft.value = null;
  }

  function resetLiveAssistantStateFromHistory() {
    const replayed = replaceLiveAssistantStateFromHistory({
      consumerId: "task-message-store",
      taskId: taskId.value,
      sessionId: sessionId.value,
    });
    liveAssistantState.value = replayed.liveAssistantState;

    const authorityState = resolveConversationAuthorityState(
      getTaskPatchEvents(taskId.value),
      sessionId.value,
    );
    conversationAuthority.value = authorityState.authority;
    latestPersistenceAck.value = authorityState.latestPersistenceAck;

    traceTaskDetailRealtime("store:reset-from-history", {
      taskId: taskId.value,
      sessionId: sessionId.value,
      latestTaskPatchEvent: summarizeTaskPatchEvent(replayed.latestTaskPatchEvent),
      authority: authorityState.authority,
      latestPersistenceAck: authorityState.latestPersistenceAck,
      liveAssistantState: summarizeLiveAssistantState(liveAssistantState.value),
    }, { taskId: taskId.value });
  }

  watch([taskId, sessionId], resetLiveAssistantStateFromHistory, { immediate: true });

  watch(taskId, (nextTaskId, previousTaskId) => {
    if (!nextTaskId || nextTaskId !== previousTaskId) {
      pendingAssistantDraft.value = null;
    }
  });

  watch(
    () => latestTaskRefreshRequest.value?.eventId,
    () => {
      const refreshReason = latestTaskRefreshRequest.value?.reason;
      if (refreshReason === "task-completed" || refreshReason === "task-failed") {
        pendingAssistantDraft.value = null;
        traceTaskDetailRealtime("store:auto-clear-pending-draft", {
          taskId: taskId.value,
          sessionId: sessionId.value,
          reason: "draft-no-longer-visible",
        }, { taskId: taskId.value });
      }
    },
  );

  watch(
    [sessionId, () => assistantMessageKeys.value.size, () => latestTaskRefreshRequest.value?.eventId],
    () => {
      if (!pendingAssistantDraft.value) {
        return;
      }

      if (
        pendingAssistantDraft.value.sessionId === sessionId.value &&
        !hasVisiblePendingAssistantDraft.value
      ) {
        pendingAssistantDraft.value = null;
      }
    },
  );

  watch(
    () => latestTaskPatchEvent.value?.eventId,
    () => {
      const authorityBefore = conversationAuthority.value;
      const consumed = consumePendingTaskPatchEvents({
        consumerId: "task-message-store",
        taskId: taskId.value,
        sessionId: sessionId.value,
      });
      let authorityAfter = authorityBefore;
      let nextPersistenceAck = latestPersistenceAck.value;

      if (consumed.hasPendingEvents) {
        const authorityState = reduceConversationAuthorityState({
          pendingEvents: consumed.pendingEvents,
          sessionId: sessionId.value,
          currentAuthority: conversationAuthority.value,
          currentAck: latestPersistenceAck.value,
        });
        conversationAuthority.value = authorityState.authority;
        latestPersistenceAck.value = authorityState.latestPersistenceAck;
        authorityAfter = authorityState.authority;
        nextPersistenceAck = authorityState.latestPersistenceAck;
      }

      if (!consumed.hasPendingEvents || !consumed.liveAssistantState) {
        traceTaskDetailRealtime("store:consume-patch", {
          taskId: taskId.value,
          sessionId: sessionId.value,
          latestTaskPatchEvent: summarizeTaskPatchEvent(latestTaskPatchEvent.value),
          hasPendingEvents: consumed.hasPendingEvents,
          authorityBefore,
          authorityAfter,
          latestPersistenceAck: nextPersistenceAck,
          liveAssistantState: summarizeLiveAssistantState(liveAssistantState.value),
        }, { taskId: taskId.value });
        return;
      }

      liveAssistantState.value = consumed.liveAssistantState;
      traceTaskDetailRealtime("store:consume-patch", {
        taskId: taskId.value,
        sessionId: sessionId.value,
        latestTaskPatchEvent: summarizeTaskPatchEvent(latestTaskPatchEvent.value),
        hasPendingEvents: consumed.hasPendingEvents,
        authorityBefore,
        authorityAfter,
        latestPersistenceAck: nextPersistenceAck,
        liveAssistantState: summarizeLiveAssistantState(liveAssistantState.value),
      }, { taskId: taskId.value });
    },
  );

  watch(
    [
      taskId,
      sessionId,
      displayConversationAuthority,
      () => items.value.length,
      () => conversationItems.value.length,
      hasStreamingAssistant,
      () => latestTaskRefreshRequest.value?.eventId,
    ],
    () => {
      traceTaskDetailRealtime("render:conversation-state", {
        taskId: taskId.value,
        sessionId: sessionId.value,
        displayConversationAuthority: displayConversationAuthority.value,
        messageItemCount: items.value.length,
        conversationItemCount: conversationItems.value.length,
        hasStreamingAssistant: hasStreamingAssistant.value,
        streamingAssistantKeys: streamingAssistantKeys.value,
        hasVisiblePendingAssistantDraft: hasVisiblePendingAssistantDraft.value,
        hasLiveAssistantPatchActivity: hasLiveAssistantPatchActivity.value,
        needsMessagePollingFallback: needsMessagePollingFallback.value,
        pendingAssistantDraft: pendingAssistantDraft.value
          ? {
              key: pendingAssistantDraft.value.key,
              sessionId: pendingAssistantDraft.value.sessionId,
              createdAt: pendingAssistantDraft.value.createdAt,
              knownAssistantKeyCount: pendingAssistantDraft.value.knownAssistantKeys.size,
            }
          : null,
        latestTaskRefreshRequest: summarizeTaskRefreshRequest(latestTaskRefreshRequest.value),
        liveAssistantState: summarizeLiveAssistantState(displayLiveAssistantState.value),
      }, { taskId: taskId.value });
    },
    { immediate: true },
  );

  return {
    conversationState,
    items,
    conversationItems,
    conversationAuthority,
    clearPendingAssistantDraft,
    displayConversationAuthority,
    hasStreamingAssistant,
    needsMessagePollingFallback,
    latestTaskRefreshRequest,
    latestPersistenceAck,
    liveAssistantState,
    realtimeConnected,
    seedPendingAssistantDraft,
  };
}