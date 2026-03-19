<template>
  <a-card size="small" :bordered="false" :body-style="{ padding: '8px 12px' }">
    <a-space size="small" wrap>
      <a-button
        v-if="canComplete"
        type="primary"
        size="small"
        data-testid="complete-task-btn"
        :loading="completing"
        @click="$emit('complete')"
      >
        完成任务
      </a-button>
      <a-button
        v-if="canAdvance"
        size="small"
        data-testid="advance-stage-btn"
        :loading="advancing"
        @click="$emit('advance')"
      >
        启动下一阶段
      </a-button>
    </a-space>
  </a-card>
</template>

<script setup lang="ts">
defineProps<{
  canComplete: boolean;
  canAdvance: boolean;
  completing: boolean;
  advancing: boolean;
}>();

defineEmits<{
  (e: "complete"): void;
  (e: "advance"): void;
}>();
</script>
