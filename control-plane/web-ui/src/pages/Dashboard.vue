<template>
  <div style="padding: 24px">
    <a-typography-title :level="3">
      Dashboard
      <a-typography-text
        v-if="projectStore.currentProject"
        type="secondary"
        style="font-size: 14px; margin-left: 12px"
      >
        {{ projectStore.currentProject.name }}
      </a-typography-text>
    </a-typography-title>

    <a-card size="small" style="margin-bottom: 16px">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" :gap="12">
          <span>Provider Token 总览</span>
          <a-space wrap>
            <a-radio-group :value="providerRange" size="small" @update:value="handleRangeChange">
              <a-radio-button value="24h">24h</a-radio-button>
              <a-radio-button value="7d">7d</a-radio-button>
              <a-radio-button value="30d">30d</a-radio-button>
              <a-radio-button value="monthly">按月</a-radio-button>
            </a-radio-group>
          </a-space>
        </a-flex>
      </template>

      <a-alert
        style="margin-bottom: 16px"
        type="info"
        show-icon
        :message="providerInsightTitle"
        :description="providerInsightDescription"
      />

      <a-empty
        v-if="showProviderEmpty"
        description="当前项目暂无可用的 provider token 统计"
      />

      <template v-else>
        <a-row :gutter="[12, 12]" style="margin-bottom: 16px">
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="providerTokenLoading">
              <div class="provider-card-label">{{ providerTotalLabel }}</div>
              <div class="provider-card-value">{{ formatTokenCount(providerSummary?.totalTokens) }}</div>
              <div class="provider-card-hint">{{ providerSummary?.requestCount ?? providerSummary?.totalRuns ?? 0 }} 次模型请求</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="providerTokenLoading">
              <div class="provider-card-label">模型请求次数</div>
              <div class="provider-card-value">{{ formatCount(providerSummary?.requestCount ?? providerSummary?.totalRuns) }}</div>
              <div class="provider-card-hint">完成 {{ providerSummary?.completedRuns ?? 0 }} 次</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="providerTokenLoading">
              <div class="provider-card-label">Top Provider</div>
              <div class="provider-card-value">{{ topProviderLabel }}</div>
              <div class="provider-card-hint">占比 {{ formatPercent(providerSummary?.topProviderShare) }}</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="providerTokenLoading">
              <div class="provider-card-label">平均完成成本</div>
              <div class="provider-card-value">{{ formatTokenCount(providerSummary?.avgTokensPerCompletedRun) }}</div>
              <div class="provider-card-hint">每个完成任务平均 Tokens</div>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :xl="6">
            <a-card size="small" :loading="providerTokenLoading">
              <div class="provider-card-label">风险 Provider / 异常模型</div>
              <div class="provider-card-value">{{ formatProviderRiskSummary(providerSummary?.riskProviderCount, abnormalModelTotal) }}</div>
              <div class="provider-card-hint">优先检查 {{ formatCount(abnormalModelTotal) }} 个异常模型的配置与路由策略</div>
            </a-card>
          </a-col>
        </a-row>

        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :xl="16">
            <a-card size="small" title="Provider 排行" :loading="providerTokenLoading">
              <a-table
                :data-source="providerRows"
                :columns="providerColumns"
                :pagination="false"
                size="small"
                row-key="providerId"
                :custom-row="providerRowProps"
              >
                <template #expandedRowRender="{ record }">
                  <div v-if="record.models?.length" class="provider-model-panel">
                    <div class="provider-model-panel__header">
                      <div class="provider-model-panel__title">模型明细</div>
                      <a-space wrap :size="8" class="provider-model-panel__summary">
                        <a-tag color="red">失败请求 {{ formatCount(record.failedModelCount) }}</a-tag>
                        <a-tag color="orange">空耗请求 {{ formatCount(record.emptyModelCount) }}</a-tag>
                        <a-tag color="green">正常消耗 {{ formatCount(record.normalModelCount) }}</a-tag>
                      </a-space>
                    </div>
                    <a-table
                      :data-source="record.models"
                      :columns="providerModelColumns"
                      :pagination="false"
                      size="small"
                      row-key="route"
                    >
                      <template #bodyCell="{ column, record: model }">
                        <template v-if="column.key === 'model'">
                          <a-space direction="vertical" :size="0">
                            <a-space :size="6" wrap>
                              <span>{{ modelDisplayLabel(model) }}</span>
                              <a-tag :color="modelDisplayGroupColor(model.displayGroup)">{{ modelDisplayGroupLabel(model.displayGroup) }}</a-tag>
                            </a-space>
                            <a-typography-text type="secondary">{{ model.route }}</a-typography-text>
                            <a-typography-text v-if="model.displayGroup === 'empty'" type="warning">有请求但未完成，且未产生 token 消耗</a-typography-text>
                            <a-typography-text v-else-if="model.displayGroup === 'failed'" type="danger">存在失败请求，建议优先检查失败原因与模型适配</a-typography-text>
                            <a-button
                              v-if="model.displayGroup !== 'normal'"
                              size="small"
                              type="link"
                              class="provider-action-link"
                              @click.stop="openProviderSettings(modelProviderId(model))"
                            >
                              去调整模型
                            </a-button>
                          </a-space>
                        </template>
                        <template v-else-if="column.key === 'tokens'">
                          <a-space direction="vertical" :size="0">
                            <span>{{ formatTokenCount(model.tokenUsed) }}</span>
                            <a-typography-text type="secondary">占 provider {{ formatPercent(model.tokenShareWithinProvider) }}</a-typography-text>
                          </a-space>
                        </template>
                        <template v-else-if="column.key === 'requests'">
                          <a-space direction="vertical" :size="0">
                            <span>{{ formatCount(model.requestCount ?? model.totalRuns) }}</span>
                            <a-typography-text type="secondary">完成 {{ formatCount(model.completedRuns) }}</a-typography-text>
                          </a-space>
                        </template>
                        <template v-else-if="column.key === 'quality'">
                          <a-space direction="vertical" :size="0">
                            <span>失败率 {{ formatPercent(model.failureRate) }}</span>
                            <a-typography-text type="secondary">介入率 {{ formatPercent(model.interventionRate) }}</a-typography-text>
                          </a-space>
                        </template>
                        <template v-else-if="column.key === 'efficiency'">
                          <a-space direction="vertical" :size="0">
                            <span>{{ formatTokenCount(model.avgTokensPerCompletedRun) }}</span>
                            <a-typography-text type="secondary">平均每次 {{ formatTokenCount(model.avgTokensPerRun) }}</a-typography-text>
                          </a-space>
                        </template>
                      </template>
                    </a-table>
                  </div>
                </template>
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'provider'">
                    <a-space direction="vertical" :size="2">
                      <a-space>
                        <a-tag :color="providerHealthColor(record.health)">{{ record.label }}</a-tag>
                        <a-typography-text type="secondary">{{ record.providerId }}</a-typography-text>
                      </a-space>
                      <a-space wrap :size="8">
                        <a-typography-text type="secondary">{{ formatCount(record.models?.length ?? 0) }} 个模型</a-typography-text>
                        <a-tag v-if="record.abnormalModelCount > 0" color="orange">{{ formatCount(record.abnormalModelCount) }} 个异常</a-tag>
                      </a-space>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'tokens'">
                    <a-space direction="vertical" :size="0">
                      <span>{{ formatTokenCount(record.tokenUsed) }}</span>
                      <a-typography-text type="secondary">{{ formatPercent(record.tokenShare) }}</a-typography-text>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'requests'">
                    <a-space direction="vertical" :size="0">
                      <span>{{ formatCount(record.requestCount ?? record.totalRuns) }}</span>
                      <a-typography-text type="secondary">完成 {{ formatCount(record.completedRuns) }}</a-typography-text>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'quality'">
                    <a-space direction="vertical" :size="0">
                      <span>完成 {{ record.completedRuns }}</span>
                      <a-typography-text type="secondary">失败率 {{ formatPercent(record.failureRate) }}</a-typography-text>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'efficiency'">
                    <a-space direction="vertical" :size="0">
                      <span>{{ formatTokenCount(record.avgTokensPerCompletedRun) }}</span>
                      <a-typography-text type="secondary">介入率 {{ formatPercent(record.interventionRate) }}</a-typography-text>
                    </a-space>
                  </template>
                  <template v-else-if="column.key === 'status'">
                    <a-space direction="vertical" :size="0">
                      <a-tag :color="providerRecommendationColor(record.recommendationAction)">{{ record.recommendationLabel }}</a-tag>
                      <a-typography-text type="secondary">{{ record.recommendationMessage }}</a-typography-text>
                      <a-button
                        size="small"
                        type="link"
                        class="provider-action-link"
                        @click.stop="openProviderSettings(record.providerId)"
                      >
                        {{ record.recommendationAction === 'downgrade' ? '去调整模型' : '查看模型配置' }}
                      </a-button>
                    </a-space>
                  </template>
                </template>
              </a-table>
            </a-card>
          </a-col>

          <a-col :xs="24" :xl="8">
            <a-card size="small" :loading="providerTokenLoading">
              <template #title>
                <a-flex justify="space-between" align="center" wrap="wrap" :gap="8">
                  <span>月度视图</span>
                  <a-radio-group :value="monthlyViewMode" size="small" @update:value="handleMonthlyViewChange">
                    <a-radio-button value="trend">总量趋势</a-radio-button>
                    <a-radio-button value="share">Provider 占比</a-radio-button>
                    <a-radio-button value="efficiency">平均完成成本</a-radio-button>
                  </a-radio-group>
                </a-flex>
              </template>
              <a-empty v-if="monthlyTotals.length === 0" description="暂无月度数据" />
              <a-space v-else direction="vertical" style="width: 100%" :size="12">
                <template v-if="monthlyViewMode === 'trend'">
                  <div v-for="item in monthlyTrendRows" :key="`trend-${item.month}`" class="monthly-chart-row">
                    <a-flex justify="space-between" align="center" :gap="12" style="margin-bottom: 6px">
                      <span>{{ item.month }}</span>
                      <a-space :size="10">
                        <a-typography-text>{{ formatTokenCount(item.tokenUsed) }}</a-typography-text>
                        <a-typography-text type="secondary">完成 {{ item.completedRuns }}</a-typography-text>
                      </a-space>
                    </a-flex>
                    <div class="monthly-bar-track">
                      <div class="monthly-bar-single monthly-bar-single--trend" :style="{ width: `${item.widthPercent}%` }" />
                    </div>
                  </div>
                </template>

                <template v-else-if="monthlyViewMode === 'share'">
                  <div v-for="item in monthlyShareRows" :key="`share-${item.month}`" class="monthly-chart-row">
                    <a-flex justify="space-between" align="center" :gap="12" style="margin-bottom: 6px">
                      <span>{{ item.month }}</span>
                      <a-space :size="10">
                        <a-typography-text>{{ formatTokenCount(item.tokenUsed) }}</a-typography-text>
                        <a-typography-text type="secondary">完成 {{ item.completedRuns }}</a-typography-text>
                      </a-space>
                    </a-flex>
                    <div class="monthly-bar-track">
                      <div class="monthly-bar-total" :style="{ width: `${item.widthPercent}%` }">
                        <div
                          v-for="segment in item.segments"
                          :key="`${item.month}-${segment.providerId}`"
                          class="monthly-bar-segment"
                          :style="{ width: `${segment.sharePercent}%`, background: segment.color }"
                        />
                      </div>
                    </div>
                    <div class="monthly-chart-legend">
                      <span v-for="segment in item.segments" :key="`${segment.providerId}-legend-${item.month}`">
                        {{ segment.label }} {{ formatPercent(segment.shareRatio) }}
                      </span>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <div v-for="item in monthlyEfficiencyRows" :key="`eff-${item.month}`" class="monthly-chart-row">
                    <a-flex justify="space-between" align="center" :gap="12" style="margin-bottom: 6px">
                      <span>{{ item.month }}</span>
                      <a-space :size="10">
                        <a-typography-text>{{ formatTokenCount(item.avgTokensPerCompletedRun) }}</a-typography-text>
                        <a-typography-text type="secondary">每个完成任务平均 Tokens</a-typography-text>
                      </a-space>
                    </a-flex>
                    <div class="monthly-bar-track">
                      <div class="monthly-bar-single monthly-bar-single--efficiency" :style="{ width: `${item.widthPercent}%` }" />
                    </div>
                  </div>
                </template>
              </a-space>
            </a-card>
          </a-col>
        </a-row>
      </template>
    </a-card>

    <a-row :gutter="[16, 16]">
      <!-- Active Tasks -->
      <a-col :xs="24" :lg="8">
        <a-card title="活跃任务" size="small">
          <a-empty v-if="activeTasks.length === 0" description="暂无活跃任务" />
          <a-list v-else :data-source="activeTasks" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <router-link :to="`/workbench?task=${item.taskId}`">
                  <a-space>
                    <a-typography-text code>{{
                      item.taskId.slice(0, 8)
                    }}</a-typography-text>
                    <a-tag>{{ item.lastEvent }}</a-tag>
                  </a-space>
                </router-link>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <!-- Agent Activity -->
      <a-col :xs="24" :lg="8">
        <a-card title="Agent 活动" size="small">
          <a-empty v-if="agentEvents.length === 0" description="暂无 Agent 活动" />
          <a-list v-else :data-source="agentEvents" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-space>
                  <a-tag :color="statusColor(item.type.split('.')[1])">
                    {{ item.type.split(".")[1] }}
                  </a-tag>
                  <a-typography-text type="secondary" style="font-size: 12px">
                    {{ item.agentRunId?.slice(0, 8) }}
                  </a-typography-text>
                  <a-typography-text
                    type="secondary"
                    style="font-size: 11px; margin-left: auto"
                  >
                    {{ formatTime(item.ts) }}
                  </a-typography-text>
                </a-space>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <!-- Pending Approvals -->
      <a-col :xs="24" :lg="8">
        <a-card size="small">
          <template #title>
            待审批
            <a-badge
              :count="approvals.length"
              :number-style="{ backgroundColor: '#3b82f6' }"
              style="margin-left: 8px"
            />
          </template>
          <ApprovalPanel :approvals="approvals" @resolved="loadApprovals" />
        </a-card>
      </a-col>
    </a-row>

    <!-- Event Stream -->
    <a-card title="事件流" size="small" style="margin-top: 16px">
      <a-empty v-if="events.length === 0" description="等待事件..." />
      <div v-else style="max-height: 260px; overflow-y: auto">
        <a-table
          :data-source="events.slice(0, 50)"
          :columns="eventColumns"
          :pagination="false"
          size="small"
          row-key="id"
        />
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type {
  DashboardProviderModelItem,
  DashboardProviderTokenItem,
  DashboardProviderTokenRange,
  DashboardProviderTokenResponse,
} from "../lib/api";
import { getDashboardProviderTokens, listApprovals } from "../lib/api";
import { useProjectStore } from "../stores/project";
import { useRealtimeStore } from "../stores/realtime";

const realtimeStore = useRealtimeStore();
const projectStore = useProjectStore();
const router = useRouter();
const approvals = ref<unknown[]>([]);
const providerRange = ref<DashboardProviderTokenRange>("24h");
const monthlyViewMode = ref<"trend" | "share" | "efficiency">("share");
const providerTokenLoading = ref(true);
const providerBootstrapPending = ref(true);
const providerTokenData = ref<DashboardProviderTokenResponse | null>(null);

const providerColumns = [
  { title: "Provider", key: "provider", width: 220 },
  { title: "Tokens", key: "tokens", width: 140 },
  { title: "请求", key: "requests", width: 120 },
  { title: "质量", key: "quality", width: 160 },
  { title: "效率", key: "efficiency", width: 160 },
  { title: "状态 / 建议", key: "status" },
];

const providerModelColumns = [
  { title: "模型", key: "model", width: 280 },
  { title: "Tokens", key: "tokens", width: 140 },
  { title: "请求", key: "requests", width: 120 },
  { title: "质量", key: "quality", width: 160 },
  { title: "效率", key: "efficiency", width: 180 },
];

type ModelDisplayGroup = "failed" | "empty" | "normal";

type DisplayModelItem = DashboardProviderModelItem & {
  displayGroup: ModelDisplayGroup;
};

type DisplayProviderItem = DashboardProviderTokenItem & {
  models: DisplayModelItem[];
  abnormalModelCount: number;
  failedModelCount: number;
  emptyModelCount: number;
  normalModelCount: number;
};

const events = computed(() => {
  if (!projectStore.currentProjectId) return [];
  return realtimeStore.events.filter((event) => event.projectId === projectStore.currentProjectId);
});

const providerSummary = computed(() => providerTokenData.value?.summary ?? null);
const providerRows = computed<DisplayProviderItem[]>(() =>
  (providerTokenData.value?.providers ?? []).map((provider) => {
    const models = [...provider.models]
      .map((model) => ({
        ...model,
        displayGroup: classifyModelGroup(model),
      }))
      .sort(compareModelsForDisplay);

    const failedModelCount = models.filter((model) => model.displayGroup === "failed").length;
    const emptyModelCount = models.filter((model) => model.displayGroup === "empty").length;
    const normalModelCount = models.filter((model) => model.displayGroup === "normal").length;

    return {
      ...provider,
      models,
      abnormalModelCount: failedModelCount + emptyModelCount,
      failedModelCount,
      emptyModelCount,
      normalModelCount,
    };
  }),
);
const abnormalModelTotal = computed(() =>
  providerRows.value.reduce((sum, provider) => sum + provider.abnormalModelCount, 0),
);
const showProviderEmpty = computed(
  () => !providerBootstrapPending.value && !providerTokenLoading.value && providerRows.value.length === 0,
);
const monthlyTotals = computed(() => providerSummary.value?.monthlyTotals ?? []);
const maxMonthlyToken = computed(() =>
  monthlyTotals.value.reduce((max, item) => Math.max(max, item.tokenUsed), 0),
);
const monthlyTrendRows = computed(() =>
  monthlyTotals.value.map((item) => ({
    ...item,
    widthPercent: maxMonthlyToken.value > 0 ? (item.tokenUsed / maxMonthlyToken.value) * 100 : 0,
  })),
);

const monthlyShareRows = computed(() => {
  const palette = ["#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#dc2626"];
  const topProviders = providerRows.value.slice(0, 5);
  return monthlyTotals.value.map((item) => {
    const segments = topProviders
      .map((provider, index) => {
        const monthBucket = provider.monthly.find((bucket) => bucket.month === item.month);
        const tokenUsed = monthBucket?.tokenUsed ?? 0;
        const shareRatio = item.tokenUsed > 0 ? tokenUsed / item.tokenUsed : 0;
        return {
          providerId: provider.providerId,
          label: provider.label,
          shareRatio,
          sharePercent: shareRatio * 100,
          color: palette[index % palette.length],
        };
      })
      .filter((segment) => segment.shareRatio > 0);

    return {
      ...item,
      widthPercent: maxMonthlyToken.value > 0 ? (item.tokenUsed / maxMonthlyToken.value) * 100 : 0,
      segments,
    };
  });
});

const maxMonthlyAvgCost = computed(() =>
  monthlyTotals.value.reduce((max, item) => {
    const avg = item.completedRuns > 0 ? item.tokenUsed / item.completedRuns : 0;
    return Math.max(max, avg);
  }, 0),
);

const monthlyEfficiencyRows = computed(() =>
  monthlyTotals.value.map((item) => {
    const avgTokensPerCompletedRun = item.completedRuns > 0 ? item.tokenUsed / item.completedRuns : 0;
    return {
      month: item.month,
      avgTokensPerCompletedRun,
      widthPercent: maxMonthlyAvgCost.value > 0 ? (avgTokensPerCompletedRun / maxMonthlyAvgCost.value) * 100 : 0,
    };
  }),
);

const providerTotalLabel = computed(() =>
  providerRange.value === "monthly" ? "本月 Token 总量" : `${providerRange.value} Token 总量`,
);

const topProviderLabel = computed(() => {
  const top = providerRows.value[0];
  return top ? top.label : "-";
});

const providerInsightTitle = computed(() => {
  if (!projectStore.currentProjectId) return "请先选择项目";
  if (providerRows.value.length === 0) return "当前没有足够数据做模型调整建议";
  const riskCount = providerSummary.value?.riskProviderCount ?? 0;
  const downgradeCount = providerRows.value.filter((item) => item.recommendationAction === "downgrade").length;
  if (downgradeCount > 0) return `存在 ${downgradeCount} 个建议降配的 Provider`;
  return riskCount > 0 ? "存在可优化的模型分配" : "当前模型分配整体稳定";
});

const providerInsightDescription = computed(() => {
  if (!projectStore.currentProjectId) {
    return "Dashboard 会在选中项目后展示 provider token 结构，帮助管理员做模型重分配。";
  }
  if (providerRows.value.length === 0) {
    return "当前项目还没有足够的 Agent token 数据，暂时无法判断哪些模型更省、哪些模型更准。";
  }
  const top = providerRows.value[0];
  const riskCount = providerSummary.value?.riskProviderCount ?? 0;
  const downgradeCount = providerRows.value.filter((item) => item.recommendationAction === "downgrade").length;
  const monthlyTail =
    monthlyTotals.value.length > 0 ? monthlyTotals.value[monthlyTotals.value.length - 1] : null;
  const monthText = monthlyTail
    ? `最近月度总量 ${formatTokenCount(monthlyTail.tokenUsed)}。`
    : "";
  const actionText = downgradeCount > 0
    ? ` 其中 ${downgradeCount} 个 provider 已满足建议降配条件，可直接进入模型设置调整。`
    : riskCount > 0
      ? ` 其中 ${riskCount} 个 provider 已进入重点观察区。`
      : " 暂无明显高风险 provider。";
  return `${top.label} 当前承担了 ${formatPercent(top.tokenShare)} 的 token 消耗，平均完成成本 ${formatTokenCount(top.avgTokensPerCompletedRun)}。${actionText} ${monthText}`.trim();
});

async function loadApprovals() {
  try {
    approvals.value = (await listApprovals("pending")) as unknown[];
  } catch {
    approvals.value = [];
  }
}

async function loadProviderTokens() {
  if (!projectStore.currentProjectId) {
    providerTokenData.value = null;
    providerTokenLoading.value = false;
    return;
  }
  providerTokenLoading.value = true;
  try {
    providerTokenData.value = await getDashboardProviderTokens(
      projectStore.currentProjectId,
      providerRange.value,
    );
  } catch {
    providerTokenData.value = null;
  } finally {
    providerTokenLoading.value = false;
  }
}

onMounted(async () => {
  providerBootstrapPending.value = true;
  try {
    if (projectStore.projects.length === 0) {
      await projectStore.loadProjects();
    }
    await loadApprovals();
    await loadProviderTokens();
  } finally {
    providerBootstrapPending.value = false;
    if (!projectStore.currentProjectId) {
      providerTokenLoading.value = false;
    }
  }
});

watch([() => projectStore.currentProjectId, providerRange], async () => {
  await loadProviderTokens();
});

const activeTasks = computed(() => {
  const map = new Map<string, { taskId: string; lastEvent: string; lastUpdate: string }>();
  for (const e of events.value) {
    if (
      (e.type === "task.created" || e.type === "task.node.updated") &&
      e.taskId &&
      !map.has(e.taskId)
    ) {
      map.set(e.taskId, {
        taskId: e.taskId,
        lastEvent: e.type,
        lastUpdate: e.ts,
      });
    }
  }
  return Array.from(map.values());
});

const agentEvents = computed(() =>
  events.value.filter((e) => e.type.startsWith("agent.")).slice(0, 10),
);

const eventColumns = [
  {
    title: "时间",
    dataIndex: "ts",
    width: 100,
    customRender: ({ text }: { text: string }) => formatTime(text),
  },
  { title: "类型", dataIndex: "type", width: 180 },
  {
    title: "数据",
    dataIndex: "data",
    ellipsis: true,
    customRender: ({ text }: { text: Record<string, unknown> }) =>
      JSON.stringify(text).slice(0, 100),
  },
];

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString();
}

function formatCount(value?: number | null) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value ?? 0));
}

function formatProviderRiskSummary(riskProviderCount?: number | null, abnormalModelCount?: number | null) {
  return `${formatCount(riskProviderCount)} / ${formatCount(abnormalModelCount)}`;
}

function handleRangeChange(value: string | number | boolean) {
  providerRange.value = String(value ?? "24h") as DashboardProviderTokenRange;
}

function handleMonthlyViewChange(value: string | number | boolean) {
  const next = String(value ?? "share");
  if (next === "trend" || next === "share" || next === "efficiency") {
    monthlyViewMode.value = next;
  }
}

function providerRowProps(record: DisplayProviderItem) {
  return {
    style: { cursor: "pointer" },
    onClick: () => {
      void router.push({
        path: "/agents",
        query: {
          provider: record.providerId,
          focus: record.recommendationAction === "downgrade" ? "attention" : "recent",
          ...(record.recommendationAction === "downgrade" ? { status: "failed" } : {}),
        },
      });
    },
  };
}

function openProviderSettings(providerId: string) {
  void router.push({
    path: "/settings",
    query: {
      tab: "models",
      section: "provider-row",
      provider: providerId,
    },
  });
}

function formatTokenCount(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function formatPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${Math.round(value * 100)}%`;
}

function providerHealthColor(health: DashboardProviderTokenItem["health"]) {
  if (health === "risk") return "red";
  if (health === "warn") return "orange";
  return "green";
}

function providerHealthLabel(health: DashboardProviderTokenItem["health"]) {
  if (health === "risk") return "建议调整";
  if (health === "warn") return "重点观察";
  return "稳定";
}

function providerRecommendationColor(action: DashboardProviderTokenItem["recommendationAction"]) {
  if (action === "downgrade") return "red";
  if (action === "observe") return "orange";
  return "green";
}

function providerReasonsText(reasons: string[]) {
  return reasons.length > 0 ? reasons.join(" / ") : "完成质量与 token 使用基本匹配";
}

function modelDisplayLabel(model?: { label?: string; modelId?: string; route?: string } | null) {
  return model?.label || model?.modelId || model?.route || "unknown";
}

function modelProviderId(model?: { route?: string | null } | null) {
  const route = model?.route?.trim();
  if (!route) return "unknown";
  const colonIndex = route.indexOf(":");
  if (colonIndex > 0) return route.slice(0, colonIndex);
  const slashIndex = route.indexOf("/");
  if (slashIndex > 0) return route.slice(0, slashIndex);
  return route;
}

function isEmptyRequestModel(model?: {
  tokenUsed?: number | null;
  requestCount?: number | null;
  totalRuns?: number | null;
  completedRuns?: number | null;
} | null) {
  const requestCount = model?.requestCount ?? model?.totalRuns ?? 0;
  return requestCount > 0 && (model?.completedRuns ?? 0) === 0 && (model?.tokenUsed ?? 0) <= 0;
}

function isFailedRequestModel(model?: {
  failedRuns?: number | null;
  failureRate?: number | null;
} | null) {
  return (model?.failedRuns ?? 0) > 0 || (model?.failureRate ?? 0) > 0;
}

function classifyModelGroup(model: DashboardProviderModelItem): ModelDisplayGroup {
  if (isFailedRequestModel(model)) return "failed";
  if (isEmptyRequestModel(model)) return "empty";
  return "normal";
}

function modelDisplayGroupLabel(group: ModelDisplayGroup) {
  if (group === "failed") return "失败请求";
  if (group === "empty") return "空耗请求";
  return "正常消耗";
}

function modelDisplayGroupColor(group: ModelDisplayGroup) {
  if (group === "failed") return "red";
  if (group === "empty") return "orange";
  return "green";
}

function modelDisplayGroupOrder(group: ModelDisplayGroup) {
  if (group === "failed") return 0;
  if (group === "empty") return 1;
  return 2;
}

function compareModelsForDisplay(left: DisplayModelItem, right: DisplayModelItem) {
  const groupDelta = modelDisplayGroupOrder(left.displayGroup) - modelDisplayGroupOrder(right.displayGroup);
  if (groupDelta !== 0) return groupDelta;
  if (right.tokenUsed !== left.tokenUsed) return right.tokenUsed - left.tokenUsed;
  return (right.requestCount ?? right.totalRuns) - (left.requestCount ?? left.totalRuns);
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    started: "blue",
    running: "blue",
    paused: "orange",
    completed: "green",
    failed: "red",
    stopped: "default",
  };
  return map[status] || "default";
}
</script>

<style scoped>
.provider-card-label {
  color: #64748b;
  font-size: 12px;
  margin-bottom: 6px;
}

.provider-card-value {
  color: #0f172a;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.2;
}

.provider-card-hint {
  color: #64748b;
  font-size: 12px;
  margin-top: 6px;
}

.monthly-summary-item {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
}

.monthly-chart-row {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
}

.monthly-bar-track {
  background: #e2e8f0;
  border-radius: 999px;
  height: 12px;
  overflow: hidden;
}

.monthly-bar-total {
  display: flex;
  height: 100%;
  border-radius: 999px;
  overflow: hidden;
}

.monthly-bar-single {
  height: 100%;
  border-radius: 999px;
}

.monthly-bar-single--trend {
  background: linear-gradient(90deg, #2563eb 0%, #60a5fa 100%);
}

.monthly-bar-single--efficiency {
  background: linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%);
}

.monthly-bar-segment {
  height: 100%;
}

.monthly-chart-legend {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  color: #64748b;
  font-size: 12px;
  margin-top: 6px;
}

.provider-action-link {
  padding-left: 0;
}

.provider-model-panel {
  padding-top: 8px;
}

.provider-model-panel__header {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
}

.provider-model-panel__title {
  color: #64748b;
  font-size: 12px;
  margin-bottom: 8px;
}

.provider-model-panel__summary {
  margin-bottom: 8px;
}

.provider-model-panel :deep(.ant-table) {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}
</style>
