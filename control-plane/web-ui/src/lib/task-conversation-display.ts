import {
  createEmptyLiveAssistantState,
  type LiveAssistantState,
  type TaskConversationListItem,
  type TaskConversationMessageItem,
  type TaskConversationWorkflowItem,
} from "./message-normalize";

export type PendingAssistantDraftState = {
  key: string;
  sessionId: string;
  createdAt: string;
  knownAssistantKeys: Set<string>;
};

export type TaskConversationMessageRecordAuthority = "local" | "realtime" | "persisted";

export type TaskConversationMessageRenderStatus =
  | "draft"
  | "streaming"
  | "committing"
  | "persisted"
  | "failed";

export type TaskConversationMessageRecord = {
  key: string;
  kind: "message";
  authority: TaskConversationMessageRecordAuthority;
  renderStatus: TaskConversationMessageRenderStatus;
  item: TaskConversationMessageItem;
};

export type TaskConversationWorkflowRecord = {
  key: string;
  kind: "workflow";
  item: TaskConversationWorkflowItem;
};

export type TaskConversationRenderRecord =
  | TaskConversationMessageRecord
  | TaskConversationWorkflowRecord;

export type TaskConversationRenderState = {
  orderedIds: string[];
  recordsById: Record<string, TaskConversationRenderRecord>;
};

const WORKFLOW_EXECUTION_CONTEXT_PREFIXES = [
  "Execution context:",
  "## Execution context",
  "当前执行上下文",
  "## 当前执行上下文",
];

function countRawMessageParts(item: TaskConversationMessageItem) {
  const raw = item.raw && typeof item.raw === "object" ? (item.raw as Record<string, unknown>) : null;
  return Array.isArray(raw?.parts) ? raw.parts.filter((part) => Boolean(part)).length : 0;
}

function isWorkflowExecutionContextText(text?: string) {
  if (typeof text !== "string") {
    return false;
  }

  const normalized = text.trim();
  return WORKFLOW_EXECUTION_CONTEXT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isWorkflowExecutionContextUserMessage(item: TaskConversationMessageItem) {
  return item.role === "user" && isWorkflowExecutionContextText(item.text);
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

function createEmptyTaskConversationRenderState(): TaskConversationRenderState {
  return {
    orderedIds: [],
    recordsById: {},
  };
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

export function collectAssistantMessageKeysFromRenderState(
  state: TaskConversationRenderState,
) {
  const keys = new Set<string>();

  for (const recordId of state.orderedIds) {
    const record = state.recordsById[recordId];
    if (record?.kind === "message" && record.item.role === "assistant") {
      keys.add(record.key);
    }
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

function appendMessageRecord(
  state: TaskConversationRenderState,
  record: TaskConversationMessageRecord,
  options?: { hideWorkflowExecutionContextUsers?: boolean },
) {
  if (
    options?.hideWorkflowExecutionContextUsers &&
    isWorkflowExecutionContextUserMessage(record.item)
  ) {
    return;
  }

  const previousId = state.orderedIds[state.orderedIds.length - 1];
  const previousRecord = previousId ? state.recordsById[previousId] : undefined;
  if (
    previousRecord?.kind === "message" &&
    areEquivalentAssistantMessages(previousRecord.item, record.item)
  ) {
    if (resolveConversationMessageRichness(record.item) > resolveConversationMessageRichness(previousRecord.item)) {
      state.recordsById[previousId] = record;
    }
    return;
  }

  if (state.recordsById[record.key]) {
    state.recordsById[record.key] = record;
    return;
  }

  state.orderedIds.push(record.key);
  state.recordsById[record.key] = record;
}

function createPersistedMessageRecord(args: {
  originalItem: TaskConversationMessageItem;
  liveAssistantState: LiveAssistantState;
  authority: "persisted" | "realtime";
}) {
  const item = overlayPersistedConversationItem({
    item: args.originalItem,
    liveAssistantState: args.liveAssistantState,
    authority: args.authority,
  });
  const hasLiveState =
    args.authority === "realtime" &&
    args.originalItem.role === "assistant" &&
    (args.liveAssistantState.textById.has(args.originalItem.key) ||
      args.liveAssistantState.metaById.has(args.originalItem.key) ||
      args.liveAssistantState.incompleteIds.has(args.originalItem.key));

  let authority: TaskConversationMessageRecordAuthority = "persisted";
  let renderStatus: TaskConversationMessageRenderStatus =
    item.status === "failed" || Boolean(item.errorText) ? "failed" : "persisted";

  if (hasLiveState) {
    authority = "realtime";
    renderStatus = item.isStreaming ? "streaming" : "committing";
  }

  return {
    key: item.key,
    kind: "message",
    authority,
    renderStatus,
    item,
  } satisfies TaskConversationMessageRecord;
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

    if (isWorkflowExecutionContextText(text)) {
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
      kind: "message",
      authority: "realtime",
      renderStatus: isStreaming ? "streaming" : "committing",
      item: {
        key: messageId,
        role: "assistant",
        agent: meta?.agent,
        text: text || "正在生成...",
        toolCalls: [],
        createdAt: meta?.createdAt,
        raw: null,
        isStreaming,
      },
    } satisfies TaskConversationMessageRecord;
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
    kind: "message",
    authority: "local",
    renderStatus: "draft",
    item: {
      key: pending.key,
      role: "assistant",
      text: "正在生成...",
      toolCalls: [],
      createdAt: pending.createdAt,
      raw: null,
      isStreaming: true,
    },
  } satisfies TaskConversationMessageRecord;
}

function injectWorkflowRecords(
  state: TaskConversationRenderState,
  workflowItems: TaskConversationWorkflowItem[],
) {
  if (workflowItems.length === 0) {
    return state;
  }

  const workflowIds = workflowItems.map((item) => item.key);
  const recordsById = { ...state.recordsById };
  for (const item of workflowItems) {
    recordsById[item.key] = {
      key: item.key,
      kind: "workflow",
      item,
    } satisfies TaskConversationWorkflowRecord;
  }

  const insertIndex = state.orderedIds.findIndex((recordId) => {
    const record = state.recordsById[recordId];
    return record?.kind === "message" && record.item.role !== "user";
  });
  const orderedIds = [...state.orderedIds];
  orderedIds.splice(insertIndex >= 0 ? insertIndex : orderedIds.length, 0, ...workflowIds);

  return {
    orderedIds,
    recordsById,
  } satisfies TaskConversationRenderState;
}

export function buildTaskConversationRenderState(args: {
  persistedItems: TaskConversationMessageItem[];
  workflowItems?: TaskConversationWorkflowItem[];
  liveAssistantState: LiveAssistantState;
  authority: "persisted" | "realtime";
  pendingAssistantDraft: PendingAssistantDraftState | null;
  activeSessionId?: string;
  latestTaskRefreshReason?: string;
  hideWorkflowExecutionContextUsers?: boolean;
}) {
  const state = createEmptyTaskConversationRenderState();
  const overlaidPersistedItems = args.persistedItems.map((item) =>
    overlayPersistedConversationItem({
      item,
      liveAssistantState: args.liveAssistantState,
      authority: args.authority,
    }),
  );

  overlaidPersistedItems.forEach((item, index) => {
    appendMessageRecord(
      state,
      createPersistedMessageRecord({
        originalItem: args.persistedItems[index] ?? item,
        liveAssistantState: args.liveAssistantState,
        authority: args.authority,
      }),
      { hideWorkflowExecutionContextUsers: args.hideWorkflowExecutionContextUsers },
    );
  });

  const streamingAssistantDraft = buildStreamingAssistantDraft({
    persistedItems: overlaidPersistedItems,
    liveAssistantState: args.liveAssistantState,
    authority: args.authority,
  });
  if (streamingAssistantDraft) {
    appendMessageRecord(state, streamingAssistantDraft, {
      hideWorkflowExecutionContextUsers: args.hideWorkflowExecutionContextUsers,
    });
  }

  const optimisticPendingAssistantDraft = buildOptimisticPendingAssistantDraft({
    pendingAssistantDraft: args.pendingAssistantDraft,
    activeSessionId: args.activeSessionId,
    assistantMessageKeys: collectAssistantMessageKeysFromRenderState(state),
    latestTaskRefreshReason: args.latestTaskRefreshReason,
  });
  if (optimisticPendingAssistantDraft) {
    appendMessageRecord(state, optimisticPendingAssistantDraft, {
      hideWorkflowExecutionContextUsers: args.hideWorkflowExecutionContextUsers,
    });
  }

  return injectWorkflowRecords(state, args.workflowItems ?? []);
}

export function getTaskConversationRenderItems(state: TaskConversationRenderState) {
  return state.orderedIds
    .map((recordId) => state.recordsById[recordId]?.item)
    .filter((item): item is TaskConversationListItem => item != null);
}

export function getTaskConversationRenderMessageItems(state: TaskConversationRenderState) {
  return state.orderedIds
    .map((recordId) => state.recordsById[recordId])
    .filter(
      (record): record is TaskConversationMessageRecord =>
        Boolean(record) && record.kind === "message",
    )
    .map((record) => record.item);
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
  return getTaskConversationRenderMessageItems(
    buildTaskConversationRenderState({
      ...args,
      workflowItems: [],
    }),
  );
}

export function buildTaskConversationListItems(args: {
  regularItems: TaskConversationMessageItem[];
  workflowItems: TaskConversationWorkflowItem[];
}) {
  return getTaskConversationRenderItems(
    injectWorkflowRecords(
      collapseDisplayMessages(args.regularItems).reduce((state, item) => {
        appendMessageRecord(
          state,
          {
            key: item.key,
            kind: "message",
            authority: item.isStreaming ? "realtime" : "persisted",
            renderStatus: item.isStreaming ? "streaming" : "persisted",
            item,
          },
        );
        return state;
      }, createEmptyTaskConversationRenderState()),
      args.workflowItems,
    ),
  );
}