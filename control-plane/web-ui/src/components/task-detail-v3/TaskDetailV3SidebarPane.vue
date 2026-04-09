<template>
  <aside class="task-detail-v3-sidebar" :class="{ 'task-detail-v3-sidebar--collapsed': sidebar.collapsed }">
    <template v-if="!sidebar.collapsed">
      <TaskFilePreviewPanel
        v-if="sidebar.previewFile"
        :file-path="sidebar.previewFile.filePath"
        :content="sidebar.previewFile.content"
        @close="sidebar.handleCloseFilePreview"
      />
      <TaskMemberPanel
        v-if="sidebar.memberViewLoading || sidebar.memberView"
        :view="sidebar.memberView"
        :loading="sidebar.memberViewLoading"
      />
      <TaskFollowupPanel
        :task-id="sidebar.taskId"
        :session-id="sidebar.selectedSessionId"
        :refresh-key="sidebar.traceRefreshKey"
      />
      <TaskExecutionTracePanel
        :task-id="sidebar.taskId"
        :session-id="sidebar.selectedSessionId"
        :refresh-key="sidebar.traceRefreshKey"
      />
    </template>
  </aside>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import type { TaskDetailSidebarModelState } from "../../composables/useTaskDetailPageSectionModels";

defineProps<{
  sidebar: TaskDetailSidebarModelState;
}>();

const TaskFilePreviewPanel = defineAsyncComponent(
  () => import("../task-detail-shared/TaskFilePreviewPanel.vue"),
);
const TaskMemberPanel = defineAsyncComponent(
  () => import("../task-detail/TaskMemberPanel.vue"),
);
const TaskFollowupPanel = defineAsyncComponent(
  () => import("../task-detail/TaskFollowupPanel.vue"),
);
const TaskExecutionTracePanel = defineAsyncComponent(
  () => import("../task-detail-shared/TaskExecutionTracePanel.vue"),
);
</script>