import { type Ref, computed, ref, watch } from "vue";
import {
  type ProjectTreeNodeRecord,
  type Task,
  getProjectTreeAncestors,
  getProjectTreeNode,
  getTask,
  toApiError,
} from "../lib/api";

export interface TreeTask extends Task {
  nodeId: string;
}

export const MISSING_TASK_LOAD_ERROR =
  "当前任务不存在。当前 UI 指向的 app 数据库实例中找不到这个任务，可能是历史标签仍指向旧数据库实例。请切换到正确的数据库实例，或关闭这个 Workbench 标签。";

function normalizeTaskRecord(task: Task, taskNode?: ProjectTreeNodeRecord | null): TreeTask {
  return {
    ...task,
    nodeId: taskNode?.id ?? task.id,
  };
}

/**
 * Loads task business data from the BFF task read model and tree records only
 * for breadcrumb and navigation affordances.
 */
export function useProjectTreeTask(taskId: Ref<string>) {
  const task = ref<TreeTask | null>(null);
  const node = ref<ProjectTreeNodeRecord | null>(null);
  const ancestors = ref<ProjectTreeNodeRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let refreshGeneration = 0;

  const projectId = computed(() => task.value?.projectId ?? "");

  async function refresh(silent = false) {
    const currentRefreshGeneration = ++refreshGeneration;
    const currentTaskId = taskId.value;

    if (!currentTaskId) {
      task.value = null;
      node.value = null;
      ancestors.value = [];
      error.value = null;
      return;
    }

    if (!silent) {
      loading.value = true;
    }
    error.value = null;

    try {
      const bffTask = await getTask(currentTaskId);
      const pid = bffTask.projectId;

      const [treeNode, ancestorNodes] = await Promise.all([
        getProjectTreeNode(pid, currentTaskId).catch(() => null),
        getProjectTreeAncestors(pid, currentTaskId).catch(() => []),
      ]);

      if (currentRefreshGeneration !== refreshGeneration || taskId.value !== currentTaskId) {
        return;
      }

      task.value = normalizeTaskRecord(bffTask, treeNode);
      node.value = treeNode;
      ancestors.value = ancestorNodes;
    } catch (nextError) {
      if (currentRefreshGeneration !== refreshGeneration || taskId.value !== currentTaskId) {
        return;
      }

      task.value = null;
      node.value = null;
      ancestors.value = [];
      const apiError = toApiError(nextError);
      const missingTask =
        apiError?.status === 404 ||
        apiError?.code === "TASK_NOT_FOUND" ||
        (nextError instanceof Error && /task not found/iu.test(nextError.message));
      error.value = missingTask
        ? MISSING_TASK_LOAD_ERROR
        : nextError instanceof Error
          ? nextError.message
          : "加载任务详情失败";
    } finally {
      if (!silent && currentRefreshGeneration === refreshGeneration) {
        loading.value = false;
      }
    }
  }

  /** Patch local task state optimistically. */
  function patchLocal(patch: Partial<TreeTask>) {
    if (task.value) {
      task.value = { ...task.value, ...patch };
    }
  }

  watch(
    taskId,
    () => {
      void refresh();
    },
    { immediate: true },
  );

  return {
    task,
    node,
    ancestors,
    projectId,
    loading,
    error,
    refresh,
    patchLocal,
  };
}
