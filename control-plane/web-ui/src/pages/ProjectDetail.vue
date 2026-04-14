<template>
  <div style="padding: 24px">
    <a-page-header
      :title="project?.name || '加载中...'"
      :sub-title="projectSubtitle"
      @back="$router.push('/projects')"
    >
      <template v-if="project" #extra>
        <a-space wrap data-testid="project-header-actions">
          <a-button type="primary" data-testid="open-project-operating-mode" @click="router.push(`/projects/${project.id}/operating-mode`)">打开运行档位</a-button>
          <a-button data-testid="open-recommended-scenarios" @click="router.push(`/projects/${project.id}/recommended-scenarios`)">推荐场景</a-button>
          <a-dropdown>
            <a-button>更多操作</a-button>
            <template #overlay>
              <a-menu>
                <a-menu-item @click="router.push(`/projects/${project.id}/orchestration`)">查看介入编排</a-menu-item>
                <a-menu-item data-testid="open-management-operations-center" @click="router.push(`/projects/${project.id}/management-operations`)">管理介入总览</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </a-space>
      </template>
    </a-page-header>

    <a-spin :spinning="loading" v-if="loading" style="display: block; text-align: center; padding: 60px" />

    <template v-else-if="project">
      <a-tabs :activeKey="activeTab" @update:activeKey="activeTab = String($event)">
        <!-- 概览 Tab -->
        <a-tab-pane key="overview" tab="概览">
          <a-row :gutter="[16, 16]">
            <a-col :xs="24" :lg="12">
              <a-card title="基本信息" size="small">
                <a-descriptions :column="1" bordered size="small">
                  <a-descriptions-item label="项目 ID">
                    <a-typography-text code>{{ project.id }}</a-typography-text>
                  </a-descriptions-item>
                  <a-descriptions-item label="名称">
                    <span v-if="!editingName">
                      {{ project.name }}
                      <a-button v-if="canManage" type="link" size="small" @click="startEditName">编辑</a-button>
                    </span>
                    <a-space v-else>
                      <a-input
                        :value="editNameValue"
                        size="small"
                        style="width: 200px"
                        @update:value="editNameValue = String($event ?? '')"
                        @press-enter="saveName"
                      />
                      <a-button type="primary" size="small" :loading="saving" @click="saveName">保存</a-button>
                      <a-button size="small" @click="editingName = false">取消</a-button>
                    </a-space>
                  </a-descriptions-item>
                  <a-descriptions-item label="Slug">{{ project.slug }}</a-descriptions-item>
                  <a-descriptions-item label="组织 ID">
                    <a-typography-text code>{{ project.orgId }}</a-typography-text>
                  </a-descriptions-item>
                  <a-descriptions-item label="创建时间">{{ formatTime(project.createdAt || '') }}</a-descriptions-item>
                </a-descriptions>
              </a-card>
            </a-col>

            <a-col :xs="24" :lg="12">
              <a-card title="描述" size="small">
                <div v-if="!editingDesc">
                  <p style="margin: 0">{{ project.description || '暂无描述' }}</p>
                  <a-button v-if="canManage" type="link" size="small" @click="startEditDesc">编辑</a-button>
                </div>
                <div v-else>
                  <a-textarea
                    :value="editDescValue"
                    :rows="4"
                    :maxlength="500"
                    @update:value="editDescValue = String($event ?? '')"
                  />
                  <a-space style="margin-top: 8px">
                    <a-button type="primary" size="small" :loading="saving" @click="saveDesc">保存</a-button>
                    <a-button size="small" @click="editingDesc = false">取消</a-button>
                  </a-space>
                </div>
              </a-card>
            </a-col>
          </a-row>

          <a-card title="项目设置" size="small" style="margin-top: 16px">
            <a-descriptions :column="{ xs: 1, lg: 3 }" bordered size="small">
              <a-descriptions-item label="默认模型">
                {{ project.settings?.defaultModel || '未配置' }}
              </a-descriptions-item>
              <a-descriptions-item label="默认环境">
                {{ project.settings?.defaultEnvironmentId || '未配置' }}
              </a-descriptions-item>
              <a-descriptions-item label="项目组标识">
                {{ project.settings?.projectGroupKey || '未配置' }}
              </a-descriptions-item>
              <a-descriptions-item label="项目组展示名">
                {{ project.settings?.projectGroupLabel || '未配置' }}
              </a-descriptions-item>
              <a-descriptions-item label="审批策略">
                {{ approvalPolicyLabel(project.settings?.approvalPolicy) }}
              </a-descriptions-item>
              <a-descriptions-item label="最大并发">
                {{ project.settings?.maxConcurrency || '未配置' }}
              </a-descriptions-item>
              <a-descriptions-item label="钱包可用额度">
                <a-space>
                  <span>{{ formatUsd(projectFundSummary.available) }}</span>
                  <a-tag :color="projectFundHealthColor">
                    {{ projectFundHealthLabel }}
                  </a-tag>
                </a-space>
              </a-descriptions-item>
              <a-descriptions-item label="钱包总充值">
                {{ formatUsd(projectFundSummary.totalGranted) }}
              </a-descriptions-item>
              <a-descriptions-item label="钱包分布">
                已预留 {{ formatUsd(projectFundSummary.reserved) }} · 已消耗 {{ formatUsd(projectFundSummary.consumed) }}
              </a-descriptions-item>
            </a-descriptions>
          </a-card>

          <a-card title="额度钱包概览" size="small" style="margin-top: 16px">
            <a-spin :spinning="projectFundLoading">
              <a-alert
                v-if="projectFundError"
                type="error"
                show-icon
                :message="projectFundError"
                style="margin-bottom: 12px"
              />

              <a-descriptions :column="{ xs: 1, lg: 2 }" bordered size="small">
                <a-descriptions-item label="当前可用额度">
                  <a-space>
                    <span style="font-weight: 600">{{ formatUsd(projectFundSummary.available) }}</span>
                    <a-tag :color="projectFundHealthColor">
                      {{ projectFundHealthLabel }}
                    </a-tag>
                  </a-space>
                </a-descriptions-item>
                <a-descriptions-item label="最后更新时间">
                  {{ projectFundSummary.updatedAt ? formatTime(projectFundSummary.updatedAt) : '尚未初始化' }}
                </a-descriptions-item>
                <a-descriptions-item label="总充值">
                  {{ formatUsd(projectFundSummary.totalGranted) }}
                </a-descriptions-item>
                <a-descriptions-item label="已预留">
                  {{ formatUsd(projectFundSummary.reserved) }}
                </a-descriptions-item>
                <a-descriptions-item label="已消耗">
                  {{ formatUsd(projectFundSummary.consumed) }}
                </a-descriptions-item>
                <a-descriptions-item label="最近流水数">
                  {{ projectFundLedgerRows.length }}
                </a-descriptions-item>
              </a-descriptions>

              <a-alert
                v-if="!projectFundError"
                style="margin-top: 12px"
                :type="projectFundAlertType"
                show-icon
                :message="projectFundHealthMessage"
                :description="projectFundHealthDescription"
              />

              <div style="margin-top: 12px">
                <div style="font-weight: 600; margin-bottom: 8px">最近额度流水</div>
                <a-empty
                  v-if="projectFundLedgerRows.length === 0"
                  description="最近还没有额度流水"
                />
                <a-list v-else size="small" bordered :data-source="projectFundLedgerRows">
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <a-space direction="vertical" :size="2" style="width: 100%">
                        <a-space wrap>
                          <a-tag :color="fundLedgerTypeColor(item.type)">
                            {{ fundLedgerTypeLabel(item.type) }}
                          </a-tag>
                          <span>{{ formatFundLedgerAmount(item) }}</span>
                          <span style="color: rgba(0, 0, 0, 0.45)">余额 {{ formatUsd(item.balanceAfter) }}</span>
                        </a-space>
                        <span style="color: rgba(0, 0, 0, 0.65)">{{ item.note || '无备注' }}</span>
                        <span style="color: rgba(0, 0, 0, 0.45)">{{ formatTime(item.createdAt) }}</span>
                      </a-space>
                    </a-list-item>
                  </template>
                </a-list>
              </div>

              <a-space v-if="project" style="margin-top: 12px" wrap>
                <a-button :loading="projectFundLoading" @click="refreshProjectFund(project.id)">
                  刷新钱包
                </a-button>
                <a-button @click="activeTab = 'settings'">
                  前往设置充值
                </a-button>
              </a-space>
            </a-spin>
          </a-card>

          <a-card title="最近对话调用账本" size="small" style="margin-top: 16px">
            <a-spin :spinning="runtimeUsageLoading">
              <a-alert
                v-if="runtimeUsageError"
                type="error"
                show-icon
                :message="runtimeUsageError"
                style="margin-bottom: 12px"
              />

              <a-descriptions :column="{ xs: 1, lg: 4 }" bordered size="small">
                <a-descriptions-item label="对话分支数">
                  {{ runtimeUsageList?.totals.ledgerCount ?? 0 }}
                </a-descriptions-item>
                <a-descriptions-item label="模型调用次数">
                  {{ runtimeUsageList?.totals.requestCount ?? 0 }}
                </a-descriptions-item>
                <a-descriptions-item label="累计 Token">
                  {{ runtimeUsageList?.totals.totalTokens ?? 0 }}
                </a-descriptions-item>
                <a-descriptions-item label="累计成本">
                  {{ formatUsd(runtimeUsageList?.totals.costUsd ?? 0) }}
                </a-descriptions-item>
              </a-descriptions>

              <a-empty
                v-if="!runtimeUsageLoading && runtimeUsageRows.length === 0"
                description="最近还没有 runtime usage ledger 数据"
                style="margin-top: 12px"
              />

              <a-table
                v-else
                :data-source="runtimeUsageRows"
                :pagination="false"
                row-key="id"
                size="small"
                style="margin-top: 12px"
              >
                <a-table-column title="对话 / 分支" key="session">
                  <template #default="{ record }">
                    <div>
                      <div>对话分支 {{ record.runtimeSessionId }}</div>
                      <div style="color: rgba(0, 0, 0, 0.45)">
                        {{ record.taskId ? `关联任务 ${record.taskId}` : '未绑定任务' }}
                      </div>
                    </div>
                  </template>
                </a-table-column>
                <a-table-column title="入口" key="entrypoint" :width="160">
                  <template #default="{ record }">
                    <div>
                      <div>{{ record.executionSource }}</div>
                      <div style="color: rgba(0, 0, 0, 0.45)">{{ record.entrypointType }}</div>
                    </div>
                  </template>
                </a-table-column>
                <a-table-column title="状态" key="status" :width="120">
                  <template #default="{ record }">
                    <a-tag :color="runtimeUsageStatusColor(record.status)">
                      {{ runtimeUsageStatusLabel(record.status) }}
                    </a-tag>
                  </template>
                </a-table-column>
                <a-table-column title="调用次数" key="counts" :width="140">
                  <template #default="{ record }">
                    <div>
                      <div>模型 {{ record.requestCount }} 次</div>
                      <div style="color: rgba(0, 0, 0, 0.45)">步骤 {{ record.stepCount }} 个</div>
                    </div>
                  </template>
                </a-table-column>
                <a-table-column title="Token" data-index="totalTokens" key="totalTokens" :width="120" />
                <a-table-column title="成本" key="costUsd" :width="120">
                  <template #default="{ record }">
                    {{ formatUsd(record.costUsd) }}
                  </template>
                </a-table-column>
                <a-table-column title="完成时间" key="finishedAt" :width="200">
                  <template #default="{ record }">
                    {{ formatTime(record.finishedAt || record.updatedAt) }}
                  </template>
                </a-table-column>
                <a-table-column title="操作" key="actions" :width="120">
                  <template #default="{ record }">
                    <a-button type="link" size="small" @click="openRuntimeUsageDrawer(record.id)">
                      查看明细
                    </a-button>
                  </template>
                </a-table-column>
              </a-table>

              <a-space v-if="project" style="margin-top: 12px" wrap>
                <a-button :loading="runtimeUsageLoading" @click="refreshRuntimeUsage(project.id)">
                  刷新账本
                </a-button>
              </a-space>
            </a-spin>
          </a-card>
        </a-tab-pane>

        <!-- 环境 Tab -->
        <a-tab-pane key="environments" tab="环境">
          <ProjectEnvironmentsPanel :project-id="project.id" />
        </a-tab-pane>

        <!-- 代码仓库 Tab -->
        <a-tab-pane key="repositories" tab="代码仓库">
          <ProjectRepositoriesPanel :project-id="project.id" />
        </a-tab-pane>

        <!-- 凭证 Tab -->
        <a-tab-pane key="credentials" tab="凭证">
          <ProjectCredentialsPanel :project-id="project.id" />
        </a-tab-pane>

        <!-- 成员 Tab -->
        <a-tab-pane key="members" tab="成员">
          <ProjectMembersPanel :project-id="project.id" />
        </a-tab-pane>

        <!-- 设置 Tab -->
        <a-tab-pane key="settings" tab="设置">
          <ProjectSettingsPanel
            :project-id="project.id"
            :settings="project.settings || undefined"
            @updated="handleSettingsUpdated"
          />
        </a-tab-pane>
      </a-tabs>
    </template>

    <a-result v-else status="404" title="项目不存在" sub-title="请检查项目 ID 是否正确">
      <template #extra>
        <a-button type="primary" @click="$router.push('/projects')">返回项目列表</a-button>
      </template>
    </a-result>

    <a-drawer
      :open="runtimeUsageDrawerOpen"
      @update:open="handleRuntimeUsageDrawerOpen"
      title="对话调用明细"
      placement="right"
      :width="720"
      :destroy-on-close="false"
    >
      <a-spin :spinning="runtimeUsageDetailLoading">
        <a-alert
          v-if="runtimeUsageDetailError"
          type="error"
          show-icon
          :message="runtimeUsageDetailError"
          style="margin-bottom: 12px"
        />

        <template v-if="runtimeUsageDetail">
          <a-descriptions :column="{ xs: 1, lg: 2 }" bordered size="small">
            <a-descriptions-item label="对话分支 ID">
              {{ runtimeUsageDetail.ledger.runtimeSessionId }}
            </a-descriptions-item>
            <a-descriptions-item label="状态">
              <a-tag :color="runtimeUsageStatusColor(runtimeUsageDetail.ledger.status)">
                {{ runtimeUsageStatusLabel(runtimeUsageDetail.ledger.status) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="关联任务">
              {{ runtimeUsageDetail.ledger.taskId || '未绑定任务' }}
            </a-descriptions-item>
            <a-descriptions-item label="入口来源">
              {{ runtimeUsageDetail.ledger.executionSource }} / {{ runtimeUsageDetail.ledger.entrypointType }}
            </a-descriptions-item>
            <a-descriptions-item label="默认模型">
              {{ formatLedgerModel(runtimeUsageDetail.ledger.defaultProviderId, runtimeUsageDetail.ledger.defaultModelId) }}
            </a-descriptions-item>
            <a-descriptions-item label="模型调用次数">
              {{ runtimeUsageDetail.ledger.requestCount }} 次
            </a-descriptions-item>
            <a-descriptions-item label="步骤数">
              {{ runtimeUsageDetail.ledger.stepCount }} 个
            </a-descriptions-item>
            <a-descriptions-item label="Judge / Hook 放大">
              {{ runtimeUsageDetail.ledger.judgeRequestCount }} / {{ runtimeUsageDetail.ledger.hookRequestCount }}
            </a-descriptions-item>
            <a-descriptions-item label="累计 Token">
              {{ runtimeUsageDetail.ledger.totalTokens }}
            </a-descriptions-item>
            <a-descriptions-item label="累计成本">
              {{ formatUsd(runtimeUsageDetail.ledger.costUsd) }}
            </a-descriptions-item>
          </a-descriptions>

          <div style="margin-top: 12px; font-weight: 600">步骤拆分</div>
          <a-space v-if="runtimeUsageBreakdownEntries.length > 0" wrap style="margin-top: 8px; margin-bottom: 12px">
            <a-tag v-for="item in runtimeUsageBreakdownEntries" :key="item.key">
              {{ runtimeUsageStepTypeLabel(item.key) }} × {{ item.count }}
            </a-tag>
          </a-space>

          <a-table
            :data-source="runtimeUsageDetail.steps"
            :pagination="false"
            row-key="id"
            size="small"
          >
            <a-table-column title="步骤" key="stepType" :width="140">
              <template #default="{ record }">
                <div>
                  <div>{{ runtimeUsageStepTypeLabel(record.stepType) }}</div>
                  <div style="color: rgba(0, 0, 0, 0.45)">{{ record.triggerType || record.amplificationSource || '-' }}</div>
                </div>
              </template>
            </a-table-column>
            <a-table-column title="模型" key="model">
              <template #default="{ record }">
                {{ formatLedgerModel(record.providerId, record.modelId) }}
              </template>
            </a-table-column>
            <a-table-column title="状态" key="status" :width="120">
              <template #default="{ record }">
                <a-tag :color="runtimeUsageStepStatusColor(record.status)">
                  {{ runtimeUsageStepStatusLabel(record.status) }}
                </a-tag>
              </template>
            </a-table-column>
            <a-table-column title="调用序号" data-index="requestIndex" key="requestIndex" :width="100" />
            <a-table-column title="Token" data-index="totalTokens" key="totalTokens" :width="100" />
            <a-table-column title="成本" key="costUsd" :width="100">
              <template #default="{ record }">
                {{ formatUsd(record.costUsd) }}
              </template>
            </a-table-column>
            <a-table-column title="完成时间" key="finishedAt" :width="200">
              <template #default="{ record }">
                {{ formatTime(record.finishedAt || record.createdAt) }}
              </template>
            </a-table-column>
          </a-table>
        </template>
      </a-spin>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type Project,
  type ProjectModelFund,
  type ProjectModelFundLedgerEntry,
  type ProjectRuntimeUsageLedgerDetailResponse,
  type ProjectRuntimeUsageLedgerListResponse,
  type ProjectSettings,
  getProject,
  getProjectFund,
  getProjectFundLedger,
  getProjectRuntimeUsageLedgerDetail,
  getProjectRuntimeUsageLedgers,
  updateProject,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { useProjectStore } from "../stores/project";

interface ProjectWithSettings extends Project {
  settings?: ProjectSettings | null;
}

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const projectStore = useProjectStore();

const loading = ref(true);
const saving = ref(false);
const project = ref<ProjectWithSettings | null>(null);
const activeTab = ref("overview");
const projectFundLoading = ref(false);
const projectFundError = ref("");
const projectFund = ref<ProjectModelFund | null>(null);
const projectFundLedger = ref<ProjectModelFundLedgerEntry[]>([]);
const runtimeUsageLoading = ref(false);
const runtimeUsageError = ref("");
const runtimeUsageList = ref<ProjectRuntimeUsageLedgerListResponse | null>(null);
const runtimeUsageDrawerOpen = ref(false);
const runtimeUsageDetailLoading = ref(false);
const runtimeUsageDetailError = ref("");
const runtimeUsageDetail = ref<ProjectRuntimeUsageLedgerDetailResponse | null>(null);
const runtimeUsageAutoOpening = ref(false);

const editingName = ref(false);
const editNameValue = ref("");
const editingDesc = ref(false);
const editDescValue = ref("");

const projectSubtitle = computed(() => {
  if (!project.value?.slug) {
    return "";
  }
  return `${project.value.slug} · 默认从运行档位进入，更多观察入口在右上角`;
});

const canManage = computed(() => {
  const globalRole = authStore.user?.role;
  if (globalRole === "platform_admin" || globalRole === "org_admin") {
    return true;
  }

  const projectId = project.value?.id;
  if (!projectId) {
    return false;
  }

  return authStore.user?.projects?.some(
    (item) => item.id === projectId && item.role === "project_admin",
  );
});

onMounted(async () => {
  applyRouteState();
  const projectId = String(route.params.projectId);
  try {
    project.value = (await getProject(projectId)) as ProjectWithSettings;
    await Promise.all([refreshProjectFund(projectId), refreshRuntimeUsage(projectId)]);
    await maybeOpenRuntimeUsageFromRoute();
  } catch {
    project.value = null;
  } finally {
    loading.value = false;
  }
});

watch(
  () => route.query.tab,
  () => {
    applyRouteState();
  },
);

watch(
  () => route.query.runtimeLedger,
  async () => {
    await maybeOpenRuntimeUsageFromRoute();
  },
);

const projectFundSummary = computed(
  (): ProjectModelFund =>
    projectFund.value || {
      id: null,
      projectId: project.value?.id || "",
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

const projectFundHealthColor = computed(() => {
  const fund = projectFundSummary.value;
  if (fund.available <= 0) return "red";
  if (fund.totalGranted <= 0) return "red";
  const ratio = fund.available / fund.totalGranted;
  if (ratio <= 0.2) return "gold";
  return "green";
});

const projectFundHealthLabel = computed(() => {
  const fund = projectFundSummary.value;
  if (!fund.hasFund) return "未充值";
  if (fund.available <= 0) return "额度耗尽";
  if (fund.totalGranted > 0 && fund.available / fund.totalGranted <= 0.2) return "余额偏低";
  return "余额正常";
});

const projectFundAlertType = computed(() => {
  const color = projectFundHealthColor.value;
  if (color === "green") return "success" as const;
  if (color === "gold") return "warning" as const;
  return "error" as const;
});

const projectFundHealthMessage = computed(() => {
  const fund = projectFundSummary.value;
  if (!fund.hasFund) {
    return "当前项目还没有任何额度钱包记录。";
  }
  if (fund.available <= 0) {
    return "当前可用额度已经耗尽，后续付费模型应由钱包余额阻断。";
  }
  if (fund.totalGranted > 0 && fund.available / fund.totalGranted <= 0.2) {
    return "当前钱包余额偏低，建议尽快补充项目额度。";
  }
  return "当前钱包余额充足，可继续支撑项目付费模型使用。";
});

const projectFundHealthDescription = computed(() => {
  const fund = projectFundSummary.value;
  if (!fund.hasFund) {
    return "请前往设置页为项目充值或调整额度。";
  }
  return `总充值 ${formatUsd(fund.totalGranted)}，已预留 ${formatUsd(fund.reserved)}，已消耗 ${formatUsd(fund.consumed)}。`;
});

const projectFundLedgerRows = computed(() => projectFundLedger.value);

const runtimeUsageRows = computed(() => runtimeUsageList.value?.items || []);

const runtimeUsageBreakdownEntries = computed(() => {
  const byStepType = runtimeUsageDetail.value?.breakdown.byStepType || {};
  return Object.entries(byStepType).map(([key, count]) => ({ key, count }));
});

async function refreshProjectFund(projectId: string) {
  projectFundLoading.value = true;
  projectFundError.value = "";

  try {
    const [fund, ledger] = await Promise.all([
      getProjectFund(projectId),
      getProjectFundLedger(projectId, { limit: 5 }),
    ]);
    projectFund.value = fund;
    projectFundLedger.value = ledger.items;
  } catch (error) {
    projectFundError.value = `加载项目额度钱包失败: ${error}`;
  } finally {
    projectFundLoading.value = false;
  }
}

async function refreshRuntimeUsage(projectId: string) {
  runtimeUsageLoading.value = true;
  runtimeUsageError.value = "";

  try {
    runtimeUsageList.value = await getProjectRuntimeUsageLedgers(projectId, { limit: 8 });
  } catch (error) {
    runtimeUsageError.value = `加载 runtime usage ledger 失败: ${error}`;
  } finally {
    runtimeUsageLoading.value = false;
  }
}

async function openRuntimeUsageDrawer(ledgerId: string) {
  if (!project.value) {
    return;
  }

  runtimeUsageDrawerOpen.value = true;
  runtimeUsageDetailLoading.value = true;
  runtimeUsageDetailError.value = "";
  runtimeUsageDetail.value = null;

  try {
    runtimeUsageDetail.value = await getProjectRuntimeUsageLedgerDetail(project.value.id, ledgerId);
  } catch (error) {
    runtimeUsageDetailError.value = `加载账本明细失败: ${error}`;
  } finally {
    runtimeUsageDetailLoading.value = false;
  }
}

async function maybeOpenRuntimeUsageFromRoute() {
  if (!project.value || runtimeUsageAutoOpening.value) {
    return;
  }

  const ledgerId = typeof route.query.runtimeLedger === "string" ? route.query.runtimeLedger : "";
  if (!ledgerId) {
    return;
  }

  runtimeUsageAutoOpening.value = true;
  try {
    await openRuntimeUsageDrawer(ledgerId);
  } finally {
    runtimeUsageAutoOpening.value = false;
  }
}

function applyRouteState() {
  const tab = route.query.tab;
  if (typeof tab === "string" && tab) {
    activeTab.value = tab;
  }
}

function handleRuntimeUsageDrawerOpen(nextOpen: boolean) {
  runtimeUsageDrawerOpen.value = nextOpen;
  if (nextOpen || !route.query.runtimeLedger) {
    return;
  }

  void router.replace({
    query: {
      ...route.query,
      runtimeLedger: undefined,
    },
  });
}

function startEditName() {
  editNameValue.value = project.value?.name || "";
  editingName.value = true;
}

function startEditDesc() {
  editDescValue.value = project.value?.description || "";
  editingDesc.value = true;
}

async function saveName() {
  if (!canManage.value) {
    message.error("你没有修改该项目的权限");
    return;
  }

  if (!editNameValue.value.trim() || !project.value) return;
  saving.value = true;
  try {
    await updateProject(project.value.id, { name: editNameValue.value.trim() });
    project.value.name = editNameValue.value.trim();
    projectStore.updateProjectInList({ id: project.value.id, name: project.value.name });
    editingName.value = false;
    message.success("保存成功");
  } catch (e) {
    message.error(`保存失败: ${e}`);
  } finally {
    saving.value = false;
  }
}

async function saveDesc() {
  if (!canManage.value) {
    message.error("你没有修改该项目的权限");
    return;
  }

  if (!project.value) return;
  saving.value = true;
  try {
    await updateProject(project.value.id, { description: editDescValue.value.trim() });
    project.value.description = editDescValue.value.trim();
    projectStore.updateProjectInList({
      id: project.value.id,
      description: project.value.description,
    });
    editingDesc.value = false;
    message.success("保存成功");
  } catch (e) {
    message.error(`保存失败: ${e}`);
  } finally {
    saving.value = false;
  }
}

function formatTime(ts: string) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function formatUsd(value: number) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function formatLedgerModel(providerId?: string | null, modelId?: string | null) {
  if (!providerId && !modelId) return "未记录";
  return `${providerId || "unknown"}:${modelId || "unknown"}`;
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

function formatFundLedgerAmount(entry: ProjectModelFundLedgerEntry) {
  if (entry.type === "consume" || entry.type === "reserve") {
    return `-${formatUsd(Math.abs(entry.amountUsd))}`;
  }
  if (entry.type === "refund" || entry.type === "grant") {
    return `+${formatUsd(Math.abs(entry.amountUsd))}`;
  }
  if (entry.amountUsd > 0) {
    return `+${formatUsd(entry.amountUsd)}`;
  }
  if (entry.amountUsd < 0) {
    return `-${formatUsd(Math.abs(entry.amountUsd))}`;
  }
  return formatUsd(0);
}

function runtimeUsageStatusLabel(status: string) {
  if (status === "running") return "运行中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  return status;
}

function runtimeUsageStatusColor(status: string) {
  if (status === "completed") return "green";
  if (status === "running") return "blue";
  if (status === "failed") return "red";
  if (status === "cancelled") return "default";
  return "default";
}

function runtimeUsageStepTypeLabel(stepType: string) {
  if (stepType === "execution") return "主执行";
  if (stepType === "judge") return "Judge";
  if (stepType === "hook") return "Hook";
  if (stepType === "resume") return "Resume";
  if (stepType === "other") return "其他";
  return stepType;
}

function runtimeUsageStepStatusLabel(status: string) {
  if (status === "pending") return "待执行";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "skipped") return "已跳过";
  return status;
}

function runtimeUsageStepStatusColor(status: string) {
  if (status === "completed") return "green";
  if (status === "pending") return "blue";
  if (status === "failed") return "red";
  if (status === "skipped") return "default";
  return "default";
}

function handleSettingsUpdated(settings: ProjectWithSettings["settings"]) {
  if (!project.value) return;
  project.value.settings = settings || null;
  projectStore.updateProjectInList({ id: project.value.id, settings: settings || null });
  void refreshProjectFund(project.value.id);
  void refreshRuntimeUsage(project.value.id);
}

function approvalPolicyLabel(policy: ProjectSettings["approvalPolicy"]) {
  if (policy === "balanced") return "balanced: 平衡策略";
  if (policy === "strict") return "strict: 高风险优先审批";
  if (policy === "manual") return "manual: 关键动作全部人工审批";
  return "未配置";
}
</script>
