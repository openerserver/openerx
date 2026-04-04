import { type Ref, computed, ref, watch } from "vue";
import { getTaskSessionLineage, type TaskSessionLineageNode } from "../lib/api";

export interface TreeSessionNodeRecord {
  id: string;
  runtimeSessionId: string;
  parentId: string | null;
  contentText: string | null;
  branchName: string | null;
  sourceType: string;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  summary: { additions: number; deletions: number; files: number } | null;
  forkedFromMessageId: string | null;
}

interface SessionTreeNode {
  node: TreeSessionNodeRecord;
  children: SessionTreeNode[];
}

function mapLineageTree(
  nodes: TaskSessionLineageNode[],
  rootNodeId: string,
  parentId = rootNodeId,
): SessionTreeNode[] {
  return nodes.map((node) => ({
    node: {
      id: node.id,
      runtimeSessionId: node.runtimeSessionId,
      parentId,
      contentText: node.title ?? node.branchName ?? null,
      branchName: node.branchName ?? null,
      sourceType: node.sourceType,
      isActive: node.isActive,
      archivedAt: null,
      createdAt: node.createdAt ?? null,
      updatedAt: node.updatedAt ?? null,
      summary: node.summary ?? null,
      forkedFromMessageId: node.forkedFromMessageId ?? null,
    },
    children: mapLineageTree(node.children ?? [], rootNodeId, node.id),
  }));
}

function flattenTree(roots: SessionTreeNode[]): TreeSessionNodeRecord[] {
  const result: TreeSessionNodeRecord[] = [];

  function walk(nodes: SessionTreeNode[]) {
    for (const treeNode of nodes) {
      result.push(treeNode.node);
      walk(treeNode.children);
    }
  }

  walk(roots);
  return result;
}

export function useTreeBranches(
  taskId: Ref<string>,
  rootNodeId: Ref<string>,
  selectedSessionId: Ref<string | undefined>,
) {
  const sessionTree = ref<SessionTreeNode[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const flatNodes = computed(() => flattenTree(sessionTree.value));

  const selectedNode = computed(
    () => flatNodes.value.find((node) => node.runtimeSessionId === selectedSessionId.value) ?? null,
  );

  async function refresh() {
    if (!taskId.value || !rootNodeId.value) {
      sessionTree.value = [];
      error.value = null;
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const lineage = await getTaskSessionLineage(taskId.value);
      const nodes = Array.isArray(lineage.data) ? lineage.data : [];
      sessionTree.value = mapLineageTree(nodes, rootNodeId.value);
    } catch (nextError) {
      sessionTree.value = [];
      error.value = nextError instanceof Error ? nextError.message : "加载分支拓扑失败";
    } finally {
      loading.value = false;
    }
  }

  watch(
    [taskId, rootNodeId],
    () => {
      void refresh();
    },
    { immediate: true },
  );

  return {
    flatNodes,
    selectedNode,
    loading,
    error,
    refresh,
  };
}
