import { type Ref, computed, ref, watch } from "vue";
import { type TaskExecutionTrace, getTaskExecutionTraceView } from "../lib/api";

type TraceSummaryItem = { label: string; value: string; tone?: string };
type TraceSegmentFilter = "narrative" | "all" | "user-input" | "system-added" | "model-response" | "debug";
type TraceMessageRoleFilter = "narrative" | "all" | "user" | "system-added" | "assistant" | "debug";

const DEBUG_SEGMENT_TYPES = new Set([
  "status-transition",
  "session-activate",
  "session-branch",
  "session-archive",
]);

const SYSTEM_ADDED_SEGMENT_TYPES = new Set([
  "workflow-context",
  "hook-injection",
  "hook-result",
  "hook-rewrite",
  "final-prompt",
  "tool-call",
  "tool-output",
  "thinking",
  "file-reference",
  "diff",
  "candidate-result",
  "judge-decision",
  "chain-step-result",
]);

const NARRATIVE_MESSAGE_ROLES = new Set(["user", "assistant", "tool"]);

function resolveSyntheticUserTimestamp(trace: TaskExecutionTrace | null) {
  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index];
    if (item?.createdAt || item?.completedAt) {
      return item.createdAt ?? item.completedAt;
    }
  }

  return undefined;
}

function resolveSyntheticAssistantTimestamp(trace: TaskExecutionTrace | null) {
  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.completedAt || item?.createdAt) {
      return item.completedAt ?? item.createdAt;
    }
  }

  return trace?.snapshot?.lastActivityAt ?? trace?.snapshot?.updatedAt ?? undefined;
}

function buildTraceSegmentsWithFallback(trace: TaskExecutionTrace | null) {
  const segments = Array.isArray(trace?.segments) ? [...trace.segments] : [];
  const hasUserInput = segments.some((segment) => segment.type === "user-input");
  const hasModelResponse = segments.some((segment) => segment.type === "model-response");
  const finalPrompt = typeof trace?.finalPrompt === "string" ? trace.finalPrompt.trim() : "";
  const latestResponse = typeof trace?.latestResponse === "string" ? trace.latestResponse.trim() : "";

  if (!hasUserInput && finalPrompt) {
    segments.unshift({
      type: "user-input",
      label: "用户输入",
      content: finalPrompt,
      timestamp: resolveSyntheticUserTimestamp(trace),
    });
  }

  if (!hasModelResponse && latestResponse) {
    segments.push({
      type: "model-response",
      label: "模型回复",
      content: latestResponse,
      timestamp: resolveSyntheticAssistantTimestamp(trace),
    });
  }

  return segments;
}

function buildTraceTimelineWithFallback(trace: TaskExecutionTrace | null) {
  const timeline = Array.isArray(trace?.timeline) ? [...trace.timeline] : [];
  const hasUser = timeline.some((item) => item.role === "user" && item.text?.trim());
  const hasAssistant = timeline.some((item) => item.role === "assistant" && item.text?.trim());
  const finalPrompt = typeof trace?.finalPrompt === "string" ? trace.finalPrompt.trim() : "";
  const latestResponse = typeof trace?.latestResponse === "string" ? trace.latestResponse.trim() : "";

  if (!hasUser && finalPrompt) {
    timeline.unshift({
      id: "synthetic-trace-user-input",
      role: "user",
      text: finalPrompt,
      createdAt: resolveSyntheticUserTimestamp(trace),
      raw: {
        synthetic: true,
        source: "finalPrompt",
      },
      sourceEventTypes: ["synthetic:finalPrompt"],
    });
  }

  if (!hasAssistant && latestResponse) {
    timeline.push({
      id: "synthetic-trace-model-response",
      role: "assistant",
      text: latestResponse,
      completedAt: resolveSyntheticAssistantTimestamp(trace),
      raw: {
        synthetic: true,
        source: "latestResponse",
      },
      sourceEventTypes: ["synthetic:latestResponse"],
    });
  }

  return timeline;
}

function buildBaseTraceSummaryItems(trace: TaskExecutionTrace): TraceSummaryItem[] {
  return [
    {
      label: "追踪会话",
      value: trace.sessionId?.slice(0, 18) || "无",
      tone: "blue",
    },
    {
      label: "来源段",
      value: String(trace.segments.length),
      tone: "processing",
    },
    {
      label: "时间线项",
      value: String(trace.timeline?.length ?? 0),
      tone: "purple",
    },
  ];
}

function buildTraceReadSourceLabel(
  readSource: NonNullable<TaskExecutionTrace["timelineMeta"]>["readSource"],
) {
  switch (readSource) {
    case "task-domain-projection":
      return { value: "投影", tone: "cyan" };
    case "conversation-table":
      return { value: "会话表", tone: "default" };
    case "task-domain-events":
      return { value: "领域事件", tone: "default" };
    case "conversation-table+task-domain-events":
      return { value: "会话表+领域事件", tone: "default" };
    default:
      return { value: "未知", tone: "default" };
  }
}

function buildTraceSummaryItems(trace: TaskExecutionTrace): TraceSummaryItem[] {
  const items = buildBaseTraceSummaryItems(trace);

  if (trace.timelineMeta?.cacheState && trace.timelineMeta.cacheState !== "complete") {
    items.push({
      label: "时间线缓存",
      value: trace.timelineMeta.cacheState === "partial" ? "部分" : "未命中",
      tone: "warning",
    });
  }

  if (trace.timelineMeta?.readSource) {
    const readSource = buildTraceReadSourceLabel(trace.timelineMeta.readSource);
    items.push({
      label: "时间线来源",
      value: readSource.value,
      tone: readSource.tone,
    });
  }

  if (trace.truncated) {
    items.push({ label: "会话截断", value: "是", tone: "warning" });
  }

  return items;
}

export function useTaskExecutionTrace(taskId: Ref<string>, sessionId: Ref<string | undefined>) {
  const trace = ref<TaskExecutionTrace | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const segmentFilter = ref<TraceSegmentFilter>("narrative");
  const messageRoleFilter = ref<TraceMessageRoleFilter>("narrative");
  const expandedSegments = ref<Record<string, boolean>>({});
  const expandedMessageRaw = ref<Record<string, boolean>>({});

  async function refresh(silent = false) {
    if (!taskId.value) {
      trace.value = null;
      error.value = null;
      return;
    }

    if (!silent) {
      loading.value = true;
    }
    error.value = null;

    try {
      trace.value = await getTaskExecutionTraceView(taskId.value, sessionId.value);
      expandedSegments.value = {};
      expandedMessageRaw.value = {};
    } catch (nextError) {
      if (!silent) {
        trace.value = null;
      }
      error.value = nextError instanceof Error ? nextError.message : "加载执行追踪失败";
    } finally {
      if (!silent) {
        loading.value = false;
      }
    }
  }

  const filteredSegments = computed(() => {
    const segments = buildTraceSegmentsWithFallback(trace.value);
    if (segmentFilter.value === "all") {
      return segments;
    }
    if (segmentFilter.value === "narrative") {
      return segments.filter((segment) => !DEBUG_SEGMENT_TYPES.has(segment.type));
    }
    if (segmentFilter.value === "system-added") {
      return segments.filter((segment) => SYSTEM_ADDED_SEGMENT_TYPES.has(segment.type));
    }
    if (segmentFilter.value === "debug") {
      return segments.filter((segment) => DEBUG_SEGMENT_TYPES.has(segment.type));
    }
    return segments.filter((segment) => segment.type === segmentFilter.value);
  });

  const filteredMessages = computed(() => {
    const messages = buildTraceTimelineWithFallback(trace.value);
    if (messageRoleFilter.value === "all") {
      return messages;
    }
    if (messageRoleFilter.value === "narrative") {
      return messages.filter((message) => NARRATIVE_MESSAGE_ROLES.has(message.role));
    }
    if (messageRoleFilter.value === "system-added") {
      return messages.filter((message) => message.role === "tool");
    }
    if (messageRoleFilter.value === "debug") {
      return messages.filter((message) => !NARRATIVE_MESSAGE_ROLES.has(message.role));
    }
    return messages.filter((message) => message.role === messageRoleFilter.value);
  });

  const summaryItems = computed(() => {
    if (!trace.value) {
      return [] as TraceSummaryItem[];
    }

    return buildTraceSummaryItems(trace.value);
  });

  watch(
    [taskId, sessionId],
    () => {
      void refresh();
    },
    { immediate: true },
  );

  return {
    trace,
    loading,
    error,
    segmentFilter,
    messageRoleFilter,
    expandedSegments,
    expandedMessageRaw,
    refresh,
    filteredSegments,
    filteredMessages,
    summaryItems,
  };
}
