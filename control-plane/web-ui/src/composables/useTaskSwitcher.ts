import { type Ref, computed, ref, watch } from "vue";
import { type Task, listTasks } from "../lib/api";

export interface TaskSwitcherOption {
  value: string;
  label: string;
  status: string;
}

export function useTaskSwitcher(projectId: Ref<string | undefined>, currentTaskId: Ref<string>) {
  const tasks = ref<Task[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function refresh() {
    if (!projectId.value) {
      tasks.value = [];
      error.value = null;
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const response = await listTasks(projectId.value);
      tasks.value = Array.isArray(response.data) ? response.data : [];
    } catch (nextError) {
      tasks.value = [];
      error.value = nextError instanceof Error ? nextError.message : "加载任务列表失败";
    } finally {
      loading.value = false;
    }
  }

  const options = computed<TaskSwitcherOption[]>(() => {
    const mapped = tasks.value.map((task) => ({
      value: task.id,
      label: task.id === currentTaskId.value ? `${task.title}（当前）` : task.title,
      status: task.status,
    }));

    return mapped;
  });

  watch(
    projectId,
    () => {
      void refresh();
    },
    { immediate: true },
  );

  return {
    tasks,
    options,
    loading,
    error,
    refresh,
  };
}
