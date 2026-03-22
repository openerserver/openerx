<template>
  <a-select
    :value="currentTaskId"
    :options="options"
    :loading="loading"
    :disabled="!projectId"
    show-search
    style="width: 280px"
    placeholder="切换任务"
    @focus="refresh"
    @update:value="handleChange"
  />
</template>

<script setup lang="ts">
import { computed, toRef } from "vue";
import { useTaskSwitcher } from "../../composables/useTaskSwitcher";

const props = defineProps<{
  projectId?: string;
  currentTaskId: string;
}>();

const emit = defineEmits<{
  (e: "select", taskId: string): void;
}>();

const { options, loading, refresh } = useTaskSwitcher(
  computed(() => toRef(props, "projectId").value),
  computed(() => toRef(props, "currentTaskId").value),
);

function handleChange(value: unknown) {
  if (typeof value === "string" && value.length > 0) {
    emit("select", value);
  }
}
</script>