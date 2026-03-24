import type { Edge, Node } from "@vue-flow/core";
import { type Ref, computed, ref, watch } from "vue";
import {
  type ProjectTreeBranchRecord,
  type ProjectTreeNodeRecord,
  getProjectTreeBranches,
  getProjectTreeChildren,
} from "../lib/api";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 104;
const GAP_X = 30;
const GAP_Y = 56;

export interface TreeBranchFlowNodeData {
  nodeId: string;
  sessionId: string;
  title: string;
  branchName?: string | null;
  shortId: string;
  isActive: boolean;
  isHead: boolean;
  isDefault: boolean;
  selected: boolean;
}

interface SessionTreeNode {
  node: ProjectTreeNodeRecord;
  children: SessionTreeNode[];
}

function buildSessionTree(
  sessions: ProjectTreeNodeRecord[],
  taskNodeId: string,
): SessionTreeNode[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const childrenMap = new Map<string, SessionTreeNode[]>();

  for (const session of sessions) {
    const parentKey =
      session.parentId === taskNodeId ? "__root__" : (session.parentId ?? "__root__");
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey)?.push({
      node: session,
      children: [],
    });
  }

  function attachChildren(treeNode: SessionTreeNode) {
    treeNode.children = childrenMap.get(treeNode.node.id) ?? [];
    for (const child of treeNode.children) {
      attachChildren(child);
    }
  }

  const roots = childrenMap.get("__root__") ?? [];
  for (const root of roots) {
    attachChildren(root);
  }
  return roots;
}

function flattenTree(roots: SessionTreeNode[]): ProjectTreeNodeRecord[] {
  const result: ProjectTreeNodeRecord[] = [];
  function walk(nodes: SessionTreeNode[]) {
    for (const n of nodes) {
      result.push(n.node);
      walk(n.children);
    }
  }
  walk(roots);
  return result;
}

function measureWidth(treeNode: SessionTreeNode, widthMap: Map<string, number>): number {
  if (treeNode.children.length === 0) {
    widthMap.set(treeNode.node.id, NODE_WIDTH);
    return NODE_WIDTH;
  }
  const childrenWidth = treeNode.children.reduce((sum, child, i) => {
    return sum + measureWidth(child, widthMap) + (i > 0 ? GAP_X : 0);
  }, 0);
  const width = Math.max(NODE_WIDTH, childrenWidth);
  widthMap.set(treeNode.node.id, width);
  return width;
}

function buildLayout(roots: SessionTreeNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const widthMap = new Map<string, number>();
  for (const root of roots) {
    measureWidth(root, widthMap);
  }

  function place(treeNode: SessionTreeNode, left: number, depth: number) {
    const subtreeWidth = widthMap.get(treeNode.node.id) ?? NODE_WIDTH;
    const x = left + Math.max(0, (subtreeWidth - NODE_WIDTH) / 2);
    positions.set(treeNode.node.id, { x, y: depth * (NODE_HEIGHT + GAP_Y) });

    let childLeft = left;
    for (const child of treeNode.children) {
      const cw = widthMap.get(child.node.id) ?? NODE_WIDTH;
      place(child, childLeft, depth + 1);
      childLeft += cw + GAP_X;
    }
  }

  let currentLeft = 0;
  for (const root of roots) {
    const rw = widthMap.get(root.node.id) ?? NODE_WIDTH;
    place(root, currentLeft, 0);
    currentLeft += rw + GAP_X;
  }
  return positions;
}

export function useTreeBranches(
  projectId: Ref<string>,
  taskNodeId: Ref<string>,
  selectedSessionId: Ref<string | undefined>,
) {
  const branches = ref<ProjectTreeBranchRecord[]>([]);
  const sessionNodes = ref<ProjectTreeNodeRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const taskBranches = computed(() =>
    branches.value.filter((b) => b.taskNodeId === taskNodeId.value),
  );

  const defaultBranch = computed(() => taskBranches.value.find((b) => b.isDefault) ?? null);

  const headNodeIds = computed(() => new Set(taskBranches.value.map((b) => b.headNodeId)));

  const branchByHead = computed(() => {
    const map = new Map<string, ProjectTreeBranchRecord>();
    for (const b of taskBranches.value) {
      map.set(b.headNodeId, b);
    }
    return map;
  });

  const sessionTree = computed(() => buildSessionTree(sessionNodes.value, taskNodeId.value));

  const flatNodes = computed(() => flattenTree(sessionTree.value));

  const selectedNode = computed(
    () => flatNodes.value.find((n) => n.runtimeSessionId === selectedSessionId.value) ?? null,
  );

  const flowNodes = computed<Node[]>(() => {
    const layout = buildLayout(sessionTree.value);
    return flatNodes.value.map((node) => {
      const branch = branchByHead.value.get(node.id);
      return {
        id: node.runtimeSessionId ?? node.id,
        type: "session",
        position: layout.get(node.id) ?? { x: 0, y: 0 },
        draggable: false,
        data: {
          nodeId: node.id,
          sessionId: node.runtimeSessionId ?? node.id,
          title:
            node.contentText ??
            node.branchName ??
            (node.runtimeSessionId?.slice(0, 8) || node.id.slice(0, 8)),
          branchName: node.branchName ?? branch?.branchName,
          shortId: (node.runtimeSessionId ?? node.id).slice(0, 8),
          isActive: node.isActive,
          isHead: headNodeIds.value.has(node.id),
          isDefault: branch?.isDefault ?? false,
          selected: node.runtimeSessionId === selectedSessionId.value,
        } satisfies TreeBranchFlowNodeData,
      };
    });
  });

  const flowEdges = computed<Edge[]>(() =>
    flatNodes.value
      .filter((n) => n.parentId && n.parentId !== taskNodeId.value)
      .map((n) => {
        const parent = flatNodes.value.find((p) => p.id === n.parentId);
        const parentKey = n.parentId ?? n.id;
        return {
          id: `e-${parent?.runtimeSessionId ?? parentKey}-${n.runtimeSessionId ?? n.id}`,
          source: parent?.runtimeSessionId ?? parentKey,
          target: n.runtimeSessionId ?? n.id,
          type: "smoothstep",
          animated: n.isActive,
          style: { stroke: "#8bb3e0", strokeWidth: 2 },
        };
      }),
  );

  async function refresh() {
    if (!projectId.value || !taskNodeId.value) {
      branches.value = [];
      sessionNodes.value = [];
      error.value = null;
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const [branchList, children] = await Promise.all([
        getProjectTreeBranches(projectId.value),
        getProjectTreeChildren(projectId.value, taskNodeId.value),
      ]);
      branches.value = branchList;
      sessionNodes.value = children.filter((n) => n.nodeType === "session");
    } catch (nextError) {
      branches.value = [];
      sessionNodes.value = [];
      error.value = nextError instanceof Error ? nextError.message : "加载分支拓扑失败";
    } finally {
      loading.value = false;
    }
  }

  watch(
    [projectId, taskNodeId],
    () => {
      void refresh();
    },
    { immediate: true },
  );

  return {
    branches,
    taskBranches,
    defaultBranch,
    sessionNodes,
    flatNodes,
    selectedNode,
    flowNodes,
    flowEdges,
    loading,
    error,
    refresh,
  };
}
