<template>
  <a-card size="small" style="margin-bottom: 16px">
    <a-flex wrap="wrap" :gap="12" align="center" style="margin-bottom: 12px">
      <a-input
        :value="pageQuery.search ?? ''"
        allow-clear
        placeholder="搜索 Agent ID / 类型 / 任务..."
        style="width: 280px"
        @update:value="$emit('searchChange', $event)"
      >
        <template #prefix>
          <SearchOutlined style="color: #94a3b8" />
        </template>
      </a-input>
      <a-select :value="pageQuery.model ?? ''" style="width: 180px" @update:value="$emit('modelChange', $event)">
        <a-select-option value="">全部 Provider / 模型</a-select-option>
        <a-select-option v-for="provider in providerOptions" :key="provider" :value="provider">
          {{ provider }}
        </a-select-option>
      </a-select>
      <a-select :value="pageQuery.status ?? ''" style="width: 180px" @update:value="$emit('statusChange', $event)">
        <a-select-option value="">全部状态</a-select-option>
        <a-select-option value="running">运行中</a-select-option>
        <a-select-option value="paused">已暂停</a-select-option>
        <a-select-option value="failed">失败</a-select-option>
        <a-select-option value="completed">已完成</a-select-option>
        <a-select-option value="stopped">已停止</a-select-option>
        <a-select-option value="terminated">已终止</a-select-option>
      </a-select>
      <a-radio-group :value="queueFocus" size="small" @update:value="$emit('queueFocusChange', $event)">
        <a-radio-button value="all">全部</a-radio-button>
        <a-radio-button value="attention">待处理</a-radio-button>
        <a-radio-button value="running">推进中</a-radio-button>
        <a-radio-button value="recent">最近结果</a-radio-button>
      </a-radio-group>
      <a-button type="link" size="small" @click="$emit('toggleAdvancedFilters')">
        {{ advancedFilterActiveKeys.length > 0 ? '收起高级筛选' : '展开高级筛选' }}
      </a-button>
      <a-typography-text type="secondary">{{ scopeSummaryText }}</a-typography-text>
    </a-flex>
    <a-collapse
      size="small"
      :bordered="false"
      :activeKey="advancedFilterActiveKeys"
      style="background: transparent"
      @update:activeKey="$emit('advancedFilterCollapse', $event)"
    >
      <a-collapse-panel key="advanced" header="高级筛选">
        <a-flex wrap="wrap" :gap="12" align="center">
          <a-select :value="pageQuery.riskLevel ?? ''" style="width: 160px" @update:value="$emit('riskLevelChange', $event)">
            <a-select-option value="">全部风险</a-select-option>
            <a-select-option value="low">低风险</a-select-option>
            <a-select-option value="medium">中风险</a-select-option>
            <a-select-option value="high">高风险</a-select-option>
            <a-select-option value="critical">严重风险</a-select-option>
          </a-select>
          <a-select :value="booleanSelectValue(pageQuery.requiresIntervention)" style="width: 180px" @update:value="$emit('requiresInterventionChange', $event)">
            <a-select-option value="">全部介入状态</a-select-option>
            <a-select-option value="true">仅看需要人工介入</a-select-option>
            <a-select-option value="false">仅看无需人工介入</a-select-option>
          </a-select>
          <a-select :value="booleanSelectValue(pageQuery.approvalBlocked)" style="width: 180px" @update:value="$emit('approvalBlockedChange', $event)">
            <a-select-option value="">全部审批状态</a-select-option>
            <a-select-option value="true">仅看审批阻塞</a-select-option>
            <a-select-option value="false">排除审批阻塞</a-select-option>
          </a-select>
          <a-input
            :value="pageQuery.agentType ?? ''"
            placeholder="筛选 Agent 类型"
            style="width: 180px"
            @update:value="$emit('agentTypeChange', $event)"
          />
        </a-flex>
      </a-collapse-panel>
    </a-collapse>
  </a-card>
</template>

<script setup lang="ts">
import { SearchOutlined } from "@ant-design/icons-vue";
import type { AgentOpsPageQuery, AgentOpsQueue } from "../../lib/api";

defineProps<{
  pageQuery: AgentOpsPageQuery;
  providerOptions: string[];
  queueFocus: "all" | AgentOpsQueue;
  advancedFilterActiveKeys: string[];
  scopeSummaryText: string;
  booleanSelectValue: (value?: boolean) => string;
}>();

defineEmits<{
  (e: "searchChange", value: unknown): void;
  (e: "modelChange", value: unknown): void;
  (e: "statusChange", value: unknown): void;
  (e: "queueFocusChange", value: unknown): void;
  (e: "toggleAdvancedFilters"): void;
  (e: "advancedFilterCollapse", value: unknown): void;
  (e: "riskLevelChange", value: unknown): void;
  (e: "requiresInterventionChange", value: unknown): void;
  (e: "approvalBlockedChange", value: unknown): void;
  (e: "agentTypeChange", value: unknown): void;
}>();
</script>