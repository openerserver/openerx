<template>
  <div class="agent-ops-page">
    <AgentOpsHeader
      :view-mode="viewMode"
      :view-mode-label="viewModeLabel"
      :entry-context="pageQuery.entryContext"
      :entry-context-label="entryContextLabel"
      :page-subtitle="pageSubtitle"
      :page-query="pageQuery"
      :project-options="projectOptions"
      :is-admin-role="isAdminRole"
      :realtime-connected="realtimeStore.connected"
      :connection-tooltip="connectionTooltip"
      :connection-label="connectionLabel"
      :loading="loading"
      :queue-data-loading="queueDataLoading"
      @project-change="handleProjectChange"
      @owner-scope-change="handleOwnerScopeChange"
      @reconnect="handleReconnect"
      @refresh="handleRefreshAll"
    />

    <AgentOpsFilterBar
      :page-query="pageQuery"
      :provider-options="providerOptions"
      :queue-focus="queueFocus"
      :advanced-filter-active-keys="advancedFilterActiveKeys"
      :scope-summary-text="scopeSummaryText"
      :boolean-select-value="booleanSelectValue"
      @search-change="pageQuery.search = normalizeOptionalString($event)"
      @model-change="handleModelChange"
      @status-change="handleStatusChange"
      @queue-focus-change="handleQueueFocusChange"
      @toggle-advanced-filters="toggleAdvancedFilters"
      @advanced-filter-collapse="handleAdvancedFilterCollapse"
      @risk-level-change="handleRiskLevelChange"
      @requires-intervention-change="handleRequiresInterventionChange"
      @approval-blocked-change="handleApprovalBlockedChange"
      @agent-type-change="pageQuery.agentType = normalizeOptionalString($event)"
    />

    <AgentOpsQueueBoard
      :summary-cards="summaryCards"
      :queue-focus="queueFocus"
      :queue-data-loading="queueDataLoading"
      :displayed-total-known-runs="displayedTotalKnownRuns"
      :attention-queue="attentionQueue"
      :running-queue="runningQueue"
      :recent-queue="recentQueue"
      :selected-agent-id="selectedAgentId"
      :view-mode="viewMode"
      :scope-tag-label="scopeTagLabel"
      :active-project-label="activeProjectLabel"
      :page-query="pageQuery"
      :key-events="keyEvents"
      :can-inject-guidance-globally="canInjectGuidanceGlobally"
      :agent-select-options="agentSelectOptions"
      :quick-guidance="quickGuidance"
      :guidance-mode="guidanceMode"
      :guidance-loading="guidanceLoading"
      :status-color="statusColor"
      :status-label="statusLabel"
      :event-color="eventColor"
      :summarize-event="summarizeEvent"
      :format-relative-time="formatRelativeTime"
      :format-token-raw="formatTokenRaw"
      :format-token-count="formatTokenCount"
      :short-id="shortId"
      @queue-focus-change="handleQueueFocusChange"
      @open-agent-drawer="openAgentDrawer"
      @selected-agent-change="setSelectedAgentId"
      @quick-guidance-change="quickGuidance = $event"
      @guidance-mode-change="guidanceMode = $event === 'noReply' ? 'noReply' : 'reply'"
      @quick-guidance-send="handleQuickGuidance"
    />

    <AgentOpsAnalyticsPanel
      v-if="isAdminRole"
      :loading="analyticsLoading"
      :health="agentAnalytics?.health ?? null"
      :failures="agentAnalytics?.failures ?? null"
      :timeline="agentAnalytics?.timeline ?? null"
      :scope-tag-label="scopeTagLabel"
      :page-query="pageQuery"
      :format-duration-from-ms="formatDurationFromMs"
      :format-token-count="formatTokenCount"
      @apply-filters="handleAnalyticsApplyFilters"
    />

    <AgentOpsDetailDrawer
      :open="detailDrawerVisible"
      :summary="selectedRunSummaryView"
      :summary-loading="summaryLoading"
      :drawer-mode="drawerMode"
      :view-mode="viewMode"
      :action-permissions="selectedActionPermissions"
      :action-loading="actionLoading"
      :inline-guidance="selectedRunSummaryView ? (inlineGuidance[selectedRunSummaryView.agentRunId] || '') : ''"
      :status-color="statusColor"
      :status-label="statusLabel"
      :event-color="eventColor"
      :parse-date="parseDate"
      :format-relative-time="formatRelativeTime"
      :format-duration-from-ms="formatDurationFromMs"
      :format-token-raw="formatTokenRaw"
      :format-token-count="formatTokenCount"
      :summary-judgement-label="summaryJudgementLabel"
      :code-changes-summary-text="codeChangesSummaryText"
      @close="handleCloseDrawer"
      @drawer-mode-change="handleDrawerModeChange"
      @pause="handlePause"
      @resume="handleResume"
      @terminate="handleTerminate"
      @copy-diagnostics="copyDiagnostics"
      @inline-guidance-send="handleInlineGuidance"
      @inline-guidance-change="handleInlineGuidanceChange"
    />
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type AgentOpsActionPermissions,
  type AgentOpsAnalyticsView,
  type AgentOpsEntryContext,
  type AgentOpsOverview,
  type AgentOpsOwnerScope,
  type AgentOpsPageQuery,
  type AgentOpsQueue,
  type AgentOpsQueueItem,
  type AgentOpsViewMode,
  type AgentRunOpsSummary,
  type AgentRunSummary,
  getAgentOpsAnalyticsFailures,
  getAgentOpsAnalyticsHealth,
  getAgentOpsAnalyticsTimeline,
  getAgentOpsOverview,
  getAgentOpsQueue,
  getAgentRunOpsSummary,
  injectGuidance,
  listAgentRuns,
  pauseAgent,
  resumeAgent,
  terminateAgent,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { type RealtimeEvent, useRealtimeStore } from "../stores/realtime";

type AgentRunStatus = "running" | "paused" | "completed" | "failed" | "stopped" | "terminated";
type QueueFocus = "all" | AgentOpsQueue;
type BlockerType = "failed" | "paused" | "stalled" | "stopped" | "healthy";
type DrawerMode = "quickAction" | "deepReview";

interface AgentRun {
  agentRunId: string;
  subSessionId?: string;
  status: AgentRunStatus;
  taskId: string;
  projectId?: string;
  agentType: string;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: string;
}

interface RunContext {
  blockerType: BlockerType;
  blockerLabel: string;
  requiresAttention: boolean;
  summary: string;
  longSummary: string;
  guidanceCount: number;
  durationLabel: string;
  finishedAtMs: number | null;
}

interface QueueViewItem {
  agentRunId: string;
  taskId: string;
  taskTitle?: string;
  projectId?: string;
  projectName?: string | null;
  agentType: string;
  status: AgentRunStatus;
  blockerLabel: string;
  summary: string;
  updatedAt: number;
  finishedAtMs: number | null;
  modelUsed: string | null;
  tokenUsed: number;
  guidanceCount: number;
  requiresAttention: boolean;
  startedAt?: number;
}

const authStore = useAuthStore();
const realtimeStore = useRealtimeStore();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const actionLoading = ref<string | null>(null);
const guidanceLoading = ref(false);
const detailDrawerVisible = ref(false);
const queueDataLoading = ref(false);
const summaryLoading = ref(false);
const analyticsLoading = ref(false);
const drawerMode = ref<DrawerMode>("quickAction");
const advancedFilterActiveKeys = ref<string[]>([]);

const registeredRuns = ref<AgentRun[]>([]);
const selectedAgentId = ref<string | undefined>(undefined);
const quickGuidance = ref("");
const guidanceMode = ref<"reply" | "noReply">("reply");
const inlineGuidance = reactive<Record<string, string>>({});

const pageQuery = reactive<AgentOpsPageQuery>({
  ownerScope: "mine",
  entryContext: "nav",
});
const queueFocus = ref<QueueFocus>("attention");
const agentOverview = ref<AgentOpsOverview | null>(null);
const remoteQueuesLoaded = ref(false);
const remoteAttentionQueue = ref<AgentOpsQueueItem[]>([]);
const remoteRunningQueue = ref<AgentOpsQueueItem[]>([]);
const remoteRecentQueue = ref<AgentOpsQueueItem[]>([]);
const remoteAttentionTotal = ref(0);
const remoteRunningTotal = ref(0);
const remoteRecentTotal = ref(0);
const selectedRunSummary = ref<AgentRunOpsSummary | null>(null);
const agentAnalytics = ref<AgentOpsAnalyticsView | null>(null);
const aggregateRefreshTimer = ref<number | null>(null);
const isProviderScoped = computed(() => (pageQuery.model ?? "").trim().length > 0);

const ADMIN_ROLES = new Set(["project_admin", "org_admin", "platform_admin"]);

function normalizeOptionalString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseBooleanQueryValue(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function booleanSelectValue(value?: boolean) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

function defaultOwnerScope(): AgentOpsOwnerScope {
  return ADMIN_ROLES.has(authStore.user?.role || "") ? "all" : "mine";
}

function defaultQueueFocus(): QueueFocus {
  return ADMIN_ROLES.has(authStore.user?.role || "") ? "all" : "attention";
}

function defaultDrawerMode(): DrawerMode {
  return ADMIN_ROLES.has(authStore.user?.role || "") ? "deepReview" : "quickAction";
}

function toEntryContext(value: unknown): AgentOpsEntryContext {
  return value === "task" || value === "workbench" || value === "approval" || value === "alert"
    ? value
    : "nav";
}

function setSelectedAgentId(value: unknown) {
  selectedAgentId.value = value == null ? undefined : String(value);
}

function handleProjectChange(value: unknown) {
  pageQuery.projectId = normalizeOptionalString(value);
}

function handleOwnerScopeChange(value: unknown) {
  pageQuery.ownerScope = value === "all" ? "all" : "mine";
}

function handleStatusChange(value: unknown) {
  const normalized = normalizeOptionalString(value);
  pageQuery.status = normalized as AgentOpsPageQuery["status"];
}

function handleModelChange(value: unknown) {
  pageQuery.model = normalizeOptionalString(value);
}

function handleRiskLevelChange(value: unknown) {
  const normalized = normalizeOptionalString(value);
  pageQuery.riskLevel = normalized as AgentOpsPageQuery["riskLevel"];
}

function handleRequiresInterventionChange(value: unknown) {
  pageQuery.requiresIntervention = parseBooleanQueryValue(value);
}

function handleApprovalBlockedChange(value: unknown) {
  pageQuery.approvalBlocked = parseBooleanQueryValue(value);
}

function toggleAdvancedFilters() {
  advancedFilterActiveKeys.value = advancedFilterActiveKeys.value.length > 0 ? [] : ["advanced"];
}

function handleAdvancedFilterCollapse(value: unknown) {
  advancedFilterActiveKeys.value = Array.isArray(value)
    ? value.map(String)
    : value == null
      ? []
      : [String(value)];
}

function handleDrawerModeChange(value: unknown) {
  drawerMode.value = value === "deepReview" ? "deepReview" : "quickAction";
}

function handleInlineGuidanceChange(value: string) {
  if (!selectedRunSummaryView.value) return;
  inlineGuidance[selectedRunSummaryView.value.agentRunId] = value;
}

function handleAnalyticsApplyFilters(payload: {
  queryPatch: Partial<AgentOpsPageQuery>;
  queueFocus?: QueueFocus;
}) {
  Object.assign(pageQuery, payload.queryPatch);
  if (payload.queueFocus) {
    queueFocus.value = payload.queueFocus;
  }
  advancedFilterActiveKeys.value = ["advanced"];
}

function handleQueueFocusChange(value: unknown) {
  const next = String(value ?? "all");
  if (next === "attention" || next === "running" || next === "recent" || next === "all") {
    queueFocus.value = next;
  }
}

function normalizeAgentEventStatus(eventType?: string): AgentRunStatus | undefined {
  const statusMap: Record<string, AgentRunStatus> = {
    "agent.started": "running",
    "agent.running": "running",
    "agent.resumed": "running",
    "agent.paused": "paused",
    "agent.completed": "completed",
    "agent.failed": "failed",
    "agent.stopped": "stopped",
  };
  return eventType ? statusMap[eventType] : undefined;
}

function normalizeAgentStatus(status?: string): AgentRunStatus {
  const statusMap: Record<string, AgentRunStatus> = {
    running: "running",
    paused: "paused",
    completed: "completed",
    failed: "failed",
    stopped: "stopped",
    terminated: "terminated",
  };
  return statusMap[status || ""] || "running";
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    running: "blue",
    paused: "orange",
    completed: "green",
    failed: "red",
    stopped: "default",
    terminated: "red",
  };
  return map[status] || "default";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    stopped: "已停止",
    terminated: "已终止",
  };
  return map[status] || status;
}

function eventColor(type: string) {
  if (type.includes("guidance")) return "purple";
  if (type.includes("failed") || type.includes("stopped") || type.includes("error")) return "red";
  if (type.includes("paused")) return "orange";
  if (type.includes("completed")) return "green";
  if (type.includes("started") || type.includes("running") || type.includes("resumed"))
    return "blue";
  return "default";
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleString();
}

function summaryJudgementLabel(summary: AgentRunOpsSummary) {
  if (summary.blockerType) return "需要处理";
  if (summary.status === "completed") return "已完成";
  if (summary.status === "failed") return "失败";
  if (summary.status === "stopped" || summary.status === "terminated") return "已停止";
  if (summary.status === "paused") return "已暂停";
  return "推进中";
}

function formatRelativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  if (!Number.isFinite(diff) || diff < 0) return "-";
  if (diff < 60000) return `${Math.max(1, Math.round(diff / 1000))}秒前`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}小时前`;
  return `${Math.round(diff / 86400000)}天前`;
}

function formatDuration(startedAt?: number, finishedAtMs?: number | null) {
  if (!startedAt) return "-";
  const end = finishedAtMs ?? Date.now();
  const diff = Math.max(0, end - startedAt);
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  if (minutes <= 0) return `${seconds} 秒`;
  if (minutes < 60) return `${minutes} 分 ${seconds} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const utcLikeMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/,
  );
  if (utcLikeMatch) {
    const normalizedValue = `${value.replace(" ", "T")}Z`;
    const timestamp = Date.parse(normalizedValue);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function shortId(value?: string) {
  return value ? value.slice(0, 8) : "-";
}

function formatDurationFromMs(durationMs?: number | null) {
  if (durationMs == null || !Number.isFinite(durationMs)) return "-";
  return formatDuration(Date.now() - durationMs, Date.now());
}

function formatTokenCount(tokenUsed?: number | null) {
  if (tokenUsed == null || !Number.isFinite(tokenUsed) || tokenUsed <= 0) return "-";
  if (tokenUsed >= 1_000_000) return `${(tokenUsed / 1_000_000).toFixed(1)}M`;
  if (tokenUsed >= 1_000) return `${(tokenUsed / 1_000).toFixed(1)}k`;
  return String(Math.round(tokenUsed));
}

function formatTokenRaw(tokenUsed?: number | null) {
  if (tokenUsed == null || !Number.isFinite(tokenUsed) || tokenUsed <= 0) return "-";
  return `${Math.round(tokenUsed).toLocaleString()} tokens`;
}

function parseProviderId(modelUsed?: string | null) {
  const value = modelUsed?.trim();
  if (!value) return "unknown";
  const colonIndex = value.indexOf(":");
  if (colonIndex > 0) return value.slice(0, colonIndex);
  const slashIndex = value.indexOf("/");
  if (slashIndex > 0) return value.slice(0, slashIndex);
  return value;
}

function normalizeRemoteQueueItem(item: AgentOpsQueueItem) {
  return {
    agentRunId: item.agentRunId,
    taskId: item.taskId,
    taskTitle: item.taskTitle,
    projectId: item.projectId,
    projectName: item.projectName,
    agentType: item.agentType || "Agent",
    status: normalizeAgentStatus(item.status),
    blockerLabel: item.blockerLabel || "运行中",
    summary: item.resultSummary || item.blockerReason || "暂无结构化摘要。",
    updatedAt: parseDate(item.lastActivityAt) ?? parseDate(item.startedAt) ?? Date.now(),
    finishedAtMs: parseDate(item.finishedAt),
    modelUsed: item.modelUsed,
    tokenUsed: item.tokenUsed,
    guidanceCount: item.guidanceCount,
    requiresAttention: item.requiresIntervention,
    startedAt: parseDate(item.startedAt) ?? undefined,
  } satisfies QueueViewItem;
}

function matchesModelFilter(item: QueueViewItem) {
  const normalizedFilter = pageQuery.model?.trim().toLowerCase();
  if (!normalizedFilter) return true;
  const modelUsed = item.modelUsed?.trim().toLowerCase() || "";
  const providerId = parseProviderId(item.modelUsed).trim().toLowerCase();
  return modelUsed.includes(normalizedFilter) || providerId === normalizedFilter;
}

function summarizeEvent(evt: RealtimeEvent) {
  if (typeof evt.data.content === "string" && evt.data.content.trim()) {
    return evt.data.content.slice(0, 120);
  }
  if (typeof evt.data.reason === "string" && evt.data.reason.trim()) {
    return evt.data.reason;
  }
  if (typeof evt.data.message === "string" && evt.data.message.trim()) {
    return evt.data.message;
  }
  const payload = Object.keys(evt.data).length > 0 ? JSON.stringify(evt.data) : "无附加数据";
  return payload.slice(0, 120);
}

function mapRegisteredRun(run: AgentRunSummary): AgentRun {
  return {
    agentRunId: run.agentRunId,
    subSessionId: run.subSessionId,
    status: normalizeAgentStatus(run.status),
    taskId: run.taskId,
    projectId: run.projectId,
    agentType: run.agentType || "Agent",
    updatedAt: run.pausedAt ?? run.startedAt ?? Date.now(),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

const connectionLabel = computed(() => (realtimeStore.connected ? "实时连接" : "未连接"));

const connectionTooltip = computed(() => {
  const lastEvent = realtimeStore.events[0];
  if (realtimeStore.connected) {
    return lastEvent ? `已连接 · 最近事件 ${formatTime(lastEvent.ts)}` : "已连接 · 等待事件";
  }
  return "未连接 · 点击“重连”恢复实时订阅";
});

const isAdminRole = computed(() => ADMIN_ROLES.has(authStore.user?.role || ""));

const viewMode = computed<AgentOpsViewMode>(() => (isAdminRole.value ? "admin" : "user"));

const viewModeLabel = computed(() => (viewMode.value === "admin" ? "管理员视图" : "普通用户视图"));

const pageSubtitle = computed(() =>
  viewMode.value === "admin"
    ? "统一查看 Agent 执行健康度、阻塞情况、治理信号与人工介入入口。"
    : "统一查看与我相关的 Agent 阻塞、结果与人工介入入口。",
);

const entryContextLabel = computed(() => {
  const labelMap: Record<AgentOpsEntryContext, string> = {
    nav: "导航进入",
    task: "任务上下文",
    workbench: "工作台上下文",
    approval: "审批回跳",
    alert: "告警回跳",
  };
  return labelMap[pageQuery.entryContext ?? "nav"];
});

const projectOptions = computed(() =>
  (authStore.user?.projects || []).map((project) => ({
    value: project.id,
    label: project.name || project.id,
  })),
);

const activeProjectLabel = computed(() => {
  if (!pageQuery.projectId) return null;
  return (
    projectOptions.value.find((project) => project.value === pageQuery.projectId)?.label ||
    pageQuery.projectId
  );
});

const scopeTagLabel = computed(() => {
  if (pageQuery.ownerScope === "mine") {
    return activeProjectLabel.value ? `我的任务 · ${activeProjectLabel.value}` : "我的任务";
  }
  return activeProjectLabel.value ? `项目视图 · ${activeProjectLabel.value}` : "全局 / 项目视图";
});

const scopeSummaryText = computed(() => {
  const scopeLabel =
    pageQuery.ownerScope === "mine" ? "我的视图" : isAdminRole.value ? "管理员视图" : "当前视图";
  return `${scopeLabel}共 ${visibleRunCount.value} 个实例，待处理 ${attentionQueue.value.length} 个。`;
});

const canInjectGuidanceGlobally = computed(() => authStore.user?.role !== "viewer");

function resolveActionPermissions(summary?: AgentRunOpsSummary | null): AgentOpsActionPermissions {
  const fallback: AgentOpsActionPermissions = {
    canPause: authStore.user?.role !== "viewer",
    canResume: authStore.user?.role !== "viewer",
    canTerminate: authStore.user?.role !== "viewer",
    canInjectGuidance: authStore.user?.role !== "viewer",
    canViewApproval: authStore.user?.role !== "viewer",
    canViewAudit: isAdminRole.value,
    canViewCodeChanges: true,
    canExport: isAdminRole.value,
  };
  return { ...fallback, ...(summary?.actionPermissions || {}) };
}

const agentEvents = computed(() =>
  realtimeStore.events.filter((e) => e.type.startsWith("agent.") || e.type === "guidance.injected"),
);

const attentionQueue = computed(() => {
  return remoteAttentionQueue.value.map(normalizeRemoteQueueItem).filter(matchesModelFilter);
});

const runningQueue = computed(() => {
  return remoteRunningQueue.value.map(normalizeRemoteQueueItem).filter(matchesModelFilter);
});

const recentQueue = computed(() => {
  return remoteRecentQueue.value.map(normalizeRemoteQueueItem).filter(matchesModelFilter);
});

const providerOptions = computed(() =>
  Array.from(
    new Set(
      [...remoteAttentionQueue.value, ...remoteRunningQueue.value, ...remoteRecentQueue.value]
        .flatMap((item) => {
          const values = [parseProviderId(item.modelUsed)];
          if (item.modelUsed?.trim()) {
            values.push(item.modelUsed.trim());
          }
          return values;
        })
        .concat(pageQuery.model?.trim() ? [pageQuery.model.trim()] : [])
        .filter(Boolean),
    ),
  ).sort(),
);

const allQueueItems = computed(() => [
  ...attentionQueue.value,
  ...runningQueue.value,
  ...recentQueue.value,
]);

const selectedActionPermissions = computed(() =>
  resolveActionPermissions(selectedRunSummaryView.value),
);

const selectedQueueItem = computed(() =>
  selectedAgentId.value
    ? allQueueItems.value.find((item) => item.agentRunId === selectedAgentId.value)
    : undefined,
);

const selectedRunSummaryView = computed(() => {
  if (selectedRunSummary.value) return selectedRunSummary.value;
  if (!selectedQueueItem.value) return null;
  return {
    entryContext: pageQuery.entryContext,
    viewScope:
      pageQuery.ownerScope === "mine" ? "mine" : pageQuery.projectId ? "project" : "global",
    agentRunId: selectedQueueItem.value.agentRunId,
    taskId: selectedQueueItem.value.taskId,
    taskTitle: selectedQueueItem.value.taskTitle || selectedQueueItem.value.taskId,
    projectId: selectedQueueItem.value.projectId || "",
    projectName: selectedQueueItem.value.projectName || null,
    agentType: selectedQueueItem.value.agentType,
    status: selectedQueueItem.value.status,
    sessionId: null,
    modelUsed: null,
    startedAt: selectedQueueItem.value.startedAt
      ? new Date(selectedQueueItem.value.startedAt).toISOString()
      : null,
    finishedAt: selectedQueueItem.value.finishedAtMs
      ? new Date(selectedQueueItem.value.finishedAtMs).toISOString()
      : null,
    lastActivityAt: new Date(selectedQueueItem.value.updatedAt).toISOString(),
    durationMs: selectedQueueItem.value.startedAt
      ? Math.max(0, Date.now() - selectedQueueItem.value.startedAt)
      : null,
    tokenUsed: selectedQueueItem.value.tokenUsed,
    blockerType: selectedQueueItem.value.requiresAttention ? "attention" : null,
    blockerLabel: selectedQueueItem.value.blockerLabel,
    riskLevel: null,
    guidanceCount: selectedQueueItem.value.guidanceCount,
    resultSummary: selectedQueueItem.value.summary,
    result: null,
    error: null,
    longSummary: selectedQueueItem.value.summary,
    latestEvents: [],
    actionPermissions: resolveActionPermissions(),
  } satisfies AgentRunOpsSummary;
});

const filteredRunCount = computed(
  () => remoteAttentionTotal.value + remoteRunningTotal.value + remoteRecentTotal.value,
);
const providerFilteredRunCount = computed(
  () => attentionQueue.value.length + runningQueue.value.length + recentQueue.value.length,
);
const visibleRunCount = computed(() =>
  isProviderScoped.value ? providerFilteredRunCount.value : filteredRunCount.value,
);

const totalKnownRuns = computed(
  () =>
    (agentOverview.value?.queueCounts.attention ?? 0) +
    (agentOverview.value?.queueCounts.running ?? 0) +
    (agentOverview.value?.queueCounts.recent ?? 0),
);
const displayedTotalKnownRuns = computed(() =>
  isProviderScoped.value ? visibleRunCount.value : totalKnownRuns.value,
);

const completedIn24h = computed(() =>
  isProviderScoped.value
    ? recentQueue.value.filter((run) => run.status === "completed").length
    : (agentOverview.value?.summary.completedCount ??
      recentQueue.value.filter((run) => run.status === "completed").length),
);

const failureRate = computed(() => {
  if (agentOverview.value && !isProviderScoped.value)
    return `${Math.round(agentOverview.value.summary.failureRate)}%`;
  const endedRuns = recentQueue.value.filter((run) =>
    ["completed", "failed", "stopped", "terminated"].includes(run.status),
  );
  if (endedRuns.length === 0) return "0%";
  const failedRuns = endedRuns.filter((run) =>
    ["failed", "stopped", "terminated"].includes(run.status),
  ).length;
  return `${Math.round((failedRuns / endedRuns.length) * 100)}%`;
});

const averageDuration = computed(() => {
  if (agentOverview.value?.summary.avgDurationMs != null && !isProviderScoped.value) {
    return formatDurationFromMs(agentOverview.value.summary.avgDurationMs);
  }
  const endedRuns = recentQueue.value.filter((run) => run.startedAt && run.finishedAtMs);
  if (endedRuns.length === 0) return "-";
  const total = endedRuns.reduce(
    (sum, run) => sum + ((run.finishedAtMs || 0) - (run.startedAt || 0)),
    0,
  );
  return formatDuration(Date.now() - total / endedRuns.length, Date.now());
});

const interventionRate = computed(() => {
  if (agentOverview.value && !isProviderScoped.value)
    return `${Math.round(agentOverview.value.summary.humanInterventionRate)}%`;
  if (allQueueItems.value.length === 0) return "0%";
  const withGuidance = allQueueItems.value.filter((run) => run.guidanceCount > 0).length;
  return `${Math.round((withGuidance / allQueueItems.value.length) * 100)}%`;
});

const summaryCards = computed(() => [
  {
    key: "attention",
    focusKey: "attention" as QueueFocus,
    label: "待处理事项",
    value: isProviderScoped.value
      ? attentionQueue.value.length
      : (agentOverview.value?.summary.attentionCount ?? attentionQueue.value.length),
    hint: "失败、暂停和无进展实例",
    color: "#dc2626",
  },
  {
    key: "running",
    focusKey: "running" as QueueFocus,
    label: "运行中",
    value: isProviderScoped.value
      ? runningQueue.value.length
      : (agentOverview.value?.summary.runningCount ?? runningQueue.value.length),
    hint: "正在持续推进的 Agent",
    color: "#2563eb",
  },
  {
    key: "completed24h",
    focusKey: "recent" as QueueFocus,
    label: "24h 完成数",
    value: completedIn24h.value,
    hint: "最近 24 小时已完成",
    color: "#16a34a",
  },
  {
    key: "failureRate",
    focusKey: "attention" as QueueFocus,
    label: "失败率",
    value: failureRate.value,
    hint: "最近结果中的失败占比",
    color: "#ea580c",
  },
  {
    key: "avgDuration",
    focusKey: "recent" as QueueFocus,
    label: "平均时长",
    value: averageDuration.value,
    hint: "最近完成实例的平均用时",
    color: "#7c3aed",
  },
  {
    key: "intervention",
    focusKey: "attention" as QueueFocus,
    label: "介入率",
    value: interventionRate.value,
    hint: "含人工补充指令的占比",
    color: "#0f766e",
  },
]);

const keyEvents = computed(() =>
  agentEvents.value
    .filter((event) => {
      if (event.type === "guidance.injected") return true;
      return [
        "agent.failed",
        "agent.paused",
        "agent.resumed",
        "agent.completed",
        "agent.stopped",
        "agent.started",
      ].includes(event.type);
    })
    .slice(0, 12),
);

const agentSelectOptions = computed(() =>
  registeredRuns.value
    .filter((run) => run.status === "running" || run.status === "paused")
    .map((run) => ({
      value: run.agentRunId,
      label: `${run.agentType} (${shortId(run.agentRunId)}) · ${statusLabel(run.status)}`,
    })),
);

function openAgentDrawer(agentRunId: string) {
  selectedAgentId.value = agentRunId;
  detailDrawerVisible.value = true;
  pageQuery.agentRunId = agentRunId;
  drawerMode.value = defaultDrawerMode();
  void loadAgentRunSummary(agentRunId);
}

function handleCloseDrawer() {
  detailDrawerVisible.value = false;
  pageQuery.agentRunId = undefined;
}

function handleReconnect() {
  if (!authStore.token) return;
  realtimeStore.disconnect();
  realtimeStore.connect(authStore.token);
  message.info("正在重新连接...");
}

function copyDiagnostics() {
  if (!selectedQueueItem.value && !selectedRunSummary.value) return;
  const payload = {
    run: selectedRunSummary.value || selectedQueueItem.value,
    recentEvents: selectedRunSummary.value?.latestEvents || [],
  };
  navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  message.success("诊断信息已复制到剪贴板");
}

async function refreshAgents() {
  loading.value = true;
  try {
    registeredRuns.value = (await listAgentRuns()).map(mapRegisteredRun);
  } catch {
    registeredRuns.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleRefreshAll() {
  await Promise.all([refreshAgents(), refreshAggregates(), refreshAnalytics()]);
}

async function refreshAggregates() {
  queueDataLoading.value = true;
  try {
    const queueQuery = {
      ownerScope: pageQuery.ownerScope,
      projectId: pageQuery.projectId,
      taskId: pageQuery.taskId,
      agentRunId: pageQuery.agentRunId,
      status: pageQuery.status,
      search: pageQuery.search?.trim() || undefined,
      riskLevel: pageQuery.riskLevel,
      approvalBlocked: pageQuery.approvalBlocked,
      requiresIntervention: pageQuery.requiresIntervention,
      agentType: pageQuery.agentType,
      model: pageQuery.model,
      from: pageQuery.from,
      to: pageQuery.to,
      entryContext: pageQuery.entryContext,
    };
    const [overview, attention, running, recent] = await Promise.all([
      getAgentOpsOverview(pageQuery),
      getAgentOpsQueue("attention", queueQuery),
      getAgentOpsQueue("running", queueQuery),
      getAgentOpsQueue("recent", queueQuery),
    ]);
    agentOverview.value = overview;
    remoteAttentionQueue.value = attention.data;
    remoteRunningQueue.value = running.data;
    remoteRecentQueue.value = recent.data;
    remoteAttentionTotal.value = attention.total;
    remoteRunningTotal.value = running.total;
    remoteRecentTotal.value = recent.total;
    remoteQueuesLoaded.value = true;
  } catch {
    remoteQueuesLoaded.value = false;
    agentOverview.value = null;
    remoteAttentionQueue.value = [];
    remoteRunningQueue.value = [];
    remoteRecentQueue.value = [];
    remoteAttentionTotal.value = 0;
    remoteRunningTotal.value = 0;
    remoteRecentTotal.value = 0;
  } finally {
    queueDataLoading.value = false;
  }
}

async function refreshAnalytics() {
  if (!isAdminRole.value) {
    agentAnalytics.value = null;
    analyticsLoading.value = false;
    return;
  }

  analyticsLoading.value = true;
  try {
    const [health, failures, timeline] = await Promise.all([
      getAgentOpsAnalyticsHealth(pageQuery),
      getAgentOpsAnalyticsFailures(pageQuery),
      getAgentOpsAnalyticsTimeline(pageQuery),
    ]);
    agentAnalytics.value = { health, failures, timeline };
  } catch {
    agentAnalytics.value = null;
  } finally {
    analyticsLoading.value = false;
  }
}

function scheduleRealtimeRefresh(event: RealtimeEvent) {
  if (
    ![
      "agent.started",
      "agent.running",
      "agent.paused",
      "agent.resumed",
      "agent.completed",
      "agent.failed",
      "agent.stopped",
      "guidance.injected",
    ].includes(event.type)
  ) {
    return;
  }

  if (aggregateRefreshTimer.value != null) {
    window.clearTimeout(aggregateRefreshTimer.value);
  }

  aggregateRefreshTimer.value = window.setTimeout(() => {
    aggregateRefreshTimer.value = null;
    void Promise.all([
      refreshAgents(),
      refreshAggregates(),
      event.agentRunId && selectedAgentId.value === event.agentRunId && detailDrawerVisible.value
        ? loadAgentRunSummary(event.agentRunId)
        : Promise.resolve(),
    ]);
  }, 400);
}

async function loadAgentRunSummary(agentRunId: string) {
  summaryLoading.value = true;
  try {
    selectedRunSummary.value = await getAgentRunOpsSummary(agentRunId, {
      entryContext: pageQuery.entryContext,
      ownerScope: pageQuery.ownerScope,
    });
  } catch {
    selectedRunSummary.value = null;
  } finally {
    summaryLoading.value = false;
  }
}

function codeChangesSummaryText(summary: AgentRunOpsSummary) {
  const codeChanges = summary.codeChanges;
  if (!codeChanges) return "暂无代码变更摘要";
  if (codeChanges.latestSummary?.trim()) return codeChanges.latestSummary;
  const files = codeChanges.files ?? 0;
  const insertions = codeChanges.insertions ?? 0;
  const deletions = codeChanges.deletions ?? 0;
  if (!files && !insertions && !deletions) return "暂无代码变更摘要";
  return `变更 ${files} 个文件，+${insertions} / -${deletions}`;
}

async function handleAction(agentRunId: string, action: () => Promise<unknown>) {
  actionLoading.value = agentRunId;
  try {
    await action();
    await Promise.all([refreshAgents(), refreshAggregates()]);
    if (selectedAgentId.value === agentRunId) {
      await loadAgentRunSummary(agentRunId);
    }
    return true;
  } catch (error) {
    message.error(String(error));
    return false;
  } finally {
    actionLoading.value = null;
  }
}

async function handlePause(agentRunId: string) {
  await handleAction(agentRunId, () => pauseAgent(agentRunId));
}

async function handleResume(agentRunId: string) {
  await handleAction(agentRunId, () => resumeAgent(agentRunId));
}

async function handleTerminate(agentRunId: string) {
  await handleAction(agentRunId, () => terminateAgent(agentRunId));
}

async function handleInlineGuidance(agentRunId: string) {
  const text = inlineGuidance[agentRunId]?.trim();
  if (!text) return;
  const ok = await handleAction(agentRunId, () => injectGuidance(agentRunId, text));
  if (!ok) return;
  inlineGuidance[agentRunId] = "";
  message.success("指令已发送");
}

async function handleQuickGuidance() {
  if (!selectedAgentId.value || !quickGuidance.value.trim()) return;
  guidanceLoading.value = true;
  try {
    await injectGuidance(selectedAgentId.value, quickGuidance.value, guidanceMode.value);
    quickGuidance.value = "";
    message.success("指令已发送");
  } catch (error) {
    message.error(String(error));
  } finally {
    guidanceLoading.value = false;
  }
}

function applyQueryFilters() {
  pageQuery.search = typeof route.query.search === "string" ? route.query.search : undefined;
  pageQuery.status =
    typeof route.query.status === "string"
      ? (route.query.status as AgentOpsPageQuery["status"])
      : undefined;
  pageQuery.model =
    typeof route.query.model === "string"
      ? route.query.model
      : typeof route.query.provider === "string"
        ? route.query.provider
        : undefined;
  pageQuery.ownerScope =
    route.query.ownerScope === "all" || route.query.ownerScope === "mine"
      ? route.query.ownerScope
      : defaultOwnerScope();
  pageQuery.projectId =
    typeof route.query.projectId === "string" ? route.query.projectId : undefined;
  pageQuery.taskId = typeof route.query.taskId === "string" ? route.query.taskId : undefined;
  pageQuery.agentRunId =
    typeof route.query.agentRunId === "string" ? route.query.agentRunId : undefined;
  pageQuery.entryContext = toEntryContext(route.query.entryContext);
  pageQuery.riskLevel =
    typeof route.query.riskLevel === "string"
      ? (route.query.riskLevel as AgentOpsPageQuery["riskLevel"])
      : undefined;
  pageQuery.approvalBlocked = parseBooleanQueryValue(route.query.approvalBlocked);
  pageQuery.requiresIntervention = parseBooleanQueryValue(route.query.requiresIntervention);
  pageQuery.agentType =
    typeof route.query.agentType === "string" ? route.query.agentType : undefined;
  pageQuery.from = typeof route.query.from === "string" ? route.query.from : undefined;
  pageQuery.to = typeof route.query.to === "string" ? route.query.to : undefined;

  const nextFocus = typeof route.query.focus === "string" ? route.query.focus : defaultQueueFocus();
  if (
    nextFocus === "attention" ||
    nextFocus === "running" ||
    nextFocus === "recent" ||
    nextFocus === "all"
  ) {
    queueFocus.value = nextFocus;
  }

  if (pageQuery.agentRunId && selectedAgentId.value !== pageQuery.agentRunId) {
    selectedAgentId.value = pageQuery.agentRunId;
    detailDrawerVisible.value = true;
    drawerMode.value = defaultDrawerMode();
    void loadAgentRunSummary(pageQuery.agentRunId);
  }
}

function syncQueryFilters() {
  const query: Record<string, string> = {};
  if (pageQuery.search?.trim()) query.search = pageQuery.search.trim();
  if (pageQuery.status) query.status = pageQuery.status;
  if (pageQuery.model) query.model = pageQuery.model;
  if (pageQuery.ownerScope) query.ownerScope = pageQuery.ownerScope;
  if (pageQuery.projectId) query.projectId = pageQuery.projectId;
  if (pageQuery.taskId) query.taskId = pageQuery.taskId;
  if (pageQuery.agentRunId && detailDrawerVisible.value) query.agentRunId = pageQuery.agentRunId;
  if (pageQuery.entryContext && pageQuery.entryContext !== "nav")
    query.entryContext = pageQuery.entryContext;
  if (pageQuery.riskLevel) query.riskLevel = pageQuery.riskLevel;
  if (typeof pageQuery.approvalBlocked === "boolean")
    query.approvalBlocked = String(pageQuery.approvalBlocked);
  if (typeof pageQuery.requiresIntervention === "boolean") {
    query.requiresIntervention = String(pageQuery.requiresIntervention);
  }
  if (pageQuery.agentType?.trim()) query.agentType = pageQuery.agentType.trim();
  if (pageQuery.from) query.from = pageQuery.from;
  if (pageQuery.to) query.to = pageQuery.to;
  if (queueFocus.value !== "all") query.focus = queueFocus.value;

  const currentQuery = route.query;
  const currentKeys = Object.keys(currentQuery);
  const nextKeys = Object.keys(query);
  const isSameQuery =
    currentKeys.length === nextKeys.length &&
    nextKeys.every((key) => String(currentQuery[key] ?? "") === String(query[key] ?? ""));

  if (isSameQuery) return;

  void router.replace({ query });
}

onMounted(() => {
  applyQueryFilters();
  void Promise.all([refreshAgents(), refreshAggregates(), refreshAnalytics()]);
});

onUnmounted(() => {
  if (aggregateRefreshTimer.value != null) {
    window.clearTimeout(aggregateRefreshTimer.value);
  }
});

watch(
  () => route.query,
  () => {
    applyQueryFilters();
  },
  { immediate: true },
);

watch(
  () => [
    pageQuery.search,
    pageQuery.status,
    pageQuery.ownerScope,
    pageQuery.projectId,
    pageQuery.riskLevel,
    pageQuery.approvalBlocked,
    pageQuery.requiresIntervention,
    pageQuery.agentType,
    pageQuery.model,
    pageQuery.from,
    pageQuery.to,
    queueFocus.value,
  ],
  () => {
    void refreshAggregates();
    void refreshAnalytics();
    syncQueryFilters();
  },
);

watch(
  () => [detailDrawerVisible.value, pageQuery.agentRunId],
  () => {
    syncQueryFilters();
  },
);

watch(
  () => authStore.user?.role,
  () => {
    if (!route.query.ownerScope) {
      pageQuery.ownerScope = defaultOwnerScope();
    }
    if (!route.query.focus) {
      queueFocus.value = defaultQueueFocus();
    }
    if (!isAdminRole.value) {
      agentAnalytics.value = null;
    } else {
      void refreshAnalytics();
    }
  },
  { immediate: true },
);

watch(
  () => agentEvents.value[0]?.id,
  () => {
    const latestEvent = agentEvents.value[0];
    if (!latestEvent) return;
    scheduleRealtimeRefresh(latestEvent);
  },
);
</script>

<style scoped>
.agent-ops-page {
  padding: 24px;
}
</style>
