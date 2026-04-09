import { message } from "ant-design-vue";
import { computed, ref, type Ref } from "vue";
import { getModelsList, updateTask, type ExecutionMode } from "../lib/api";
import {
  DEFAULT_JUDGE_CONFIG,
  type ExecutionOverrides,
  buildExecutionModeTaskUpdate,
} from "../lib/taskExecutionMode";
import type { TreeTask } from "./useProjectTreeTask";

export function useTaskDetailExecutionModeCoordinator(args: {
  taskId: Ref<string>;
  task: Ref<TreeTask | null | undefined>;
  editableExecutionMode: Ref<ExecutionMode>;
  refreshTask: (silent?: boolean) => void | Promise<void>;
}) {
  const modelsData = ref<Array<Record<string, unknown>>>([]);
  const modelsLoading = ref(false);
  const showExecutionModeModal = ref(false);
  const executionModeSaving = ref(false);

  const modelOptions = computed(() => {
    const options = modelsData.value
      .map((model) => {
        const id = typeof model.id === "string" ? model.id : "";
        if (!id) return null;
        const name = typeof model.name === "string" ? model.name : "";
        const provider = typeof model.provider === "string" ? model.provider : "";
        const meta = [name, provider].filter(Boolean).join(" / ");
        return { value: id, label: meta ? `${id} (${meta})` : id };
      })
      .filter((item): item is { value: string; label: string } => Boolean(item));

    const currentModel = args.task.value?.selectedModel?.trim();
    if (currentModel && !options.some((option) => option.value === currentModel)) {
      options.unshift({ value: currentModel, label: `${currentModel} (当前值)` });
    }
    return options;
  });

  async function loadModels() {
    if (modelsLoading.value) return;
    modelsLoading.value = true;
    try {
      const response = await getModelsList();
      modelsData.value = Array.isArray(response.data) ? response.data : [];
    } catch {
      modelsData.value = [];
    } finally {
      modelsLoading.value = false;
    }
  }

  function filterModelOption(input: string, option?: unknown) {
    const keyword = input.toLowerCase();
    const normalized = option as
      | { value?: string | number | null; label?: string | number | null }
      | undefined;
    return (
      String(normalized?.value ?? "")
        .toLowerCase()
        .includes(keyword) ||
      String(normalized?.label ?? "")
        .toLowerCase()
        .includes(keyword)
    );
  }

  async function handleSelectedModelChange(model: string) {
    if (!args.task.value || !args.taskId.value) return;
    const nextModel = model.trim() || null;
    try {
      await updateTask(args.taskId.value, { selectedModel: nextModel });
      args.task.value = { ...args.task.value, selectedModel: nextModel };
      message.success("已更新模型");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "更新模型失败");
    }
  }

  function handleChooseMode() {
    void loadModels();
    showExecutionModeModal.value = true;
  }

  async function handleExecutionModeConfirm(overrides: ExecutionOverrides) {
    if (!args.taskId.value || !args.task.value) return;
    executionModeSaving.value = true;
    try {
      await updateTask(args.taskId.value, buildExecutionModeTaskUpdate(args.task.value, overrides));
      showExecutionModeModal.value = false;
      const executionMode = overrides?.mode ?? "single";
      const judgeEnabled =
        executionMode === "parallel" && (overrides?.judge ?? DEFAULT_JUDGE_CONFIG).enabled;
      message.success(
        judgeEnabled
          ? "执行模式与并行 Judge 配置已保存"
          : "执行模式已保存，下一次发送消息时生效",
      );
      await args.refreshTask(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存执行模式失败");
    } finally {
      executionModeSaving.value = false;
    }
  }

  return {
    executionModeSaving,
    filterModelOption,
    handleChooseMode,
    handleExecutionModeConfirm,
    handleSelectedModelChange,
    loadModels,
    modelOptions,
    modelsLoading,
    showExecutionModeModal,
  };
}