<template>
  <div style="padding: 24px">
    <a-page-header
      :title="task ? `${task.title} / 组织运行详情` : '组织运行详情'"
      sub-title="查看任务运行档位、管理介入记录和当前阶段摘要"
      @back="router.push(`/tasks/${taskId}`)"
    />

    <a-spin :spinning="loading" style="display: block">
      <a-alert v-if="loadError" type="error" show-icon style="margin-bottom: 16px" :message="loadError" />

      <template v-else-if="task">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :xl="8">
            <a-card title="当前运行档位" size="small">
              <a-descriptions :column="1" size="small" bordered>
                <a-descriptions-item label="协作模式">{{ formatCollaboration(operatingState?.collaborationMode) }}</a-descriptions-item>
                <a-descriptions-item label="自动托管">{{ operatingState?.autopilotLevel || '未记录' }}</a-descriptions-item>
                <a-descriptions-item label="管理介入">{{ formatBossMode(operatingState?.bossParticipationMode) }}</a-descriptions-item>
                <a-descriptions-item label="来源">{{ operatingState?.operatingModeSource || '未记录' }}</a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>

          <a-col :xs="24" :xl="8">
            <a-card title="阶段摘要" size="small">
              <a-descriptions :column="1" size="small" bordered>
                <a-descriptions-item label="当前阶段">{{ currentStageLabel }}</a-descriptions-item>
                <a-descriptions-item label="阶段状态">{{ currentStageStatus }}</a-descriptions-item>
                <a-descriptions-item label="工作流状态">{{ workflowStatus }}</a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>

          <a-col :xs="24" :xl="8">
            <a-card title="相关入口" size="small">
              <a-space direction="vertical" style="width: 100%">
                <a-button block type="primary" @click="router.push(`/tasks/${taskId}/operating-override`)">调整任务级覆盖</a-button>
                <a-button block @click="router.push(`/tasks/${taskId}`)">返回任务详情</a-button>
                <a-button v-if="task.projectId" block @click="router.push(`/projects/${task.projectId}/operating-mode`)">查看项目运行档位</a-button>
                <a-button v-if="task.projectId" block @click="router.push(`/projects/${task.projectId}/management-operations`)">查看项目管理介入总览</a-button>
              </a-space>
            </a-card>
          </a-col>
        </a-row>

        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :xl="12">
            <a-card title="最近管理决策" size="small">
              <a-empty v-if="bossDecisions.length === 0" description="当前任务还没有记录管理决策" />
              <a-timeline v-else>
                <a-timeline-item v-for="item in bossDecisions" :key="item.id || item.ts">
                  <strong>{{ item.decisionType || 'unknown' }}</strong>
                  <div>{{ item.reason || '无原因说明' }}</div>
                  <a-space v-if="item.decisionType === 'select-template'" wrap style="margin-top: 8px">
                    <a-tag v-if="formatTemplateDecisionSource(item.metadata)" color="cyan">{{ formatTemplateDecisionSource(item.metadata) }}</a-tag>
                    <a-tag v-if="formatTemplateDecisionTrigger(item.metadata)" color="geekblue">{{ formatTemplateDecisionTrigger(item.metadata) }}</a-tag>
                    <a-tag v-if="formatSelectedTemplate(item.metadata)">{{ formatSelectedTemplate(item.metadata) }}</a-tag>
                  </a-space>
                  <div
                    v-if="item.decisionType === 'select-template' && formatTemplateDecisionReason(item.metadata)"
                    style="margin-top: 6px; color: rgba(0, 0, 0, 0.45); font-size: 12px"
                  >
                    {{ formatTemplateDecisionReason(item.metadata) }}
                  </div>
                  <div style="color: rgba(0, 0, 0, 0.45); font-size: 12px">{{ item.ts || '-' }}</div>
                </a-timeline-item>
              </a-timeline>
            </a-card>
          </a-col>

          <a-col :xs="24" :xl="12">
            <a-card title="升级请求" size="small">
              <a-empty v-if="escalations.length === 0" description="当前任务还没有升级请求" />
              <a-list v-else :data-source="escalations" size="small">
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta :title="item.reason || '未命名升级请求'" :description="`${item.status || 'pending'} · ${item.ts || '-'}`" />
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </a-col>
        </a-row>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type BossDecisionRecord,
  type HumanEscalationRequest,
  type Task,
  type TaskOperatingState,
  type TaskWorkflowViewModel,
  getTask,
  getTaskBossDecisions,
  getTaskEscalations,
  getTaskOperatingState,
  getTaskWorkflowView,
  toApiError,
} from "../lib/api";

const route = useRoute();
const router = useRouter();
const taskId = String(route.params.taskId || "");

const loading = ref(true);
const loadError = ref("");
const task = ref<Task | null>(null);
const workflowView = ref<TaskWorkflowViewModel | null>(null);
const operatingState = ref<TaskOperatingState | null>(null);
const bossDecisions = ref<BossDecisionRecord[]>([]);
const escalations = ref<HumanEscalationRequest[]>([]);
const currentStageLabel = computed(
  () =>
    operatingState.value?.currentStageKey || workflowView.value?.workflow.currentStage || "未记录",
);
const currentStageStatus = computed(
  () => operatingState.value?.currentStageStatus || workflowView.value?.workflow.status || "未记录",
);
const workflowStatus = computed(
  () => workflowView.value?.workflow.status || task.value?.status || "未知",
);

function formatCollaboration(value?: string | null) {
  if (value === "team") return "团队模式";
  if (value === "hybrid") return "混合模式";
  return value === "solo" ? "单兵模式" : "未记录";
}

function formatBossMode(value?: string | null) {
  if (value === "disabled") return "不参与";
  if (value === "exception-only") return "异常介入";
  if (value === "full-manager") return "全面管理";
  return value === "advisory" ? "建议模式" : "未记录";
}

function formatTemplateDecisionSource(metadata?: Record<string, unknown>) {
  if (metadata?.source === "stage-policy") return "阶段策略命中";
  if (metadata?.source === "recommended-profile") return "场景推荐命中";
  if (metadata?.source === "project-preferred") return "项目偏好命中";
  return "";
}

function formatTemplateDecisionTrigger(metadata?: Record<string, unknown>) {
  if (metadata?.trigger === "startup") return "执行启动前";
  if (metadata?.trigger === "stage-blocked") return "阻断后二次治理";
  if (metadata?.trigger === "stage-waiting-approval") return "升级后二次治理";
  return "";
}

function formatSelectedTemplate(metadata?: Record<string, unknown>) {
  return typeof metadata?.selectedTemplateId === "string" && metadata.selectedTemplateId.trim()
    ? `模板 ${metadata.selectedTemplateId.trim()}`
    : "";
}

function formatTemplateDecisionReason(metadata?: Record<string, unknown>) {
  const parts: string[] = [];
  if (typeof metadata?.stagePolicyNote === "string" && metadata.stagePolicyNote.trim()) {
    parts.push(`阶段策略：${metadata.stagePolicyNote.trim()}`);
  }
  if (typeof metadata?.scenarioReason === "string" && metadata.scenarioReason.trim()) {
    parts.push(`推荐原因：${metadata.scenarioReason.trim()}`);
  }
  if (typeof metadata?.governanceReason === "string" && metadata.governanceReason.trim()) {
    parts.push(`治理触发：${metadata.governanceReason.trim()}`);
  }
  return parts.join(" · ");
}

async function loadData() {
  loading.value = true;
  loadError.value = "";
  try {
    const [taskResult, operatingStateResult, bossDecisionResult, escalationResult] =
      await Promise.all([
        getTask(taskId),
        getTaskOperatingState(taskId),
        getTaskBossDecisions(taskId),
        getTaskEscalations(taskId),
      ]);
    task.value = taskResult;
    operatingState.value = operatingStateResult;
    bossDecisions.value = bossDecisionResult.data;
    escalations.value = escalationResult.data;
    try {
      workflowView.value = await getTaskWorkflowView(taskId);
    } catch {
      workflowView.value = null;
    }
  } catch (error) {
    loadError.value =
      toApiError(error)?.message || (error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>