<template>
  <div style="padding: 24px">
    <a-page-header
      :title="task ? `${task.title} / 任务级覆盖` : '任务级覆盖'"
      sub-title="为当前任务单独指定协作模式、托管等级和模板偏好"
      @back="router.push(`/tasks/${taskId}/operating-console`)"
    />

    <a-spin :spinning="loading" style="display: block">
      <a-alert v-if="loadError" type="error" show-icon style="margin-bottom: 16px" :message="loadError" />

      <template v-else-if="task">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :xl="8">
            <a-card title="当前生效档位" size="small">
              <a-descriptions :column="1" bordered size="small">
                <a-descriptions-item label="协作模式">{{ currentState.collaborationMode || '未记录' }}</a-descriptions-item>
                <a-descriptions-item label="自动托管">{{ currentState.autopilotLevel || '未记录' }}</a-descriptions-item>
                <a-descriptions-item label="管理介入">{{ currentState.bossParticipationMode || '未记录' }}</a-descriptions-item>
                <a-descriptions-item label="来源">{{ currentState.operatingModeSource || '未记录' }}</a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>

          <a-col :xs="24" :xl="16">
            <a-card title="任务级覆盖表单" size="small">
              <a-form layout="vertical">
                <a-row :gutter="16">
                  <a-col :xs="24" :md="8">
                    <a-form-item label="协作模式">
                      <a-select :value="form.collaborationMode" :options="collaborationOptions" @update:value="form.collaborationMode = asCollaborationMode($event)" />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="8">
                    <a-form-item label="自动托管等级">
                      <a-select :value="form.autopilotLevel" :options="autopilotOptions" @update:value="form.autopilotLevel = asAutopilotLevel($event)" />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="8">
                    <a-form-item label="管理介入方式">
                      <a-select :value="form.bossParticipationMode" :options="bossModeOptions" @update:value="form.bossParticipationMode = asBossMode($event)" />
                    </a-form-item>
                  </a-col>
                </a-row>

                <a-row :gutter="16">
                  <a-col :xs="24" :md="12">
                    <a-form-item label="推荐模板 ID">
                      <a-input :value="form.selectedTemplateId || ''" placeholder="可选" @update:value="form.selectedTemplateId = String($event ?? '') || null" />
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="12">
                    <a-form-item label="场景标识">
                      <a-input :value="form.scenarioKey || ''" placeholder="例如 release-guard" @update:value="form.scenarioKey = String($event ?? '') || undefined" />
                    </a-form-item>
                  </a-col>
                </a-row>

                <a-space wrap>
                  <a-button type="primary" :loading="saving" @click="handleSave">保存任务级覆盖</a-button>
                  <a-button :loading="clearing" @click="handleClear">恢复项目默认</a-button>
                  <a-button @click="router.push(`/tasks/${taskId}/operating-console`)">返回运行详情</a-button>
                </a-space>
              </a-form>
            </a-card>
          </a-col>
        </a-row>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type OperatingModeSelection,
  type Task,
  type TaskOperatingState,
  deleteTaskOperatingMode,
  getTask,
  getTaskOperatingMode,
  getTaskOperatingState,
  toApiError,
  updateTaskOperatingMode,
} from "../lib/api";

const route = useRoute();
const router = useRouter();
const taskId = String(route.params.taskId || "");

const task = ref<Task | null>(null);
const currentState = ref<TaskOperatingState>({});
const loading = ref(true);
const saving = ref(false);
const clearing = ref(false);
const loadError = ref("");

const collaborationOptions = [
  { label: "单兵模式", value: "solo" },
  { label: "团队模式", value: "team" },
  { label: "混合模式", value: "hybrid" },
];

const autopilotOptions = [
  { label: "L0 手动监督", value: "L0" },
  { label: "L1 半自动经营", value: "L1" },
  { label: "L2 全自动托管", value: "L2" },
];

const bossModeOptions = [
  { label: "不参与", value: "disabled" },
  { label: "建议模式", value: "advisory" },
  { label: "异常介入", value: "exception-only" },
  { label: "全面管理", value: "full-manager" },
];

const form = reactive<OperatingModeSelection>({
  collaborationMode: "solo",
  autopilotLevel: "L1",
  bossParticipationMode: "advisory",
  selectedTemplateId: null,
  scenarioKey: undefined,
  source: "task-override",
});

function asCollaborationMode(value: unknown): OperatingModeSelection["collaborationMode"] {
  return value === "solo" || value === "team" || value === "hybrid" ? value : "solo";
}

function asAutopilotLevel(value: unknown): OperatingModeSelection["autopilotLevel"] {
  return value === "L0" || value === "L1" || value === "L2" ? value : "L1";
}

function asBossMode(value: unknown): OperatingModeSelection["bossParticipationMode"] {
  return value === "disabled" ||
    value === "advisory" ||
    value === "exception-only" ||
    value === "full-manager"
    ? value
    : "advisory";
}

function applyMode(mode?: OperatingModeSelection | null, state?: TaskOperatingState | null) {
  form.collaborationMode = mode?.collaborationMode || state?.collaborationMode || "solo";
  form.autopilotLevel = mode?.autopilotLevel || state?.autopilotLevel || "L1";
  form.bossParticipationMode =
    mode?.bossParticipationMode || state?.bossParticipationMode || "advisory";
  form.selectedTemplateId = mode?.selectedTemplateId || null;
  form.scenarioKey = mode?.scenarioKey || undefined;
  form.source = "task-override";
}

async function loadData() {
  loading.value = true;
  loadError.value = "";
  try {
    const [taskResult, stateResult, modeResult] = await Promise.all([
      getTask(taskId),
      getTaskOperatingState(taskId),
      getTaskOperatingMode(taskId),
    ]);
    task.value = taskResult;
    currentState.value = stateResult;
    applyMode(modeResult.data, stateResult);
  } catch (error) {
    loadError.value =
      toApiError(error)?.message || (error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  try {
    await updateTaskOperatingMode(taskId, { ...form, source: "task-override" });
    message.success("任务级覆盖已保存");
    await loadData();
  } catch (error) {
    message.error(
      `保存失败: ${toApiError(error)?.message || (error instanceof Error ? error.message : String(error))}`,
    );
  } finally {
    saving.value = false;
  }
}

async function handleClear() {
  clearing.value = true;
  try {
    await deleteTaskOperatingMode(taskId);
    message.success("已恢复项目默认档位");
    await loadData();
  } catch (error) {
    message.error(
      `恢复失败: ${toApiError(error)?.message || (error instanceof Error ? error.message : String(error))}`,
    );
  } finally {
    clearing.value = false;
  }
}

onMounted(loadData);
</script>