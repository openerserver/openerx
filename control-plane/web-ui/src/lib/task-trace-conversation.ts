import type { ExecutionTraceMessage, ExecutionTraceTimelineItem, TaskExecutionTrace } from "./api";
import {
  type LiveAssistantState,
  type TaskConversationMessageItem,
  type TaskConversationToolCallItem,
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
      createdAt: resolveSyntheticUserCreatedAt(trace) ?? undefined,
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
  const latestResponse =
    typeof trace?.latestResponse === "string" ? trace.latestResponse.trim() : "";
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

function buildToolTimelineText(tool: TaskConversationToolCallItem) {
  const lines = [tool.label];

  if (tool.headline) {
    lines.push(`调用: ${tool.headline}`);
  } else if (tool.command) {
    lines.push(`调用: ${tool.command}`);
  }

  if (tool.inputPreview) {
    lines.push(`参数: ${tool.inputPreview}`);
  }

  if (tool.outputPreview) {
    lines.push(`输出: ${tool.outputPreview}`);
  }

  return lines.join("\n");
}

function buildToolRequestTimelineText(tool: TaskConversationToolCallItem) {
  const lines = [tool.label];

  if (tool.headline) {
    lines.push(`调用: ${tool.headline}`);
  } else if (tool.command) {
    lines.push(`调用: ${tool.command}`);
  }

  if (tool.inputPreview) {
    lines.push(`参数: ${tool.inputPreview}`);
  }

  return lines.join("\n");
}

function buildToolResultTimelineText(tool: TaskConversationToolCallItem) {
  const lines = [`${tool.label} 结果`, `状态: ${tool.stateLabel}`];

  if (tool.outputPreview) {
    lines.push(`输出: ${tool.outputPreview}`);
  } else if (tool.description) {
    lines.push(`说明: ${tool.description}`);
  }

  return lines.join("\n");
}

function resolveTraceToolParts(item: TraceSourceItem) {
  const raw = asRecord(item.raw);
  const rawParts = Array.isArray(raw?.parts)
    ? raw.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => Boolean(part))
    : [];

  return normalizeTraceParts(rawParts).filter((part) => asString(part.type) === "tool");
}

function buildToolRequestRaw(
  item: TraceSourceItem,
  tool: TaskConversationToolCallItem,
  part: Record<string, unknown> | undefined,
) {
  const state = asRecord(part?.state) ?? {};
  const input = asRecord(part?.input) ?? asRecord(state.input) ?? {};
  const toolCallId = asString(part?.callID) ?? tool.key;
  const toolName = asString(part?.toolName) ?? asString(part?.tool) ?? tool.kind;

  return {
    source: "trace-message-tool-request",
    parentMessageId: item.id,
    toolCallId,
    toolName,
    request: {
      status: asString(state.status),
      input,
      headline: tool.headline,
      command: tool.command,
      description: tool.description,
      filePath: tool.filePath,
    },
    rawPart: {
      type: "tool",
      callID: toolCallId,
      tool: asString(part?.tool),
      toolName: asString(part?.toolName),
      state: {
        status: asString(state.status),
        input,
      },
    },
  };
}

function buildToolResultRaw(
  item: TraceSourceItem,
  tool: TaskConversationToolCallItem,
  part: Record<string, unknown> | undefined,
) {
  const state = asRecord(part?.state) ?? {};
  const toolCallId = asString(part?.callID) ?? tool.key;
  const toolName = asString(part?.toolName) ?? asString(part?.tool) ?? tool.kind;

  return {
    source: "trace-message-tool-result",
    parentMessageId: item.id,
    toolCallId,
    toolName,
    result: {
      status: asString(state.status),
      output: state.output,
      error: state.error,
      headline: tool.headline,
      outputPreview: tool.outputPreview,
      filePath: tool.filePath,
    },
    rawPart: {
      type: "tool",
      callID: toolCallId,
      tool: asString(part?.tool),
      toolName: asString(part?.toolName),
      state: {
        status: asString(state.status),
        output: state.output,
        error: state.error,
      },
    },
  };
}

function buildToolTimelineItems(
  item: TraceSourceItem,
  index: number,
): ExecutionTraceTimelineItem[] {
  const normalized = normalizeMessage(
    buildTraceLegacyMessage(item),
    index,
    createEmptyLiveAssistantState(),
  );
  if (!normalized || normalized.toolCalls.length === 0) {
    return [];
  }

  const toolParts = resolveTraceToolParts(item);

  return normalized.toolCalls.flatMap((tool, toolIndex) => {
    const baseId = `${item.id}:tool:${tool.key || toolIndex}`;
    const part = toolParts[toolIndex];

    return [
      {
        id: `${baseId}:request`,
        role: "tool-request",
        text: buildToolRequestTimelineText(tool),
        createdAt: item.createdAt,
        raw: buildToolRequestRaw(item, tool, part),
        sourceEventTypes: [`runtime:tool-request:${tool.kind}`],
      },
      {
        id: `${baseId}:result`,
        role: "tool-result",
        text: buildToolResultTimelineText(tool),
        createdAt: item.createdAt,
        raw: buildToolResultRaw(item, tool, part),
        sourceEventTypes: [`runtime:tool-result:${tool.kind}`],
      },
    ] satisfies ExecutionTraceTimelineItem[];
  });
}

function shouldKeepTraceMessageItem(
  item: TraceSourceItem,
  toolItems: ExecutionTraceTimelineItem[],
) {
  if (item.role !== "assistant") {
    return true;
  }

  const text = typeof item.text === "string" ? item.text.trim() : "";
  return text.length > 0 || toolItems.length === 0;
}

function isDisplayableTraceTimelineItem(item: ExecutionTraceTimelineItem) {
  return typeof item.text === "string" && item.text.trim().length > 0;
}

function resolveTraceTimelineItemSortTime(item: ExecutionTraceTimelineItem) {
  const timestamp = item.completedAt ?? item.createdAt;
  if (!timestamp) {
    return Number.MAX_SAFE_INTEGER;
  }

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function mergeTraceTimelineItem(
  current: ExecutionTraceTimelineItem,
  candidate: ExecutionTraceTimelineItem,
): ExecutionTraceTimelineItem {
  const currentText = typeof current.text === "string" ? current.text.trim() : "";
  const candidateText = typeof candidate.text === "string" ? candidate.text.trim() : "";

  return {
    id: candidate.id || current.id,
    role: candidate.role || current.role,
    text: candidateText || currentText,
    createdAt: current.createdAt ?? candidate.createdAt,
    completedAt: candidate.completedAt ?? current.completedAt,
    raw: candidate.raw ?? current.raw,
    sourceEventTypes: [
      ...new Set([...(current.sourceEventTypes ?? []), ...(candidate.sourceEventTypes ?? [])]),
    ],
  };
}

export function mergeTraceTimelineItems(
  baseTimeline: ExecutionTraceTimelineItem[],
  supplementalTimeline: ExecutionTraceTimelineItem[],
): ExecutionTraceTimelineItem[] {
  const merged = new Map<string, { item: ExecutionTraceTimelineItem; order: number }>();
  let order = 0;

  for (const item of [...baseTimeline, ...supplementalTimeline]) {
    if (!isDisplayableTraceTimelineItem(item)) {
      continue;
    }

    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, { item, order });
      order += 1;
      continue;
    }

    existing.item = mergeTraceTimelineItem(existing.item, item);
  }

  return [...merged.values()]
    .sort((left, right) => {
      const leftTime = resolveTraceTimelineItemSortTime(left.item);
      const rightTime = resolveTraceTimelineItemSortTime(right.item);
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.order - right.order;
    })
    .map((entry) => entry.item);
}

export function buildMergedTraceTimelineItems(
  trace: TaskExecutionTrace | null | undefined,
  options?: { includeLineage?: boolean },
): ExecutionTraceTimelineItem[] {
  const baseTimeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  const supplementalTimeline = resolveTraceTimelineItems(
    trace ? { ...trace, timeline: [] } : trace,
    options,
  );

  return mergeTraceTimelineItems(baseTimeline, supplementalTimeline);
}

export function resolveTraceTimelineItems(
  trace: TaskExecutionTrace | null | undefined,
  options?: { includeLineage?: boolean },
): ExecutionTraceTimelineItem[] {
  return resolveTraceSourceItems(trace, options).flatMap((item, index) => {
    const toolItems = buildToolTimelineItems(item, index);
    const timelineItems: ExecutionTraceTimelineItem[] = [];

    if (shouldKeepTraceMessageItem(item, toolItems)) {
      timelineItems.push({
        id: item.id,
        role: item.role,
        text: item.text,
        createdAt: item.createdAt,
        completedAt: "completedAt" in item ? (item.completedAt ?? undefined) : undefined,
        raw: item.raw,
        sourceEventTypes:
          "sourceEventTypes" in item && Array.isArray(item.sourceEventTypes)
            ? item.sourceEventTypes
            : undefined,
      });
    }

    timelineItems.push(...toolItems);
    return timelineItems;
  });
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

  return [...(hasUser ? [] : syntheticUserItems), ...normalizedItems, ...syntheticAssistantItems];
}
