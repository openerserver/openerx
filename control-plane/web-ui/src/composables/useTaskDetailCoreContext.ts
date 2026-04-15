import { computed, ref, type Ref } from "vue";
import { getTaskMessageSnapshotRevision } from "../lib/task-message-snapshot";
import { useProjectTreeTask } from "./useProjectTreeTask";
import { useTaskDetailTaskStatusSync } from "./useTaskDetailTaskStatusSync";
import { useTaskMessageSnapshot } from "./useTaskMessageSnapshot";
import { useTaskMessageStore } from "./useTaskMessageStore";
import { useTreeBranches } from "./useTreeBranches";

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

  const messageSnapshot = useTaskMessageSnapshot(taskId, selectedSessionId);
  const {
    clearPendingAssistantDraft,
    conversationItems: baseConversationItems,
    hasStreamingAssistant,
    latestTaskRefreshRequest,
    realtimeConnected,
    seedPendingAssistantDraft,
  } = useTaskMessageStore(taskId, messageSnapshot.activeSessionId, {
    sourceMessages: messageSnapshot.sourceMessages,
    snapshotRevision: computed(() => getTaskMessageSnapshotRevision(messageSnapshot.trace.value)),
  });

  useTaskDetailTaskStatusSync({
    latestTaskRefreshRequest,
    task,
  });

  return {
    ancestors,
    baseConversationItems,
    clearPendingAssistantDraft,
    currentPhaseId,
    flatNodes,
    hasOlderHistory: messageSnapshot.hasOlderHistory,
    historyLoading: messageSnapshot.historyLoading,
    hasStreamingAssistant,
    latestTaskRefreshRequest,
    loadOlderHistory: messageSnapshot.loadOlderHistory,
    messageReconcileRequired: computed(
      () => Boolean(messageSnapshot.trace.value?.timelineMeta?.reconcileRequired),
    ),
    messageTrace: messageSnapshot.trace,
    messagesError: messageSnapshot.error,
    messagesLoading: messageSnapshot.loading,
    projectId,
    realtimeConnected,
    refreshMessages: messageSnapshot.refresh,
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