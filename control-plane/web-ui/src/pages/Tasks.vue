<template>
  <div style="padding: 24px">
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="3" style="margin: 0">任务列表</a-typography-title>
      <a-space>
        <a-select
          :value="statusFilter"
          style="width: 140px"
          placeholder="状态筛选"
          allow-clear
          @update:value="setStatusFilter"
        >
          <a-select-option value="pending">待执行</a-select-option>
          <a-select-option value="running">运行中</a-select-option>
          <a-select-option value="completed">已完成</a-select-option>
          <a-select-option value="failed">失败</a-select-option>
          <a-select-option value="paused">已暂停</a-select-option>
        </a-select>
        <a-button @click="refresh" :loading="loading">刷新</a-button>
        <a-button type="primary" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          新建任务
        </a-button>
      </a-space>
    </a-flex>

    <a-table
      :data-source="filteredTasks"
      :columns="columns"
      :loading="loading"
      :pagination="{ pageSize: 20 }"
      row-key="id"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'id'">
          <router-link :to="`/tasks/${record.id}`">
            <a-typography-text code>{{ record.id.slice(0, 12) }}</a-typography-text>
          </router-link>
        </template>

        <template v-if="column.key === 'title'">
          <router-link :to="`/tasks/${record.id}`">
            {{ record.title }}
          </router-link>
        </template>

        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
        </template>

        <template v-if="column.key === 'createdAt'">
          {{ formatTime(record.createdAt) }}
        </template>

        <template v-if="column.key === 'actions'">
          <a-space>
            <a-button
              v-if="record.status === 'pending'"
              type="primary"
              size="small"
              :loading="executingId === record.id"
              @click="handleExecute(record.id)"
            >
              执行
            </a-button>
            <router-link :to="`/tasks/${record.id}`">
              <a-button type="link" size="small">详情</a-button>
            </router-link>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- Create Task Modal -->
    <a-modal
      :open="showCreateModal"
      title="新建任务"
      :confirm-loading="creating"
      :ok-button-props="{ disabled: !projectStore.currentProjectId }"
      @ok="handleCreate"
      ok-text="创建"
      cancel-text="取消"
      :width="640"
      @update:open="showCreateModal = $event"
    >
      <a-form :model="createForm" layout="vertical" style="margin-top: 16px">
        <a-form-item label="项目">
          <a-input
            :value="projectStore.currentProject?.name || '未选择项目'"
            disabled
          />
          <div v-if="!projectStore.currentProjectId" style="margin-top: 8px; color: #ff4d4f; font-size: 12px">
            请先在侧边栏选择项目。
          </div>
        </a-form-item>
        <a-form-item label="任务标题" required>
          <a-input
            :value="createForm.title"
            placeholder="例：优化登录页面性能"
            :maxlength="500"
            @update:value="createForm.title = String($event ?? '')"
          />
        </a-form-item>
        <a-form-item label="任务描述 / Prompt" required>
          <a-textarea
            :value="createForm.prompt"
            placeholder="详细描述需要 Agent 完成的任务..."
            :rows="8"
            :maxlength="50000"
            show-count
            @update:value="createForm.prompt = String($event ?? '')"
          />
        </a-form-item>
        <a-form-item label="执行方式">
          <a-radio-group
            :value="createForm.autoExecute"
            @update:value="createForm.autoExecute = Boolean($event)"
          >
            <a-radio :value="true">创建后立即执行</a-radio>
            <a-radio :value="false">仅创建（稍后手动执行）</a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { PlusOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, onMounted, ref, watch } from "vue";
import { type Task, createTask, executeTask, listTasks } from "../lib/api";
import { useProjectStore } from "../stores/project";

const projectStore = useProjectStore();
const loading = ref(false);
const creating = ref(false);
const executingId = ref<string | null>(null);
const tasks = ref<Task[]>([]);
const statusFilter = ref<string | undefined>(undefined);
const showCreateModal = ref(false);

const createForm = ref({
  title: "",
  prompt: "",
  autoExecute: true,
});

const columns = [
  { title: "任务 ID", key: "id", dataIndex: "id", width: 140 },
  { title: "标题", key: "title", dataIndex: "title", ellipsis: true },
  { title: "状态", key: "status", dataIndex: "status", width: 100 },
  { title: "创建时间", key: "createdAt", dataIndex: "createdAt", width: 180 },
  { title: "操作", key: "actions", width: 150 },
];

function setStatusFilter(value: unknown) {
  statusFilter.value = value == null ? undefined : String(value);
}

const filteredTasks = computed(() => {
  if (!statusFilter.value) return tasks.value;
  return tasks.value.filter((t) => t.status === statusFilter.value);
});

async function refresh() {
  loading.value = true;
  try {
    const result = await listTasks(projectStore.currentProjectId || undefined);
    tasks.value = result.data || [];
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
}

async function handleCreate() {
  if (!createForm.value.title.trim() || !createForm.value.prompt.trim()) {
    message.warning("请填写标题和任务描述");
    return;
  }

  const projectId = projectStore.currentProjectId;
  if (!projectId) {
    message.error("未找到可用项目，请先创建或选择项目");
    return;
  }

  creating.value = true;
  try {
    const result = await createTask({
      title: createForm.value.title,
      prompt: createForm.value.prompt,
      projectId,
    });

    message.success("任务创建成功");
    showCreateModal.value = false;

    // Auto-execute if selected
    if (createForm.value.autoExecute && result.id) {
      try {
        await executeTask(result.id);
        message.success("Agent 已开始执行");
      } catch (e) {
        message.warning(`任务已创建，但启动执行失败: ${e}`);
      }
    }

    // Reset form and refresh
    createForm.value = { title: "", prompt: "", autoExecute: true };
    await refresh();
  } catch (e) {
    message.error(`创建失败: ${e}`);
  } finally {
    creating.value = false;
  }
}

async function handleExecute(taskId: string) {
  executingId.value = taskId;
  try {
    await executeTask(taskId);
    message.success("Agent 已开始执行");
    await refresh();
  } catch (e) {
    message.error(`执行失败: ${e}`);
  } finally {
    executingId.value = null;
  }
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    pending: "default",
    running: "blue",
    completed: "green",
    failed: "red",
    paused: "orange",
    cancelled: "default",
  };
  return map[status] || "default";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: "待执行",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    paused: "已暂停",
    cancelled: "已取消",
  };
  return map[status] || status;
}

function formatTime(ts: string) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

onMounted(async () => {
  if (projectStore.projects.length === 0) {
    await projectStore.loadProjects();
  }
});

watch(
  () => projectStore.currentProjectId,
  (projectId) => {
    if (!projectId) {
      tasks.value = [];
      return;
    }
    void refresh();
  },
  { immediate: true },
);
</script>
