<template>
  <div>
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="5" style="margin: 0">项目环境</a-typography-title>
      <a-button v-if="canManage" type="primary" @click="openCreateModal">新建环境</a-button>
    </a-flex>

    <a-alert
      v-if="!canManage"
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="你可以查看环境配置，但只有项目管理员才能管理环境。"
    />

    <a-table
      :data-source="environments"
      :columns="columns"
      :loading="loading"
      :pagination="false"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'riskLevel'">
          <a-tag :color="riskColor(record.riskLevel)">{{ record.riskLevel }}</a-tag>
        </template>

        <template v-if="column.key === 'requiresApproval'">
          <a-tag :color="record.requiresApproval ? 'orange' : 'green'">
            {{ record.requiresApproval ? '需要审批' : '无需审批' }}
          </a-tag>
        </template>

        <template v-if="column.key === 'createdAt'">
          {{ formatTime(record.createdAt) }}
        </template>

        <template v-if="column.key === 'actions'">
          <a-space v-if="canManage">
            <a-button type="link" size="small" @click="openEditModalFromRecord(record)">编辑</a-button>
            <a-popconfirm title="确定删除该环境？" ok-text="删除" cancel-text="取消" @confirm="handleDelete(record.id)">
              <a-button danger type="link" size="small" :loading="savingId === record.id">删除</a-button>
            </a-popconfirm>
          </a-space>
          <span v-else>-</span>
        </template>
      </template>
    </a-table>

    <a-modal
      :open="showModal"
      :title="editingId ? '编辑环境' : '新建环境'"
      :confirm-loading="saving"
      ok-text="保存"
      cancel-text="取消"
      @ok="handleSubmit"
      @update:open="showModal = $event"
    >
      <a-form :model="form" layout="vertical" style="margin-top: 16px">
        <a-form-item label="环境名称" required>
          <a-input
            :value="form.name"
            :maxlength="50"
            placeholder="例如：dev / staging / production"
            @update:value="form.name = String($event ?? '')"
          />
        </a-form-item>
        <a-form-item label="风险等级" required>
          <a-select :value="form.riskLevel" @update:value="form.riskLevel = valueToRisk($event)">
            <a-select-option value="low">low</a-select-option>
            <a-select-option value="medium">medium</a-select-option>
            <a-select-option value="high">high</a-select-option>
            <a-select-option value="critical">critical</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="审批要求">
          <a-switch
            :checked="form.requiresApproval"
            checked-children="需要审批"
            un-checked-children="无需审批"
            @update:checked="form.requiresApproval = Boolean($event)"
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
  type Environment,
  createEnvironment,
  listEnvironments,
  removeEnvironment,
  updateEnvironment,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{
  projectId: string;
}>();

const authStore = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const savingId = ref<string | null>(null);
const environments = ref<Environment[]>([]);
const showModal = ref(false);
const editingId = ref("");
const form = ref<{
  name: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
}>({
  name: "",
  riskLevel: "low",
  requiresApproval: false,
});

const columns = [
  { title: "名称", key: "name", dataIndex: "name" },
  { title: "风险等级", key: "riskLevel", dataIndex: "riskLevel", width: 130 },
  { title: "审批", key: "requiresApproval", dataIndex: "requiresApproval", width: 140 },
  { title: "创建时间", key: "createdAt", dataIndex: "createdAt", width: 180 },
  { title: "操作", key: "actions", width: 120 },
];

const canManage = computed(() => {
  const globalRole = authStore.user?.role;
  if (globalRole === "platform_admin" || globalRole === "org_admin") {
    return true;
  }
  const projectRole = authStore.user?.projects?.find((item) => item.id === props.projectId)?.role;
  return projectRole === "project_admin";
});

onMounted(() => {
  void loadEnvironments();
});

watch(
  () => props.projectId,
  () => {
    void loadEnvironments();
  },
);

async function loadEnvironments() {
  loading.value = true;
  try {
    environments.value = await listEnvironments(props.projectId);
  } catch (e) {
    environments.value = [];
    message.error(`加载环境失败: ${e}`);
  } finally {
    loading.value = false;
  }
}

function openCreateModal() {
  editingId.value = "";
  form.value = {
    name: "",
    riskLevel: "low",
    requiresApproval: false,
  };
  showModal.value = true;
}

function openEditModal(record: Environment) {
  editingId.value = record.id;
  form.value = {
    name: record.name,
    riskLevel: record.riskLevel,
    requiresApproval: record.requiresApproval,
  };
  showModal.value = true;
}

function openEditModalFromRecord(record: Record<string, unknown>) {
  openEditModal({
    id: String(record.id),
    projectId: String(record.projectId),
    name: String(record.name),
    riskLevel: valueToRisk(record.riskLevel),
    requiresApproval: Boolean(record.requiresApproval),
    createdAt: record.createdAt ? String(record.createdAt) : undefined,
  });
}

async function handleSubmit() {
  if (!form.value.name.trim()) {
    message.warning("环境名称不能为空");
    return;
  }

  saving.value = true;
  try {
    if (editingId.value) {
      const updated = await updateEnvironment(editingId.value, {
        name: form.value.name.trim(),
        riskLevel: form.value.riskLevel,
        requiresApproval: form.value.requiresApproval,
      });
      environments.value = environments.value.map((item) =>
        item.id === editingId.value ? { ...item, ...updated } : item,
      );
      message.success("环境更新成功");
    } else {
      const created = await createEnvironment({
        projectId: props.projectId,
        name: form.value.name.trim(),
        riskLevel: form.value.riskLevel,
        requiresApproval: form.value.requiresApproval,
      });
      environments.value = [...environments.value, created];
      message.success("环境创建成功");
    }
    showModal.value = false;
  } catch (e) {
    message.error(`保存环境失败: ${e}`);
  } finally {
    saving.value = false;
  }
}

async function handleDelete(envId: string) {
  savingId.value = envId;
  try {
    await removeEnvironment(envId);
    environments.value = environments.value.filter((item) => item.id !== envId);
    message.success("环境已删除");
  } catch (e) {
    message.error(`删除环境失败: ${e}`);
  } finally {
    savingId.value = null;
  }
}

function riskColor(level: string) {
  if (level === "critical") return "red";
  if (level === "high") return "orange";
  if (level === "medium") return "gold";
  return "green";
}

function formatTime(ts?: string) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function valueToRisk(value: unknown): "low" | "medium" | "high" | "critical" {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }
  return "low";
}
</script>