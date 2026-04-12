import { message } from "ant-design-vue";
import { computed, type UnwrapNestedRefs, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useRealtimeStore } from "../stores/realtime";
import { useTaskDetailActionCoordinator } from "./useTaskDetailActionCoordinator";
import { useTaskDetailCoreContext } from "./useTaskDetailCoreContext";
import {
  useTaskDetailPollingState,
  useTaskDetailTaskDerivedState,
  useTaskDetailWorkflowDerivedState,
} from "./useTaskDetailDerivedState";
import { useTaskDetailExecutionModeCoordinator } from "./useTaskDetailExecutionModeCoordinator";
import { useTaskDetailPageCoordinator } from "./useTaskDetailPageCoordinator";
import {
  useTaskDetailHeaderModel,
  useTaskDetailLayoutModel,
  useTaskDetailMainPaneModel,
  useTaskDetailSidebarModel,
} from "./useTaskDetailPageSectionModels";
import { useTaskDetailParallelFlow } from "./useTaskDetailParallelFlow";
import { useTaskDetailRefreshController } from "./useTaskDetailRefreshController";
import { useTaskDetailSequentialStepsCoordinator } from "./useTaskDetailSequentialStepsCoordinator";
import { useTaskDetailSnapshotCoordinator } from "./useTaskDetailSnapshotCoordinator";
import { useTaskDetailViewStateCoordinator } from "./useTaskDetailViewStateCoordinator";

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
    taskLoadError,
    taskLoading,
    taskNodeId,
    taskSessionSummaries,
  } = useTaskDetailCoreContext(taskId);

  watch(
    () => latestTaskRefreshRequest.value?.eventId,
    () => {
      const refreshRequest = latestTaskRefreshRequest.value;
      const currentTask = task.value;
      if (!refreshRequest || !currentTask) {
        return;
      }

      if (refreshRequest.reason === "task-completed") {
        task.value = {
          ...currentTask,
          status: "completed",
          finishedAt: currentTask.finishedAt ?? new Date().toISOString(),
        };
        return;
      }

      if (refreshRequest.reason === "task-failed") {
        task.value = {
          ...currentTask,
          status: "failed",
          finishedAt: currentTask.finishedAt ?? new Date().toISOString(),
        };
        return;
      }

      if (refreshRequest.reason === "task-continued") {
        task.value = {
          ...currentTask,
          status: "running",
          finishedAt: undefined,
        };
      }
    },
  );

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

  const {
    assistantMessageModelFallback,
    chatTraceWarning,
    handleCloseFilePreview,
    handleOpenFilePreview,
    previewFile,
    refreshRuntimePermissions,
    runtimePermissionLabel,
    runtimePermissionPath,
    runtimePermissionPatterns,
    selectedSessionLabel,
    selectedSessionRuntimePermissions,
    sidebarCollapsed,
    toggleSidebar,
  } = useTaskDetailViewStateCoordinator({
    taskId,
    task,
    taskSessionSummaries,
    selectedSessionId,
    selectedSessionNode,
    messageTrace,
  });

  const {
    conversationItems,
    currentParallelRunRecord,
    ensureSelectedSession,
    isParallelComparisonMode,
    refreshParallelCandidateMessages,
    refreshTaskRunSummaries,
    clearParallelFlowState,
  } = useTaskDetailParallelFlow({
    taskId,
    taskNodeId,
    task,
    taskSessionSummaries,
    flatNodes,
    selectedSessionId,
    selectedSessionNode,
    baseConversationItems,
    configuredCandidates: editableParallelCandidates,
  });

  const stopPhaseId = computed(
    () => currentParallelRunRecord.value?.phaseId ?? currentPhaseId.value ?? null,
  );
  const canTerminateExecution = computed(
    () => baseCanTerminateExecution.value || (isExecuting.value && Boolean(stopPhaseId.value)),
  );

  const {
    workflowView,
    memberView,
    memberViewLoading,
    refreshTaskSnapshot,
    loadInitialSnapshot,
    resetSnapshotState,
  } = useTaskDetailSnapshotCoordinator({
    taskId,
    projectId,
    task,
    isParallelComparisonMode: () => isParallelComparisonMode.value,
    refreshTask,
    refreshSessions,
    refreshMessages,
    refreshTaskRunSummaries,
    refreshParallelCandidateMessages,
    clearParallelCandidateState: clearParallelFlowState,
    refreshRuntimePermissions,
    ensureSelectedSession,
    subscribeProject: (currentProjectId) => {
      realtimeStore.subscribeProject(currentProjectId);
    },
    subscribeTask: (currentTaskId) => {
      realtimeStore.subscribeTask(currentTaskId);
    },
  });

  const { currentStageLabel, workflowStages, workflowSummary } =
    useTaskDetailWorkflowDerivedState({
      workflowView,
    });

  const { editableSequentialSteps, resetSequentialStepState } =
    useTaskDetailSequentialStepsCoordinator({
      taskId,
      task,
      taskSessionSummaries,
      editableExecutionMode,
    });

  const {
    canForkFromCurrentSession,
    handleTaskSwitch,
    resolveTaskSessionRequestId,
  } = useTaskDetailPageCoordinator({
    taskId,
    selectedSessionId,
    task,
    projectId,
    taskSessionSummaries,
    route,
    router,
    realtimeConnected,
    subscribeTask: (currentTaskId) => {
      realtimeStore.subscribeTask(currentTaskId);
    },
    subscribeProject: (currentProjectId) => {
      realtimeStore.subscribeProject(currentProjectId);
    },
    resetSnapshotState,
    resetSequentialStepState,
    loadInitialSnapshot,
  });

  const {
    executionModeSaving,
    filterModelOption,
    handleChooseMode,
    handleExecutionModeConfirm,
    handleSelectedModelChange,
    loadModels,
    modelOptions,
    modelsLoading,
    showExecutionModeModal,
  } = useTaskDetailExecutionModeCoordinator({
    taskId,
    task,
    editableExecutionMode,
    refreshTask,
  });

  const {
    composerResetToken,
    continuing,
    conversationFocusToken,
    forking,
    handleAdoptCandidate,
    handleClearQueuedContinuations,
    handleContinue,
    handleFork,
    handleRemoveQueuedContinuation,
    handleReplyRuntimePermission,
    handleTerminate,
    queuedContinuations,
    runtimePermissionActionId,
    terminating,
  } = useTaskDetailActionCoordinator({
    taskId,
    task,
    stopPhaseId,
    selectedSessionId,
    selectedSessionLabel,
    currentParallelRunRecord,
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
    refreshTaskSnapshot,
    refreshRuntimePermissions,
    resolveTaskSessionRequestId,
    seedPendingAssistantDraft,
  });

  const { shouldPollRunningStatus } = useTaskDetailPollingState({
    isExecuting,
    hasStreamingAssistant,
    continuing,
    forking,
  });

  const { traceRefreshKey } = useTaskDetailRefreshController({
    taskId,
    latestTaskRefreshRequest,
    realtimeConnected,
    shouldPollRunningStatus,
    refreshTaskSnapshot,
  });

  function handleUnavailableAction(label: string) {
    return () => {
      message.info(`精简视图暂未接入${label}`);
    };
  }

  function setExecutionModeModalOpen(open: boolean) {
    showExecutionModeModal.value = open;
  }

  const sidebarTaskId = computed(() => task.value?.id ?? taskId.value);
  const normalizedMessagesError = computed(() => messagesError.value ?? null);

  const layout = useTaskDetailLayoutModel({
    pageLoading,
    loadError,
  });

  const header = useTaskDetailHeaderModel({
    ancestors,
    currentStageLabel,
    handleTaskSwitch,
    projectId,
    task,
    taskDisplayStatus,
  });

  const main = useTaskDetailMainPaneModel({
    assistantMessageModelFallback,
    canForkFromCurrentSession,
    canTerminateExecution,
    chatTraceWarning,
    composerResetToken,
    continuing,
    conversationFocusToken,
    conversationItems,
    editableExecutionMode,
    editableJudgeConfig,
    editableParallelCandidates,
    editableSequentialSteps,
    executionModeSaving,
    filterModelOption,
    forking,
    handleAdoptCandidate,
    handleChooseMode,
    handleClearQueuedContinuations,
    handleContinue,
    handleExecutionModeConfirm,
    handleFork,
    handleOpenFilePreview,
    handleRemoveQueuedContinuation,
    handleReplyRuntimePermission,
    handleSelectedModelChange,
    handleTerminate,
    handleUnavailableAction,
    hasStreamingAssistant,
    isExecuting,
    loadModels,
    messagesError: normalizedMessagesError,
    messagesLoading,
    modelOptions,
    modelsLoading,
    queuedContinuations,
    runtimePermissionActionId,
    runtimePermissionLabel,
    runtimePermissionPath,
    runtimePermissionPatterns,
    selectedSessionId,
    selectedSessionRuntimePermissions,
    setExecutionModeModalOpen,
    showExecutionModeModal,
    task,
    taskDisplayStatus,
    taskFailureReason,
    terminating,
    workflowStages,
    workflowSummary,
  });

  const sidebar = useTaskDetailSidebarModel({
    collapsed: sidebarCollapsed,
    handleCloseFilePreview,
    memberView,
    memberViewLoading,
    previewFile,
    selectedSessionId,
    taskId: sidebarTaskId,
    toggleSidebar,
    traceRefreshKey,
  });

  return {
    header,
    layout,
    main,
    sidebar,
  };
}

export type TaskDetailPageModelState = UnwrapNestedRefs<ReturnType<typeof useTaskDetailPageModel>>;