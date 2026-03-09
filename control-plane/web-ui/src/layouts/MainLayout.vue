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
  </a-layout>
</template>

<script setup lang="ts">
import { ref, computed, watch, h, type CSSProperties } from "vue";
import { useRouter, useRoute } from "vue-router";
import {
  DashboardOutlined,
  UnorderedListOutlined,
  ProjectOutlined,
  AuditOutlined,
  RobotOutlined,
  SettingOutlined,
} from "@ant-design/icons-vue";
import { useAuthStore } from "../stores/auth";
import { useRealtimeStore } from "../stores/realtime";
import ProjectSwitcher from "../components/ProjectSwitcher.vue";

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const realtimeStore = useRealtimeStore();

// Connect WebSocket when layout mounts
watch(
  () => authStore.token,
  (token) => {
    if (token) realtimeStore.connect(token);
  },
  { immediate: true },
);

const isSystemAdmin = computed(
  () => authStore.user?.role === "platform_admin" || authStore.user?.role === "org_admin",
);

const menuItems = computed(() => {
  const items = [
    { key: "/", icon: () => h(DashboardOutlined), label: "Dashboard" },
    { key: "/tasks", icon: () => h(UnorderedListOutlined), label: "任务" },
    { key: "/projects", icon: () => h(ProjectOutlined), label: "项目" },
    { key: "/agents", icon: () => h(RobotOutlined), label: "Agent 控制台" },
    { key: "/approvals", icon: () => h(AuditOutlined), label: "审批" },
  ];

  if (isSystemAdmin.value) {
    items.push({ key: "/settings", icon: () => h(SettingOutlined), label: "设置" });
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
