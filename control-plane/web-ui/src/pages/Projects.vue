<template>
  <div style="padding: 24px">
    <!-- 标题操作区 -->
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <div>
        <a-typography-title :level="3" style="margin: 0">项目管理</a-typography-title>
        <a-typography-text type="secondary">统一查看项目状态、配置完整度与治理风险</a-typography-text>
      </div>
      <a-button v-if="canCreateProject" type="primary" @click="showCreateModal = true">
        <template #icon><PlusOutlined /></template>
        新建项目
      </a-button>
    </a-flex>

    <!-- 筛选工具区 -->
    <a-card size="small" style="margin-bottom: 16px">
      <a-flex wrap="wrap" gap="middle" align="center">
        <a-input-search
          :value="queryText"
          placeholder="搜索项目名称 / Slug"
          style="width: 220px"
          allow-clear
          @update:value="queryText = String($event ?? '')"
          @search="loadOverview()"
        />
        <a-select
          :value="selectedOrgId || undefined"
          placeholder="全部组织"
          style="width: 160px"
          allow-clear
          @update:value="selectedOrgId = String($event ?? ''); loadOverview()"
        >
          <a-select-option v-for="org in orgs" :key="org.id" :value="org.id">
            {{ org.name }}
          </a-select-option>
        </a-select>
        <a-select
          :value="selectedProjectStatus || undefined"
          placeholder="全部状态"
          style="width: 130px"
          allow-clear
          @update:value="selectedProjectStatus = String($event ?? ''); loadOverview()"
        >
          <a-select-option value="healthy">正常</a-select-option>
          <a-select-option value="pending_config">待配置</a-select-option>
          <a-select-option value="archived">已归档</a-select-option>
          <a-select-option value="error">异常</a-select-option>
        </a-select>
        <a-select
          :value="selectedConfigStatus || undefined"
          placeholder="配置状态"
          style="width: 130px"
          allow-clear
          @update:value="selectedConfigStatus = String($event ?? ''); loadOverview()"
        >
          <a-select-option value="configured">已配置</a-select-option>
          <a-select-option value="pending">待配置</a-select-option>
          <a-select-option value="risk">存在风险</a-select-option>
        </a-select>
        <a-select
          :value="selectedSortBy"
          style="width: 150px"
          @update:value="selectedSortBy = String($event ?? 'last_activity_desc'); loadOverview()"
        >
          <a-select-option value="last_activity_desc">最近活跃</a-select-option>
          <a-select-option value="created_at_desc">最近创建</a-select-option>
          <a-select-option value="name_asc">名称 A-Z</a-select-option>
        </a-select>
        <a-switch
          :checked="onlyManaged"
          checked-children="仅我管理"
          un-checked-children="全部"
          @update:checked="onlyManaged = !!$event; loadOverview()"
        />
        <a-button @click="resetFilters">重置</a-button>
      </a-flex>
    </a-card>

    <div
      v-if="summary && summary.totalProjects > 0"
      style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px"
      data-testid="projects-summary-cards"
    >
      <a-card size="small">
        <div style="font-size: 12px; color: #8c8c8c">项目总览</div>
        <div style="font-size: 24px; font-weight: 600">{{ summary.totalProjects }}</div>
        <div style="font-size: 12px; color: #8c8c8c">当前过滤结果中的项目总数</div>
      </a-card>
      <a-card size="small">
        <div style="font-size: 12px; color: #8c8c8c">待配置 / 风险</div>
        <div style="font-size: 24px; font-weight: 600">{{ summary.pendingConfigCount }} / {{ summary.riskCount }}</div>
        <div style="font-size: 12px; color: #8c8c8c">待补配置项目与存在治理风险项目</div>
      </a-card>
      <a-card size="small">
        <div style="font-size: 12px; color: #8c8c8c">活跃项目</div>
        <div style="font-size: 24px; font-weight: 600">{{ summary.activeProjectCount }}</div>
        <div style="font-size: 12px; color: #8c8c8c">有运行中任务、活动会话或最近 timeline 明细的项目数</div>
      </a-card>
      <a-card size="small">
        <div style="font-size: 12px; color: #8c8c8c">运行中 / 会话</div>
        <div style="font-size: 24px; font-weight: 600">{{ summary.runningTaskCount }} / {{ summary.activeSessionCount }}</div>
        <div style="font-size: 12px; color: #8c8c8c">运行中的任务总量与活动会话总量</div>
      </a-card>
      <a-card size="small">
        <div style="font-size: 12px; color: #8c8c8c">并行 / 链式任务</div>
        <div style="font-size: 24px; font-weight: 600">{{ summary.parallelTaskCount }} / {{ summary.sequentialChainTaskCount }}</div>
        <div style="font-size: 12px; color: #8c8c8c">当前 overview 中的 orchestration mix</div>
      </a-card>
      <a-card size="small">
        <div style="font-size: 12px; color: #8c8c8c">失败任务 / 24h 明细</div>
        <div style="font-size: 24px; font-weight: 600">{{ summary.failedTaskCount }} / {{ summary.recentTimelineItemCount }}</div>
        <div style="font-size: 12px; color: #8c8c8c">当前失败任务总量与最近 24h 执行明细写入数</div>
      </a-card>
    </div>

    <!-- 摘要提示区 -->
    <a-alert
      v-if="summary && summary.totalProjects > 0"
      type="info"
      show-icon
      style="margin-bottom: 16px"
    >
      <template #message>
        <span>
          共 {{ summary.totalProjects }} 个项目<template v-if="summary.pendingConfigCount > 0">，其中 {{ summary.pendingConfigCount }} 个待配置</template><template v-if="summary.riskCount > 0">，{{ summary.riskCount }} 个存在治理风险</template>
          <template v-if="summary.activeProjectCount > 0">，{{ summary.activeProjectCount }} 个处于活跃窗口</template>
          <template v-if="summary.runningTaskCount > 0">，{{ summary.runningTaskCount }} 个运行中任务</template>
          <template v-if="summary.activeSessionCount > 0">，{{ summary.activeSessionCount }} 个活动会话</template>
          <template v-if="summary.failedTaskCount > 0">，{{ summary.failedTaskCount }} 个当前失败任务</template>
          <template v-if="summary.recentTimelineItemCount > 0">，最近 24h 写入 {{ summary.recentTimelineItemCount }} 条执行明细</template>
        </span>
        <a-button
          v-if="summary.pendingConfigCount > 0"
          type="link"
          size="small"
          @click="selectedProjectStatus = 'pending_config'; loadOverview()"
        >查看待配置</a-button>
        <a-button
          v-if="summary.riskCount > 0"
          type="link"
          size="small"
          @click="selectedConfigStatus = 'risk'; loadOverview()"
        >查看风险项目</a-button>
      </template>
    </a-alert>

    <!-- 总览表格 -->
    <a-table
      :data-source="overviewRows"
      :columns="columns"
      :loading="overviewLoading"
      :pagination="{
        current: pagination.page,
        pageSize: pagination.pageSize,
        total: pagination.total,
        showSizeChanger: true,
        showTotal: showPaginationTotal,
      }"
      row-key="id"
      size="middle"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <div>
            <router-link :to="`/projects/${record.id}`" style="font-weight: 500">
              {{ record.name }}
            </router-link>
            <a-tag v-if="record.isCurrentUserManager" color="blue" style="margin-left: 6px; font-size: 11px">我管理</a-tag>
          </div>
          <a-typography-text type="secondary" style="font-size: 12px">{{ record.slug }}</a-typography-text>
        </template>

        <template v-if="column.key === 'orgName'">
          {{ record.orgName }}
        </template>

        <template v-if="column.key === 'projectGroup'">
          <a-space wrap :size="4">
            <a-tag :color="projectGroupTagColor(record)">
              {{ projectGroupDisplay(record).label }}
            </a-tag>
            <a-tag :color="projectGroupDisplay(record).source === 'explicit' ? 'blue' : 'default'">
              {{ projectGroupDisplay(record).source === 'explicit' ? '显式' : '派生' }}
            </a-tag>
          </a-space>
        </template>

        <template v-if="column.key === 'projectStatus'">
          <a-tag :color="statusColor(record.projectStatus)">
            {{ statusLabel(record.projectStatus) }}
          </a-tag>
        </template>

        <template v-if="column.key === 'completion'">
          <a-progress
            :percent="record.completionPercent"
            :stroke-color="record.completionPercent >= 100 ? '#52c41a' : '#1677ff'"
            size="small"
            style="width: 100px; display: inline-block; vertical-align: middle"
          />
          <span style="font-size: 12px; margin-left: 8px; color: #8c8c8c">
            {{ record.completedCount }}/{{ record.totalRequiredCount }}
          </span>
        </template>

        <template v-if="column.key === 'risks'">
          <template v-if="record.risks.length === 0">
            <a-typography-text type="secondary">—</a-typography-text>
          </template>
          <template v-else>
            <a-tag v-for="(risk, idx) in record.risks.slice(0, 2)" :key="idx" color="warning" style="margin-bottom: 2px">
              {{ risk }}
            </a-tag>
            <a-tag v-if="record.risks.length > 2" color="default">
              +{{ record.risks.length - 2 }}
            </a-tag>
          </template>
        </template>

        <template v-if="column.key === 'activity'">
          <div style="font-size: 12px">
            <span v-if="record.runningTasks > 0" style="color: #1677ff">运行中 {{ record.runningTasks }}</span>
            <span v-else style="color: #8c8c8c">运行中 0</span>
          </div>
          <div style="font-size: 12px">
            <span v-if="(record.activeSessionCount ?? 0) > 0" style="color: #13c2c2">活动会话 {{ record.activeSessionCount ?? 0 }}</span>
            <span v-else style="color: #8c8c8c">活动会话 0</span>
          </div>
          <div style="font-size: 12px">
            <span v-if="record.pendingApprovals > 0" style="color: #fa8c16">待审批 {{ record.pendingApprovals }}</span>
            <span v-else style="color: #8c8c8c">待审批 0</span>
          </div>
          <div v-if="record.failedTasksToday > 0" style="font-size: 12px; color: #ff4d4f">
            今日失败 {{ record.failedTasksToday }}
          </div>
          <div style="font-size: 12px; color: #8c8c8c">
            并行 {{ record.parallelTaskCount ?? 0 }} / 链式 {{ record.sequentialChainTaskCount ?? 0 }} / 明细 {{ record.recentTimelineItemCount ?? 0 }}
          </div>
        </template>

        <template v-if="column.key === 'lastActivityAt'">
          <a-tooltip :title="record.lastActivityAt ? formatTime(record.lastActivityAt) : '-'">
            {{ formatRelativeTime(record.lastActivityAt) }}
          </a-tooltip>
        </template>

        <template v-if="column.key === 'actions'">
          <a-space>
            <router-link :to="`/projects/${record.id}`">
              <a-button type="link" size="small">详情</a-button>
            </router-link>
            <router-link :to="`/projects/${record.id}/task-graph`">
              <a-button type="link" size="small">任务总图</a-button>
            </router-link>
            <a-button
              v-if="record.risks.length > 0"
              type="link"
              size="small"
              @click="handleQuickConfigClick(record)"
            >快速配置</a-button>
            <a-dropdown>
              <a-button type="link" size="small">更多 <DownOutlined /></a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item
                    v-if="record.isCurrentUserManager"
                    @click="handleEditClick(record)"
                  >编辑项目</a-menu-item>
                  <a-menu-item @click="$router.push(`/projects/${record.id}?tab=members`)">查看成员</a-menu-item>
                  <a-menu-item @click="$router.push(`/projects/${record.id}?tab=repositories`)">查看仓库</a-menu-item>
                  <a-menu-item @click="$router.push(`/projects/${record.id}?tab=credentials`)">查看凭证</a-menu-item>
                  <a-menu-item
                    v-if="record.isCurrentUserManager && record.projectStatus !== 'archived'"
                    @click="handleArchiveClick(record)"
                  >
                    <span style="color: #ff4d4f">归档项目</span>
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
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
        <a-form-item label="项目组标识">
          <a-input
            :value="createForm.projectGroupKey"
            placeholder="例如 core-platform"
            :maxlength="100"
            @update:value="createForm.projectGroupKey = String($event ?? '')"
          />
          <div style="font-size: 12px; color: #8c8c8c; margin-top: 4px">
            可选。Dashboard 会优先使用这个标识做同组织项目聚合。
          </div>
        </a-form-item>
        <a-form-item label="项目组展示名">
          <a-input
            :value="createForm.projectGroupLabel"
            placeholder="例如 核心平台"
            :maxlength="100"
            @update:value="createForm.projectGroupLabel = String($event ?? '')"
          />
          <div style="font-size: 12px; color: #8c8c8c; margin-top: 4px">
            可选。留空时会回退显示标识；两个字段都为空时才使用派生项目组规则。
          </div>
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
        <a-form-item label="项目组标识">
          <a-input
            :value="editForm.projectGroupKey"
            placeholder="例如 core-platform"
            :maxlength="100"
            @update:value="editForm.projectGroupKey = String($event ?? '')"
          />
        </a-form-item>
        <a-form-item label="项目组展示名">
          <a-input
            :value="editForm.projectGroupLabel"
            placeholder="例如 核心平台"
            :maxlength="100"
            @update:value="editForm.projectGroupLabel = String($event ?? '')"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { DownOutlined, PlusOutlined } from "@ant-design/icons-vue";
import { Modal, message } from "ant-design-vue";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  type Org,
  type ProjectOverviewItem,
  type ProjectSettings,
  archiveProject,
  createProject,
  listOrgs,
  listProjectOverview,
  updateProject,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";
import { useProjectStore } from "../stores/project";

const authStore = useAuthStore();
const projectStore = useProjectStore();
const router = useRouter();

// ── Filter state ───────────────────────────────────────────────────

const queryText = ref("");
const selectedOrgId = ref("");
const selectedProjectStatus = ref("");
const selectedConfigStatus = ref("");
const selectedSortBy = ref("last_activity_desc");
const onlyManaged = ref(false);

// ── Overview data ──────────────────────────────────────────────────

const overviewLoading = ref(false);
const overviewRows = ref<ProjectOverviewItem[]>([]);
const summary = ref<{
  totalProjects: number;
  pendingConfigCount: number;
  riskCount: number;
  activeProjectCount: number;
  runningTaskCount: number;
  activeSessionCount: number;
  parallelTaskCount: number;
  sequentialChainTaskCount: number;
  failedTaskCount: number;
  recentTimelineItemCount: number;
} | null>(null);
const pagination = ref({ page: 1, pageSize: 20, total: 0 });

// ── Org data (for filters & create) ───────────────────────────────

const orgs = ref<Org[]>([]);
const orgsLoading = ref(false);

// ── Create/Edit modals ────────────────────────────────────────────

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
  projectGroupKey: "",
  projectGroupLabel: "",
});

const editForm = ref({
  name: "",
  description: "",
  projectGroupKey: "",
  projectGroupLabel: "",
});

// ── Table columns ──────────────────────────────────────────────────

const columns = [
  { title: "项目名称", key: "name", dataIndex: "name", width: 220 },
  { title: "所属组织", key: "orgName", dataIndex: "orgName", width: 120 },
  { title: "项目组", key: "projectGroup", width: 170 },
  { title: "状态", key: "projectStatus", dataIndex: "projectStatus", width: 90 },
  { title: "配置完成度", key: "completion", width: 180 },
  { title: "风险提示", key: "risks", width: 200 },
  { title: "任务/审批", key: "activity", width: 180 },
  { title: "最近活跃", key: "lastActivityAt", dataIndex: "lastActivityAt", width: 130 },
  { title: "操作", key: "actions", width: 200 },
];

// ── Computed ───────────────────────────────────────────────────────

const canCreateProject = computed(
  () => authStore.user?.role === "platform_admin" || authStore.user?.role === "org_admin",
);

// ── Lifecycle ──────────────────────────────────────────────────────

onMounted(async () => {
  await Promise.all([loadOverview(), loadOrgs()]);
});

// ── Methods ────────────────────────────────────────────────────────

async function loadOverview() {
  overviewLoading.value = true;
  try {
    const res = await listProjectOverview({
      q: queryText.value || undefined,
      orgId: selectedOrgId.value || undefined,
      status: selectedProjectStatus.value || undefined,
      configStatus: selectedConfigStatus.value || undefined,
      onlyManaged: onlyManaged.value || undefined,
      sortBy: selectedSortBy.value,
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
    });
    overviewRows.value = res.data;
    summary.value = res.summary;
    pagination.value.total = res.total;
    pagination.value.page = res.page;
  } catch (e) {
    message.error(`加载项目总览失败: ${e}`);
  } finally {
    overviewLoading.value = false;
  }
}

function resetFilters() {
  queryText.value = "";
  selectedOrgId.value = "";
  selectedProjectStatus.value = "";
  selectedConfigStatus.value = "";
  selectedSortBy.value = "last_activity_desc";
  onlyManaged.value = false;
  pagination.value.page = 1;
  loadOverview();
}

function handleTableChange(pag: { current?: number; pageSize?: number }) {
  if (pag.current) pagination.value.page = pag.current;
  if (pag.pageSize) pagination.value.pageSize = pag.pageSize;
  loadOverview();
}

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

function statusLabel(status: string) {
  const map: Record<string, string> = {
    healthy: "正常",
    pending_config: "待配置",
    archived: "已归档",
    error: "异常",
  };
  return map[status] || status;
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    healthy: "success",
    pending_config: "warning",
    archived: "default",
    error: "error",
  };
  return map[status] || "default";
}

function showPaginationTotal(total: number) {
  return `共 ${total} 条`;
}

function isProjectOverviewItem(record: unknown): record is ProjectOverviewItem {
  return (
    !!record && typeof record === "object" && "id" in record && "name" in record && "slug" in record
  );
}

function handleQuickConfigClick(record: Record<string, unknown>) {
  if (isProjectOverviewItem(record)) {
    openQuickConfig(record);
  }
}

function handleEditClick(record: Record<string, unknown>) {
  if (isProjectOverviewItem(record)) {
    openEdit(record);
  }
}

function handleArchiveClick(record: Record<string, unknown>) {
  if (isProjectOverviewItem(record)) {
    handleArchive(record);
  }
}

function openQuickConfig(record: ProjectOverviewItem) {
  const risks = record.risks;
  let tab = "overview";
  if (risks.includes("凭证已过期") || risks.includes("无凭证")) {
    tab = "credentials";
  } else if (risks.includes("无仓库")) {
    tab = "repositories";
  } else if (risks.includes("无环境")) {
    tab = "environments";
  } else if (
    risks.includes("无默认环境") ||
    risks.includes("审批未绑定") ||
    risks.includes("预算未配置")
  ) {
    tab = "settings";
  }
  router.push(`/projects/${record.id}?tab=${tab}`);
}

function handleArchive(record: ProjectOverviewItem) {
  Modal.confirm({
    title: "确认归档项目？",
    content: `归档后项目「${record.name}」将不再允许新建任务，但保留详情查看和审计记录。`,
    okText: "确认归档",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        await archiveProject(record.id);
        message.success("项目已归档");
        await loadOverview();
      } catch (e) {
        message.error(`归档失败: ${e}`);
      }
    },
  });
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

  const { orgId, name, slug, description, projectGroupKey, projectGroupLabel } = createForm.value;
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
    const settings = buildProjectGroupSettings(projectGroupKey, projectGroupLabel);
    const project = await createProject({
      orgId,
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || undefined,
      ...(settings ? { settings } : {}),
    });
    message.success("项目创建成功");
    projectStore.addProject(project);
    showCreateModal.value = false;
    createForm.value = {
      orgId: orgs.value[0]?.id || "",
      name: "",
      slug: "",
      description: "",
      projectGroupKey: "",
      projectGroupLabel: "",
    };
    await loadOverview();
  } catch (e) {
    message.error(`创建失败: ${e}`);
  } finally {
    creating.value = false;
  }
}

function openEdit(record: ProjectOverviewItem) {
  editingProjectId.value = record.id;
  editForm.value = {
    name: record.name || "",
    description: record.description || "",
    projectGroupKey: normalizeProjectGroupSetting(record.settings?.projectGroupKey),
    projectGroupLabel: normalizeProjectGroupSetting(record.settings?.projectGroupLabel),
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
    const settings = buildProjectGroupSettings(
      editForm.value.projectGroupKey,
      editForm.value.projectGroupLabel,
    );
    await updateProject(editingProjectId.value, {
      name: editForm.value.name.trim(),
      description: editForm.value.description.trim(),
      settings: {
        projectGroupKey: settings?.projectGroupKey ?? null,
        projectGroupLabel: settings?.projectGroupLabel ?? null,
      },
    });
    message.success("保存成功");
    showEditModal.value = false;
    await loadOverview();
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

function formatRelativeTime(ts?: string | null) {
  if (!ts) return "-";
  const diff = Date.now() - new Date(ts).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatTime(ts);
}

function projectGroupDisplay(record: Record<string, unknown>) {
  if (!isProjectOverviewItem(record)) {
    return {
      label: "未分组",
      source: "derived" as const,
    };
  }

  const explicitKey = normalizeProjectGroupSetting(record.settings?.projectGroupKey).trim();
  const explicitLabel = normalizeProjectGroupSetting(record.settings?.projectGroupLabel).trim();

  if (explicitKey || explicitLabel) {
    return {
      label: explicitLabel || explicitKey,
      source: "explicit" as const,
    };
  }

  const lookup = buildDerivedProjectGroupLookup(overviewRows.value);
  return (
    lookup[record.id] ?? {
      label: record.name,
      source: "derived" as const,
    }
  );
}

function projectGroupTagColor(record: Record<string, unknown>) {
  return projectGroupDisplay(record).source === "explicit" ? "geekblue" : "default";
}

function buildDerivedProjectGroupLookup(
  projects: Array<Pick<ProjectOverviewItem, "id" | "orgId" | "name" | "slug" | "settings">>,
) {
  const familyCountByScopedKey = new Map<string, number>();
  const candidateByProjectId = new Map<string, string | null>();

  for (const project of projects) {
    const explicitKey = normalizeProjectGroupSetting(project.settings?.projectGroupKey).trim();
    const explicitLabel = normalizeProjectGroupSetting(project.settings?.projectGroupLabel).trim();
    if (explicitKey || explicitLabel) {
      continue;
    }

    const candidate = deriveProjectGroupFamilyCandidate(project.slug, project.name);
    candidateByProjectId.set(project.id, candidate);
    if (!candidate) continue;
    const scopedKey = `${project.orgId}::${candidate}`;
    familyCountByScopedKey.set(scopedKey, (familyCountByScopedKey.get(scopedKey) ?? 0) + 1);
  }

  const lookup: Record<string, { label: string; source: "derived" }> = {};
  for (const project of projects) {
    const candidate = candidateByProjectId.get(project.id) ?? null;
    const count = candidate
      ? (familyCountByScopedKey.get(`${project.orgId}::${candidate}`) ?? 0)
      : 0;
    lookup[project.id] = {
      label: count >= 2 && candidate ? candidate : project.name,
      source: "derived",
    };
  }

  return lookup;
}

function deriveProjectGroupFamilyCandidate(slug?: string | null, name?: string | null) {
  const slugTokens = tokenizeProjectGroupSource(slug);
  if (slugTokens.length > 0) {
    return slugTokens[0] ?? null;
  }

  const nameTokens = tokenizeProjectGroupSource(name);
  return nameTokens[0] ?? null;
}

function tokenizeProjectGroupSource(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .split(/[\s._:/-]+/)
    .filter(Boolean);
}

function normalizeProjectGroupSetting(value: unknown) {
  return typeof value === "string" ? value : "";
}

function buildProjectGroupSettings(
  projectGroupKey: string,
  projectGroupLabel: string,
): Pick<ProjectSettings, "projectGroupKey" | "projectGroupLabel"> | null {
  const normalizedKey = projectGroupKey.trim();
  const normalizedLabel = projectGroupLabel.trim();

  if (!normalizedKey && !normalizedLabel) {
    return null;
  }

  return {
    projectGroupKey: normalizedKey || null,
    projectGroupLabel: normalizedLabel || null,
  };
}
</script>
