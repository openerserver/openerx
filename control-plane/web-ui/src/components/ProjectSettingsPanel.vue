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
        <a-card size="small" title="当前绑定状态">
          <a-descriptions :column="{ xs: 1, lg: 2 }" bordered size="small">
            <a-descriptions-item label="默认审批模板">
              <a-space direction="vertical" :size="2">
                <span>{{ linkedPolicy?.name || "未绑定" }}</span>
                <a-typography-text v-if="linkedPolicy" type="secondary">
                  {{ linkedPolicy.id }} · {{ approvalPolicyLabel(policyToApprovalPolicy(linkedPolicy.rules)) }}
                </a-typography-text>
              </a-space>
            </a-descriptions-item>
            <a-descriptions-item label="预算配置状态">
              <a-space direction="vertical" :size="2">
                <a-space>
                  <span>{{ linkedBudget ? `$${linkedBudget.limit} / ${linkedBudget.period}` : "未绑定" }}</span>
                  <a-tag v-if="linkedBudget" :color="budgetStatusColor(linkedBudget.status)">
                    {{ budgetStatusLabel(linkedBudget.status) }}
                  </a-tag>
                </a-space>
                <a-typography-text v-if="linkedBudget" type="secondary">
                  已使用 {{ usageLabel(linkedBudget.usage) }} · 已支出 ${{ linkedBudget.currentSpend.toFixed(2) }}
                </a-typography-text>
              </a-space>
            </a-descriptions-item>
            <a-descriptions-item label="环境级策略">
              <span>{{ environmentPolicyCount }} 个环境已配置覆盖策略</span>
            </a-descriptions-item>
            <a-descriptions-item label="快捷入口">
              <a-space wrap>
                <router-link :to="{ name: 'ProjectPolicies', params: { projectId } }">
                  <a-button size="small">跳转到策略页</a-button>
                </router-link>
                <router-link :to="{ name: 'ProjectCost', params: { projectId } }">
                  <a-button size="small">跳转到成本页</a-button>
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
              项目默认审批策略会写入 policy template，并绑定到当前项目设置。
            </a-typography-text>
            <a-typography-text type="secondary">
              月预算、预警阈值、限流阈值会同步到 budget config。
            </a-typography-text>
            <a-typography-text type="secondary">
              环境级审批策略会覆盖项目默认策略，仅作用于对应环境。
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

          <a-col :xs="24" :lg="12">
            <a-form-item label="审批策略">
              <a-select
                :value="form.approvalPolicy || undefined"
                placeholder="选择审批策略"
                :disabled="!canManage"
                @update:value="form.approvalPolicy = valueToApprovalPolicy($event)"
              >
                <a-select-option value="balanced">balanced: 平衡策略</a-select-option>
                <a-select-option value="strict">strict: 高风险优先审批</a-select-option>
                <a-select-option value="manual">manual: 关键动作全部人工审批</a-select-option>
              </a-select>
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

    <a-card size="small" title="环境审批策略" style="margin-top: 16px">
      <a-alert
        type="info"
        show-icon
        style="margin-bottom: 16px"
        message="未单独配置的环境会继承项目默认审批策略。"
      />

      <a-empty v-if="!environments.length && !environmentsLoading" description="当前项目还没有环境" />

      <a-spin :spinning="environmentsLoading">
        <a-row
          v-for="environment in environments"
          :key="environment.id"
          :gutter="[16, 12]"
          style="padding: 12px 0; border-bottom: 1px solid #f0f0f0"
        >
          <a-col :xs="24" :lg="10">
            <a-space wrap>
              <strong>{{ environment.name }}</strong>
              <a-tag>{{ environment.riskLevel }}</a-tag>
              <a-tag :color="environment.requiresApproval ? 'orange' : 'green'">
                {{ environment.requiresApproval ? '需要审批' : '可直通' }}
              </a-tag>
            </a-space>
            <div style="margin-top: 4px">
              <a-typography-text type="secondary">
                {{ environmentPolicyTemplateLabel(environment.id) }}
              </a-typography-text>
            </div>
          </a-col>

          <a-col :xs="24" :lg="14">
            <a-select
              :value="form.environmentApprovalPolicies?.[environment.id]?.approvalPolicy || undefined"
              placeholder="继承项目默认策略"
              allow-clear
              style="width: 100%"
              :disabled="!canManage"
              @update:value="updateEnvironmentApprovalPolicy(environment.id, valueToApprovalPolicy($event))"
            >
              <a-select-option value="balanced">balanced: 平衡策略</a-select-option>
              <a-select-option value="strict">strict: 高风险优先审批</a-select-option>
              <a-select-option value="manual">manual: 关键动作全部人工审批</a-select-option>
            </a-select>
          </a-col>
        </a-row>
      </a-spin>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  type ApprovalPolicyMode,
  type BudgetConfig,
  type Environment,
  type EnvironmentApprovalPolicyBinding,
  type ModelsConfig,
  type PolicyTemplate,
  type ProjectSettings,
  createBudgetConfig,
  createPolicy,
  getModelsConfig,
  listBudgetConfigs,
  listEnvironments,
  listPolicies,
  updateBudgetConfig,
  updatePolicy,
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
const policies = ref<PolicyTemplate[]>([]);
const budgetConfigs = ref<BudgetConfig[]>([]);

const form = reactive<ProjectSettings>({
  defaultModel: "",
  defaultEnvironmentId: "",
  approvalPolicy: undefined,
  environmentApprovalPolicies: {},
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

const linkedPolicy = computed(() => resolveLinkedPolicy(policies.value));
const linkedBudget = computed(() => resolveLinkedBudget(budgetConfigs.value));
const environmentPolicyCount = computed(
  () => Object.keys(form.environmentApprovalPolicies || {}).length,
);

watch(
  () => props.settings,
  (settings) => {
    form.defaultModel = settings?.defaultModel || "";
    form.defaultEnvironmentId = settings?.defaultEnvironmentId || "";
    form.approvalPolicy = settings?.approvalPolicy;
    form.environmentApprovalPolicies = cloneEnvironmentApprovalPolicies(
      settings?.environmentApprovalPolicies,
    );
    form.maxConcurrency = settings?.maxConcurrency;
    form.budgetMonthly = settings?.budgetMonthly;
    form.warnThreshold = settings?.warnThreshold ?? 0.8;
    form.throttleThreshold = settings?.throttleThreshold ?? 0.95;
  },
  { immediate: true, deep: true },
);

onMounted(async () => {
  modelsLoading.value = true;
  environmentsLoading.value = true;
  try {
    const modelsRequest = canManage.value ? getModelsConfig() : Promise.resolve(null);
    const [modelsResult, environmentsResult, policyResult, budgetResult] = await Promise.allSettled(
      [
        modelsRequest,
        listEnvironments(props.projectId),
        listPolicies(props.projectId),
        listBudgetConfigs(props.projectId),
      ],
    );

    modelsData.value =
      modelsResult.status === "fulfilled" ? (modelsResult.value?.data ?? null) : null;
    environments.value = environmentsResult.status === "fulfilled" ? environmentsResult.value : [];
    policies.value = policyResult.status === "fulfilled" ? policyResult.value : [];
    budgetConfigs.value = budgetResult.status === "fulfilled" ? budgetResult.value : [];

    const resolvedPolicyItems = policies.value;
    const resolvedEnvironmentItems = environments.value;
    const resolvedBudgetItems = budgetConfigs.value;

    const linkedPolicy = resolveLinkedPolicy(resolvedPolicyItems);
    if (linkedPolicy) {
      form.approvalPolicy = policyToApprovalPolicy(linkedPolicy.rules);
    }

    form.environmentApprovalPolicies = syncEnvironmentApprovalPolicies(
      resolvedPolicyItems,
      resolvedEnvironmentItems,
      props.settings?.environmentApprovalPolicies,
    );

    const linkedBudget = resolveLinkedBudget(resolvedBudgetItems);
    if (linkedBudget) {
      form.budgetMonthly = linkedBudget.limit;
      form.warnThreshold = linkedBudget.warnThreshold;
      form.throttleThreshold = linkedBudget.throttleThreshold;
    }
  } finally {
    modelsLoading.value = false;
    environmentsLoading.value = false;
  }
});

async function handleSave() {
  saving.value = true;
  try {
    const linkedPolicy = await upsertApprovalPolicy();
    const environmentApprovalPolicies = await upsertEnvironmentPolicies();
    const linkedBudget = await upsertBudgetConfig();

    const settings: ProjectSettings = {
      ...(form.defaultModel ? { defaultModel: form.defaultModel } : {}),
      ...(form.defaultEnvironmentId ? { defaultEnvironmentId: form.defaultEnvironmentId } : {}),
      ...(linkedPolicy?.id ? { approvalPolicyTemplateId: linkedPolicy.id } : {}),
      ...(form.approvalPolicy ? { approvalPolicy: form.approvalPolicy } : {}),
      ...(Object.keys(environmentApprovalPolicies).length ? { environmentApprovalPolicies } : {}),
      ...(typeof form.maxConcurrency === "number" ? { maxConcurrency: form.maxConcurrency } : {}),
      ...(typeof form.budgetMonthly === "number" ? { budgetMonthly: form.budgetMonthly } : {}),
      ...(linkedBudget?.id ? { budgetConfigId: linkedBudget.id } : {}),
      ...(typeof form.warnThreshold === "number" ? { warnThreshold: form.warnThreshold } : {}),
      ...(typeof form.throttleThreshold === "number"
        ? { throttleThreshold: form.throttleThreshold }
        : {}),
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

function valueToApprovalPolicy(value: unknown): ApprovalPolicyMode | undefined {
  if (value === "balanced" || value === "strict" || value === "manual") {
    return value;
  }
  return undefined;
}

function percentToRatio(value: unknown) {
  return typeof value === "number" ? Number((value / 100).toFixed(2)) : undefined;
}

function toPercent(value: number | undefined) {
  return typeof value === "number" ? Math.round(value * 100) : undefined;
}

function resolveLinkedPolicy(items: PolicyTemplate[]) {
  const linkedId = props.settings?.approvalPolicyTemplateId;
  if (linkedId) {
    return items.find((item) => item.id === linkedId);
  }

  return items.find(
    (item) =>
      item.type === "command_level" &&
      item.appliesTo === "all" &&
      (item.name === "Project Default Approval Policy" || item.rules.source === "project-settings"),
  );
}

function resolveEnvironmentLinkedPolicy(
  environmentId: string,
  items: PolicyTemplate[],
  bindings?: ProjectSettings["environmentApprovalPolicies"],
) {
  const linkedId = bindings?.[environmentId]?.policyTemplateId;
  if (linkedId) {
    return items.find((item) => item.id === linkedId);
  }

  return items.find(
    (item) =>
      item.type === "command_level" &&
      item.appliesTo === "environment" &&
      item.rules.source === "project-settings" &&
      item.rules.environmentId === environmentId,
  );
}

function resolveLinkedBudget(items: BudgetConfig[]) {
  const linkedId = props.settings?.budgetConfigId;
  if (linkedId) {
    return items.find((item) => item.id === linkedId);
  }

  return items.find((item) => item.period === "monthly");
}

function policyToApprovalPolicy(rules: Record<string, unknown>): ApprovalPolicyMode | undefined {
  const value = rules.approvalPolicy;
  if (value === "balanced" || value === "strict" || value === "manual") {
    return value;
  }
  return undefined;
}

async function upsertApprovalPolicy() {
  if (!form.approvalPolicy) {
    return resolveLinkedPolicy(policies.value);
  }

  const existing = resolveLinkedPolicy(policies.value);
  const payload = {
    name: "Project Default Approval Policy",
    rules: {
      source: "project-settings",
      approvalPolicy: form.approvalPolicy,
    },
    appliesTo: "all" as const,
  };

  if (existing) {
    const updated = await updatePolicy(existing.id, payload);
    policies.value = policies.value.map((item) => (item.id === updated.id ? updated : item));
    return updated;
  }

  const created = await createPolicy({
    projectId: props.projectId,
    type: "command_level",
    ...payload,
  });
  policies.value = [...policies.value, created];
  return created;
}

async function upsertEnvironmentPolicies() {
  const nextBindings: Record<string, EnvironmentApprovalPolicyBinding> = {};

  for (const environment of environments.value) {
    const selectedPolicy = form.environmentApprovalPolicies?.[environment.id]?.approvalPolicy;
    if (!selectedPolicy) {
      continue;
    }

    const existing = resolveEnvironmentLinkedPolicy(
      environment.id,
      policies.value,
      form.environmentApprovalPolicies,
    );
    const payload = {
      name: `${environment.name} Approval Policy`,
      rules: {
        source: "project-settings",
        environmentId: environment.id,
        environmentName: environment.name,
        approvalPolicy: selectedPolicy,
      },
      appliesTo: "environment" as const,
    };

    if (existing) {
      const updated = await updatePolicy(existing.id, payload);
      policies.value = policies.value.map((item) => (item.id === updated.id ? updated : item));
      nextBindings[environment.id] = {
        approvalPolicy: selectedPolicy,
        policyTemplateId: updated.id,
      };
      continue;
    }

    const created = await createPolicy({
      projectId: props.projectId,
      type: "command_level",
      ...payload,
    });
    policies.value = [...policies.value, created];
    nextBindings[environment.id] = {
      approvalPolicy: selectedPolicy,
      policyTemplateId: created.id,
    };
  }

  form.environmentApprovalPolicies = nextBindings;
  return nextBindings;
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

function cloneEnvironmentApprovalPolicies(value?: ProjectSettings["environmentApprovalPolicies"]) {
  return Object.fromEntries(
    Object.entries(value || {}).map(([environmentId, binding]) => [environmentId, { ...binding }]),
  );
}

function syncEnvironmentApprovalPolicies(
  policyItems: PolicyTemplate[],
  environmentItems: Environment[],
  existingBindings?: ProjectSettings["environmentApprovalPolicies"],
) {
  const nextBindings = cloneEnvironmentApprovalPolicies(existingBindings);

  for (const environment of environmentItems) {
    const linkedPolicy = resolveEnvironmentLinkedPolicy(environment.id, policyItems, nextBindings);
    const approvalPolicy = linkedPolicy ? policyToApprovalPolicy(linkedPolicy.rules) : undefined;

    if (approvalPolicy) {
      nextBindings[environment.id] = {
        approvalPolicy,
        policyTemplateId: linkedPolicy?.id,
      };
      continue;
    }

    if (!nextBindings[environment.id]?.approvalPolicy) {
      delete nextBindings[environment.id];
    }
  }

  return nextBindings;
}

function updateEnvironmentApprovalPolicy(
  environmentId: string,
  approvalPolicy: ApprovalPolicyMode | undefined,
) {
  const nextBindings = cloneEnvironmentApprovalPolicies(form.environmentApprovalPolicies);

  if (!approvalPolicy) {
    delete nextBindings[environmentId];
    form.environmentApprovalPolicies = nextBindings;
    return;
  }

  nextBindings[environmentId] = {
    ...nextBindings[environmentId],
    approvalPolicy,
  };
  form.environmentApprovalPolicies = nextBindings;
}

function environmentPolicyTemplateLabel(environmentId: string) {
  const linkedTemplate = resolveEnvironmentLinkedPolicy(
    environmentId,
    policies.value,
    form.environmentApprovalPolicies,
  );

  if (linkedTemplate) {
    return `当前模板: ${linkedTemplate.name} (${linkedTemplate.id})`;
  }

  return "当前模板: 继承项目默认策略";
}

function approvalPolicyLabel(policy: ApprovalPolicyMode | undefined) {
  if (policy === "balanced") return "balanced: 平衡策略";
  if (policy === "strict") return "strict: 高风险优先审批";
  if (policy === "manual") return "manual: 关键动作全部人工审批";
  return "未配置";
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
