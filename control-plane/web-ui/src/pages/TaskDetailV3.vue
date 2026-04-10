<template>
  <div class="task-detail-v3-page">
    <a-spin :spinning="page.layout.pageLoading" style="display: block">
      <a-alert
        v-if="page.layout.loadError"
        type="error"
        show-icon
        :message="page.layout.loadError"
        style="margin-bottom: 16px"
      />

      <template v-if="page.header.task">
        <header class="task-detail-v3-header">
          <div>
            <TreeBreadcrumb :ancestors="page.header.ancestors" :current-title="page.header.task.title" />
            <a-typography-title :level="3" style="margin: 0">
              {{ page.header.task.title || "任务详情" }}
            </a-typography-title>
          </div>

          <a-space size="small" wrap>
            <TaskSwitcher
              :project-id="page.header.projectId || undefined"
              :current-task-id="page.header.task.id"
              @select="page.header.handleTaskSwitch"
            />
            <a-button @click="page.sidebar.toggleSidebar">
              {{ page.sidebar.collapsed ? "展开 Sidebar" : "收起 Sidebar" }}
            </a-button>
          </a-space>
        </header>

        <div
          class="task-detail-v3-shell"
          :class="{ 'task-detail-v3-shell--sidebar-collapsed': page.sidebar.collapsed }"
        >
          <TaskDetailV3MainPane :main="page.main" />
          <TaskDetailV3SidebarPane :sidebar="page.sidebar" />
        </div>
      </template>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, reactive } from "vue";
import { useTaskDetailPageModel } from "../composables/useTaskDetailPageModel";

const TaskSwitcher = defineAsyncComponent(() => import("../components/task-detail-shared/TaskSwitcher.vue"));

const page = reactive(useTaskDetailPageModel());

defineExpose({
  handleContinue: page.main.handleContinue,
  handleFork: page.main.handleFork,
});
</script>

<style scoped>
.task-detail-v3-page {
  box-sizing: border-box;
  padding: 24px;
  height: 100dvh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.task-detail-v3-page :deep(.ant-spin-nested-loading),
.task-detail-v3-page :deep(.ant-spin-container) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.task-detail-v3-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.task-detail-v3-shell {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.task-detail-v3-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.task-detail-v3-main > :last-child {
  margin-top: 12px;
}

.task-detail-v3-sidebar {
  width: 320px;
  min-width: 280px;
  max-width: 400px;
  min-height: 0;
}

.task-detail-v3-shell--sidebar-collapsed .task-detail-v3-main {
  width: 100%;
}

.task-detail-v3-shell--sidebar-collapsed .task-detail-v3-sidebar {
  display: none;
}

@media (max-width: 1200px) {
  .task-detail-v3-shell {
    flex-direction: column;
    min-height: 0;
  }

  .task-detail-v3-main {
    flex: 1;
  }

  .task-detail-v3-sidebar,
  .task-detail-v3-sidebar--collapsed {
    width: 100%;
    min-width: 0;
    max-width: none;
  }

  .task-detail-v3-sidebar {
    flex: 0 0 auto;
    max-height: 35vh;
    overflow: auto;
  }
}
</style>
