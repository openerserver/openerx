<template>
  <div style="padding: 24px">
    <a-page-header
      :title="viewModel ? `${viewModel.project.name} / 老板经营视图` : '老板经营视图'"
      sub-title="查看项目内老板决策时间线、人工覆盖历史、开放升级请求和待处理任务"
      @back="router.push(`/projects/${projectId}`)"
    />

    <ProjectSectionNav :project-id="projectId" active-key="boss-operations" />

    <a-spin :spinning="loading" style="display: block">
      <a-alert v-if="loadError" type="error" show-icon style="margin-bottom: 16px" :message="loadError" />

      <template v-else-if="viewModel">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :md="8" :xl="4">
            <a-card size="small" title="任务总数">
              <a-statistic :value="viewModel.summary.totalTasks" />
            </a-card>
          </a-col>
          <a-col :xs="24" :md="8" :xl="4">
            <a-card size="small" title="老板决策">
              <a-statistic :value="viewModel.summary.totalBossDecisions" />
            </a-card>
          </a-col>
          <a-col :xs="24" :md="8" :xl="4">
            <a-card size="small" title="开放升级">
              <a-statistic :value="viewModel.summary.openEscalations" />
            </a-card>
          </a-col>
          <a-col :xs="24" :md="8" :xl="4">
            <a-card size="small" title="阻断任务">
              <a-statistic :value="viewModel.summary.blockedTasks" />
            </a-card>
          </a-col>
          <a-col :xs="24" :md="8" :xl="4">
            <a-card size="small" title="待审批任务">
              <a-statistic :value="viewModel.summary.waitingApprovalTasks" />
            </a-card>
          </a-col>
          <a-col :xs="24" :md="8" :xl="4">
            <a-card size="small" title="需关注">
              <a-statistic :value="viewModel.summary.tasksNeedingAttention" />
            </a-card>
          </a-col>
          <a-col :xs="24" :md="8" :xl="4">
            <a-card size="small" title="人工覆盖">
              <a-statistic :value="viewModel.summary.manualOverrides" />
            </a-card>
          </a-col>
        </a-row>

        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :xl="12">
            <a-card size="small" title="老板决策时间线">
              <a-empty v-if="viewModel.timeline.length === 0" description="当前项目还没有老板决策记录" />
              <a-timeline v-else>
                <a-timeline-item v-for="item in viewModel.timeline" :key="`${item.taskId}-${item.id}`">
                  <div style="display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap">
                    <div>
                      <strong>{{ item.decisionType }}</strong>
                      <div style="margin-top: 4px">{{ item.reason }}</div>
                      <a-space wrap style="margin-top: 8px">
                        <a-tag color="blue">{{ item.taskTitle }}</a-tag>
                        <a-tag>{{ formatStageLabel(item.currentStageKey) }}</a-tag>
                        <a-tag :color="workflowStatusColor(item.workflowStatus)">{{ item.workflowStatus }}</a-tag>
                        <a-tag v-if="item.decisionType === 'select-template' && formatTemplateDecisionSource(item.metadata)" color="cyan">
                          {{ formatTemplateDecisionSource(item.metadata) }}
                        </a-tag>
                        <a-tag v-if="item.decisionType === 'select-template' && formatTemplateDecisionTrigger(item.metadata)" color="geekblue">
                          {{ formatTemplateDecisionTrigger(item.metadata) }}
                        </a-tag>
                        <a-tag v-if="item.decisionType === 'select-template' && formatSelectedTemplate(item.metadata)">
                          {{ formatSelectedTemplate(item.metadata) }}
                        </a-tag>
                        <a-tag v-if="item.openEscalationCount > 0" color="orange">开放升级 {{ item.openEscalationCount }}</a-tag>
                      </a-space>
                      <div
                        v-if="item.decisionType === 'select-template' && formatTemplateDecisionReason(item.metadata)"
                        style="margin-top: 6px; color: rgba(0, 0, 0, 0.45)"
                      >
                        {{ formatTemplateDecisionReason(item.metadata) }}
                      </div>
                    </div>
                    <div style="color: rgba(0, 0, 0, 0.45); font-size: 12px">{{ formatTime(item.ts) }}</div>
                  </div>
                </a-timeline-item>
              </a-timeline>
            </a-card>
          </a-col>

          <a-col :xs="24" :xl="12">
            <a-card size="small" title="开放升级请求">
              <a-empty v-if="viewModel.escalations.length === 0" description="当前项目没有开放升级请求" />
              <a-list v-else :data-source="viewModel.escalations" size="small">
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta :title="item.reason" :description="`${item.taskTitle} · ${formatStageLabel(item.currentStageKey)} · ${formatTime(item.ts)}`" />
                    <template #actions>
                      <a-tag color="orange">{{ item.status || 'open' }}</a-tag>
                    </template>
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </a-col>
        </a-row>

        <a-card size="small" title="需人工关注的任务" style="margin-top: 16px">
          <a-empty v-if="viewModel.attentionTasks.length === 0" description="当前没有需要额外关注的任务" />
          <a-table v-else :data-source="viewModel.attentionTasks" :columns="attentionColumns" :pagination="false" row-key="taskId" size="small">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'task'">
                <a-space direction="vertical" :size="2">
                  <a-typography-text strong>{{ record.taskTitle }}</a-typography-text>
                  <a-typography-text type="secondary">{{ record.taskId }}</a-typography-text>
                </a-space>
              </template>
              <template v-else-if="column.key === 'stage'">
                <a-space direction="vertical" :size="2">
                  <a-tag>{{ record.currentStageLabel }}</a-tag>
                  <a-typography-text type="secondary">{{ record.currentStageStatus }}</a-typography-text>
                </a-space>
              </template>
              <template v-else-if="column.key === 'risk'">
                <a-space wrap>
                  <a-tag :color="workflowStatusColor(record.workflowStatus)">{{ record.workflowStatus }}</a-tag>
                  <a-tag v-if="record.openEscalationCount > 0" color="orange">升级 {{ record.openEscalationCount }}</a-tag>
                  <a-tag v-if="record.bossDecisionCount > 0" color="blue">决策 {{ record.bossDecisionCount }}</a-tag>
                </a-space>
                <div v-if="record.blockingReason" style="margin-top: 6px; color: #cf1322">{{ record.blockingReason }}</div>
              </template>
              <template v-else-if="column.key === 'latest'">
                <a-space direction="vertical" :size="2">
                  <a-typography-text>{{ record.latestDecisionType || '-' }}</a-typography-text>
                  <a-typography-text type="secondary">{{ formatTime(record.latestDecisionTs) }}</a-typography-text>
                </a-space>
              </template>
              <template v-else-if="column.key === 'actions'">
                <a-space wrap>
                  <a-button size="small" @click="router.push(`/tasks/${record.taskId}/operating-console`)">运行详情</a-button>
                  <a-button size="small" type="link" @click="router.push(`/tasks/${record.taskId}`)">任务详情</a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>

        <a-card size="small" title="人工覆盖历史" style="margin-top: 16px">
          <a-empty v-if="viewModel.overrideHistory.length === 0" description="当前项目还没有人工覆盖记录" />
          <a-list v-else :data-source="viewModel.overrideHistory" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #title>
                    <a-space wrap>
                      <strong>{{ item.taskTitle }}</strong>
                      <a-tag color="gold">{{ formatOverrideAction(item.overrideAction) }}</a-tag>
                      <a-tag>{{ formatStageLabel(item.currentStageKey) }}</a-tag>
                    </a-space>
                  </template>
                  <template #description>
                    <a-space direction="vertical" :size="4" style="width: 100%">
                      <span>{{ item.reason }}</span>
                      <span>变更: {{ formatModeSummary(item.previousMode) }} -> {{ formatModeSummary(item.nextMode) }}</span>
                      <span>执行人: {{ item.actorId || '未知' }} · {{ formatTime(item.ts) }}</span>
                    </a-space>
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a-button size="small" type="link" @click="router.push(`/tasks/${item.taskId}/operating-console`)">运行详情</a-button>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  getProjectBossOperationsView,
  type OperatingModeSelection,
  type ProjectBossOperationsView,
  toApiError,
} from "../lib/api";
import ProjectSectionNav from "../components/ProjectSectionNav.vue";

const route = useRoute();
const router = useRouter();
const projectId = String(route.params.projectId || "");

const loading = ref(true);
const loadError = ref("");
const viewModel = ref<ProjectBossOperationsView | null>(null);

const attentionColumns = [
  { title: "任务", key: "task" },
  { title: "当前阶段", key: "stage" },
  { title: "关注原因", key: "risk" },
  { title: "最近决策", key: "latest" },
  { title: "操作", key: "actions" },
];

function formatStageLabel(stageKey?: string | null) {
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
    case "verify":
      return "集成验证";
    case "release":
      return "发布执行";
    case "post-release":
      return "发布观察";
    case "retrospective":
      return "复盘沉淀";
    default:
      return stageKey || "未记录阶段";
  }
}

function workflowStatusColor(status?: string | null) {
  if (status === "blocked") return "red";
  if (status === "waiting-approval") return "orange";
  if (status === "completed") return "green";
  if (status === "failed") return "volcano";
  return "blue";
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}

function formatModeSummary(value?: OperatingModeSelection | null) {
  if (!value) return "未记录";
  return `${value.collaborationMode} / ${value.autopilotLevel} / ${value.bossParticipationMode}${value.selectedTemplateId ? ` / ${value.selectedTemplateId}` : ""}`;
}

function formatOverrideAction(value?: string | null) {
  if (value === "clear-override") return "恢复默认";
  if (value === "select-template") return "人工选模板";
  return "人工覆盖";
}

function formatTemplateDecisionSource(metadata?: Record<string, unknown>) {
  if (metadata?.source === "recommended-profile") return "场景推荐命中";
  if (metadata?.source === "project-preferred") return "项目偏好命中";
  return "";
}

function formatTemplateDecisionTrigger(metadata?: Record<string, unknown>) {
  if (metadata?.trigger === "startup") return "执行启动前";
  if (metadata?.trigger === "stage-blocked") return `阻断后二次治理`;
  if (metadata?.trigger === "stage-waiting-approval") return `升级后二次治理`;
  return "";
}

function formatSelectedTemplate(metadata?: Record<string, unknown>) {
  return typeof metadata?.selectedTemplateId === "string" && metadata.selectedTemplateId.trim()
    ? `模板 ${metadata.selectedTemplateId.trim()}`
    : "";
}

function formatTemplateDecisionReason(metadata?: Record<string, unknown>) {
  const parts: string[] = [];
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
    viewModel.value = await getProjectBossOperationsView(projectId);
  } catch (error) {
    loadError.value = toApiError(error)?.message || (error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>