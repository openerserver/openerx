import type { Ref, UnwrapNestedRefs } from "vue";
import type {
  ChainStepInput,
  ExecutionMode,
  JudgeConfig,
  ProjectTreeNodeRecord,
  TaskRuntimePermission,
  TaskStageViewModel,
} from "../lib/api";
import type { TaskConversationListItem } from "../lib/message-normalize";
import type { TaskDisplayStatus } from "../lib/task-display-status";
import type { ExecutionOverrides } from "../lib/taskExecutionMode";
import type { TreeTask } from "./useProjectTreeTask";

type ReadonlyRef<T> = Readonly<Ref<T>>;

type PreviewFilePayload = {
  filePath: string;
  content?: string;
};

type RuntimeTraceWarning = {
  message: string;
  description: string;
};

type QueuedContinuationItem = {
  id: string;
  prompt: string;
  sessionId?: string;
  queuedAt: string;
};

type ModelOption = {
  label: string;
  value: string;
};

export function useTaskDetailLayoutModel(args: {
  pageLoading: ReadonlyRef<boolean>;
  loadError: ReadonlyRef<string>;
}) {
  return {
    loadError: args.loadError,
    pageLoading: args.pageLoading,
  };
}

export function useTaskDetailHeaderModel(args: {
  ancestors: ReadonlyRef<ProjectTreeNodeRecord[]>;
  currentStageLabel: ReadonlyRef<string>;
  projectId: ReadonlyRef<string>;
  task: Ref<TreeTask | null | undefined>;
  taskDisplayStatus: ReadonlyRef<TaskDisplayStatus>;
  handleTaskSwitch: (taskId: string) => void | Promise<void>;
}) {
  return {
    ancestors: args.ancestors,
    currentStageLabel: args.currentStageLabel,
    handleTaskSwitch: args.handleTaskSwitch,
    projectId: args.projectId,
    task: args.task,
    taskDisplayStatus: args.taskDisplayStatus,
  };
}

export function useTaskDetailMainPaneModel(args: {
  assistantMessageModelFallback: ReadonlyRef<string | undefined>;
  autoAdvanceEnabled: ReadonlyRef<boolean>;
  canTerminateExecution: ReadonlyRef<boolean>;
  chatTraceWarning: ReadonlyRef<RuntimeTraceWarning | null>;
  composerActionDisabled: ReadonlyRef<boolean>;
  composerInputDisabled: ReadonlyRef<boolean>;
  composerResetToken: Ref<number>;
  conversationFocusToken: Ref<number>;
  conversationItems: ReadonlyRef<TaskConversationListItem[]>;
  editableExecutionMode: ReadonlyRef<ExecutionMode>;
  editableJudgeConfig: ReadonlyRef<JudgeConfig>;
  editableParallelCandidates: ReadonlyRef<Array<{ label?: string; model: string }>>;
  editableSequentialSteps: ReadonlyRef<ChainStepInput[]>;
  executionModeSaving: Ref<boolean>;
  filterModelOption: (input: string, option?: unknown) => boolean;
  forkDisabled: ReadonlyRef<boolean>;
  handleAdoptCandidate: (index: number) => void | Promise<void>;
  handleChooseMode: () => void;
  handleClearQueuedContinuations: () => void;
  handleContinue: (prompt: string) => void | Promise<void>;
  handleExecutionModeConfirm: (overrides: ExecutionOverrides) => void | Promise<void>;
  handleFork: (prompt: string) => void | Promise<void>;
  handleOpenFilePreview: (payload: PreviewFilePayload) => void;
  handleRemoveQueuedContinuation: (id: string) => void;
  handleReplyRuntimePermission: (
    permission: TaskRuntimePermission,
    decision: "once" | "always" | "reject",
  ) => void | Promise<void>;
  handleSelectedModelChange: (model: string) => void | Promise<void>;
  handleTerminate: () => void | Promise<void>;
  hasStreamingAssistant: ReadonlyRef<boolean>;
  isExecuting: ReadonlyRef<boolean>;
  loadModels: () => void | Promise<void>;
  messagesError: ReadonlyRef<string | null>;
  messagesLoading: ReadonlyRef<boolean>;
  modelOptions: ReadonlyRef<ModelOption[]>;
  modelSelectionDisabled: ReadonlyRef<boolean>;
  modelsLoading: Ref<boolean>;
  queueCount: ReadonlyRef<number>;
  queuedItems: ReadonlyRef<Array<Pick<QueuedContinuationItem, "id" | "prompt">>>;
  runtimePermissionActionId: Ref<string | null>;
  runtimePermissionLabel: (permission: string) => string;
  runtimePermissionPath: (permission: TaskRuntimePermission) => string;
  runtimePermissionPatterns: (permission: TaskRuntimePermission) => string[];
  selectedModel: ReadonlyRef<string | undefined>;
  selectedSessionId: Ref<string | undefined>;
  selectedSessionRuntimePermissions: ReadonlyRef<TaskRuntimePermission[]>;
  setExecutionModeModalOpen: (open: boolean) => void;
  showExecutionModeModal: Ref<boolean>;
  taskFailureReason: ReadonlyRef<string>;
  workflowStages: ReadonlyRef<TaskStageViewModel[]>;
  workflowSummary: ReadonlyRef<{ currentStage: string; status: string } | null>;
}) {
  return {
    assistantMessageModelFallback: args.assistantMessageModelFallback,
    autoAdvanceEnabled: args.autoAdvanceEnabled,
    canTerminateExecution: args.canTerminateExecution,
    chatTraceWarning: args.chatTraceWarning,
    composerActionDisabled: args.composerActionDisabled,
    composerInputDisabled: args.composerInputDisabled,
    composerResetToken: args.composerResetToken,
    conversationFocusToken: args.conversationFocusToken,
    conversationItems: args.conversationItems,
    editableExecutionMode: args.editableExecutionMode,
    editableJudgeConfig: args.editableJudgeConfig,
    editableParallelCandidates: args.editableParallelCandidates,
    editableSequentialSteps: args.editableSequentialSteps,
    executionModeSaving: args.executionModeSaving,
    filterModelOption: args.filterModelOption,
    forkDisabled: args.forkDisabled,
    handleAdoptCandidate: args.handleAdoptCandidate,
    handleChooseMode: args.handleChooseMode,
    handleClearQueuedContinuations: args.handleClearQueuedContinuations,
    handleContinue: args.handleContinue,
    handleExecutionModeConfirm: args.handleExecutionModeConfirm,
    handleFork: args.handleFork,
    handleOpenFilePreview: args.handleOpenFilePreview,
    handleRemoveQueuedContinuation: args.handleRemoveQueuedContinuation,
    handleReplyRuntimePermission: args.handleReplyRuntimePermission,
    handleSelectedModelChange: args.handleSelectedModelChange,
    handleTerminate: args.handleTerminate,
    hasStreamingAssistant: args.hasStreamingAssistant,
    isExecuting: args.isExecuting,
    loadModels: args.loadModels,
    messagesError: args.messagesError,
    messagesLoading: args.messagesLoading,
    modelOptions: args.modelOptions,
    modelSelectionDisabled: args.modelSelectionDisabled,
    modelsLoading: args.modelsLoading,
    queueCount: args.queueCount,
    queuedItems: args.queuedItems,
    runtimePermissionActionId: args.runtimePermissionActionId,
    runtimePermissionLabel: args.runtimePermissionLabel,
    runtimePermissionPath: args.runtimePermissionPath,
    runtimePermissionPatterns: args.runtimePermissionPatterns,
    selectedModel: args.selectedModel,
    selectedSessionId: args.selectedSessionId,
    selectedSessionRuntimePermissions: args.selectedSessionRuntimePermissions,
    setExecutionModeModalOpen: args.setExecutionModeModalOpen,
    showExecutionModeModal: args.showExecutionModeModal,
    taskFailureReason: args.taskFailureReason,
    workflowStages: args.workflowStages,
    workflowSummary: args.workflowSummary,
  };
}

export type TaskDetailLayoutModelState = UnwrapNestedRefs<
  ReturnType<typeof useTaskDetailLayoutModel>
>;
export type TaskDetailHeaderModelState = UnwrapNestedRefs<
  ReturnType<typeof useTaskDetailHeaderModel>
>;
export type TaskDetailMainPaneModelState = UnwrapNestedRefs<
  ReturnType<typeof useTaskDetailMainPaneModel>
>;