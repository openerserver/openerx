<template>
  <a-flex justify="space-between" align="start" wrap="wrap" :gap="12" class="page-header">
    <div>
      <a-flex align="center" wrap="wrap" :gap="8">
        <a-typography-title :level="3" style="margin: 0">Agent 运营中心</a-typography-title>
        <a-tag :color="viewMode === 'admin' ? 'gold' : 'blue'">{{ viewModeLabel }}</a-tag>
        <a-tag v-if="entryContext && entryContext !== 'nav'">{{ entryContextLabel }}</a-tag>
      </a-flex>
      <a-typography-paragraph type="secondary" style="margin: 6px 0 0 0">
        {{ pageSubtitle }}
      </a-typography-paragraph>
    </div>
    <a-space wrap>
      <a-select
        v-if="projectOptions.length > 0"
        :value="pageQuery.projectId ?? ''"
        style="width: 180px"
        @update:value="$emit('projectChange', $event)"
      >
        <a-select-option value="">全部项目</a-select-option>
        <a-select-option v-for="project in projectOptions" :key="project.value" :value="project.value">
          {{ project.label }}
        </a-select-option>
      </a-select>
      <a-radio-group
        v-if="isAdminRole"
        :value="pageQuery.ownerScope"
        size="small"
        @update:value="$emit('ownerScopeChange', $event)"
      >
        <a-radio-button value="all">全部任务</a-radio-button>
        <a-radio-button value="mine">仅看我的</a-radio-button>
      </a-radio-group>
      <a-tag v-else color="blue">仅看我的任务</a-tag>
      <a-tooltip :title="connectionTooltip">
        <a-badge :status="realtimeConnected ? 'success' : 'error'" :text="connectionLabel" />
      </a-tooltip>
      <a-button v-if="!realtimeConnected" size="small" type="link" @click="$emit('reconnect')">
        重连
      </a-button>
      <a-button :loading="loading || queueDataLoading" @click="$emit('refresh')">刷新</a-button>
    </a-space>
  </a-flex>
</template>

<script setup lang="ts">
import type { AgentOpsEntryContext, AgentOpsPageQuery, AgentOpsViewMode } from "../../lib/api";

defineProps<{
  viewMode: AgentOpsViewMode;
  viewModeLabel: string;
  entryContext?: AgentOpsEntryContext;
  entryContextLabel: string;
  pageSubtitle: string;
  pageQuery: AgentOpsPageQuery;
  projectOptions: Array<{ value: string; label: string }>;
  isAdminRole: boolean;
  realtimeConnected: boolean;
  connectionTooltip: string;
  connectionLabel: string;
  loading: boolean;
  queueDataLoading: boolean;
}>();

defineEmits<{
  (e: "projectChange", value: unknown): void;
  (e: "ownerScopeChange", value: unknown): void;
  (e: "reconnect"): void;
  (e: "refresh"): void;
}>();
</script>

<style scoped>
.page-header {
  margin-bottom: 16px;
}
</style>