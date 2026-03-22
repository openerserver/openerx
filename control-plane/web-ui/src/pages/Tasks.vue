<template>
  <div style="padding: 24px">
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="3" style="margin: 0">任务列表</a-typography-title>
      <a-space>
        <a-input-search
          :value="searchText"
          placeholder="搜索标题 / 仓库"
          style="width: 220px"
          allow-clear
          @update:value="searchText = String($event ?? '')"
        />
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
          <a-select-option value="cancelled">已取消</a-select-option>
        </a-select>
        <a-button @click="refresh" :loading="loading">
          <template #icon><SyncOutlined :spin="!!autoRefreshTimer" /></template>
          {{ autoRefreshTimer ? '自动刷新中' : '刷新' }}
        </a-button>
        <a-button v-if="projectStore.currentProjectId" @click="router.push(`/projects/${projectStore.currentProjectId}/recommended-scenarios`)">
          推荐场景
        </a-button>
        <a-button v-if="projectStore.currentProjectId" @click="router.push(`/projects/${projectStore.currentProjectId}/task-graph`)">
          任务总图
        </a-button>
        <a-button type="primary" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          新建任务
        </a-button>
      </a-space>
    </a-flex>

    <a-alert
      v-if="loadError"
      type="error"
      :message="loadError"
      show-icon
      closable
      style="margin-bottom: 16px"
      @close="loadError = ''"
    />

    <a-alert
      v-if="truncated"
      type="warning"
      show-icon
      style="margin-bottom: 16px"
    >
      <template #message>
        当前仅显示最近 {{ TASK_LIST_LIMIT }} 条任务，更早的记录已被截断。可通过状态筛选缩小范围。
      </template>
    </a-alert>

    <a-table
      :data-source="filteredTasks"
      :columns="columns"
      :loading="loading"
      :pagination="{ pageSize: 20 }"
      row-key="id"
      size="middle"
    >
      <template #emptyText>
        <a-empty :description="statusFilter ? '当前筛选条件下没有任务' : '暂无任务'">
          <a-button v-if="!statusFilter" type="primary" @click="showCreateModal = true">
            新建第一个任务
          </a-button>
        </a-empty>
      </template>
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <a-tooltip placement="topLeft" :overlayStyle="{ maxWidth: '480px' }">
            <template #title>
              <div style="white-space: pre-wrap; max-height: 300px; overflow-y: auto; font-size: 13px">{{ record.prompt || '无描述' }}</div>
            </template>
            <router-link :to="`/workbench?task=${record.id}`">
              {{ record.title }}
            </router-link>
          </a-tooltip>
        </template>

        <template v-if="column.key === 'projectName'">
          {{ getProjectName(record.projectId) }}
        </template>

        <template v-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
        </template>

        <template v-if="column.key === 'repoName'">
          {{ record.repoName || '-' }}
        </template>

        <template v-if="column.key === 'duration'">
          {{ formatDuration(record) }}
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
            <a-popconfirm
              v-if="record.status === 'running' || record.status === 'pending'"
              title="确定取消该任务？"
              ok-text="确定"
              cancel-text="返回"
              @confirm="handleCancel(record.id)"
            >
              <a-button danger size="small" :loading="cancellingId === record.id">
                取消
              </a-button>
            </a-popconfirm>
            <a-button
              v-if="record.status === 'failed' || record.status === 'completed'"
              size="small"
              @click="handleContinue(record.id)"
            >续跑</a-button>
            <router-link :to="`/workbench?task=${record.id}`">
              <a-button type="link" size="small">工作台</a-button>
            </router-link>
            <router-link :to="`/multi-task-monitor?task=${record.id}`">
              <a-button type="link" size="small">监控台</a-button>
            </router-link>
            <router-link :to="`/tasks/${record.id}/v2`">
              <a-button type="link" size="small">精简视图</a-button>
            </router-link>
            <router-link :to="`/tasks/${record.id}/v3`">
              <a-button type="link" size="small">V3 视图</a-button>
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
        <a-form-item label="任务运行档位">
          <a-card size="small" :body-style="{ padding: '12px 16px' }">
            <a-space direction="vertical" style="width: 100%" size="small">
              <a-typography-text type="secondary">
                {{ operatingModeSummary }}
              </a-typography-text>
              <a-space wrap>
                <a-button v-if="projectStore.currentProjectId" size="small" @click="openScenarioLauncher">
                  打开推荐场景
                </a-button>
                <a-button v-if="createForm.operatingMode" size="small" @click="clearOperatingModeSelection">
                  清空临时档位
                </a-button>
              </a-space>
            </a-space>
          </a-card>
        </a-form-item>
        <a-form-item v-if="relationContextSummary" label="默认关系写入">
          <a-card size="small" :body-style="{ padding: '12px 16px' }">
            <a-space direction="vertical" style="width: 100%" size="small">
              <a-typography-text type="secondary">
                {{ relationContextSummary }}
              </a-typography-text>
              <a-space wrap>
                <a-button size="small" @click="clearRelationContextSelection">
                  清空默认关系
                </a-button>
              </a-space>
            </a-space>
          </a-card>
        </a-form-item>
        <a-form-item label="关联仓库">
          <a-select
            :value="createForm.repoId"
            placeholder="选择仓库（可选）"
            allow-clear
            style="width: 100%"
            @update:value="createForm.repoId = $event != null ? String($event) : undefined"
          >
            <a-select-option v-for="r in repos" :key="r.id" :value="r.id">
              {{ r.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item v-if="createForm.repoId" label="工作分支">
          <a-input
            :value="createForm.workingBranch"
            placeholder="例：feature/login-optimization（可选）"
            :maxlength="100"
            @update:value="createForm.workingBranch = String($event ?? '')"
          />
        </a-form-item>
        <a-form-item v-if="createForm.repoId" label="执行凭证">
          <a-select
            :value="createForm.credentialId"
            placeholder="选择凭证（可选，使用默认凭证）"
            allow-clear
            style="width: 100%"
            @update:value="createForm.credentialId = $event != null ? String($event) : undefined"
          >
            <a-select-opt-group v-if="projectCredentials.length" label="项目默认">
              <a-select-option v-for="c in projectCredentials" :key="c.id" :value="c.id">
                {{ c.label }} ({{ c.provider }})
                <a-tag v-if="c.isDefault" color="blue" style="margin-left: 4px">推荐</a-tag>
              </a-select-option>
            </a-select-opt-group>
            <a-select-opt-group v-if="sharedCredentials.length" label="平台托管">
              <a-select-option v-for="c in sharedCredentials" :key="c.id" :value="c.id">
                {{ c.label }} ({{ c.provider }})
              </a-select-option>
            </a-select-opt-group>
          </a-select>
          <div v-if="selectedCredential" :style="tasksThemeStyles.credentialSummary">
            <a-typography-text type="secondary" :style="tasksThemeStyles.credentialSummaryText">
              预设身份：{{ selectedCredential.gitAuthorName || '未设置' }}
              <template v-if="selectedCredential.gitAuthorEmail">
                &lt;{{ selectedCredential.gitAuthorEmail }}&gt;
              </template>
              · 作用域：{{ selectedCredential.scope === 'project' ? '项目默认' : '平台托管' }}
            </a-typography-text>
          </div>
          <div style="margin-top: 4px">
            <a-typography-text type="secondary" style="font-size: 12px">
              凭证决定用谁的权限访问仓库，提交显示身份由下方"提交显示身份"决定。
            </a-typography-text>
          </div>
        </a-form-item>
        <!-- Identity Override (collapsed by default) -->
        <a-collapse v-if="createForm.repoId" :bordered="false" style="margin-bottom: 24px; background: transparent">
          <a-collapse-panel key="identity" header="提交显示身份（默认继承执行凭证预设身份）">
            <a-typography-text type="secondary" style="display: block; margin-bottom: 12px; font-size: 12px">
              <template v-if="!identityOverrideActive">留空将自动使用执行凭证上的预设身份。</template>
              <template v-else>
                <a-tag color="orange" style="margin-right: 4px">覆盖</a-tag>将覆盖凭证预设身份
              </template>
            </a-typography-text>
            <a-row :gutter="12">
              <a-col :span="12">
                <a-form-item label="Author Name">
                  <a-input
                    :value="createForm.gitAuthorName"
                    :maxlength="200"
                    placeholder="留空继承凭证预设"
                    @update:value="createForm.gitAuthorName = String($event ?? '')"
                  />
                </a-form-item>
              </a-col>
              <a-col :span="12">
                <a-form-item label="Author Email">
                  <a-input
                    :value="createForm.gitAuthorEmail"
                    :maxlength="200"
                    placeholder="留空继承凭证预设"
                    @update:value="createForm.gitAuthorEmail = String($event ?? '')"
                  />
                </a-form-item>
              </a-col>
              <a-col :span="12">
                <a-form-item label="Committer Name">
                  <a-input
                    :value="createForm.gitCommitterName"
                    :maxlength="200"
                    placeholder="留空继承凭证预设"
                    @update:value="createForm.gitCommitterName = String($event ?? '')"
                  />
                </a-form-item>
              </a-col>
              <a-col :span="12">
                <a-form-item label="Committer Email">
                  <a-input
                    :value="createForm.gitCommitterEmail"
                    :maxlength="200"
                    placeholder="留空继承凭证预设"
                    @update:value="createForm.gitCommitterEmail = String($event ?? '')"
                  />
                </a-form-item>
              </a-col>
            </a-row>
          </a-collapse-panel>
        </a-collapse>
        <a-form-item label="任务模板">
          <a-space style="width: 100%" direction="horizontal">
            <a-select
              :value="undefined"
              placeholder="从模板填充（可选）"
              allow-clear
              style="flex: 1; min-width: 200px"
              @update:value="applyTemplate($event)"
            >
              <a-select-option v-for="(tpl, idx) in taskTemplates" :key="idx" :value="idx">
                {{ tpl.name }}
              </a-select-option>
            </a-select>
            <a-button
              v-if="taskTemplates.length"
              size="small"
              danger
              @click="showDeleteTemplate = !showDeleteTemplate"
            >
              管理
            </a-button>
          </a-space>
          <div v-if="showDeleteTemplate && taskTemplates.length" :style="tasksThemeStyles.templateManager">
            <div v-for="(tpl, idx) in taskTemplates" :key="idx" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0">
              <span>{{ tpl.name }}</span>
              <a-button size="small" danger type="text" @click="removeTemplate(idx)">删除</a-button>
            </div>
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
          <div v-if="commandsData.length" style="margin-bottom: 8px">
            <a-select
              :value="selectedCommand"
              placeholder="选择命令前缀（可选）"
              allow-clear
              style="width: 100%"
              @update:value="applyCommand($event)"
            >
              <a-select-option v-for="cmd in commandsData" :key="cmd.name" :value="cmd.name">
                /{{ cmd.name }} — {{ cmd.description }}
              </a-select-option>
            </a-select>
            <div style="margin-top: 4px">
              <a-typography-text type="secondary" style="font-size: 12px">
                选择命令后将在 Prompt 开头添加 <code>/命令名</code>，Agent 会按预定义流程执行
              </a-typography-text>
            </div>
          </div>
          <a-textarea
            :value="createForm.prompt"
            placeholder="详细描述需要 Agent 完成的任务..."
            :rows="8"
            :maxlength="50000"
            show-count
            @update:value="createForm.prompt = String($event ?? '')"
          />
          <a-button
            v-if="createForm.title.trim() && createForm.prompt.trim()"
            size="small"
            style="margin-top: 8px"
            @click="saveAsTemplate"
          >
            存为模板
          </a-button>
        </a-form-item>
        <a-form-item label="执行模型">
          <a-select
            :value="createForm.selectedModel"
            placeholder="使用项目/系统默认模型"
            allow-clear
            show-search
            :filter-option="filterModelOption"
            style="width: 100%"
            :loading="modelsLoading"
            @update:value="createForm.selectedModel = $event != null ? String($event) : undefined"
          >
            <a-select-option v-for="m in modelOptions" :key="m.value" :value="m.value">
              {{ m.label }}
            </a-select-option>
          </a-select>
          <div style="margin-top: 4px">
            <a-typography-text type="secondary" style="font-size: 12px">
              不选择则按优先级使用：项目默认模型 → 系统默认模型
            </a-typography-text>
          </div>
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

    <!-- Execution Mode Modal -->
    <ExecutionModeModal
      :open="showExecutionModeModal"
      :loading="!!executingId"
      :model-options="modelOptions"
      :models-loading="modelsLoading"
      :filter-model-option="filterModelOption"
      @update:open="showExecutionModeModal = $event"
      @confirm="handleExecutionModeConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { PlusOutlined, SyncOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import ExecutionModeModal from "../components/ExecutionModeModal.vue";
import { useRoute, useRouter } from "vue-router";
import {
  ApiError,
  type AutopilotLevel,
  type BossParticipationMode,
  type ChainStepInput,
  type CollaborationMode,
  type CommandSummary,
  type ExecutionMode,
  type OperatingModeSelection,
  type RecommendedOperatingProfile,
  type Repository,
  type RepositoryCredential,
  TASK_LIST_LIMIT,
  type Task,
  createTask,
  executeTask,
  getModelsList,
  getOrchestrationStrategy,
  getTask,
  getTaskExecutionPreflight,
  listCommands,
  listCredentials,
  listRepositories,
  listTasks,
  updateTask,
  updateTaskStatus,
} from "../lib/api";
import { showRuntimeRecoveryNotice } from "../lib/runtime-recovery";
import { RUNTIME_RECOVERY_ERROR_PREFIX } from "../lib/runtime-recovery-contract";
import { RUNTIME_RECOVERY_CONTEXTS } from "../lib/runtime-recovery-notice";
import { useProjectStore } from "../stores/project";
import { tasksThemeStyles } from "../theme/ui-theme";

const projectStore = useProjectStore();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const creating = ref(false);
const executingId = ref<string | null>(null);
const cancellingId = ref<string | null>(null);
const tasks = ref<Task[]>([]);
const statusFilter = ref<string | undefined>(undefined);
const searchText = ref("");
const loadError = ref("");
const truncated = ref(false);
const showCreateModal = ref(false);
const modelsLoading = ref(false);
const modelsData = ref<Array<Record<string, unknown>> | null>(null);
const EXECUTION_SETTLE_TIMEOUT_MS = 3000;
const EXECUTION_SETTLE_INTERVAL_MS = 200;
const AUTO_REFRESH_INTERVAL_MS = 8000;

const showExecutionModeModal = ref(false);
const executionModeTargetTaskId = ref<string | null>(null);
type ExecutionOverrides = {
  mode: ExecutionMode;
  candidates?: Array<{ model: string; label?: string }>;
  steps?: ChainStepInput[];
} | null;
const pendingExecutionOverrides = ref<ExecutionOverrides>(null);

const autoRefreshTimer = ref<ReturnType<typeof setInterval> | null>(null);
const hasActiveTasks = computed(() =>
  tasks.value.some((t) => t.status === "running" || t.status === "pending"),
);

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer.value = setInterval(async () => {
    if (loading.value) return;
    try {
      const result = await listTasks(projectStore.currentProjectId || undefined);
      const data = result.data || [];
      tasks.value = data;
      truncated.value = data.length >= TASK_LIST_LIMIT;
    } catch {
      // Silently ignore auto-refresh errors
    }
    // Stop polling if no more active tasks
    if (!hasActiveTasks.value) {
      stopAutoRefresh();
    }
  }, AUTO_REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimer.value) {
    clearInterval(autoRefreshTimer.value);
    autoRefreshTimer.value = null;
  }
}

function maybeStartAutoRefresh() {
  if (hasActiveTasks.value && !autoRefreshTimer.value) {
    startAutoRefresh();
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function upsertTaskSnapshot(snapshot: Partial<Task> & Pick<Task, "id">) {
  const index = tasks.value.findIndex((task) => task.id === snapshot.id);
  if (index >= 0) {
    tasks.value[index] = {
      ...tasks.value[index],
      ...snapshot,
    };
    return;
  }

  tasks.value.unshift({
    projectId: snapshot.projectId || projectStore.currentProjectId || "",
    userId: snapshot.userId || "",
    title: snapshot.title || "",
    prompt: snapshot.prompt || "",
    status: snapshot.status || "pending",
    createdAt: snapshot.createdAt || new Date().toISOString(),
    ...snapshot,
    id: snapshot.id,
  });
}

async function waitForExecutionState(taskId: string) {
  const deadline = Date.now() + EXECUTION_SETTLE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const latestTask = await getTask(taskId);
      if (
        latestTask.status !== "pending" ||
        latestTask.agentRunId ||
        latestTask.sessionId ||
        latestTask.startedAt ||
        latestTask.strategy
      ) {
        return latestTask;
      }
    } catch {
      // Ignore transient fetch errors during the short settle window.
    }

    await sleep(EXECUTION_SETTLE_INTERVAL_MS);
  }

  return undefined;
}

async function loadRepos() {
  const pid = projectStore.currentProjectId;
  if (!pid) return;
  try {
    const result = await listRepositories(pid);
    repos.value = (result.data || []).filter((r: Repository) => r.status === "active");
  } catch {
    repos.value = [];
  }
}

async function loadModels() {
  modelsLoading.value = true;
  try {
    const result = await getModelsList();
    modelsData.value = result?.data ?? null;
  } catch {
    modelsData.value = null;
  } finally {
    modelsLoading.value = false;
  }
}

const modelOptions = computed(() => {
  return (modelsData.value || [])
    .map((model) => {
      const id = typeof model.id === "string" ? model.id : "";
      if (!id) return null;
      const name = typeof model.name === "string" ? model.name : "";
      const provider = typeof model.provider === "string" ? model.provider : "";
      const meta = [name, provider].filter(Boolean).join(" / ");
      return {
        value: id,
        label: meta ? `${id} (${meta})` : id,
      };
    })
    .filter((option): option is { value: string; label: string } => Boolean(option));
});

function filterModelOption(input: string, option?: unknown) {
  const keyword = input.toLowerCase();
  const normalized = option as { value?: string | number | null; label?: string | number | null } | undefined;
  return (
    String(normalized?.value ?? "").toLowerCase().includes(keyword) ||
    String(normalized?.label ?? "").toLowerCase().includes(keyword)
  );
}

const commandsData = ref<CommandSummary[]>([]);
const selectedCommand = ref<string | undefined>(undefined);

async function loadCommands() {
  try {
    const result = await listCommands();
    commandsData.value = result?.data ?? [];
  } catch {
    commandsData.value = [];
  }
}

function applyCommand(cmdName: unknown) {
  if (cmdName == null) {
    selectedCommand.value = undefined;
    // Remove leading /command from prompt if present
    const prompt = createForm.value.prompt;
    const match = prompt.match(/^\/\S+\s?/);
    if (match) {
      createForm.value.prompt = prompt.slice(match[0].length);
    }
    return;
  }
  const name = String(cmdName);
  selectedCommand.value = name;
  const prompt = createForm.value.prompt;
  // Replace existing /command prefix or prepend
  const replaced = prompt.replace(/^\/\S+\s?/, "");
  createForm.value.prompt = `/${name} ${replaced}`;
}

watch(showCreateModal, (open) => {
  if (open) {
    loadRepos();
    if (!modelsData.value) loadModels();
    if (!commandsData.value.length) loadCommands();
  }
});

type CreateTaskForm = {
  title: string;
  prompt: string;
  autoExecute: boolean;
  repoId?: string;
  workingBranch: string;
  credentialId?: string;
  selectedModel?: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
  gitCommitterName: string;
  gitCommitterEmail: string;
  relationContext?: {
    spawnedFromTaskId?: string;
    dependsOnTaskIds?: string[];
    blockedByTaskIds?: string[];
    blocksTaskIds?: string[];
    metadata?: Record<string, unknown>;
  };
  operatingMode?: OperatingModeSelection;
};

function createInitialForm(): CreateTaskForm {
  return {
    title: "",
    prompt: "",
    autoExecute: true,
    repoId: undefined,
    workingBranch: "",
    credentialId: undefined,
    selectedModel: undefined,
    gitAuthorName: "",
    gitAuthorEmail: "",
    gitCommitterName: "",
    gitCommitterEmail: "",
    relationContext: undefined,
    operatingMode: undefined,
  };
}

const createForm = ref<CreateTaskForm>(createInitialForm());
const recommendedProfiles = ref<RecommendedOperatingProfile[]>([]);

const operatingModeSummary = computed(() => {
  const mode = createForm.value.operatingMode;
  if (!mode) {
    return "当前未设置任务级临时档位，将沿用项目默认或系统默认。";
  }
  const scenarioLabel = mode.scenarioKey ? ` · 场景 ${mode.scenarioKey}` : "";
  const templateLabel = mode.selectedTemplateId ? ` · 模板 ${mode.selectedTemplateId}` : "";
  return `协作 ${mode.collaborationMode} · 托管 ${mode.autopilotLevel} · 老板 ${mode.bossParticipationMode}${scenarioLabel}${templateLabel}`;
});

const relationContextSummary = computed(() => {
  const relationContext = createForm.value.relationContext;
  if (!relationContext) {
    return "";
  }

  const parts: string[] = [];
  if (relationContext.spawnedFromTaskId) {
    parts.push(`派生自 ${relationContext.spawnedFromTaskId}`);
  }
  if ((relationContext.dependsOnTaskIds || []).length > 0) {
    parts.push(`默认依赖 ${(relationContext.dependsOnTaskIds || []).join("、")}`);
  }
  if ((relationContext.blockedByTaskIds || []).length > 0) {
    parts.push(`默认被 ${(relationContext.blockedByTaskIds || []).join("、")} 阻塞`);
  }
  if ((relationContext.blocksTaskIds || []).length > 0) {
    parts.push(`默认阻塞 ${(relationContext.blocksTaskIds || []).join("、")}`);
  }
  return parts.join("；");
});

const repos = ref<Repository[]>([]);
const repoCredentials = ref<RepositoryCredential[]>([]);

const selectedCredential = computed(() => {
  const cid = createForm.value.credentialId;
  if (!cid) return null;
  return repoCredentials.value.find((c) => c.id === cid) || null;
});

const projectCredentials = computed(() =>
  repoCredentials.value.filter((c) => c.scope === "project"),
);
const sharedCredentials = computed(() => repoCredentials.value.filter((c) => c.scope === "shared"));

const identityOverrideActive = computed(
  () =>
    !!(
      createForm.value.gitAuthorName ||
      createForm.value.gitAuthorEmail ||
      createForm.value.gitCommitterName ||
      createForm.value.gitCommitterEmail
    ),
);

async function loadRepoCredentials() {
  const pid = projectStore.currentProjectId;
  if (!pid) {
    repoCredentials.value = [];
    return;
  }
  try {
    const result = await listCredentials(pid);
    repoCredentials.value = (result.data || []).filter(
      (c: RepositoryCredential) => c.status === "active",
    );
  } catch {
    repoCredentials.value = [];
  }
}

function getCreateProjectId(): string | undefined {
  const form = createForm.value;
  if (!form.title.trim() || !form.prompt.trim()) {
    message.warning("请填写标题和任务描述");
    return undefined;
  }

  const projectId = projectStore.currentProjectId;
  if (!projectId) {
    message.error("未找到可用项目，请先创建或选择项目");
    return undefined;
  }

  return projectId;
}

function buildCreatePayload(projectId: string) {
  const form = createForm.value;

  return {
    title: form.title,
    prompt: form.prompt,
    projectId,
    ...(form.repoId ? { repoId: form.repoId } : {}),
    ...(form.workingBranch ? { workingBranch: form.workingBranch } : {}),
    ...(form.credentialId ? { credentialId: form.credentialId } : {}),
    ...(form.selectedModel ? { selectedModel: form.selectedModel } : {}),
    ...(form.gitAuthorName ? { gitAuthorName: form.gitAuthorName } : {}),
    ...(form.gitAuthorEmail ? { gitAuthorEmail: form.gitAuthorEmail } : {}),
    ...(form.gitCommitterName ? { gitCommitterName: form.gitCommitterName } : {}),
    ...(form.gitCommitterEmail ? { gitCommitterEmail: form.gitCommitterEmail } : {}),
    ...(form.relationContext ? { relationContext: form.relationContext } : {}),
    ...(form.operatingMode ? { operatingMode: form.operatingMode } : {}),
  };
}

async function autoExecuteCreatedTask(taskId?: string) {
  if (!createForm.value.autoExecute || !taskId) {
    return undefined;
  }

  try {
    const latestTask = await attemptTaskExecution(taskId, true);
    if (latestTask === null) {
      return undefined;
    }

    message.success("Agent 已开始执行");
    if (latestTask) {
      upsertTaskSnapshot(latestTask);
    }
    return latestTask;
  } catch (e) {
    if (
      showRuntimeRecoveryNotice(e, {
        context: RUNTIME_RECOVERY_CONTEXTS.taskCreateExecute,
        router,
      })
    ) {
      message.warning("任务已创建，待你修复模型配置后可再次执行", 6);
    } else {
      const msg = String(e instanceof Error ? e.message : e);
      message.warning(`任务已创建，但启动执行失败: ${msg}`);
    }
    return undefined;
  }
}

async function runTaskExecution(taskId: string, overrides?: ExecutionOverrides) {
  await executeTask(taskId, overrides ?? undefined);
  upsertTaskSnapshot({
    id: taskId,
    status: "running",
    startedAt: new Date().toISOString(),
  });

  return waitForExecutionState(taskId);
}

async function attemptTaskExecution(taskId: string, fromAutoCreate = false) {
  const preflight = await getTaskExecutionPreflight(taskId);
  if (preflight.allowed) {
    return runTaskExecution(taskId, fromAutoCreate ? undefined : pendingExecutionOverrides.value);
  }

  if (
    preflight.preflight.guardDecision === "allow-with-downgrade" &&
    preflight.policy.suggestedModel
  ) {
    const confirmed = window.confirm(
      `当前模型需要先降级后才能执行。\n\n建议切换到 ${preflight.policy.suggestedModel} 并立即重试。\n\n原因：${preflight.preflight.guardReason}`,
    );

    if (!confirmed) {
      return null;
    }

    await updateTask(taskId, { selectedModel: preflight.policy.suggestedModel });
    upsertTaskSnapshot({ id: taskId, selectedModel: preflight.policy.suggestedModel });

    const retriedPreflight = await getTaskExecutionPreflight(taskId);
    if (!retriedPreflight.allowed) {
      throw new ApiError({
        error: retriedPreflight.preflight.guardReason,
        code: retriedPreflight.preflight.guardDecision,
        status: 409,
      });
    }

    message.success(
      fromAutoCreate ? "已自动降级模型并重试执行" : "已切换到低成本模型，正在重试执行",
    );
    return runTaskExecution(taskId, fromAutoCreate ? undefined : pendingExecutionOverrides.value);
  }

  throw new ApiError({
    error: preflight.preflight.guardReason,
    code: preflight.preflight.guardDecision,
    status: preflight.preflight.guardDecision === "allow-with-downgrade" ? 409 : 403,
  });
}

function resetCreateForm() {
  createForm.value = createInitialForm();
  selectedCommand.value = undefined;
}

function clearOperatingModeSelection() {
  createForm.value.operatingMode = undefined;
}

function clearRelationContextSelection() {
  createForm.value.relationContext = undefined;
}

function openScenarioLauncher() {
  if (!projectStore.currentProjectId) {
    message.warning("请先选择项目");
    return;
  }
  void router.push(`/projects/${projectStore.currentProjectId}/recommended-scenarios`);
}

function buildScenarioOperatingMode(profile: RecommendedOperatingProfile): OperatingModeSelection {
  return {
    collaborationMode: profile.collaborationMode as CollaborationMode,
    autopilotLevel: profile.autopilotLevel as AutopilotLevel,
    bossParticipationMode: profile.bossParticipationMode as BossParticipationMode,
    selectedTemplateId: profile.templateHints?.[0] || null,
    scenarioKey: profile.scenarioKey,
    source: "task-override",
  };
}

async function loadRecommendedProfiles() {
  if (recommendedProfiles.value.length > 0) {
    return;
  }
  try {
    const result = await getOrchestrationStrategy();
    recommendedProfiles.value = result.data.organizationSettings?.recommendedProfiles || [];
  } catch {
    recommendedProfiles.value = [];
  }
}

async function applyScenarioQuerySelection() {
  const scenarioKey = typeof route.query.scenarioKey === "string" ? route.query.scenarioKey : "";
  const openCreate = route.query.openCreate === "1";
  const projectId = typeof route.query.projectId === "string" ? route.query.projectId : "";
  const relationContext = readRelationContextFromRouteQuery(route.query);

  if (!scenarioKey) {
    if (relationContext) {
      createForm.value.relationContext = relationContext;
    }
    if (openCreate || relationContext) {
      showCreateModal.value = true;
    }
    return;
  }

  if (projectId) {
    projectStore.switchProject(projectId);
  }

  await loadRecommendedProfiles();
  const matchedProfile = recommendedProfiles.value.find((item) => item.scenarioKey === scenarioKey);
  if (!matchedProfile) {
    if (relationContext) {
      createForm.value.relationContext = relationContext;
    }
    return;
  }

  createForm.value.operatingMode = buildScenarioOperatingMode(matchedProfile);
  if (relationContext) {
    createForm.value.relationContext = relationContext;
  }
  showCreateModal.value = true;
}

function readRelationContextFromRouteQuery(query: Record<string, unknown>) {
  const spawnedFromTaskId = readQueryString(query.spawnedFromTaskId);
  const dependsOnTaskIds = readQueryTaskIdList(query.dependsOnTaskIds ?? query.dependsOnTaskId);
  const blockedByTaskIds = readQueryTaskIdList(query.blockedByTaskIds ?? query.blockedByTaskId);
  const blocksTaskIds = readQueryTaskIdList(query.blocksTaskIds ?? query.blocksTaskId);

  if (
    !spawnedFromTaskId &&
    dependsOnTaskIds.length === 0 &&
    blockedByTaskIds.length === 0 &&
    blocksTaskIds.length === 0
  ) {
    return undefined;
  }

  return {
    ...(spawnedFromTaskId ? { spawnedFromTaskId } : {}),
    ...(dependsOnTaskIds.length > 0 ? { dependsOnTaskIds } : {}),
    ...(blockedByTaskIds.length > 0 ? { blockedByTaskIds } : {}),
    ...(blocksTaskIds.length > 0 ? { blocksTaskIds } : {}),
  };
}

function readQueryTaskIdList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap((item) => readQueryTaskIdList(item))));
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function readQueryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// ── Task Templates (localStorage) ──────────────────────────────────

type TaskTemplate = { name: string; title: string; prompt: string };
const TEMPLATE_STORAGE_KEY = "openerx-task-templates";
const DEFAULT_TASK_TEMPLATES: TaskTemplate[] = [
  {
    name: "常规缺陷修复",
    title: "修复线上问题",
    prompt: "请先定位问题根因，给出最小必要修复。\n补充受影响范围、回归风险和验证步骤。",
  },
  {
    name: "功能开发",
    title: "实现新功能",
    prompt:
      "请先梳理需求和边界条件，再实现功能代码。\n同时补充必要测试，并说明使用方式和影响范围。",
  },
  {
    name: "运维排障",
    title: "排查运行异常",
    prompt:
      "请先收集现象、日志和可能原因，按优先级给出排查过程。\n如果需要修改配置或代码，请说明风险、回滚方式和验证步骤。",
  },
];

function sanitizeTemplates(value: unknown): TaskTemplate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { name, title, prompt } = item as Record<string, unknown>;
    if (
      typeof name !== "string" ||
      typeof title !== "string" ||
      typeof prompt !== "string" ||
      !name.trim() ||
      !title.trim() ||
      !prompt.trim()
    ) {
      return [];
    }
    return [{ name: name.trim(), title: title.trim(), prompt: prompt.trim() }];
  });
}

function loadTemplates(): TaskTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return DEFAULT_TASK_TEMPLATES;
    return sanitizeTemplates(JSON.parse(raw));
  } catch {
    return DEFAULT_TASK_TEMPLATES;
  }
}

function persistTemplates(list: TaskTemplate[]) {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(list));
}

const taskTemplates = ref<TaskTemplate[]>(loadTemplates());
const showDeleteTemplate = ref(false);

function applyTemplate(idx: unknown) {
  if (idx == null) return;
  const tpl = taskTemplates.value[Number(idx)];
  if (!tpl) return;
  createForm.value.title = tpl.title;
  createForm.value.prompt = tpl.prompt;
}

function saveAsTemplate() {
  const { title, prompt } = createForm.value;
  if (!title.trim() || !prompt.trim()) return;
  const name = title.trim().slice(0, 40);
  const list = [...taskTemplates.value, { name, title: title.trim(), prompt: prompt.trim() }];
  taskTemplates.value = list;
  persistTemplates(list);
  message.success("已存为模板");
}

function removeTemplate(idx: number) {
  const list = taskTemplates.value.filter((_, i) => i !== idx);
  taskTemplates.value = list;
  persistTemplates(list);
  if (list.length === 0) showDeleteTemplate.value = false;
}

watch(
  () => createForm.value.repoId,
  () => {
    createForm.value.credentialId = undefined;
    if (createForm.value.repoId) loadRepoCredentials();
    else repoCredentials.value = [];
  },
);

const columns = [
  { title: "标题", key: "title", dataIndex: "title", ellipsis: true },
  { title: "项目", key: "projectName", width: 140, ellipsis: true },
  { title: "状态", key: "status", dataIndex: "status", width: 100 },
  { title: "仓库", key: "repoName", dataIndex: "repoName", width: 140, ellipsis: true },
  { title: "耗时", key: "duration", width: 120 },
  {
    title: "创建时间",
    key: "createdAt",
    dataIndex: "createdAt",
    width: 180,
    sorter: (a: Task, b: Task) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    defaultSortOrder: "descend" as const,
  },
  { title: "操作", key: "actions", width: 280 },
];

function setStatusFilter(value: unknown) {
  statusFilter.value = value == null ? undefined : String(value);
}

function getProjectName(projectId: string): string {
  const project = projectStore.projects.find((p) => p.id === projectId);
  return project?.name || projectId;
}

const filteredTasks = computed(() => {
  let result = tasks.value;
  if (statusFilter.value) {
    result = result.filter((t) => t.status === statusFilter.value);
  }
  const keyword = searchText.value.trim().toLowerCase();
  if (keyword) {
    result = result.filter(
      (t) => t.title.toLowerCase().includes(keyword) || t.repoName?.toLowerCase().includes(keyword),
    );
  }
  return result;
});

async function refresh() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await listTasks(projectStore.currentProjectId || undefined);
    const data = result.data || [];
    tasks.value = data;
    truncated.value = data.length >= TASK_LIST_LIMIT;
    maybeStartAutoRefresh();
  } catch (e) {
    loadError.value = `加载任务列表失败: ${e}`;
  } finally {
    loading.value = false;
  }
}

async function handleCreate() {
  const projectId = getCreateProjectId();
  if (!projectId) {
    return;
  }

  creating.value = true;
  try {
    const optimisticTask = {
      projectId,
      userId: "",
      title: createForm.value.title,
      prompt: createForm.value.prompt,
      status: "pending",
      createdAt: new Date().toISOString(),
      repoName: repos.value.find((repo) => repo.id === createForm.value.repoId)?.name || undefined,
    } satisfies Partial<Task>;
    const result = await createTask(buildCreatePayload(projectId));

    upsertTaskSnapshot({
      ...optimisticTask,
      id: result.id,
    });

    message.success("任务创建成功");
    showCreateModal.value = false;

    const startedTask = await autoExecuteCreatedTask(result.id);
    resetCreateForm();
    await refresh();
    if (startedTask) {
      upsertTaskSnapshot(startedTask);
    }
  } catch (e) {
    message.error(`创建失败: ${e}`);
  } finally {
    creating.value = false;
  }
}

function handleExecute(taskId: string) {
  executionModeTargetTaskId.value = taskId;
  pendingExecutionOverrides.value = null;
  if (!modelsData.value) loadModels();
  showExecutionModeModal.value = true;
}

async function handleExecutionModeConfirm(overrides: ExecutionOverrides) {
  showExecutionModeModal.value = false;
  const taskId = executionModeTargetTaskId.value;
  if (!taskId) return;
  executionModeTargetTaskId.value = null;
  pendingExecutionOverrides.value = overrides;
  executingId.value = taskId;
  try {
    const latestTask = await attemptTaskExecution(taskId);
    if (latestTask === null) {
      return;
    }

    message.success("Agent 已开始执行");
    await refresh();
    if (latestTask) {
      upsertTaskSnapshot(latestTask);
    }
  } catch (e) {
    if (
      showRuntimeRecoveryNotice(e, {
        context: RUNTIME_RECOVERY_CONTEXTS.taskExecute,
        router,
      })
    ) {
      return;
    }

    const msg = String(e instanceof Error ? e.message : e);
    if ((e as ApiError | null)?.code?.includes(RUNTIME_RECOVERY_ERROR_PREFIX)) {
      message.error(msg, 8);
    } else {
      message.error(`执行失败: ${msg}`);
    }
  } finally {
    executingId.value = null;
    pendingExecutionOverrides.value = null;
  }
}

async function handleCancel(taskId: string) {
  cancellingId.value = taskId;
  try {
    await updateTaskStatus(taskId, "cancelled");
    message.success("任务已取消");
    await refresh();
  } catch (e) {
    message.error(`取消失败: ${e}`);
  } finally {
    cancellingId.value = null;
  }
}

function handleContinue(taskId: string) {
  void router.push({
    path: "/workbench",
    query: {
      task: taskId,
      reply: "1",
    },
  });
}

function formatDuration(task: { startedAt?: string; finishedAt?: string }) {
  const start = task.startedAt ? new Date(task.startedAt).getTime() : 0;
  if (!start) return "-";
  const end = task.finishedAt ? new Date(task.finishedAt).getTime() : Date.now();
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  if (min < 60) return `${min}分${s}秒`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}时${m}分`;
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
  await applyScenarioQuerySelection();
});

onUnmounted(() => {
  stopAutoRefresh();
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

watch(
  () => route.query,
  () => {
    void applyScenarioQuerySelection();
  },
);
</script>
