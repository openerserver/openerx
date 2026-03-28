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
              <a-descriptions-item label="付费执行权限">
                {{ project.settings?.allowPaidExecution ? '已开启' : '未开启' }}
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
              <a-descriptions-item label="月预算">
                {{ project.settings?.budgetMonthly != null ? `$${project.settings.budgetMonthly}` : '未配置' }}
              </a-descriptions-item>
              <a-descriptions-item label="预警阈值">
                {{ percentLabel(project.settings?.warnThreshold) }}
              </a-descriptions-item>
              <a-descriptions-item label="限流阈值">
                {{ percentLabel(project.settings?.throttleThreshold) }}
              </a-descriptions-item>
            </a-descriptions>
          </a-card>

          <a-card title="付费执行预检" size="small" style="margin-top: 16px">
            <a-spin :spinning="paidExecutionLoading">
              <a-alert
                v-if="paidExecutionError"
                type="error"
                show-icon
                :message="paidExecutionError"
                style="margin-bottom: 12px"
              />
              <a-descriptions :column="{ xs: 1, lg: 2 }" bordered size="small">
                <a-descriptions-item label="生效模型">
                  {{ paidExecutionPreflight?.effectiveModel || project.settings?.defaultModel || '未解析' }}
                </a-descriptions-item>
                <a-descriptions-item label="预检结论">
                  {{ paidExecutionDecisionLabel }}
                </a-descriptions-item>
                <a-descriptions-item label="租约状态">
                  {{ paidExecutionLeaseLabel }}
                </a-descriptions-item>
                <a-descriptions-item label="租约到期">
                  {{ paidExecutionPreflight?.activeLease?.expiresAt ? formatTime(paidExecutionPreflight.activeLease.expiresAt) : '无' }}
                </a-descriptions-item>
                <a-descriptions-item label="单次成本预估">
                  {{ paidExecutionCostLabel }}
                </a-descriptions-item>
                <a-descriptions-item label="执行前置条件">
                  {{ paidExecutionRequirementLabel }}
                </a-descriptions-item>
              </a-descriptions>

              <a-alert
                v-if="paidExecutionPreflight"
                style="margin-top: 12px"
                :type="paidExecutionPreflight.allowed ? 'success' : (paidExecutionPreflight.preflight.guardDecision === 'allow-with-downgrade' ? 'warning' : 'info')"
                show-icon
                :message="paidExecutionGuardMessage"
                :description="paidExecutionGuardDescription"
              />

              <a-descriptions
                v-if="paidExecutionPreflight"
                :column="{ xs: 1, lg: 2 }"
                bordered
                size="small"
                style="margin-top: 12px"
              >
                <a-descriptions-item label="请求上界">
                  {{ paidExecutionPreflight.preflight.requestCount.min }} - {{ paidExecutionPreflight.preflight.requestCount.max }} 次
                </a-descriptions-item>
                <a-descriptions-item label="Token 上界">
                  {{ paidExecutionPreflight.preflight.totalTokens.min }} - {{ paidExecutionPreflight.preflight.totalTokens.max }} tokens
                </a-descriptions-item>
                <a-descriptions-item label="输入 Token 估算">
                  {{ paidExecutionPreflight.preflight.inputTokens.min }} - {{ paidExecutionPreflight.preflight.inputTokens.max }}
                </a-descriptions-item>
                <a-descriptions-item label="输出 Token 估算">
                  {{ paidExecutionPreflight.preflight.outputTokens.min }} - {{ paidExecutionPreflight.preflight.outputTokens.max }}
                </a-descriptions-item>
                <a-descriptions-item label="预算余量">
                  {{ paidExecutionBudgetHeadroomLabel }}
                </a-descriptions-item>
                <a-descriptions-item label="重点关注项">
                  {{ paidExecutionPreflight.preflight.riskDrivers.length }}
                </a-descriptions-item>
                <a-descriptions-item label="预估基线">
                  {{ paidExecutionPreflight.preflight.baselineSource?.source === 'historical'
                    ? `基于历史记录估算 · ${paidExecutionPreflight.preflight.baselineSource?.matchScope || 'project'} · ${paidExecutionPreflight.preflight.baselineSource?.sampleSize || 0} 条样本`
                    : '系统估算（暂无历史记录）' }}
                </a-descriptions-item>
              </a-descriptions>

              <div v-if="paidExecutionPreflight?.preflight.riskDrivers.length" style="margin-top: 12px">
                <div style="font-weight: 600; margin-bottom: 8px">影响本次判断的因素</div>
                <a-list
                  size="small"
                  bordered
                  :data-source="paidExecutionPreflight.preflight.riskDrivers"
                >
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <div>
                        <div>
                          {{ item.label }}
                          <a-tag style="margin-inline-start: 8px">{{ formatPaidExecutionRiskType(item.type) }}</a-tag>
                          <a-tag :color="item.impact === 'high' ? 'red' : (item.impact === 'medium' ? 'orange' : 'green')">
                            {{ formatPaidExecutionRiskImpact(item.impact) }}
                          </a-tag>
                        </div>
                        <div style="color: rgba(0, 0, 0, 0.65)">{{ item.detail }}</div>
                      </div>
                    </a-list-item>
                  </template>
                </a-list>
              </div>

              <a-space v-if="canManage && project" style="margin-top: 12px" wrap>
                <a-button
                  v-if="shouldShowEnablePaidExecutionAction"
                  type="primary"
                  ghost
                  :loading="paidExecutionPermissionMutating"
                  @click="enableProjectPaidExecution"
                >
                  开启项目付费执行权限
                </a-button>
                <a-button
                  v-if="!paidExecutionLease?.activeLease"
                  type="primary"
                  :loading="leaseMutating"
                  @click="issueLease"
                >
                  开启 30 分钟执行许可
                </a-button>
                <a-button
                  v-else
                  danger
                  :loading="leaseMutating"
                  @click="revokeLease"
                >
                  关闭当前执行许可
                </a-button>
                <a-button :loading="paidExecutionLoading" @click="refreshPaidExecutionState(project.id)">
                  刷新预检
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
  type PaidExecutionLeaseStateResponse,
  type Project,
  type ProjectExecutionPreflightResponse,
  type ProjectRuntimeUsageLedgerDetailResponse,
  type ProjectRuntimeUsageLedgerListResponse,
  type ProjectSettings,
  createProjectPaidExecutionLease,
  getProject,
  getProjectPaidExecutionLease,
  getProjectPaidExecutionPreflight,
  getProjectRuntimeUsageLedgerDetail,
  getProjectRuntimeUsageLedgers,
  revokeProjectPaidExecutionLease,
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
const paidExecutionLoading = ref(false);
const leaseMutating = ref(false);
const paidExecutionPermissionMutating = ref(false);
const paidExecutionError = ref("");
const paidExecutionPreflight = ref<ProjectExecutionPreflightResponse | null>(null);
const paidExecutionLease = ref<PaidExecutionLeaseStateResponse | null>(null);
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
    await Promise.all([refreshPaidExecutionState(projectId), refreshRuntimeUsage(projectId)]);
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

const paidExecutionDecisionLabel = computed(() => {
  const decision = paidExecutionPreflight.value?.preflight.guardDecision;
  if (decision === "allow") return "允许直接执行";
  if (decision === "allow-with-downgrade") return "需要降级后重试";
  if (decision === "require-approval") return "需要租约或审批";
  if (decision === "deny") return "当前阻止执行";
  return "未评估";
});

const paidExecutionLeaseLabel = computed(() => {
  if (paidExecutionLease.value?.activeLease) {
    return `已签发 · ${paidExecutionLease.value.activeLease.id}`;
  }
  return "未签发";
});

const paidExecutionCostLabel = computed(() => {
  const cost = paidExecutionPreflight.value?.preflight.costUsd;
  if (!cost) {
    return "未评估";
  }
  return `$${cost.min} - $${cost.max}`;
});

const paidExecutionGuardMessage = computed(() => {
  const preflight = paidExecutionPreflight.value?.preflight;
  const requirements = paidExecutionPreflight.value?.requirements;
  if (!preflight) {
    return "尚未生成执行建议";
  }

  if (requirements?.allowPaidExecution && !requirements.hasAllowPaidExecution) {
    return "当前还未开启付费执行权限，请联系平台管理员开通后再重试。";
  }
  if (requirements?.leaseRequired && !requirements.hasLease) {
    return "当前模型需要临时执行许可，请先开启执行许可后再执行。";
  }

  const reason = preflight.guardReason;

  if (reason.includes("ALLOW_PAID_MODEL_EXECUTION=1")) {
    return "当前还未开启付费执行权限，请联系平台管理员开通后再重试。";
  }
  if (reason.includes("requires an active paid execution lease")) {
    return "当前模型需要临时执行许可，请先开启执行许可后再执行。";
  }
  if (reason.includes("Retry with") && preflight.guardDecision === "allow-with-downgrade") {
    return "当前执行规模偏高，建议切换到更稳妥的模型后重试。";
  }
  if (reason.includes("cannot be auto-downgraded safely")) {
    return "当前执行规模超出策略限制，系统暂不允许自动降级放行。";
  }
  if (reason.includes("Estimated amplification exceeds policy")) {
    return "预计调用放大量或成本将超出当前策略上限。";
  }
  if (preflight.guardDecision === "allow") {
    return "当前设置已满足执行条件，可以直接发起。";
  }
  return "当前设置仍需调整，暂不建议直接发起执行。";
});

const paidExecutionGuardDescription = computed(() => {
  const reason = paidExecutionPreflight.value?.preflight.guardReason?.trim();
  if (!reason || reason === paidExecutionGuardMessage.value) {
    return undefined;
  }
  return `原始说明：${reason}`;
});

const paidExecutionBudgetHeadroomLabel = computed(() => {
  const budgetHeadroom = paidExecutionPreflight.value?.preflight.budgetHeadroom;
  if (!budgetHeadroom) {
    return "未评估";
  }
  if (budgetHeadroom.remainingUsd == null) {
    return "当前策略未设置成本余量";
  }

  return `$${budgetHeadroom.remainingUsd} · 单次${budgetHeadroom.enoughForSingleRun ? "可执行" : "超限"} · 套件${budgetHeadroom.enoughForSuiteRun ? "可执行" : "超限"}`;
});

const paidExecutionRequirementLabel = computed(() => {
  const requirements = paidExecutionPreflight.value?.requirements;
  if (!requirements) {
    return "未评估";
  }

  const parts: string[] = [];
  if (requirements.allowPaidExecution) {
    parts.push(
      requirements.hasAllowPaidExecution
        ? "已开启付费执行权限"
        : "需平台管理员先开启付费执行权限（当前无自助开通页面）",
    );
  }
  if (requirements.leaseRequired) {
    parts.push(requirements.hasLease ? "已具备临时执行许可" : "还需要临时执行许可");
  }
  return parts.length > 0 ? parts.join("；") : "当前无需额外设置";
});

const shouldShowEnablePaidExecutionAction = computed(() => {
  const requirements = paidExecutionPreflight.value?.requirements;
  return (
    canManage.value &&
    Boolean(project.value) &&
    requirements?.allowPaidExecution === true &&
    requirements.hasAllowPaidExecution !== true
  );
});

function formatPaidExecutionRiskType(type: string) {
  if (type === "model") return "模型";
  if (type === "suite") return "执行场景";
  if (type === "parallel") return "并行放大";
  if (type === "judge") return "评审链路";
  if (type === "hook") return "扩展钩子";
  if (type === "budget") return "预算约束";
  return type;
}

function formatPaidExecutionRiskImpact(impact: string) {
  if (impact === "high") return "高";
  if (impact === "medium") return "中";
  if (impact === "low") return "低";
  return impact;
}

const runtimeUsageRows = computed(() => runtimeUsageList.value?.items || []);

const runtimeUsageBreakdownEntries = computed(() => {
  const byStepType = runtimeUsageDetail.value?.breakdown.byStepType || {};
  return Object.entries(byStepType).map(([key, count]) => ({ key, count }));
});

async function refreshPaidExecutionState(projectId: string) {
  paidExecutionLoading.value = true;
  paidExecutionError.value = "";

  try {
    const [preflight, leaseState] = await Promise.all([
      getProjectPaidExecutionPreflight(projectId),
      getProjectPaidExecutionLease(projectId),
    ]);
    paidExecutionPreflight.value = preflight;
    paidExecutionLease.value = leaseState;
  } catch (error) {
    paidExecutionError.value = `加载付费执行预检失败: ${error}`;
  } finally {
    paidExecutionLoading.value = false;
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

async function issueLease() {
  if (!project.value) {
    return;
  }

  leaseMutating.value = true;
  try {
    paidExecutionLease.value = await createProjectPaidExecutionLease(project.value.id, {
      durationMinutes: 30,
      reason: "Issued from project overview",
    });
    await refreshPaidExecutionState(project.value.id);
    message.success("已开启 30 分钟执行许可");
  } catch (error) {
    message.error(`开启执行许可失败: ${error}`);
  } finally {
    leaseMutating.value = false;
  }
}

async function enableProjectPaidExecution() {
  if (!project.value) {
    return;
  }

  paidExecutionPermissionMutating.value = true;
  try {
    const nextSettings: ProjectSettings = {
      ...(project.value.settings || {}),
      allowPaidExecution: true,
    };
    await updateProject(project.value.id, { settings: nextSettings });
    handleSettingsUpdated(nextSettings);
    message.success("项目付费执行权限已开启");
  } catch (error) {
    message.error(`开启项目付费执行权限失败: ${error}`);
  } finally {
    paidExecutionPermissionMutating.value = false;
  }
}

async function revokeLease() {
  if (!project.value || !paidExecutionLease.value?.activeLease?.id) {
    return;
  }

  leaseMutating.value = true;
  try {
    await revokeProjectPaidExecutionLease(
      project.value.id,
      paidExecutionLease.value.activeLease.id,
      {
        reason: "Revoked from project overview",
      },
    );
    await refreshPaidExecutionState(project.value.id);
    message.success("当前执行许可已关闭");
  } catch (error) {
    message.error(`关闭执行许可失败: ${error}`);
  } finally {
    leaseMutating.value = false;
  }
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
  void refreshPaidExecutionState(project.value.id);
  void refreshRuntimeUsage(project.value.id);
}

function approvalPolicyLabel(policy: ProjectSettings["approvalPolicy"]) {
  if (policy === "balanced") return "balanced: 平衡策略";
  if (policy === "strict") return "strict: 高风险优先审批";
  if (policy === "manual") return "manual: 关键动作全部人工审批";
  return "未配置";
}

function percentLabel(value: number | undefined) {
  if (typeof value !== "number") return "未配置";
  return `${Math.round(value * 100)}%`;
}
</script>
