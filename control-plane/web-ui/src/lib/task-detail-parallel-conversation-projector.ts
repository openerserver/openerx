import type { ProjectionRunRecord } from "./api";
import {
  asRecord,
  asString,
  type LiveAssistantState,
  type TaskConversationListItem,
  type TaskConversationMessageItem,
  type TaskConversationParallelItem,
} from "./message-normalize";
import {
  buildParallelComparisonCardsForRun,
  type ParallelCandidateTraceState,
} from "./task-detail-parallel-card-builder";
import { toTimestampMs } from "./task-detail-parallel-runtime";

function resolveParallelRunConversationAnchorCreatedAt(
  run: ProjectionRunRecord,
  baseConversationItems: TaskConversationListItem[],
  parallelCandidateItems: Record<string, TaskConversationMessageItem[]>,
) {
  const anchorMessageCreatedAt =
    typeof run.anchorMessageId === "string"
      ? baseConversationItems.find((item) => {
          const raw = asRecord(item.raw);
          const info = asRecord(raw?.info);
          const messageId = asString(info?.id) ?? asString(raw?.id) ?? item.key;
          return messageId === run.anchorMessageId;
        })?.createdAt
      : undefined;

  if (anchorMessageCreatedAt) {
    return anchorMessageCreatedAt;
  }

  const parallelExecutionFinishedAtMs = toTimestampMs(run.finishedAt);

  const candidatePromptCreatedAt = run.candidateSessions
    .flatMap((candidate) => {
      const candidateStartedAtMs = toTimestampMs(candidate.startedAt ?? run.startedAt);
      return candidate.sessionId
        ? (parallelCandidateItems[candidate.sessionId] ?? []).filter((item) => {
            if (
              item.role !== "user" ||
              typeof item.createdAt !== "string" ||
              item.createdAt.length === 0
            ) {
              return false;
            }

            const itemCreatedAtMs = toTimestampMs(item.createdAt);
            if (itemCreatedAtMs == null) {
              return false;
            }

            if (candidateStartedAtMs != null && itemCreatedAtMs < candidateStartedAtMs) {
              return false;
            }

            if (parallelExecutionFinishedAtMs != null && itemCreatedAtMs > parallelExecutionFinishedAtMs) {
              return false;
            }

            return true;
          })
        : [];
    })
    .filter(
      (item): item is TaskConversationMessageItem =>
        item.role === "user" && typeof item.createdAt === "string" && item.createdAt.length > 0,
    )
    .map((item) => item.createdAt)
    .sort((left, right) => (toTimestampMs(right) ?? 0) - (toTimestampMs(left) ?? 0))[0];

  if (candidatePromptCreatedAt) {
    return candidatePromptCreatedAt;
  }

  return run.startedAt ?? run.finishedAt;
}

export function buildParallelConversationItems(args: {
  visibleParallelRuns: ProjectionRunRecord[];
  currentParallelRunId?: string;
  taskStatus?: string | null;
  baseConversationItems: TaskConversationListItem[];
  parallelCandidateItems: Record<string, TaskConversationMessageItem[]>;
  parallelCandidateSettledReply: Record<string, boolean>;
  parallelCandidateTraceStates: Record<string, ParallelCandidateTraceState>;
  parallelCandidateLiveStates?: Record<string, LiveAssistantState>;
}) {
  const items: TaskConversationParallelItem[] = [];

  for (const run of args.visibleParallelRuns) {
    const cards = buildParallelComparisonCardsForRun({
      run,
      currentParallelRunId: args.currentParallelRunId,
      taskStatus: args.taskStatus,
      parallelCandidateItems: args.parallelCandidateItems,
      parallelCandidateSettledReply: args.parallelCandidateSettledReply,
      parallelCandidateTraceStates: args.parallelCandidateTraceStates,
      parallelCandidateLiveStates: args.parallelCandidateLiveStates,
    });
    if (cards.length < 2) {
      continue;
    }

    const winnerLabel =
      typeof run.judgeResult?.winnerIndex === "number"
        ? run.candidateSessions[run.judgeResult.winnerIndex]?.label ||
          `候选 ${run.judgeResult.winnerIndex + 1}`
        : undefined;
    const judgeSummary = winnerLabel
      ? Array.isArray(run.judgeResult?.scores) && run.judgeResult.scores.length > 0
        ? `Judge 推荐 ${winnerLabel}，得分 ${run.judgeResult.scores.map((score) => Number(score).toFixed(1)).join(" / ")}`
        : `Judge 推荐 ${winnerLabel}`
      : undefined;

    items.push({
      key: `parallel-${run.parallelRunId}`,
      role: "parallel",
      createdAt: resolveParallelRunConversationAnchorCreatedAt(
        run,
        args.baseConversationItems,
        args.parallelCandidateItems,
      ),
      candidates: cards,
      judgeSummary,
      judgeReasoning: run.judgeResult?.reasoning,
      raw: run,
      toolCalls: [],
    });
  }

  return items;
}

function shouldHideUnadoptedParallelMessagesForRun(parallelItem: TaskConversationParallelItem) {
  return !parallelItem.candidates?.some((candidate) => candidate.isAdopted);
}

function findParallelConversationAnchorIndex(
  items: TaskConversationListItem[],
  parallelItem: TaskConversationParallelItem,
) {
  const createdAtMs = toTimestampMs(parallelItem.createdAt);

  if (createdAtMs != null) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.role !== "user") continue;
      const itemCreatedAtMs = toTimestampMs(item.createdAt);
      if (itemCreatedAtMs == null || itemCreatedAtMs <= createdAtMs) {
        return index;
      }
    }
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

function findNextUserConversationIndex(items: TaskConversationListItem[], anchorIndex: number) {
  for (let index = anchorIndex + 1; index < items.length; index += 1) {
    if (items[index]?.role === "user") {
      return index;
    }
  }

  return items.length;
}

function resolveParallelConversationWindowEndAt(parallelItem: TaskConversationParallelItem) {
  return parallelItem.candidates
    .flatMap((candidate) => candidate.items)
    .map((item) => toTimestampMs(item.createdAt))
    .filter((value): value is number => value != null)
    .sort((left, right) => right - left)[0];
}

function extractConversationMessageSessionId(item: TaskConversationListItem) {
  if (item.role === "parallel" || item.role === "workflow") {
    return undefined;
  }

  const raw = asRecord(item.raw);
  const info = asRecord(raw?.info);
  const candidates = [
    asString(raw?.sourceSessionId),
    asString(raw?.sessionId),
    asString(info?.sessionId),
    asString(info?.id),
    asString(raw?.id),
    item.key,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (candidate.endsWith(":user-prompt")) {
      return candidate.slice(0, -":user-prompt".length);
    }

    for (const marker of [":assistant:", ":tool:", ":tool-result:"]) {
      const markerIndex = candidate.indexOf(marker);
      if (markerIndex > 0) {
        return candidate.slice(0, markerIndex);
      }
    }

    return candidate;
  }

  return undefined;
}

function matchesParallelCandidateSessionId(sessionId: string, candidateSessionIds: Set<string>) {
  if (candidateSessionIds.has(sessionId)) {
    return true;
  }

  for (const candidateSessionId of candidateSessionIds) {
    if (
      sessionId.endsWith(`:${candidateSessionId}`) ||
      candidateSessionId.endsWith(`:${sessionId}`)
    ) {
      return true;
    }
  }

  return false;
}

function suppressTopLevelParallelCandidateMessages(
  items: TaskConversationListItem[],
  parallelItem: TaskConversationParallelItem,
) {
  const rawRun = asRecord(parallelItem.raw);
  const candidateSessions = Array.isArray(rawRun?.candidateSessions)
    ? rawRun.candidateSessions
    : [];
  const candidateSessionIds = new Set(
    candidateSessions
      .map((candidate) => asString(asRecord(candidate)?.sessionId))
      .filter((value): value is string => Boolean(value)),
  );

  if (candidateSessionIds.size === 0) {
    return items;
  }

  return items.filter((item) => {
    const sessionId = extractConversationMessageSessionId(item);
    if (!sessionId) {
      return true;
    }

    return !matchesParallelCandidateSessionId(sessionId, candidateSessionIds);
  });
}

function insertParallelConversationItem(
  items: TaskConversationListItem[],
  parallelItem: TaskConversationParallelItem,
) {
  if (shouldHideUnadoptedParallelMessagesForRun(parallelItem)) {
    const filteredItems = suppressTopLevelParallelCandidateMessages(items, parallelItem);
    if (filteredItems !== items) {
      items.splice(0, items.length, ...filteredItems);
    }

    const anchorIndex = findParallelConversationAnchorIndex(items, parallelItem);

    if (anchorIndex < 0) {
      items.unshift(parallelItem);
      return;
    }

    const parallelWindowEndAt = resolveParallelConversationWindowEndAt(parallelItem);
    const rawRun = asRecord(parallelItem.raw);
    const hasFactualParallelAnchor =
      typeof asString(rawRun?.anchorMessageId) === "string" ||
      parallelItem.candidates.some((candidate) =>
        candidate.items.some((item) => item.role === "user"),
      );
    if (parallelWindowEndAt != null && hasFactualParallelAnchor) {
      let replaceEndIndex = anchorIndex + 1;
      while (replaceEndIndex < items.length) {
        const currentItem = items[replaceEndIndex];
        const currentItemCreatedAt = toTimestampMs(currentItem?.createdAt);
        if (currentItemCreatedAt == null) {
          break;
        }
        if (currentItemCreatedAt > parallelWindowEndAt) {
          break;
        }
        replaceEndIndex += 1;
      }

      items.splice(anchorIndex + 1, replaceEndIndex - (anchorIndex + 1), parallelItem);
      return;
    }

    const nextUserIndex = findNextUserConversationIndex(items, anchorIndex);
    items.splice(anchorIndex + 1, nextUserIndex - (anchorIndex + 1), parallelItem);
    return;
  }

  const anchorIndex = findParallelConversationAnchorIndex(items, parallelItem);

  if (anchorIndex >= 0) {
    const hasAdoptedCandidate = parallelItem.candidates?.some((candidate) => candidate.isAdopted);
    if (hasAdoptedCandidate) {
      items.splice(anchorIndex + 1, 0, parallelItem);
      return;
    }

    const nextUserIndex = findNextUserConversationIndex(items, anchorIndex);
    items.splice(nextUserIndex, 0, parallelItem);
    return;
  }

  items.push(parallelItem);
}

export function buildConversationItemsWithParallelRuns(args: {
  baseConversationItems: TaskConversationListItem[];
  parallelConversationItems: TaskConversationParallelItem[];
}) {
  const base = [...args.baseConversationItems];
  if (args.parallelConversationItems.length === 0) {
    return base;
  }

  for (const parallelConversationItem of args.parallelConversationItems) {
    insertParallelConversationItem(base, parallelConversationItem);
  }

  return base;
}