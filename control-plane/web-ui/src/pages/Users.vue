<template>
  <div style="padding: 24px">
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px; gap: 12px; flex-wrap: wrap">
      <div>
        <a-typography-title :level="3" style="margin: 0">用户管理</a-typography-title>
        <a-typography-text type="secondary">
          管理系统账号、首次改密要求、启停状态与全局角色。
        </a-typography-text>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadUsers">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button data-testid="open-create-user-modal" type="primary" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          新建用户
        </a-button>
      </a-space>
    </a-flex>

    <a-result
      v-if="!canManageUsers"
      status="403"
      title="无权访问用户管理"
      sub-title="仅平台管理员和组织管理员可以查看此页面。"
    />

    <template v-else>
      <a-alert
        v-if="loadError"
        type="error"
        show-icon
        :message="loadError"
        style="margin-bottom: 16px"
      />

      <a-flex :gap="12" style="margin-bottom: 12px" wrap="wrap">
        <a-input
          v-model:value="searchText"
          placeholder="搜索用户名、显示名、邮箱"
          allow-clear
          style="width: 260px"
        />
        <a-select
          v-model:value="filterRole"
          placeholder="角色筛选"
          allow-clear
          style="width: 150px"
        >
          <a-select-option v-for="role in allRoles" :key="role" :value="role">
            {{ roleLabel(role) }}
          </a-select-option>
        </a-select>
        <a-select
          v-model:value="filterStatus"
          placeholder="状态筛选"
          allow-clear
          style="width: 120px"
        >
          <a-select-option value="active">启用</a-select-option>
          <a-select-option value="disabled">禁用</a-select-option>
        </a-select>
      </a-flex>

      <a-table
        :data-source="filteredUsers"
        :columns="columns"
        :loading="loading"
        :pagination="{ pageSize: 20 }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'username'">
            <a-space direction="vertical" :size="0">
              <span>{{ record.username }}</span>
              <a-typography-text type="secondary" style="font-size: 12px">
                {{ record.id }}
              </a-typography-text>
            </a-space>
          </template>

          <template v-else-if="column.key === 'email'">
            {{ record.email || '-' }}
          </template>

          <template v-else-if="column.key === 'role'">
            <a-space>
              <a-tag :color="roleColor(record.role)">{{ roleLabel(record.role) }}</a-tag>
              <a-select
                v-if="canChangeRole(record)"
                :value="record.role"
                :data-testid="`user-role-select-${record.id}`"
                size="small"
                style="width: 150px"
                @update:value="handleRoleChange(record, $event)"
              >
                <a-select-option v-for="role in manageableRoles" :key="role" :value="role">
                  {{ roleLabel(role) }}
                </a-select-option>
              </a-select>
            </a-space>
          </template>

          <template v-else-if="column.key === 'projects'">
            <template v-if="record.projects?.length">
              <a-tag v-for="p in record.projects" :key="p.projectId" style="margin-bottom: 2px">
                {{ p.projectName }}
              </a-tag>
            </template>
            <a-typography-text v-else type="secondary">-</a-typography-text>
          </template>

          <template v-else-if="column.key === 'status'">
            <a-tag :color="statusColor(record.accountStatus)">
              {{ statusLabel(record.accountStatus) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'mustChangePassword'">
            <a-tag :color="record.mustChangePassword ? 'orange' : 'default'">
              {{ record.mustChangePassword ? '需要改密' : '正常' }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'lastLoginAt'">
            {{ formatTime(record.lastLoginAt) }}
          </template>

          <template v-else-if="column.key === 'createdAt'">
            {{ formatTime(record.createdAt) }}
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button
                :data-testid="`user-edit-button-${record.id}`"
                type="link"
                size="small"
                @click="openEdit(record)"
              >
                编辑
              </a-button>
              <a-button
                v-if="canToggleStatus(record)"
                :data-testid="`user-reset-pwd-button-${record.id}`"
                type="link"
                size="small"
                @click="openResetPassword(record)"
              >
                重置密码
              </a-button>
              <a-popconfirm
                v-if="canToggleStatus(record)"
                :data-testid="`user-status-popconfirm-${record.id}`"
                :title="record.accountStatus === 'active' ? '确定禁用该用户？' : '确定重新启用该用户？'"
                @confirm="toggleStatus(record)"
              >
                <a-button type="link" size="small" :danger="record.accountStatus === 'active'">
                  {{ record.accountStatus === 'active' ? '禁用' : '启用' }}
                </a-button>
              </a-popconfirm>
              <a-typography-text v-else type="secondary">当前账号</a-typography-text>
            </a-space>
          </template>
        </template>
      </a-table>

      <a-modal
        :open="showCreateModal"
        title="新建用户"
        :confirm-loading="creating"
        ok-text="创建"
        cancel-text="取消"
        :width="560"
        @ok="handleCreate"
        @update:open="showCreateModal = $event"
      >
        <a-form layout="vertical" style="margin-top: 16px">
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="用户名" required>
                <a-input
                  :value="createForm.username"
                  :maxlength="50"
                  placeholder="例：alice"
                  @update:value="createForm.username = String($event ?? '')"
                />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="显示名称" required>
                <a-input
                  :value="createForm.displayName"
                  :maxlength="100"
                  placeholder="例：Alice Zhang"
                  @update:value="createForm.displayName = String($event ?? '')"
                />
              </a-form-item>
            </a-col>
          </a-row>
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="初始密码" required>
                <a-input-password
                  :value="createForm.password"
                  autocomplete="new-password"
                  @update:value="createForm.password = String($event ?? '')"
                />
                <div style="color: #888; font-size: 12px; margin-top: 4px">{{ PASSWORD_POLICY_HINT }}</div>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="邮箱">
                <a-input
                  :value="createForm.email"
                  :maxlength="200"
                  placeholder="可选"
                  @update:value="createForm.email = String($event ?? '')"
                />
              </a-form-item>
            </a-col>
          </a-row>
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="全局角色" required>
                <a-select
                  :value="createForm.role"
                  style="width: 100%"
                  @update:value="createForm.role = normalizeRole($event)"
                >
                  <a-select-option v-for="role in creatableRoles" :key="role" :value="role">
                    {{ roleLabel(role) }}
                  </a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="首次登录改密">
                <a-switch
                  :checked="createForm.mustChangePassword"
                  checked-children="是"
                  un-checked-children="否"
                  @update:checked="createForm.mustChangePassword = Boolean($event)"
                />
              </a-form-item>
            </a-col>
          </a-row>
        </a-form>
      </a-modal>

      <a-modal
        :open="showEditModal"
        title="编辑用户"
        :confirm-loading="editing"
        ok-text="保存"
        cancel-text="取消"
        :width="560"
        @ok="handleEdit"
        @update:open="showEditModal = $event"
      >
        <a-form layout="vertical" style="margin-top: 16px">
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="用户名">
                <a-input :value="editForm.username" disabled />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="显示名称" required>
                <a-input
                  :value="editForm.displayName"
                  :maxlength="100"
                  @update:value="editForm.displayName = String($event ?? '')"
                />
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item label="邮箱">
            <a-input
              :value="editForm.email"
              :maxlength="200"
              placeholder="可选"
              @update:value="editForm.email = String($event ?? '')"
            />
          </a-form-item>
        </a-form>
      </a-modal>

      <a-modal
        :open="showResetPasswordModal"
        title="重置密码"
        :confirm-loading="resettingPassword"
        ok-text="重置"
        cancel-text="取消"
        :width="420"
        @ok="handleResetPassword"
        @update:open="showResetPasswordModal = $event"
      >
        <a-form layout="vertical" style="margin-top: 16px">
          <a-typography-text type="secondary" style="display: block; margin-bottom: 12px">
            为用户 <strong>{{ resetPasswordForm.username }}</strong> 设置新密码。
          </a-typography-text>
          <a-form-item label="新密码" required>
            <a-input-password
              :value="resetPasswordForm.password"
              autocomplete="new-password"
              @update:value="resetPasswordForm.password = String($event ?? '')"
            />
            <div style="color: #888; font-size: 12px; margin-top: 4px">{{ PASSWORD_POLICY_HINT }}</div>
          </a-form-item>
          <a-form-item label="下次登录强制改密">
            <a-switch
              :checked="resetPasswordForm.mustChangePassword"
              checked-children="是"
              un-checked-children="否"
              @update:checked="resetPasswordForm.mustChangePassword = Boolean($event)"
            />
          </a-form-item>
        </a-form>
      </a-modal>
    </template>
  </div>
</template>

<script setup lang="ts">
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, onMounted, reactive, ref } from "vue";
import {
  type AdminUser,
  type UserRole,
  createUser,
  listUsers,
  resetUserPassword,
  setUserRole,
  setUserStatus,
  updateUser,
} from "../lib/api";
import { PASSWORD_POLICY_HINT, validatePasswordPolicy } from "../lib/password-policy";
import { useAuthStore } from "../stores/auth";

const authStore = useAuthStore();

const loading = ref(false);
const creating = ref(false);
const editing = ref(false);
const resettingPassword = ref(false);
const loadError = ref("");
const users = ref<AdminUser[]>([]);
const showCreateModal = ref(false);
const showEditModal = ref(false);
const showResetPasswordModal = ref(false);
const editingUserId = ref("");
const resetPasswordUserId = ref("");

const searchText = ref("");
const filterRole = ref<UserRole | undefined>(undefined);
const filterStatus = ref<"active" | "disabled" | undefined>(undefined);

const filteredUsers = computed(() => {
  let result = users.value;
  const q = searchText.value.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q),
    );
  }
  if (filterRole.value) {
    result = result.filter((u) => u.role === filterRole.value);
  }
  if (filterStatus.value) {
    result = result.filter((u) => u.accountStatus === filterStatus.value);
  }
  return result;
});

const canManageUsers = computed(
  () => authStore.user?.role === "platform_admin" || authStore.user?.role === "org_admin",
);
const isPlatformAdmin = computed(() => authStore.user?.role === "platform_admin");

const allRoles: UserRole[] = [
  "platform_admin",
  "org_admin",
  "project_admin",
  "developer",
  "viewer",
];

const creatableRoles = computed(() =>
  isPlatformAdmin.value ? allRoles : allRoles.filter((role) => role !== "platform_admin"),
);

const manageableRoles = computed(() => creatableRoles.value);

const createForm = reactive({
  username: "",
  displayName: "",
  password: "",
  email: "",
  role: "developer" as UserRole,
  mustChangePassword: true,
});

const editForm = reactive({
  username: "",
  displayName: "",
  email: "",
});

const resetPasswordForm = reactive({
  username: "",
  password: "",
  mustChangePassword: true,
});

const columns = [
  { title: "账号", key: "username", dataIndex: "username", width: 220 },
  { title: "显示名称", key: "displayName", dataIndex: "displayName", width: 160 },
  { title: "邮箱", key: "email", dataIndex: "email", width: 220 },
  { title: "角色", key: "role", dataIndex: "role", width: 220 },
  { title: "项目归属", key: "projects", width: 200 },
  { title: "状态", key: "status", dataIndex: "accountStatus", width: 110 },
  { title: "密码策略", key: "mustChangePassword", dataIndex: "mustChangePassword", width: 120 },
  { title: "最近登录", key: "lastLoginAt", dataIndex: "lastLoginAt", width: 180 },
  { title: "创建时间", key: "createdAt", dataIndex: "createdAt", width: 180 },
  { title: "操作", key: "actions", width: 200, fixed: "right" as const },
];

function asAdminUser(value: Record<string, unknown>) {
  return value as unknown as AdminUser;
}

onMounted(async () => {
  if (!canManageUsers.value) {
    return;
  }
  await loadUsers();
});

async function loadUsers() {
  if (!canManageUsers.value) {
    return;
  }

  loading.value = true;
  loadError.value = "";
  try {
    users.value = await listUsers();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "加载用户列表失败";
  } finally {
    loading.value = false;
  }
}

function normalizeRole(value: unknown): UserRole {
  const role = String(value ?? "developer") as UserRole;
  return creatableRoles.value.includes(role) ? role : "developer";
}

function resetCreateForm() {
  createForm.username = "";
  createForm.displayName = "";
  createForm.password = "";
  createForm.email = "";
  createForm.role = creatableRoles.value.includes("developer")
    ? "developer"
    : creatableRoles.value[0];
  createForm.mustChangePassword = true;
}

function openEdit(row: Record<string, unknown>) {
  const user = asAdminUser(row);
  editingUserId.value = user.id;
  editForm.username = user.username;
  editForm.displayName = user.displayName;
  editForm.email = user.email || "";
  showEditModal.value = true;
}

function openResetPassword(row: Record<string, unknown>) {
  const user = asAdminUser(row);
  resetPasswordUserId.value = user.id;
  resetPasswordForm.username = user.username;
  resetPasswordForm.password = "";
  resetPasswordForm.mustChangePassword = true;
  showResetPasswordModal.value = true;
}

async function handleCreate() {
  if (!createForm.username.trim() || !createForm.displayName.trim() || !createForm.password) {
    message.warning("请填写用户名、显示名称和初始密码");
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(createForm.username.trim())) {
    message.warning("用户名仅允许字母、数字、下划线和中划线");
    return;
  }
  const pwResult = validatePasswordPolicy(createForm.password);
  if (!pwResult.valid) {
    message.warning(pwResult.errors[0]);
    return;
  }

  creating.value = true;
  try {
    await createUser({
      username: createForm.username.trim(),
      displayName: createForm.displayName.trim(),
      password: createForm.password,
      email: createForm.email.trim() || null,
      mustChangePassword: createForm.mustChangePassword,
      role: normalizeRole(createForm.role),
    });
    message.success("用户创建成功");
    showCreateModal.value = false;
    resetCreateForm();
    await loadUsers();
  } catch (error) {
    message.error(error instanceof Error ? error.message : "创建用户失败");
  } finally {
    creating.value = false;
  }
}

async function handleEdit() {
  if (!editingUserId.value) return;
  if (!editForm.displayName.trim()) {
    message.warning("显示名称不能为空");
    return;
  }

  editing.value = true;
  try {
    await updateUser(editingUserId.value, {
      displayName: editForm.displayName.trim(),
      email: editForm.email.trim() || null,
    });
    message.success("用户信息已更新");
    showEditModal.value = false;
    await loadUsers();
  } catch (error) {
    message.error(error instanceof Error ? error.message : "更新用户失败");
  } finally {
    editing.value = false;
  }
}

async function handleResetPassword() {
  if (!resetPasswordUserId.value) return;
  const policyResult = validatePasswordPolicy(resetPasswordForm.password);
  if (!policyResult.valid) {
    message.warning(policyResult.errors[0]);
    return;
  }

  resettingPassword.value = true;
  try {
    await resetUserPassword(resetPasswordUserId.value, {
      password: resetPasswordForm.password,
      mustChangePassword: resetPasswordForm.mustChangePassword,
    });
    message.success("密码已重置");
    showResetPasswordModal.value = false;
    await loadUsers();
  } catch (error) {
    message.error(error instanceof Error ? error.message : "重置密码失败");
  } finally {
    resettingPassword.value = false;
  }
}

function canChangeRole(row: Record<string, unknown>) {
  const user = asAdminUser(row);
  return isPlatformAdmin.value && authStore.user?.id !== user.id;
}

function canToggleStatus(row: Record<string, unknown>) {
  const user = asAdminUser(row);
  return authStore.user?.id !== user.id;
}

async function handleRoleChange(row: Record<string, unknown>, nextValue: unknown) {
  const user = asAdminUser(row);
  const nextRole = normalizeRole(nextValue);
  if (nextRole === user.role) {
    return;
  }

  try {
    await setUserRole(user.id, nextRole);
    user.role = nextRole;
    message.success("用户角色已更新");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "更新角色失败");
  }
}

async function toggleStatus(row: Record<string, unknown>) {
  const user = asAdminUser(row);
  const nextStatus = user.accountStatus === "active" ? "disabled" : "active";
  try {
    await setUserStatus(user.id, nextStatus);
    user.accountStatus = nextStatus;
    message.success(nextStatus === "active" ? "用户已启用" : "用户已禁用");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "更新状态失败");
  }
}

function roleLabel(role: UserRole) {
  if (role === "platform_admin") return "平台管理员";
  if (role === "org_admin") return "组织管理员";
  if (role === "project_admin") return "项目管理员";
  if (role === "developer") return "开发者";
  return "只读用户";
}

function roleColor(role: UserRole) {
  if (role === "platform_admin") return "red";
  if (role === "org_admin") return "orange";
  if (role === "project_admin") return "blue";
  if (role === "developer") return "green";
  return "default";
}

function statusLabel(status: AdminUser["accountStatus"]) {
  return status === "active" ? "启用" : "禁用";
}

function statusColor(status: AdminUser["accountStatus"]) {
  return status === "active" ? "success" : "default";
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

resetCreateForm();
</script>