<template>
  <div>
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="5" style="margin: 0">项目设置</a-typography-title>
      <a-button v-if="canManage" type="primary" :loading="saving" @click="handleSave">保存设置</a-button>
    </a-flex>

    <a-alert
      v-if="!canManage"
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="你可以查看项目设置，但只有项目管理员才能修改。"
    />

    <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
      <a-col :xs="24" :lg="16">
        <a-card size="small" title="当前设置摘要">
          <a-descriptions :column="{ xs: 1, lg: 2 }" bordered size="small">
            <a-descriptions-item label="默认模型">
              {{ form.defaultModel || '未配置' }}
            </a-descriptions-item>
            <a-descriptions-item label="默认环境">
              {{ selectedEnvironmentLabel }}
            </a-descriptions-item>
            <a-descriptions-item label="预算配置状态">
              <a-space direction="vertical" :size="2">
                <a-space>
                  <span>{{ linkedBudget ? `$${linkedBudget.limit} / ${linkedBudget.period}` : '未绑定' }}</span>
                  <a-tag v-if="linkedBudget" :color="budgetStatusColor(linkedBudget.status)">
                    {{ budgetStatusLabel(linkedBudget.status) }}
                  </a-tag>
                </a-space>
                <a-typography-text v-if="linkedBudget" type="secondary">
                  已使用 {{ usageLabel(linkedBudget.usage) }} · 已支出 ${{ linkedBudget.currentSpend.toFixed(2) }}
                </a-typography-text>
              </a-space>
            </a-descriptions-item>
            <a-descriptions-item label="快捷入口">
              <a-space wrap>
                <router-link :to="{ name: 'ProjectApprovalPolicies', params: { projectId } }">
                  <a-button size="small">审批策略</a-button>
                </router-link>
                <router-link :to="{ name: 'ProjectRoleExecution', params: { projectId } }">
                  <a-button size="small">角色执行</a-button>
                </router-link>
                <router-link :to="{ name: 'ProjectCost', params: { projectId } }">
                  <a-button size="small">成本页</a-button>
                </router-link>
              </a-space>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </a-col>

      <a-col :xs="24" :lg="8">
        <a-card size="small" title="设置说明">
          <a-space direction="vertical" :size="8">
            <a-typography-text type="secondary">
              这里保留项目基础运行设置，包括默认模型、默认环境、并发与预算阈值。
            </a-typography-text>
            <a-typography-text type="secondary">
              审批策略已经拆到独立页面，角色执行规则也在独立页面维护。
            </a-typography-text>
          </a-space>
        </a-card>
      </a-col>
    </a-row>

    <a-card size="small">
      <a-form layout="vertical">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="12">
            <a-form-item label="默认模型">
              <a-select
                :value="form.defaultModel || undefined"
                placeholder="选择默认模型"
                show-search
                allow-clear
                :options="modelOptions"
                :loading="modelsLoading"
                :disabled="!canManage"
                @update:value="form.defaultModel = valueToString($event)"
              />
            </a-form-item>
          </a-col>

          <a-col :xs="24" :lg="12">
            <a-form-item label="默认环境">
              <a-select
                :value="form.defaultEnvironmentId || undefined"
                placeholder="选择默认环境"
                allow-clear
                :options="environmentOptions"
                :loading="environmentsLoading"
                :disabled="!canManage"
                @update:value="form.defaultEnvironmentId = valueToString($event)"
              />
            </a-form-item>
          </a-col>

          <a-col :xs="24" :lg="6">
            <a-form-item label="最大并发">
              <a-input-number
                :value="form.maxConcurrency"
                :min="1"
                :max="100"
                style="width: 100%"
                :disabled="!canManage"
                @update:value="form.maxConcurrency = valueToNumber($event)"
              />
            </a-form-item>
          </a-col>

          <a-col :xs="24" :lg="6">
            <a-form-item label="月预算 (USD)">
              <a-input-number
                :value="form.budgetMonthly"
                :min="0"
                :step="50"
                style="width: 100%"
                :disabled="!canManage"
                @update:value="form.budgetMonthly = valueToNumber($event)"
              />
            </a-form-item>
          </a-col>

          <a-col :xs="24" :lg="6">
            <a-form-item label="预警阈值 (%)">
              <a-input-number
                :value="toPercent(form.warnThreshold)"
                :min="0"
                :max="100"
                :step="5"
                style="width: 100%"
                :disabled="!canManage"
                @update:value="form.warnThreshold = percentToRatio($event)"
              />
            </a-form-item>
          </a-col>

          <a-col :xs="24" :lg="6">
            <a-form-item label="限流阈值 (%)">
              <a-input-number
                :value="toPercent(form.throttleThreshold)"
                :min="0"
                :max="100"
                :step="5"
                style="width: 100%"
                :disabled="!canManage"
                @update:value="form.throttleThreshold = percentToRatio($event)"
              />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  type BudgetConfig,
  type Environment,
  type ModelsConfig,
  type ProjectSettings,
  createBudgetConfig,
  getModelsConfig,
  listBudgetConfigs,
  listEnvironments,
  updateBudgetConfig,
  updateProject,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{
  projectId: string;
  settings?: ProjectSettings | null;
}>();

const emit = defineEmits<{
  updated: [settings: ProjectSettings];
}>();

const authStore = useAuthStore();
const modelsLoading = ref(false);
const environmentsLoading = ref(false);
const saving = ref(false);
const modelsData = ref<ModelsConfig | null>(null);
const environments = ref<Environment[]>([]);
const budgetConfigs = ref<BudgetConfig[]>([]);

const form = reactive<ProjectSettings>({
  defaultModel: "",
  defaultEnvironmentId: "",
  maxConcurrency: undefined,
  budgetMonthly: undefined,
  warnThreshold: 0.8,
  throttleThreshold: 0.95,
});

const canManage = computed(() => {
  const globalRole = authStore.user?.role;
  if (globalRole === "platform_admin" || globalRole === "org_admin") {
    return true;
  }
  const projectRole = authStore.user?.projects?.find((item) => item.id === props.projectId)?.role;
  return projectRole === "project_admin";
});

const modelOptions = computed(() => {
  const currentModel = form.defaultModel || "";
  const options = (modelsData.value?.list || [])
    .map((model) => {
      const id = typeof model.id === "string" ? model.id : "";
      if (!id) return null;
      const name = typeof model.name === "string" ? model.name : "";
      const provider = typeof model.provider === "string" ? model.provider : "";
      const meta = [name, provider].filter(Boolean).join(" / ");
      return {
        value: id,
        label: meta ? `${id} (${meta})` : id,
      };
    })
    .filter((option): option is { value: string; label: string } => Boolean(option));

  if (currentModel && !options.some((option) => option.value === currentModel)) {
    options.unshift({ value: currentModel, label: `${currentModel} (当前值)` });
  }

  return options;
});

const environmentOptions = computed(() =>
  environments.value.map((environment) => ({
    value: environment.id,
    label: `${environment.name} (${environment.riskLevel})`,
  })),
);

const linkedBudget = computed(() => resolveLinkedBudget(budgetConfigs.value));
const selectedEnvironmentLabel = computed(() => {
  const selected = environments.value.find((item) => item.id === form.defaultEnvironmentId);
  return selected ? `${selected.name} (${selected.riskLevel})` : "未配置";
});

watch(
  () => props.settings,
  (settings) => {
    form.defaultModel = settings?.defaultModel || "";
    form.defaultEnvironmentId = settings?.defaultEnvironmentId || "";
    form.maxConcurrency = settings?.maxConcurrency;
    form.budgetMonthly = settings?.budgetMonthly;
    form.warnThreshold = settings?.warnThreshold ?? 0.8;
    form.throttleThreshold = settings?.throttleThreshold ?? 0.95;
    form.approvalPolicyTemplateId = settings?.approvalPolicyTemplateId;
    form.approvalPolicy = settings?.approvalPolicy;
    form.environmentApprovalPolicies = settings?.environmentApprovalPolicies;
    form.budgetConfigId = settings?.budgetConfigId;
  },
  { immediate: true, deep: true },
);

onMounted(async () => {
  modelsLoading.value = true;
  environmentsLoading.value = true;
  try {
    const modelsRequest = canManage.value ? getModelsConfig() : Promise.resolve(null);
    const [modelsResult, environmentsResult, budgetResult] = await Promise.allSettled([
      modelsRequest,
      listEnvironments(props.projectId),
      listBudgetConfigs(props.projectId),
    ]);

    modelsData.value = modelsResult.status === "fulfilled" ? (modelsResult.value?.data ?? null) : null;
    environments.value = environmentsResult.status === "fulfilled" ? environmentsResult.value : [];
    budgetConfigs.value = budgetResult.status === "fulfilled" ? budgetResult.value : [];

    const linked = resolveLinkedBudget(budgetConfigs.value);
    if (linked) {
      form.budgetMonthly = linked.limit;
      form.warnThreshold = linked.warnThreshold;
      form.throttleThreshold = linked.throttleThreshold;
    }
  } finally {
    modelsLoading.value = false;
    environmentsLoading.value = false;
  }
});

async function handleSave() {
  saving.value = true;
  try {
    const linkedBudget = await upsertBudgetConfig();

    const settings: ProjectSettings = {
      ...(props.settings || {}),
      ...(form.defaultModel ? { defaultModel: form.defaultModel } : {}),
      ...(form.defaultEnvironmentId ? { defaultEnvironmentId: form.defaultEnvironmentId } : {}),
      ...(typeof form.maxConcurrency === "number" ? { maxConcurrency: form.maxConcurrency } : {}),
      ...(typeof form.budgetMonthly === "number" ? { budgetMonthly: form.budgetMonthly } : {}),
      ...(linkedBudget?.id ? { budgetConfigId: linkedBudget.id } : {}),
      ...(typeof form.warnThreshold === "number" ? { warnThreshold: form.warnThreshold } : {}),
      ...(typeof form.throttleThreshold === "number" ? { throttleThreshold: form.throttleThreshold } : {}),
    };

    await updateProject(props.projectId, { settings });
    emit("updated", settings);
    message.success("项目设置已保存");
  } catch (e) {
    message.error(`保存设置失败: ${e}`);
  } finally {
    saving.value = false;
  }
}

function valueToString(value: unknown) {
  return value == null ? "" : String(value);
}

function valueToNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function percentToRatio(value: unknown) {
  return typeof value === "number" ? Number((value / 100).toFixed(2)) : undefined;
}

function toPercent(value: number | undefined) {
  return typeof value === "number" ? Math.round(value * 100) : undefined;
}

function resolveLinkedBudget(items: BudgetConfig[]) {
  const linkedId = props.settings?.budgetConfigId;
  if (linkedId) {
    return items.find((item) => item.id === linkedId);
  }

  return items.find((item) => item.period === "monthly");
}

async function upsertBudgetConfig() {
  const existing = resolveLinkedBudget(budgetConfigs.value);
  const hasBudgetValue = typeof form.budgetMonthly === "number";

  if (!existing && !hasBudgetValue) {
    return undefined;
  }

  const payload = {
    period: "monthly" as const,
    limitAmount: form.budgetMonthly ?? existing?.limit ?? 0,
    warnThreshold: form.warnThreshold ?? existing?.warnThreshold ?? 0.8,
    throttleThreshold: form.throttleThreshold ?? existing?.throttleThreshold ?? 0.95,
  };

  if (existing) {
    const updated = await updateBudgetConfig(existing.id, payload);
    budgetConfigs.value = budgetConfigs.value.map((item) =>
      item.id === existing.id
        ? {
            ...item,
            period: updated.period,
            limit: updated.limitAmount,
            warnThreshold: updated.warnThreshold,
            throttleThreshold: updated.throttleThreshold,
          }
        : item,
    );
    return { id: updated.id };
  }

  const created = await createBudgetConfig({
    projectId: props.projectId,
    ...payload,
  });
  budgetConfigs.value = [
    ...budgetConfigs.value,
    {
      id: created.id,
      period: created.period,
      limit: created.limitAmount,
      currentSpend: 0,
      usage: 0,
      status: "ok",
      warnThreshold: created.warnThreshold,
      throttleThreshold: created.throttleThreshold,
    },
  ];
  return { id: created.id };
}

function budgetStatusColor(status: BudgetConfig["status"]) {
  if (status === "ok") return "green";
  if (status === "warn") return "gold";
  if (status === "throttle") return "orange";
  return "red";
}

function budgetStatusLabel(status: BudgetConfig["status"]) {
  if (status === "ok") return "正常";
  if (status === "warn") return "预警";
  if (status === "throttle") return "限流";
  return "阻断";
}

function usageLabel(usage: number) {
  return `${Math.round(usage * 100)}%`;
}
</script>
