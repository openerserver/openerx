<template>
  <a-drawer :open="open" :width="560" placement="right" :mask="false" @close="$emit('close')">
    <template #title>
      <a-flex align="center" :gap="8" wrap="wrap">
        <RobotOutlined />
        <span>{{ summary?.agentType || 'Agent' }}</span>
        <a-tag v-if="summary" :color="statusColor(summary.status)">{{ statusLabel(summary.status) }}</a-tag>
      </a-flex>
    </template>

    <template v-if="summary">
      <a-flex vertical :gap="16">
        <a-radio-group :value="drawerMode" size="small" @update:value="$emit('drawerModeChange', $event)">
          <a-radio-button value="quickAction">快速处理</a-radio-button>
          <a-radio-button value="deepReview">深度复盘</a-radio-button>
        </a-radio-group>

        <a-card size="small" title="运行摘要" :loading="summaryLoading">
          <a-descriptions :column="1" size="small">
            <a-descriptions-item label="Agent Run ID">
              <a-typography-text code copyable>{{ summary.agentRunId }}</a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="任务">
              <router-link v-if="summary.taskId" :to="`/workbench?task=${summary.taskId}`">
                {{ summary.taskTitle || summary.taskId }}
              </router-link>
              <span v-else>-</span>
            </a-descriptions-item>
            <a-descriptions-item label="会话 ID">
              <a-typography-text v-if="summary.subSessionId || summary.sessionId" code>
                {{ summary.subSessionId || summary.sessionId }}
              </a-typography-text>
              <span v-else>-</span>
            </a-descriptions-item>
            <a-descriptions-item label="最近活动">
              {{ summary.lastActivityAt ? formatRelativeTime(parseDate(summary.lastActivityAt) ?? Date.now()) : '-' }}
            </a-descriptions-item>
            <a-descriptions-item label="运行时长">
              {{ summary.durationMs != null ? formatDurationFromMs(summary.durationMs) : '-' }}
            </a-descriptions-item>
            <a-descriptions-item label="Token 使用量">
              <a-tooltip v-if="summary.tokenUsed > 0" :title="formatTokenRaw(summary.tokenUsed)">
                <span>{{ formatTokenCount(summary.tokenUsed) }}</span>
              </a-tooltip>
              <span v-else>-</span>
            </a-descriptions-item>
            <a-descriptions-item label="人工介入">
              {{ summary.guidanceCount > 0 ? `已介入 ${summary.guidanceCount} 次` : '暂无' }}
            </a-descriptions-item>
            <a-descriptions-item label="当前判断">
              <a-tag :color="summary.blockerType ? 'red' : 'blue'">
                {{ summaryJudgementLabel(summary) }}
              </a-tag>
              <span style="margin-left: 8px">{{ summary.blockerLabel }}</span>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <a-card size="small" title="结果与风险" :loading="summaryLoading">
          <a-alert
            :type="summary.blockerType ? 'warning' : 'info'"
            show-icon
            :message="summary.blockerLabel"
            :description="summary.resultSummary || '暂无结构化摘要。'"
          />
          <a-typography-paragraph style="margin: 12px 0 0 0">
            {{ summary.longSummary || summary.resultSummary || '暂无结构化摘要。' }}
          </a-typography-paragraph>
        </a-card>

        <a-card v-if="drawerMode === 'deepReview' || viewMode === 'admin'" size="small" title="治理上下文" :loading="summaryLoading">
          <a-descriptions :column="1" size="small">
            <a-descriptions-item label="风险等级">
              <span>{{ summary.riskLevel || '暂无' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="审批状态">
              <span>{{ summary.governance?.latestApprovalStatus || '暂无' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="待审批单">
              <span>{{ summary.governance?.pendingApprovals ?? '-' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="最近审计事件">
              <span>{{ summary.governance?.recentAuditEvents ?? '-' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="代码变更摘要">
              <span>{{ codeChangesSummaryText(summary) }}</span>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <a-card size="small" title="处置动作">
          <a-space wrap style="margin-bottom: 12px">
            <a-button
              v-if="actionPermissions.canPause && summary.status === 'running'"
              :loading="actionLoading === summary.agentRunId"
              @click="$emit('pause', summary.agentRunId)"
            >
              <template #icon><PauseCircleOutlined /></template>
              暂停
            </a-button>
            <a-button
              v-if="actionPermissions.canResume && summary.status === 'paused'"
              type="primary"
              :loading="actionLoading === summary.agentRunId"
              @click="$emit('resume', summary.agentRunId)"
            >
              <template #icon><PlayCircleOutlined /></template>
              恢复
            </a-button>
            <a-popconfirm
              v-if="actionPermissions.canTerminate && (summary.status === 'running' || summary.status === 'paused')"
              title="确定终止此 Agent？"
              @confirm="$emit('terminate', summary.agentRunId)"
            >
              <a-button danger :loading="actionLoading === summary.agentRunId">
                <template #icon><StopOutlined /></template>
                终止
              </a-button>
            </a-popconfirm>
            <router-link v-if="summary.taskId" :to="`/workbench?task=${summary.taskId}`">
              <a-button>进入任务工作台</a-button>
            </router-link>
            <a-button @click="$emit('copyDiagnostics')">复制诊断信息</a-button>
          </a-space>
          <a-input-search
            v-if="actionPermissions.canInjectGuidance"
            :value="inlineGuidance"
            placeholder="输入补充指令..."
            enter-button="发送"
            :loading="actionLoading === summary.agentRunId"
            @search="$emit('inlineGuidanceSend', summary.agentRunId)"
            @update:value="$emit('inlineGuidanceChange', String($event ?? ''))"
          />
          <a-alert
            v-else
            type="info"
            show-icon
            message="当前账号没有注入指令权限"
            description="你仍可查看详情并跳转到任务工作台继续分析。"
          />
        </a-card>

        <a-card size="small" title="最近关键事件" :loading="summaryLoading">
          <a-empty v-if="(summary.latestEvents?.length || 0) === 0" description="暂无事件" />
          <div v-else class="drawer-events">
            <div v-for="evt in summary.latestEvents" :key="`${evt.type}-${evt.ts}`" class="drawer-event-item">
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
</template>

<script setup lang="ts">
import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  StopOutlined,
} from "@ant-design/icons-vue";
import type {
  AgentOpsActionPermissions,
  AgentOpsViewMode,
  AgentRunOpsSummary,
} from "../../lib/api";

defineProps<{
  open: boolean;
  summary: AgentRunOpsSummary | null;
  summaryLoading: boolean;
  drawerMode: "quickAction" | "deepReview";
  viewMode: AgentOpsViewMode;
  actionPermissions: AgentOpsActionPermissions;
  actionLoading: string | null;
  inlineGuidance: string;
  statusColor: (status: string) => string;
  statusLabel: (status: string) => string;
  eventColor: (type: string) => string;
  parseDate: (value?: string | null) => number | null;
  formatRelativeTime: (timestamp: number) => string;
  formatDurationFromMs: (durationMs?: number | null) => string;
  formatTokenRaw: (tokenUsed?: number | null) => string;
  formatTokenCount: (tokenUsed?: number | null) => string;
  summaryJudgementLabel: (summary: AgentRunOpsSummary) => string;
  codeChangesSummaryText: (summary: AgentRunOpsSummary) => string;
}>();

defineEmits<{
  (e: "close"): void;
  (e: "drawerModeChange", value: unknown): void;
  (e: "pause", agentRunId: string): void;
  (e: "resume", agentRunId: string): void;
  (e: "terminate", agentRunId: string): void;
  (e: "copyDiagnostics"): void;
  (e: "inlineGuidanceSend", agentRunId: string): void;
  (e: "inlineGuidanceChange", value: string): void;
}>();
</script>

<style scoped>
.drawer-events {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drawer-event-item {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
}

.event-feed-summary {
  margin-top: 8px;
  color: #334155;
  font-size: 13px;
  line-height: 1.6;
}

.event-feed-meta {
  color: #94a3b8;
  font-size: 12px;
}
</style>