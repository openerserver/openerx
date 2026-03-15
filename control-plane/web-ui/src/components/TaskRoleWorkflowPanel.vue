<template>
  <a-spin v-if="loading" />
  <a-alert
    v-else-if="error"
    type="warning"
    show-icon
    :message="error"
  />
  <a-empty
    v-else-if="!workflowSummary && roleConclusions.length === 0 && developerChangeRequests.length === 0"
    description="暂无角色实际介入记录"
  />
  <div v-else>
    <a-space size="small" wrap :style="{ marginBottom: '12px' }">
      <a-tag color="blue">阶段 {{ workflowBannerState.currentStage }}</a-tag>
      <a-tag :color="stageStatusTone(workflowBannerState.workflowStatus)">{{ workflowStatusLabel }}</a-tag>
      <a-tag v-if="workflowBannerState.blocked" color="red">已阻断</a-tag>
      <a-tag v-if="workflowBannerState.approvalPending" color="orange">待审批</a-tag>
      <a-tag v-if="workflowBannerState.openChangeRequestCount > 0" color="gold">
        待修正 {{ workflowBannerState.openChangeRequestCount }}
      </a-tag>
    </a-space>

    <a-alert
      v-if="workflowBannerState.blockingReason"
      type="error"
      show-icon
      :message="workflowBannerState.blockingReason"
      :style="{ marginBottom: '12px' }"
    />

    <a-tabs :active-key="activeTab" size="small" @update:activeKey="activeTab = String($event)">
      <a-tab-pane key="overview" tab="概览">
        <a-descriptions :column="1" bordered size="small">
          <a-descriptions-item label="当前阶段">{{ workflowBannerState.currentStage }}</a-descriptions-item>
          <a-descriptions-item label="流程状态">{{ workflowStatusLabel }}</a-descriptions-item>
          <a-descriptions-item label="角色结论数">{{ roleConclusions.length }}</a-descriptions-item>
          <a-descriptions-item label="待修正数">{{ openDeveloperChangeRequests.length }}</a-descriptions-item>
        </a-descriptions>
      </a-tab-pane>

      <a-tab-pane key="stages" tab="阶段">
        <a-empty v-if="workflowStages.length === 0" description="暂无阶段数据" />
        <a-space v-else direction="vertical" :size="8" :style="{ width: '100%' }">
          <a-card v-for="stage in workflowStages" :key="stage.id" size="small">
            <a-flex justify="space-between" align="flex-start" :gap="8">
              <div>
                <div><strong>{{ stage.stageLabel || stage.stageKey }}</strong></div>
                <a-typography-text type="secondary">主责 {{ stage.primaryRoleLabel || '未指定' }}</a-typography-text>
              </div>
              <a-space size="small" wrap>
                <a-tag :color="stageStatusTone(stage.status)">{{ stage.status }}</a-tag>
                <a-tag v-if="stage.approvalState !== 'not-required'" color="orange">{{ stage.approvalState }}</a-tag>
              </a-space>
            </a-flex>
            <div v-if="stage.blockingReason" :style="{ marginTop: '8px', color: '#a61d24' }">{{ stage.blockingReason }}</div>
          </a-card>
        </a-space>
      </a-tab-pane>

      <a-tab-pane key="reviews" tab="角色评审">
        <a-empty v-if="roleConclusions.length === 0" description="暂无角色结论" />
        <a-space v-else direction="vertical" :size="8" :style="{ width: '100%' }">
          <a-card v-for="item in roleConclusions" :key="item.id" size="small">
            <a-flex justify="space-between" align="flex-start" :gap="8">
              <div>
                <div><strong>{{ item.roleLabel }}</strong></div>
                <a-typography-text type="secondary">阶段 {{ item.stage }}</a-typography-text>
              </div>
              <a-space size="small" wrap>
                <a-tag :color="roleDecisionColor(item.finalDecision)">{{ item.finalDecision }}</a-tag>
                <a-tag :color="riskColor(item.aggregateRiskLevel)">{{ item.aggregateRiskLevel }}</a-tag>
                <a-tag v-if="item.approvalRequired" color="orange">需审批</a-tag>
              </a-space>
            </a-flex>
            <div :style="{ marginTop: '8px' }">{{ item.winningRationale || '暂无聚合说明' }}</div>
            <div :style="{ marginTop: '8px' }">
              <a-button type="link" size="small" @click="toggleRoleReviewExpanded(item.id)">
                {{ isRoleReviewExpanded(item.id) ? '收起详情' : '展开详情' }}
              </a-button>
            </div>
            <div v-if="isRoleReviewExpanded(item.id)" :style="{ marginTop: '8px' }">
              <div v-if="item.mergedFindings.length > 0">
                <a-typography-text strong>主要发现</a-typography-text>
                <ul :style="{ paddingLeft: '18px', margin: '6px 0' }">
                  <li v-for="finding in item.mergedFindings" :key="finding.key">{{ finding.title }}</li>
                </ul>
              </div>
              <div v-if="item.minorityFindings.length > 0">
                <a-typography-text strong>少数派意见</a-typography-text>
                <ul :style="{ paddingLeft: '18px', margin: '6px 0' }">
                  <li v-for="finding in item.minorityFindings" :key="finding.key">{{ finding.title }}</li>
                </ul>
              </div>
            </div>
          </a-card>
        </a-space>
      </a-tab-pane>

      <a-tab-pane key="conflicts" tab="冲突">
        <a-empty v-if="roleConflictItems.length === 0" description="暂无冲突" />
        <a-list v-else size="small" :data-source="roleConflictItems">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-space direction="vertical" :size="2">
                <a-space size="small" wrap>
                  <strong>{{ item.roleLabel }}</strong>
                  <a-tag :color="riskColor(item.severity)">{{ item.severity }}</a-tag>
                  <a-tag :color="roleDecisionColor(item.finalDecision)">{{ item.finalDecision }}</a-tag>
                </a-space>
                <a-typography-text type="secondary">{{ item.summary }}</a-typography-text>
              </a-space>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>

      <a-tab-pane key="change-requests" tab="修正请求">
        <a-empty v-if="developerChangeRequests.length === 0" description="暂无修正请求" />
        <a-space v-else direction="vertical" :size="8" :style="{ width: '100%' }">
          <a-card v-for="item in developerChangeRequests" :key="item.id" size="small">
            <a-flex justify="space-between" align="flex-start" :gap="8">
              <div>
                <div><strong>{{ item.title }}</strong></div>
                <a-typography-text type="secondary">来源 {{ item.sourceRoleLabel }}</a-typography-text>
              </div>
              <a-space size="small" wrap>
                <a-tag :color="riskColor(item.priority)">{{ item.priority }}</a-tag>
                <a-tag :color="item.blocking ? 'red' : 'default'">{{ item.blocking ? '阻断' : '非阻断' }}</a-tag>
                <a-tag :color="item.approvalRequired ? 'orange' : 'default'">{{ item.approvalRequired ? '需审批' : item.status }}</a-tag>
              </a-space>
            </a-flex>
            <div :style="{ marginTop: '8px' }">{{ item.summary }}</div>
            <div :style="{ marginTop: '8px' }">
              <a-button type="link" size="small" @click="toggleChangeRequestExpanded(item.id)">
                {{ isChangeRequestExpanded(item.id) ? '收起详情' : '展开详情' }}
              </a-button>
            </div>
            <div v-if="isChangeRequestExpanded(item.id)" :style="{ marginTop: '8px' }">
              <ul :style="{ paddingLeft: '18px', margin: '6px 0' }">
                <li v-for="change in item.requiredChanges" :key="change">{{ change }}</li>
              </ul>
            </div>
            <a-space size="small" wrap>
              <a-button
                v-if="item.status === 'open'"
                size="small"
                :loading="isUpdatingChangeRequest(item.id)"
                @click="emitRequestStatusChange(item.id, 'acknowledged')"
              >标记已确认</a-button>
              <a-button
                v-if="item.status !== 'resolved'"
                size="small"
                type="primary"
                :loading="isUpdatingChangeRequest(item.id)"
                @click="emitRequestStatusChange(item.id, 'resolved')"
              >标记已解决</a-button>
            </a-space>
          </a-card>
        </a-space>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  DeveloperChangeRequestViewModel,
  RoleConclusionViewModel,
  TaskStageViewModel,
  TaskWorkflowViewModel,
} from "../lib/api";

const props = withDefaults(defineProps<{
  loading: boolean;
  error: string | null;
  workflowSummary: TaskWorkflowViewModel["workflow"] | null;
  workflowStages: TaskStageViewModel[];
  roleConclusions: RoleConclusionViewModel[];
  developerChangeRequests: DeveloperChangeRequestViewModel[];
  updatingRequestIds?: string[];
}>(), {
  updatingRequestIds: () => [],
});

const emit = defineEmits<{
  (e: "request-status-change", payload: { requestId: string; status: "acknowledged" | "resolved" }): void;
}>();

const activeTab = ref("overview");
const expandedRoleReviewIds = ref<string[]>([]);
const expandedChangeRequestIds = ref<string[]>([]);

const openDeveloperChangeRequests = computed(() =>
  props.developerChangeRequests.filter((item) => item.status === "open" || item.status === "in-progress"),
);
const blockingRoleConclusions = computed(() =>
  props.roleConclusions.filter((item) => item.finalDecision === "block" || item.finalDecision === "human-review"),
);
const roleConflictItems = computed(() =>
  props.roleConclusions.flatMap((item) =>
    item.conflicts.map((conflict) => ({
      roleAgentId: item.roleAgentId,
      roleLabel: item.roleLabel,
      stage: item.stage,
      finalDecision: item.finalDecision,
      ...conflict,
    })),
  ),
);
const workflowBannerState = computed(() => ({
  currentStage: props.workflowSummary?.currentStage ?? "unknown",
  workflowStatus: props.workflowSummary?.status ?? "pending",
  blocked: blockingRoleConclusions.value.length > 0 || props.workflowSummary?.status === "blocked",
  approvalPending: props.workflowStages.some((stage) => stage.approvalState === "pending"),
  openChangeRequestCount: openDeveloperChangeRequests.value.length,
  blockingReason: props.workflowStages.find((stage) => stage.blockingReason)?.blockingReason,
}));

const workflowStatusLabel = computed(() => {
  switch (workflowBannerState.value.workflowStatus) {
    case "running":
      return "进行中";
    case "blocked":
      return "已阻断";
    case "waiting-approval":
      return "待审批";
    case "failed":
      return "失败";
    case "completed":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return workflowBannerState.value.workflowStatus || "未开始";
  }
});

function riskColor(level: string) {
  const map: Record<string, string> = {
    low: "green",
    medium: "orange",
    high: "red",
    critical: "magenta",
  };
  return map[level] || "default";
}

function roleDecisionColor(decision: string) {
  switch (decision) {
    case "block":
    case "human-review":
      return "red";
    case "needs-approval":
      return "orange";
    case "notify-developer":
      return "gold";
    case "allow":
      return "green";
    default:
      return "default";
  }
}

function stageStatusTone(status: string) {
  switch (status) {
    case "completed":
      return "green";
    case "running":
      return "blue";
    case "blocked":
      return "red";
    case "waiting-approval":
      return "orange";
    case "failed":
      return "volcano";
    default:
      return "default";
  }
}

function isRoleReviewExpanded(id: string) {
  return expandedRoleReviewIds.value.includes(id);
}

function toggleRoleReviewExpanded(id: string) {
  expandedRoleReviewIds.value = expandedRoleReviewIds.value.includes(id)
    ? expandedRoleReviewIds.value.filter((item) => item !== id)
    : [...expandedRoleReviewIds.value, id];
}

function isChangeRequestExpanded(id: string) {
  return expandedChangeRequestIds.value.includes(id);
}

function toggleChangeRequestExpanded(id: string) {
  expandedChangeRequestIds.value = expandedChangeRequestIds.value.includes(id)
    ? expandedChangeRequestIds.value.filter((item) => item !== id)
    : [...expandedChangeRequestIds.value, id];
}

function isUpdatingChangeRequest(id: string) {
  return props.updatingRequestIds.includes(id);
}

function emitRequestStatusChange(requestId: string, status: "acknowledged" | "resolved") {
  emit("request-status-change", { requestId, status });
}
</script>