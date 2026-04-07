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
  collectLiveAssistantState,
  createEmptyLiveAssistantState,
  normalizeMessage,
  normalizeWorkflowGroup,
} from "../lib/message-normalize";
import { useRealtimeStore } from "../stores/realtime";

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

    const previous = collapsed.at(-1);
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

export function useTreeMessages(
  taskId: Ref<string>,
  sessionId: Ref<string | undefined>,
  options?: { includeLineage?: boolean },
) {
  const realtimeStore = useRealtimeStore();
  const trace = ref<TaskExecutionTrace | null>(null);
  const messages = ref<unknown[]>([]);
  const resolvedSessionId = ref<string | undefined>(undefined);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function refresh(silent = false) {
    if (!taskId.value) {
      trace.value = null;
      messages.value = [];
      resolvedSessionId.value = undefined;
      error.value = null;
      return;
    }

    if (!silent) loading.value = true;
    error.value = null;

    try {
      const response = await getTaskMessages(taskId.value, {
        sessionId: sessionId.value,
        includeLineage: options?.includeLineage,
      });
      messages.value = Array.isArray(response.data) ? response.data : [];
      resolvedSessionId.value = sessionId.value;
      trace.value = {
        taskId: taskId.value,
        sessionId: sessionId.value ?? response.meta?.sessionId ?? null,
        segments: [],
        messages: [],
        timeline: [],
        timelineMeta: response.meta,
        hookExecutions: [],
        followupExecutions: [],
      } satisfies TaskExecutionTrace;
    } catch (nextError) {
      trace.value = null;
      messages.value = [];
      resolvedSessionId.value = undefined;
      error.value = nextError instanceof Error ? nextError.message : "加载消息失败";
    } finally {
      if (!silent) loading.value = false;
    }
  }

  const taskEvents = computed(() =>
    realtimeStore.events.filter((event) => event.taskId === taskId.value),
  );

  const persistedMessageIds = computed(() => {
    const ids = new Set<string>();
    for (const message of messages.value
      .map((entry, index) => normalizeMessage(entry, index, createEmptyLiveAssistantState()))
      .filter((entry): entry is TaskConversationMessageItem => entry != null)) {
      const id = message.key;
      if (id) ids.add(id);
    }
    return ids;
  });

  const liveAssistantState = computed(() => {
    const activeSessionId = resolvedSessionId.value ?? sessionId.value;
    if (!activeSessionId) return createEmptyLiveAssistantState();
    return collectLiveAssistantState(taskEvents.value, activeSessionId);
  });

  const items = computed<TaskConversationMessageItem[]>(() =>
    messages.value
      .map((entry, index) => normalizeMessage(entry, index, liveAssistantState.value))
      .filter((entry): entry is TaskConversationMessageItem => entry != null)
      .filter((entry) => entry.role !== "system"),
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

  const conversationItems = computed<TaskConversationListItem[]>(() => {
    // Extract workflow group items from raw messages
    const workflowItems: TaskConversationWorkflowItem[] = messages.value
      .map((entry) => normalizeWorkflowGroup(entry))
      .filter((item): item is TaskConversationWorkflowItem => item != null);

    const regularItems = collapseDisplayMessages(
      [
        ...items.value,
        ...(streamingAssistantDraft.value ? [streamingAssistantDraft.value] : []),
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
    hasStreamingAssistant,
    loading,
    error,
    refresh,
  };
}
