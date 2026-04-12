import { computed, ref, type Ref } from "vue";
import { useProjectTreeTask } from "./useProjectTreeTask";
import { useTreeBranches } from "./useTreeBranches";
import { useTreeMessages } from "./useTreeMessages";

export function useTaskDetailCoreContext(taskId: Ref<string>) {
  const selectedSessionId = ref<string | undefined>(undefined);

  const {
    task,
    node,
    ancestors,
    projectId,
    loading: taskLoading,
    error: taskLoadError,
    refresh: refreshTask,
  } = useProjectTreeTask(taskId);

  const taskNodeId = computed(() => node.value?.id ?? taskId.value);

  const {
    currentPhaseId,
    flatNodes,
    sessionSummaries: taskSessionSummaries,
    selectedNode: selectedSessionNode,
    refresh: refreshSessions,
  } = useTreeBranches(taskId, taskNodeId, selectedSessionId);

  const {
    trace: messageTrace,
    conversationItems: baseConversationItems,
    clearPendingAssistantDraft,
    hasStreamingAssistant,
    latestTaskRefreshRequest,
    loading: messagesLoading,
    error: messagesError,
    realtimeConnected,
    refresh: refreshMessages,
    seedPendingAssistantDraft,
  } = useTreeMessages(taskId, selectedSessionId, { includeLineage: true });

  return {
    ancestors,
    baseConversationItems,
    clearPendingAssistantDraft,
    currentPhaseId,
    flatNodes,
    hasStreamingAssistant,
    latestTaskRefreshRequest,
    messageTrace,
    messagesError,
    messagesLoading,
    projectId,
    realtimeConnected,
    refreshMessages,
    refreshSessions,
    refreshTask,
    seedPendingAssistantDraft,
    selectedSessionId,
    selectedSessionNode,
    task,
    taskId,
    taskLoadError,
    taskLoading,
    taskNodeId,
    taskSessionSummaries,
  };
}