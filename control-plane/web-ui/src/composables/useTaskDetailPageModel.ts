import { computed, ref, watch, type UnwrapNestedRefs } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { TaskExecutionReconcileEnvelope } from "../lib/api";
import { useRealtimeStore } from "../stores/realtime";
import { useTaskDetailCoreContext } from "./useTaskDetailCoreContext";
import {
  useTaskDetailTaskDerivedState,
} from "./useTaskDetailDerivedState";
import { useTaskDetailPageCoordinator } from "./useTaskDetailPageCoordinator";
import {
  useTaskDetailHeaderModel,
  useTaskDetailLayoutModel,
} from "./useTaskDetailPageSectionModels";
import { useTaskConversationFeature } from "./useTaskConversationFeature";
import { useTaskDetailMainPaneFeature } from "./useTaskDetailMainPaneFeature";
import { useTaskDetailRealtimeFeature } from "./useTaskDetailRealtimeFeature";
import {
  useTaskDetailSnapshotCoordinator,
  type TaskDetailSnapshotRefreshOptions,
} from "./useTaskDetailSnapshotCoordinator";
import { useTaskDetailSidebarPaneFeature } from "./useTaskDetailSidebarPaneFeature";
import { useTaskDetailParallelFlow } from "./useTaskDetailParallelFlow";
import { useTaskRuntimePermissionFeature } from "./useTaskRuntimePermissionFeature";
import { useTaskParallelCandidateActions } from "./useTaskParallelCandidateActions";
import { useTaskSidebarFeature } from "./useTaskSidebarFeature";
import { useTaskWorkflowFeature } from "./useTaskWorkflowFeature";

export function useTaskDetailPageModel() {
  const route = useRoute();
  const router = useRouter();
  const realtimeStore = useRealtimeStore();

  const taskId = computed(() => String(route.params.taskId || ""));

  const {
    ancestors,
    baseConversationItems,
    clearPendingAssistantDraft,
    currentPhaseId,
    flatNodes,
    hasOlderHistory,
    historyLoading,
    hasStreamingAssistant,
    latestTaskRefreshRequest,
    loadOlderHistory,
    messageReconcileRequired,
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
    taskLoadError,
    taskLoading,
    taskNodeId,
    taskSessionSummaries,
  } = useTaskDetailCoreContext(taskId);

  const {
    canTerminateExecution: baseCanTerminateExecution,
    editableExecutionMode,
    editableJudgeConfig,
    editableParallelCandidates,
    isExecuting,
    loadError,
    pageLoading,
    taskDisplayStatus,
    taskFailureReason,
  } = useTaskDetailTaskDerivedState({
    task,
    taskLoading,
    taskLoadError,
  });

  const workflowFeature = useTaskWorkflowFeature({
    editableExecutionMode,
    taskId,
    task,
    taskSessionSummaries,
    refreshTask,
  });

  const sidebarTraceRefreshKey = ref(0);
  const sidebarFeature = useTaskSidebarFeature({
    selectedSessionId,
    task,
    taskId,
    traceRefreshKey: sidebarTraceRefreshKey,
  });

  const workflowReconcileRequired = computed(
    () =>
      workflowFeature.workflowReconcileRequired.value ||
      sidebarFeature.memberReconcileRequired.value,
  );

  async function refreshWorkflowSnapshot() {
    const currentTaskId = taskId.value;
    if (!currentTaskId) {
      return;
    }

    await workflowFeature.refreshWorkflowSnapshot();
    if (taskId.value !== currentTaskId) {
      return;
    }

    await sidebarFeature.refreshMemberViewSnapshot();
  }

  async function loadInitialWorkflowSnapshot() {
    if (!taskId.value) {
      resetWorkflowTargetState();
      return;
    }

    await Promise.all([
      workflowFeature.loadInitialWorkflowSnapshot(),
      sidebarFeature.loadInitialMemberViewSnapshot(),
    ]);
  }

  function resetWorkflowSnapshotState() {
    workflowFeature.resetWorkflowSnapshotState();
    sidebarFeature.resetMemberViewState();
  }

  function resetWorkflowTargetState() {
    workflowFeature.resetWorkflowState();
    sidebarFeature.resetMemberViewState();
  }

  const runtimePermissionFeature = useTaskRuntimePermissionFeature({
    taskId,
    task,
    selectedSessionId,
    refreshTaskSnapshot: (options?: TaskDetailSnapshotRefreshOptions) =>
      refreshTaskSnapshot(options),
  });

  const compareFlow = useTaskDetailParallelFlow({
    taskId,
    taskNodeId,
    task,
    taskSessionSummaries,
    flatNodes,
    selectedSessionId,
    selectedSessionNode,
    baseConversationItems,
    configuredCandidates: editableParallelCandidates,
    refreshTask,
    refreshSessions,
    refreshRuntimePermissions: runtimePermissionFeature.refreshRuntimePermissions,
  });
  const compareActions = useTaskParallelCandidateActions({
    taskId,
    currentParallelRunRecord: compareFlow.currentParallelRunRecord,
    refreshTaskSnapshot: (options?: TaskDetailSnapshotRefreshOptions) =>
      refreshTaskSnapshot(options),
    reconcileExecutionEnvelope: (envelope?: TaskExecutionReconcileEnvelope | null) =>
      reconcileExecutionEnvelope(envelope),
  });
  const stopPhaseId = computed(
    () => compareFlow.currentParallelRunRecord.value?.phaseId ?? currentPhaseId.value ?? null,
  );
  const canTerminateExecution = computed(
    () =>
      Boolean(baseCanTerminateExecution.value) ||
      (Boolean(isExecuting.value) && Boolean(stopPhaseId.value)),
  );

  const {
    assistantMessageModelFallback,
    bumpConversationFocus,
    canForkFromCurrentSession,
    chatTraceWarning,
    composerResetToken,
    continuing,
    conversationFocusToken,
    forking,
    handleClearQueuedContinuations,
    handleContinue,
    handleFork,
    handleSwitchRound,
    handleRemoveQueuedContinuation,
    handleTerminate,
    queuedContinuations,
    resolveTaskSessionRequestId,
    selectedSessionLabel,
    terminating,
  } = useTaskConversationFeature({
    actionArgs: {
      taskId,
      task,
      stopPhaseId,
      selectedSessionId,
      editableExecutionMode,
      isExecuting,
      hasStreamingAssistant,
      canTerminateExecution,
      baseConversationItems,
      messageTrace,
      clearPendingAssistantDraft,
      refreshTask,
      refreshSessions,
      refreshMessages,
      refreshTaskSnapshot: (options?: TaskDetailSnapshotRefreshOptions) =>
        refreshTaskSnapshot(options),
      reconcileExecutionEnvelope: (envelope?: TaskExecutionReconcileEnvelope | null) =>
        reconcileExecutionEnvelope(envelope),
      seedPendingAssistantDraft,
    },
    messageTrace,
    selectedSessionId,
    selectedSessionNode,
    task,
    taskSessionSummaries,
  });

  const {
    reconcileExecutionEnvelope,
    refreshMessageSnapshot,
    refreshTaskSnapshot,
    loadInitialSnapshot,
    resetSnapshotState,
  } = useTaskDetailSnapshotCoordinator({
    taskId,
    projectId,
    selectedSessionId,
    bumpConversationFocus,
    refreshMessages,
    refreshFlowSnapshot: compareFlow.refreshFlowSnapshot,
    refreshWorkflowSnapshot,
    loadInitialFlowSnapshot: compareFlow.loadInitialFlowSnapshot,
    loadInitialWorkflowSnapshot,
    resetFlowSnapshotState: compareFlow.clearParallelFlowState,
    resetWorkflowTargetState,
    subscribeProject: (currentProjectId) => {
      realtimeStore.subscribeProject(currentProjectId);
    },
    subscribeTask: (currentTaskId) => {
      realtimeStore.subscribeTask(currentTaskId);
    },
  });

  const { handleTaskSwitch } = useTaskDetailPageCoordinator({
    taskId,
    task,
    projectId,
    route,
    router,
    realtimeConnected,
    subscribeTask: (currentTaskId) => {
      realtimeStore.subscribeTask(currentTaskId);
    },
    subscribeProject: (currentProjectId) => {
      realtimeStore.subscribeProject(currentProjectId);
    },
    resetConversationRound: () => handleSwitchRound(undefined, { focus: false }),
    resetSnapshotState,
    loadInitialSnapshot,
  });

  const { traceRefreshKey } = useTaskDetailRealtimeFeature({
    polling: {
      isExecuting,
      hasStreamingAssistant,
      continuing,
      forking,
    },
    subscription: {
      taskId,
      latestTaskRefreshRequest,
      messageReconcileRequired,
      workflowReconcileRequired,
      realtimeConnected,
      refreshFlowSnapshot: compareFlow.refreshFlowSnapshot,
      refreshMessageSnapshot,
      refreshTaskSnapshot,
      refreshWorkflowSnapshot,
    },
  });

  watch(
    traceRefreshKey,
    (value) => {
      sidebarTraceRefreshKey.value = value;
    },
    { immediate: true },
  );

  const layout = useTaskDetailLayoutModel({
    pageLoading,
    loadError,
  });

  const header = useTaskDetailHeaderModel({
    ancestors,
    currentStageLabel: workflowFeature.currentStageLabel,
    handleTaskSwitch,
    projectId,
    task,
    taskDisplayStatus,
  });

  const main = useTaskDetailMainPaneFeature({
    compare: {
      canTerminateExecution,
      conversationItems: compareFlow.conversationItems,
      handleAdoptCandidate: compareActions.handleAdoptCandidate,
    },
    conversation: {
      assistantMessageModelFallback,
      canForkFromCurrentSession,
      chatTraceWarning,
      composerResetToken,
      continuing,
      conversationFocusToken,
      forking,
      handleClearQueuedContinuations,
      handleContinue,
      handleFork,
      handleRemoveQueuedContinuation,
      handleTerminate,
      queuedContinuations,
      terminating,
    },
    messages: {
      hasOlderHistory,
      historyLoading,
      loadOlderHistory,
      messagesError,
      messagesLoading,
      selectedSessionId,
    },
    page: {
      hasStreamingAssistant,
      isExecuting,
      task,
      taskFailureReason,
    },
    runtimePermission: {
      handleReplyRuntimePermission: runtimePermissionFeature.handleReplyRuntimePermission,
      runtimePermissionActionId: runtimePermissionFeature.runtimePermissionActionId,
      runtimePermissionLabel: runtimePermissionFeature.runtimePermissionLabel,
      runtimePermissionPath: runtimePermissionFeature.runtimePermissionPath,
      runtimePermissionPatterns: runtimePermissionFeature.runtimePermissionPatterns,
      selectedSessionRuntimePermissions: runtimePermissionFeature.selectedSessionRuntimePermissions,
    },
    sidebar: {
      handleOpenFilePreview: sidebarFeature.handleOpenFilePreview,
    },
    workflow: {
      editableExecutionMode,
      editableJudgeConfig,
      editableParallelCandidates,
      editableSequentialSteps: workflowFeature.editableSequentialSteps,
      executionModeSaving: workflowFeature.executionModeSaving,
      filterModelOption: workflowFeature.filterModelOption,
      handleChooseMode: workflowFeature.handleChooseMode,
      handleExecutionModeConfirm: workflowFeature.handleExecutionModeConfirm,
      handleSelectedModelChange: workflowFeature.handleSelectedModelChange,
      loadModels: workflowFeature.loadModels,
      modelOptions: workflowFeature.modelOptions,
      modelsLoading: workflowFeature.modelsLoading,
      setExecutionModeModalOpen: workflowFeature.setExecutionModeModalOpen,
      showExecutionModeModal: workflowFeature.showExecutionModeModal,
      workflowStages: workflowFeature.workflowStages,
      workflowSummary: workflowFeature.workflowSummary,
    },
  });

  const sidebar = useTaskDetailSidebarPaneFeature({
    collapsed: sidebarFeature.collapsed,
    filePreview: sidebarFeature.filePreviewPanel,
    member: sidebarFeature.memberPanel,
    trace: sidebarFeature.tracePanel,
    toggleSidebar: sidebarFeature.toggleSidebar,
  });

  return {
    header,
    layout,
    main,
    sidebar,
  };
}

export type TaskDetailPageModelState = UnwrapNestedRefs<ReturnType<typeof useTaskDetailPageModel>>;