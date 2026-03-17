<template>
  <div style="padding: 24px">
    <a-page-header
      :title="viewModel ? `${viewModel.project.name} / 工作流` : '项目工作流'"
      sub-title="查看并绑定当前项目采用的阶段模板"
      @back="$router.push(`/projects/${projectId}`)"
    />

    <ProjectSectionNav :project-id="projectId" active-key="workflow" />

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
          <a-col :xs="24" :lg="10">
            <a-card size="small" title="当前模板摘要">
              <a-descriptions :column="1" size="small" bordered>
                <a-descriptions-item label="当前绑定模板">
                  {{ viewModel.currentTemplate?.name || '尚未绑定' }}
                </a-descriptions-item>
                <a-descriptions-item label="绑定模板 ID">
                  {{ viewModel.workflowTemplateId || '未绑定' }}
                </a-descriptions-item>
                <a-descriptions-item label="模板来源">
                  {{ viewModel.currentTemplateSource === 'bound' ? '项目已绑定' : '项目未绑定' }}
                </a-descriptions-item>
                <a-descriptions-item label="可选模板数">
                  {{ viewModel.selectableTemplates.length }}
                </a-descriptions-item>
                <a-descriptions-item label="老板自动切模板">
                  {{ viewModel.projectSettings.allowBossAutoTemplateSwitch ? '已开启' : '未开启' }}
                </a-descriptions-item>
                <a-descriptions-item label="项目偏好模板">
                  {{ viewModel.projectSettings.preferredTemplateId || '未设置' }}
                </a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>

          <a-col :xs="24" :lg="14">
            <a-card size="small" title="模板绑定与治理授权">
              <a-form layout="vertical">
                <a-row :gutter="16">
                  <a-col :xs="24" :md="12">
                    <a-form-item label="选择项目模板">
                      <a-select
                        :value="selectedTemplateId"
                        allow-clear
                        :disabled="!viewModel.access.canManage"
                        placeholder="未绑定时，任务不会使用项目级阶段模板"
                        @update:value="selectedTemplateId = toTemplateId($event)"
                      >
                        <a-select-option v-for="template in viewModel.selectableTemplates" :key="template.id" :value="template.id">
                          {{ template.name }}
                        </a-select-option>
                      </a-select>
                    </a-form-item>
                  </a-col>
                  <a-col :xs="24" :md="12">
                    <a-form-item label="项目偏好模板">
                      <a-select
                        :value="preferredTemplateId"
                        allow-clear
                        :disabled="!viewModel.access.canManage"
                        placeholder="未设置时沿用项目当前绑定模板"
                        @update:value="preferredTemplateId = toTemplateId($event)"
                      >
                        <a-select-option v-for="template in viewModel.selectableTemplates" :key="template.id" :value="template.id">
                          {{ template.name }}
                        </a-select-option>
                      </a-select>
                    </a-form-item>
                  </a-col>
                </a-row>
                <a-form-item label="老板自动切模板">
                  <a-checkbox
                    :checked="allowBossAutoTemplateSwitch"
                    :disabled="!viewModel.access.canManage"
                    @update:checked="allowBossAutoTemplateSwitch = Boolean($event)"
                  >
                    允许老板在治理授权范围内自动写入 select-template 决策并切换任务模板
                  </a-checkbox>
                </a-form-item>
                <a-space>
                  <a-button
                    type="primary"
                    :loading="saving"
                    :disabled="!viewModel.access.canManage"
                    @click="saveBinding"
                  >
                    保存绑定
                  </a-button>
                  <a-button :disabled="saving || !viewModel.access.canManage" @click="selectedTemplateId = undefined">
                    解绑
                  </a-button>
                </a-space>
              </a-form>
            </a-card>
          </a-col>
        </a-row>

        <a-card size="small" title="模板级组织策略" style="margin-bottom: 16px">
          <a-descriptions :column="2" size="small" bordered>
            <a-descriptions-item label="默认协作模式">
              {{ viewModel.currentTemplatePolicy?.defaultCollaborationMode || '未配置' }}
            </a-descriptions-item>
            <a-descriptions-item label="默认自动托管等级">
              {{ viewModel.currentTemplatePolicy?.defaultAutopilotLevel || '未配置' }}
            </a-descriptions-item>
            <a-descriptions-item label="默认老板参与方式">
              {{ viewModel.currentTemplatePolicy?.defaultBossParticipationMode || '未配置' }}
            </a-descriptions-item>
            <a-descriptions-item label="是否强制老板参与">
              {{ viewModel.currentTemplatePolicy?.forceBossParticipation ? '是' : '否' }}
            </a-descriptions-item>
          </a-descriptions>
          <a-typography-paragraph type="secondary" style="margin: 12px 0 0">
            当老板自动切模板开启后，select-template 决策会优先采用这里定义的默认档位，并在强制老板参与时提升为 full-manager。
          </a-typography-paragraph>
        </a-card>

        <a-card v-if="selectionDiff" size="small" title="切换前差异摘要" style="margin-bottom: 16px">
          <a-space direction="vertical" style="width: 100%" :size="10">
            <a-alert
              type="info"
              show-icon
              :message="selectionDiff.summary"
              :description="selectionDiff.description"
            />
            <a-row :gutter="16">
              <a-col :xs="24" :md="12">
                <a-card size="small" title="阶段变化">
                  <a-space direction="vertical" style="width: 100%" :size="6">
                    <a-typography-text>新增阶段：{{ selectionDiff.added.join(' / ') || '无' }}</a-typography-text>
                    <a-typography-text>移除阶段：{{ selectionDiff.removed.join(' / ') || '无' }}</a-typography-text>
                    <a-typography-text>顺序变化：{{ selectionDiff.reordered.join(' / ') || '无' }}</a-typography-text>
                  </a-space>
                </a-card>
              </a-col>
              <a-col :xs="24" :md="12">
                <a-card size="small" title="关键控制变化">
                  <a-space direction="vertical" style="width: 100%" :size="6">
                    <a-typography-text>
                      Gate 变化：{{ selectionDiff.gateChanges.join(' / ') || '无' }}
                    </a-typography-text>
                    <a-typography-text>
                      Approval 变化：{{ selectionDiff.approvalChanges.join(' / ') || '无' }}
                    </a-typography-text>
                  </a-space>
                </a-card>
              </a-col>
            </a-row>
          </a-space>
        </a-card>

        <a-card size="small" title="流程可视化" style="margin-bottom: 16px">
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 12px"
            message="这里直接展示阶段流转和主责角色，便于在绑定前比较当前模板与候选模板会怎么跑。"
          />

          <a-radio-group
            :value="diagramKind"
            button-style="solid"
            size="small"
            style="margin-bottom: 12px"
            @update:value="diagramKind = String($event ?? 'flow')"
          >
            <a-radio-button value="flow">阶段流转图</a-radio-button>
            <a-radio-button value="roles">角色介入图</a-radio-button>
          </a-radio-group>

          <a-tabs :activeKey="diagramTab" :destroyInactiveTabPane="true" @update:activeKey="diagramTab = String($event ?? 'current')">
            <a-tab-pane key="current" :tab="currentDiagramTitle">
              <MermaidRenderer v-if="diagramTab === 'current'" :code="currentDiagramMermaid" />
            </a-tab-pane>
            <a-tab-pane v-if="showCandidateDiagram" key="candidate" :tab="candidateDiagramTitle">
              <MermaidRenderer v-if="diagramTab === 'candidate'" :code="candidateDiagramMermaid" />
            </a-tab-pane>
          </a-tabs>
        </a-card>

        <a-card size="small" title="阶段路径">
          <a-empty v-if="viewModel.stages.length === 0" description="当前项目未绑定模板，暂无阶段路径" />
          <template v-else>
            <a-space wrap>
                <a-tag v-for="stage in viewModel.stages" :key="stage.id" color="blue">
                  {{ stage.stageKey }}
                </a-tag>
            </a-space>
            <a-typography-paragraph type="secondary" style="margin: 12px 0 0">
              当前展示的是项目真实绑定模板下的阶段定义，不再使用临时预览模板。
            </a-typography-paragraph>
          </template>
        </a-card>

        <a-card size="small" title="可选模板列表">
          <a-table :data-source="viewModel.selectableTemplates" row-key="id" size="small" :pagination="false">
            <a-table-column title="模板" key="name">
              <template #default="{ record }">
                <a-space direction="vertical" :size="2">
                  <span>{{ record.name }}</span>
                  <a-typography-text type="secondary">{{ record.id }}</a-typography-text>
                </a-space>
              </template>
            </a-table-column>
            <a-table-column title="阶段顺序" key="stageOrder">
              <template #default="{ record }">
                {{ record.stageOrderJson.join(' -> ') || '未配置' }}
              </template>
            </a-table-column>
            <a-table-column title="状态" key="status" :width="180">
              <template #default="{ record }">
                <a-space>
                  <a-tag :color="record.enabled ? 'green' : 'default'">{{ record.enabled ? '启用' : '停用' }}</a-tag>
                  <a-tag :color="record.selectableByProjects ? 'blue' : 'default'">
                    {{ record.selectableByProjects ? '项目可选' : '仅系统' }}
                  </a-tag>
                </a-space>
              </template>
            </a-table-column>
            <a-table-column title="操作" key="actions" :width="140">
              <template #default="{ record }">
                <a-space>
                  <router-link :to="{ name: 'WorkflowTemplateEditor', params: { templateId: record.id } }">
                    <a-button size="small">查看模板</a-button>
                  </router-link>
                  <a-tag v-if="record.id === viewModel.workflowTemplateId" color="green">已绑定</a-tag>
                </a-space>
              </template>
            </a-table-column>
          </a-table>
        </a-card>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, defineAsyncComponent, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  type ProjectWorkflowTemplateView,
  getProjectWorkflowTemplateView,
  listWorkflowTemplateStages,
  updateProjectWorkflowTemplateBinding,
} from "../lib/api";

const MermaidRenderer = defineAsyncComponent(() => import("../components/MermaidRenderer.vue"));

const route = useRoute();
const projectId = String(route.params.projectId);
const loading = ref(true);
const saving = ref(false);
const diagramTab = ref("current");
const diagramKind = ref("flow");
const loadError = ref<string | null>(null);
const viewModel = ref<ProjectWorkflowTemplateView | null>(null);
const selectedTemplateId = ref<string | undefined>(undefined);
const preferredTemplateId = ref<string | undefined>(undefined);
const allowBossAutoTemplateSwitch = ref(false);
const selectedTemplateStages = ref<ProjectWorkflowTemplateView["stages"]>([]);
const loadingSelectionDiff = ref(false);

const roleLabelMap: Record<string, string> = {
  "role.product": "产品 Agent",
  "role.architect": "架构师 Agent",
  "role.developer": "开发者 Agent",
  "role.visual": "美术 Agent",
  "role.security": "安全 Agent",
  "role.release": "部署 Agent",
  "role.operations": "运维 Agent",
  "role.qa": "QA Agent",
};

function toTemplateId(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function loadViewModel() {
  viewModel.value = await getProjectWorkflowTemplateView(projectId);
  selectedTemplateId.value = viewModel.value.workflowTemplateId || undefined;
  preferredTemplateId.value = viewModel.value.projectSettings.preferredTemplateId || undefined;
  allowBossAutoTemplateSwitch.value = viewModel.value.projectSettings.allowBossAutoTemplateSwitch;
  selectedTemplateStages.value = [...viewModel.value.stages];
  diagramTab.value = "current";
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

function resolveRoleLabel(roleAgentId: string) {
  return roleLabelMap[roleAgentId] || roleAgentId || "未指定角色";
}

function normalizeFallbackStage(stage: ProjectWorkflowTemplateView["stages"][number]) {
  const policy =
    stage.failurePolicyJson && typeof stage.failurePolicyJson === "object"
      ? (stage.failurePolicyJson as Record<string, unknown>)
      : null;
  const fallback = policy?.fallbackStageKey;
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : "";
}

function getOrderedWorkflowStages(stages: ProjectWorkflowTemplateView["stages"]) {
  return [...stages].sort((left, right) => left.orderIndex - right.orderIndex);
}

function getStageNodeId(index: number) {
  return `stage_${index + 1}`;
}

function getStageStatCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function buildFlowStageLabel(stage: ProjectWorkflowTemplateView["stages"][number], index: number) {
  const gateCount = getStageStatCount(stage.gatesJson);
  const approvalCount = getStageStatCount(stage.approvalsJson);
  const participantCount = getStageStatCount(stage.participantRoleAgentIdsJson);

  return sanitizeMermaidLabel(
    [
      `${index + 1}. ${stage.name || stage.stageKey}`,
      `${stage.stageKey} / ${resolveRoleLabel(stage.primaryRoleAgentId)}`,
      `参与 ${participantCount} / Gate ${gateCount} / Approval ${approvalCount}`,
    ].join("\\n"),
  );
}

function appendFlowFallback(
  lines: string[],
  ordered: ProjectWorkflowTemplateView["stages"],
  nodeId: string,
  stage: ProjectWorkflowTemplateView["stages"][number],
) {
  const fallbackStageKey = normalizeFallbackStage(stage);
  if (!fallbackStageKey) {
    return;
  }

  const fallbackIndex = ordered.findIndex((item) => item.stageKey === fallbackStageKey);
  if (fallbackIndex >= 0) {
    lines.push(`${nodeId} -. fallback .-> ${getStageNodeId(fallbackIndex)}`);
  }
}

function appendFlowStage(
  lines: string[],
  ordered: ProjectWorkflowTemplateView["stages"],
  stage: ProjectWorkflowTemplateView["stages"][number],
  index: number,
) {
  const nodeId = getStageNodeId(index);
  const label = buildFlowStageLabel(stage, index);

  lines.push(`${nodeId}["${label}"]`);
  lines.push(`class ${nodeId} ${stage.enabled ? "active" : "muted"};`);

  if (index > 0) {
    lines.push(`${getStageNodeId(index - 1)} --> ${nodeId}`);
  }

  appendFlowFallback(lines, ordered, nodeId, stage);
}

function buildFlowMermaid(stages: ProjectWorkflowTemplateView["stages"]) {
  if (stages.length === 0) {
    return "";
  }

  const ordered = getOrderedWorkflowStages(stages);
  const lines = [
    "flowchart TD",
    "classDef active fill:#d9f7be,stroke:#389e0d,color:#135200;",
    "classDef muted fill:#f5f5f5,stroke:#bfbfbf,color:#595959;",
  ];

  for (const [index, stage] of ordered.entries()) {
    appendFlowStage(lines, ordered, stage, index);
  }

  return lines.join("\n");
}

function toWorkflowControlEntry(entry: unknown) {
  return entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
}

function createRoleMapStageNode(
  lines: string[],
  stage: ProjectWorkflowTemplateView["stages"][number],
  index: number,
) {
  const stageNodeId = getStageNodeId(index);
  lines.push(
    `${stageNodeId}["${sanitizeMermaidLabel(`${stage.name || stage.stageKey}\\n${stage.stageKey}`)}"]`,
  );
  lines.push(`class ${stageNodeId} stage;`);
  return stageNodeId;
}

function appendRoleMapPrimary(
  lines: string[],
  stageNodeId: string,
  primaryRoleAgentId: string,
  index: number,
) {
  if (!primaryRoleAgentId.trim()) {
    return;
  }

  const primaryId = `primary_${index + 1}`;
  lines.push(`${primaryId}["主责: ${sanitizeMermaidLabel(resolveRoleLabel(primaryRoleAgentId))}"]`);
  lines.push(`${stageNodeId} --> ${primaryId}`);
  lines.push(`class ${primaryId} primary;`);
}

function appendRoleMapParticipants(
  lines: string[],
  stageNodeId: string,
  participantRoleAgentIds: string[] | null | undefined,
  index: number,
) {
  for (const [participantIndex, participantRoleId] of (participantRoleAgentIds || []).entries()) {
    const participantId = `participant_${index + 1}_${participantIndex + 1}`;
    lines.push(
      `${participantId}["参与: ${sanitizeMermaidLabel(resolveRoleLabel(participantRoleId))}"]`,
    );
    lines.push(`${stageNodeId} --> ${participantId}`);
    lines.push(`class ${participantId} participant;`);
  }
}

function buildGateLabel(gate: Record<string, unknown>, gateIndex: number) {
  const gateName =
    typeof gate.name === "string" && gate.name.trim()
      ? gate.name.trim()
      : String(gate.type || `Gate ${gateIndex + 1}`);
  const evaluatorRole = typeof gate.evaluatorRole === "string" ? gate.evaluatorRole : "";
  return `${gateName}${evaluatorRole ? ` / ${resolveRoleLabel(evaluatorRole)}` : ""}`;
}

function buildApprovalLabel(approval: Record<string, unknown>, approvalIndex: number) {
  const approvalName =
    typeof approval.name === "string" && approval.name.trim()
      ? approval.name.trim()
      : `Approval ${approvalIndex + 1}`;
  const approverRole = typeof approval.approverRole === "string" ? approval.approverRole : "";
  return `${approvalName}${approverRole ? ` / ${resolveRoleLabel(approverRole)}` : ""}`;
}

function appendRoleMapControls(
  lines: string[],
  stageNodeId: string,
  entries: unknown[] | null | undefined,
  index: number,
  kind: "gate" | "approval",
) {
  for (const [controlIndex, entry] of (entries || []).entries()) {
    const control = toWorkflowControlEntry(entry);
    const controlId = `${kind}_${index + 1}_${controlIndex + 1}`;
    const label =
      kind === "gate"
        ? `Gate: ${buildGateLabel(control, controlIndex)}`
        : `Approval: ${buildApprovalLabel(control, controlIndex)}`;
    lines.push(`${controlId}["${sanitizeMermaidLabel(label)}"]`);
    lines.push(`${stageNodeId} -.-> ${controlId}`);
    lines.push(`class ${controlId} control;`);
  }
}

function appendRoleMapStage(
  lines: string[],
  stage: ProjectWorkflowTemplateView["stages"][number],
  index: number,
) {
  const stageNodeId = createRoleMapStageNode(lines, stage, index);
  appendRoleMapPrimary(lines, stageNodeId, stage.primaryRoleAgentId, index);
  appendRoleMapParticipants(lines, stageNodeId, stage.participantRoleAgentIdsJson, index);
  appendRoleMapControls(lines, stageNodeId, stage.gatesJson, index, "gate");
  appendRoleMapControls(lines, stageNodeId, stage.approvalsJson, index, "approval");
}

function buildRoleMapMermaid(stages: ProjectWorkflowTemplateView["stages"]) {
  if (stages.length === 0) {
    return "";
  }

  const ordered = getOrderedWorkflowStages(stages);
  const lines = [
    "flowchart LR",
    "classDef stage fill:#e6f4ff,stroke:#1677ff,color:#003a8c;",
    "classDef primary fill:#fff7e6,stroke:#fa8c16,color:#873800;",
    "classDef participant fill:#f9f0ff,stroke:#722ed1,color:#391085;",
    "classDef control fill:#fff1f0,stroke:#cf1322,color:#820014;",
  ];

  for (const [index, stage] of ordered.entries()) {
    appendRoleMapStage(lines, stage, index);
  }

  return lines.join("\n");
}

const showCandidateDiagram = computed(() => {
  if (!viewModel.value) {
    return false;
  }
  return (
    Boolean(selectedTemplateId.value) &&
    selectedTemplateId.value !== viewModel.value.workflowTemplateId
  );
});

const currentDiagramTitle = computed(
  () => `当前绑定：${viewModel.value?.currentTemplate?.name || "未绑定"}`,
);

const candidateDiagramTitle = computed(() => {
  const selectedTemplate = viewModel.value?.selectableTemplates.find(
    (template) => template.id === selectedTemplateId.value,
  );
  return `候选模板：${selectedTemplate?.name || selectedTemplateId.value || "未选择"}`;
});

const currentFlowMermaid = computed(() => buildFlowMermaid(viewModel.value?.stages || []));

const candidateFlowMermaid = computed(() => buildFlowMermaid(selectedTemplateStages.value || []));

const currentRoleMapMermaid = computed(() => buildRoleMapMermaid(viewModel.value?.stages || []));

const candidateRoleMapMermaid = computed(() =>
  buildRoleMapMermaid(selectedTemplateStages.value || []),
);

const currentDiagramMermaid = computed(() =>
  diagramKind.value === "roles" ? currentRoleMapMermaid.value : currentFlowMermaid.value,
);

const candidateDiagramMermaid = computed(() =>
  diagramKind.value === "roles" ? candidateRoleMapMermaid.value : candidateFlowMermaid.value,
);

function summarizeControlDiff(
  currentStages: ProjectWorkflowTemplateView["stages"],
  nextStages: ProjectWorkflowTemplateView["stages"],
  key: "gatesJson" | "approvalsJson",
) {
  const currentMap = new Map(
    currentStages.map((stage) => [
      stage.stageKey,
      Array.isArray(stage[key]) ? stage[key].length : 0,
    ]),
  );
  const nextMap = new Map(
    nextStages.map((stage) => [stage.stageKey, Array.isArray(stage[key]) ? stage[key].length : 0]),
  );

  return [...new Set([...currentMap.keys(), ...nextMap.keys()])]
    .map((stageKey) => {
      const currentCount = currentMap.get(stageKey) || 0;
      const nextCount = nextMap.get(stageKey) || 0;
      if (currentCount === nextCount) {
        return null;
      }
      return `${stageKey} ${currentCount} -> ${nextCount}`;
    })
    .filter((item): item is string => Boolean(item));
}

const selectionDiff = computed(() => {
  if (!viewModel.value) {
    return null;
  }

  const currentTemplate = viewModel.value.currentTemplate;
  const selectedTemplate =
    viewModel.value.selectableTemplates.find(
      (template) => template.id === selectedTemplateId.value,
    ) || null;
  if ((selectedTemplate?.id || null) === (currentTemplate?.id || null)) {
    return null;
  }

  const currentOrder = viewModel.value.stages.map((stage) => stage.stageKey);
  const nextOrder = (selectedTemplateId.value ? selectedTemplateStages.value : []).map(
    (stage) => stage.stageKey,
  );
  const currentSet = new Set(currentOrder);
  const nextSet = new Set(nextOrder);

  const added = nextOrder.filter((stageKey) => !currentSet.has(stageKey));
  const removed = currentOrder.filter((stageKey) => !nextSet.has(stageKey));
  const reordered = nextOrder.filter(
    (stageKey, index) => currentSet.has(stageKey) && currentOrder[index] !== stageKey,
  );
  const gateChanges = summarizeControlDiff(
    viewModel.value.stages,
    selectedTemplateStages.value,
    "gatesJson",
  );
  const approvalChanges = summarizeControlDiff(
    viewModel.value.stages,
    selectedTemplateStages.value,
    "approvalsJson",
  );

  if (!selectedTemplateId.value) {
    return {
      summary: "解绑后项目将不再使用项目级工作流模板。",
      description: `当前 ${currentOrder.length} 个阶段会被移除，任务将回退到无项目模板绑定状态。`,
      added,
      removed: currentOrder,
      reordered: [],
      gateChanges,
      approvalChanges,
    };
  }

  return {
    summary: `准备从 ${currentTemplate?.name || "未绑定"} 切换到 ${selectedTemplate?.name || selectedTemplateId.value}。`,
    description: loadingSelectionDiff.value
      ? "正在计算候选模板差异。"
      : `目标模板包含 ${nextOrder.length} 个阶段，新增 ${added.length} 个，移除 ${removed.length} 个。`,
    added,
    removed,
    reordered,
    gateChanges,
    approvalChanges,
  };
});

watch(
  [selectedTemplateId, viewModel],
  async ([templateId, currentView]) => {
    if (!currentView) {
      return;
    }
    if (!templateId) {
      selectedTemplateStages.value = [];
      diagramTab.value = "current";
      return;
    }
    if (templateId === currentView.workflowTemplateId) {
      selectedTemplateStages.value = [...currentView.stages];
      diagramTab.value = "current";
      return;
    }

    loadingSelectionDiff.value = true;
    try {
      const response = await listWorkflowTemplateStages(templateId);
      selectedTemplateStages.value = (response.data || [])
        .slice()
        .sort((left, right) => left.orderIndex - right.orderIndex);
      diagramTab.value = "candidate";
    } finally {
      loadingSelectionDiff.value = false;
    }
  },
  { immediate: true },
);

async function saveBinding() {
  saving.value = true;
  try {
    await updateProjectWorkflowTemplateBinding(projectId, {
      workflowTemplateId: selectedTemplateId.value || null,
      preferredTemplateId: preferredTemplateId.value || null,
      allowBossAutoTemplateSwitch: allowBossAutoTemplateSwitch.value,
    });
    await loadViewModel();
    message.success(selectedTemplateId.value ? "工作流模板绑定已更新" : "工作流模板已解绑");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "工作流模板绑定保存失败");
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    await loadViewModel();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "项目工作流视图加载失败";
  } finally {
    loading.value = false;
  }
});
</script>