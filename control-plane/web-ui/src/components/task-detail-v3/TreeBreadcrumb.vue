<template>
  <a-breadcrumb class="tree-breadcrumb">
    <a-breadcrumb-item v-for="crumb in crumbs" :key="crumb.id">
      <router-link v-if="crumb.to" :to="crumb.to">{{ crumb.label }}</router-link>
      <span v-else>{{ crumb.label }}</span>
    </a-breadcrumb-item>
  </a-breadcrumb>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ProjectTreeNodeRecord } from "../../lib/api";

const props = defineProps<{
  ancestors: ProjectTreeNodeRecord[];
  currentTitle: string;
}>();

interface CrumbItem {
  id: string;
  label: string;
  to?: string;
}

const crumbs = computed<CrumbItem[]>(() => {
  const items: CrumbItem[] = [];

  const projectNode = props.ancestors.find((n) => n.nodeType === "project_root");
  if (projectNode) {
    items.push({
      id: projectNode.id,
      label: projectNode.contentText || projectNode.id.slice(0, 8),
      to: `/projects/${projectNode.projectId}`,
    });
  }

  // Intermediate ancestors (skip project_root, skip the task itself which is current)
  for (const node of props.ancestors.filter((n) => n.nodeType !== "project_root")) {
    items.push({
      id: node.id,
      label: node.contentText || node.branchName || node.id.slice(0, 8),
    });
  }

  items.push({ id: "current", label: props.currentTitle || "任务详情" });
  return items;
});
</script>

<style scoped>
.tree-breadcrumb {
  margin-bottom: 8px;
}
</style>
