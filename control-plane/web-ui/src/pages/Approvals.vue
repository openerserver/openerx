<template>
  <div style="padding: 24px">
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="3" style="margin: 0">
        审批管理
        <a-badge
          :count="pendingCount"
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
          <a-radio-button value="">全部</a-radio-button>
        </a-radio-group>
        <a-button @click="refresh" :loading="loading">刷新</a-button>
      </a-space>
    </a-flex>

    <a-spin :spinning="loading">
      <a-empty v-if="approvals.length === 0" description="暂无审批记录" />

      <a-row v-else :gutter="[16, 16]">
        <a-col v-for="ticket in approvals" :key="ticket.id" :xs="24" :md="12" :xl="8">
          <a-card size="small" hoverable>
            <template #title>
              <a-flex align="center" :gap="8">
                <a-tag :color="riskColor(ticket.riskLevel)">{{ ticket.riskLevel }}</a-tag>
                <a-typography-text style="font-size: 13px">
                  {{ ticket.actionType }}
                </a-typography-text>
              </a-flex>
            </template>

            <a-descriptions size="small" :column="1" :colon="false">
              <a-descriptions-item label="任务">
                <router-link v-if="ticket.taskId" :to="`/tasks/${ticket.taskId}`">
                  <a-typography-text code>{{ ticket.taskId.slice(0, 12) }}</a-typography-text>
                </router-link>
                <span v-else>-</span>
              </a-descriptions-item>
              <a-descriptions-item label="详情">
                <a-typography-paragraph
                  type="secondary"
                  :content="JSON.stringify(ticket.requestDetail).slice(0, 120)"
                  :ellipsis="{ rows: 2 }"
                  style="font-size: 12px; margin: 0"
                />
              </a-descriptions-item>
              <a-descriptions-item label="过期时间">
                <a-typography-text type="secondary" style="font-size: 12px">
                  {{ formatTime(ticket.expiresAt) }}
                </a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item v-if="ticket.status !== 'pending'" label="状态">
                <a-tag :color="statusColor(ticket.status)">
                  {{ statusLabel(ticket.status) }}
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>

            <a-flex v-if="ticket.status === 'pending'" :gap="8" style="margin-top: 12px">
              <a-button
                type="primary"
                size="small"
                :loading="loadingId === ticket.id"
                @click="handleResolve(ticket.id, 'approve')"
              >
                批准
              </a-button>
              <a-popconfirm title="确定拒绝？" @confirm="handleResolve(ticket.id, 'reject')">
                <a-button
                  danger
                  size="small"
                  :loading="loadingId === ticket.id"
                >
                  拒绝
                </a-button>
              </a-popconfirm>
            </a-flex>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { listApprovals, resolveApproval } from "../lib/api";
import { formatApiDateTime } from "../lib/datetime";

interface ApprovalTicket {
  id: string;
  taskId: string;
  actionType: string;
  riskLevel: string;
  status: string;
  requestDetail: Record<string, unknown>;
  expiresAt: string;
}

const loading = ref(false);
const loadingId = ref<string | null>(null);
const statusFilter = ref<"pending" | "approved" | "rejected" | "">("pending");
const approvals = ref<ApprovalTicket[]>([]);

const pendingCount = computed(
  () => approvals.value.filter((a) => a.status === "pending").length,
);

watch(statusFilter, () => refresh());

function handleStatusFilterChange(value: unknown) {
  if (value === "pending" || value === "approved" || value === "rejected" || value === "") {
    statusFilter.value = value;
    return;
  }
  statusFilter.value = "pending";
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
}

async function handleResolve(ticketId: string, action: "approve" | "reject") {
  loadingId.value = ticketId;
  try {
    await resolveApproval(ticketId, action);
    await refresh();
  } catch {
    // ignore
  } finally {
    loadingId.value = null;
  }
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
  return "已拒绝";
}

function formatTime(ts: string) {
  return formatApiDateTime(ts);
}

onMounted(() => refresh());
</script>
