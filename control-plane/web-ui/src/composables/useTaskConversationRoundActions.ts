import { computed, ref, type Ref } from "vue";
import type { TaskSessionRecord } from "../lib/api";
import type { TreeTask } from "./useProjectTreeTask";

export function useTaskConversationRoundActions(args: {
  task: Ref<TreeTask | null | undefined>;
  taskSessionSummaries: Ref<TaskSessionRecord[]>;
  selectedSessionId: Ref<string | undefined>;
}) {
  const conversationFocusToken = ref(0);

  const canForkFromCurrentSession = computed(() =>
    Boolean(args.selectedSessionId.value || args.task.value?.sessionId),
  );

  function resolveTaskSessionRequestId(sessionId?: string | null) {
    if (!sessionId) {
      return undefined;
    }

    const matchedSummary = args.taskSessionSummaries.value.find(
      (summary) => summary.id === sessionId || summary.taskSessionId === sessionId,
    );
    return matchedSummary?.taskSessionId ?? sessionId;
  }

  function handleSwitchRound(sessionId?: string, options?: { focus?: boolean }) {
    args.selectedSessionId.value = sessionId;
    if (options?.focus === true) {
      conversationFocusToken.value += 1;
    }
  }

  function bumpConversationFocus(sessionId?: string) {
    if (typeof sessionId !== "undefined") {
      args.selectedSessionId.value = sessionId;
    }
    conversationFocusToken.value += 1;
  }

  return {
    bumpConversationFocus,
    canForkFromCurrentSession,
    conversationFocusToken,
    handleSwitchRound,
    resolveTaskSessionRequestId,
  };
}