import type { TaskPhaseRecord } from "./api";
import {
  asRecord,
  asString,
  normalizeSessionConversationItems,
  type TaskConversationListItem,
  type TaskConversationMessageItem,
  type TaskConversationParallelItem,
  type TaskConversationWorkflowItem,
} from "./message-normalize";
import {
  buildAdoptedParallelReplyItems,
  suppressTopLevelParallelCandidateMessages,
} from "./task-detail-parallel-conversation-projector";

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

function suppressParallelPhaseCandidateMessages(
  items: TaskConversationMessageItem[],
  parallelItems: TaskConversationParallelItem[],
) {
  let nextItems = items as TaskConversationListItem[];

  for (const parallelItem of parallelItems) {
    nextItems = suppressTopLevelParallelCandidateMessages(nextItems, parallelItem);
  }

  return nextItems.filter(isMessageConversationItem);
}

function hasEquivalentAssistantMessage(
  items: TaskConversationMessageItem[],
  candidate: TaskConversationMessageItem,
) {
  return items.some((item) => {
    if (item.role !== "assistant") {
      return false;
    }

    return item.createdAt === candidate.createdAt && item.text === candidate.text;
  });
}

function isMessageConversationItem(
  item: TaskConversationListItem,
): item is TaskConversationMessageItem {
  return item.role !== "parallel" && item.role !== "workflow";
}

function isWorkflowConversationItem(
  item: TaskConversationListItem,
): item is TaskConversationWorkflowItem {
  return item.role === "workflow";
}

function sortConversationItemsByTimestamp<T extends TaskConversationListItem>(items: T[]) {
  return items
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
}

function extractPhaseSourceMessageText(message: unknown) {
  const record = asRecord(message);
  if (!record) {
    return undefined;
  }

  const directText =
    asString(record.textContent) ??
    asString(record.contentText) ??
    asString(record.summaryText) ??
    asString(record.text) ??
    asString(record.content);
  if (directText) {
    return directText;
  }

  const text = (Array.isArray(record.parts) ? record.parts : [])
    .map((part) => asRecord(part))
    .filter((part): part is Record<string, unknown> => Boolean(part))
    .filter((part) => {
      const partType = asString(part.type) ?? asString(part.partType) ?? "text";
      return partType === "text";
    })
    .map(
      (part) =>
        asString(part.text) ??
        asString(part.textContent) ??
        asString(part.contentText) ??
        asString(part.content),
    )
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .trim();

  return text || undefined;
}

function buildPhaseWorkflowContextDisplayText(text: string | undefined) {
  const normalized = typeof text === "string" ? text.replace(/\r\n?/gu, "\n").trim() : "";
  if (!normalized) {
    return undefined;
  }

  const withoutPrefix = normalized.replace(/^Execution context:\s*/u, "").trim();
  if (!withoutPrefix) {
    return undefined;
  }

  const withoutOriginalTask = withoutPrefix.replace(/\n*Original task:\s*[\s\S]*$/u, "").trim();
  const instructionLines = new Set([
    "请只完成当前阶段的目标。",
    "完成后请输出本阶段产出摘要。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]。",
    "如果你认为当前阶段已经完成，请在输出末尾单独追加 [STAGE_COMPLETE]",
  ]);
  const cleanedLines = withoutOriginalTask
    .split("\n")
    .filter((line) => !instructionLines.has(line.trim()));
  const cleaned = cleanedLines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
  return cleaned || withoutOriginalTask || withoutPrefix;
}

function extractPhaseWorkflowStageLabel(text: string | undefined) {
  if (!text) {
    return undefined;
  }

  const stageMatch = /当前阶段：([^\n]+)/u.exec(text);
  return stageMatch?.[1]?.trim() || undefined;
}

function buildWorkflowItemFromPhaseSourceMessage(message: unknown): TaskConversationWorkflowItem | null {
  const record = asRecord(message);
  if (!record) {
    return null;
  }

  const info = asRecord(record.info);
  const role = asString(info?.role) ?? asString(record.role);
  if (role !== "user") {
    return null;
  }

  const fullText = extractPhaseSourceMessageText(message);
  if (!fullText?.startsWith("Execution context:")) {
    return null;
  }

  const displayText = buildPhaseWorkflowContextDisplayText(fullText);
  if (!displayText) {
    return null;
  }

  const sourceId = asString(info?.id) ?? asString(record.id) ?? "workflow-context";
  const createdAt =
    asString(asRecord(info?.time)?.created) ??
    asString(asRecord(info?.time)?.completed) ??
    asString(record.createdAt);
  const sessionId =
    asString(record.sessionId) ??
    asString(info?.sessionID) ??
    asString(info?.sessionId) ??
    `${sourceId}:workflow`;

  return {
    key: `${sourceId}:workflow-group`,
    role: "workflow",
    createdAt,
    variant: "context",
    label: "工作流消息",
    hint: "当前阶段与执行上下文",
    steps: [
      {
        agentName: extractPhaseWorkflowStageLabel(fullText) ?? "当前工作流",
        sessionId,
        items: [
          {
            key: `${sourceId}:workflow-message`,
            role: "workflow",
            text: displayText,
            toolCalls: [],
            createdAt,
            raw: message,
          },
        ],
      },
    ],
    raw: message,
    toolCalls: [],
  } satisfies TaskConversationWorkflowItem;
}

function resolvePersistedPhaseWorkflowItems(sourceMessages: unknown[]) {
  const seenKeys = new Set<string>();

  return sourceMessages
    .map((message) => buildWorkflowItemFromPhaseSourceMessage(message))
    .filter((item): item is TaskConversationWorkflowItem => Boolean(item))
    .filter((item) => {
      if (seenKeys.has(item.key)) {
        return false;
      }
      seenKeys.add(item.key);
      return true;
    });
}

function isPhaseRealtimeConversationItem(item: TaskConversationMessageItem) {
  return item.role === "user" || item.role === "tool";
}

function resolveConversationMessageId(item: TaskConversationMessageItem) {
  const raw = asRecord(item.raw);
  const info = asRecord(raw?.info);
  return asString(info?.id) ?? asString(raw?.id) ?? item.key;
}

function findParallelAnchorUserMessage(
  parallelItem: TaskConversationParallelItem,
  baseConversationItems: TaskConversationMessageItem[],
) {
  const rawRun = asRecord(parallelItem.raw);
  const rawAnchorUser = rawRun?.anchorUserMessage;
  if (asRecord(rawAnchorUser) && asString(asRecord(rawAnchorUser)?.role) === "user") {
    return rawAnchorUser as TaskConversationMessageItem;
  }

  const anchorMessageId = asString(rawRun?.anchorMessageId);

  if (anchorMessageId) {
    const anchorUser = baseConversationItems.find(
      (item) => item.role === "user" && resolveConversationMessageId(item) === anchorMessageId,
    );
    if (anchorUser) {
      return anchorUser;
    }
  }

  const parallelCreatedAt = toItemTimestamp(parallelItem);
  for (let index = baseConversationItems.length - 1; index >= 0; index -= 1) {
    const item = baseConversationItems[index];
    if (item?.role !== "user") {
      continue;
    }

    const itemCreatedAt = toItemTimestamp(item);
    if (parallelCreatedAt === null || itemCreatedAt === null || itemCreatedAt <= parallelCreatedAt) {
      return item;
    }
  }

  return null;
}

function resolveParallelPhaseUserMessages(args: {
  visibleMessageItems: TaskConversationMessageItem[];
  parallelItems: TaskConversationParallelItem[];
  baseConversationItems?: TaskConversationListItem[];
  previousVisibleMessageItems?: TaskConversationMessageItem[];
}) {
  const visibleUserItems = args.visibleMessageItems.filter((item) => item.role === "user");
  const baseMessageItems = Array.isArray(args.baseConversationItems)
    ? args.baseConversationItems.filter(isMessageConversationItem)
    : [];

  const seenKeys = new Set(visibleUserItems.map((item) => item.key));
  const anchorUserItems: TaskConversationMessageItem[] = [];

  for (const parallelItem of args.parallelItems) {
    const anchorUser = findParallelAnchorUserMessage(parallelItem, baseMessageItems);
    if (!anchorUser || seenKeys.has(anchorUser.key)) {
      continue;
    }
    seenKeys.add(anchorUser.key);
    anchorUserItems.push(anchorUser);
  }

  const resolvedUserItems = collapseEquivalentUserMessages(
    sortConversationItemsByTimestamp([...visibleUserItems, ...anchorUserItems]),
  );

  if (resolvedUserItems.length > 0) {
    return resolvedUserItems;
  }

  const fallbackUserItems = collapseEquivalentUserMessages(
    sortConversationItemsByTimestamp(
      (args.previousVisibleMessageItems ?? []).filter((item) => item.role === "user"),
    ),
  );

  return fallbackUserItems.length > 0 ? [fallbackUserItems[fallbackUserItems.length - 1] as TaskConversationMessageItem] : [];
}

function normalizeComparableUserMessageText(item: TaskConversationMessageItem) {
  const text = item.userInputText ?? item.finalSentText ?? item.text;
  return typeof text === "string" ? text.replace(/\s+/gu, " ").trim() : "";
}

function collapseEquivalentUserMessages(items: TaskConversationMessageItem[]) {
  const seenUserSignatures = new Set<string>();

  return items.filter((item) => {
    if (item.role !== "user" || !item.createdAt) {
      return true;
    }

    const comparableText = normalizeComparableUserMessageText(item);
    if (!comparableText) {
      return true;
    }

    const signature = `${item.createdAt}::${comparableText}`;
    if (seenUserSignatures.has(signature)) {
      return false;
    }

    seenUserSignatures.add(signature);
    return true;
  });
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

  return args.phaseSlices.length > 0 ? args.phaseSlices[args.phaseSlices.length - 1]?.phase.id ?? null : null;
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
    return collapseEquivalentUserMessages(nextItems);
  }

  const seenKeys = new Set(nextItems.map((item) => item.key));
  return collapseEquivalentUserMessages([
    ...nextItems,
    ...extraLiveItems.filter((item) => {
      if (seenKeys.has(item.key)) {
        return false;
      }
      seenKeys.add(item.key);
      return true;
    }),
  ]);
}

function resolvePhaseWorkflowItems(args: {
  slice: TaskDetailPhaseSliceRecord;
  phaseSlices: TaskDetailPhaseSliceRecord[];
  phaseConversationItemsByPhaseId?: Record<string, TaskConversationListItem[]>;
  baseConversationItems?: TaskConversationListItem[];
  currentPhaseId?: string | null;
}) {
  const persistedItems = resolvePersistedPhaseWorkflowItems(args.slice.sourceMessages);
  const livePhaseTargetId = resolveLivePhaseTargetId({
    phaseSlices: args.phaseSlices,
    currentPhaseId: args.currentPhaseId,
  });
  const explicitPhaseWorkflowItems = Array.isArray(
    args.phaseConversationItemsByPhaseId?.[args.slice.phase.id],
  )
    ? args.phaseConversationItemsByPhaseId?.[args.slice.phase.id]?.filter(
        isWorkflowConversationItem,
      ) ?? []
    : [];
  const fallbackWorkflowItems =
    livePhaseTargetId && args.slice.phase.id === livePhaseTargetId
      ? (args.baseConversationItems ?? []).filter(isWorkflowConversationItem)
      : [];
  const overlayItems =
    explicitPhaseWorkflowItems.length > 0 ? explicitPhaseWorkflowItems : fallbackWorkflowItems;

  if (overlayItems.length === 0) {
    return persistedItems;
  }

  const seenKeys = new Set(persistedItems.map((item) => item.key));
  return [
    ...persistedItems,
    ...overlayItems.filter((item) => {
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
  const sortedPhaseSlices = args.phaseSlices
    .slice()
    .sort((left, right) => left.phase.phaseIndex - right.phase.phaseIndex);
  const resolvedMessageItemsByPhaseId = Object.fromEntries(
    sortedPhaseSlices.map((slice) => [
      slice.phase.id,
      resolvePhaseMessageItems({
        slice,
        phaseSlices: args.phaseSlices,
        phaseConversationItemsByPhaseId: args.phaseConversationItemsByPhaseId,
        phaseRealtimeMessagesByPhaseId,
        baseConversationItems: args.baseConversationItems,
        currentPhaseRealtimeMessages,
        currentPhaseId: args.currentPhaseId,
        globalPersistedKeys,
      }),
    ]),
  ) as Record<string, TaskConversationMessageItem[]>;
  const resolvedWorkflowItemsByPhaseId = Object.fromEntries(
    sortedPhaseSlices.map((slice) => [
      slice.phase.id,
      resolvePhaseWorkflowItems({
        slice,
        phaseSlices: args.phaseSlices,
        phaseConversationItemsByPhaseId: args.phaseConversationItemsByPhaseId,
        baseConversationItems: args.baseConversationItems,
        currentPhaseId: args.currentPhaseId,
      }),
    ]),
  ) as Record<string, TaskConversationWorkflowItem[]>;
  const visibleMessageItemsByPhaseId = Object.fromEntries(
    sortedPhaseSlices.map((slice) => {
      const messageItems = resolvedMessageItemsByPhaseId[slice.phase.id] ?? [];
      const parallelItems =
        slice.phase.phaseKind === "parallel"
          ? resolveParallelPhaseItems(slice.phase.id, args.parallelConversationItems)
          : [];

      return [
        slice.phase.id,
        parallelItems.length > 0
          ? suppressParallelPhaseCandidateMessages(messageItems, parallelItems)
          : messageItems,
      ];
    }),
  ) as Record<string, TaskConversationMessageItem[]>;

  return sortedPhaseSlices
    .map((slice, sliceIndex) => {
      const messageItems = resolvedMessageItemsByPhaseId[slice.phase.id] ?? [];
      const workflowItems = resolvedWorkflowItemsByPhaseId[slice.phase.id] ?? [];
      const parallelItems =
        slice.phase.phaseKind === "parallel"
          ? resolveParallelPhaseItems(slice.phase.id, args.parallelConversationItems)
          : [];
      const visibleMessageItems = visibleMessageItemsByPhaseId[slice.phase.id] ?? messageItems;
      const adoptedReplyItems: TaskConversationMessageItem[] = parallelItems
        .flatMap((parallelItem) => buildAdoptedParallelReplyItems(parallelItem))
        .filter((item) => !hasEquivalentAssistantMessage(visibleMessageItems, item));
      const items: TaskConversationListItem[] =
        parallelItems.length > 0
          ? [
              ...resolveParallelPhaseUserMessages({
                visibleMessageItems,
                parallelItems,
                baseConversationItems: args.baseConversationItems,
                previousVisibleMessageItems: sortedPhaseSlices
                  .slice(0, sliceIndex)
                  .flatMap((previousSlice) => visibleMessageItemsByPhaseId[previousSlice.phase.id] ?? []),
              }),
              ...sortConversationItemsByTimestamp(workflowItems),
              ...sortConversationItemsByTimestamp(parallelItems),
              ...sortConversationItemsByTimestamp([
                ...visibleMessageItems.filter((item) => item.role !== "user"),
                ...adoptedReplyItems,
              ]),
            ]
          : sortConversationItemsByTimestamp([...visibleMessageItems, ...workflowItems]);

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
    .filter((block) => block.items.length > 0);
}