<template>
  <div style="padding: 24px">
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px" wrap="wrap" gap="middle">
      <div>
        <a-typography-title :level="3" style="margin: 0">众包协作</a-typography-title>
        <a-typography-text type="secondary" style="display: block; margin-top: 4px">
          任务边界、贡献者等级、代码所有权和 commit preview 的控制入口。
        </a-typography-text>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">刷新</a-button>
      </a-space>
    </a-flex>

    <a-alert
      v-if="loadError"
      type="error"
      :message="loadError"
      show-icon
      closable
      style="margin-bottom: 16px"
      @close="loadError = ''"
    />

    <a-alert
      v-if="!projectStore.currentProjectId"
      type="warning"
      message="请先选择项目后再维护代码所有权规则。"
      show-icon
      style="margin-bottom: 16px"
    />

    <a-row :gutter="[16, 16]">
      <a-col :xs="24" :lg="8">
        <a-card title="我的贡献者档案" :loading="profileLoading">
          <a-descriptions v-if="myProfile" :column="1" size="small" bordered>
            <a-descriptions-item label="等级">
              <a-tag :color="levelColor(myProfile.level)">{{ myProfile.level }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="状态">
              <a-tag :color="myProfile.status === 'active' ? 'green' : 'red'">
                {{ statusLabel(myProfile.status) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="信誉分">
              {{ myProfile.reputationScore.toFixed(2) }}
            </a-descriptions-item>
            <a-descriptions-item label="每日任务配额">
              {{ myProfile.dailyTaskQuota }}
            </a-descriptions-item>
            <a-descriptions-item label="活跃任务配额">
              {{ myProfile.activeTaskQuota }}
            </a-descriptions-item>
            <a-descriptions-item label="Runtime 分钟配额">
              {{ myProfile.runtimeMinutesQuota }}
            </a-descriptions-item>
          </a-descriptions>
          <a-empty v-else description="暂无档案" />
        </a-card>
      </a-col>

      <a-col :xs="24" :lg="16">
        <a-card title="代码所有权规则">
          <a-form layout="inline" style="margin-bottom: 16px" @submit.prevent>
            <a-form-item label="路径">
              <a-input
                :value="ownerForm.pathPattern"
                placeholder="services/payments/**"
                style="width: 220px"
                @update:value="ownerForm.pathPattern = String($event ?? '')"
              />
            </a-form-item>
            <a-form-item label="Owner">
              <a-input
                :value="ownerForm.ownerRef"
                placeholder="@payments-team"
                style="width: 180px"
                @update:value="ownerForm.ownerRef = String($event ?? '')"
              />
            </a-form-item>
            <a-form-item label="类型">
              <a-select
                :value="ownerForm.ownerType"
                style="width: 100px"
                @update:value="ownerForm.ownerType = String($event ?? 'team')"
              >
                <a-select-option value="team">团队</a-select-option>
                <a-select-option value="role">角色</a-select-option>
                <a-select-option value="user">用户</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="风险">
              <a-select
                :value="ownerForm.riskLevel"
                style="width: 100px"
                @update:value="ownerForm.riskLevel = String($event ?? 'low')"
              >
                <a-select-option value="low">低</a-select-option>
                <a-select-option value="medium">中</a-select-option>
                <a-select-option value="high">高</a-select-option>
                <a-select-option value="critical">关键</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item>
              <a-button
                type="primary"
                :loading="savingOwner"
                :disabled="!canCreateOwner"
                @click="createOwner"
              >
                新增规则
              </a-button>
            </a-form-item>
          </a-form>

          <a-table
            :data-source="codeOwners"
            :columns="ownerColumns"
            :loading="ownersLoading"
            row-key="id"
            size="small"
            :pagination="{ pageSize: 8 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'riskLevel'">
                <a-tag :color="riskColor(record.riskLevel)">{{ riskLabel(record.riskLevel) }}</a-tag>
              </template>
              <template v-if="column.key === 'requiresApproval'">
                {{ record.requiresApproval ? '需要' : '不需要' }}
              </template>
              <template v-if="column.key === 'actions'">
                <a-popconfirm
                  title="删除该代码所有权规则？"
                  ok-text="删除"
                  cancel-text="取消"
                  @confirm="deleteOwner(record.id)"
                >
                  <a-button danger size="small">删除</a-button>
                </a-popconfirm>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-col>

      <a-col :xs="24">
        <a-card title="Owner 解析">
          <a-flex gap="middle" align="start" wrap="wrap">
            <a-textarea
              :value="resolveInput"
              placeholder="每行一个文件路径，例如：services/payments/checkout.ts"
              style="width: min(640px, 100%); min-height: 96px"
              @update:value="resolveInput = String($event ?? '')"
            />
            <a-space direction="vertical">
              <a-button
                type="primary"
                :loading="resolvingOwners"
                :disabled="!projectStore.currentProjectId || resolvePaths.length === 0"
                @click="resolveOwners"
              >
                解析 owner
              </a-button>
              <a-typography-text v-if="ownerResolution" type="secondary">
                总风险：{{ riskLabel(ownerResolution.overallRisk) }}，审批：{{ ownerResolution.approvalRequired ? '需要' : '不需要' }}
              </a-typography-text>
            </a-space>
          </a-flex>

          <a-table
            v-if="ownerResolution"
            :data-source="ownerResolution.data"
            :columns="resolutionColumns"
            row-key="path"
            size="small"
            style="margin-top: 16px"
            :pagination="false"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'owners'">
                <a-space wrap>
                  <a-tag v-for="owner in record.owners" :key="owner.id">
                    {{ owner.ownerType }}: {{ owner.ownerRef }}
                  </a-tag>
                  <a-tag v-if="record.owners.length === 0" color="default">未匹配</a-tag>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useAuthStore } from "../stores/auth";
import { useProjectStore } from "../stores/project";

interface ContributorProfile {
  userId: string;
  level: "L1" | "L2" | "L3" | "L4" | "L5";
  status: "active" | "suspended" | "banned";
  reputationScore: number;
  dailyTaskQuota: number;
  activeTaskQuota: number;
  runtimeMinutesQuota: number;
}

interface CodeOwner {
  id: string;
  projectId: string;
  pathPattern: string;
  ownerType: "user" | "role" | "team";
  ownerRef: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
}

interface OwnerResolution {
  data: Array<{ path: string; owners: CodeOwner[] }>;
  overallRisk: CodeOwner["riskLevel"];
  approvalRequired: boolean;
}

const authStore = useAuthStore();
const projectStore = useProjectStore();
const loading = ref(false);
const profileLoading = ref(false);
const ownersLoading = ref(false);
const savingOwner = ref(false);
const resolvingOwners = ref(false);
const loadError = ref("");
const myProfile = ref<ContributorProfile | null>(null);
const codeOwners = ref<CodeOwner[]>([]);
const ownerResolution = ref<OwnerResolution | null>(null);
const resolveInput = ref("");

const ownerForm = reactive({
  pathPattern: "",
  ownerType: "team",
  ownerRef: "",
  riskLevel: "low",
});

const ownerColumns = [
  { title: "路径", dataIndex: "pathPattern", key: "pathPattern" },
  { title: "Owner 类型", dataIndex: "ownerType", key: "ownerType" },
  { title: "Owner", dataIndex: "ownerRef", key: "ownerRef" },
  { title: "风险", dataIndex: "riskLevel", key: "riskLevel" },
  { title: "审批", dataIndex: "requiresApproval", key: "requiresApproval" },
  { title: "操作", key: "actions", width: 96 },
];

const resolutionColumns = [
  { title: "文件", dataIndex: "path", key: "path" },
  { title: "匹配 owner", key: "owners" },
];

const resolvePaths = computed(() =>
  resolveInput.value
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean),
);

const canCreateOwner = computed(
  () =>
    Boolean(projectStore.currentProjectId) &&
    ownerForm.pathPattern.trim() !== "" &&
    ownerForm.ownerRef.trim() !== "",
);

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data.error || `HTTP ${response.status}`));
  }
  return data as T;
}

async function loadProfile() {
  profileLoading.value = true;
  try {
    const result = await apiRequest<{ data: ContributorProfile }>("/contributors/me");
    myProfile.value = result.data;
  } finally {
    profileLoading.value = false;
  }
}

async function loadCodeOwners() {
  if (!projectStore.currentProjectId) {
    codeOwners.value = [];
    return;
  }
  ownersLoading.value = true;
  try {
    const result = await apiRequest<{ data: CodeOwner[] }>(
      `/code-owners?projectId=${encodeURIComponent(projectStore.currentProjectId)}`,
    );
    codeOwners.value = result.data;
  } finally {
    ownersLoading.value = false;
  }
}

async function loadAll() {
  loading.value = true;
  loadError.value = "";
  try {
    await Promise.all([loadProfile(), loadCodeOwners()]);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function createOwner() {
  if (!canCreateOwner.value) return;
  savingOwner.value = true;
  try {
    await apiRequest("/code-owners", {
      method: "POST",
      body: JSON.stringify({
        projectId: projectStore.currentProjectId,
        pathPattern: ownerForm.pathPattern.trim(),
        ownerType: ownerForm.ownerType,
        ownerRef: ownerForm.ownerRef.trim(),
        riskLevel: ownerForm.riskLevel,
        requiresApproval: true,
      }),
    });
    ownerForm.pathPattern = "";
    ownerForm.ownerRef = "";
    await loadCodeOwners();
    message.success("代码所有权规则已新增");
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    savingOwner.value = false;
  }
}

async function deleteOwner(ownerId: string) {
  try {
    await apiRequest(`/code-owners/${ownerId}`, { method: "DELETE" });
    await loadCodeOwners();
    message.success("代码所有权规则已删除");
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function resolveOwners() {
  if (!projectStore.currentProjectId || resolvePaths.value.length === 0) return;
  resolvingOwners.value = true;
  try {
    ownerResolution.value = await apiRequest<OwnerResolution>("/code-owners/resolve", {
      method: "POST",
      body: JSON.stringify({
        projectId: projectStore.currentProjectId,
        paths: resolvePaths.value,
      }),
    });
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    resolvingOwners.value = false;
  }
}

function levelColor(level: ContributorProfile["level"]) {
  return {
    L1: "blue",
    L2: "cyan",
    L3: "green",
    L4: "gold",
    L5: "red",
  }[level];
}

function riskColor(level: CodeOwner["riskLevel"]) {
  return {
    low: "green",
    medium: "gold",
    high: "orange",
    critical: "red",
  }[level];
}

function riskLabel(level: CodeOwner["riskLevel"]) {
  return {
    low: "低",
    medium: "中",
    high: "高",
    critical: "关键",
  }[level];
}

function statusLabel(status: ContributorProfile["status"]) {
  return {
    active: "活跃",
    suspended: "暂停",
    banned: "封禁",
  }[status];
}

onMounted(async () => {
  if (projectStore.projects.length === 0) {
    await projectStore.loadProjects();
  }
  await loadAll();
});

watch(
  () => projectStore.currentProjectId,
  async () => {
    ownerResolution.value = null;
    await loadCodeOwners();
  },
);
</script>
