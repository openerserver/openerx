<template>
  <div style="padding: 24px">
    <a-page-header
      :title="project?.name || '加载中...'"
      :sub-title="project?.slug"
      @back="$router.push('/projects')"
    />

    <ProjectSectionNav v-if="project" :project-id="project.id" active-key="overview" />

    <a-spin :spinning="loading" v-if="loading" style="display: block; text-align: center; padding: 60px" />

    <template v-else-if="project">
      <a-tabs :activeKey="activeTab" @update:activeKey="activeTab = String($event)">
        <!-- 概览 Tab -->
        <a-tab-pane key="overview" tab="概览">
          <a-row :gutter="[16, 16]">
            <a-col :xs="24" :lg="12">
              <a-card title="基本信息" size="small">
                <a-descriptions :column="1" bordered size="small">
                  <a-descriptions-item label="项目 ID">
                    <a-typography-text code>{{ project.id }}</a-typography-text>
                  </a-descriptions-item>
                  <a-descriptions-item label="名称">
                    <span v-if="!editingName">
                      {{ project.name }}
                      <a-button v-if="canManage" type="link" size="small" @click="startEditName">编辑</a-button>
                    </span>
                    <a-space v-else>
                      <a-input
                        :value="editNameValue"
                        size="small"
                        style="width: 200px"
                        @update:value="editNameValue = String($event ?? '')"
                        @press-enter="saveName"
                      />
                      <a-button type="primary" size="small" :loading="saving" @click="saveName">保存</a-button>
                      <a-button size="small" @click="editingName = false">取消</a-button>
                    </a-space>
                  </a-descriptions-item>
                  <a-descriptions-item label="Slug">{{ project.slug }}</a-descriptions-item>
                  <a-descriptions-item label="组织 ID">
                    <a-typography-text code>{{ project.orgId }}</a-typography-text>
                  </a-descriptions-item>
                  <a-descriptions-item label="创建时间">{{ formatTime(project.createdAt || '') }}</a-descriptions-item>
                </a-descriptions>
              </a-card>
            </a-col>

            <a-col :xs="24" :lg="12">
              <a-card title="描述" size="small">
                <div v-if="!editingDesc">
                  <p style="margin: 0">{{ project.description || '暂无描述' }}</p>
                  <a-button v-if="canManage" type="link" size="small" @click="startEditDesc">编辑</a-button>
                </div>
                <div v-else>
                  <a-textarea
                    :value="editDescValue"
                    :rows="4"
                    :maxlength="500"
                    @update:value="editDescValue = String($event ?? '')"
                  />
                  <a-space style="margin-top: 8px">
                    <a-button type="primary" size="small" :loading="saving" @click="saveDesc">保存</a-button>
                    <a-button size="small" @click="editingDesc = false">取消</a-button>
                  </a-space>
                </div>
              </a-card>
            </a-col>
          </a-row>

          <a-card title="项目设置" size="small" style="margin-top: 16px">
            <a-descriptions :column="{ xs: 1, lg: 3 }" bordered size="small">
              <a-descriptions-item label="默认模型">
                {{ project.settings?.defaultModel || '未配置' }}
              </a-descriptions-item>
              <a-descriptions-item label="默认环境">
                {{ project.settings?.defaultEnvironmentId || '未配置' }}
              </a-descriptions-item>
              <a-descriptions-item label="审批策略">
                {{ approvalPolicyLabel(project.settings?.approvalPolicy) }}
              </a-descriptions-item>
              <a-descriptions-item label="最大并发">
                {{ project.settings?.maxConcurrency || '未配置' }}
              </a-descriptions-item>
              <a-descriptions-item label="月预算">
                {{ project.settings?.budgetMonthly != null ? `$${project.settings.budgetMonthly}` : '未配置' }}
              </a-descriptions-item>
              <a-descriptions-item label="预警阈值">
                {{ percentLabel(project.settings?.warnThreshold) }}
              </a-descriptions-item>
              <a-descriptions-item label="限流阈值">
                {{ percentLabel(project.settings?.throttleThreshold) }}
              </a-descriptions-item>
            </a-descriptions>
          </a-card>
        </a-tab-pane>

        <!-- 环境 Tab -->
        <a-tab-pane key="environments" tab="环境">
          <ProjectEnvironmentsPanel :project-id="project.id" />
        </a-tab-pane>

        <!-- 代码仓库 Tab -->
        <a-tab-pane key="repositories" tab="代码仓库">
          <ProjectRepositoriesPanel :project-id="project.id" />
        </a-tab-pane>

        <!-- 凭证 Tab -->
        <a-tab-pane key="credentials" tab="凭证">
          <ProjectCredentialsPanel :project-id="project.id" />
        </a-tab-pane>

        <!-- 成员 Tab -->
        <a-tab-pane key="members" tab="成员">
          <ProjectMembersPanel :project-id="project.id" />
        </a-tab-pane>

        <!-- 设置 Tab -->
        <a-tab-pane key="settings" tab="设置">
          <ProjectSettingsPanel
            :project-id="project.id"
            :settings="project.settings || undefined"
            @updated="handleSettingsUpdated"
          />
        </a-tab-pane>
      </a-tabs>
    </template>

    <a-result v-else status="404" title="项目不存在" sub-title="请检查项目 ID 是否正确">
      <template #extra>
        <a-button type="primary" @click="$router.push('/projects')">返回项目列表</a-button>
      </template>
    </a-result>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { type Project, type ProjectSettings, getProject, updateProject } from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { useProjectStore } from "../stores/project";

interface ProjectWithSettings extends Project {
  settings?: ProjectSettings | null;
}

const route = useRoute();
const authStore = useAuthStore();
const projectStore = useProjectStore();

const loading = ref(true);
const saving = ref(false);
const project = ref<ProjectWithSettings | null>(null);
const activeTab = ref("overview");

const editingName = ref(false);
const editNameValue = ref("");
const editingDesc = ref(false);
const editDescValue = ref("");

const canManage = computed(() => {
  const globalRole = authStore.user?.role;
  if (globalRole === "platform_admin" || globalRole === "org_admin") {
    return true;
  }

  const projectId = project.value?.id;
  if (!projectId) {
    return false;
  }

  return authStore.user?.projects?.some(
    (item) => item.id === projectId && item.role === "project_admin",
  );
});

onMounted(async () => {
  const tab = route.query.tab;
  if (typeof tab === "string" && tab) {
    activeTab.value = tab;
  }
  const projectId = String(route.params.projectId);
  try {
    project.value = (await getProject(projectId)) as ProjectWithSettings;
  } catch {
    project.value = null;
  } finally {
    loading.value = false;
  }
});

function startEditName() {
  editNameValue.value = project.value?.name || "";
  editingName.value = true;
}

function startEditDesc() {
  editDescValue.value = project.value?.description || "";
  editingDesc.value = true;
}

async function saveName() {
  if (!canManage.value) {
    message.error("你没有修改该项目的权限");
    return;
  }

  if (!editNameValue.value.trim() || !project.value) return;
  saving.value = true;
  try {
    await updateProject(project.value.id, { name: editNameValue.value.trim() });
    project.value.name = editNameValue.value.trim();
    projectStore.updateProjectInList({ id: project.value.id, name: project.value.name });
    editingName.value = false;
    message.success("保存成功");
  } catch (e) {
    message.error(`保存失败: ${e}`);
  } finally {
    saving.value = false;
  }
}

async function saveDesc() {
  if (!canManage.value) {
    message.error("你没有修改该项目的权限");
    return;
  }

  if (!project.value) return;
  saving.value = true;
  try {
    await updateProject(project.value.id, { description: editDescValue.value.trim() });
    project.value.description = editDescValue.value.trim();
    projectStore.updateProjectInList({
      id: project.value.id,
      description: project.value.description,
    });
    editingDesc.value = false;
    message.success("保存成功");
  } catch (e) {
    message.error(`保存失败: ${e}`);
  } finally {
    saving.value = false;
  }
}

function formatTime(ts: string) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function handleSettingsUpdated(settings: ProjectWithSettings["settings"]) {
  if (!project.value) return;
  project.value.settings = settings || null;
  projectStore.updateProjectInList({ id: project.value.id, settings: settings || null });
}

function approvalPolicyLabel(policy: ProjectSettings["approvalPolicy"]) {
  if (policy === "balanced") return "balanced: 平衡策略";
  if (policy === "strict") return "strict: 高风险优先审批";
  if (policy === "manual") return "manual: 关键动作全部人工审批";
  return "未配置";
}

function percentLabel(value: number | undefined) {
  if (typeof value !== "number") return "未配置";
  return `${Math.round(value * 100)}%`;
}
</script>
