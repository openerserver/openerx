import { type Ref, computed, ref, watch } from "vue";
import { type TaskExecutionTrace, getTaskExecutionTraceView } from "../lib/api";

type TraceSummaryItem = { label: string; value: string; tone?: string };

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
    case "runtime-fallback":
      return { value: "运行时回退", tone: "default" };
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

  if (trace.snapshot?.currentStatus) {
    items.push({
      label: "快照状态",
      value: trace.snapshot.currentStatus,
      tone: "geekblue",
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
  const segmentFilter = ref<"all" | "user-input" | "hook" | "model-response">("all");
  const messageRoleFilter = ref<"all" | "user" | "assistant" | "tool">("all");
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
    const segments = trace.value?.segments ?? [];
    if (segmentFilter.value === "all") {
      return segments;
    }
    if (segmentFilter.value === "hook") {
      return segments.filter((segment) =>
        ["hook-injection", "hook-result", "hook-rewrite"].includes(segment.type),
      );
    }
    return segments.filter((segment) => segment.type === segmentFilter.value);
  });

  const filteredMessages = computed(() => {
    const messages = trace.value?.timeline ?? [];
    if (messageRoleFilter.value === "all") {
      return messages;
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
