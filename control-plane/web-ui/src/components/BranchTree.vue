<template>
  <div class="branch-tree">
    <a-empty v-if="treeNodes.length === 0" description="暂无分支记录" />
    <div v-else class="branch-tree__list">
      <BranchTreeItem
        v-for="node in treeNodes"
        :key="node.runtimeSessionId"
        :node="node"
        :selected-branch-session-id="selectedBranchSessionId"
        :task-status="taskStatus"
        :session-state-map="sessionStateMap"
        :depth="0"
        branch-path=""
        @select="onSelect"
        @activate="onActivate"
        @fork="onFork"
        @archive="onArchive"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { TaskBranchLineageNode } from "../lib/api";

defineOptions({
  name: "BranchTree",
});

const props = defineProps<{
  tree: TaskBranchLineageNode[];
  selectedBranchSessionId?: string;
  taskStatus?: string;
  sessionStateMap?: Record<
    string,
    {
      badgeLabel: string;
      badgeColor: string;
      summary: string;
      detail?: string;
      countdownLabel?: string;
    }
  >;
}>();

const emit = defineEmits<{
  (e: "select", sessionId: string): void;
  (e: "activate", sessionId: string): void;
  (e: "fork", sessionId: string): void;
  (e: "archive", sessionId: string): void;
}>();

type DisplayNode = TaskBranchLineageNode & { children: DisplayNode[]; _originalIndex: number };

const treeNodes = computed(() => buildDisplayTree(props.tree));

function buildDisplayTree(nodes: TaskBranchLineageNode[]): TaskBranchLineageNode[] {
  const flatNodes = flattenBranchNodes(nodes);
  if (flatNodes.length <= 1) {
    return nodes;
  }

  const clonedNodes = flatNodes.map((node, index) => ({
    ...node,
    children: [] as DisplayNode[],
    _originalIndex: index,
  }));

  const byId = new Map(clonedNodes.map((node) => [node.runtimeSessionId, node]));
  const roots: DisplayNode[] = [];

  for (const node of clonedNodes) {
    const parentId = node.parentRuntimeSessionId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
      continue;
    }
    roots.push(node);
  }

  const primaryRoot = roots.find((node) => node.sourceType === "root");
  if (primaryRoot) {
    const regroupedRoots = roots.filter((node) => {
      if (node.runtimeSessionId === primaryRoot.runtimeSessionId) {
        return true;
      }
      if (!node.parentRuntimeSessionId && node.sourceType === "fork") {
        primaryRoot.children.push(node);
        return false;
      }
      return true;
    });
    sortDisplayNodes(primaryRoot);
    for (const node of regroupedRoots) {
      sortDisplayNodes(node);
    }
    return regroupedRoots;
  }

  for (const node of roots) {
    sortDisplayNodes(node);
  }
  return roots;
}

function flattenBranchNodes(nodes: TaskBranchLineageNode[]): TaskBranchLineageNode[] {
  const result: TaskBranchLineageNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result.push(...flattenBranchNodes(node.children));
    }
  }
  return result;
}

function sortDisplayNodes(node: DisplayNode) {
  const children = node.children as DisplayNode[];
  children.sort((left, right) => left._originalIndex - right._originalIndex);
  for (const child of children) {
    sortDisplayNodes(child);
  }
}

function onSelect(sessionId: string) {
  emit("select", sessionId);
}

function onActivate(sessionId: string) {
  emit("activate", sessionId);
}

function onFork(sessionId: string) {
  emit("fork", sessionId);
}

function onArchive(sessionId: string) {
  emit("archive", sessionId);
}
</script>

<style scoped>
.branch-tree {
  width: 100%;
}

.branch-tree__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>