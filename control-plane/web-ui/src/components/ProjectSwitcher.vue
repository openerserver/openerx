<template>
  <div :style="wrapperStyle">
    <a-select
      :value="projectStore.currentProjectId || undefined"
      style="width: 100%"
      size="small"
      placeholder="选择项目"
      :loading="projectStore.loading"
      @update:value="handleSwitch"
    >
      <a-select-option
        v-for="project in projectStore.projects"
        :key="project.id"
        :value="project.id"
      >
        {{ project.name }}
      </a-select-option>
    </a-select>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from "vue";
import { onMounted } from "vue";
import { useProjectStore } from "../stores/project";

const projectStore = useProjectStore();

onMounted(() => {
  if (projectStore.projects.length === 0) {
    projectStore.loadProjects();
  }
});

function handleSwitch(value: unknown) {
  projectStore.switchProject(String(value ?? ""));
}

const wrapperStyle: CSSProperties = {
  padding: "8px 16px",
  borderBottom: "1px solid #1e293b",
};
</script>
