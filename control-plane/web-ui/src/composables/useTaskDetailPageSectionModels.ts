import type { Ref, UnwrapNestedRefs } from "vue";
import type {
  ChainStepInput,
  ExecutionMode,
  JudgeConfig,
  ProjectTreeNodeRecord,
  TaskMemberViewModel,
  TaskRuntimePermission,
  TaskStageViewModel,
} from "../lib/api";
import type { TaskDisplayStatus } from "../lib/task-display-status";
import type { ExecutionOverrides } from "../lib/taskExecutionMode";
import type { TreeTask } from "./useProjectTreeTask";
import type { TaskConversationListItem } from "./useTreeMessages";

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
  canForkFromCurrentSession: ReadonlyRef<boolean>;
  canTerminateExecution: ReadonlyRef<boolean>;
  chatTraceWarning: ReadonlyRef<RuntimeTraceWarning | null>;
  composerResetToken: Ref<number>;
  continuing: Ref<boolean>;
  conversationFocusToken: Ref<number>;
  conversationItems: ReadonlyRef<TaskConversationListItem[]>;
  editableExecutionMode: ReadonlyRef<ExecutionMode>;
  editableJudgeConfig: ReadonlyRef<JudgeConfig>;
  editableParallelCandidates: ReadonlyRef<Array<{ label?: string; model: string }>>;
  editableSequentialSteps: ReadonlyRef<ChainStepInput[]>;
  executionModeSaving: Ref<boolean>;
  filterModelOption: (input: string, option?: unknown) => boolean;
  forking: Ref<boolean>;
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
  handleUnavailableAction: (label: string) => () => void;
  hasStreamingAssistant: ReadonlyRef<boolean>;
  isExecuting: ReadonlyRef<boolean>;
  loadModels: () => void | Promise<void>;
  messagesError: ReadonlyRef<string | null>;
  messagesLoading: ReadonlyRef<boolean>;
  modelOptions: ReadonlyRef<ModelOption[]>;
  modelsLoading: Ref<boolean>;
  queuedContinuations: Ref<QueuedContinuationItem[]>;
  runtimePermissionActionId: Ref<string | null>;
  runtimePermissionLabel: (permission: string) => string;
  runtimePermissionPath: (permission: TaskRuntimePermission) => string;
  runtimePermissionPatterns: (permission: TaskRuntimePermission) => string[];
  selectedSessionId: Ref<string | undefined>;
  selectedSessionRuntimePermissions: ReadonlyRef<TaskRuntimePermission[]>;
  setExecutionModeModalOpen: (open: boolean) => void;
  showExecutionModeModal: Ref<boolean>;
  task: Ref<TreeTask | null | undefined>;
  taskDisplayStatus: ReadonlyRef<TaskDisplayStatus>;
  taskFailureReason: ReadonlyRef<string>;
  terminating: Ref<boolean>;
  workflowStages: ReadonlyRef<TaskStageViewModel[]>;
  workflowSummary: ReadonlyRef<{ currentStage: string; status: string } | null>;
}) {
  return {
    assistantMessageModelFallback: args.assistantMessageModelFallback,
    canForkFromCurrentSession: args.canForkFromCurrentSession,
    canTerminateExecution: args.canTerminateExecution,
    chatTraceWarning: args.chatTraceWarning,
    composerResetToken: args.composerResetToken,
    continuing: args.continuing,
    conversationFocusToken: args.conversationFocusToken,
    conversationItems: args.conversationItems,
    editableExecutionMode: args.editableExecutionMode,
    editableJudgeConfig: args.editableJudgeConfig,
    editableParallelCandidates: args.editableParallelCandidates,
    editableSequentialSteps: args.editableSequentialSteps,
    executionModeSaving: args.executionModeSaving,
    filterModelOption: args.filterModelOption,
    forking: args.forking,
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
    handleUnavailableAction: args.handleUnavailableAction,
    hasStreamingAssistant: args.hasStreamingAssistant,
    isExecuting: args.isExecuting,
    loadModels: args.loadModels,
    messagesError: args.messagesError,
    messagesLoading: args.messagesLoading,
    modelOptions: args.modelOptions,
    modelsLoading: args.modelsLoading,
    queuedContinuations: args.queuedContinuations,
    runtimePermissionActionId: args.runtimePermissionActionId,
    runtimePermissionLabel: args.runtimePermissionLabel,
    runtimePermissionPath: args.runtimePermissionPath,
    runtimePermissionPatterns: args.runtimePermissionPatterns,
    selectedSessionId: args.selectedSessionId,
    selectedSessionRuntimePermissions: args.selectedSessionRuntimePermissions,
    setExecutionModeModalOpen: args.setExecutionModeModalOpen,
    showExecutionModeModal: args.showExecutionModeModal,
    task: args.task,
    taskDisplayStatus: args.taskDisplayStatus,
    taskFailureReason: args.taskFailureReason,
    terminating: args.terminating,
    workflowStages: args.workflowStages,
    workflowSummary: args.workflowSummary,
  };
}

export function useTaskDetailSidebarModel(args: {
  collapsed: Ref<boolean>;
  handleCloseFilePreview: () => void;
  memberView: Ref<TaskMemberViewModel | null>;
  memberViewLoading: Ref<boolean>;
  previewFile: Ref<PreviewFilePayload | null>;
  selectedSessionId: Ref<string | undefined>;
  taskId: ReadonlyRef<string>;
  toggleSidebar: () => void;
  traceRefreshKey: Ref<number>;
}) {
  return {
    collapsed: args.collapsed,
    handleCloseFilePreview: args.handleCloseFilePreview,
    memberView: args.memberView,
    memberViewLoading: args.memberViewLoading,
    previewFile: args.previewFile,
    selectedSessionId: args.selectedSessionId,
    taskId: args.taskId,
    toggleSidebar: args.toggleSidebar,
    traceRefreshKey: args.traceRefreshKey,
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
export type TaskDetailSidebarModelState = UnwrapNestedRefs<
  ReturnType<typeof useTaskDetailSidebarModel>
>;