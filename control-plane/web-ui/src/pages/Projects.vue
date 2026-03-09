<template>
  <div style="padding: 24px">
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="3" style="margin: 0">项目管理</a-typography-title>
      <a-button v-if="canCreateProject" type="primary" @click="showCreateModal = true">
        <template #icon><PlusOutlined /></template>
        新建项目
      </a-button>
    </a-flex>

    <a-table
      :data-source="projectStore.projects"
      :columns="columns"
      :loading="projectStore.loading"
      :pagination="{ pageSize: 20 }"
      row-key="id"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <router-link :to="`/projects/${record.id}`">
            {{ record.name }}
          </router-link>
        </template>

        <template v-if="column.key === 'slug'">
          <a-typography-text code>{{ record.slug }}</a-typography-text>
        </template>

        <template v-if="column.key === 'description'">
          {{ record.description || '-' }}
        </template>

        <template v-if="column.key === 'createdAt'">
          {{ formatTime(record.createdAt) }}
        </template>

        <template v-if="column.key === 'actions'">
          <a-space>
            <a-button
              v-if="canEditProject(String(record.id || ''))"
              type="link"
              size="small"
              @click="openEdit(record)"
            >
              编辑
            </a-button>
            <router-link :to="`/projects/${record.id}`">
              <a-button type="link" size="small">详情</a-button>
            </router-link>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- Create Project Modal -->
    <a-modal
      :open="showCreateModal"
      title="新建项目"
      :confirm-loading="creating"
      @ok="handleCreate"
      ok-text="创建"
      cancel-text="取消"
      :width="520"
      @update:open="showCreateModal = $event"
    >
      <a-form :model="createForm" layout="vertical" style="margin-top: 16px">
        <a-form-item label="所属组织" required>
          <a-select
            :value="createForm.orgId || undefined"
            style="width: 100%"
            placeholder="选择组织"
            :loading="orgsLoading"
            @update:value="createForm.orgId = String($event ?? '')"
          >
            <a-select-option v-for="org in orgs" :key="org.id" :value="org.id">
              {{ org.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="项目名称" required>
          <a-input
            :value="createForm.name"
            placeholder="例：智能客服系统"
            :maxlength="100"
            @update:value="createForm.name = String($event ?? '')"
            @change="autoSlug"
          />
        </a-form-item>
        <a-form-item label="Slug" required>
          <a-input
            :value="createForm.slug"
            placeholder="例：smart-cs"
            :maxlength="50"
            @update:value="createForm.slug = String($event ?? '')"
          />
          <div style="font-size: 12px; color: #8c8c8c; margin-top: 4px">
            仅允许小写字母、数字和连字符
          </div>
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            :value="createForm.description"
            placeholder="项目描述（可选）"
            :rows="3"
            :maxlength="500"
            @update:value="createForm.description = String($event ?? '')"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Edit Project Modal -->
    <a-modal
      :open="showEditModal"
      title="编辑项目"
      :confirm-loading="editing"
      @ok="handleEdit"
      ok-text="保存"
      cancel-text="取消"
      :width="520"
      @update:open="showEditModal = $event"
    >
      <a-form :model="editForm" layout="vertical" style="margin-top: 16px">
        <a-form-item label="项目名称" required>
          <a-input
            :value="editForm.name"
            :maxlength="100"
            @update:value="editForm.name = String($event ?? '')"
          />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            :value="editForm.description"
            :rows="3"
            :maxlength="500"
            @update:value="editForm.description = String($event ?? '')"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { PlusOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, onMounted, ref } from "vue";
import { type Org, type Project, createProject, listOrgs, updateProject } from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { useProjectStore } from "../stores/project";

const authStore = useAuthStore();
const projectStore = useProjectStore();

const orgs = ref<Org[]>([]);
const orgsLoading = ref(false);
const showCreateModal = ref(false);
const creating = ref(false);
const showEditModal = ref(false);
const editing = ref(false);
const editingProjectId = ref("");

const createForm = ref({
  orgId: "",
  name: "",
  slug: "",
  description: "",
});

const editForm = ref({
  name: "",
  description: "",
});

const columns = [
  { title: "项目名称", key: "name", dataIndex: "name" },
  { title: "Slug", key: "slug", dataIndex: "slug", width: 160 },
  { title: "描述", key: "description", dataIndex: "description", ellipsis: true },
  { title: "创建时间", key: "createdAt", dataIndex: "createdAt", width: 180 },
  { title: "操作", key: "actions", width: 150 },
];

const canCreateProject = computed(
  () => authStore.user?.role === "platform_admin" || authStore.user?.role === "org_admin",
);

onMounted(async () => {
  await projectStore.loadProjects();
  await loadOrgs();
});

async function loadOrgs() {
  orgsLoading.value = true;
  try {
    orgs.value = await listOrgs();
    if (!createForm.value.orgId && orgs.value.length > 0) {
      createForm.value.orgId = orgs.value[0].id;
    }
  } catch {
    orgs.value = [];
  } finally {
    orgsLoading.value = false;
  }
}

function canEditProject(projectId: string) {
  const globalRole = authStore.user?.role;
  if (globalRole === "platform_admin" || globalRole === "org_admin") {
    return true;
  }

  return authStore.user?.projects?.some(
    (project) => project.id === projectId && project.role === "project_admin",
  );
}

function autoSlug() {
  if (createForm.value.name && !createForm.value.slug) {
    createForm.value.slug = createForm.value.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
}

async function handleCreate() {
  if (!canCreateProject.value) {
    message.error("仅组织管理员可以创建项目");
    return;
  }

  const { orgId, name, slug, description } = createForm.value;
  if (!orgId || !name.trim() || !slug.trim()) {
    message.warning("请填写必填字段");
    return;
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    message.warning("Slug 仅允许小写字母、数字和连字符");
    return;
  }

  creating.value = true;
  try {
    const project = await createProject({
      orgId,
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || undefined,
    });
    message.success("项目创建成功");
    projectStore.addProject(project);
    showCreateModal.value = false;
    createForm.value = { orgId: orgs.value[0]?.id || "", name: "", slug: "", description: "" };
  } catch (e) {
    message.error(`创建失败: ${e}`);
  } finally {
    creating.value = false;
  }
}

function openEdit(record: Record<string, unknown>) {
  if (!canEditProject(String(record.id || ""))) {
    message.error("你没有修改该项目的权限");
    return;
  }

  editingProjectId.value = String(record.id);
  editForm.value = {
    name: String(record.name || ""),
    description: String(record.description || ""),
  };
  showEditModal.value = true;
}

async function handleEdit() {
  if (!editForm.value.name.trim()) {
    message.warning("项目名称不能为空");
    return;
  }

  editing.value = true;
  try {
    await updateProject(editingProjectId.value, {
      name: editForm.value.name.trim(),
      description: editForm.value.description.trim(),
    });
    message.success("保存成功");
    projectStore.updateProjectInList({
      id: editingProjectId.value,
      name: editForm.value.name.trim(),
      description: editForm.value.description.trim(),
    });
    showEditModal.value = false;
  } catch (e) {
    message.error(`保存失败: ${e}`);
  } finally {
    editing.value = false;
  }
}

function formatTime(ts: string) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}
</script>
