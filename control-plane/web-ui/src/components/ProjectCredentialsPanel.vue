<template>
  <div>
    <a-flex justify="space-between" align="center" style="margin-bottom: 16px">
      <a-typography-title :level="5" style="margin: 0">执行凭证</a-typography-title>
      <a-button v-if="canManage" type="primary" @click="openCreateModal">添加凭证</a-button>
    </a-flex>

    <a-alert
      v-if="!canManage"
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="你可以查看凭证信息，但只有项目管理员才能管理凭证。"
    />

    <a-empty v-if="!loading && credentials.length === 0" description="暂无凭证，点击「添加凭证」开始配置" />

    <a-table
      v-else
      :data-source="credentials"
      :columns="columns"
      :loading="loading"
      :pagination="false"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'label'">
          {{ record.label }}
          <a-tag v-if="record.isDefault" color="blue" style="margin-left: 4px">默认</a-tag>
        </template>

        <template v-if="column.key === 'provider'">
          <a-tag :color="providerColor(record.provider)">{{ record.provider }}</a-tag>
        </template>

        <template v-if="column.key === 'credentialType'">
          <a-tag>{{ credentialTypeLabel(record.credentialType) }}</a-tag>
        </template>

        <template v-if="column.key === 'scope'">
          <a-tag :color="scopeColor(record.scope)">{{ scopeLabel(record.scope) }}</a-tag>
        </template>

        <template v-if="column.key === 'gitIdentity'">
          <span v-if="record.gitAuthorName || record.gitAuthorEmail">
            {{ record.gitAuthorName || '' }}
            <a-typography-text v-if="record.gitAuthorEmail" type="secondary">
              &lt;{{ record.gitAuthorEmail }}&gt;
            </a-typography-text>
          </span>
          <span v-else>-</span>
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
              v-if="record.status === 'active'"
              title="确定吊销该凭证？吊销后将无法用于任务执行。"
              ok-text="吊销"
              cancel-text="取消"
              @confirm="handleRevoke(record.id)"
            >
              <a-button danger type="link" size="small" :loading="revokingId === record.id">吊销</a-button>
            </a-popconfirm>
          </a-space>
          <span v-else>-</span>
        </template>
      </template>
    </a-table>

    <!-- Create / Edit Modal -->
    <a-modal
      :open="showModal"
      :title="editingId ? '编辑凭证' : '添加凭证'"
      :confirm-loading="saving"
      ok-text="保存"
      cancel-text="取消"
      @ok="handleSubmit"
      @update:open="showModal = $event"
    >
      <a-form :model="form" layout="vertical" style="margin-top: 16px">
        <a-form-item label="凭证名称" required>
          <a-input
            :value="form.label"
            :maxlength="200"
            placeholder="例如：my-github-pat"
            @update:value="form.label = String($event ?? '')"
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

        <a-form-item label="凭证类型" required>
          <a-select :value="form.credentialType" @update:value="form.credentialType = String($event ?? 'pat')">
            <a-select-option value="pat">PAT（个人访问令牌）</a-select-option>
            <a-select-option value="oauth_token">OAuth Token</a-select-option>
            <a-select-option value="ssh_key_ref">SSH Key 引用</a-select-option>
            <a-select-option value="app_installation">App Installation</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item :label="editingId ? '更新密钥引用（留空不修改）' : '密钥引用'" :required="!editingId">
          <a-input-password
            :value="form.secretRef"
            :maxlength="500"
            :placeholder="editingId ? '留空表示不修改' : '例如：ghp_xxxx 或 vault:secret/path'"
            @update:value="form.secretRef = String($event ?? '')"
          />
        </a-form-item>

        <a-form-item label="作用域">
          <a-select :value="form.scope" @update:value="form.scope = String($event ?? 'project')">
            <a-select-option value="project">项目默认（推荐）</a-select-option>
            <a-select-option value="shared">平台托管共享</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="设为默认凭证">
          <a-switch :checked="form.isDefault" @update:checked="form.isDefault = Boolean($event)" />
        </a-form-item>

        <a-divider>提交显示身份（可选）</a-divider>
        <a-typography-text type="secondary" style="display: block; margin-bottom: 12px; font-size: 12px">
          设置后，使用该凭证执行的任务将以此身份署名 Git 提交。未设置时由运行时自动决定。
        </a-typography-text>

        <a-form-item label="Git Author Name">
          <a-input
            :value="form.gitAuthorName"
            :maxlength="200"
            placeholder="例如：John Doe"
            @update:value="form.gitAuthorName = String($event ?? '')"
          />
        </a-form-item>

        <a-form-item label="Git Author Email">
          <a-input
            :value="form.gitAuthorEmail"
            :maxlength="200"
            placeholder="例如：john@example.com"
            @update:value="form.gitAuthorEmail = String($event ?? '')"
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
  type CredentialScope,
  type CredentialType,
  type RepositoryCredential,
  type RepositoryProvider,
  createCredential,
  listCredentials,
  revokeCredential,
  updateCredential,
} from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{
  projectId: string;
}>();

const authStore = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const revokingId = ref<string | null>(null);
const credentials = ref<RepositoryCredential[]>([]);
const showModal = ref(false);
const editingId = ref("");

const form = ref({
  label: "",
  provider: "github" as string,
  credentialType: "pat" as string,
  secretRef: "",
  scope: "project" as string,
  isDefault: false,
  gitAuthorName: "",
  gitAuthorEmail: "",
});

const canManage = computed(() => {
  const globalRole = authStore.user?.role;
  if (globalRole === "platform_admin" || globalRole === "org_admin") return true;
  return authStore.user?.projects?.some(
    (p) => p.id === props.projectId && p.role === "project_admin",
  );
});

const columns = [
  { title: "名称", dataIndex: "label", key: "label" },
  { title: "Provider", dataIndex: "provider", key: "provider", width: 100 },
  { title: "类型", dataIndex: "credentialType", key: "credentialType", width: 120 },
  { title: "作用域", dataIndex: "scope", key: "scope", width: 100 },
  { title: "Git 身份", key: "gitIdentity", width: 220 },
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

function credentialTypeLabel(type: string) {
  const map: Record<string, string> = {
    pat: "PAT",
    oauth_token: "OAuth",
    ssh_key_ref: "SSH Key",
    app_installation: "App",
  };
  return map[type] || type;
}

function scopeColor(scope: string) {
  const map: Record<string, string> = { project: "blue", shared: "purple" };
  return map[scope] || "default";
}

function scopeLabel(scope: string) {
  const map: Record<string, string> = { project: "项目默认", shared: "平台托管" };
  return map[scope] || scope;
}

function statusColor(status: string) {
  const map: Record<string, string> = { active: "green", revoked: "default", expired: "red" };
  return map[status] || "default";
}

function statusLabel(status: string) {
  const map: Record<string, string> = { active: "活跃", revoked: "已吊销", expired: "已过期" };
  return map[status] || status;
}

function formatTime(ts?: string) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

async function fetchCredentials() {
  loading.value = true;
  try {
    const result = await listCredentials(props.projectId);
    credentials.value = result.data;
  } catch {
    message.error("加载凭证列表失败");
  } finally {
    loading.value = false;
  }
}

function openCreateModal() {
  editingId.value = "";
  form.value = {
    label: "",
    provider: "github",
    credentialType: "pat",
    secretRef: "",
    scope: "project",
    isDefault: false,
    gitAuthorName: "",
    gitAuthorEmail: "",
  };
  showModal.value = true;
}

function openEditModal(cred: Record<string, unknown>) {
  const record = cred as unknown as RepositoryCredential;
  editingId.value = record.id;
  form.value = {
    label: record.label,
    provider: record.provider,
    credentialType: record.credentialType,
    secretRef: "",
    scope: record.scope,
    isDefault: record.isDefault,
    gitAuthorName: record.gitAuthorName || "",
    gitAuthorEmail: record.gitAuthorEmail || "",
  };
  showModal.value = true;
}

async function handleSubmit() {
  if (!form.value.label.trim()) {
    message.warning("请输入凭证名称");
    return;
  }

  saving.value = true;
  try {
    if (editingId.value) {
      await updateCredential(props.projectId, editingId.value, {
        label: form.value.label.trim(),
        ...(form.value.secretRef ? { secretRef: form.value.secretRef } : {}),
        gitAuthorName: form.value.gitAuthorName.trim() || null,
        gitAuthorEmail: form.value.gitAuthorEmail.trim() || null,
        isDefault: form.value.isDefault,
      });
      message.success("凭证已更新");
    } else {
      if (!form.value.secretRef.trim()) {
        message.warning("请输入密钥引用");
        saving.value = false;
        return;
      }
      await createCredential(props.projectId, {
        label: form.value.label.trim(),
        provider: form.value.provider as RepositoryProvider,
        credentialType: form.value.credentialType as CredentialType,
        secretRef: form.value.secretRef.trim(),
        scope: form.value.scope as CredentialScope,
        isDefault: form.value.isDefault,
        gitAuthorName: form.value.gitAuthorName.trim() || undefined,
        gitAuthorEmail: form.value.gitAuthorEmail.trim() || undefined,
      });
      message.success("凭证已添加");
    }
    showModal.value = false;
    await fetchCredentials();
  } catch (e: unknown) {
    message.error((e as Error).message || "操作失败");
  } finally {
    saving.value = false;
  }
}

async function handleRevoke(credentialId: string) {
  revokingId.value = credentialId;
  try {
    await revokeCredential(props.projectId, credentialId);
    message.success("凭证已吊销");
    await fetchCredentials();
  } catch (e: unknown) {
    message.error((e as Error).message || "吊销失败");
  } finally {
    revokingId.value = null;
  }
}

onMounted(fetchCredentials);

watch(() => props.projectId, fetchCredentials);
</script>
