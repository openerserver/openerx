import { computed, type Ref } from "vue";
import type { TaskExecutionTrace, TaskSessionRecord } from "../lib/api";
import { resolveTraceTimelineAvailability } from "../lib/task-trace-timeline-state";
import type { TreeTask } from "./useProjectTreeTask";
import type { TreeSessionNodeRecord } from "./useTreeBranches";

export function useTaskConversationPresentationFeature(args: {
  task: Ref<TreeTask | null | undefined>;
  taskSessionSummaries: Ref<TaskSessionRecord[]>;
  selectedSessionId: Ref<string | undefined>;
  selectedSessionNode: Ref<TreeSessionNodeRecord | null | undefined>;
  messageTrace: Ref<TaskExecutionTrace | null | undefined>;
}) {
  const chatTraceWarning = computed(() => {
    const trace = args.messageTrace.value;
    const timelineAvailability = resolveTraceTimelineAvailability(
      trace?.timelineMeta,
      trace?.timeline?.length ?? 0,
    );
    if (!timelineAvailability || timelineAvailability === "complete") {
      return null;
    }

    if (timelineAvailability === "partial") {
      return {
        message: "当前对话时间线仅部分可用",
        description:
          "主聊天区当前展示的是部分执行追踪结果；如需定位缺口，请查看右侧执行追踪面板中的时间线状态。",
      };
    }

    return {
      message: "当前对话时间线暂不可用",
      description:
        "主聊天区当前没有可用的完整执行追踪时间线；如需确认状态，请查看右侧执行追踪面板中的时间线状态。",
    };
  });

  const selectedSessionLabel = computed(
    () =>
      args.selectedSessionNode.value?.contentText ||
      args.selectedSessionNode.value?.branchName ||
      args.selectedSessionNode.value?.runtimeSessionId?.slice(0, 8) ||
      "",
  );

  const assistantMessageModelFallback = computed(() => {
    const sessionId = args.selectedSessionId.value;
    const selectedSessionModel = sessionId
      ? args.taskSessionSummaries.value
          .find((summary) => summary.id === sessionId || summary.taskSessionId === sessionId)
          ?.selectedModel
      : null;

    const normalizedSessionModel =
      typeof selectedSessionModel === "string" ? selectedSessionModel.trim() : "";
    if (normalizedSessionModel) {
      return normalizedSessionModel;
    }

    const normalizedTaskModel = args.task.value?.selectedModel?.trim();
    return normalizedTaskModel || undefined;
  });

  return {
    assistantMessageModelFallback,
    chatTraceWarning,
    selectedSessionLabel,
  };
}