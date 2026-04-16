import type { TaskPhaseRecord } from "./api";
import {
  asRecord,
  normalizeSessionConversationItems,
  type TaskConversationListItem,
  type TaskConversationMessageItem,
  type TaskConversationParallelItem,
} from "./message-normalize";

export type TaskDetailPhaseSliceRecord = {
  phase: TaskPhaseRecord;
  liveSessionIds?: string[];
  sourceMessages: unknown[];
  resolvedSessionId?: string;
};

export type TaskDetailPhaseBlock = {
  key: string;
  phaseId: string;
  phaseIndex: number;
  phaseKind: TaskPhaseRecord["phaseKind"];
  triggerType: TaskPhaseRecord["triggerType"];
  status: TaskPhaseRecord["status"];
  createdAt?: string | null;
  items: TaskConversationListItem[];
};

function toItemTimestamp(item: TaskConversationListItem) {
  if (typeof item.createdAt !== "string" || item.createdAt.length === 0) {
    return null;
  }

  const timestamp = Date.parse(item.createdAt);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function resolveParallelPhaseItems(
  phaseId: string,
  parallelConversationItems: TaskConversationParallelItem[],
) {
  return parallelConversationItems.filter((item) => {
    const raw = asRecord(item.raw);
    return raw?.phaseId === phaseId;
  });
}

function isMessageConversationItem(
  item: TaskConversationListItem,
): item is TaskConversationMessageItem {
  return item.role !== "parallel" && item.role !== "workflow";
}

function isPhaseRealtimeConversationItem(item: TaskConversationMessageItem) {
  return item.role === "user" || item.role === "tool";
}

function resolveLivePhaseTargetId(args: {
  phaseSlices: TaskDetailPhaseSliceRecord[];
  currentPhaseId?: string | null;
}) {
  const explicitPhaseId =
    typeof args.currentPhaseId === "string" && args.currentPhaseId.length > 0
      ? args.currentPhaseId
      : null;
  if (explicitPhaseId && args.phaseSlices.some((slice) => slice.phase.id === explicitPhaseId)) {
    return explicitPhaseId;
  }

  return args.phaseSlices.at(-1)?.phase.id ?? null;
}

function resolvePhaseMessageItems(args: {
  slice: TaskDetailPhaseSliceRecord;
  phaseSlices: TaskDetailPhaseSliceRecord[];
  phaseConversationItemsByPhaseId?: Record<string, TaskConversationListItem[]>;
  phaseRealtimeMessagesByPhaseId?: Record<string, TaskConversationMessageItem[]>;
  baseConversationItems?: TaskConversationListItem[];
  currentPhaseRealtimeMessages?: TaskConversationMessageItem[];
  currentPhaseId?: string | null;
  globalPersistedKeys: Set<string>;
}) {
  const persistedItems = normalizeSessionConversationItems(args.slice.sourceMessages);
  const baseConversationItems = Array.isArray(args.baseConversationItems)
    ? args.baseConversationItems.filter(isMessageConversationItem)
    : [];

  const livePhaseTargetId = resolveLivePhaseTargetId({
    phaseSlices: args.phaseSlices,
    currentPhaseId: args.currentPhaseId,
  });
  const phaseConversationItems = Array.isArray(
    args.phaseConversationItemsByPhaseId?.[args.slice.phase.id],
  )
    ? args.phaseConversationItemsByPhaseId?.[args.slice.phase.id]?.filter(
        isMessageConversationItem,
      ) ?? []
    : livePhaseTargetId && args.slice.phase.id === livePhaseTargetId
      ? baseConversationItems
      : [];
  const phaseRealtimeMessages =
    args.phaseRealtimeMessagesByPhaseId?.[args.slice.phase.id] ??
    (livePhaseTargetId && args.slice.phase.id === livePhaseTargetId
      ? args.currentPhaseRealtimeMessages ?? []
      : []);
  const overlayItems = [...phaseConversationItems, ...phaseRealtimeMessages];
  const overlayItemMap = new Map(overlayItems.map((item) => [item.key, item]));
  const nextItems = persistedItems.map((item) => overlayItemMap.get(item.key) ?? item);

  if (phaseConversationItems.length === 0 && phaseRealtimeMessages.length === 0) {
    return nextItems;
  }

  const extraLiveItems = [
    ...phaseConversationItems.filter(
      (item) => item.role === "assistant" && !args.globalPersistedKeys.has(item.key),
    ),
    ...phaseRealtimeMessages.filter((item) => !args.globalPersistedKeys.has(item.key)),
  ];
  if (extraLiveItems.length === 0) {
    return nextItems;
  }

  const seenKeys = new Set(nextItems.map((item) => item.key));
  return [
    ...nextItems,
    ...extraLiveItems.filter((item) => {
      if (seenKeys.has(item.key)) {
        return false;
      }
      seenKeys.add(item.key);
      return true;
    }),
  ];
}

export function buildTaskDetailPhaseBlocks(args: {
  phaseSlices: TaskDetailPhaseSliceRecord[];
  parallelConversationItems: TaskConversationParallelItem[];
  phaseConversationItemsByPhaseId?: Record<string, TaskConversationListItem[]>;
  phaseRealtimeSourceMessagesByPhaseId?: Record<string, unknown[]>;
  baseConversationItems?: TaskConversationListItem[];
  currentPhaseRealtimeSourceMessages?: unknown[];
  currentPhaseId?: string | null;
}) {
  const globalPersistedKeys = new Set(
    args.phaseSlices.flatMap((slice) =>
      normalizeSessionConversationItems(slice.sourceMessages).map((item) => item.key),
    ),
  );
  const currentPhaseRealtimeMessages = normalizeSessionConversationItems(
    args.currentPhaseRealtimeSourceMessages ?? [],
  ).filter(isPhaseRealtimeConversationItem);
  const phaseRealtimeMessagesByPhaseId = Object.fromEntries(
    Object.entries(args.phaseRealtimeSourceMessagesByPhaseId ?? {}).map(([phaseId, messages]) => [
      phaseId,
      normalizeSessionConversationItems(Array.isArray(messages) ? messages : []).filter(
        isPhaseRealtimeConversationItem,
      ),
    ]),
  ) as Record<string, TaskConversationMessageItem[]>;

  return args.phaseSlices
    .slice()
    .sort((left, right) => left.phase.phaseIndex - right.phase.phaseIndex)
    .map((slice) => {
      const messageItems = resolvePhaseMessageItems({
        slice,
        phaseSlices: args.phaseSlices,
        phaseConversationItemsByPhaseId: args.phaseConversationItemsByPhaseId,
        phaseRealtimeMessagesByPhaseId,
        baseConversationItems: args.baseConversationItems,
        currentPhaseRealtimeMessages,
        currentPhaseId: args.currentPhaseId,
        globalPersistedKeys,
      });
      const parallelItems =
        slice.phase.phaseKind === "parallel"
          ? resolveParallelPhaseItems(slice.phase.id, args.parallelConversationItems)
          : [];
      const items = [...messageItems, ...parallelItems]
        .map((item, index) => ({ item, index, timestamp: toItemTimestamp(item) }))
        .sort((left, right) => {
          if (left.timestamp === null && right.timestamp === null) {
            return left.index - right.index;
          }
          if (left.timestamp === null) {
            return 1;
          }
          if (right.timestamp === null) {
            return -1;
          }
          if (left.timestamp !== right.timestamp) {
            return left.timestamp - right.timestamp;
          }
          return left.index - right.index;
        })
        .map((entry) => entry.item);

      return {
        key: `phase-block:${slice.phase.id}`,
        phaseId: slice.phase.id,
        phaseIndex: slice.phase.phaseIndex,
        phaseKind: slice.phase.phaseKind,
        triggerType: slice.phase.triggerType,
        status: slice.phase.status,
        createdAt: slice.phase.startedAt ?? slice.phase.createdAt ?? null,
        items,
      } satisfies TaskDetailPhaseBlock;
    })
    .filter((block) => block.items.length > 0 || block.phaseKind === "parallel");
}