import type { ExecutionTraceMessage, ExecutionTraceTimelineItem, TaskExecutionTrace } from "./api";
import {
  type LiveAssistantState,
  type TaskConversationMessageItem,
  asRecord,
  asString,
  createEmptyLiveAssistantState,
  normalizeMessage,
} from "./message-normalize";

type TraceSourceItem = ExecutionTraceTimelineItem | ExecutionTraceMessage;

function resolveSyntheticAssistantCreatedAt(trace: TaskExecutionTrace | null | undefined) {
  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.completedAt || item?.createdAt) {
      return item.completedAt ?? item.createdAt;
    }
  }

  return trace?.snapshot?.lastActivityAt ?? undefined;
}

function resolveSyntheticUserCreatedAt(trace: TaskExecutionTrace | null | undefined) {
  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index];
    if (item?.createdAt || item?.completedAt) {
      return item.createdAt ?? item.completedAt;
    }
  }

  return undefined;
}

function buildSyntheticUserPromptItems(
  trace: TaskExecutionTrace | null | undefined,
): TraceSourceItem[] {
  const finalPrompt = typeof trace?.finalPrompt === "string" ? trace.finalPrompt.trim() : "";
  if (!finalPrompt) {
    return [];
  }

  return [
    {
      id: "synthetic-final-prompt",
      role: "user",
      text: finalPrompt,
      createdAt: resolveSyntheticUserCreatedAt(trace),
      raw: {
        synthetic: true,
        info: {
          id: "synthetic-final-prompt",
          role: "user",
          time: {
            created: resolveSyntheticUserCreatedAt(trace),
          },
        },
        parts: [{ type: "text", text: finalPrompt }],
      },
    },
  ];
}

function buildSyntheticAssistantResponseItems(
  trace: TaskExecutionTrace | null | undefined,
): TraceSourceItem[] {
  const latestResponse = typeof trace?.latestResponse === "string" ? trace.latestResponse.trim() : "";
  if (!latestResponse) {
    return [];
  }

  return [
    {
      id: "synthetic-latest-response",
      role: "assistant",
      text: latestResponse,
      createdAt: resolveSyntheticAssistantCreatedAt(trace),
      raw: {
        synthetic: true,
        info: {
          id: "synthetic-latest-response",
          role: "assistant",
          time: {
            completed: resolveSyntheticAssistantCreatedAt(trace),
          },
        },
        parts: [{ type: "text", text: latestResponse }],
      },
    },
  ];
}

type ToolSnapshot = {
  key: string;
  part: Record<string, unknown>;
  signalRank: number;
  statusRank: number;
  index: number;
};

function hasUsefulValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasUsefulValue(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return false;
}

function toolStatusRank(status?: string): number {
  switch (status) {
    case "completed":
    case "failed":
    case "error":
      return 4;
    case "running":
      return 3;
    case "pending":
      return 2;
    default:
      return 1;
  }
}

function toolSignalRank(part: Record<string, unknown>): number {
  const state = asRecord(part.state) ?? {};
  const input = asRecord(part.input) ?? asRecord(state.input) ?? {};
  let rank = 0;

  if (hasUsefulValue(input.command)) rank += 6;
  if (hasUsefulValue(input.filePath) || hasUsefulValue(input.path)) rank += 5;
  if (
    hasUsefulValue(input.query) ||
    hasUsefulValue(input.pattern) ||
    hasUsefulValue(input.url) ||
    hasUsefulValue(input.urls)
  ) {
    rank += 4;
  }
  if (hasUsefulValue(input.args)) rank += 3;
  if (hasUsefulValue(input.prompt)) rank += 3;
  if (hasUsefulValue(state.output) || hasUsefulValue(state.error)) rank += 7;
  if (hasUsefulValue(input.description) || hasUsefulValue(input.explanation)) rank += 1;

  return rank;
}

function buildToolSnapshot(part: Record<string, unknown>, index: number): ToolSnapshot {
  const state = asRecord(part.state) ?? {};
  const status = asString(state.status) ?? asString(part.state);
  return {
    key: asString(part.callID) ?? asString(part.id) ?? `tool:${index}`,
    part,
    signalRank: toolSignalRank(part),
    statusRank: toolStatusRank(status),
    index,
  };
}

function shouldReplaceToolSnapshot(
  current: ToolSnapshot | undefined,
  candidate: ToolSnapshot,
): boolean {
  if (!current) {
    return true;
  }
  if (candidate.signalRank !== current.signalRank) {
    return candidate.signalRank > current.signalRank;
  }
  if (candidate.statusRank !== current.statusRank) {
    return candidate.statusRank > current.statusRank;
  }
  return candidate.index > current.index;
}

function normalizeTraceParts(
  parts: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const visibleTextParts: Array<{ index: number; part: Record<string, unknown> }> = [];
  const toolSnapshots = new Map<string, ToolSnapshot>();

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const type = asString(part.type);
    if (type === "text") {
      visibleTextParts.push({ index, part });
      continue;
    }
    if (type !== "tool") {
      continue;
    }

    const snapshot = buildToolSnapshot(part, index);
    if (snapshot.signalRank <= 0) {
      continue;
    }

    const current = toolSnapshots.get(snapshot.key);
    if (shouldReplaceToolSnapshot(current, snapshot)) {
      toolSnapshots.set(snapshot.key, snapshot);
    }
  }

  const visibleTools = [...toolSnapshots.values()]
    .sort((left, right) => left.index - right.index)
    .map((snapshot) => ({ index: snapshot.index, part: snapshot.part }));

  return [...visibleTextParts, ...visibleTools]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.part);
}

function resolveTraceSourceItems(
  trace: TaskExecutionTrace | null | undefined,
  options?: { includeLineage?: boolean },
): TraceSourceItem[] {
  if (!trace) {
    return [];
  }

  const includeLineage = options?.includeLineage === true;
  const timeline = Array.isArray(trace.timeline) ? trace.timeline : [];
  const messages = Array.isArray(trace.messages) ? trace.messages : [];

  if (includeLineage && timeline.length > 0) {
    return timeline;
  }
  if (messages.length > 0) {
    return messages;
  }
  if (timeline.length > 0 && trace.timelineMeta?.cacheState === "complete") {
    return timeline;
  }
  return [];
}

function buildTraceLegacyMessage(item: TraceSourceItem) {
  const raw = asRecord(item.raw);
  const rawInfo = asRecord(raw?.info);
  const rawTime = asRecord(rawInfo?.time);
  const rawParts = Array.isArray(raw?.parts)
    ? raw.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];
  const parts = normalizeTraceParts(rawParts);

  return {
    ...(raw ?? {}),
    id: item.id,
    role: item.role,
    text: item.text,
    createdAt: item.createdAt,
    info: {
      ...(rawInfo ?? {}),
      id: item.id,
      role: item.role,
      time: {
        ...(rawTime ?? {}),
        created: item.createdAt,
        completed: "completedAt" in item ? (item.completedAt ?? undefined) : rawTime?.completed,
      },
      preview: item.text,
    },
    parts: parts.length > 0 ? parts : item.text ? [{ type: "text", text: item.text }] : [],
  };
}

export function normalizeTraceConversationItems(
  trace: TaskExecutionTrace | null | undefined,
  liveState: LiveAssistantState = createEmptyLiveAssistantState(),
  options?: { includeLineage?: boolean },
): TaskConversationMessageItem[] {
  const normalizedItems = resolveTraceSourceItems(trace, options)
    .map((item, index) => normalizeMessage(buildTraceLegacyMessage(item), index, liveState))
    .filter((item): item is TaskConversationMessageItem => item != null)
    .filter((item) => item.role !== "system");

  const syntheticUserItems = buildSyntheticUserPromptItems(trace)
    .map((item, index) => normalizeMessage(buildTraceLegacyMessage(item), index, liveState))
    .filter((item): item is TaskConversationMessageItem => item != null)
    .filter((item) => item.role === "user");

  const hasUser = normalizedItems.some((item) => item.role === "user");
  const hasAssistant = normalizedItems.some((item) => item.role === "assistant");

  if (hasUser && hasAssistant) {
    return normalizedItems;
  }

  const syntheticAssistantItems = hasAssistant
    ? []
    : buildSyntheticAssistantResponseItems(trace)
        .map((item, index) => normalizeMessage(buildTraceLegacyMessage(item), index, liveState))
        .filter((item): item is TaskConversationMessageItem => item != null)
        .filter((item) => item.role === "assistant");

  return [
    ...(hasUser ? [] : syntheticUserItems),
    ...normalizedItems,
    ...syntheticAssistantItems,
  ];
}
