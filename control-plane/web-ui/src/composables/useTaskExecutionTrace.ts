import { type Ref, computed, ref, watch } from "vue";
import { type TaskExecutionTrace, getTaskExecutionTraceView } from "../lib/api";

type TraceSummaryItem = { label: string; value: string; tone?: string };
type TraceMessageRoleFilter =
  | "narrative"
  | "all"
  | "user"
  | "system-added"
  | "assistant"
  | "tool"
  | "tool-request"
  | "tool-result"
  | "debug";

const TOOL_MESSAGE_ROLES = new Set(["tool", "tool-request", "tool-result"]);
const NARRATIVE_MESSAGE_ROLES = new Set(["user", "assistant", ...TOOL_MESSAGE_ROLES]);

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

function buildTraceTimelineWithFallback(trace: TaskExecutionTrace | null) {
  const timeline = Array.isArray(trace?.timeline) ? [...trace.timeline] : [];
  const hasUser = timeline.some((item) => item.role === "user" && item.text?.trim());
  const hasAssistant = timeline.some((item) => item.role === "assistant" && item.text?.trim());
  const finalPrompt = typeof trace?.finalPrompt === "string" ? trace.finalPrompt.trim() : "";
  const latestResponse =
    typeof trace?.latestResponse === "string" ? trace.latestResponse.trim() : "";

  if (!hasUser && finalPrompt) {
    timeline.unshift({
      id: "synthetic-trace-user-input",
      role: "user",
      text: finalPrompt,
      createdAt: resolveSyntheticUserTimestamp(trace) ?? undefined,
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
      label: "追踪范围",
      value: "当前任务",
      tone: "blue",
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
    case "opencode-runtime":
      return { value: "运行时", tone: "warning" };
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
  const messageRoleFilter = ref<TraceMessageRoleFilter>("narrative");
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

  const filteredMessages = computed(() => {
    const messages = buildTraceTimelineWithFallback(trace.value);
    if (messageRoleFilter.value === "all") {
      return messages;
    }
    if (messageRoleFilter.value === "narrative") {
      return messages.filter((message) => NARRATIVE_MESSAGE_ROLES.has(message.role));
    }
    if (messageRoleFilter.value === "system-added") {
      return messages.filter((message) => TOOL_MESSAGE_ROLES.has(message.role));
    }
    if (messageRoleFilter.value === "debug") {
      return messages.filter((message) => !NARRATIVE_MESSAGE_ROLES.has(message.role));
    }
    if (messageRoleFilter.value === "tool") {
      return messages.filter((message) => TOOL_MESSAGE_ROLES.has(message.role));
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
    messageRoleFilter,
    expandedMessageRaw,
    refresh,
    filteredMessages,
    summaryItems,
  };
}
