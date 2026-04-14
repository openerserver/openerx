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
            <a-descriptions-item label="项目组标识">
              {{ form.projectGroupKey || '未配置' }}
            </a-descriptions-item>
            <a-descriptions-item label="项目组展示名">
              {{ form.projectGroupLabel || '未配置' }}
            </a-descriptions-item>
            <a-descriptions-item label="最大并发">
              {{ form.maxConcurrency ?? '未配置' }}
            </a-descriptions-item>
            <a-descriptions-item label="钱包状态">
              <a-space>
                <span>{{ formatUsd(currentFund.available) }}</span>
                <a-tag :color="walletHealthColor(currentFund)">
                  {{ walletHealthLabel(currentFund) }}
                </a-tag>
              </a-space>
            </a-descriptions-item>
            <a-descriptions-item label="钱包分布">
              已充值 {{ formatUsd(currentFund.totalGranted) }} · 已预留 {{ formatUsd(currentFund.reserved) }} · 已消耗 {{ formatUsd(currentFund.consumed) }}
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
              项目基础设置只保留默认模型、默认环境、项目组和并发等运行参数。
            </a-typography-text>
            <a-typography-text type="secondary">
              付费模型是否收费由系统模型目录决定；项目还能否继续使用，改由下面的钱包余额控制。
            </a-typography-text>
          </a-space>
        </a-card>
      </a-col>
    </a-row>

    <a-card size="small" title="项目额度钱包" style="margin-bottom: 16px">
      <a-spin :spinning="walletLoading || fundMutating">
        <a-alert
          v-if="walletError"
          type="error"
          show-icon
          style="margin-bottom: 12px"
          :message="walletError"
        />

        <a-descriptions :column="{ xs: 1, lg: 3 }" bordered size="small">
          <a-descriptions-item label="当前可用额度">
            <a-space>
              <span style="font-weight: 600">{{ formatUsd(currentFund.available) }}</span>
              <a-tag :color="walletHealthColor(currentFund)">
                {{ walletHealthLabel(currentFund) }}
              </a-tag>
            </a-space>
          </a-descriptions-item>
          <a-descriptions-item label="总充值">
            {{ formatUsd(currentFund.totalGranted) }}
          </a-descriptions-item>
          <a-descriptions-item label="最后更新时间">
            {{ currentFund.updatedAt ? formatTime(currentFund.updatedAt) : '尚未初始化' }}
          </a-descriptions-item>
          <a-descriptions-item label="已预留">
            {{ formatUsd(currentFund.reserved) }}
          </a-descriptions-item>
          <a-descriptions-item label="已消耗">
            {{ formatUsd(currentFund.consumed) }}
          </a-descriptions-item>
          <a-descriptions-item label="余额说明">
            {{ walletSummary(currentFund) }}
          </a-descriptions-item>
        </a-descriptions>

        <a-space style="margin-top: 12px" wrap>
          <a-button v-if="canManage" type="primary" @click="openGrantModal">充值</a-button>
          <a-button v-if="canManage" @click="openAdjustModal">调整</a-button>
          <a-button :loading="walletLoading" @click="refreshWalletState">刷新钱包</a-button>
        </a-space>

        <div style="margin-top: 16px">
          <div style="font-weight: 600; margin-bottom: 8px">最近额度流水</div>
          <a-empty
            v-if="!walletLedgerLoading && walletLedger.length === 0"
            description="最近还没有额度流水"
          />
          <a-list v-else :data-source="walletLedger" size="small" bordered>
            <template #renderItem="{ item }">
              <a-list-item>
                <a-space direction="vertical" :size="2" style="width: 100%">
                  <a-space wrap>
                    <a-tag :color="fundLedgerTypeColor(item.type)">
                      {{ fundLedgerTypeLabel(item.type) }}
                    </a-tag>
                    <span>{{ formatLedgerAmount(item) }}</span>
                    <span style="color: rgba(0, 0, 0, 0.45)">余额 {{ formatUsd(item.balanceAfter) }}</span>
                  </a-space>
                  <span style="color: rgba(0, 0, 0, 0.65)">
                    {{ item.note || '无备注' }}
                  </span>
                  <span style="color: rgba(0, 0, 0, 0.45)">
                    {{ formatTime(item.createdAt) }}
                  </span>
                </a-space>
              </a-list-item>
            </template>
          </a-list>
        </div>
      </a-spin>
    </a-card>

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

          <a-col :xs="24" :lg="12">
            <a-form-item label="项目组标识">
              <a-input
                :value="form.projectGroupKey || ''"
                placeholder="例如 core-platform"
                :disabled="!canManage"
                @update:value="form.projectGroupKey = valueToNullableString($event)"
              />
              <a-typography-text type="secondary">
                Dashboard 会优先按这个标识聚合项目；同组织下标识一致的项目会归到同一项目组。
              </a-typography-text>
            </a-form-item>
          </a-col>

          <a-col :xs="24" :lg="12">
            <a-form-item label="项目组展示名">
              <a-input
                :value="form.projectGroupLabel || ''"
                placeholder="例如 核心平台"
                :disabled="!canManage"
                @update:value="form.projectGroupLabel = valueToNullableString($event)"
              />
              <a-typography-text type="secondary">
                为空时会回退显示项目组标识；两个字段都不填时，Dashboard 才会使用派生规则兜底。
              </a-typography-text>
            </a-form-item>
          </a-col>

          <a-col :xs="24" :lg="12">
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
        </a-row>
      </a-form>
    </a-card>

    <a-modal
      :open="grantModalOpen"
      title="为项目充值"
      ok-text="确认充值"
      cancel-text="取消"
      :confirm-loading="fundMutating"
      @ok="submitGrant"
      @cancel="closeGrantModal"
    >
      <a-form layout="vertical">
        <a-form-item label="充值金额 (USD)">
          <a-input-number
            :value="grantForm.amountUsd"
            :min="0.01"
            :step="10"
            style="width: 100%"
            @update:value="grantForm.amountUsd = valueToNumber($event)"
          />
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea
            :value="grantForm.note"
            :rows="3"
            @update:value="grantForm.note = valueToString($event)"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      :open="adjustModalOpen"
      title="调整项目余额"
      ok-text="确认调整"
      cancel-text="取消"
      :confirm-loading="fundMutating"
      @ok="submitAdjust"
      @cancel="closeAdjustModal"
    >
      <a-form layout="vertical">
        <a-form-item label="调整金额 (USD)">
          <a-input-number
            :value="adjustForm.amountUsd"
            :step="10"
            style="width: 100%"
            @update:value="adjustForm.amountUsd = valueToNumber($event)"
          />
          <a-typography-text type="secondary">
            输入正数表示追加额度，输入负数表示扣减当前可用额度。
          </a-typography-text>
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea
            :value="adjustForm.note"
            :rows="3"
            @update:value="adjustForm.note = valueToString($event)"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  type Environment,
  type ModelsConfig,
  type ProjectModelFund,
  type ProjectModelFundLedgerEntry,
  type ProjectSettings,
  adjustProjectFund,
  getModelsConfig,
  getProjectFund,
  getProjectFundLedger,
  grantProjectFund,
  listEnvironments,
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
const walletLoading = ref(false);
const walletLedgerLoading = ref(false);
const saving = ref(false);
const fundMutating = ref(false);
const modelsData = ref<ModelsConfig | null>(null);
const environments = ref<Environment[]>([]);
const projectFund = ref<ProjectModelFund | null>(null);
const walletLedger = ref<ProjectModelFundLedgerEntry[]>([]);
const fundError = ref("");
const walletLedgerError = ref("");
const grantModalOpen = ref(false);
const adjustModalOpen = ref(false);

const grantForm = reactive<{
  amountUsd?: number;
  note: string;
}>({
  amountUsd: undefined,
  note: "",
});

const adjustForm = reactive<{
  amountUsd?: number;
  note: string;
}>({
  amountUsd: undefined,
  note: "",
});

const form = reactive<ProjectSettings>({
  defaultModel: "",
  defaultEnvironmentId: "",
  projectGroupKey: null,
  projectGroupLabel: null,
  maxConcurrency: undefined,
});

const canManage = computed(() => {
  const globalRole = authStore.user?.role;
  if (globalRole === "platform_admin" || globalRole === "org_admin") {
    return true;
  }
  const projectRole = authStore.user?.projects?.find((item) => item.id === props.projectId)?.role;
  return projectRole === "project_admin";
});

const currentFund = computed(
  (): ProjectModelFund =>
    projectFund.value || {
      id: null,
      projectId: props.projectId,
      currency: "USD",
      totalGranted: 0,
      reserved: 0,
      consumed: 0,
      available: 0,
      status: "depleted",
      createdAt: null,
      updatedAt: null,
      hasFund: false,
    },
);

const walletError = computed(() => [fundError.value, walletLedgerError.value].filter(Boolean).join("；"));

function resolveModelOptionValue(model: Record<string, unknown>) {
  const id = typeof model.id === "string" ? model.id.trim() : "";
  const provider = typeof model.provider === "string" ? model.provider.trim() : "";
  const route = typeof model.route === "string" ? model.route.trim() : "";
  if (route) {
    return provider === "github-copilot" && route === `${provider}:${id}` ? id || route : route;
  }

  if (!id) {
    return "";
  }

  return provider && provider !== "github-copilot" ? `${provider}:${id}` : id;
}

const knownModelValues = computed(() => {
  const values = new Set<string>();
  for (const model of modelsData.value?.list || []) {
    const value = resolveModelOptionValue(model as Record<string, unknown>);
    if (value) {
      values.add(value);
    }
  }

  return values;
});

const canValidateDefaultModel = computed(() => knownModelValues.value.size > 0);

const hasInvalidDefaultModel = computed(() => {
  const currentModel = form.defaultModel.trim();
  return Boolean(currentModel) && canValidateDefaultModel.value && !knownModelValues.value.has(currentModel);
});

const modelOptions = computed(() => {
  const currentModel = form.defaultModel || "";
  const options = (modelsData.value?.list || [])
    .map((model) => {
      const id = typeof model.id === "string" ? model.id : "";
      if (!id) return null;
      const name = typeof model.name === "string" ? model.name : "";
      const provider = typeof model.provider === "string" ? model.provider : "";
      const value = resolveModelOptionValue(model as Record<string, unknown>);
      if (!value) return null;
      const meta = [name, provider].filter(Boolean).join(" / ");
      return {
        value,
        label: meta ? `${id} (${meta})` : id,
      };
    })
    .filter((option): option is { value: string; label: string } => Boolean(option));

  if (currentModel && !options.some((option) => option.value === currentModel)) {
    options.unshift({
      value: currentModel,
      label: `${currentModel} (${hasInvalidDefaultModel.value ? "当前值，已失效" : "当前值"})`,
    });
  }

  return options;
});

const environmentOptions = computed(() =>
  environments.value.map((environment) => ({
    value: environment.id,
    label: `${environment.name} (${environment.riskLevel})`,
  })),
);

const selectedEnvironmentLabel = computed(() => {
  const selected = environments.value.find((item) => item.id === form.defaultEnvironmentId);
  return selected ? `${selected.name} (${selected.riskLevel})` : "未配置";
});

watch(
  () => props.settings,
  (settings) => {
    form.defaultModel = settings?.defaultModel || "";
    form.defaultEnvironmentId = settings?.defaultEnvironmentId || "";
    form.projectGroupKey = settings?.projectGroupKey || null;
    form.projectGroupLabel = settings?.projectGroupLabel || null;
    form.maxConcurrency = settings?.maxConcurrency;
  },
  { immediate: true, deep: true },
);

onMounted(async () => {
  modelsLoading.value = true;
  environmentsLoading.value = true;

  try {
    const modelsRequest = canManage.value ? getModelsConfig() : Promise.resolve(null);
    const [modelsResult, environmentsResult] = await Promise.allSettled([
      modelsRequest,
      listEnvironments(props.projectId),
    ]);

    modelsData.value =
      modelsResult.status === "fulfilled" ? (modelsResult.value?.data ?? null) : null;
    environments.value = environmentsResult.status === "fulfilled" ? environmentsResult.value : [];
  } finally {
    modelsLoading.value = false;
    environmentsLoading.value = false;
  }

  await refreshWalletState();
});

async function refreshWalletState() {
  await Promise.all([refreshProjectFund(), refreshProjectFundLedger()]);
}

async function refreshProjectFund() {
  walletLoading.value = true;
  fundError.value = "";

  try {
    projectFund.value = await getProjectFund(props.projectId);
  } catch (error) {
    fundError.value = `加载项目额度钱包失败: ${error}`;
  } finally {
    walletLoading.value = false;
  }
}

async function refreshProjectFundLedger() {
  walletLedgerLoading.value = true;
  walletLedgerError.value = "";

  try {
    const result = await getProjectFundLedger(props.projectId, { limit: 5 });
    walletLedger.value = result.items;
  } catch (error) {
    walletLedgerError.value = `加载钱包流水失败: ${error}`;
  } finally {
    walletLedgerLoading.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  try {
    const clearingInvalidDefaultModel = hasInvalidDefaultModel.value;
    const normalizedDefaultModel = clearingInvalidDefaultModel ? "" : form.defaultModel;
    const settings: ProjectSettings = {
      ...(props.settings || {}),
      ...upsertOptionalStringSetting("defaultModel", normalizedDefaultModel),
      ...upsertOptionalStringSetting("defaultEnvironmentId", form.defaultEnvironmentId),
      ...upsertNullableStringSetting("projectGroupKey", form.projectGroupKey),
      ...upsertNullableStringSetting("projectGroupLabel", form.projectGroupLabel),
      ...upsertOptionalNumberSetting("maxConcurrency", form.maxConcurrency),
    };

    await updateProject(props.projectId, { settings });
    if (clearingInvalidDefaultModel) {
      form.defaultModel = "";
    }
    emit("updated", settings);
    message.success(clearingInvalidDefaultModel ? "项目设置已保存，已清除失效默认模型" : "项目设置已保存");
  } catch (error) {
    message.error(`保存设置失败: ${error}`);
  } finally {
    saving.value = false;
  }
}

function openGrantModal() {
  grantForm.amountUsd = undefined;
  grantForm.note = "";
  grantModalOpen.value = true;
}

function closeGrantModal() {
  grantModalOpen.value = false;
  grantForm.amountUsd = undefined;
  grantForm.note = "";
}

function openAdjustModal() {
  adjustForm.amountUsd = undefined;
  adjustForm.note = "";
  adjustModalOpen.value = true;
}

function closeAdjustModal() {
  adjustModalOpen.value = false;
  adjustForm.amountUsd = undefined;
  adjustForm.note = "";
}

async function submitGrant() {
  if (!canManage.value) {
    return;
  }

  if (typeof grantForm.amountUsd !== "number" || grantForm.amountUsd <= 0) {
    message.error("请输入大于 0 的充值金额");
    return;
  }

  fundMutating.value = true;
  try {
    const result = await grantProjectFund(props.projectId, {
      amountUsd: grantForm.amountUsd,
      note: grantForm.note.trim() || undefined,
    });
    projectFund.value = result.fund;
    walletLedger.value = [
      result.ledgerEntry,
      ...walletLedger.value.filter((item) => item.id !== result.ledgerEntry.id),
    ].slice(0, 5);
    closeGrantModal();
    message.success("项目额度已充值");
  } catch (error) {
    message.error(`充值失败: ${error}`);
  } finally {
    fundMutating.value = false;
  }
}

async function submitAdjust() {
  if (!canManage.value) {
    return;
  }

  if (typeof adjustForm.amountUsd !== "number" || adjustForm.amountUsd === 0) {
    message.error("请输入非 0 的调整金额");
    return;
  }

  fundMutating.value = true;
  try {
    const result = await adjustProjectFund(props.projectId, {
      amountUsd: adjustForm.amountUsd,
      note: adjustForm.note.trim() || undefined,
    });
    projectFund.value = result.fund;
    walletLedger.value = [
      result.ledgerEntry,
      ...walletLedger.value.filter((item) => item.id !== result.ledgerEntry.id),
    ].slice(0, 5);
    closeAdjustModal();
    message.success("项目额度已调整");
  } catch (error) {
    message.error(`调整失败: ${error}`);
  } finally {
    fundMutating.value = false;
  }
}

function valueToString(value: unknown) {
  return value == null ? "" : String(value);
}

function valueToNullableString(value: unknown) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || null;
}

function valueToNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function upsertOptionalStringSetting<Key extends keyof ProjectSettings>(key: Key, value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized
    ? ({ [key]: normalized } as Pick<ProjectSettings, Key>)
    : ({ [key]: undefined } as Pick<ProjectSettings, Key>);
}

function upsertNullableStringSetting<Key extends keyof ProjectSettings>(key: Key, value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return { [key]: normalized || null } as Pick<ProjectSettings, Key>;
}

function upsertOptionalNumberSetting<Key extends keyof ProjectSettings>(key: Key, value: unknown) {
  return typeof value === "number"
    ? ({ [key]: value } as Pick<ProjectSettings, Key>)
    : ({ [key]: undefined } as Pick<ProjectSettings, Key>);
}

function walletHealthColor(fund: ProjectModelFund) {
  if (fund.available <= 0) return "red";
  if (fund.totalGranted <= 0) return "red";
  const ratio = fund.available / fund.totalGranted;
  if (ratio <= 0.2) return "gold";
  return "green";
}

function walletHealthLabel(fund: ProjectModelFund) {
  if (!fund.hasFund) return "未充值";
  if (fund.available <= 0) return "额度耗尽";
  if (fund.totalGranted > 0 && fund.available / fund.totalGranted <= 0.2) return "余额偏低";
  return "余额正常";
}

function walletSummary(fund: ProjectModelFund) {
  if (!fund.hasFund) {
    return "项目还没有初始化任何额度记录。";
  }
  if (fund.available <= 0) {
    return "当前余额已经耗尽，付费模型后续应由钱包余额阻断。";
  }
  return `当前还可继续支撑 ${formatUsd(fund.available)} 的付费模型使用。`;
}

function fundLedgerTypeLabel(type: ProjectModelFundLedgerEntry["type"]) {
  if (type === "grant") return "充值";
  if (type === "adjust") return "调整";
  if (type === "reserve") return "预留";
  if (type === "consume") return "扣费";
  if (type === "refund") return "退回";
  return type;
}

function fundLedgerTypeColor(type: ProjectModelFundLedgerEntry["type"]) {
  if (type === "grant") return "green";
  if (type === "adjust") return "blue";
  if (type === "reserve") return "gold";
  if (type === "consume") return "red";
  if (type === "refund") return "cyan";
  return "default";
}

function formatLedgerAmount(entry: ProjectModelFundLedgerEntry) {
  if (entry.type === "consume" || entry.type === "reserve") {
    return `-${formatUsd(Math.abs(entry.amountUsd)).slice(1)}`;
  }
  if (entry.type === "refund" || entry.type === "grant") {
    return `+${formatUsd(Math.abs(entry.amountUsd)).slice(1)}`;
  }
  if (entry.amountUsd > 0) {
    return `+${formatUsd(entry.amountUsd).slice(1)}`;
  }
  if (entry.amountUsd < 0) {
    return `-${formatUsd(Math.abs(entry.amountUsd)).slice(1)}`;
  }
  return formatUsd(0);
}

function formatUsd(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleString();
}
</script>