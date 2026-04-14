<template>
  <TaskDetailPageShell :page="page" />
</template>

<script setup lang="ts">
import { reactive } from "vue";
import { useTaskDetailPageModel } from "../composables/useTaskDetailPageModel";

const page = reactive(useTaskDetailPageModel());

defineExpose({
  handleContinue: page.main.handleContinue,
  handleFork: page.main.handleFork,
});
</script>
