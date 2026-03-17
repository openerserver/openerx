<template>
  <div style="padding: 24px">
    <a-page-header
      title="组织运行策略"
      sub-title="配置平台默认协作模式、自动托管等级和老板参与方式"
      @back="router.push('/settings')"
    />

    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="第 1 期采用新增页面承载组织运行策略，避免直接重构现有设置页。"
    />

    <a-spin :spinning="loading" style="display: block">
      <a-alert v-if="loadError" type="error" show-icon style="margin-bottom: 16px" :message="loadError" />

      <template v-else>
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :xl="14">
            <a-card title="平台默认运行档位" size="small">
              <a-form layout="vertical">
                <a-form-item label="默认协作模式">
                  <a-select :value="form.defaultCollaborationMode" :options="collaborationOptions" @update:value="form.defaultCollaborationMode = asCollaborationMode($event)" />
                </a-form-item>
                <a-form-item label="默认自动托管等级">
                  <a-select :value="form.defaultAutopilotLevel" :options="autopilotOptions" @update:value="form.defaultAutopilotLevel = asAutopilotLevel($event)" />
                </a-form-item>
                <a-form-item label="默认老板参与方式">
                  <a-select :value="form.defaultBossParticipationMode" :options="bossModeOptions" @update:value="form.defaultBossParticipationMode = asBossParticipationMode($event)" />
                </a-form-item>
                <a-space wrap>
                  <a-switch :checked="form.allowProjectModeOverride" @update:checked="form.allowProjectModeOverride = Boolean($event)" />
                  <span>允许项目覆盖平台默认</span>
                </a-space>
                <br />
                <a-space wrap style="margin-top: 12px">
                  <a-switch :checked="form.allowTaskModeOverride" @update:checked="form.allowTaskModeOverride = Boolean($event)" />
                  <span>允许任务临时覆盖</span>
                </a-space>
                <br />
                <a-space wrap style="margin-top: 12px">
                  <a-switch :checked="form.requireHumanApprovalForL2" @update:checked="form.requireHumanApprovalForL2 = Boolean($event)" />
                  <span>L2 需要人工批准</span>
                </a-space>
                <div style="margin-top: 16px">
                  <a-button type="primary" :loading="saving" @click="handleSave">保存组织运行策略</a-button>
                </div>
              </a-form>
            </a-card>
          </a-col>

          <a-col :xs="24" :xl="10">
            <a-card title="推荐场景预览" size="small">
              <a-table :data-source="scenarioRows" :columns="scenarioColumns" :pagination="false" row-key="scenarioKey" size="small" />
            </a-card>
          </a-col>
        </a-row>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  type OrchestrationStrategy,
  type PlatformOrganizationSettings,
  getOrchestrationStrategy,
  toApiError,
  updateOrchestrationStrategy,
} from "../lib/api";

const router = useRouter();

const loading = ref(true);
const saving = ref(false);
const loadError = ref("");
const strategy = ref<OrchestrationStrategy | null>(null);

const form = reactive<PlatformOrganizationSettings>({
  defaultCollaborationMode: "solo",
  defaultAutopilotLevel: "L1",
  defaultBossParticipationMode: "advisory",
  allowProjectModeOverride: true,
  allowTaskModeOverride: true,
  requireHumanApprovalForL2: true,
  hybridEscalationRules: [],
  recommendedProfiles: [],
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

const scenarioColumns = [
  { title: "场景", dataIndex: "scenarioKey", key: "scenarioKey" },
  { title: "协作", dataIndex: "collaborationMode", key: "collaborationMode" },
  { title: "托管", dataIndex: "autopilotLevel", key: "autopilotLevel" },
  { title: "老板", dataIndex: "bossParticipationMode", key: "bossParticipationMode" },
];

const scenarioRows = computed(() => form.recommendedProfiles || []);

function asCollaborationMode(value: unknown) {
  return value === "solo" || value === "team" || value === "hybrid" ? value : "solo";
}

function asAutopilotLevel(value: unknown) {
  return value === "L0" || value === "L1" || value === "L2" ? value : "L1";
}

function asBossParticipationMode(value: unknown) {
  return value === "disabled" ||
    value === "advisory" ||
    value === "exception-only" ||
    value === "full-manager"
    ? value
    : "advisory";
}

function applyOrganizationSettings(settings?: PlatformOrganizationSettings) {
  form.defaultCollaborationMode = settings?.defaultCollaborationMode || "solo";
  form.defaultAutopilotLevel = settings?.defaultAutopilotLevel || "L1";
  form.defaultBossParticipationMode = settings?.defaultBossParticipationMode || "advisory";
  form.allowProjectModeOverride = settings?.allowProjectModeOverride ?? true;
  form.allowTaskModeOverride = settings?.allowTaskModeOverride ?? true;
  form.requireHumanApprovalForL2 = settings?.requireHumanApprovalForL2 ?? true;
  form.hybridEscalationRules = settings?.hybridEscalationRules || [];
  form.recommendedProfiles = settings?.recommendedProfiles || [];
}

async function loadData() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await getOrchestrationStrategy();
    strategy.value = result.data;
    applyOrganizationSettings(result.data.organizationSettings);
  } catch (error) {
    loadError.value =
      toApiError(error)?.message || (error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  if (!strategy.value) return;

  saving.value = true;
  try {
    await updateOrchestrationStrategy({
      ...strategy.value,
      organizationSettings: {
        ...form,
        hybridEscalationRules: form.hybridEscalationRules || [],
        recommendedProfiles: form.recommendedProfiles || [],
      },
    });
    message.success("组织运行策略已保存");
    await loadData();
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