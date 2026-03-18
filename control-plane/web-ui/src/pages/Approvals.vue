<template>
  <div style="padding: 24px">
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="3" style="margin: 0">
        审批管理
        <a-badge
          :count="globalPendingCount"
          :number-style="{ backgroundColor: '#3b82f6' }"
          style="margin-left: 8px"
        />
      </a-typography-title>
      <a-space>
        <a-radio-group
          :value="statusFilter"
          button-style="solid"
          size="small"
          @update:value="handleStatusFilterChange"
        >
          <a-radio-button value="pending">待处理</a-radio-button>
          <a-radio-button value="approved">已批准</a-radio-button>
          <a-radio-button value="rejected">已拒绝</a-radio-button>
          <a-radio-button value="expired">已过期</a-radio-button>
          <a-radio-button value="">全部</a-radio-button>
        </a-radio-group>
        <a-button @click="refresh" :loading="loading">刷新</a-button>
      </a-space>
    </a-flex>

    <a-spin :spinning="loading">
      <a-empty v-if="approvals.length === 0" description="暂无审批记录" />

      <a-row v-else :gutter="[16, 16]">
        <a-col v-for="ticket in approvals" :key="ticket.id" :xs="24" :md="12" :xl="8">
          <a-card size="small" hoverable @click="openDetail(ticket)">
            <template #title>
              <a-flex align="center" :gap="8">
                <a-tag :color="riskColor(ticket.riskLevel)">{{ ticket.riskLevel }}</a-tag>
                <a-typography-text style="font-size: 13px">
                  {{ actionTypeLabel(ticket.actionType) }}
                </a-typography-text>
              </a-flex>
            </template>

            <a-descriptions size="small" :column="1" :colon="false">
              <a-descriptions-item label="任务">
                <router-link v-if="ticket.taskId" :to="`/workbench?task=${ticket.taskId}`" @click.stop>
                  <a-typography-text code>{{ ticket.taskId.slice(0, 12) }}</a-typography-text>
                </router-link>
                <span v-else>-</span>
              </a-descriptions-item>
              <a-descriptions-item label="触发规则">
                <template v-if="parseViolations(ticket.requestDetail).length">
                  <a-tag v-for="v in parseViolations(ticket.requestDetail).slice(0, 2)" :key="v" size="small" style="font-size: 11px">{{ v }}</a-tag>
                  <a-tag v-if="parseViolations(ticket.requestDetail).length > 2" size="small">+{{ parseViolations(ticket.requestDetail).length - 2 }}</a-tag>
                </template>
                <span v-else style="font-size: 12px; color: #8c8c8c">-</span>
              </a-descriptions-item>
              <a-descriptions-item label="过期时间">
                <a-typography-text type="secondary" style="font-size: 12px">
                  {{ formatTime(ticket.expiresAt) }}
                </a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item label="创建时间">
                <a-typography-text type="secondary" style="font-size: 12px">
                  {{ formatTime(ticket.createdAt) }}
                </a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item v-if="ticket.status !== 'pending'" label="状态">
                <a-tag :color="statusColor(ticket.status)">
                  {{ statusLabel(ticket.status) }}
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>

            <a-flex v-if="ticket.status === 'pending'" :gap="8" style="margin-top: 12px">
              <router-link
                :to="{
                  path: '/agents',
                  query: {
                    entryContext: 'approval',
                    focus: 'attention',
                    approvalBlocked: 'true',
                    ...(ticket.taskId ? { taskId: ticket.taskId } : {}),
                    ...(ticket.agentRunId ? { agentRunId: ticket.agentRunId } : {}),
                  },
                }"
                @click.stop
              >
                <a-button size="small">查看 Agent</a-button>
              </router-link>
              <a-button
                type="primary"
                size="small"
                @click.stop="openResolveModal(ticket, 'approve')"
              >
                批准
              </a-button>
              <a-button
                danger
                size="small"
                @click.stop="openResolveModal(ticket, 'reject')"
              >
                拒绝
              </a-button>
            </a-flex>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>

    <!-- ── Detail Drawer ─────────────────────────────────────────── -->
    <a-drawer
      :open="!!detailTicket"
      :title="`审批单 ${detailTicket?.id.slice(0, 8) ?? ''}`"
      width="520"
      @close="detailTicket = null"
    >
      <template v-if="detailTicket">
        <a-descriptions bordered size="small" :column="1">
          <a-descriptions-item label="审批单 ID">
            <a-typography-text copyable>{{ detailTicket.id }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="statusColor(detailTicket.status)">{{ statusLabel(detailTicket.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="风险等级">
            <a-tag :color="riskColor(detailTicket.riskLevel)">{{ detailTicket.riskLevel }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="操作类型">{{ actionTypeLabel(detailTicket.actionType) }}</a-descriptions-item>
          <a-descriptions-item label="关联任务">
            <router-link v-if="detailTicket.taskId" :to="`/workbench?task=${detailTicket.taskId}`">
              {{ detailTicket.taskId }}
            </router-link>
            <span v-else>-</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="detailTicket.agentRunId" label="Agent Run">
            <a-typography-text code>{{ detailTicket.agentRunId.slice(0, 12) }}</a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">{{ formatTime(detailTicket.createdAt) }}</a-descriptions-item>
          <a-descriptions-item label="过期时间">{{ formatTime(detailTicket.expiresAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="detailTicket.approver" label="审批人">{{ detailTicket.approver }}</a-descriptions-item>
          <a-descriptions-item v-if="detailTicket.resolvedAt" label="处理时间">{{ formatTime(detailTicket.resolvedAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="detailTicket.comment" label="审批意见">{{ detailTicket.comment }}</a-descriptions-item>
        </a-descriptions>

        <a-divider orientation="left" style="font-size: 13px">请求详情</a-divider>

        <!-- Structured violations -->
        <template v-if="parseViolations(detailTicket.requestDetail).length">
          <a-typography-text strong style="font-size: 12px">命中规则</a-typography-text>
          <div style="margin: 8px 0">
            <a-tag v-for="v in parseViolations(detailTicket.requestDetail)" :key="v" color="warning" style="margin-bottom: 4px">{{ v }}</a-tag>
          </div>
        </template>
        <template v-if="detailTicket.requestDetail?.trigger">
          <a-typography-text strong style="font-size: 12px">触发来源</a-typography-text>
          <div style="margin: 8px 0">
            <a-tag>{{ detailTicket.requestDetail.trigger }}</a-tag>
          </div>
        </template>

        <pre style="background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 240px; overflow: auto">{{ JSON.stringify(detailTicket.requestDetail, null, 2) }}</pre>

        <a-flex v-if="detailTicket.status === 'pending'" :gap="8" style="margin-top: 16px">
          <router-link
            :to="{
              path: '/agents',
              query: {
                entryContext: 'approval',
                focus: 'attention',
                approvalBlocked: 'true',
                ...(detailTicket.taskId ? { taskId: detailTicket.taskId } : {}),
                ...(detailTicket.agentRunId ? { agentRunId: detailTicket.agentRunId } : {}),
              },
            }"
          >
            <a-button>查看 Agent</a-button>
          </router-link>
          <a-button type="primary" @click="openResolveModal(detailTicket, 'approve')">批准</a-button>
          <a-button danger @click="openResolveModal(detailTicket, 'reject')">拒绝</a-button>
        </a-flex>
      </template>
    </a-drawer>

    <!-- ── Resolve Modal (with comment) ──────────────────────────── -->
    <a-modal
      :open="resolveModalVisible"
      :title="resolveAction === 'approve' ? '确认批准' : '确认拒绝'"
      :ok-text="resolveAction === 'approve' ? '批准' : '拒绝'"
      :ok-button-props="{ danger: resolveAction === 'reject' }"
      :confirm-loading="resolving"
      @ok="confirmResolve"
      @cancel="closeResolveModal"
    >
      <a-form layout="vertical">
        <a-form-item label="审批意见（可选）">
          <a-textarea
            :value="resolveComment"
            :rows="3"
            :maxlength="500"
            show-count
            placeholder="请输入审批意见…"
            @update:value="resolveComment = String($event ?? '')"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { listApprovals, resolveApproval } from "../lib/api";
import { formatApiDateTime } from "../lib/datetime";
import { useRealtimeStore } from "../stores/realtime";

interface ApprovalTicket {
  id: string;
  taskId: string;
  agentRunId?: string;
  actionType: string;
  riskLevel: string;
  status: string;
  requestDetail: Record<string, unknown>;
  approver?: string;
  comment?: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
}

const loading = ref(false);
const statusFilter = ref<"pending" | "approved" | "rejected" | "expired" | "">("pending");
const approvals = ref<ApprovalTicket[]>([]);

// ── Global pending count (always fetched, independent of filter) ──
const globalPendingCount = ref(0);

async function refreshPendingCount() {
  try {
    const result = await listApprovals("pending");
    const list = Array.isArray(result) ? result : [];
    globalPendingCount.value = list.length;
  } catch {
    /* ignore */
  }
}

// ── Detail Drawer ───────────────────────────────────────────────
const detailTicket = ref<ApprovalTicket | null>(null);

function openDetail(ticket: ApprovalTicket) {
  detailTicket.value = ticket;
}

// ── Resolve Modal ───────────────────────────────────────────────
const resolveModalVisible = ref(false);
const resolveAction = ref<"approve" | "reject">("approve");
const resolveTicketId = ref("");
const resolveComment = ref("");
const resolving = ref(false);

function openResolveModal(ticket: ApprovalTicket, action: "approve" | "reject") {
  resolveTicketId.value = ticket.id;
  resolveAction.value = action;
  resolveComment.value = "";
  resolveModalVisible.value = true;
}

function closeResolveModal() {
  resolveModalVisible.value = false;
}

async function confirmResolve() {
  resolving.value = true;
  try {
    await resolveApproval(
      resolveTicketId.value,
      resolveAction.value,
      resolveComment.value.trim() || undefined,
    );
    message.success(resolveAction.value === "approve" ? "已批准" : "已拒绝");
    resolveModalVisible.value = false;
    detailTicket.value = null;
    await refresh();
  } catch {
    message.error("操作失败");
  } finally {
    resolving.value = false;
  }
}

// ── Filter & Refresh ────────────────────────────────────────────

watch(statusFilter, () => refresh());

function handleStatusFilterChange(value: unknown) {
  const valid: string[] = ["pending", "approved", "rejected", "expired", ""];
  statusFilter.value = valid.includes(value as string)
    ? (value as typeof statusFilter.value)
    : "pending";
}

async function refresh() {
  loading.value = true;
  try {
    const result = await listApprovals(statusFilter.value || undefined);
    approvals.value = (Array.isArray(result) ? result : []) as ApprovalTicket[];
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
  await refreshPendingCount();
}

// ── Realtime auto-refresh ───────────────────────────────────────
const realtimeStore = useRealtimeStore();
let lastSeenEventCount = 0;

const approvalEvents = computed(() =>
  realtimeStore.events.filter(
    (e) => e.type === "approval.required" || e.type === "approval.resolved",
  ),
);

watch(
  () => approvalEvents.value.length,
  (newLen) => {
    if (newLen > lastSeenEventCount) {
      lastSeenEventCount = newLen;
      refresh();
    }
  },
);

onMounted(() => {
  refresh();
  lastSeenEventCount = approvalEvents.value.length;
});

onBeforeUnmount(() => {
  lastSeenEventCount = 0;
});

// ── Helpers ─────────────────────────────────────────────────────

function parseViolations(detail: Record<string, unknown> | null | undefined): string[] {
  if (!detail) return [];
  const v = detail.violations;
  if (Array.isArray(v)) return v.map(String);
  return [];
}

const actionTypeLabels: Record<string, string> = {
  production_write: "生产写入",
  level3_command: "L3 级命令",
  budget_exceed: "预算超限",
  batch_edit: "批量编辑",
  external_api: "外部 API",
};

function actionTypeLabel(type: string) {
  return actionTypeLabels[type] || type;
}

function riskColor(level: string) {
  if (level === "critical") return "red";
  if (level === "high") return "orange";
  return "gold";
}

function statusColor(status: string) {
  if (status === "approved") return "green";
  if (status === "expired") return "default";
  return "red";
}

function statusLabel(status: string) {
  if (status === "approved") return "已批准";
  if (status === "expired") return "已过期";
  if (status === "rejected") return "已拒绝";
  return "待处理";
}

function formatTime(ts: string) {
  return formatApiDateTime(ts);
}

onMounted(() => refresh());
</script>
