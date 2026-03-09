<template>
  <div>
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="5" style="margin: 0">项目成员</a-typography-title>
      <a-space v-if="canManage">
        <a-select
          :value="selectedUserId || undefined"
          style="width: 220px"
          placeholder="选择用户"
          :loading="candidatesLoading"
          :options="candidateOptions"
          @update:value="selectedUserId = String($event ?? '')"
        />
        <a-select
          :value="selectedRole"
          style="width: 140px"
          @update:value="selectedRole = valueToRole($event)"
        >
          <a-select-option value="project_admin">项目管理员</a-select-option>
          <a-select-option value="developer">开发者</a-select-option>
          <a-select-option value="viewer">只读</a-select-option>
        </a-select>
        <a-button type="primary" :loading="adding" @click="handleAddMember">添加成员</a-button>
      </a-space>
    </a-flex>

    <a-alert
      v-if="!canManage"
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="你可以查看项目成员，但只有项目管理员才能管理成员。"
    />

    <a-table
      :data-source="members"
      :columns="columns"
      :loading="loading"
      :pagination="false"
      row-key="userId"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'displayName'">
          <div>
            <div>{{ record.displayName }}</div>
            <a-typography-text type="secondary" style="font-size: 12px">
              {{ record.username }}
            </a-typography-text>
          </div>
        </template>

        <template v-if="column.key === 'globalRole'">
          <a-tag>{{ record.globalRole }}</a-tag>
        </template>

        <template v-if="column.key === 'role'">
          <a-select
            v-if="canManage"
            :value="record.role"
            size="small"
            style="width: 140px"
            :loading="savingUserId === record.userId"
            @update:value="handleRoleChange(record.userId, $event)"
          >
            <a-select-option value="project_admin">项目管理员</a-select-option>
            <a-select-option value="developer">开发者</a-select-option>
            <a-select-option value="viewer">只读</a-select-option>
          </a-select>
          <a-tag v-else :color="roleColor(record.role)">{{ roleLabel(record.role) }}</a-tag>
        </template>

        <template v-if="column.key === 'createdAt'">
          {{ formatTime(record.createdAt) }}
        </template>

        <template v-if="column.key === 'actions'">
          <a-popconfirm
            v-if="canManage"
            title="确定移除此成员？"
            ok-text="移除"
            cancel-text="取消"
            @confirm="handleRemoveMember(record.userId)"
          >
            <a-button danger type="link" size="small" :loading="savingUserId === record.userId">
              移除
            </a-button>
          </a-popconfirm>
          <span v-else>-</span>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { computed, onMounted, ref, watch } from "vue";
import {
  type MemberCandidate,
  type ProjectMember,
  addProjectMember,
  listProjectMemberCandidates,
  listProjectMembers,
  removeProjectMember,
  updateProjectMember,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{
  projectId: string;
}>();

const authStore = useAuthStore();
const loading = ref(false);
const candidatesLoading = ref(false);
const adding = ref(false);
const savingUserId = ref<string | null>(null);
const members = ref<ProjectMember[]>([]);
const candidates = ref<MemberCandidate[]>([]);
const selectedUserId = ref("");
const selectedRole = ref<"project_admin" | "developer" | "viewer">("developer");

const candidateOptions = computed(() =>
  candidates.value.map((user) => ({
    value: user.id,
    label: `${user.displayName} (${user.username})`,
  })),
);

const columns = [
  { title: "成员", key: "displayName" },
  { title: "全局角色", key: "globalRole", width: 140 },
  { title: "项目角色", key: "role", width: 180 },
  { title: "创建时间", key: "createdAt", width: 180 },
  { title: "操作", key: "actions", width: 100 },
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
  void loadAll();
});

watch(
  () => props.projectId,
  () => {
    void loadAll();
  },
);

async function loadAll() {
  await loadMembers();
  if (canManage.value) {
    await loadCandidates();
  } else {
    candidates.value = [];
    selectedUserId.value = "";
  }
}

async function loadMembers() {
  loading.value = true;
  try {
    members.value = await listProjectMembers(props.projectId);
  } catch (e) {
    members.value = [];
    message.error(`加载成员失败: ${e}`);
  } finally {
    loading.value = false;
  }
}

async function loadCandidates() {
  candidatesLoading.value = true;
  try {
    candidates.value = await listProjectMemberCandidates(props.projectId);
    if (!candidates.value.some((item) => item.id === selectedUserId.value)) {
      selectedUserId.value = candidates.value[0]?.id || "";
    }
  } catch {
    candidates.value = [];
    selectedUserId.value = "";
  } finally {
    candidatesLoading.value = false;
  }
}

async function handleAddMember() {
  if (!selectedUserId.value) {
    message.warning("请先选择用户");
    return;
  }

  adding.value = true;
  try {
    const member = await addProjectMember(props.projectId, {
      userId: selectedUserId.value,
      role: selectedRole.value,
    });
    members.value = [...members.value, member];
    candidates.value = candidates.value.filter((item) => item.id !== member.userId);
    selectedUserId.value = candidates.value[0]?.id || "";
    message.success("成员添加成功");
  } catch (e) {
    message.error(`添加成员失败: ${e}`);
  } finally {
    adding.value = false;
  }
}

async function handleRoleChange(userId: string, value: unknown) {
  const role = valueToRole(value);
  savingUserId.value = userId;
  try {
    await updateProjectMember(props.projectId, userId, { role });
    members.value = members.value.map((item) =>
      item.userId === userId ? { ...item, role } : item,
    );
    if (authStore.user?.id === userId) {
      authStore.user = {
        ...authStore.user,
        projects:
          authStore.user.projects?.map((item) =>
            item.id === props.projectId ? { ...item, role } : item,
          ) || [],
      };
    }
    message.success("角色更新成功");
  } catch (e) {
    message.error(`更新角色失败: ${e}`);
    await loadMembers();
  } finally {
    savingUserId.value = null;
  }
}

async function handleRemoveMember(userId: string) {
  savingUserId.value = userId;
  try {
    await removeProjectMember(props.projectId, userId);
    if (authStore.user?.id === userId) {
      authStore.user = {
        ...authStore.user,
        projects: authStore.user.projects?.filter((item) => item.id !== props.projectId) || [],
      };
    }
    await loadAll();
    message.success("成员已移除");
  } catch (e) {
    message.error(`移除成员失败: ${e}`);
  } finally {
    savingUserId.value = null;
  }
}

function roleLabel(role: string) {
  if (role === "project_admin") return "项目管理员";
  if (role === "developer") return "开发者";
  return "只读";
}

function roleColor(role: string) {
  if (role === "project_admin") return "blue";
  if (role === "developer") return "green";
  return "default";
}

function formatTime(ts?: string) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function valueToRole(value: unknown): "project_admin" | "developer" | "viewer" {
  if (value === "project_admin" || value === "developer" || value === "viewer") {
    return value;
  }
  return "developer";
}
</script>
