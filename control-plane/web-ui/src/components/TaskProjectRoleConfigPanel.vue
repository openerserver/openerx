<template>
  <a-spin v-if="loading" />
  <a-alert v-else-if="error" type="warning" show-icon :message="error" />
  <a-empty v-else-if="filteredRows.length === 0" description="当前阶段没有额外角色配置规则" />
  <div v-else>
    <a-space size="small" wrap :style="{ marginBottom: '12px' }">
      <a-tag color="blue">当前阶段 {{ currentStage || 'unknown' }}</a-tag>
      <a-tag color="cyan">命中规则 {{ filteredRows.length }}</a-tag>
      <a-tag v-if="activeRoleAgentIds.length > 0" color="gold">本次已介入 {{ activeRoleAgentIds.length }}</a-tag>
    </a-space>

    <a-alert
      type="info"
      show-icon
      :style="{ marginBottom: '12px' }"
      message="这里展示当前项目对角色的长期运行规则；本次任务里谁真的介入、谁发起了阻断或修正请求，请看下方“角色实际介入记录”。"
    />

    <a-space direction="vertical" :size="8" :style="{ width: '100%' }">
      <a-card v-for="row in filteredRows" :key="row.role.id" size="small">
        <a-flex justify="space-between" align="flex-start" :gap="8">
          <div>
            <div><strong>{{ row.role.name }}</strong></div>
            <a-typography-text type="secondary">{{ row.role.id }}</a-typography-text>
          </div>
          <a-space size="small" wrap>
            <a-tag :color="modeColor(row.mode)">{{ modeLabel(row.mode) }}</a-tag>
            <a-tag v-if="activeRoleAgentIds.includes(row.role.id)" color="gold">本次已介入</a-tag>
          </a-space>
        </a-flex>

        <div :style="{ marginTop: '8px' }">
          <a-typography-text>
            阶段 {{ row.effectiveStages.join(' / ') || '未配置' }}
          </a-typography-text>
        </div>
        <div :style="{ marginTop: '4px' }">
          <a-typography-text type="secondary">
            {{ row.overrideSummary }}
          </a-typography-text>
        </div>
      </a-card>
    </a-space>

    <div :style="{ marginTop: '12px' }">
      <router-link :to="{ name: 'ProjectRoleExecution', params: { projectId } }">
        <a-button size="small">前往项目角色执行页</a-button>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ProjectRoleExecutionViewRow } from "../lib/api";

const props = withDefaults(defineProps<{
  loading: boolean;
  error: string | null;
  projectId: string;
  rows: ProjectRoleExecutionViewRow[];
  currentStage?: string;
  activeRoleAgentIds?: string[];
}>(), {
  currentStage: undefined,
  activeRoleAgentIds: () => [],
});

const filteredRows = computed(() => {
  if (!props.currentStage) {
    return props.rows;
  }

  const matched = props.rows.filter((row) =>
    row.effectiveStages.length === 0 || row.effectiveStages.includes(props.currentStage as string),
  );

  if (matched.length > 0) {
    return matched;
  }

  return props.rows.filter((row) => props.activeRoleAgentIds.includes(row.role.id));
});

function modeLabel(mode: ProjectRoleExecutionViewRow["mode"]) {
  if (mode === "project-takeover") return "项目接管";
  if (mode === "project-extend") return "项目增强";
  return "平台默认";
}

function modeColor(mode: ProjectRoleExecutionViewRow["mode"]) {
  if (mode === "project-takeover") return "orange";
  if (mode === "project-extend") return "blue";
  return "default";
}
</script>