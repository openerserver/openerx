import { computed, type Ref } from "vue";
import { useTaskDetailMainPaneModel } from "./useTaskDetailPageSectionModels";
import type { TreeTask } from "./useProjectTreeTask";

type MainPaneModelArgs = Parameters<typeof useTaskDetailMainPaneModel>[0];

type QueuedContinuationItem = {
  id: string;
  prompt: string;
  sessionId?: string;
  queuedAt: string;
};

export function useTaskDetailMainPaneFeature(args: {
  compare: Pick<MainPaneModelArgs, "canTerminateExecution" | "conversationItems" | "handleAdoptCandidate">;
  conversation: Pick<
    MainPaneModelArgs,
    | "assistantMessageModelFallback"
    | "chatTraceWarning"
    | "composerResetToken"
    | "conversationFocusToken"
    | "handleClearQueuedContinuations"
    | "handleContinue"
    | "handleFork"
    | "handleRemoveQueuedContinuation"
    | "handleTerminate"
  > & {
    canForkFromCurrentSession: Ref<boolean>;
    continuing: Ref<boolean>;
    forking: Ref<boolean>;
    queuedContinuations: Ref<QueuedContinuationItem[]>;
    terminating: Ref<boolean>;
  };
  messages: {
    messagesError: Ref<string | null | undefined>;
    messagesLoading: MainPaneModelArgs["messagesLoading"];
    selectedSessionId: MainPaneModelArgs["selectedSessionId"];
  };
  page: {
    hasStreamingAssistant: MainPaneModelArgs["hasStreamingAssistant"];
    isExecuting: MainPaneModelArgs["isExecuting"];
    task: Ref<TreeTask | null | undefined>;
    taskFailureReason: MainPaneModelArgs["taskFailureReason"];
  };
  runtimePermission: Pick<
    MainPaneModelArgs,
    | "handleReplyRuntimePermission"
    | "runtimePermissionActionId"
    | "runtimePermissionLabel"
    | "runtimePermissionPath"
    | "runtimePermissionPatterns"
    | "selectedSessionRuntimePermissions"
  >;
  sidebar: Pick<MainPaneModelArgs, "handleOpenFilePreview">;
  workflow: Pick<
    MainPaneModelArgs,
    | "editableExecutionMode"
    | "editableJudgeConfig"
    | "editableParallelCandidates"
    | "editableSequentialSteps"
    | "executionModeSaving"
    | "filterModelOption"
    | "handleChooseMode"
    | "handleExecutionModeConfirm"
    | "handleSelectedModelChange"
    | "loadModels"
    | "modelOptions"
    | "modelsLoading"
    | "setExecutionModeModalOpen"
    | "showExecutionModeModal"
    | "workflowStages"
    | "workflowSummary"
  >;
}) {
  const composerBusy = computed(
    () =>
      args.conversation.continuing.value ||
      args.conversation.forking.value ||
      args.conversation.terminating.value,
  );
  const forkDisabled = computed(
    () =>
      args.conversation.continuing.value ||
      args.conversation.forking.value ||
      args.page.isExecuting.value ||
      !args.conversation.canForkFromCurrentSession.value,
  );
  const modelSelectionDisabled = computed(
    () =>
      args.conversation.continuing.value ||
      args.conversation.forking.value ||
      args.page.isExecuting.value,
  );
  const normalizedMessagesError = computed(() => args.messages.messagesError.value ?? null);
  const queuedItems = computed(() =>
    args.conversation.queuedContinuations.value.map((item) => ({
      id: item.id,
      prompt: item.prompt,
    })),
  );
  const queueCount = computed(() => args.conversation.queuedContinuations.value.length);
  const selectedModel = computed(() => args.page.task.value?.selectedModel ?? undefined);
  const autoAdvanceEnabled = computed(() => Boolean(args.page.task.value?.autoAdvanceStages));

  return useTaskDetailMainPaneModel({
    assistantMessageModelFallback: args.conversation.assistantMessageModelFallback,
    autoAdvanceEnabled,
    canTerminateExecution: args.compare.canTerminateExecution,
    chatTraceWarning: args.conversation.chatTraceWarning,
    composerActionDisabled: composerBusy,
    composerInputDisabled: composerBusy,
    composerResetToken: args.conversation.composerResetToken,
    conversationFocusToken: args.conversation.conversationFocusToken,
    conversationItems: args.compare.conversationItems,
    editableExecutionMode: args.workflow.editableExecutionMode,
    editableJudgeConfig: args.workflow.editableJudgeConfig,
    editableParallelCandidates: args.workflow.editableParallelCandidates,
    editableSequentialSteps: args.workflow.editableSequentialSteps,
    executionModeSaving: args.workflow.executionModeSaving,
    filterModelOption: args.workflow.filterModelOption,
    forkDisabled,
    handleAdoptCandidate: args.compare.handleAdoptCandidate,
    handleChooseMode: args.workflow.handleChooseMode,
    handleClearQueuedContinuations: args.conversation.handleClearQueuedContinuations,
    handleContinue: args.conversation.handleContinue,
    handleExecutionModeConfirm: args.workflow.handleExecutionModeConfirm,
    handleFork: args.conversation.handleFork,
    handleOpenFilePreview: args.sidebar.handleOpenFilePreview,
    handleRemoveQueuedContinuation: args.conversation.handleRemoveQueuedContinuation,
    handleReplyRuntimePermission: args.runtimePermission.handleReplyRuntimePermission,
    handleSelectedModelChange: args.workflow.handleSelectedModelChange,
    handleTerminate: args.conversation.handleTerminate,
    hasStreamingAssistant: args.page.hasStreamingAssistant,
    isExecuting: args.page.isExecuting,
    loadModels: args.workflow.loadModels,
    messagesError: normalizedMessagesError,
    messagesLoading: args.messages.messagesLoading,
    modelOptions: args.workflow.modelOptions,
    modelSelectionDisabled,
    modelsLoading: args.workflow.modelsLoading,
    queueCount,
    queuedItems,
    runtimePermissionActionId: args.runtimePermission.runtimePermissionActionId,
    runtimePermissionLabel: args.runtimePermission.runtimePermissionLabel,
    runtimePermissionPath: args.runtimePermission.runtimePermissionPath,
    runtimePermissionPatterns: args.runtimePermission.runtimePermissionPatterns,
    selectedModel,
    selectedSessionId: args.messages.selectedSessionId,
    selectedSessionRuntimePermissions: args.runtimePermission.selectedSessionRuntimePermissions,
    setExecutionModeModalOpen: args.workflow.setExecutionModeModalOpen,
    showExecutionModeModal: args.workflow.showExecutionModeModal,
    taskFailureReason: args.page.taskFailureReason,
    workflowStages: args.workflow.workflowStages,
    workflowSummary: args.workflow.workflowSummary,
  });
}