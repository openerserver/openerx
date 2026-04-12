import { computed, ref, type Ref, watch } from "vue";
import {
  listTaskRuntimePermissions,
  type TaskExecutionTrace,
  type TaskRuntimePermission,
  type TaskSessionRecord,
} from "../lib/api";
import type { TreeTask } from "./useProjectTreeTask";
import type { TreeSessionNodeRecord } from "./useTreeBranches";

type PreviewFilePayload = { filePath: string; content?: string };

export function useTaskDetailViewStateCoordinator(args: {
  taskId: Ref<string>;
  task: Ref<TreeTask | null | undefined>;
  taskSessionSummaries: Ref<TaskSessionRecord[]>;
  selectedSessionId: Ref<string | undefined>;
  selectedSessionNode: Ref<TreeSessionNodeRecord | null | undefined>;
  messageTrace: Ref<TaskExecutionTrace | null | undefined>;
}) {
  const sidebarCollapsed = ref(true);
  const previewFile = ref<PreviewFilePayload | null>(null);
  const runtimePermissions = ref<TaskRuntimePermission[]>([]);
  let runtimePermissionsRefreshGeneration = 0;

  const chatTraceWarning = computed(() => {
    const cacheState = args.messageTrace.value?.timelineMeta?.cacheState;
    if (!cacheState || cacheState === "complete") {
      return null;
    }

    if (cacheState === "partial") {
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

  const selectedSessionRuntimePermissions = computed(() => {
    const sessionId = args.selectedSessionId.value;
    if (!sessionId) return [];
    return runtimePermissions.value.filter((item) => item.sessionId === sessionId);
  });

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

  async function refreshRuntimePermissions(silent = false) {
    const currentRefreshGeneration = ++runtimePermissionsRefreshGeneration;
    const currentTaskId = args.taskId.value;
    const currentSessionId = args.selectedSessionId.value;

    if (
      !currentTaskId ||
      !currentSessionId ||
      args.task.value?.id !== currentTaskId
    ) {
      runtimePermissions.value = [];
      return;
    }

    try {
      const response = await listTaskRuntimePermissions(currentTaskId, currentSessionId);
      if (
        currentRefreshGeneration !== runtimePermissionsRefreshGeneration ||
        args.taskId.value !== currentTaskId ||
        args.selectedSessionId.value !== currentSessionId
      ) {
        return;
      }

      runtimePermissions.value = Array.isArray(response.data) ? response.data : [];
    } catch {
      if (
        currentRefreshGeneration !== runtimePermissionsRefreshGeneration ||
        args.taskId.value !== currentTaskId ||
        args.selectedSessionId.value !== currentSessionId
      ) {
        return;
      }

      runtimePermissions.value = [];
      if (!silent) {
        throw new Error("加载运行时审批失败");
      }
    }
  }

  function handleOpenFilePreview(payload: PreviewFilePayload) {
    previewFile.value = payload;
    sidebarCollapsed.value = false;
  }

  function handleCloseFilePreview() {
    previewFile.value = null;
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function runtimePermissionLabel(permission: string) {
    if (permission === "external_directory") return "外部目录访问";
    if (permission === "command_execution") return "命令执行";
    return permission || "运行时审批";
  }

  function runtimePermissionPath(permission: TaskRuntimePermission) {
    const metadata = permission.metadata as Record<string, unknown> | null;
    const filepath = metadata?.filepath;
    const parentDir = metadata?.parentDir;
    const command = metadata?.command;
    if (typeof filepath === "string" && filepath.trim()) return filepath.trim();
    if (typeof parentDir === "string" && parentDir.trim()) return parentDir.trim();
    if (typeof command === "string" && command.trim()) return command.trim();
    return "";
  }

  function runtimePermissionPatterns(permission: TaskRuntimePermission) {
    return Array.isArray(permission.patterns) ? permission.patterns.filter(Boolean) : [];
  }

  watch(
    args.taskId,
    () => {
      previewFile.value = null;
      runtimePermissions.value = [];
    },
    { immediate: false },
  );

  watch(args.selectedSessionId, () => {
    void refreshRuntimePermissions(true);
  });

  return {
    assistantMessageModelFallback,
    chatTraceWarning,
    handleCloseFilePreview,
    handleOpenFilePreview,
    previewFile,
    refreshRuntimePermissions,
    runtimePermissionLabel,
    runtimePermissionPath,
    runtimePermissionPatterns,
    runtimePermissions,
    selectedSessionLabel,
    selectedSessionRuntimePermissions,
    sidebarCollapsed,
    toggleSidebar,
  };
}