<template>
  <div style="padding: 24px">
    <a-page-header
      title="工作流模板"
      sub-title="管理阶段状态机模板，定义任务从 clarify 到 release 的推进骨架"
      @back="$router.push('/settings')"
    />

    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="当前已接通 BFF 联调接口。此页支持一键创建默认模板，便于项目页立即绑定。"
    />

    <a-spin :spinning="loading" style="display: block">
      <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
        <a-col :xs="24" :md="8">
          <a-card size="small" title="模板总数">
            <a-statistic :value="templates.length" />
          </a-card>
        </a-col>
        <a-col :xs="24" :md="8">
          <a-card size="small" title="启用模板">
            <a-statistic :value="enabledTemplates" />
          </a-card>
        </a-col>
        <a-col :xs="24" :md="8">
          <a-card size="small" title="可选模板">
            <a-statistic :value="selectableTemplates" />
          </a-card>
        </a-col>
      </a-row>

      <a-card size="small" title="模板列表">
        <template #extra>
          <a-button type="primary" :loading="creatingDefaultTemplate" @click="createDefaultTemplate">
            创建默认模板
          </a-button>
        </template>

        <a-alert v-if="loadError" type="error" show-icon style="margin-bottom: 16px" :message="loadError" />
        <a-alert
          type="info"
          show-icon
          style="margin-bottom: 16px"
          message="如果当前库里没有工作流模板，可点击右上角一键生成默认研发交付模板。"
        />

        <a-empty v-if="!loadError && templates.length === 0" description="当前没有可展示的工作流模板" />

        <a-table v-else :data-source="templates" row-key="id" size="small" :pagination="false">
          <a-table-column title="模板" key="template">
            <template #default="{ record }">
              <a-space direction="vertical" :size="2">
                <span>{{ record.name }}</span>
                <a-typography-text type="secondary">{{ record.id }}</a-typography-text>
                <a-tag v-if="record.projectId" color="gold">项目专用</a-tag>
              </a-space>
            </template>
          </a-table-column>
          <a-table-column title="阶段顺序" key="stages">
            <template #default="{ record }">
              <a-typography-text>{{ record.stageOrderJson.join(' -> ') || '未配置' }}</a-typography-text>
            </template>
          </a-table-column>
          <a-table-column title="状态" key="status" :width="140">
            <template #default="{ record }">
              <a-space>
                <a-tag :color="record.enabled ? 'green' : 'default'">{{ record.enabled ? '启用' : '停用' }}</a-tag>
                <a-tag :color="record.selectableByProjects ? 'blue' : 'default'">
                  {{ record.selectableByProjects ? '项目可选' : '仅系统' }}
                </a-tag>
              </a-space>
            </template>
          </a-table-column>
          <a-table-column title="更新时间" data-index="updatedAt" :width="220" />
          <a-table-column title="操作" key="actions" :width="220">
            <template #default="{ record }">
              <a-space>
                <router-link :to="{ name: 'WorkflowTemplateEditor', params: { templateId: record.id } }">
                  <a-button size="small" type="primary">编辑模板</a-button>
                </router-link>
                <a-button size="small" @click="openCloneModal(record)">复制模板</a-button>
              </a-space>
            </template>
          </a-table-column>
        </a-table>
      </a-card>
    </a-spin>

    <a-modal
      :open="cloneModalOpen"
      title="复制工作流模板"
      :confirm-loading="cloningTemplate"
      ok-text="复制"
      cancel-text="取消"
      :width="640"
      @ok="submitClone"
      @update:open="cloneModalOpen = $event"
    >
      <a-form layout="vertical" style="margin-top: 16px">
        <a-form-item label="源模板">
          <a-input :value="cloneSourceTemplate?.name || ''" disabled />
        </a-form-item>
        <a-row :gutter="16">
          <a-col :xs="24" :md="12">
            <a-form-item label="新模板名称" required>
              <a-input
                :value="cloneForm.name"
                placeholder="例如：默认研发交付模板 - 项目定制"
                @update:value="cloneForm.name = String($event ?? '')"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item label="新模板 ID" required>
              <a-input
                :value="cloneForm.id"
                placeholder="例如：workflow-template-default-delivery-copy"
                @update:value="cloneForm.id = normalizeTemplateId(String($event ?? ''))"
              />
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="16">
          <a-col :xs="24" :md="12">
            <a-form-item label="分类">
              <a-input :value="cloneForm.category" @update:value="cloneForm.category = String($event ?? '')" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-form-item label="归属项目">
              <a-select
                :value="cloneForm.projectId || undefined"
                allow-clear
                show-search
                :options="projectOptions"
                placeholder="不选则复制为平台级模板"
                @update:value="cloneForm.projectId = toOptionalString($event)"
              />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="模板描述">
          <a-textarea
            :value="cloneForm.description"
            :rows="3"
            @update:value="cloneForm.description = String($event ?? '')"
          />
        </a-form-item>
        <a-space direction="vertical">
          <a-checkbox :checked="cloneForm.enabled" @update:checked="cloneForm.enabled = Boolean($event)">
            复制后立即启用
          </a-checkbox>
          <a-checkbox
            :checked="cloneForm.selectableByProjects"
            @update:checked="cloneForm.selectableByProjects = Boolean($event)"
          >
            允许项目绑定
          </a-checkbox>
        </a-space>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref } from "vue";
import {
  cloneWorkflowTemplate,
  createWorkflowTemplate,
  createWorkflowTemplateStage,
  type Project,
  type WorkflowTemplateRecord,
  listWorkflowTemplates,
  listProjects,
} from "../lib/api";

const DEFAULT_TEMPLATE_ID = "workflow-template-default-delivery";

const loading = ref(true);
const loadError = ref<string | null>(null);
const creatingDefaultTemplate = ref(false);
const cloningTemplate = ref(false);
const cloneModalOpen = ref(false);
const cloneSourceTemplate = ref<WorkflowTemplateRecord | null>(null);
const templates = ref<WorkflowTemplateRecord[]>([]);
const projects = ref<Project[]>([]);

const cloneForm = reactive({
  id: "",
  name: "",
  description: "",
  category: "",
  projectId: "",
  enabled: true,
  selectableByProjects: true,
});

function normalizeTemplateId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "";
}

function buildCloneId(source: WorkflowTemplateRecord) {
  return normalizeTemplateId(`${source.id}-copy-${Date.now().toString().slice(-6)}`);
}

function openCloneModal(source: WorkflowTemplateRecord) {
  cloneSourceTemplate.value = source;
  cloneForm.name = `${source.name} - 副本`;
  cloneForm.id = buildCloneId(source);
  cloneForm.description = source.description || "";
  cloneForm.category = source.category || "";
  cloneForm.projectId = source.projectId || "";
  cloneForm.enabled = source.enabled;
  cloneForm.selectableByProjects = source.selectableByProjects;
  cloneModalOpen.value = true;
}

async function submitClone() {
  if (!cloneSourceTemplate.value) {
    return;
  }
  if (!cloneForm.name.trim() || !cloneForm.id.trim()) {
    message.error("复制模板需要填写名称和 ID");
    return;
  }

  cloningTemplate.value = true;
  try {
    const result = await cloneWorkflowTemplate(cloneSourceTemplate.value.id, {
      id: cloneForm.id.trim(),
      name: cloneForm.name.trim(),
      description: cloneForm.description.trim(),
      category: cloneForm.category.trim(),
      projectId: cloneForm.projectId || undefined,
      enabled: cloneForm.enabled,
      selectableByProjects: cloneForm.selectableByProjects,
      defaultRoles: cloneSourceTemplate.value.defaultRolesJson || undefined,
    });
    await loadTemplates();
    cloneModalOpen.value = false;
    message.success(`模板已复制：${result.template.name}`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : "模板复制失败");
  } finally {
    cloningTemplate.value = false;
  }
}

async function loadTemplates() {
  const response = await listWorkflowTemplates();
  templates.value = response.data || [];
}

async function loadProjects() {
  projects.value = await listProjects();
}

async function createDefaultTemplate() {
  creatingDefaultTemplate.value = true;
  try {
    if (!templates.value.some((item) => item.id === DEFAULT_TEMPLATE_ID)) {
      await createWorkflowTemplate({
        id: DEFAULT_TEMPLATE_ID,
        name: "默认研发交付模板",
        description: "覆盖澄清、设计、实现、验证和发布的标准研发阶段模板。",
        category: "delivery",
        enabled: true,
        selectableByProjects: true,
        defaultCollaborationMode: "team",
        defaultAutopilotLevel: "L1",
        defaultBossParticipationMode: "advisory",
        forceBossParticipation: false,
        stageOrder: ["clarify", "design", "implement", "verify", "release"],
        defaultRoles: [
          "role.product",
          "role.architect",
          "role.developer",
          "role.qa",
          "role.release",
          "role.security",
        ],
      });

      const stages = [
        {
          id: `${DEFAULT_TEMPLATE_ID}.clarify`,
          stageKey: "clarify",
          name: "需求澄清",
          enabled: true,
          mode: "single" as const,
          primaryRoleAgentId: "role.product",
          participantRoleAgentIds: ["role.architect", "role.security"],
          orderIndex: 0,
        },
        {
          id: `${DEFAULT_TEMPLATE_ID}.design`,
          stageKey: "design",
          name: "方案设计",
          enabled: true,
          mode: "parallel" as const,
          primaryRoleAgentId: "role.architect",
          participantRoleAgentIds: ["role.product", "role.security", "role.visual"],
          orderIndex: 1,
        },
        {
          id: `${DEFAULT_TEMPLATE_ID}.implement`,
          stageKey: "implement",
          name: "实现开发",
          enabled: true,
          mode: "single" as const,
          primaryRoleAgentId: "role.developer",
          participantRoleAgentIds: ["role.security"],
          orderIndex: 2,
        },
        {
          id: `${DEFAULT_TEMPLATE_ID}.verify`,
          stageKey: "verify",
          name: "集成验证",
          enabled: true,
          mode: "parallel" as const,
          primaryRoleAgentId: "role.qa",
          participantRoleAgentIds: ["role.developer", "role.security", "role.operations"],
          orderIndex: 3,
        },
        {
          id: `${DEFAULT_TEMPLATE_ID}.release`,
          stageKey: "release",
          name: "发布执行",
          enabled: true,
          mode: "single" as const,
          primaryRoleAgentId: "role.release",
          participantRoleAgentIds: ["role.qa", "role.operations", "role.security"],
          orderIndex: 4,
        },
      ];

      for (const stage of stages) {
        await createWorkflowTemplateStage(DEFAULT_TEMPLATE_ID, stage);
      }
    }

    await loadTemplates();
    message.success("默认模板已准备完成");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "默认模板创建失败");
  } finally {
    creatingDefaultTemplate.value = false;
  }
}

const enabledTemplates = computed(() => templates.value.filter((item) => item.enabled).length);
const selectableTemplates = computed(() => templates.value.filter((item) => item.selectableByProjects).length);
const projectOptions = computed(() =>
  projects.value.map((project) => ({
    label: `${project.name} (${project.slug})`,
    value: project.id,
  })),
);

onMounted(async () => {
  try {
    await Promise.all([loadTemplates(), loadProjects()]);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "工作流模板加载失败";
  } finally {
    loading.value = false;
  }
});
</script>