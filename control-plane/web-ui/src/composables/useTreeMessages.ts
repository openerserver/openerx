/**
 * useTreeMessages — tree-native message composable for TaskDetailV3.
 *
 * Imports shared normalization from lib/message-normalize so that persisted
 * messages get the live-state text overlay during streaming (same as V2).
 */
import { computed, ref, watch, type Ref } from "vue";
import { getTaskConversationMessages } from "../lib/api";
import { useRealtimeStore } from "../stores/realtime";
import {
  type TaskConversationListItem,
  type TaskConversationMessageItem,
  asRecord,
  asString,
  messageInfo,
  normalizeMessage,
  collectLiveAssistantState,
  createEmptyLiveAssistantState,
} from "../lib/message-normalize";

export type { TaskConversationListItem, TaskConversationMessageItem };
export type {
  TaskConversationToolCallItem,
  TaskConversationParallelItem,
} from "../lib/message-normalize";

/* ------------------------------------------------------------------ */
/*  Primary composable                                                 */
/* ------------------------------------------------------------------ */

export function useTreeMessages(
  taskId: Ref<string>,
  sessionId: Ref<string | undefined>,
  options?: { includeLineage?: boolean },
) {
  const realtimeStore = useRealtimeStore();
  const rawMessages = ref<unknown[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function refresh(silent = false) {
    if (!taskId.value || !sessionId.value) {
      rawMessages.value = [];
      error.value = null;
      return;
    }

    if (!silent) loading.value = true;
    error.value = null;

    try {
      const response = options?.includeLineage === true
        ? await getTaskConversationMessages(taskId.value, sessionId.value, { includeLineage: true })
        : await getTaskConversationMessages(taskId.value, sessionId.value);
      rawMessages.value = Array.isArray(response.data) ? response.data : [];
    } catch (nextError) {
      rawMessages.value = [];
      error.value = nextError instanceof Error ? nextError.message : "加载消息失败";
    } finally {
      if (!silent) loading.value = false;
    }
  }

  const taskEvents = computed(() => realtimeStore.events.filter((event) => event.taskId === taskId.value));

  const persistedMessageIds = computed(() => {
    const ids = new Set<string>();
    for (const message of rawMessages.value) {
      const id = asString(messageInfo(message)?.id) ?? asString(asRecord(message)?.id);
      if (id) ids.add(id);
    }
    return ids;
  });

  const liveAssistantState = computed(() => {
    if (!sessionId.value) return createEmptyLiveAssistantState();
    return collectLiveAssistantState(taskEvents.value, sessionId.value);
  });

  const items = computed(() =>
    rawMessages.value
      .map((message, index) => normalizeMessage(message, index, liveAssistantState.value))
      .filter((item): item is TaskConversationMessageItem => item != null)
      .filter((item) => item.role !== "system"),
  );

  const streamingAssistantDraft = computed<TaskConversationMessageItem | null>(() => {
    for (let i = liveAssistantState.value.orderedAssistantMessageIds.length - 1; i >= 0; i--) {
      const messageId = liveAssistantState.value.orderedAssistantMessageIds[i];
      if (persistedMessageIds.value.has(messageId)) continue;

      const meta = liveAssistantState.value.metaById.get(messageId);
      const text = liveAssistantState.value.textById.get(messageId)?.trim();
      if (!meta && !text) continue;

      return {
        key: messageId,
        role: "assistant",
        agent: meta?.agent,
        text: text || "正在生成...",
        toolCalls: [],
        createdAt: meta?.createdAt,
        raw: null,
        isStreaming: liveAssistantState.value.incompleteIds.has(messageId),
      };
    }
    return null;
  });

  const conversationItems = computed<TaskConversationListItem[]>(() =>
    [...items.value, ...(streamingAssistantDraft.value ? [streamingAssistantDraft.value] : [])].filter(
      (item) => item.role === "user" || item.role === "assistant" || item.role === "tool",
    ),
  );

  const hasStreamingAssistant = computed(() =>
    conversationItems.value.some((item) => item.role === "assistant" && "isStreaming" in item && item.isStreaming),
  );

  watch([taskId, sessionId], () => {
    void refresh();
  }, { immediate: true });

  return {
    rawMessages,
    items,
    conversationItems,
    hasStreamingAssistant,
    loading,
    error,
    refresh,
  };
}
