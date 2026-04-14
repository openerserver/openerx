import { computed, ref, type Ref, watch } from "vue";
import { listTaskRuntimePermissions, type TaskRuntimePermission } from "../lib/api";
import type { TreeTask } from "./useProjectTreeTask";

export function useTaskRuntimePermissionView(args: {
  taskId: Ref<string>;
  task: Ref<TreeTask | null | undefined>;
  selectedSessionId: Ref<string | undefined>;
}) {
  const runtimePermissions = ref<TaskRuntimePermission[]>([]);
  let runtimePermissionsRefreshGeneration = 0;
  const effectiveSessionId = computed(
    () => args.selectedSessionId.value ?? args.task.value?.sessionId ?? undefined,
  );

  const selectedSessionRuntimePermissions = computed(() => {
    const sessionId = effectiveSessionId.value;
    if (!sessionId) return [];
    return runtimePermissions.value.filter((item) => item.sessionId === sessionId);
  });

  async function refreshRuntimePermissions(silent = false) {
    const currentRefreshGeneration = ++runtimePermissionsRefreshGeneration;
    const currentTaskId = args.taskId.value;
    const currentSessionId = effectiveSessionId.value;

    if (!currentTaskId || !currentSessionId || args.task.value?.id !== currentTaskId) {
      runtimePermissions.value = [];
      return;
    }

    try {
      const response = await listTaskRuntimePermissions(currentTaskId, currentSessionId);
      if (
        currentRefreshGeneration !== runtimePermissionsRefreshGeneration ||
        args.taskId.value !== currentTaskId ||
        effectiveSessionId.value !== currentSessionId
      ) {
        return;
      }

      runtimePermissions.value = Array.isArray(response.data) ? response.data : [];
    } catch {
      if (
        currentRefreshGeneration !== runtimePermissionsRefreshGeneration ||
        args.taskId.value !== currentTaskId ||
        effectiveSessionId.value !== currentSessionId
      ) {
        return;
      }

      runtimePermissions.value = [];
      if (!silent) {
        throw new Error("加载运行时审批失败");
      }
    }
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
      runtimePermissions.value = [];
    },
    { immediate: false },
  );

  watch(args.selectedSessionId, () => {
    void refreshRuntimePermissions(true);
  });

  watch(
    () => args.task.value?.sessionId,
    () => {
      void refreshRuntimePermissions(true);
    },
  );

  return {
    refreshRuntimePermissions,
    runtimePermissionLabel,
    runtimePermissionPath,
    runtimePermissionPatterns,
    runtimePermissions,
    selectedSessionRuntimePermissions,
  };
}