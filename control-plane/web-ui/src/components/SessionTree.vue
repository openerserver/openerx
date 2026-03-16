<template>
  <div class="session-tree">
    <a-empty v-if="treeNodes.length === 0" description="暂无分支记录" />
    <div v-else class="session-tree__list">
      <SessionTreeBranch
        v-for="node in treeNodes"
        :key="node.runtimeSessionId"
        :node="node"
        :selected-session-id="selectedSessionId"
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
import type { SessionTreeNode } from "../lib/api";

const props = defineProps<{
  tree: SessionTreeNode[];
  selectedSessionId?: string;
  taskStatus?: string;
  sessionStateMap?: Record<string, {
    badgeLabel: string;
    badgeColor: string;
    summary: string;
    detail?: string;
    countdownLabel?: string;
  }>;
}>();

const emit = defineEmits<{
  (e: "select", sessionId: string): void;
  (e: "activate", sessionId: string): void;
  (e: "fork", sessionId: string): void;
  (e: "archive", sessionId: string): void;
}>();

type DisplayNode = SessionTreeNode & { children: DisplayNode[]; _originalIndex: number };

const treeNodes = computed(() => buildDisplayTree(props.tree));

function buildDisplayTree(nodes: SessionTreeNode[]): SessionTreeNode[] {
  const flatNodes = flattenNodes(nodes);
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
    regroupedRoots.forEach(sortDisplayNodes);
    return regroupedRoots;
  }

  roots.forEach(sortDisplayNodes);
  return roots;
}

function flattenNodes(nodes: SessionTreeNode[]): SessionTreeNode[] {
  const result: SessionTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result.push(...flattenNodes(node.children));
    }
  }
  return result;
}

function sortDisplayNodes(node: DisplayNode) {
  const children = node.children as DisplayNode[];
  children.sort((left, right) => left._originalIndex - right._originalIndex);
  children.forEach(sortDisplayNodes);
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
.session-tree {
  width: 100%;
}

.session-tree__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
