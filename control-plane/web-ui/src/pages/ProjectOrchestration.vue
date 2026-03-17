<template>
  <div style="padding: 24px">
    <a-page-header
      :title="viewModel ? `${viewModel.project.name} / 介入编排` : '介入编排'"
      sub-title="统一解释模板阶段、角色能力、执行方法来源和 binding 命中情况"
      @back="$router.push(`/projects/${projectId}`)"
    />

    <ProjectSectionNav :project-id="projectId" active-key="orchestration" />

    <a-card size="small" title="组织运行入口" style="margin-bottom: 16px">
      <a-space wrap>
        <a-button type="primary" data-testid="open-project-operating-mode-from-orchestration" @click="router.push(`/projects/${projectId}/operating-mode`)">打开运行档位</a-button>
        <a-button data-testid="open-boss-operations-from-orchestration" @click="router.push(`/projects/${projectId}/boss-operations`)">老板经营视图</a-button>
      </a-space>
    </a-card>

    <a-spin :spinning="loading" style="display: block">
      <a-alert v-if="loadError" type="error" show-icon style="margin-bottom: 16px" :message="loadError" />
      <a-alert
        v-else-if="viewModel?.access.message"
        type="info"
        show-icon
        style="margin-bottom: 16px"
        :message="viewModel.access.message"
      />

      <template v-if="viewModel">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :lg="6">
            <a-card size="small" title="当前模板">
              <a-statistic :value="viewModel.currentTemplate?.name || '未绑定'" />
              <a-typography-paragraph type="secondary" style="margin: 8px 0 0">
                {{ viewModel.workflowTemplateId || '项目尚未绑定模板。' }}
              </a-typography-paragraph>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="6">
            <a-card size="small" title="候选模板">
              <a-statistic :value="candidateScenario?.template?.name || '未选择候选'" />
              <a-typography-paragraph type="secondary" style="margin: 8px 0 0">
                {{ candidateScenario?.template?.id || '切换预演只在选择候选模板后出现。' }}
              </a-typography-paragraph>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="6">
            <a-card size="small" title="角色能力">
              <a-descriptions :column="1" size="small" bordered>
                <a-descriptions-item label="角色总数">
                  {{ viewModel.roleCapabilities.length }}
                </a-descriptions-item>
                <a-descriptions-item label="项目定制">
                  {{ viewModel.roleCapabilities.filter((item) => Boolean(item.override)).length }}
                </a-descriptions-item>
                <a-descriptions-item label="项目接管">
                  {{ viewModel.roleCapabilities.filter((item) => item.mode === 'project-takeover').length }}
                </a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="6">
            <a-card size="small" title="当前说明">
              <a-descriptions :column="1" size="small" bordered>
                <a-descriptions-item label="查看源">
                  {{ stageSourceLabel }}
                </a-descriptions-item>
                <a-descriptions-item label="已选阶段">
                  {{ selectedStage?.name || selectedStage?.stageKey || '未选择' }}
                </a-descriptions-item>
                <a-descriptions-item label="介入角色数">
                  {{ selectedStage?.roleMatrix.length || 0 }}
                </a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>
        </a-row>

        <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
          <a-col :xs="24" :lg="10">
            <a-card size="small" title="切换预演">
              <a-form layout="vertical">
                <a-form-item label="选择候选模板">
                  <a-select
                    :value="selectedTemplateId"
                    allow-clear
                    placeholder="选择后将预演候选模板的介入编排"
                    @update:value="handleCandidateTemplateChange($event)"
                  >
                    <a-select-option v-for="template in viewModel.selectableTemplates" :key="template.id" :value="template.id">
                      {{ template.name }}
                    </a-select-option>
                  </a-select>
                </a-form-item>
                <a-space>
                  <a-button type="primary" :loading="saving" :disabled="!viewModel.access.canManage" @click="saveBinding">
                    保存为项目模板
                  </a-button>
                  <a-button :disabled="saving" @click="resetCandidateSelection">
                    回到当前绑定
                  </a-button>
                </a-space>
              </a-form>

              <a-alert
                v-if="selectionDiff"
                type="info"
                show-icon
                style="margin-top: 12px"
                :message="selectionDiff.summary"
                :description="selectionDiff.description"
              />
            </a-card>
          </a-col>

          <a-col :xs="24" :lg="14">
            <a-card size="small" title="统一编排图">
              <a-space style="margin-bottom: 12px" wrap>
                <a-radio-group :value="diagramKind" button-style="solid" size="small" @update:value="diagramKind = String($event ?? 'flow')">
                  <a-radio-button value="flow">阶段流转图</a-radio-button>
                  <a-radio-button value="roles">角色介入图</a-radio-button>
                </a-radio-group>
                <a-radio-group :value="stageSource" button-style="solid" size="small" @update:value="handleStageSourceChange(String($event ?? 'current'))">
                  <a-radio-button value="current">当前绑定</a-radio-button>
                  <a-radio-button value="candidate" :disabled="!candidateScenario">候选模板</a-radio-button>
                </a-radio-group>
              </a-space>
              <MermaidRenderer :code="activeDiagramMermaid" />
            </a-card>
          </a-col>
        </a-row>

        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="8">
            <a-card size="small">
              <template #title>阶段轨道</template>
              <template #extra>
                <a-space :size="8">
                  <span style="font-size: 12px; color: rgba(0, 0, 0, 0.45)">只看异常阶段</span>
                  <a-switch :checked="anomalyOnly" size="small" :disabled="stageSource !== 'current'" @update:checked="handleAnomalyOnlyChange" />
                </a-space>
              </template>
              <a-space direction="vertical" style="width: 100%" :size="12">
                <a-empty
                  v-if="visibleStages.length === 0"
                  :description="anomalyOnly && stageSource === 'current' ? '当前没有最近命中 Gate / Approval / Block 的异常阶段' : '当前没有可解释的阶段'"
                />
                <a-card
                  v-for="stage in visibleStages"
                  :key="stage.id"
                  size="small"
                  :style="selectedStage?.id === stage.id ? selectedStageCardStyle : clickableStageCardStyle"
                  @click="selectedStageKey = stage.stageKey"
                >
                  <a-space direction="vertical" :size="2" style="width: 100%">
                    <a-space style="justify-content: space-between; width: 100%">
                      <a-typography-text strong>{{ stage.name || stage.stageKey }}</a-typography-text>
                      <a-tag :color="stage.enabled ? 'green' : 'default'">{{ stage.enabled ? '启用' : '停用' }}</a-tag>
                    </a-space>
                    <a-typography-text type="secondary">{{ stage.stageKey }} · 主责 {{ stage.primaryRoleLabel }}</a-typography-text>
                    <a-space wrap>
                      <a-tag>{{ stage.mode }}</a-tag>
                      <a-tag>参与 {{ stage.participantRoleAgentIdsJson.length }}</a-tag>
                      <a-tag>Gate {{ stage.gatesJson?.length || 0 }}</a-tag>
                      <a-tag>Approval {{ stage.approvalsJson?.length || 0 }}</a-tag>
                      <a-tag v-if="stage.runtimeSummary?.blockedCount" color="red">阻断 {{ stage.runtimeSummary.blockedCount }}</a-tag>
                      <a-tag v-if="stage.runtimeSummary?.waitingApprovalCount" color="orange">待审批 {{ stage.runtimeSummary.waitingApprovalCount }}</a-tag>
                      <a-tag v-if="stage.runtimeSummary?.openChangeRequestCount" color="gold">待修正 {{ stage.runtimeSummary.openChangeRequestCount }}</a-tag>
                    </a-space>
                  </a-space>
                </a-card>
              </a-space>
            </a-card>
          </a-col>

          <a-col :xs="24" :lg="16">
            <a-card size="small" title="阶段角色介入矩阵" style="margin-bottom: 16px">
              <a-empty v-if="!selectedStage" description="当前没有可解释的阶段" />
              <template v-else>
                <a-alert
                  type="info"
                  show-icon
                  style="margin-bottom: 12px"
                  :message="`${selectedStage.name || selectedStage.stageKey} · 主责 ${selectedStage.primaryRoleLabel}`"
                  :description="stageExplanation(selectedStage)"
                />

                <a-card v-if="selectedStage.runtimeSummary && stageSource === 'current'" size="small" style="margin-bottom: 12px" title="实际运行态">
                  <a-descriptions :column="2" size="small" bordered>
                    <a-descriptions-item label="命中过任务">{{ selectedStage.runtimeSummary.totalTasks }}</a-descriptions-item>
                    <a-descriptions-item label="进行中">{{ selectedStage.runtimeSummary.runningCount }}</a-descriptions-item>
                    <a-descriptions-item label="已阻断">{{ selectedStage.runtimeSummary.blockedCount }}</a-descriptions-item>
                    <a-descriptions-item label="待审批">{{ selectedStage.runtimeSummary.waitingApprovalCount }}</a-descriptions-item>
                    <a-descriptions-item label="已完成">{{ selectedStage.runtimeSummary.completedCount }}</a-descriptions-item>
                    <a-descriptions-item label="失败">{{ selectedStage.runtimeSummary.failedCount }}</a-descriptions-item>
                    <a-descriptions-item label="阻断结论">{{ selectedStage.runtimeSummary.blockDecisionCount }}</a-descriptions-item>
                    <a-descriptions-item label="审批结论">{{ selectedStage.runtimeSummary.approvalDecisionCount }}</a-descriptions-item>
                    <a-descriptions-item label="待修正">{{ selectedStage.runtimeSummary.openChangeRequestCount }}</a-descriptions-item>
                    <a-descriptions-item label="阻断修正项">{{ selectedStage.runtimeSummary.blockingChangeRequestCount }}</a-descriptions-item>
                  </a-descriptions>
                  <a-alert
                    v-if="selectedStage.runtimeSummary.latestTask"
                    type="info"
                    show-icon
                    style="margin-top: 12px"
                    :message="`最近任务：${selectedStage.runtimeSummary.latestTask.title}`"
                    :description="latestTaskDescription(selectedStage)"
                  />
                </a-card>
                <a-alert
                  v-else-if="stageSource === 'candidate'"
                  type="info"
                  show-icon
                  style="margin-bottom: 12px"
                  message="候选模板暂无实际运行态，只展示当前配置命中逻辑。"
                />

                <a-empty v-if="selectedStage.roleMatrix.length === 0" description="当前阶段没有解析到角色介入规则" />
                <a-space v-else direction="vertical" style="width: 100%" :size="10">
                  <a-card v-for="item in selectedStage.roleMatrix" :key="item.roleAgentId" size="small">
                    <a-flex justify="space-between" align="flex-start" :gap="12">
                      <div>
                        <div><strong>{{ item.roleLabel }}</strong></div>
                        <a-typography-text type="secondary">
                          {{ item.involvementKinds.join(' / ') }} · {{ item.executionModeLabel }} · {{ item.projectModeLabel }}
                        </a-typography-text>
                      </div>
                      <a-space wrap>
                        <a-tag :color="riskColor(item.riskLevel)">{{ item.riskLevel }}</a-tag>
                        <a-tag :color="item.stageCovered ? 'green' : 'red'">{{ item.stageCovered ? '阶段覆盖' : '阶段不匹配' }}</a-tag>
                      </a-space>
                    </a-flex>

                    <a-descriptions :column="1" size="small" bordered style="margin-top: 8px">
                      <a-descriptions-item label="执行方法来源">
                        {{ item.executionMethodSourceLabel }}
                      </a-descriptions-item>
                      <a-descriptions-item label="命中原因">
                        {{ item.bindingResolution.sourceReason }}
                      </a-descriptions-item>
                      <a-descriptions-item label="影响说明">
                        {{ item.impactSummary }}
                      </a-descriptions-item>
                      <a-descriptions-item label="触发依据">
                        <a-space v-if="item.reasons.length > 0" direction="vertical" :size="4" style="width: 100%">
                          <span v-for="reason in item.reasons" :key="`${item.roleAgentId}-${reason}`">
                            {{ reason }}
                          </span>
                        </a-space>
                        <span v-else>当前没有额外 Gate / Approval / 回退触发说明。</span>
                      </a-descriptions-item>
                    </a-descriptions>

                    <div style="margin-top: 8px">
                      <a-typography-text strong>命中执行器</a-typography-text>
                      <a-empty v-if="item.bindingResolution.activeBindings.length === 0" description="没有命中可用执行器" />
                      <a-space v-else wrap style="margin-top: 6px">
                        <a-tag v-for="binding in item.bindingResolution.activeBindings" :key="binding.id" :color="binding.source === 'project' ? 'blue' : 'green'">
                          {{ binding.label }} · {{ binding.runtimeAgent }} · P{{ binding.priority }}
                        </a-tag>
                      </a-space>
                    </div>

                    <div style="margin-top: 8px" v-if="item.bindingResolution.standbyBindings.length > 0">
                      <a-typography-text type="secondary">
                        备用候选：{{ item.bindingResolution.standbyBindings.map((binding) => binding.label).join(' / ') }}
                      </a-typography-text>
                    </div>

                    <a-alert
                      v-for="warning in item.warnings"
                      :key="`${item.roleAgentId}-${warning}`"
                      type="warning"
                      show-icon
                      style="margin-top: 8px"
                      :message="warning"
                    />
                  </a-card>
                </a-space>
              </template>
            </a-card>

            <a-card size="small" title="角色能力基线">
              <a-table :data-source="viewModel.roleCapabilities" row-key="role.id" size="small" :pagination="false">
                <a-table-column title="角色" key="role">
                  <template #default="{ record }">
                    <a-space direction="vertical" :size="2">
                      <span>{{ record.role.name }}</span>
                      <a-typography-text type="secondary">{{ record.role.id }}</a-typography-text>
                    </a-space>
                  </template>
                </a-table-column>
                <a-table-column title="项目模式" key="mode">
                  <template #default="{ record }">
                    {{ record.projectModeLabel }}
                  </template>
                </a-table-column>
                <a-table-column title="执行方式" key="executionMode">
                  <template #default="{ record }">
                    {{ record.executionModeLabel }}
                  </template>
                </a-table-column>
                <a-table-column title="Binding" key="bindings">
                  <template #default="{ record }">
                    系统 {{ record.bindingCounts.system }} / 项目 {{ record.bindingCounts.project }}
                  </template>
                </a-table-column>
                <a-table-column title="生效阶段" key="stages">
                  <template #default="{ record }">
                    {{ record.effectiveStages.join(' / ') || '未限制' }}
                  </template>
                </a-table-column>
              </a-table>
            </a-card>
          </a-col>
        </a-row>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type OrchestrationStageViewModel,
  type ProjectOrchestrationView,
  getProjectOrchestrationView,
  updateProjectWorkflowTemplateBinding,
} from "../lib/api";

const MermaidRenderer = defineAsyncComponent(() => import("../components/MermaidRenderer.vue"));

const route = useRoute();
const router = useRouter();
const projectId = String(route.params.projectId || "");

const loading = ref(true);
const saving = ref(false);
const loadError = ref<string | null>(null);
const viewModel = ref<ProjectOrchestrationView | null>(null);
const selectedTemplateId = ref<string | undefined>(undefined);
const diagramKind = ref("flow");
const stageSource = ref("current");
const selectedStageKey = ref("");
const anomalyOnly = ref(false);

const selectedStageCardStyle = {
  border: "1px solid #1677ff",
  background: "rgba(22, 119, 255, 0.06)",
  cursor: "pointer",
};

const clickableStageCardStyle = {
  cursor: "pointer",
};

function toTemplateId(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function sanitizeMermaidLabel(value: string) {
  return value
    .replace(/"/g, "'")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\|/g, "/")
    .trim();
}

function riskColor(level: string) {
  const map: Record<string, string> = {
    low: "green",
    medium: "orange",
    high: "red",
    critical: "magenta",
  };
  return map[level] || "default";
}

function normalizeFallbackStage(stage: OrchestrationStageViewModel) {
  const policy =
    stage.failurePolicyJson && typeof stage.failurePolicyJson === "object"
      ? (stage.failurePolicyJson as Record<string, unknown>)
      : null;
  const fallback = policy?.fallbackStageKey;
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : "";
}

function buildFlowMermaid(stages: OrchestrationStageViewModel[]) {
  if (stages.length === 0) {
    return "";
  }

  const ordered = [...stages].sort((left, right) => left.orderIndex - right.orderIndex);
  const lines = [
    "flowchart TD",
    "classDef active fill:#d9f7be,stroke:#389e0d,color:#135200;",
    "classDef muted fill:#f5f5f5,stroke:#bfbfbf,color:#595959;",
  ];

  for (const [index, stage] of ordered.entries()) {
    const nodeId = `stage_${index + 1}`;
    const label = sanitizeMermaidLabel(
      [
        `${index + 1}. ${stage.name || stage.stageKey}`,
        `${stage.stageKey} / ${stage.primaryRoleLabel}`,
        `参与 ${stage.participantRoleAgentIdsJson.length} / Gate ${stage.gatesJson?.length || 0} / Approval ${stage.approvalsJson?.length || 0}`,
      ].join("\\n"),
    );
    lines.push(`${nodeId}[\"${label}\"]`);
    lines.push(`class ${nodeId} ${stage.enabled ? "active" : "muted"};`);
    if (index > 0) {
      lines.push(`stage_${index} --> ${nodeId}`);
    }
    const fallbackStageKey = normalizeFallbackStage(stage);
    if (fallbackStageKey) {
      const fallbackIndex = ordered.findIndex((item) => item.stageKey === fallbackStageKey);
      if (fallbackIndex >= 0) {
        lines.push(`${nodeId} -. fallback .-> stage_${fallbackIndex + 1}`);
      }
    }
  }

  return lines.join("\n");
}

function buildRoleMapMermaid(stages: OrchestrationStageViewModel[]) {
  if (stages.length === 0) {
    return "";
  }

  const ordered = [...stages].sort((left, right) => left.orderIndex - right.orderIndex);
  const lines = [
    "flowchart LR",
    "classDef stage fill:#e6f4ff,stroke:#1677ff,color:#003a8c;",
    "classDef role fill:#fff7e6,stroke:#fa8c16,color:#873800;",
    "classDef control fill:#fff1f0,stroke:#cf1322,color:#820014;",
  ];

  for (const [index, stage] of ordered.entries()) {
    const stageNodeId = `stage_${index + 1}`;
    lines.push(
      `${stageNodeId}[\"${sanitizeMermaidLabel(`${stage.name || stage.stageKey}\\n${stage.stageKey}`)}\"]`,
    );
    lines.push(`class ${stageNodeId} stage;`);

    for (const [roleIndex, roleItem] of stage.roleMatrix.entries()) {
      const roleNodeId = `role_${index + 1}_${roleIndex + 1}`;
      const bindingHint = roleItem.bindingResolution.activeBindings[0]?.label || "无命中执行器";
      lines.push(
        `${roleNodeId}[\"${sanitizeMermaidLabel(`${roleItem.roleLabel}\\n${roleItem.involvementKinds.join("/") || "参与"}\\n${bindingHint}`)}\"]`,
      );
      lines.push(`${stageNodeId} --> ${roleNodeId}`);
      lines.push(`class ${roleNodeId} role;`);

      for (const [reasonIndex, reason] of roleItem.reasons.entries()) {
        const reasonNodeId = `reason_${index + 1}_${roleIndex + 1}_${reasonIndex + 1}`;
        lines.push(`${reasonNodeId}[\"${sanitizeMermaidLabel(reason)}\"]`);
        lines.push(`${roleNodeId} -.-> ${reasonNodeId}`);
        lines.push(`class ${reasonNodeId} control;`);
      }
    }
  }

  return lines.join("\n");
}

const candidateScenario = computed(() => viewModel.value?.scenarios.candidate || null);

const stageSourceLabel = computed(() =>
  stageSource.value === "candidate" && candidateScenario.value ? "候选模板" : "当前绑定",
);

const activeScenario = computed(() => {
  if (stageSource.value === "candidate" && candidateScenario.value) {
    return candidateScenario.value;
  }
  return viewModel.value?.scenarios.current || { source: "current", template: null, stages: [] };
});

const visibleStages = computed(() => {
  if (stageSource.value !== "current" || !anomalyOnly.value) {
    return activeScenario.value.stages;
  }

  return activeScenario.value.stages.filter(hasRuntimeAnomaly);
});

const selectedStage = computed(
  () =>
    visibleStages.value.find((stage) => stage.stageKey === selectedStageKey.value) ||
    visibleStages.value[0] ||
    null,
);

const activeDiagramMermaid = computed(() =>
  diagramKind.value === "roles"
    ? buildRoleMapMermaid(visibleStages.value)
    : buildFlowMermaid(visibleStages.value),
);

const selectionDiff = computed(() => {
  if (!viewModel.value || !candidateScenario.value) {
    return null;
  }

  const currentStages = viewModel.value.scenarios.current.stages;
  const nextStages = candidateScenario.value.stages;
  const currentOrder = currentStages.map((stage) => stage.stageKey);
  const nextOrder = nextStages.map((stage) => stage.stageKey);
  const currentSet = new Set(currentOrder);
  const nextSet = new Set(nextOrder);
  const added = nextOrder.filter((stageKey) => !currentSet.has(stageKey));
  const removed = currentOrder.filter((stageKey) => !nextSet.has(stageKey));
  const gateChanges = nextStages
    .map((stage) => {
      const current = currentStages.find((item) => item.stageKey === stage.stageKey);
      const currentCount = current?.gatesJson?.length || 0;
      const nextCount = stage.gatesJson?.length || 0;
      return currentCount === nextCount
        ? null
        : `${stage.stageKey} ${currentCount} -> ${nextCount}`;
    })
    .filter((item): item is string => Boolean(item));
  const approvalChanges = nextStages
    .map((stage) => {
      const current = currentStages.find((item) => item.stageKey === stage.stageKey);
      const currentCount = current?.approvalsJson?.length || 0;
      const nextCount = stage.approvalsJson?.length || 0;
      return currentCount === nextCount
        ? null
        : `${stage.stageKey} ${currentCount} -> ${nextCount}`;
    })
    .filter((item): item is string => Boolean(item));

  return {
    summary: `准备从 ${viewModel.value.currentTemplate?.name || "未绑定"} 切换到 ${candidateScenario.value.template?.name || selectedTemplateId.value}。`,
    description: `目标模板包含 ${nextOrder.length} 个阶段，新增 ${added.length} 个，移除 ${removed.length} 个。Gate 变化 ${gateChanges.join(" / ") || "无"}；Approval 变化 ${approvalChanges.join(" / ") || "无"}。`,
  };
});

function stageExplanation(stage: OrchestrationStageViewModel) {
  return `参与角色 ${stage.participantRoleAgentIdsJson.length} 个，Gate ${stage.gatesJson?.length || 0} 个，Approval ${stage.approvalsJson?.length || 0} 个。`;
}

function latestTaskDescription(stage: OrchestrationStageViewModel) {
  const latestTask = stage.runtimeSummary?.latestTask;
  if (!latestTask) {
    return "暂无最近任务记录。";
  }

  const details = [
    `任务 ${latestTask.taskId}`,
    `流程 ${latestTask.workflowStatus}`,
    `阶段 ${latestTask.stageStatus}`,
  ];
  if (latestTask.approvalState && latestTask.approvalState !== "not-required") {
    details.push(`审批 ${latestTask.approvalState}`);
  }
  if (latestTask.blockingReason) {
    details.push(latestTask.blockingReason);
  }
  return details.join(" · ");
}

function hasRuntimeAnomaly(stage: OrchestrationStageViewModel) {
  const summary = stage.runtimeSummary;
  if (!summary) {
    return false;
  }

  return (
    summary.blockedCount > 0 ||
    summary.waitingApprovalCount > 0 ||
    summary.blockDecisionCount > 0 ||
    summary.approvalDecisionCount > 0
  );
}

async function loadView(candidateTemplateId?: string) {
  viewModel.value = await getProjectOrchestrationView(projectId, candidateTemplateId);
  selectedTemplateId.value = candidateTemplateId || viewModel.value.workflowTemplateId || undefined;
  stageSource.value =
    candidateTemplateId && viewModel.value.scenarios.candidate ? "candidate" : "current";
  if (stageSource.value !== "current") {
    anomalyOnly.value = false;
  }
  selectedStageKey.value =
    visibleStages.value[0]?.stageKey || activeScenario.value.stages[0]?.stageKey || "";
}

async function handleCandidateTemplateChange(value: unknown) {
  const nextTemplateId = toTemplateId(value);
  if (!nextTemplateId || nextTemplateId === viewModel.value?.workflowTemplateId) {
    await loadView();
    return;
  }
  loading.value = true;
  try {
    await loadView(nextTemplateId);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "候选模板预演加载失败";
  } finally {
    loading.value = false;
  }
}

async function resetCandidateSelection() {
  loading.value = true;
  try {
    await loadView();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "恢复当前绑定失败";
  } finally {
    loading.value = false;
  }
}

function handleStageSourceChange(value: string) {
  stageSource.value = value === "candidate" && candidateScenario.value ? "candidate" : "current";
  if (stageSource.value !== "current") {
    anomalyOnly.value = false;
  }
  selectedStageKey.value =
    visibleStages.value[0]?.stageKey || activeScenario.value.stages[0]?.stageKey || "";
}

function handleAnomalyOnlyChange(checked: unknown) {
  anomalyOnly.value = checked === true;
  selectedStageKey.value = visibleStages.value[0]?.stageKey || "";
}

async function saveBinding() {
  saving.value = true;
  try {
    await updateProjectWorkflowTemplateBinding(projectId, {
      workflowTemplateId: selectedTemplateId.value || null,
    });
    await loadView();
    message.success(selectedTemplateId.value ? "项目模板绑定已更新" : "项目模板已解绑");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "项目模板保存失败");
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    await loadView();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "介入编排视图加载失败";
  } finally {
    loading.value = false;
  }
});
</script>
