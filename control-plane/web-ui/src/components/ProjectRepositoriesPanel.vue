<template>
  <div>
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="5" style="margin: 0">代码仓库</a-typography-title>
      <a-button v-if="canManage" type="primary" @click="openCreateModal">添加仓库</a-button>
    </a-flex>

    <a-alert
      v-if="!canManage"
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="你可以查看仓库信息，但只有项目管理员才能管理仓库。"
    />

    <div
      v-if="canManage"
      style="margin-bottom: 16px; padding: 12px 16px; border: 1px solid #f0f0f0; border-radius: 8px; background: #fafafa"
    >
      <a-flex justify="space-between" align="center" wrap="wrap" gap="middle">
        <a-typography-text type="secondary">
          {{
            selectedRepoIds.length > 0
              ? `已选 ${selectedRepoIds.length} 个仓库，可批量删除`
              : "勾选仓库后可批量删除"
          }}
        </a-typography-text>
        <a-space wrap>
          <a-button
            danger
            :disabled="selectedRepoIds.length === 0"
            :loading="deletingRepositories"
            data-testid="bulk-delete-repositories"
            @click="handleBulkDeleteClick"
          >删除所选仓库</a-button>
          <a-button v-if="selectedRepoIds.length > 0" @click="clearSelectedRepoIds">
            清空选择
          </a-button>
        </a-space>
      </a-flex>
    </div>

    <a-empty v-if="!loading && repos.length === 0" description="暂无仓库，点击「添加仓库」开始配置" />

    <a-table
      v-else
      :data-source="repos"
      :columns="columns"
      :row-selection="rowSelection"
      :loading="loading"
      :pagination="false"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'provider'">
          <a-tag :color="providerColor(record.provider)">{{ record.provider }}</a-tag>
        </template>

        <template v-if="column.key === 'remoteUrl'">
          <a-typography-text
            :content="record.remoteUrl"
            copyable
            style="max-width: 360px; display: inline-block"
            :ellipsis="true"
          />
        </template>

        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
        </template>

        <template v-if="column.key === 'updatedAt'">
          {{ formatTime(record.updatedAt) }}
        </template>

        <template v-if="column.key === 'actions'">
          <a-space v-if="canManage">
            <a-button type="link" size="small" @click="openEditModal(record)">编辑</a-button>
            <a-popconfirm
              title="确定归档该仓库？归档后任务将无法选择该仓库。"
              ok-text="归档"
              cancel-text="取消"
              @confirm="handleArchive(record.id)"
            >
              <a-button
                danger
                type="link"
                size="small"
                :loading="pendingDeleteRepoIds.includes(record.id)"
              >归档</a-button>
            </a-popconfirm>
          </a-space>
          <span v-else>-</span>
        </template>
      </template>
    </a-table>

    <!-- Create / Edit Modal -->
    <a-modal
      :open="showModal"
      :title="editingId ? '编辑仓库' : '添加仓库'"
      :confirm-loading="saving"
      ok-text="保存"
      cancel-text="取消"
      @ok="handleSubmit"
      @update:open="showModal = $event"
    >
      <a-form :model="form" layout="vertical" style="margin-top: 16px">
        <a-form-item label="仓库名称" required>
          <a-input
            :value="form.name"
            :maxlength="200"
            placeholder="例如：openerx-backend"
            @update:value="form.name = String($event ?? '')"
          />
        </a-form-item>

        <a-form-item label="Provider" required>
          <a-select :value="form.provider" @update:value="form.provider = String($event ?? 'github')">
            <a-select-option value="github">GitHub</a-select-option>
            <a-select-option value="gitlab">GitLab</a-select-option>
            <a-select-option value="gitea">Gitea</a-select-option>
            <a-select-option value="local">Local</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="仓库地址 (Remote URL)" required>
          <a-input
            :value="form.remoteUrl"
            :maxlength="2000"
            placeholder="例如：https://github.com/org/repo.git"
            @update:value="form.remoteUrl = String($event ?? '')"
          />
        </a-form-item>

        <a-form-item label="默认分支">
          <a-input
            :value="form.defaultBranch"
            :maxlength="100"
            placeholder="main"
            @update:value="form.defaultBranch = String($event ?? '')"
          />
        </a-form-item>

        <a-form-item label="描述">
          <a-textarea
            :value="form.description"
            :rows="3"
            :maxlength="1000"
            placeholder="可选的仓库描述"
            @update:value="form.description = String($event ?? '')"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, ref, watch } from "vue";
import {
  type Repository,
  type RepositoryProvider,
  archiveRepository,
  createRepository,
  listRepositories,
  updateRepository,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{
  projectId: string;
}>();

const authStore = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const selectedRepoIds = ref<string[]>([]);
const pendingDeleteRepoIds = ref<string[]>([]);
const repos = ref<Repository[]>([]);
const showModal = ref(false);
const editingId = ref("");

const form = ref({
  name: "",
  provider: "github" as string,
  remoteUrl: "",
  defaultBranch: "main",
  description: "",
});

const canManage = computed(() => {
  const globalRole = authStore.user?.role;
  if (globalRole === "platform_admin" || globalRole === "org_admin") return true;
  return authStore.user?.projects?.some(
    (p) => p.id === props.projectId && p.role === "project_admin",
  );
});

const deletingRepositories = computed(() => pendingDeleteRepoIds.value.length > 0);
const rowSelection = computed(() => {
  if (!canManage.value) {
    return undefined;
  }

  const pendingIds = new Set(pendingDeleteRepoIds.value);

  return {
    selectedRowKeys: selectedRepoIds.value,
    onChange: (keys: Array<string | number>) =>
      handleRepositorySelectionChange(keys.map((key) => String(key))),
    getCheckboxProps: (record: Repository) => ({
      disabled: pendingIds.has(record.id),
    }),
  };
});

const columns = [
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "Provider", dataIndex: "provider", key: "provider", width: 100 },
  { title: "仓库地址", dataIndex: "remoteUrl", key: "remoteUrl" },
  { title: "默认分支", dataIndex: "defaultBranch", key: "defaultBranch", width: 100 },
  { title: "状态", dataIndex: "status", key: "status", width: 80 },
  { title: "更新时间", dataIndex: "updatedAt", key: "updatedAt", width: 160 },
  { title: "操作", key: "actions", width: 120 },
];

function providerColor(provider: string) {
  const map: Record<string, string> = {
    github: "geekblue",
    gitlab: "orange",
    gitea: "green",
    local: "default",
  };
  return map[provider] || "default";
}

function statusColor(status: string) {
  const map: Record<string, string> = { active: "green", archived: "default", error: "red" };
  return map[status] || "default";
}

function statusLabel(status: string) {
  const map: Record<string, string> = { active: "活跃", archived: "已归档", error: "异常" };
  return map[status] || status;
}

function formatTime(ts?: string) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function handleRepositorySelectionChange(keys: string[]) {
  const visibleIds = new Set(repos.value.map((repo) => repo.id));
  selectedRepoIds.value = Array.from(new Set(keys.filter((key) => visibleIds.has(key))));
}

function clearSelectedRepoIds() {
  selectedRepoIds.value = [];
}

function syncSelectedRepoIds() {
  const visibleIds = new Set(repos.value.map((repo) => repo.id));
  selectedRepoIds.value = selectedRepoIds.value.filter((key) => visibleIds.has(key));
}

async function fetchRepos() {
  loading.value = true;
  try {
    const result = await listRepositories(props.projectId);
    repos.value = result.data;
    syncSelectedRepoIds();
  } catch (e) {
    message.error("加载仓库列表失败");
  } finally {
    loading.value = false;
  }
}

function openCreateModal() {
  editingId.value = "";
  form.value = {
    name: "",
    provider: "github",
    remoteUrl: "",
    defaultBranch: "main",
    description: "",
  };
  showModal.value = true;
}

function openEditModal(repo: Record<string, unknown>) {
  const record = repo as unknown as Repository;
  editingId.value = record.id;
  form.value = {
    name: record.name,
    provider: record.provider,
    remoteUrl: record.remoteUrl,
    defaultBranch: record.defaultBranch,
    description: record.description || "",
  };
  showModal.value = true;
}

async function handleSubmit() {
  if (!form.value.name.trim()) {
    message.warning("请输入仓库名称");
    return;
  }
  if (!form.value.remoteUrl.trim()) {
    message.warning("请输入仓库地址");
    return;
  }

  saving.value = true;
  try {
    if (editingId.value) {
      await updateRepository(editingId.value, {
        projectId: props.projectId,
        name: form.value.name.trim(),
        provider: form.value.provider as RepositoryProvider,
        remoteUrl: form.value.remoteUrl.trim(),
        defaultBranch: form.value.defaultBranch.trim() || "main",
        description: form.value.description.trim() || undefined,
      });
      message.success("仓库已更新");
    } else {
      await createRepository({
        projectId: props.projectId,
        name: form.value.name.trim(),
        provider: form.value.provider as RepositoryProvider,
        remoteUrl: form.value.remoteUrl.trim(),
        defaultBranch: form.value.defaultBranch.trim() || "main",
        description: form.value.description.trim() || undefined,
      });
      message.success("仓库已添加");
    }
    showModal.value = false;
    await fetchRepos();
  } catch (e: unknown) {
    message.error((e as Error).message || "操作失败");
  } finally {
    saving.value = false;
  }
}

async function handleArchive(repoId: string) {
  await runRepositoryDeletion([repoId]);
}

function normalizeDeleteError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

async function runRepositoryDeletion(repoIds: string[]) {
  if (repoIds.length === 0) {
    return;
  }

  pendingDeleteRepoIds.value = [...repoIds];
  try {
    const results = await Promise.allSettled(
      repoIds.map((repoId) => archiveRepository(repoId, props.projectId)),
    );
    const succeededIds: string[] = [];
    const failedIds: string[] = [];
    const failedMessages: string[] = [];

    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        succeededIds.push(repoIds[index] ?? "");
        continue;
      }

      failedIds.push(repoIds[index] ?? "");
      failedMessages.push(normalizeDeleteError(result.reason));
    }

    if (succeededIds.length > 0) {
      await fetchRepos();
      message.success(
        succeededIds.length === 1 ? "仓库已删除" : `已删除 ${succeededIds.length} 个仓库`,
      );
    }

    selectedRepoIds.value = failedIds;
    syncSelectedRepoIds();

    if (failedMessages.length > 0) {
      message.error(
        failedMessages.length === 1
          ? `删除失败: ${failedMessages[0]}`
          : `有 ${failedMessages.length} 个仓库删除失败，请重试`,
      );
    }
  } finally {
    pendingDeleteRepoIds.value = [];
  }
}

async function handleBulkDeleteClick() {
  if (!canManage.value) {
    message.error("仅项目管理员可以删除仓库");
    return;
  }

  if (selectedRepoIds.value.length === 0) {
    message.warning("请先选择要删除的仓库");
    return;
  }

  const confirmed = window.confirm(
    selectedRepoIds.value.length === 1
      ? "确定删除所选仓库？该操作会将仓库归档，后续任务将无法再选择它。"
      : `确定删除所选的 ${selectedRepoIds.value.length} 个仓库？该操作会将它们归档，后续任务将无法再选择。`,
  );

  if (!confirmed) {
    return;
  }

  await runRepositoryDeletion([...selectedRepoIds.value]);
}

onMounted(fetchRepos);

watch(
  () => props.projectId,
  () => {
    clearSelectedRepoIds();
    void fetchRepos();
  },
);
</script>
