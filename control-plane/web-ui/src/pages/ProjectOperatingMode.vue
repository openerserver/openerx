<template>
  <div style="padding: 24px">
    <a-page-header
      :title="project ? `${project.name} / 运行档位` : '运行档位'"
      sub-title="查看并调整项目级组织运行配置"
      @back="router.push(`/projects/${projectId}`)"
    />

    <ProjectSectionNav :project-id="projectId" active-key="operating-mode" />

    <a-spin :spinning="loading" style="display: block">
      <a-alert v-if="loadError" type="error" show-icon style="margin-bottom: 16px" :message="loadError" />

      <template v-else-if="project">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :xl="8">
            <a-card title="当前项目档位" size="small">
              <a-descriptions :column="1" size="small" bordered>
                <a-descriptions-item label="协作模式">{{ formatCollaboration(form.collaborationMode) }}</a-descriptions-item>
                <a-descriptions-item label="自动托管">{{ form.autopilotLevel || '未配置' }}</a-descriptions-item>
                <a-descriptions-item label="管理介入">{{ formatBossMode(form.bossParticipationMode) }}</a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>
          <a-col :xs="24" :xl="8">
            <a-card title="模板与编排来源" size="small">
              <a-descriptions :column="1" size="small" bordered>
                <a-descriptions-item label="当前模板">{{ orchestrationView?.currentTemplate?.name || '未绑定' }}</a-descriptions-item>
                <a-descriptions-item label="模板 ID">{{ orchestrationView?.workflowTemplateId || '未绑定' }}</a-descriptions-item>
                <a-descriptions-item label="推荐模板">{{ form.preferredTemplateId || '未配置' }}</a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>
          <a-col :xs="24" :xl="8">
            <a-card title="相关入口" size="small">
              <a-space direction="vertical" style="width: 100%">
                <a-button block @click="router.push(`/projects/${projectId}/orchestration`)">查看介入编排</a-button>
                <a-button block @click="router.push(`/projects/${projectId}`)">返回项目概览</a-button>
              </a-space>
            </a-card>
          </a-col>
        </a-row>

        <a-card title="项目默认运行档位" size="small">
          <a-form layout="vertical">
            <a-row :gutter="16">
              <a-col :xs="24" :lg="8">
                <a-form-item label="协作模式">
                  <a-select :value="form.collaborationMode" :options="collaborationOptions" allow-clear @update:value="form.collaborationMode = asCollaborationMode($event)" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :lg="8">
                <a-form-item label="自动托管等级">
                  <a-select :value="form.autopilotLevel" :options="autopilotOptions" allow-clear @update:value="form.autopilotLevel = asAutopilotLevel($event)" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :lg="8">
                <a-form-item label="管理介入方式">
                  <a-select :value="form.bossParticipationMode" :options="bossModeOptions" allow-clear @update:value="form.bossParticipationMode = asBossMode($event)" />
                </a-form-item>
              </a-col>
            </a-row>

            <a-row :gutter="16">
              <a-col :xs="24" :lg="12">
                <a-form-item label="推荐模板 ID">
                  <a-input :value="form.preferredTemplateId || ''" placeholder="可选" @update:value="form.preferredTemplateId = String($event ?? '') || null" />
                </a-form-item>
              </a-col>
              <a-col :xs="24" :lg="12">
                <a-space wrap style="margin-top: 30px">
                  <a-switch :checked="form.allowHybridEscalation" @update:checked="form.allowHybridEscalation = Boolean($event)" />
                  <span>允许混合模式升级</span>
                </a-space>
              </a-col>
            </a-row>

            <a-space wrap>
              <a-switch :checked="form.allowBossAutoTemplateSwitch" @update:checked="form.allowBossAutoTemplateSwitch = Boolean($event)" />
              <span>允许管理介入自动切模板</span>
            </a-space>

            <div style="margin-top: 16px">
              <a-button type="primary" :loading="saving" :disabled="!canManage" @click="handleSave">保存项目档位</a-button>
            </div>
          </a-form>
        </a-card>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type Project,
  type ProjectOrchestrationView,
  type ProjectSettings,
  getProject,
  getProjectOrchestrationView,
  toApiError,
  updateProject,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const projectId = String(route.params.projectId || "");

const loading = ref(true);
const saving = ref(false);
const loadError = ref("");
const project = ref<Project | null>(null);
const orchestrationView = ref<ProjectOrchestrationView | null>(null);

const form = reactive<ProjectSettings>({
  collaborationMode: undefined,
  autopilotLevel: undefined,
  bossParticipationMode: undefined,
  preferredTemplateId: null,
  allowBossAutoTemplateSwitch: false,
  allowHybridEscalation: false,
});

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

const canManage = computed(() => {
  const role = authStore.user?.role;
  if (role === "platform_admin" || role === "org_admin" || role === "admin") return true;
  return (
    authStore.user?.projects?.some(
      (item) => item.id === projectId && item.role === "project_admin",
    ) || false
  );
});

function applyProjectSettings(settings?: ProjectSettings | null) {
  form.collaborationMode = settings?.collaborationMode;
  form.autopilotLevel = settings?.autopilotLevel;
  form.bossParticipationMode = settings?.bossParticipationMode;
  form.preferredTemplateId = settings?.preferredTemplateId || null;
  form.allowBossAutoTemplateSwitch = settings?.allowBossAutoTemplateSwitch ?? false;
  form.allowHybridEscalation = settings?.allowHybridEscalation ?? false;
}

function formatCollaboration(value?: string | null) {
  if (value === "team") return "团队模式";
  if (value === "hybrid") return "混合模式";
  return value === "solo" ? "单兵模式" : "未配置";
}

function formatBossMode(value?: string | null) {
  if (value === "disabled") return "不参与";
  if (value === "exception-only") return "异常介入";
  if (value === "full-manager") return "全面管理";
  return value === "advisory" ? "建议模式" : "未配置";
}

function asCollaborationMode(value: unknown): ProjectSettings["collaborationMode"] {
  return value === "solo" || value === "team" || value === "hybrid" ? value : undefined;
}

function asAutopilotLevel(value: unknown): ProjectSettings["autopilotLevel"] {
  return value === "L0" || value === "L1" || value === "L2" ? value : undefined;
}

function asBossMode(value: unknown): ProjectSettings["bossParticipationMode"] {
  return value === "disabled" ||
    value === "advisory" ||
    value === "exception-only" ||
    value === "full-manager"
    ? value
    : undefined;
}

async function loadData() {
  loading.value = true;
  loadError.value = "";
  try {
    const [projectResult, orchestrationResult] = await Promise.all([
      getProject(projectId),
      getProjectOrchestrationView(projectId),
    ]);
    project.value = projectResult;
    orchestrationView.value = orchestrationResult;
    applyProjectSettings(projectResult.settings);
  } catch (error) {
    loadError.value =
      toApiError(error)?.message || (error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  if (!project.value) return;
  saving.value = true;
  try {
    const nextSettings: ProjectSettings = {
      ...(project.value.settings || {}),
      collaborationMode: form.collaborationMode,
      autopilotLevel: form.autopilotLevel,
      bossParticipationMode: form.bossParticipationMode,
      preferredTemplateId: form.preferredTemplateId || null,
      allowBossAutoTemplateSwitch: form.allowBossAutoTemplateSwitch ?? false,
      allowHybridEscalation: form.allowHybridEscalation ?? false,
    };
    project.value = await updateProject(projectId, { settings: nextSettings });
    applyProjectSettings(project.value.settings);
    message.success("项目运行档位已保存");
  } catch (error) {
    message.error(
      `保存失败: ${toApiError(error)?.message || (error instanceof Error ? error.message : String(error))}`,
    );
  } finally {
    saving.value = false;
  }
}

onMounted(loadData);
</script>