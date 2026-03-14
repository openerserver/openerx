<template>
  <div class="agent-ops-page">
    <a-flex justify="space-between" align="start" wrap="wrap" :gap="12" class="page-header">
      <div>
        <a-typography-title :level="3" style="margin: 0">Agent 运营中心</a-typography-title>
        <a-typography-paragraph type="secondary" style="margin: 6px 0 0 0">
          统一查看 Agent 的执行健康度、阻塞情况与人工介入入口。
        </a-typography-paragraph>
      </div>
      <a-space wrap>
        <a-tooltip :title="connectionTooltip">
          <a-badge :status="realtimeStore.connected ? 'success' : 'error'" :text="connectionLabel" />
        </a-tooltip>
        <a-button v-if="!realtimeStore.connected" size="small" type="link" @click="handleReconnect">
          重连
        </a-button>
        <a-button @click="handleRefreshAll" :loading="loading || queueDataLoading">刷新</a-button>
      </a-space>
    </a-flex>

    <a-row :gutter="[12, 12]" style="margin-bottom: 16px">
      <a-col v-for="card in summaryCards" :key="card.key" :xs="24" :sm="12" :xl="4">
        <a-card
          size="small"
          :class="['summary-card', { 'summary-card-active': queueFocus === card.focusKey }]"
          @click="queueFocus = card.focusKey"
        >
          <div class="summary-card-label">{{ card.label }}</div>
          <div class="summary-card-value" :style="{ color: card.color }">{{ card.value }}</div>
          <div class="summary-card-hint">{{ card.hint }}</div>
        </a-card>
      </a-col>
    </a-row>

    <a-card size="small" style="margin-bottom: 16px">
      <a-flex wrap="wrap" :gap="12" align="center">
        <a-input
          :value="searchText"
          allow-clear
          placeholder="搜索 Agent ID / 类型 / 任务..."
          style="width: 280px"
          @update:value="searchText = String($event ?? '')"
        >
          <template #prefix>
            <SearchOutlined style="color: #94a3b8" />
          </template>
        </a-input>
        <a-select
          :value="providerFilter"
          style="width: 180px"
          @update:value="providerFilter = String($event ?? '')"
        >
          <a-select-option value="">全部 Provider</a-select-option>
          <a-select-option v-for="provider in providerOptions" :key="provider" :value="provider">
            {{ provider }}
          </a-select-option>
        </a-select>
        <a-select
          :value="statusFilter"
          style="width: 180px"
          @update:value="statusFilter = String($event ?? '')"
        >
          <a-select-option value="">全部状态</a-select-option>
          <a-select-option value="running">运行中</a-select-option>
          <a-select-option value="paused">已暂停</a-select-option>
          <a-select-option value="failed">失败</a-select-option>
          <a-select-option value="completed">已完成</a-select-option>
          <a-select-option value="stopped">已停止</a-select-option>
          <a-select-option value="terminated">已终止</a-select-option>
        </a-select>
        <a-radio-group :value="queueFocus" size="small" @update:value="handleQueueFocusChange">
          <a-radio-button value="all">全部</a-radio-button>
          <a-radio-button value="attention">待处理</a-radio-button>
          <a-radio-button value="running">推进中</a-radio-button>
          <a-radio-button value="recent">最近结果</a-radio-button>
        </a-radio-group>
        <a-typography-text type="secondary">
          共 {{ visibleRunCount }} 个实例，待处理 {{ attentionQueue.length }} 个。
        </a-typography-text>
      </a-flex>
    </a-card>

    <a-result
      v-if="!queueDataLoading && displayedTotalKnownRuns === 0"
      status="info"
      title="暂无 Agent 运行实例"
      sub-title="当任务触发 Agent 执行后，这里会显示待处理、推进中和最近结果三个工作队列。"
    >
      <template #extra>
        <a-space>
          <router-link to="/tasks">
            <a-button type="primary">去任务页创建任务</a-button>
          </router-link>
          <router-link to="/workbench">
            <a-button>查看任务工作台</a-button>
          </router-link>
        </a-space>
      </template>
    </a-result>

    <template v-else>
      <a-row :gutter="[16, 16]">
        <a-col :xs="24" :xl="8" v-show="shouldShowQueue('attention')">
          <a-card size="small" :body-style="{ padding: '12px' }">
            <template #title>
              <a-flex justify="space-between" align="center">
                <span>需要处理</span>
                <a-badge :count="attentionQueue.length" :show-zero="true" />
              </a-flex>
            </template>
            <div class="queue-subtitle">失败、暂停、已停止和长时间无进展的实例。</div>
            <a-empty v-if="attentionQueue.length === 0" description="当前没有需要处理的 Agent" />
            <div v-else class="queue-list">
              <div
                v-for="item in attentionQueue"
                :key="item.agentRunId"
                :class="['queue-item', { 'queue-item-selected': selectedAgentId === item.agentRunId }]"
                @click="openAgentDrawer(item.agentRunId)"
              >
                <a-flex justify="space-between" align="start" :gap="8">
                  <div>
                    <a-flex align="center" :gap="6" wrap="wrap">
                      <RobotOutlined style="color: #64748b" />
                      <span class="queue-item-title">{{ item.agentType }}</span>
                      <a-tag :color="statusColor(item.status)">{{ statusLabel(item.status) }}</a-tag>
                    </a-flex>
                    <div class="queue-item-meta">
                      {{ shortId(item.agentRunId) }}
                      <span v-if="item.taskId"> · 任务 {{ shortId(item.taskId) }}</span>
                      <span v-if="item.updatedAt"> · {{ formatRelativeTime(item.updatedAt) }}</span>
                    </div>
                  </div>
                  <a-tag color="red">{{ item.blockerLabel }}</a-tag>
                </a-flex>
                <div class="queue-item-summary">{{ item.summary }}</div>
              </div>
            </div>
          </a-card>
        </a-col>

        <a-col :xs="24" :xl="8" v-show="shouldShowQueue('running')">
          <a-card size="small" :body-style="{ padding: '12px' }">
            <template #title>
              <a-flex justify="space-between" align="center">
                <span>正在推进</span>
                <a-badge :count="runningQueue.length" :show-zero="true" />
              </a-flex>
            </template>
            <div class="queue-subtitle">正在执行且最近仍有活动的 Agent。</div>
            <a-empty v-if="runningQueue.length === 0" description="当前没有推进中的 Agent" />
            <div v-else class="queue-list">
              <div
                v-for="item in runningQueue"
                :key="item.agentRunId"
                :class="['queue-item', { 'queue-item-selected': selectedAgentId === item.agentRunId }]"
                @click="openAgentDrawer(item.agentRunId)"
              >
                <a-flex justify="space-between" align="start" :gap="8">
                  <div>
                    <a-flex align="center" :gap="6" wrap="wrap">
                      <RobotOutlined style="color: #64748b" />
                      <span class="queue-item-title">{{ item.agentType }}</span>
                      <a-tag :color="statusColor(item.status)">{{ statusLabel(item.status) }}</a-tag>
                    </a-flex>
                    <div class="queue-item-meta">
                      {{ shortId(item.agentRunId) }}
                      <span v-if="item.taskId"> · 任务 {{ shortId(item.taskId) }}</span>
                      <span v-if="item.updatedAt"> · {{ formatRelativeTime(item.updatedAt) }}</span>
                    </div>
                  </div>
                  <a-tag color="blue">活跃</a-tag>
                </a-flex>
                <div class="queue-item-summary">{{ item.summary }}</div>
              </div>
            </div>
          </a-card>
        </a-col>

        <a-col :xs="24" :xl="8" v-show="shouldShowQueue('recent')">
          <a-card size="small" :body-style="{ padding: '12px' }">
            <template #title>
              <a-flex justify="space-between" align="center">
                <span>最近结果</span>
                <a-badge :count="recentQueue.length" :show-zero="true" />
              </a-flex>
            </template>
            <div class="queue-subtitle">最近 24 小时结束的执行结果，便于快速复盘。</div>
            <a-empty v-if="recentQueue.length === 0" description="当前没有可展示的近期结果" />
            <div v-else class="queue-list">
              <div
                v-for="item in recentQueue"
                :key="item.agentRunId"
                :class="['queue-item', { 'queue-item-selected': selectedAgentId === item.agentRunId }]"
                @click="openAgentDrawer(item.agentRunId)"
              >
                <a-flex justify="space-between" align="start" :gap="8">
                  <div>
                    <a-flex align="center" :gap="6" wrap="wrap">
                      <RobotOutlined style="color: #64748b" />
                      <span class="queue-item-title">{{ item.agentType }}</span>
                      <a-tag :color="statusColor(item.status)">{{ statusLabel(item.status) }}</a-tag>
                    </a-flex>
                    <div class="queue-item-meta">
                      {{ shortId(item.agentRunId) }}
                      <span v-if="item.taskId"> · 任务 {{ shortId(item.taskId) }}</span>
                      <span v-if="item.finishedAtMs"> · {{ formatRelativeTime(item.finishedAtMs) }}</span>
                      <a-tooltip v-if="item.tokenUsed > 0" :title="formatTokenRaw(item.tokenUsed)">
                        <span> · Tokens {{ formatTokenCount(item.tokenUsed) }}</span>
                      </a-tooltip>
                    </div>
                  </div>
                  <a-tag :color="item.status === 'completed' ? 'green' : 'red'">
                    {{ item.status === 'completed' ? '结果' : '复盘' }}
                  </a-tag>
                </a-flex>
                <div class="queue-item-summary">{{ item.summary }}</div>
              </div>
            </div>
          </a-card>
        </a-col>
      </a-row>

      <a-row :gutter="[16, 16]" style="margin-top: 16px">
        <a-col :xs="24" :xl="14">
          <a-card size="small">
            <template #title>
              <a-flex justify="space-between" align="center">
                <span>关键事件流</span>
                <a-badge :count="keyEvents.length" :show-zero="true" />
              </a-flex>
            </template>
            <div class="queue-subtitle">保留实时感知，但只展示与处置最相关的最近事件。</div>
            <a-empty v-if="keyEvents.length === 0" description="等待事件..." />
            <div v-else class="event-feed">
              <div v-for="evt in keyEvents" :key="evt.id" class="event-feed-item">
                <a-flex justify="space-between" align="start" :gap="8">
                  <div>
                    <a-flex align="center" :gap="6" wrap="wrap">
                      <a-tag :color="eventColor(evt.type)">{{ evt.type }}</a-tag>
                      <span class="event-feed-meta">{{ evt.agentRunId ? shortId(evt.agentRunId) : '系统' }}</span>
                    </a-flex>
                    <div class="event-feed-summary">{{ summarizeEvent(evt) }}</div>
                  </div>
                  <span class="event-feed-meta">{{ formatRelativeTime(Date.parse(evt.ts)) }}</span>
                </a-flex>
              </div>
            </div>
          </a-card>
        </a-col>

        <a-col :xs="24" :xl="10">
          <a-card size="small">
            <template #title>快速注入指令</template>
            <div class="queue-subtitle">对运行中或暂停中的 Agent 直接下发补充指令。</div>
            <a-flex vertical :gap="10">
              <a-select
                :value="selectedAgentId"
                placeholder="选择 Agent"
                :options="agentSelectOptions"
                allow-clear
                @update:value="setSelectedAgentId"
              />
              <a-input
                :value="quickGuidance"
                placeholder="输入指令内容..."
                @press-enter="handleQuickGuidance"
                @update:value="quickGuidance = String($event ?? '')"
              />
              <a-radio-group :value="guidanceMode" size="small" @update:value="guidanceMode = $event">
                <a-radio-button value="reply">等待回复</a-radio-button>
                <a-radio-button value="noReply">仅注入</a-radio-button>
              </a-radio-group>
              <a-button
                type="primary"
                :disabled="!selectedAgentId || !quickGuidance.trim()"
                :loading="guidanceLoading"
                @click="handleQuickGuidance"
              >
                发送指令
              </a-button>
            </a-flex>
          </a-card>
        </a-col>
      </a-row>
    </template>

    <a-drawer
      :open="detailDrawerVisible"
      :width="560"
      placement="right"
      @close="detailDrawerVisible = false"
    >
      <template #title>
        <a-flex align="center" :gap="8" wrap="wrap">
          <RobotOutlined />
          <span>{{ selectedRunSummaryView?.agentType || 'Agent' }}</span>
          <a-tag v-if="selectedRunSummaryView" :color="statusColor(selectedRunSummaryView.status)">
            {{ statusLabel(selectedRunSummaryView.status) }}
          </a-tag>
        </a-flex>
      </template>

      <template v-if="selectedRunSummaryView">
        <a-flex vertical :gap="16">
          <a-card size="small" title="运行摘要" :loading="summaryLoading">
            <a-descriptions :column="1" size="small">
              <a-descriptions-item label="Agent Run ID">
                <a-typography-text code copyable>{{ selectedRunSummaryView.agentRunId }}</a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item label="任务">
                <router-link v-if="selectedRunSummaryView.taskId" :to="`/workbench?task=${selectedRunSummaryView.taskId}`">
                  {{ selectedRunSummaryView.taskTitle || selectedRunSummaryView.taskId }}
                </router-link>
                <span v-else>-</span>
              </a-descriptions-item>
              <a-descriptions-item label="会话 ID">
                <a-typography-text v-if="selectedRunSummaryView.subSessionId || selectedRunSummaryView.sessionId" code>
                  {{ selectedRunSummaryView.subSessionId || selectedRunSummaryView.sessionId }}
                </a-typography-text>
                <span v-else>-</span>
              </a-descriptions-item>
              <a-descriptions-item label="最近活动">
                {{ selectedRunSummaryView.lastActivityAt ? formatRelativeTime(parseDate(selectedRunSummaryView.lastActivityAt) ?? Date.now()) : '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="运行时长">
                {{ selectedRunSummaryView.durationMs != null ? formatDurationFromMs(selectedRunSummaryView.durationMs) : '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="Token 使用量">
                <a-tooltip v-if="selectedRunSummaryView.tokenUsed > 0" :title="formatTokenRaw(selectedRunSummaryView.tokenUsed)">
                  <span>{{ formatTokenCount(selectedRunSummaryView.tokenUsed) }}</span>
                </a-tooltip>
                <span v-else>-</span>
              </a-descriptions-item>
              <a-descriptions-item label="人工介入">
                {{ selectedRunSummaryView.guidanceCount > 0 ? `已介入 ${selectedRunSummaryView.guidanceCount} 次` : '暂无' }}
              </a-descriptions-item>
              <a-descriptions-item label="当前判断">
                <a-tag :color="selectedRunSummaryView.blockerType ? 'red' : 'blue'">
                  {{ summaryJudgementLabel(selectedRunSummaryView) }}
                </a-tag>
                <span style="margin-left: 8px">{{ selectedRunSummaryView.blockerLabel }}</span>
              </a-descriptions-item>
            </a-descriptions>
          </a-card>

          <a-card size="small" title="结果与风险" :loading="summaryLoading">
            <a-alert
              :type="selectedRunSummaryView.blockerType ? 'warning' : 'info'"
              show-icon
              :message="selectedRunSummaryView.blockerLabel"
              :description="selectedRunSummaryView.resultSummary || '暂无结构化摘要。'"
            />
            <a-typography-paragraph style="margin: 12px 0 0 0">
              {{ selectedRunSummaryView.longSummary || selectedRunSummaryView.resultSummary || '暂无结构化摘要。' }}
            </a-typography-paragraph>
          </a-card>

          <a-card size="small" title="处置动作">
            <a-space wrap style="margin-bottom: 12px">
              <a-button
                v-if="selectedRunSummaryView.status === 'running'"
                :loading="actionLoading === selectedRunSummaryView.agentRunId"
                @click="handlePause(selectedRunSummaryView.agentRunId)"
              >
                <template #icon><PauseCircleOutlined /></template>
                暂停
              </a-button>
              <a-button
                v-if="selectedRunSummaryView.status === 'paused'"
                type="primary"
                :loading="actionLoading === selectedRunSummaryView.agentRunId"
                @click="handleResume(selectedRunSummaryView.agentRunId)"
              >
                <template #icon><PlayCircleOutlined /></template>
                恢复
              </a-button>
              <a-popconfirm
                v-if="selectedRunSummaryView.status === 'running' || selectedRunSummaryView.status === 'paused'"
                title="确定终止此 Agent？"
                @confirm="handleTerminate(selectedRunSummaryView.agentRunId)"
              >
                <a-button danger :loading="actionLoading === selectedRunSummaryView.agentRunId">
                  <template #icon><StopOutlined /></template>
                  终止
                </a-button>
              </a-popconfirm>
              <router-link v-if="selectedRunSummaryView.taskId" :to="`/workbench?task=${selectedRunSummaryView.taskId}`">
                <a-button>进入任务工作台</a-button>
              </router-link>
              <a-button @click="copyDiagnostics">复制诊断信息</a-button>
            </a-space>
            <a-input-search
              :value="inlineGuidance[selectedRunSummaryView.agentRunId]"
              placeholder="输入补充指令..."
              enter-button="发送"
              :loading="actionLoading === selectedRunSummaryView.agentRunId"
              @search="handleInlineGuidance(selectedRunSummaryView.agentRunId)"
              @update:value="inlineGuidance[selectedRunSummaryView.agentRunId] = String($event ?? '')"
            />
          </a-card>

          <a-card size="small" title="最近关键事件" :loading="summaryLoading">
            <a-empty v-if="(selectedRunSummaryView.latestEvents?.length || 0) === 0" description="暂无事件" />
            <div v-else class="drawer-events">
              <div
                v-for="evt in selectedRunSummaryView.latestEvents"
                :key="`${evt.type}-${evt.ts}`"
                class="drawer-event-item"
              >
                <a-flex justify="space-between" align="start" :gap="8">
                  <div>
                    <a-tag :color="eventColor(evt.type)">{{ evt.type }}</a-tag>
                    <div class="event-feed-summary">{{ evt.summary }}</div>
                  </div>
                  <span class="event-feed-meta">{{ formatRelativeTime(parseDate(evt.ts) ?? Date.now()) }}</span>
                </a-flex>
              </div>
            </div>
          </a-card>
        </a-flex>
      </template>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { PauseCircleOutlined, PlayCircleOutlined, RobotOutlined, SearchOutlined, StopOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  getAgentOpsOverview,
  getAgentOpsQueue,
  getAgentRunOpsSummary,
  injectGuidance,
  listAgentRuns,
  pauseAgent,
  resumeAgent,
  terminateAgent,
  type AgentOpsOverview,
  type AgentOpsQueueItem,
  type AgentRunOpsSummary,
  type AgentRunSummary,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { type RealtimeEvent, useRealtimeStore } from "../stores/realtime";

type AgentRunStatus = "running" | "paused" | "completed" | "failed" | "stopped" | "terminated";
type QueueFocus = "all" | "attention" | "running" | "recent";
type BlockerType = "failed" | "paused" | "stalled" | "stopped" | "healthy";

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

const realtimeStore = useRealtimeStore();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const actionLoading = ref<string | null>(null);
const guidanceLoading = ref(false);
const detailDrawerVisible = ref(false);
const queueDataLoading = ref(false);
const summaryLoading = ref(false);

const registeredRuns = ref<AgentRun[]>([]);
const selectedAgentId = ref<string | undefined>(undefined);
const quickGuidance = ref("");
const guidanceMode = ref<"reply" | "noReply">("reply");
const inlineGuidance = reactive<Record<string, string>>({});

const searchText = ref("");
const providerFilter = ref("");
const statusFilter = ref("");
const queueFocus = ref<QueueFocus>("all");
const agentOverview = ref<AgentOpsOverview | null>(null);
const remoteQueuesLoaded = ref(false);
const remoteAttentionQueue = ref<AgentOpsQueueItem[]>([]);
const remoteRunningQueue = ref<AgentOpsQueueItem[]>([]);
const remoteRecentQueue = ref<AgentOpsQueueItem[]>([]);
const remoteAttentionTotal = ref(0);
const remoteRunningTotal = ref(0);
const remoteRecentTotal = ref(0);
const selectedRunSummary = ref<AgentRunOpsSummary | null>(null);
const aggregateRefreshTimer = ref<number | null>(null);
const isProviderScoped = computed(() => providerFilter.value.trim().length > 0);

function setSelectedAgentId(value: unknown) {
  selectedAgentId.value = value == null ? undefined : String(value);
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
  if (type.includes("started") || type.includes("running") || type.includes("resumed")) return "blue";
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
    const normalizedValue = value.replace(" ", "T") + "Z";
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

function matchesProvider(item: QueueViewItem) {
  if (!providerFilter.value) return true;
  return parseProviderId(item.modelUsed) === providerFilter.value;
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
  return '未连接 · 点击“重连”恢复实时订阅';
});

const agentEvents = computed(() =>
  realtimeStore.events.filter((e) => e.type.startsWith("agent.") || e.type === "guidance.injected"),
);

const attentionQueue = computed(() => {
  return remoteAttentionQueue.value.map(normalizeRemoteQueueItem).filter(matchesProvider);
});

const runningQueue = computed(() => {
  return remoteRunningQueue.value.map(normalizeRemoteQueueItem).filter(matchesProvider);
});

const recentQueue = computed(() => {
  return remoteRecentQueue.value.map(normalizeRemoteQueueItem).filter(matchesProvider);
});

const providerOptions = computed(() =>
  Array.from(
    new Set(
      [...remoteAttentionQueue.value, ...remoteRunningQueue.value, ...remoteRecentQueue.value]
        .map((item) => parseProviderId(item.modelUsed))
        .filter(Boolean),
    ),
  ).sort(),
);

const allQueueItems = computed(() => [...attentionQueue.value, ...runningQueue.value, ...recentQueue.value]);

const selectedQueueItem = computed(() =>
  selectedAgentId.value
    ? allQueueItems.value.find((item) => item.agentRunId === selectedAgentId.value)
    : undefined,
);

const selectedRunSummaryView = computed(() => {
  if (selectedRunSummary.value) return selectedRunSummary.value;
  if (!selectedQueueItem.value) return null;
  return {
    agentRunId: selectedQueueItem.value.agentRunId,
    taskId: selectedQueueItem.value.taskId,
    taskTitle: selectedQueueItem.value.taskTitle || selectedQueueItem.value.taskId,
    projectId: selectedQueueItem.value.projectId || "",
    projectName: selectedQueueItem.value.projectName || null,
    agentType: selectedQueueItem.value.agentType,
    status: selectedQueueItem.value.status,
    sessionId: null,
    modelUsed: null,
    startedAt: selectedQueueItem.value.startedAt ? new Date(selectedQueueItem.value.startedAt).toISOString() : null,
    finishedAt: selectedQueueItem.value.finishedAtMs ? new Date(selectedQueueItem.value.finishedAtMs).toISOString() : null,
    lastActivityAt: new Date(selectedQueueItem.value.updatedAt).toISOString(),
    durationMs: selectedQueueItem.value.startedAt ? Math.max(0, Date.now() - selectedQueueItem.value.startedAt) : null,
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
  } satisfies AgentRunOpsSummary;
});

const filteredRunCount = computed(() => remoteAttentionTotal.value + remoteRunningTotal.value + remoteRecentTotal.value);
const providerFilteredRunCount = computed(
  () => attentionQueue.value.length + runningQueue.value.length + recentQueue.value.length,
);
const visibleRunCount = computed(() => (isProviderScoped.value ? providerFilteredRunCount.value : filteredRunCount.value));

const totalKnownRuns = computed(
  () =>
    (agentOverview.value?.queueCounts.attention ?? 0) +
    (agentOverview.value?.queueCounts.running ?? 0) +
    (agentOverview.value?.queueCounts.recent ?? 0),
);
const displayedTotalKnownRuns = computed(() => (isProviderScoped.value ? visibleRunCount.value : totalKnownRuns.value));

const completedIn24h = computed(() =>
  isProviderScoped.value
    ? recentQueue.value.filter((run) => run.status === "completed").length
    : agentOverview.value?.summary.completedCount ?? recentQueue.value.filter((run) => run.status === "completed").length,
);

const failureRate = computed(() => {
  if (agentOverview.value && !isProviderScoped.value) return `${Math.round(agentOverview.value.summary.failureRate)}%`;
  const endedRuns = recentQueue.value.filter((run) => ["completed", "failed", "stopped", "terminated"].includes(run.status));
  if (endedRuns.length === 0) return "0%";
  const failedRuns = endedRuns.filter((run) => ["failed", "stopped", "terminated"].includes(run.status)).length;
  return `${Math.round((failedRuns / endedRuns.length) * 100)}%`;
});

const averageDuration = computed(() => {
  if (agentOverview.value?.summary.avgDurationMs != null && !isProviderScoped.value) {
    return formatDurationFromMs(agentOverview.value.summary.avgDurationMs);
  }
  const endedRuns = recentQueue.value.filter((run) => run.startedAt && run.finishedAtMs);
  if (endedRuns.length === 0) return "-";
  const total = endedRuns.reduce((sum, run) => sum + ((run.finishedAtMs || 0) - (run.startedAt || 0)), 0);
  return formatDuration(Date.now() - total / endedRuns.length, Date.now());
});

const interventionRate = computed(() => {
  if (agentOverview.value && !isProviderScoped.value) return `${Math.round(agentOverview.value.summary.humanInterventionRate)}%`;
  if (allQueueItems.value.length === 0) return "0%";
  const withGuidance = allQueueItems.value.filter((run) => run.guidanceCount > 0).length;
  return `${Math.round((withGuidance / allQueueItems.value.length) * 100)}%`;
});

const summaryCards = computed(() => [
  {
    key: "attention",
    focusKey: "attention" as QueueFocus,
    label: "待处理事项",
    value: isProviderScoped.value ? attentionQueue.value.length : agentOverview.value?.summary.attentionCount ?? attentionQueue.value.length,
    hint: "失败、暂停和无进展实例",
    color: "#dc2626",
  },
  {
    key: "running",
    focusKey: "running" as QueueFocus,
    label: "运行中",
    value: isProviderScoped.value ? runningQueue.value.length : agentOverview.value?.summary.runningCount ?? runningQueue.value.length,
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
  agentEvents.value.filter((event) => {
    if (event.type === "guidance.injected") return true;
    return ["agent.failed", "agent.paused", "agent.resumed", "agent.completed", "agent.stopped", "agent.started"].includes(event.type);
  }).slice(0, 12),
);

const agentSelectOptions = computed(() =>
  registeredRuns.value
    .filter((run) => run.status === "running" || run.status === "paused")
    .map((run) => ({
      value: run.agentRunId,
      label: `${run.agentType} (${shortId(run.agentRunId)}) · ${statusLabel(run.status)}`,
    })),
);

function shouldShowQueue(queue: Exclude<QueueFocus, "all">) {
  return queueFocus.value === "all" || queueFocus.value === queue;
}

function openAgentDrawer(agentRunId: string) {
  selectedAgentId.value = agentRunId;
  detailDrawerVisible.value = true;
  void loadAgentRunSummary(agentRunId);
}

function handleReconnect() {
  const authStore = useAuthStore();
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
  await Promise.all([refreshAgents(), refreshAggregates()]);
}

async function refreshAggregates() {
  queueDataLoading.value = true;
  try {
    const queueQuery = {
      status: statusFilter.value || undefined,
      search: searchText.value.trim() || undefined,
    };
    const [overview, attention, running, recent] = await Promise.all([
      getAgentOpsOverview(),
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
    selectedRunSummary.value = await getAgentRunOpsSummary(agentRunId);
  } catch {
    selectedRunSummary.value = null;
  } finally {
    summaryLoading.value = false;
  }
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
  const nextSearch = typeof route.query.search === "string" ? route.query.search : "";
  const nextStatus = typeof route.query.status === "string" ? route.query.status : "";
  const nextProvider = typeof route.query.provider === "string" ? route.query.provider : "";
  const nextFocus = typeof route.query.focus === "string" ? route.query.focus : "all";

  if (searchText.value !== nextSearch) searchText.value = nextSearch;
  if (statusFilter.value !== nextStatus) statusFilter.value = nextStatus;
  if (providerFilter.value !== nextProvider) providerFilter.value = nextProvider;
  if (nextFocus === "attention" || nextFocus === "running" || nextFocus === "recent" || nextFocus === "all") {
    if (queueFocus.value !== nextFocus) queueFocus.value = nextFocus;
  }
}

function syncQueryFilters() {
  const query: Record<string, string> = {};
  if (searchText.value.trim()) query.search = searchText.value.trim();
  if (statusFilter.value) query.status = statusFilter.value;
  if (providerFilter.value) query.provider = providerFilter.value;
  if (queueFocus.value !== "all") query.focus = queueFocus.value;

  const current = route.query;
  const currentNormalized = {
    search: typeof current.search === "string" ? current.search : "",
    status: typeof current.status === "string" ? current.status : "",
    provider: typeof current.provider === "string" ? current.provider : "",
    focus: typeof current.focus === "string" ? current.focus : "",
  };

  if (
    currentNormalized.search === (query.search ?? "")
    && currentNormalized.status === (query.status ?? "")
    && currentNormalized.provider === (query.provider ?? "")
    && currentNormalized.focus === (query.focus ?? "")
  ) {
    return;
  }

  void router.replace({ query });
}

onMounted(() => {
  applyQueryFilters();
  void Promise.all([refreshAgents(), refreshAggregates()]);
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

watch([searchText, statusFilter], () => {
  void refreshAggregates();
});

watch([searchText, statusFilter, providerFilter, queueFocus], () => {
  syncQueryFilters();
});

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

.page-header {
  margin-bottom: 16px;
}

.summary-card {
  cursor: pointer;
  border: 1px solid #e2e8f0;
  transition: all 0.15s ease;
}

.summary-card:hover,
.summary-card-active {
  border-color: #3b82f6;
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.12);
}

.summary-card-label {
  color: #64748b;
  font-size: 12px;
}

.summary-card-value {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.2;
  margin-top: 4px;
}

.summary-card-hint,
.queue-subtitle,
.queue-item-meta,
.event-feed-meta {
  color: #94a3b8;
  font-size: 12px;
}

.queue-subtitle {
  margin-bottom: 12px;
}

.queue-list,
.drawer-events,
.event-feed {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.queue-item,
.drawer-event-item,
.event-feed-item {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
  background: #fff;
}

.queue-item {
  cursor: pointer;
  transition: all 0.15s ease;
}

.queue-item:hover,
.queue-item-selected {
  border-color: #3b82f6;
  background: #f8fbff;
}

.queue-item-title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.queue-item-summary,
.event-feed-summary {
  margin-top: 8px;
  color: #334155;
  font-size: 13px;
  line-height: 1.5;
}

.event-payload {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-size: 12px;
  color: #334155;
}
</style>
