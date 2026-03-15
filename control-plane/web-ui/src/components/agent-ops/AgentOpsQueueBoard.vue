<template>
  <div>
    <a-row :gutter="[12, 12]" style="margin-bottom: 16px">
      <a-col v-for="card in summaryCards" :key="card.key" :xs="24" :sm="12" :xl="4">
        <a-card
          size="small"
          :class="['summary-card', { 'summary-card-active': queueFocus === card.focusKey }]"
          @click="$emit('queueFocusChange', card.focusKey)"
        >
          <div class="summary-card-label">{{ card.label }}</div>
          <div class="summary-card-value" :style="{ color: card.color }">{{ card.value }}</div>
          <div class="summary-card-hint">{{ card.hint }}</div>
        </a-card>
      </a-col>
    </a-row>

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
                @click="$emit('openAgentDrawer', item.agentRunId)"
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
                @click="$emit('openAgentDrawer', item.agentRunId)"
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
                @click="$emit('openAgentDrawer', item.agentRunId)"
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

      <a-row v-if="viewMode === 'user'" :gutter="[16, 16]" style="margin-top: 16px">
        <a-col :xs="24">
          <a-card size="small">
            <template #title>我的工作提示</template>
            <a-flex vertical :gap="10">
              <a-typography-paragraph type="secondary" style="margin: 0">
                普通用户视图已切到以处置为中心的页面骨架：优先关注我的待处理实例、当前推进情况和最近结果。
              </a-typography-paragraph>
              <a-space wrap>
                <a-tag>{{ scopeTagLabel }}</a-tag>
                <a-tag v-if="activeProjectLabel">{{ activeProjectLabel }}</a-tag>
                <a-tag v-if="pageQuery.riskLevel">风险 {{ pageQuery.riskLevel }}</a-tag>
                <a-tag v-if="pageQuery.approvalBlocked === true">审批阻塞</a-tag>
                <a-tag v-if="pageQuery.requiresIntervention === true">需要人工介入</a-tag>
              </a-space>
            </a-flex>
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
          <a-card v-if="canInjectGuidanceGlobally" size="small">
            <template #title>快速注入指令</template>
            <div class="queue-subtitle">对运行中或暂停中的 Agent 直接下发补充指令。</div>
            <a-flex vertical :gap="10">
              <a-select
                :value="selectedAgentId"
                placeholder="选择 Agent"
                :options="agentSelectOptions"
                allow-clear
                @update:value="$emit('selectedAgentChange', $event)"
              />
              <a-input
                :value="quickGuidance"
                placeholder="输入指令内容..."
                @press-enter="$emit('quickGuidanceSend')"
                @update:value="$emit('quickGuidanceChange', String($event ?? ''))"
              />
              <a-radio-group :value="guidanceMode" size="small" @update:value="$emit('guidanceModeChange', $event)">
                <a-radio-button value="reply">等待回复</a-radio-button>
                <a-radio-button value="noReply">仅注入</a-radio-button>
              </a-radio-group>
              <a-button
                type="primary"
                :disabled="!selectedAgentId || !quickGuidance.trim()"
                :loading="guidanceLoading"
                @click="$emit('quickGuidanceSend')"
              >
                发送指令
              </a-button>
            </a-flex>
          </a-card>
          <a-card v-else size="small">
            <template #title>只读模式</template>
            <a-alert
              type="info"
              show-icon
              message="当前账号没有人工介入权限"
              description="你可以查看运行摘要、结果和关键事件；暂停、恢复、终止与注入指令仅对具备干预权限的角色开放。"
            />
          </a-card>
        </a-col>
      </a-row>
    </template>
  </div>
</template>

<script setup lang="ts">
import { RobotOutlined } from "@ant-design/icons-vue";
import type { AgentOpsPageQuery, AgentOpsQueue, AgentOpsViewMode } from "../../lib/api";
import type { RealtimeEvent } from "../../stores/realtime";

interface QueueViewItem {
  agentRunId: string;
  taskId: string;
  taskTitle?: string;
  projectId?: string;
  projectName?: string | null;
  agentType: string;
  status: string;
  blockerLabel: string;
  summary: string;
  updatedAt: number;
  finishedAtMs: number | null;
  tokenUsed: number;
}

const props = defineProps<{
  summaryCards: Array<{ key: string; focusKey: "all" | AgentOpsQueue; label: string; value: string | number; hint: string; color: string }>;
  queueFocus: "all" | AgentOpsQueue;
  queueDataLoading: boolean;
  displayedTotalKnownRuns: number;
  attentionQueue: QueueViewItem[];
  runningQueue: QueueViewItem[];
  recentQueue: QueueViewItem[];
  selectedAgentId?: string;
  viewMode: AgentOpsViewMode;
  scopeTagLabel: string;
  activeProjectLabel: string | null;
  pageQuery: AgentOpsPageQuery;
  keyEvents: RealtimeEvent[];
  canInjectGuidanceGlobally: boolean;
  agentSelectOptions: Array<{ value: string; label: string }>;
  quickGuidance: string;
  guidanceMode: "reply" | "noReply";
  guidanceLoading: boolean;
  statusColor: (status: string) => string;
  statusLabel: (status: string) => string;
  eventColor: (type: string) => string;
  summarizeEvent: (event: RealtimeEvent) => string;
  formatRelativeTime: (timestamp: number) => string;
  formatTokenRaw: (tokenUsed?: number | null) => string;
  formatTokenCount: (tokenUsed?: number | null) => string;
  shortId: (value?: string) => string;
}>();

defineEmits<{
  (e: "queueFocusChange", value: "all" | AgentOpsQueue): void;
  (e: "openAgentDrawer", agentRunId: string): void;
  (e: "selectedAgentChange", value: unknown): void;
  (e: "quickGuidanceChange", value: string): void;
  (e: "guidanceModeChange", value: unknown): void;
  (e: "quickGuidanceSend"): void;
}>();

function shouldShowQueue(queue: AgentOpsQueue) {
  return props.queueFocus === "all" || props.queueFocus === queue;
}

</script>

<style scoped>
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
.event-feed {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.queue-item,
.event-feed-item {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.queue-item:hover,
.queue-item-selected,
.event-feed-item:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
}

.queue-item-title {
  font-weight: 600;
}

.queue-item-summary,
.event-feed-summary {
  margin-top: 8px;
  color: #334155;
  font-size: 13px;
  line-height: 1.6;
}
</style>