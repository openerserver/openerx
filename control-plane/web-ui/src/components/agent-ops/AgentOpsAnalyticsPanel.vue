<template>
  <div class="agent-analytics-panel">
    <a-card size="small" :loading="loading" style="margin-bottom: 16px">
      <template #title>
        <a-flex justify="space-between" align="center" wrap="wrap" :gap="8">
          <span>管理员分析视图</span>
          <a-space wrap :size="8">
            <a-tag>{{ scopeTagLabel }}</a-tag>
            <a-tag v-if="health?.generatedAt">生成于 {{ formatGeneratedAt(health.generatedAt) }}</a-tag>
          </a-space>
        </a-flex>
      </template>

      <a-empty v-if="!loading && !health" description="当前筛选条件下暂无可分析的 Agent 数据" />

      <template v-else>
        <a-alert
          style="margin-bottom: 16px"
          type="info"
          show-icon
          :message="insightTitle"
          :description="insightDescription"
        />

        <a-row :gutter="[12, 12]">
          <a-col v-for="card in summaryCards" :key="card.key" :xs="24" :sm="12" :xl="6">
            <a-card size="small">
              <div class="analytics-stat-label">{{ card.label }}</div>
              <div class="analytics-stat-value">{{ card.value }}</div>
              <div class="analytics-stat-hint">{{ card.hint }}</div>
            </a-card>
          </a-col>
        </a-row>
      </template>
    </a-card>

    <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
      <a-col :xs="24" :xl="10">
        <a-card size="small" title="异常构成" :loading="loading">
          <a-empty v-if="!failures || failures.totalAttentionRuns === 0" description="当前没有需要人工处理的异常" />
          <a-flex v-else vertical :gap="14">
            <div>
              <div class="analytics-section-title">阻塞拆分</div>
              <div class="analytics-breakdown-list">
                <button
                  v-for="item in failures.blockerBreakdown"
                  :key="`blocker-${item.key}`"
                  type="button"
                  class="analytics-breakdown-item"
                  @click="applyBlockerFilter(item.label)"
                >
                  <a-flex justify="space-between" align="center" :gap="12">
                    <span>{{ item.label }}</span>
                    <a-space :size="8">
                      <span>{{ item.count }}</span>
                      <span class="analytics-breakdown-share">{{ formatPercent(item.share) }}</span>
                    </a-space>
                  </a-flex>
                  <div class="analytics-breakdown-track">
                    <div class="analytics-breakdown-fill analytics-breakdown-fill--danger" :style="{ width: `${item.share}%` }" />
                  </div>
                </button>
              </div>
            </div>

            <div>
              <div class="analytics-section-title">失败原因</div>
              <div class="analytics-breakdown-list">
                <button
                  v-for="item in failures.failureReasons"
                  :key="`reason-${item.key}`"
                  type="button"
                  class="analytics-breakdown-item"
                  @click="applyFailureReasonFilter(item.label)"
                >
                  <a-flex justify="space-between" align="center" :gap="12">
                    <span>{{ item.label }}</span>
                    <a-space :size="8">
                      <span>{{ item.count }}</span>
                      <span class="analytics-breakdown-share">{{ formatPercent(item.share) }}</span>
                    </a-space>
                  </a-flex>
                  <div class="analytics-breakdown-track">
                    <div class="analytics-breakdown-fill analytics-breakdown-fill--warning" :style="{ width: `${item.share}%` }" />
                  </div>
                </button>
              </div>
            </div>

            <div>
              <div class="analytics-section-title">风险分布</div>
              <a-space wrap>
                <a-tag
                  v-for="item in failures.riskBreakdown"
                  :key="`risk-${item.key}`"
                  class="analytics-clickable-tag"
                  :color="riskTagColor(item.label)"
                  @click="applyRiskFilter(item.label)"
                >
                  {{ item.label }} {{ item.count }}
                </a-tag>
              </a-space>
            </div>
          </a-flex>
        </a-card>
      </a-col>

      <a-col :xs="24" :xl="14">
        <a-card size="small" :loading="loading">
          <template #title>
            <a-flex justify="space-between" align="center" wrap="wrap" :gap="8">
              <span>状态趋势</span>
              <a-radio-group :value="trendMetric" size="small" @update:value="setTrendMetric">
                <a-radio-button value="attention">待处理</a-radio-button>
                <a-radio-button value="failed">失败</a-radio-button>
                <a-radio-button value="completed">完成</a-radio-button>
                <a-radio-button value="intervention">介入</a-radio-button>
              </a-radio-group>
            </a-flex>
          </template>

          <a-empty v-if="!timeline || timeline.buckets.length === 0" description="当前没有趋势数据" />
          <div v-else class="analytics-timeline-list">
            <div v-for="bucket in timelineRows" :key="bucket.bucket" class="analytics-timeline-row">
              <a-flex justify="space-between" align="center" :gap="12" style="margin-bottom: 6px">
                <span>{{ bucket.label }}</span>
                <a-space :size="10">
                  <a-typography-text>{{ bucket.metricValue }}</a-typography-text>
                  <a-typography-text type="secondary">总计 {{ bucket.totalRuns }}</a-typography-text>
                </a-space>
              </a-flex>
              <div class="analytics-breakdown-track">
                <div class="analytics-breakdown-fill analytics-breakdown-fill--info" :style="{ width: `${bucket.widthPercent}%` }" />
              </div>
              <div class="analytics-timeline-meta">
                完成 {{ bucket.completedRuns }} · 失败 {{ bucket.failedRuns }} · 待处理 {{ bucket.attentionRuns }} · 介入 {{ bucket.interventionRuns }}
              </div>
            </div>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <a-row :gutter="[16, 16]">
      <a-col :xs="24" :xl="12">
        <a-card size="small" title="Agent 表现排行" :loading="loading">
          <a-empty v-if="!health || health.agentRanking.length === 0" description="暂无 Agent 排行" />
          <div v-else class="analytics-ranking-list">
            <div v-for="item in health.agentRanking" :key="`agent-${item.key}`" class="analytics-ranking-item">
              <a-flex justify="space-between" align="start" :gap="12">
                <div>
                  <div class="analytics-ranking-title">{{ item.label }}</div>
                  <div class="analytics-ranking-meta">
                    总运行 {{ item.totalRuns }} · 成功率 {{ formatPercent(item.successRate) }} · 失败率 {{ formatPercent(item.failureRate) }}
                  </div>
                  <div class="analytics-ranking-meta">
                    平均时长 {{ formatDuration(item.avgDurationMs) }} · 平均 Tokens {{ formatToken(item.avgTokenUsed) }}
                  </div>
                </div>
                <a-button size="small" @click="applyAgentFilter(item.label)">筛到该 Agent</a-button>
              </a-flex>
            </div>
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :xl="12">
        <a-card size="small" title="模型表现排行" :loading="loading">
          <a-empty v-if="!health || health.modelRanking.length === 0" description="暂无模型排行" />
          <div v-else class="analytics-ranking-list">
            <div v-for="item in health.modelRanking" :key="`model-${item.key}`" class="analytics-ranking-item">
              <a-flex justify="space-between" align="start" :gap="12">
                <div>
                  <div class="analytics-ranking-title">{{ item.label }}</div>
                  <div class="analytics-ranking-meta">
                    总运行 {{ item.totalRuns }} · 成功率 {{ formatPercent(item.successRate) }} · 失败率 {{ formatPercent(item.failureRate) }}
                  </div>
                  <div class="analytics-ranking-meta">
                    平均时长 {{ formatDuration(item.avgDurationMs) }} · 平均 Tokens {{ formatToken(item.avgTokenUsed) }}
                  </div>
                </div>
                <a-button size="small" @click="applyModelFilter(item.key)">筛到该模型</a-button>
              </a-flex>
            </div>
          </div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  AgentOpsAnalyticsFailuresView,
  AgentOpsAnalyticsHealthView,
  AgentOpsAnalyticsTimelineView,
  AgentOpsPageQuery,
  AgentOpsQueue,
} from "../../lib/api";

const props = defineProps<{
  loading: boolean;
  health: AgentOpsAnalyticsHealthView | null;
  failures: AgentOpsAnalyticsFailuresView | null;
  timeline: AgentOpsAnalyticsTimelineView | null;
  scopeTagLabel: string;
  pageQuery: AgentOpsPageQuery;
  formatDurationFromMs: (value?: number | null) => string;
  formatTokenCount: (value?: number | null) => string;
}>();

const emit = defineEmits<{
  (e: "applyFilters", payload: { queryPatch: Partial<AgentOpsPageQuery>; queueFocus?: "all" | AgentOpsQueue }): void;
}>();

const trendMetric = ref<"attention" | "failed" | "completed" | "intervention">("attention");

const insightTitle = computed(() => {
  const totals = props.health?.totals;
  if (!totals) return "当前筛选条件下暂无可分析数据";
  if (totals.approvalBlockedRuns > 0) {
    return `当前有 ${totals.approvalBlockedRuns} 个审批阻塞实例，需要优先处理`;
  }
  if (totals.failureRate >= 20) {
    return `当前失败率 ${formatPercent(totals.failureRate)}，已超过常规巡检阈值`;
  }
  return `当前共追踪 ${totals.totalRuns} 个实例，重点关注 ${totals.attentionRuns} 个待处理项`;
});

const insightDescription = computed(() => {
  const totals = props.health?.totals;
  if (!totals) return "调整上方筛选条件后，这里会展示管理员视角下的聚合健康度、异常分布和趋势。";
  return `介入率 ${formatPercent(totals.interventionRate)}，平均时长 ${formatDuration(totals.avgDurationMs)}，失败实例 ${totals.failedRuns} 个。点击下方异常、排行或风险标签可以直接回写筛选。`;
});

const summaryCards = computed(() => {
  const totals = props.health?.totals;
  if (!totals) return [];
  return [
    { key: "total", label: "总实例数", value: String(totals.totalRuns), hint: `待处理 ${totals.attentionRuns} 个` },
    { key: "failure", label: "失败率", value: formatPercent(totals.failureRate), hint: `失败 ${totals.failedRuns} 个` },
    { key: "intervention", label: "介入率", value: formatPercent(totals.interventionRate), hint: `人工介入 ${totals.humanInterventionRuns} 个` },
    { key: "duration", label: "平均时长", value: formatDuration(totals.avgDurationMs), hint: `审批阻塞 ${totals.approvalBlockedRuns} 个` },
  ];
});

const timelineRows = computed(() => {
  const buckets = props.timeline?.buckets || [];
  const metricValues = buckets.map((bucket) => {
    if (trendMetric.value === "failed") return bucket.failedRuns;
    if (trendMetric.value === "completed") return bucket.completedRuns;
    if (trendMetric.value === "intervention") return bucket.interventionRuns;
    return bucket.attentionRuns;
  });
  const maxValue = Math.max(1, ...metricValues);
  return buckets.map((bucket) => {
    const metricValue = trendMetric.value === "failed"
      ? bucket.failedRuns
      : trendMetric.value === "completed"
        ? bucket.completedRuns
        : trendMetric.value === "intervention"
          ? bucket.interventionRuns
          : bucket.attentionRuns;
    return {
      ...bucket,
      metricValue,
      widthPercent: Math.max(8, Math.round((metricValue / maxValue) * 100)),
    };
  });
});

function setTrendMetric(value: unknown) {
  trendMetric.value = value === "failed" || value === "completed" || value === "intervention" ? value : "attention";
}

function formatPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "0%";
  return `${Math.round(value)}%`;
}

function formatDuration(value?: number | null) {
  return props.formatDurationFromMs(value);
}

function formatToken(value?: number | null) {
  return props.formatTokenCount(value);
}

function formatGeneratedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleTimeString();
}

function riskTagColor(label: string) {
  if (label.includes("严重")) return "magenta";
  if (label.includes("高风险")) return "red";
  if (label.includes("中风险")) return "orange";
  return "green";
}

function emitFilter(queryPatch: Partial<AgentOpsPageQuery>, queueFocus?: "all" | AgentOpsQueue) {
  emit("applyFilters", { queryPatch, queueFocus });
}

function applyBlockerFilter(label: string) {
  if (label.includes("审批")) {
    emitFilter({ approvalBlocked: true, status: undefined }, "attention");
    return;
  }
  if (label.includes("恢复")) {
    emitFilter({ status: "paused", requiresIntervention: true }, "attention");
    return;
  }
  if (label.includes("停止")) {
    emitFilter({ status: "stopped", requiresIntervention: true }, "attention");
    return;
  }
  if (label.includes("无进展")) {
    emitFilter({ requiresIntervention: true, status: undefined }, "attention");
    return;
  }
  emitFilter({ requiresIntervention: true }, "attention");
}

function applyFailureReasonFilter(label: string) {
  if (label.includes("审批")) {
    emitFilter({ approvalBlocked: true }, "attention");
    return;
  }
  if (label.includes("恢复")) {
    emitFilter({ status: "paused", requiresIntervention: true }, "attention");
    return;
  }
  if (label.includes("无进展")) {
    emitFilter({ requiresIntervention: true }, "attention");
    return;
  }
  emitFilter({ status: "failed" }, "attention");
}

function applyRiskFilter(label: string) {
  const riskLevel = label.includes("严重")
    ? "critical"
    : label.includes("高风险")
      ? "high"
      : label.includes("中风险")
        ? "medium"
        : "low";
  emitFilter({ riskLevel }, "attention");
}

function applyAgentFilter(agentType: string) {
  emitFilter({ agentType, model: undefined }, "all");
}

function applyModelFilter(model: string) {
  emitFilter({ model, agentType: undefined }, "all");
}
</script>

<style scoped>
.agent-analytics-panel {
  margin-top: 16px;
}

.analytics-stat-label,
.analytics-stat-hint,
.analytics-ranking-meta,
.analytics-timeline-meta,
.analytics-breakdown-share {
  color: #64748b;
  font-size: 12px;
}

.analytics-stat-value {
  margin-top: 6px;
  font-size: 24px;
  font-weight: 600;
  color: #0f172a;
}

.analytics-stat-hint {
  margin-top: 6px;
}

.analytics-section-title {
  margin-bottom: 8px;
  font-weight: 600;
  color: #0f172a;
}

.analytics-breakdown-list,
.analytics-ranking-list,
.analytics-timeline-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.analytics-breakdown-item,
.analytics-ranking-item {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
  background: #fff;
}

.analytics-breakdown-item {
  cursor: pointer;
  text-align: left;
}

.analytics-breakdown-item:hover,
.analytics-ranking-item:hover,
.analytics-clickable-tag:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
}

.analytics-breakdown-track {
  margin-top: 8px;
  height: 8px;
  border-radius: 999px;
  background: #e2e8f0;
  overflow: hidden;
}

.analytics-breakdown-fill {
  height: 100%;
  border-radius: inherit;
}

.analytics-breakdown-fill--danger {
  background: linear-gradient(90deg, #ef4444 0%, #f97316 100%);
}

.analytics-breakdown-fill--warning {
  background: linear-gradient(90deg, #f59e0b 0%, #fb7185 100%);
}

.analytics-breakdown-fill--info {
  background: linear-gradient(90deg, #2563eb 0%, #0f766e 100%);
}

.analytics-clickable-tag {
  cursor: pointer;
}

.analytics-ranking-title {
  font-weight: 600;
  color: #0f172a;
}

.analytics-timeline-row {
  padding-bottom: 8px;
  border-bottom: 1px dashed #e2e8f0;
}

.analytics-timeline-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
</style>