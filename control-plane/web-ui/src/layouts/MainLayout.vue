<template>
  <a-layout style="min-height: 100vh">
    <a-layout-sider
      v-if="!embeddedMode"
      :collapsed="siderCollapsed"
      @update:collapsed="siderCollapsed = Boolean($event)"
      :width="240"
      :collapsed-width="80"
      :trigger="null"
      theme="dark"
      :style="siderStyle"
    >
      <div :style="logoStyle">
        <a-flex justify="space-between" align="center" :style="layoutThemeStyles.logoHeader">
          <div v-if="!siderCollapsed">
            <h1 :style="layoutThemeStyles.logoTitle">OpenerX</h1>
            <p :style="layoutThemeStyles.logoSubtitle">
              Enterprise AI Dev/Ops
            </p>
          </div>
          <div v-else :style="layoutThemeStyles.logoCompactBadge">OX</div>
          <a-button
            type="text"
            size="small"
            :style="layoutThemeStyles.siderToggle"
            @click="toggleSider"
          >
            <template #icon>
              <MenuFoldOutlined v-if="!siderCollapsed" />
              <MenuUnfoldOutlined v-else />
            </template>
          </a-button>
        </a-flex>
      </div>

      <ProjectSwitcher v-if="!siderCollapsed" />

      <a-menu
        :selectedKeys="selectedKeys"
        theme="dark"
        mode="inline"
        :items="menuItems"
        @click="onMenuClick"
      />

      <div :style="footerStyle">
        <a-flex justify="space-between" align="center" :style="layoutThemeStyles.footerStatusRow">
          <span v-if="!siderCollapsed" :style="layoutThemeStyles.footerUser">{{ authStore.user?.displayName }}</span>
          <a-badge
            :status="realtimeStore.connected ? 'success' : 'error'"
            :text="siderCollapsed ? undefined : realtimeStore.connected ? '已连接' : '未连接'"
            style="font-size: 12px"
          />
        </a-flex>
        <a-tooltip v-if="siderCollapsed" title="退出登录" placement="right">
          <a-button
            type="text"
            size="small"
            :style="layoutThemeStyles.footerActionCollapsed"
            @click="handleLogout"
          >
            <template #icon>
              <PoweroffOutlined />
            </template>
          </a-button>
        </a-tooltip>
        <a-button
          v-else
          type="text"
          size="small"
          block
          :style="layoutThemeStyles.footerAction"
          @click="handleLogout"
        >
          退出登录
        </a-button>
      </div>
    </a-layout-sider>

    <a-layout-content :style="layoutThemeStyles.content">
      <router-view />
    </a-layout-content>

    <a-modal
      :open="passwordModalOpen"
      title="首次登录请修改密码"
      ok-text="保存新密码"
      :maskClosable="false"
      :closable="false"
      :keyboard="false"
      cancel-text="不可跳过"
      :cancel-button-props="{ disabled: true }"
      :confirm-loading="passwordSaving"
      @ok="handleForcePasswordChange"
    >
      <a-alert
        type="warning"
        show-icon
        message="当前账户被标记为首次登录必须改密，完成后才能继续使用系统。"
        style="margin-bottom: 16px"
      />
      <a-form layout="vertical">
        <a-form-item label="当前密码" required>
          <a-input-password :value="passwordForm.currentPassword" autocomplete="current-password" @update:value="passwordForm.currentPassword = String($event ?? '')" />
        </a-form-item>
        <a-form-item label="新密码" required>
          <a-input-password :value="passwordForm.newPassword" autocomplete="new-password" @update:value="passwordForm.newPassword = String($event ?? '')" />
          <div :style="layoutThemeStyles.passwordHint">{{ PASSWORD_POLICY_HINT }}</div>
        </a-form-item>
        <a-form-item label="确认新密码" required>
          <a-input-password :value="passwordForm.confirmPassword" autocomplete="new-password" @update:value="passwordForm.confirmPassword = String($event ?? '')" />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-layout>
</template>

<script setup lang="ts">
import {
  AppstoreOutlined,
  AuditOutlined,
  DashboardOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  PoweroffOutlined,
  ProjectOutlined,
  RobotOutlined,
  SettingOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { computed, h, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getMyProfile, updateMyProfile } from "../lib/api";
import { PASSWORD_POLICY_HINT, validatePasswordPolicy } from "../lib/password-policy";
import { useAuthStore } from "../stores/auth";
import { useRealtimeStore } from "../stores/realtime";
import { layoutThemeStyles } from "../theme/ui-theme";

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const realtimeStore = useRealtimeStore();
const embeddedMode = computed(() => route.query.embedded === "1");
const SIDEBAR_COLLAPSED_KEY = "openerx-sidebar-collapsed";
const siderCollapsed = ref(
  typeof window !== "undefined"
    ? window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
    : false,
);

watch(siderCollapsed, (collapsed) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }
});

// Connect WebSocket when layout mounts
watch(
  () => authStore.token,
  async (token) => {
    if (token) {
      realtimeStore.connect(token);
      try {
        const profile = await getMyProfile();
        authStore.setUser(profile);
      } catch {
        // request() handles unauthorized globally
      }
    } else {
      passwordForm.currentPassword = "";
      passwordForm.newPassword = "";
      passwordForm.confirmPassword = "";
      realtimeStore.disconnect();
    }
  },
  { immediate: true },
);

const menuItems = computed(() => {
  const items = [
    { key: "/", icon: () => h(DashboardOutlined), label: "Dashboard" },
    { key: "/tasks", icon: () => h(UnorderedListOutlined), label: "任务" },
    { key: "/workbench", icon: () => h(AppstoreOutlined), label: "任务工作台" },
    { key: "/multi-task-monitor", icon: () => h(AppstoreOutlined), label: "多任务监控台" },
    { key: "/projects", icon: () => h(ProjectOutlined), label: "项目" },
    { key: "/agents", icon: () => h(RobotOutlined), label: "Agent 控制台" },
    { key: "/approvals", icon: () => h(AuditOutlined), label: "审批" },
    { key: "/settings", icon: () => h(SettingOutlined), label: "设置" },
  ];

  if (authStore.user?.role === "platform_admin" || authStore.user?.role === "org_admin") {
    items.splice(6, 0, {
      key: "/chat-settings",
      icon: () => h(MessageOutlined),
      label: "对话配置",
    });
    items.splice(5, 0, { key: "/users", icon: () => h(TeamOutlined), label: "用户管理" });
  }

  return items;
});

const selectedKeys = computed(() => {
  const path = route.path;
  if (path === "/" || path === "") return ["/"];
  if (path.startsWith("/workbench")) return ["/workbench"];
  if (path.startsWith("/multi-task-monitor")) return ["/multi-task-monitor"];
  if (path.startsWith("/tasks")) return ["/tasks"];
  if (path.startsWith("/projects")) return ["/projects"];
  if (path.startsWith("/agents")) return ["/agents"];
  if (path.startsWith("/approvals")) return ["/approvals"];
  if (path.startsWith("/chat-settings")) return ["/chat-settings"];
  if (path.startsWith("/users")) return ["/users"];
  if (path.startsWith("/settings")) return ["/settings"];
  return ["/"];
});

function onMenuClick({ key }: { key: string | number }) {
  // Defer navigation to next macrotask to escape Vue's reactive effect batching,
  // which can block router.push when heavy reactive trees (e.g. VueFlow) are active.
  setTimeout(() => router.push(String(key)), 0);
}

function handleLogout() {
  realtimeStore.disconnect();
  authStore.logout();
  router.push("/login");
}

function toggleSider() {
  siderCollapsed.value = !siderCollapsed.value;
}

const passwordModalOpen = computed(() => !!authStore.user?.mustChangePassword);
const passwordSaving = ref(false);
const passwordForm = reactive({ currentPassword: "", newPassword: "", confirmPassword: "" });

async function handleForcePasswordChange() {
  if (!passwordForm.currentPassword || !passwordForm.newPassword) {
    message.warning("请填写当前密码和新密码");
    return;
  }
  const policyResult = validatePasswordPolicy(passwordForm.newPassword);
  if (!policyResult.valid) {
    message.warning(policyResult.errors[0]);
    return;
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    message.warning("两次输入的新密码不一致");
    return;
  }

  passwordSaving.value = true;
  try {
    const profile = await updateMyProfile({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });
    authStore.setUser(profile);
    passwordForm.currentPassword = "";
    passwordForm.newPassword = "";
    passwordForm.confirmPassword = "";
    message.success("密码已更新");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "修改密码失败");
  } finally {
    passwordSaving.value = false;
  }
}

const siderStyle = layoutThemeStyles.sider;

const logoStyle = layoutThemeStyles.logoWrap;

const footerStyle = layoutThemeStyles.footer;
</script>
