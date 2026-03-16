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
    <a-card size="small" :style="{ marginBottom: '12px' }" data-testid="task-workflow-banner">
      <a-space size="small" wrap :style="{ marginBottom: workflowBannerState.blockingReason ? '12px' : '0' }">
        <a-tag color="blue">阶段 {{ currentStageLabel }}</a-tag>
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

      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item label="当前阶段">{{ currentStageLabel }}</a-descriptions-item>
        <a-descriptions-item label="流程状态">{{ workflowStatusLabel }}</a-descriptions-item>
        <a-descriptions-item label="角色结论数">{{ roleConclusions.length }}</a-descriptions-item>
        <a-descriptions-item label="待处理项">{{ openDeveloperChangeRequests.length }}</a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-card size="small" title="阶段实际态" :style="{ marginBottom: '12px' }" data-testid="task-workflow-stage-runtime">
      <a-empty v-if="workflowStages.length === 0" description="暂无阶段运行记录" />
      <a-space v-else direction="vertical" :size="8" :style="{ width: '100%' }">
        <a-card v-for="stage in workflowStages" :key="stage.id || stage.stageKey" size="small">
          <a-flex justify="space-between" align="flex-start" :gap="8">
            <div>
              <div><strong>{{ stage.stageLabel || formatStageLabel(stage.stageKey) }}</strong></div>
              <a-typography-text type="secondary">
                {{ stage.stageKey }} · 主责 {{ stage.primaryRoleLabel || '未命名角色' }}
              </a-typography-text>
            </div>
            <a-space size="small" wrap>
              <a-tag :color="stageStatusTone(stage.status)">{{ stageStatusLabel(stage.status) }}</a-tag>
              <a-tag :color="gateResultColor(runtimeSummaryOf(stage).gateResult)">
                Gate {{ gateResultLabel(runtimeSummaryOf(stage).gateResult) }}
              </a-tag>
              <a-tag :color="approvalResultColor(runtimeSummaryOf(stage).approvalResult)">
                Approval {{ approvalResultLabel(runtimeSummaryOf(stage).approvalResult) }}
              </a-tag>
            </a-space>
          </a-flex>

          <a-space wrap :style="{ marginTop: '8px' }">
            <a-tag>Gate 配置 {{ stage.gateCount }}</a-tag>
            <a-tag>Approval 配置 {{ stage.approvalCount }}</a-tag>
            <a-tag>角色结论 {{ runtimeSummaryOf(stage).conclusionCount }}</a-tag>
            <a-tag v-if="runtimeSummaryOf(stage).blockDecisionCount > 0 || runtimeSummaryOf(stage).manualReviewCount > 0" color="red">
              阻断结论 {{ runtimeSummaryOf(stage).blockDecisionCount + runtimeSummaryOf(stage).manualReviewCount }}
            </a-tag>
            <a-tag v-if="runtimeSummaryOf(stage).approvalDecisionCount > 0" color="orange">
              审批结论 {{ runtimeSummaryOf(stage).approvalDecisionCount }}
            </a-tag>
            <a-tag v-if="runtimeSummaryOf(stage).openChangeRequestCount > 0" color="gold">
              待修正 {{ runtimeSummaryOf(stage).openChangeRequestCount }}
            </a-tag>
          </a-space>

          <a-alert
            v-if="stage.blockingReason"
            type="error"
            show-icon
            :style="{ marginTop: '8px' }"
            :message="stage.blockingReason"
          />

          <a-space direction="vertical" :size="4" :style="{ marginTop: '8px', width: '100%' }">
            <a-typography-text v-if="runtimeSummaryOf(stage).latestBlockingRoleLabel" type="danger">
              最近阻断角色：{{ runtimeSummaryOf(stage).latestBlockingRoleLabel }}
            </a-typography-text>
            <a-typography-text v-if="runtimeSummaryOf(stage).latestApprovalRoleLabel" type="warning">
              最近审批角色：{{ runtimeSummaryOf(stage).latestApprovalRoleLabel }}
            </a-typography-text>
          </a-space>
        </a-card>
      </a-space>
    </a-card>

    <a-card size="small" title="已介入角色列表" :style="{ marginBottom: '12px' }" data-testid="task-workflow-involved-roles">
      <a-empty v-if="roleConclusions.length === 0" description="暂无已介入角色" />
      <a-space v-else direction="vertical" :size="8" :style="{ width: '100%' }">
        <a-card v-for="item in roleConclusions" :key="item.id" size="small">
          <a-flex justify="space-between" align="flex-start" :gap="8">
            <div>
              <div><strong>{{ item.roleLabel }}</strong></div>
              <a-typography-text type="secondary">阶段 {{ formatStageLabel(item.stage) }}</a-typography-text>
            </div>
            <a-space size="small" wrap>
              <a-tag :color="roleDecisionColor(item.finalDecision)">{{ roleDecisionLabel(item.finalDecision) }}</a-tag>
              <a-tag :color="riskColor(item.aggregateRiskLevel)">{{ item.aggregateRiskLevel }}</a-tag>
              <a-tag v-if="item.approvalRequired" color="orange">需审批</a-tag>
              <a-tag v-if="item.finalDecision === 'human-review'" color="volcano">人工复核</a-tag>
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
    </a-card>

    <a-card size="small" title="开发者待处理项" :style="{ marginBottom: '12px' }" data-testid="task-workflow-change-requests">
      <a-empty v-if="openDeveloperChangeRequests.length === 0" description="暂无待处理项" />
      <a-space v-else direction="vertical" :size="8" :style="{ width: '100%' }">
        <a-card v-for="item in openDeveloperChangeRequests" :key="item.id" size="small">
          <a-flex justify="space-between" align="flex-start" :gap="8">
            <div>
              <div><strong>{{ item.title }}</strong></div>
              <a-typography-text type="secondary">来源 {{ item.sourceRoleLabel }}</a-typography-text>
            </div>
            <a-space size="small" wrap>
              <a-tag :color="riskColor(item.priority)">{{ item.priority }}</a-tag>
              <a-tag :color="item.blocking ? 'red' : 'default'">{{ item.blocking ? '阻断' : '非阻断' }}</a-tag>
              <a-tag :color="item.approvalRequired ? 'orange' : 'default'">{{ item.approvalRequired ? '需审批' : changeRequestStatusLabel(item.status) }}</a-tag>
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
    </a-card>

    <a-card size="small" title="审批与人工接管状态" data-testid="task-workflow-governance-status">
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item label="待审批阶段数">{{ approvalPendingStages.length }}</a-descriptions-item>
        <a-descriptions-item label="需审批角色数">{{ approvalRequiredConclusions.length }}</a-descriptions-item>
        <a-descriptions-item label="人工介入状态">{{ manualInterventionLabel }}</a-descriptions-item>
        <a-descriptions-item label="已解决修正项">{{ resolvedDeveloperChangeRequests.length }}</a-descriptions-item>
      </a-descriptions>

      <div v-if="approvalPendingStages.length > 0" :style="{ marginTop: '12px' }">
        <a-typography-text strong>待审批阶段</a-typography-text>
        <ul :style="{ paddingLeft: '18px', margin: '6px 0' }">
          <li v-for="stage in approvalPendingStages" :key="stage.id || stage.stageKey">
            {{ stage.stageLabel || stage.stageKey }}
          </li>
        </ul>
      </div>

      <div v-if="manualReviewConclusions.length > 0" :style="{ marginTop: '12px' }">
        <a-typography-text strong>待人工复核角色</a-typography-text>
        <ul :style="{ paddingLeft: '18px', margin: '6px 0' }">
          <li v-for="item in manualReviewConclusions" :key="item.id">
            {{ item.roleLabel }} · {{ formatStageLabel(item.stage) }}
          </li>
        </ul>
      </div>

      <div v-if="roleConflictItems.length > 0" :style="{ marginTop: '12px' }">
        <a-typography-text strong>冲突摘要</a-typography-text>
        <a-list size="small" :data-source="roleConflictItems">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-space direction="vertical" :size="2">
                <a-space size="small" wrap>
                  <strong>{{ item.roleLabel }}</strong>
                  <a-tag :color="riskColor(item.severity)">{{ item.severity }}</a-tag>
                  <a-tag :color="roleDecisionColor(item.finalDecision)">{{ roleDecisionLabel(item.finalDecision) }}</a-tag>
                </a-space>
                <a-typography-text type="secondary">{{ item.summary }}</a-typography-text>
              </a-space>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-card>
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

const expandedRoleReviewIds = ref<string[]>([]);
const expandedChangeRequestIds = ref<string[]>([]);

const openDeveloperChangeRequests = computed(() =>
  props.developerChangeRequests.filter((item) => item.status === "open" || item.status === "in-progress"),
);
const resolvedDeveloperChangeRequests = computed(() =>
  props.developerChangeRequests.filter((item) => item.status === "resolved"),
);
const blockingRoleConclusions = computed(() =>
  props.roleConclusions.filter((item) => item.finalDecision === "block" || item.finalDecision === "human-review"),
);
const manualReviewConclusions = computed(() =>
  props.roleConclusions.filter((item) => item.finalDecision === "human-review"),
);
const approvalRequiredConclusions = computed(() =>
  props.roleConclusions.filter((item) => item.approvalRequired),
);
const approvalPendingStages = computed(() =>
  props.workflowStages.filter((stage) => stage.approvalState === "pending"),
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

const stageLabelLookup = computed(() =>
  new Map(
    props.workflowStages.map((stage) => [stage.stageKey, stage.stageLabel || fallbackStageLabel(stage.stageKey)]),
  ),
);

const currentStageLabel = computed(() => formatStageLabel(workflowBannerState.value.currentStage));

function runtimeSummaryOf(stage: TaskStageViewModel) {
  return stage.runtimeSummary || {
    conclusionCount: 0,
    blockDecisionCount: 0,
    approvalDecisionCount: 0,
    manualReviewCount: 0,
    openChangeRequestCount: 0,
    blockingChangeRequestCount: 0,
    gateResult: "not-configured",
    approvalResult: "not-configured",
    latestBlockingRoleLabel: undefined,
    latestApprovalRoleLabel: undefined,
  };
}

const manualInterventionLabel = computed(() => {
  if (manualReviewConclusions.value.length > 0) {
    return "需要人工复核";
  }
  if (workflowBannerState.value.blocked) {
    return "当前阻断，待人工处理";
  }
  if (approvalPendingStages.value.length > 0) {
    return "等待审批结果";
  }
  return "当前无需人工接管";
});

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

function roleDecisionLabel(decision: string) {
  switch (decision) {
    case "block":
      return "阻断";
    case "human-review":
      return "人工复核";
    case "needs-approval":
      return "待审批";
    case "notify-developer":
      return "通知开发者";
    case "allow":
      return "放行";
    default:
      return decision;
  }
}

function changeRequestStatusLabel(status: string) {
  switch (status) {
    case "open":
      return "待处理";
    case "in-progress":
      return "处理中";
    case "acknowledged":
      return "已确认";
    case "resolved":
      return "已解决";
    default:
      return status;
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

function stageStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "待开始";
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
      return status;
  }
}

function gateResultColor(status: string) {
  switch (status) {
    case "blocked":
      return "red";
    case "passed":
      return "green";
    case "pending":
      return "blue";
    default:
      return "default";
  }
}

function gateResultLabel(status: string) {
  switch (status) {
    case "blocked":
      return "阻断";
    case "passed":
      return "通过";
    case "pending":
      return "待判定";
    default:
      return "未配置";
  }
}

function approvalResultColor(status: string) {
  switch (status) {
    case "approved":
      return "green";
    case "pending":
      return "orange";
    case "rejected":
      return "red";
    default:
      return "default";
  }
}

function approvalResultLabel(status: string) {
  switch (status) {
    case "approved":
      return "已通过";
    case "pending":
      return "待审批";
    case "rejected":
      return "已拒绝";
    default:
      return "未配置";
  }
}

function formatStageLabel(stageKey: string | null | undefined) {
  if (!stageKey) {
    return "未开始";
  }

  return stageLabelLookup.value.get(stageKey) || fallbackStageLabel(stageKey);
}

function fallbackStageLabel(stageKey: string) {
  switch (stageKey) {
    case "intake":
      return "需求进入";
    case "clarify":
      return "需求澄清";
    case "design":
      return "方案设计";
    case "plan":
      return "任务拆解";
    case "implement":
      return "实现开发";
    case "review":
      return "评审";
    case "verify":
      return "集成验证";
    case "fix":
      return "修复处理";
    case "release":
      return "发布执行";
    case "post-release":
      return "发布观察";
    case "retrospective":
      return "复盘沉淀";
    case "done":
      return "已完成";
    case "cancelled":
      return "已取消";
    case "unknown":
      return "未知阶段";
    default:
      return stageKey;
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