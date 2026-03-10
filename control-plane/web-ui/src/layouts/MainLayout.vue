<template>
  <a-layout style="min-height: 100vh">
    <a-layout-sider :width="240" theme="dark" :style="siderStyle">
      <div :style="logoStyle">
        <h1 style="color: #3b82f6; font-size: 20px; margin: 0">OpenerX</h1>
        <p style="color: #64748b; font-size: 12px; margin: 4px 0 0">
          Enterprise AI Dev/Ops
        </p>
      </div>

      <ProjectSwitcher />

      <a-menu
        :selectedKeys="selectedKeys"
        theme="dark"
        mode="inline"
        :items="menuItems"
        @click="onMenuClick"
      />

      <div :style="footerStyle">
        <a-flex justify="space-between" align="center" style="margin-bottom: 8px">
          <span style="color: #94a3b8; font-size: 13px">{{
            authStore.user?.displayName
          }}</span>
          <a-badge
            :status="realtimeStore.connected ? 'success' : 'error'"
            :text="realtimeStore.connected ? '已连接' : '未连接'"
            style="font-size: 12px"
          />
        </a-flex>
        <a-button type="text" size="small" block @click="handleLogout">
          退出登录
        </a-button>
      </div>
    </a-layout-sider>

    <a-layout-content style="overflow: auto">
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
          <div style="color: #888; font-size: 12px; margin-top: 4px">{{ PASSWORD_POLICY_HINT }}</div>
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
  AuditOutlined,
  DashboardOutlined,
  ProjectOutlined,
  RobotOutlined,
  SettingOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { type CSSProperties, computed, h, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ProjectSwitcher from "../components/ProjectSwitcher.vue";
import { getMyProfile, updateMyProfile } from "../lib/api";
import { PASSWORD_POLICY_HINT, validatePasswordPolicy } from "../lib/password-policy";
import { useAuthStore } from "../stores/auth";
import { useRealtimeStore } from "../stores/realtime";

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const realtimeStore = useRealtimeStore();

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
    { key: "/projects", icon: () => h(ProjectOutlined), label: "项目" },
    { key: "/agents", icon: () => h(RobotOutlined), label: "Agent 控制台" },
    { key: "/approvals", icon: () => h(AuditOutlined), label: "审批" },
    { key: "/settings", icon: () => h(SettingOutlined), label: "设置" },
  ];

  if (authStore.user?.role === "platform_admin" || authStore.user?.role === "org_admin") {
    items.splice(5, 0, { key: "/users", icon: () => h(TeamOutlined), label: "用户管理" });
  }

  return items;
});

const selectedKeys = computed(() => {
  const path = route.path;
  if (path === "/" || path === "") return ["/"];
  if (path.startsWith("/tasks")) return ["/tasks"];
  if (path.startsWith("/projects")) return ["/projects"];
  if (path.startsWith("/agents")) return ["/agents"];
  if (path.startsWith("/approvals")) return ["/approvals"];
  if (path.startsWith("/users")) return ["/users"];
  if (path.startsWith("/settings")) return ["/settings"];
  return ["/"];
});

function onMenuClick({ key }: { key: string | number }) {
  router.push(String(key));
}

function handleLogout() {
  realtimeStore.disconnect();
  authStore.logout();
  router.push("/login");
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

const siderStyle: CSSProperties = {
  background: "#0f172a",
  borderRight: "1px solid #1e293b",
  display: "flex",
  flexDirection: "column",
};

const logoStyle: CSSProperties = {
  padding: "16px 24px",
  borderBottom: "1px solid #1e293b",
};

const footerStyle: CSSProperties = {
  padding: "12px 16px",
  borderTop: "1px solid #1e293b",
  marginTop: "auto",
};
</script>
