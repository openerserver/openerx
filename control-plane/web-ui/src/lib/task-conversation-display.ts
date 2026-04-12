import {
  createEmptyLiveAssistantState,
  type LiveAssistantState,
  type TaskConversationMessageItem,
} from "./message-normalize";

export type PendingAssistantDraftState = {
  key: string;
  sessionId: string;
  createdAt: string;
  knownAssistantKeys: Set<string>;
};

function countRawMessageParts(item: TaskConversationMessageItem) {
  const raw = item.raw && typeof item.raw === "object" ? (item.raw as Record<string, unknown>) : null;
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

function shouldSuppressCompletedStreamingAssistantDraft(args: {
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

export function collectAssistantMessageKeys(
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

function overlayPersistedConversationItem(args: {
  item: TaskConversationMessageItem;
  liveAssistantState: LiveAssistantState;
  authority: "persisted" | "realtime";
}) {
  const { item, liveAssistantState, authority } = args;
  if (authority !== "realtime" || item.role !== "assistant") {
    return item;
  }

  const liveText = liveAssistantState.textById.get(item.key);
  const nextText =
    liveText && liveText.length > (item.text?.length ?? 0) ? liveText : item.text;
  const liveMeta = liveAssistantState.metaById.get(item.key);
  const nextIsStreaming = liveAssistantState.incompleteIds.has(item.key);

  if (
    nextText === item.text &&
    nextIsStreaming === Boolean(item.isStreaming) &&
    (!liveMeta?.agent || liveMeta.agent === item.agent) &&
    (!liveMeta?.createdAt || liveMeta.createdAt === item.createdAt)
  ) {
    return item;
  }

  return {
    ...item,
    agent: item.agent ?? liveMeta?.agent,
    text: nextText,
    createdAt: item.createdAt ?? liveMeta?.createdAt,
    isStreaming: nextIsStreaming,
  } satisfies TaskConversationMessageItem;
}

function buildStreamingAssistantDraft(args: {
  persistedItems: TaskConversationMessageItem[];
  liveAssistantState: LiveAssistantState;
  authority: "persisted" | "realtime";
}) {
  if (args.authority !== "realtime") {
    return null;
  }

  const persistedMessageIds = new Set(args.persistedItems.map((item) => item.key));

  for (let i = args.liveAssistantState.orderedAssistantMessageIds.length - 1; i >= 0; i -= 1) {
    const messageId = args.liveAssistantState.orderedAssistantMessageIds[i];
    if (persistedMessageIds.has(messageId)) {
      continue;
    }

    const meta = args.liveAssistantState.metaById.get(messageId);
    const text = args.liveAssistantState.textById.get(messageId)?.trim();
    if (!meta && !text) {
      continue;
    }

    const isStreaming = args.liveAssistantState.incompleteIds.has(messageId);
    if (
      shouldSuppressCompletedStreamingAssistantDraft({
        persistedItems: args.persistedItems,
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
    } satisfies TaskConversationMessageItem;
  }

  return null;
}

function buildOptimisticPendingAssistantDraft(args: {
  pendingAssistantDraft: PendingAssistantDraftState | null;
  activeSessionId?: string;
  assistantMessageKeys: Set<string>;
  latestTaskRefreshReason?: string;
}) {
  const pending = args.pendingAssistantDraft;
  if (!pending || pending.sessionId !== args.activeSessionId) {
    return null;
  }

  for (const messageKey of args.assistantMessageKeys) {
    if (!pending.knownAssistantKeys.has(messageKey)) {
      return null;
    }
  }

  if (
    args.latestTaskRefreshReason === "task-completed" ||
    args.latestTaskRefreshReason === "task-failed"
  ) {
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
  } satisfies TaskConversationMessageItem;
}

export function buildTaskConversationDisplayMessages(args: {
  persistedItems: TaskConversationMessageItem[];
  liveAssistantState: LiveAssistantState;
  authority: "persisted" | "realtime";
  pendingAssistantDraft: PendingAssistantDraftState | null;
  activeSessionId?: string;
  latestTaskRefreshReason?: string;
  hideWorkflowExecutionContextUsers?: boolean;
}) {
  const overlaidPersistedItems = args.persistedItems.map((item) =>
    overlayPersistedConversationItem({
      item,
      liveAssistantState: args.liveAssistantState,
      authority: args.authority,
    }),
  );

  const assistantMessageKeys = collectAssistantMessageKeys(
    args.persistedItems,
    args.liveAssistantState,
  );
  const streamingAssistantDraft = buildStreamingAssistantDraft({
    persistedItems: overlaidPersistedItems,
    liveAssistantState: args.liveAssistantState,
    authority: args.authority,
  });
  const optimisticPendingAssistantDraft = buildOptimisticPendingAssistantDraft({
    pendingAssistantDraft: args.pendingAssistantDraft,
    activeSessionId: args.activeSessionId,
    assistantMessageKeys,
    latestTaskRefreshReason: args.latestTaskRefreshReason,
  });

  return collapseDisplayMessages(
    [
      ...overlaidPersistedItems,
      ...(streamingAssistantDraft ? [streamingAssistantDraft] : []),
      ...(optimisticPendingAssistantDraft ? [optimisticPendingAssistantDraft] : []),
    ].filter((item) => item.role === "user" || item.role === "assistant" || item.role === "tool"),
    {
      hideWorkflowExecutionContextUsers: args.hideWorkflowExecutionContextUsers,
    },
  );
}