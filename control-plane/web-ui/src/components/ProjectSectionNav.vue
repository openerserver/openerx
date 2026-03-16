<template>
  <nav class="project-section-nav" data-testid="project-section-nav" aria-label="项目页面导航">
    <router-link
      v-for="item in items"
      :key="item.key"
      :to="item.to"
      class="project-section-nav__item"
      :class="{ 'project-section-nav__item--active': item.key === activeKey }"
      :data-testid="`project-section-nav-${item.key}`"
    >
      {{ item.label }}
    </router-link>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";

type ProjectSectionKey = "overview" | "approval-policies" | "role-execution" | "workflow" | "orchestration" | "operating-mode" | "boss-operations" | "cost";

const props = defineProps<{
  projectId: string;
  activeKey: ProjectSectionKey;
}>();

const items = computed(() => [
  {
    key: "overview" as const,
    label: "概览",
    to: { name: "ProjectDetail", params: { projectId: props.projectId } },
  },
  {
    key: "approval-policies" as const,
    label: "审批策略",
    to: { name: "ProjectApprovalPolicies", params: { projectId: props.projectId } },
  },
  {
    key: "role-execution" as const,
    label: "角色执行",
    to: { name: "ProjectRoleExecution", params: { projectId: props.projectId } },
  },
  {
    key: "workflow" as const,
    label: "工作流",
    to: { name: "ProjectWorkflowTemplate", params: { projectId: props.projectId } },
  },
  {
    key: "orchestration" as const,
    label: "介入编排",
    to: { name: "ProjectOrchestration", params: { projectId: props.projectId } },
  },
  {
    key: "operating-mode" as const,
    label: "运行档位",
    to: { name: "ProjectOperatingMode", params: { projectId: props.projectId } },
  },
  {
    key: "boss-operations" as const,
    label: "老板经营",
    to: { name: "BossOperationsCenter", params: { projectId: props.projectId } },
  },
  {
    key: "cost" as const,
    label: "成本",
    to: { name: "ProjectCost", params: { projectId: props.projectId } },
  },
]);
</script>

<style scoped>
.project-section-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.project-section-nav__item {
  padding: 6px 12px;
  border-radius: 999px;
  color: rgba(0, 0, 0, 0.65);
  text-decoration: none;
  transition: all 0.2s ease;
}

.project-section-nav__item:hover {
  color: #1677ff;
  background: rgba(22, 119, 255, 0.08);
}

.project-section-nav__item--active {
  color: #1677ff;
  background: rgba(22, 119, 255, 0.12);
  font-weight: 600;
}
</style>