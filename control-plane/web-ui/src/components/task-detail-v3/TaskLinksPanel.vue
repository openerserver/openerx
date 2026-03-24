<template>
  <a-card size="small" title="关联任务" class="task-links-panel" :loading="loading">
    <template v-if="error">
      <a-alert type="error" :message="error" show-icon />
    </template>
    <template v-else-if="groupedLinks.length === 0">
      <a-empty description="暂无关联" :image="false" />
    </template>
    <template v-else>
      <div v-for="group in groupedLinks" :key="group.type" class="link-group">
        <div class="link-group-title">{{ group.label }}</div>
        <div v-for="link in group.links" :key="link.id" class="link-item">
          <a-tag :color="directionColor(link.direction)">
            {{ directionLabel(link.direction) }}
          </a-tag>
          <router-link
            :to="`/tasks/${link.direction === 'outgoing' ? link.targetNodeId : link.sourceNodeId}/v3`"
            class="link-node-id"
          >
            {{ (link.direction === "outgoing" ? link.targetNodeId : link.sourceNodeId).slice(0, 8) }}
          </router-link>
        </div>
      </div>
    </template>
  </a-card>
</template>

<script setup lang="ts">
import { type Ref, computed, ref, watch } from "vue";
import {
  type ProjectTreeLinkRecord,
  type ProjectTreeLinkType,
  getProjectTreeNodeLinks,
} from "../../lib/api";

const props = defineProps<{
  projectId: string;
  nodeId: string;
}>();

const links = ref<ProjectTreeLinkRecord[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const LINK_TYPE_LABELS: Record<ProjectTreeLinkType, string> = {
  "depends-on": "依赖",
  blocks: "阻塞",
  cites: "引用",
  "forked-from": "派生自",
  spawned: "派生",
  related: "相关",
};

interface LinkGroup {
  type: ProjectTreeLinkType;
  label: string;
  links: ProjectTreeLinkRecord[];
}

const groupedLinks = computed<LinkGroup[]>(() => {
  const groups = new Map<ProjectTreeLinkType, ProjectTreeLinkRecord[]>();
  for (const link of links.value) {
    const existing = groups.get(link.linkType) ?? [];
    existing.push(link);
    groups.set(link.linkType, existing);
  }
  return [...groups.entries()].map(([type, groupLinks]) => ({
    type,
    label: LINK_TYPE_LABELS[type] ?? type,
    links: groupLinks,
  }));
});

function directionLabel(direction?: "incoming" | "outgoing" | "self") {
  if (direction === "outgoing") return "→ 出";
  if (direction === "incoming") return "← 入";
  return "⇔";
}

function directionColor(direction?: "incoming" | "outgoing" | "self") {
  if (direction === "outgoing") return "blue";
  if (direction === "incoming") return "green";
  return "default";
}

async function refresh() {
  if (!props.projectId || !props.nodeId) {
    links.value = [];
    error.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    links.value = await getProjectTreeNodeLinks(props.projectId, props.nodeId);
  } catch (nextError) {
    links.value = [];
    error.value = nextError instanceof Error ? nextError.message : "加载关联失败";
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.projectId, props.nodeId],
  () => {
    void refresh();
  },
  { immediate: true },
);

defineExpose({ refresh });
</script>

<style scoped>
.task-links-panel {
  margin-bottom: 12px;
}
.link-group {
  margin-bottom: 8px;
}
.link-group:last-child {
  margin-bottom: 0;
}
.link-group-title {
  font-weight: 600;
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}
.link-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}
.link-node-id {
  font-family: monospace;
  font-size: 12px;
}
</style>
