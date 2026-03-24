import { type Ref, computed, ref, watch } from "vue";
import {
  type ProjectTreeNodeRecord,
  type Task,
  getProjectTreeAncestors,
  getProjectTreeNode,
  getTask,
} from "../lib/api";

export interface TreeTask extends Task {
  nodeId: string;
}

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

  const projectId = computed(() => task.value?.projectId ?? "");

  async function refresh(silent = false) {
    if (!taskId.value) {
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
      const bffTask = await getTask(taskId.value);
      const pid = bffTask.projectId;

      const [treeNode, ancestorNodes] = await Promise.all([
        getProjectTreeNode(pid, taskId.value).catch(() => null),
        getProjectTreeAncestors(pid, taskId.value).catch(() => []),
      ]);

      task.value = normalizeTaskRecord(bffTask, treeNode);
      node.value = treeNode;
      ancestors.value = ancestorNodes;
    } catch (nextError) {
      task.value = null;
      node.value = null;
      ancestors.value = [];
      error.value = nextError instanceof Error ? nextError.message : "加载任务详情失败";
    } finally {
      if (!silent) {
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
