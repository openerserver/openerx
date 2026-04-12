/**
 * useTreeMessages — tree-native message composable for TaskDetailV3.
 *
 * Uses task-level conversation messages as the primary read source while preserving
 * live realtime overlays for in-flight assistant output.
 */
import { type Ref, computed, ref, watch } from "vue";
import {
  type TaskExecutionTrace,
  type TaskRoundDto,
  type TaskRoundMessageDto,
  getCurrentTaskRound,
  getTaskRoundMessages,
  getTaskRounds,
} from "../lib/api";
import {
  type TaskConversationListItem,
  type TaskConversationMessageItem,
  type TaskConversationWorkflowItem,
  asRecord,
  asString,
  createEmptyLiveAssistantState,
  normalizeMessage,
  normalizeWorkflowGroup,
} from "../lib/message-normalize";
import {
  buildTaskConversationDisplayMessages,
  collectAssistantMessageKeys,
  type PendingAssistantDraftState,
} from "../lib/task-conversation-display";
import { useTaskMessageStore } from "./useTaskMessageStore";

export type { TaskConversationListItem, TaskConversationMessageItem };
export type {
  TaskConversationToolCallItem,
  TaskConversationParallelItem,
  TaskConversationWorkflowItem,
} from "../lib/message-normalize";

/* ------------------------------------------------------------------ */
/*  Primary composable                                                 */
/* ------------------------------------------------------------------ */

function resolveRoundForRequestedSession(rounds: TaskRoundDto[], requestedSessionId?: string) {
  if (!requestedSessionId) {
    return null;
  }

  return (
    rounds.find(
      (round) => round.sessionId === requestedSessionId || round.id === requestedSessionId,
    ) ?? null
  );
}

function toRoundMessageRecord(message: TaskRoundMessageDto) {
  const completedAt = message.completedAt ?? message.updatedAt ?? null;

  return {
    id: message.id,
    role: message.role,
    status: message.status,
    errorText: message.errorText ?? undefined,
    text: message.text,
    textContent: message.text,
    createdAt: message.createdAt,
    completedAt,
    info: {
      id: message.id,
      role: message.role,
      status: message.status,
      time: {
        created: message.startedAt ?? message.createdAt,
        completed: completedAt,
      },
    },
    parts: message.parts.map((part) => ({
      id: part.id,
      type: "text",
      text: part.text,
      finalizedAt: part.finalizedAt ?? undefined,
    })),
  };
}

function resolveAckRevision(args: {
  persistedRevision?: number;
  persistedThroughRevision?: number;
  snapshotVersion?: number;
}) {
  return args.persistedThroughRevision ?? args.snapshotVersion ?? args.persistedRevision ?? 0;
}

type PendingAssistantDraft = PendingAssistantDraftState;

export function collectPersistedMessageIds(messages: unknown[]) {
  const ids = new Set<string>();

  for (const entry of messages) {
    const record = asRecord(entry);
    const info = asRecord(record?.info);
    const rawPayload = asRecord(record?.rawPayload);
    const rawInfo = asRecord(rawPayload?.info);
    const candidates = [
      asString(record?.id),
      asString(record?.messageID),
      asString(record?.runtimeMessageId),
      asString(info?.id),
      asString(rawInfo?.id),
    ];

    for (const candidate of candidates) {
      if (candidate) {
        ids.add(candidate);
      }
    }
  }

  for (const message of messages
    .map((entry, index) => normalizeMessage(entry, index, createEmptyLiveAssistantState()))
    .filter((entry): entry is TaskConversationMessageItem => entry != null)) {
    if (message.key) {
      ids.add(message.key);
    }
  }

  return ids;
}

export function useTreeMessages(
  taskId: Ref<string>,
  sessionId: Ref<string | undefined>,
  options?: { includeLineage?: boolean },
) {
  const trace = ref<TaskExecutionTrace | null>(null);
  const messages = ref<unknown[]>([]);
  const resolvedSessionId = ref<string | undefined>(undefined);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const pendingAssistantDraft = ref<PendingAssistantDraft | null>(null);
  let refreshGeneration = 0;
  const activeSessionId = computed(() => resolvedSessionId.value ?? sessionId.value);
  const {
    conversationAuthority,
    latestPersistenceAck,
    latestTaskRefreshRequest,
    liveAssistantState,
    realtimeConnected,
  } = useTaskMessageStore(taskId, activeSessionId);

  const persistedSnapshotRevision = computed(() => {
    const timelineMeta = trace.value?.timelineMeta;
    return resolveAckRevision({
      persistedThroughRevision: timelineMeta?.persistedThroughRevision,
      snapshotVersion: timelineMeta?.snapshotVersion,
    });
  });

  const latestAckRevision = computed(() =>
    resolveAckRevision({
      persistedRevision: latestPersistenceAck.value?.persistedRevision,
      persistedThroughRevision: latestPersistenceAck.value?.persistedThroughRevision,
      snapshotVersion: latestPersistenceAck.value?.snapshotVersion,
    }),
  );

  const displayConversationAuthority = computed(() => {
    if (conversationAuthority.value !== "persisted") {
      return conversationAuthority.value;
    }

    if (latestAckRevision.value > persistedSnapshotRevision.value) {
      return "realtime" as const;
    }

    return "persisted" as const;
  });

  const displayLiveAssistantState = computed(() =>
    displayConversationAuthority.value === "realtime"
      ? liveAssistantState.value
      : createEmptyLiveAssistantState(),
  );

  async function refresh(silent = false) {
    const currentRefreshGeneration = ++refreshGeneration;
    const currentTaskId = taskId.value;
    const requestedSessionId = sessionId.value;

    if (!currentTaskId) {
      trace.value = null;
      messages.value = [];
      resolvedSessionId.value = undefined;
      error.value = null;
      loading.value = false;
      return;
    }

    if (!silent) loading.value = true;
    error.value = null;

    try {
      const targetRound = requestedSessionId
        ? resolveRoundForRequestedSession(
            (await getTaskRounds(currentTaskId)).rounds,
            requestedSessionId,
          )
        : (await getCurrentTaskRound(currentTaskId)).round;
      if (currentRefreshGeneration !== refreshGeneration) {
        return;
      }

      if (!targetRound) {
        messages.value = [];
        resolvedSessionId.value = requestedSessionId;
        trace.value = {
          taskId: currentTaskId,
          sessionId: requestedSessionId ?? null,
          segments: [],
          messages: [],
          timeline: [],
          timelineMeta: {
            readSource: "task-domain-projection",
            includeLineage: options?.includeLineage,
            itemCount: 0,
            complete: true,
            reconcileRequired: false,
            snapshotVersion: 0,
            persistedThroughRevision: 0,
          },
          hookExecutions: [],
          followupExecutions: [],
        } satisfies TaskExecutionTrace;
        return;
      }

      const response = await getTaskRoundMessages(currentTaskId, targetRound.id);
      if (currentRefreshGeneration !== refreshGeneration) {
        return;
      }

      messages.value = Array.isArray(response.messages)
        ? response.messages.map((message) => toRoundMessageRecord(message))
        : [];
      resolvedSessionId.value = response.round.sessionId ?? requestedSessionId;
      trace.value = {
        taskId: currentTaskId,
        sessionId: response.round.sessionId ?? requestedSessionId ?? null,
        segments: [],
        messages: [],
        timeline: [],
        timelineMeta: {
          readSource: "task-domain-projection",
          includeLineage: options?.includeLineage,
          itemCount: response.messages.length,
          complete: !response.reconcileRequired,
          roundId: response.round.id,
          snapshotVersion: response.snapshotVersion,
          persistedThroughRevision: response.persistedThroughRevision,
          reconcileRequired: Boolean(response.reconcileRequired),
        },
        hookExecutions: [],
        followupExecutions: [],
      } satisfies TaskExecutionTrace;
    } catch (nextError) {
      if (currentRefreshGeneration !== refreshGeneration) {
        return;
      }

      trace.value = null;
      messages.value = [];
      resolvedSessionId.value = undefined;
      error.value = nextError instanceof Error ? nextError.message : "加载消息失败";
    } finally {
      if (currentRefreshGeneration === refreshGeneration) {
        loading.value = false;
      }
    }
  }

  const persistedMessageIds = computed(() => {
    return collectPersistedMessageIds(messages.value);
  });

  const persistedItems = computed<TaskConversationMessageItem[]>(() =>
    messages.value
      .map((entry, index) => normalizeMessage(entry, index, createEmptyLiveAssistantState()))
      .filter((entry): entry is TaskConversationMessageItem => entry != null)
      .filter((entry) => entry.role !== "system"),
  );

  const assistantMessageKeys = computed(() =>
    collectAssistantMessageKeys(persistedItems.value, displayLiveAssistantState.value),
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
  }

  function clearPendingAssistantDraft(targetSessionId?: string) {
    if (!pendingAssistantDraft.value) {
      return;
    }

    if (targetSessionId && pendingAssistantDraft.value.sessionId !== targetSessionId) {
      return;
    }

    pendingAssistantDraft.value = null;
  }

  const items = computed<TaskConversationMessageItem[]>(() =>
    buildTaskConversationDisplayMessages({
      persistedItems: persistedItems.value,
      liveAssistantState: displayLiveAssistantState.value,
      authority: displayConversationAuthority.value,
      pendingAssistantDraft: pendingAssistantDraft.value,
      activeSessionId: activeSessionId.value,
      latestTaskRefreshReason: latestTaskRefreshRequest.value?.reason,
      hideWorkflowExecutionContextUsers: workflowItems.value.length > 0,
    }),
  );

  const workflowItems = computed<TaskConversationWorkflowItem[]>(() =>
    messages.value
      .map((entry) => normalizeWorkflowGroup(entry))
      .filter((item): item is TaskConversationWorkflowItem => item != null),
  );

  const hasVisiblePendingAssistantDraft = computed(() => {
    const pending = pendingAssistantDraft.value;
    if (!pending) {
      return false;
    }

    return items.value.some((item) => item.key === pending.key);
  });

  const conversationItems = computed<TaskConversationListItem[]>(() => {
    const regularItems = items.value;

    if (workflowItems.value.length === 0) return regularItems;

    // Insert workflow groups after the last user message, before the first assistant reply
    const result: TaskConversationListItem[] = [];
    let workflowInserted = false;
    for (const item of regularItems) {
      if (!workflowInserted && item.role !== "user") {
        result.push(...workflowItems.value);
        workflowInserted = true;
      }
      result.push(item);
    }
    if (!workflowInserted) {
      result.push(...workflowItems.value);
    }
    return result;
  });

  const hasStreamingAssistant = computed(() =>
    conversationItems.value.some(
      (item) => item.role === "assistant" && "isStreaming" in item && item.isStreaming,
    ),
  );

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
      }
    },
  );

  watch(
    [
      activeSessionId,
      () => assistantMessageKeys.value.size,
      () => latestTaskRefreshRequest.value?.eventId,
    ],
    () => {
      if (!pendingAssistantDraft.value) {
        return;
      }

      if (
        pendingAssistantDraft.value.sessionId === activeSessionId.value &&
        !hasVisiblePendingAssistantDraft.value
      ) {
        pendingAssistantDraft.value = null;
      }
    },
  );

  watch(
    [taskId, sessionId],
    () => {
      void refresh();
    },
    { immediate: true },
  );

  return {
    conversationAuthority: displayConversationAuthority,
    trace,
    items,
    conversationItems,
    latestTaskRefreshRequest,
    hasStreamingAssistant,
    loading,
    error,
    realtimeConnected,
    clearPendingAssistantDraft,
    refresh,
    seedPendingAssistantDraft,
  };
}
