/**
 * useTreeMessages — tree-native message composable for TaskDetailV3.
 *
 * Uses task-level conversation messages as the primary read source while preserving
 * live realtime overlays for in-flight assistant output.
 */
import { type Ref, computed, ref, watch } from "vue";
import { type TaskExecutionTrace, getTaskMessages } from "../lib/api";
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

function countRawMessageParts(item: TaskConversationMessageItem) {
  const raw = asRecord(item.raw);
  return Array.isArray(raw?.parts) ? raw.parts.filter((part) => Boolean(part)).length : 0;
}

function isWorkflowExecutionContextUserMessage(item: TaskConversationMessageItem) {
  return item.role === "user" && typeof item.text === "string" && item.text.trim().startsWith("Execution context:");
}

function areEquivalentAssistantMessages(
  left: TaskConversationMessageItem | undefined,
  right: TaskConversationMessageItem,
) {
  if (!left || left.role !== "assistant" || right.role !== "assistant") {
    return false;
  }

  if (left.isStreaming || right.isStreaming) {
    return false;
  }

  const leftText = left.text?.trim();
  const rightText = right.text?.trim();
  if (!leftText || !rightText || leftText !== rightText) {
    return false;
  }

  return !left.createdAt || !right.createdAt || left.createdAt === right.createdAt;
}

function resolveConversationMessageRichness(item: TaskConversationMessageItem) {
  return (
    countRawMessageParts(item) * 1000 +
    item.toolCalls.length * 100 +
    (item.model ? 10 : 0) +
    (item.agent ? 5 : 0) +
    (item.text?.length ?? 0)
  );
}

function collapseDisplayMessages(
  items: TaskConversationMessageItem[],
  options?: { hideWorkflowExecutionContextUsers?: boolean },
) {
  const collapsed: TaskConversationMessageItem[] = [];

  for (const item of items) {
    if (options?.hideWorkflowExecutionContextUsers && isWorkflowExecutionContextUserMessage(item)) {
      continue;
    }

    const previous = collapsed[collapsed.length - 1];
    if (areEquivalentAssistantMessages(previous, item)) {
      if (previous && resolveConversationMessageRichness(item) > resolveConversationMessageRichness(previous)) {
        collapsed[collapsed.length - 1] = item;
      }
      continue;
    }

    collapsed.push(item);
  }

  return collapsed;
}

function parseTimestampMs(value?: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeComparableAssistantText(text?: string) {
  return typeof text === "string" ? text.replace(/\s+/gu, " ").trim() : "";
}

type PendingAssistantDraft = {
  key: string;
  sessionId: string;
  createdAt: string;
  knownAssistantKeys: Set<string>;
};

function collectAssistantMessageKeys(
  persistedItems: TaskConversationMessageItem[],
  liveState = createEmptyLiveAssistantState(),
) {
  const keys = new Set<string>();

  for (const item of persistedItems) {
    if (item.role === "assistant") {
      keys.add(item.key);
    }
  }

  for (const messageId of liveState.orderedAssistantMessageIds) {
    keys.add(messageId);
  }

  return keys;
}

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

export function shouldSuppressCompletedStreamingAssistantDraft(args: {
  persistedItems: TaskConversationMessageItem[];
  draftText?: string;
  draftCreatedAt?: string;
  isStreaming: boolean;
}) {
  if (args.isStreaming) {
    return false;
  }

  const draftCreatedAtMs = parseTimestampMs(args.draftCreatedAt);
  const normalizedDraftText = normalizeComparableAssistantText(args.draftText);

  return args.persistedItems.some((item) => {
    if (item.role !== "assistant" || item.isStreaming) {
      return false;
    }

    const normalizedPersistedText = normalizeComparableAssistantText(item.text);
    if (!normalizedPersistedText) {
      return false;
    }

    const persistedCreatedAtMs = parseTimestampMs(item.createdAt);
    if (draftCreatedAtMs != null && persistedCreatedAtMs != null) {
      return persistedCreatedAtMs >= draftCreatedAtMs;
    }

    return Boolean(normalizedDraftText) && normalizedPersistedText === normalizedDraftText;
  });
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
    latestTaskRefreshRequest,
    liveAssistantState,
    realtimeConnected,
  } = useTaskMessageStore(taskId, activeSessionId);

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
      const response = await getTaskMessages(currentTaskId, {
        sessionId: requestedSessionId,
        includeLineage: options?.includeLineage,
      });
      if (currentRefreshGeneration !== refreshGeneration) {
        return;
      }

      messages.value = Array.isArray(response.data) ? response.data : [];
      resolvedSessionId.value = response.meta?.sessionId ?? requestedSessionId;
      trace.value = {
        taskId: currentTaskId,
        sessionId: response.meta?.sessionId ?? requestedSessionId ?? null,
        segments: [],
        messages: [],
        timeline: [],
        timelineMeta: response.meta,
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

  const items = computed<TaskConversationMessageItem[]>(() =>
    messages.value
      .map((entry, index) => normalizeMessage(entry, index, liveAssistantState.value))
      .filter((entry): entry is TaskConversationMessageItem => entry != null)
      .filter((entry) => entry.role !== "system"),
  );

  const assistantMessageKeys = computed(() =>
    collectAssistantMessageKeys(items.value, liveAssistantState.value),
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

  const streamingAssistantDraft = computed<TaskConversationMessageItem | null>(() => {
    for (let i = liveAssistantState.value.orderedAssistantMessageIds.length - 1; i >= 0; i--) {
      const messageId = liveAssistantState.value.orderedAssistantMessageIds[i];
      if (persistedMessageIds.value.has(messageId)) continue;

      const meta = liveAssistantState.value.metaById.get(messageId);
      const text = liveAssistantState.value.textById.get(messageId)?.trim();
      if (!meta && !text) continue;

      const isStreaming = liveAssistantState.value.incompleteIds.has(messageId);
      if (
        shouldSuppressCompletedStreamingAssistantDraft({
          persistedItems: items.value,
          draftText: text,
          draftCreatedAt: meta?.createdAt,
          isStreaming,
        })
      ) {
        continue;
      }

      return {
        key: messageId,
        role: "assistant",
        agent: meta?.agent,
        text: text || "正在生成...",
        toolCalls: [],
        createdAt: meta?.createdAt,
        raw: null,
        isStreaming,
      };
    }
    return null;
  });

  const optimisticPendingAssistantDraft = computed<TaskConversationMessageItem | null>(() => {
    const pending = pendingAssistantDraft.value;
    if (!pending || pending.sessionId !== activeSessionId.value) {
      return null;
    }

    for (const messageKey of assistantMessageKeys.value) {
      if (!pending.knownAssistantKeys.has(messageKey)) {
        return null;
      }
    }

    const refreshReason = latestTaskRefreshRequest.value?.reason;
    if (refreshReason === "task-completed" || refreshReason === "task-failed") {
      return null;
    }

    return {
      key: pending.key,
      role: "assistant",
      text: "正在生成...",
      toolCalls: [],
      createdAt: pending.createdAt,
      raw: null,
      isStreaming: true,
    };
  });

  const conversationItems = computed<TaskConversationListItem[]>(() => {
    // Extract workflow group items from raw messages
    const workflowItems: TaskConversationWorkflowItem[] = messages.value
      .map((entry) => normalizeWorkflowGroup(entry))
      .filter((item): item is TaskConversationWorkflowItem => item != null);

    const regularItems = collapseDisplayMessages(
      [
        ...items.value,
        ...(streamingAssistantDraft.value ? [streamingAssistantDraft.value] : []),
        ...(optimisticPendingAssistantDraft.value ? [optimisticPendingAssistantDraft.value] : []),
      ].filter((item) => item.role === "user" || item.role === "assistant" || item.role === "tool"),
      {
        hideWorkflowExecutionContextUsers: workflowItems.length > 0,
      },
    );

    if (workflowItems.length === 0) return regularItems;

    // Insert workflow groups after the last user message, before the first assistant reply
    const result: TaskConversationListItem[] = [];
    let workflowInserted = false;
    for (const item of regularItems) {
      if (!workflowInserted && item.role !== "user") {
        result.push(...workflowItems);
        workflowInserted = true;
      }
      result.push(item);
    }
    if (!workflowInserted) {
      result.push(...workflowItems);
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
        !optimisticPendingAssistantDraft.value
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
