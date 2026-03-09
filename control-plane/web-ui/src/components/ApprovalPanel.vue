<template>
  <a-empty v-if="!approvals.length" description="暂无待审批项" />
  <a-space v-else direction="vertical" style="width: 100%">
    <a-card v-for="ticket in typedApprovals" :key="ticket.id" size="small">
      <a-flex align="center" :gap="8" style="margin-bottom: 4px">
        <a-tag :color="riskColor(ticket.riskLevel)">
          {{ ticket.riskLevel }}
        </a-tag>
        <a-typography-text type="secondary" style="font-size: 12px">
          {{ ticket.actionType }}
        </a-typography-text>
      </a-flex>

      <a-typography-paragraph
        type="secondary"
        :content="`Task: ${ticket.taskId?.slice(0, 8) || '-'} — ${JSON.stringify(ticket.requestDetail).slice(0, 60)}`"
        :ellipsis="{ rows: 1 }"
        style="font-size: 12px; margin-bottom: 8px"
      />

      <a-space>
        <a-button
          size="small"
          type="primary"
          :loading="loadingId === ticket.id"
          @click="handleResolve(ticket.id, 'approve')"
        >
          批准
        </a-button>
        <a-button
          size="small"
          danger
          :loading="loadingId === ticket.id"
          @click="handleResolve(ticket.id, 'reject')"
        >
          拒绝
        </a-button>
      </a-space>

      <div style="font-size: 11px; color: #64748b; margin-top: 4px">
        过期: {{ formatApiDateTime(ticket.expiresAt) }}
      </div>
    </a-card>
  </a-space>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { resolveApproval } from "../lib/api";
import { formatApiDateTime } from "../lib/datetime";

interface ApprovalItem {
  id: string;
  taskId: string;
  actionType: string;
  riskLevel: string;
  requestDetail: Record<string, unknown>;
  expiresAt: string;
}

const props = defineProps<{
  approvals: unknown[];
}>();

const emit = defineEmits<{
  resolved: [];
}>();

const loadingId = ref<string | null>(null);

const typedApprovals = computed(() => props.approvals as ApprovalItem[]);

function riskColor(level: string) {
  if (level === "critical") return "red";
  if (level === "high") return "orange";
  return "gold";
}

async function handleResolve(ticketId: string, action: "approve" | "reject") {
  loadingId.value = ticketId;
  try {
    await resolveApproval(ticketId, action);
    emit("resolved");
  } catch {
    // Error handling
  } finally {
    loadingId.value = null;
  }
}
</script>
