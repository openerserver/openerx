import { computed, ref, watch, type Ref } from "vue";
import { getTaskExecutionTraceView, type TaskExecutionTrace } from "../lib/api";

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
    const messages = trace.value?.messages ?? [];
    if (messageRoleFilter.value === "all") {
      return messages;
    }
    return messages.filter((message) => message.role === messageRoleFilter.value);
  });

  const summaryItems = computed(() => {
    if (!trace.value) {
      return [] as Array<{ label: string; value: string; tone?: string }>;
    }

    const items: Array<{ label: string; value: string; tone?: string }> = [
      {
        label: "追踪会话",
        value: trace.value.sessionId?.slice(0, 18) || "无",
        tone: "blue",
      },
      {
        label: "来源段",
        value: String(trace.value.segments.length),
        tone: "processing",
      },
      {
        label: "原始消息",
        value: String(trace.value.messages?.length ?? 0),
        tone: "purple",
      },
    ];

    if (trace.value.truncated) {
      items.push({ label: "会话截断", value: "是", tone: "warning" });
    }

    return items;
  });

  watch([taskId, sessionId], () => {
    void refresh();
  }, { immediate: true });

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