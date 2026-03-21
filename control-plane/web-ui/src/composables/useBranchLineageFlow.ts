import type { Edge, Node } from "@vue-flow/core";
import { computed, ref, watch, type Ref } from "vue";
import { getTaskBranchLineage, type TaskBranchLineageNode } from "../lib/api";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 104;
const GAP_X = 30;
const GAP_Y = 56;

export interface BranchLineageFlowNodeData {
  sessionId: string;
  title: string;
  branchName?: string | null;
  shortId: string;
  sourceType: string;
  isActive: boolean;
  selected: boolean;
  summary: TaskBranchLineageNode["summary"];
}

function flattenBranchLineage(nodes: TaskBranchLineageNode[]): TaskBranchLineageNode[] {
  const result: TaskBranchLineageNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result.push(...flattenBranchLineage(node.children));
    }
  }
  return result;
}

function measureTreeWidth(node: TaskBranchLineageNode, widthMap: Map<string, number>): number {
  if (node.children.length === 0) {
    widthMap.set(node.runtimeSessionId, NODE_WIDTH);
    return NODE_WIDTH;
  }

  const childrenWidth = node.children.reduce((sum, child, index) => {
    const childWidth = measureTreeWidth(child, widthMap);
    return sum + childWidth + (index > 0 ? GAP_X : 0);
  }, 0);

  const width = Math.max(NODE_WIDTH, childrenWidth);
  widthMap.set(node.runtimeSessionId, width);
  return width;
}

function buildLayoutMap(tree: TaskBranchLineageNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const widthMap = new Map<string, number>();

  for (const root of tree) {
    measureTreeWidth(root, widthMap);
  }

  function placeNode(node: TaskBranchLineageNode, left: number, depth: number) {
    const subtreeWidth = widthMap.get(node.runtimeSessionId) ?? NODE_WIDTH;
    const x = left + Math.max(0, (subtreeWidth - NODE_WIDTH) / 2);
    const y = depth * (NODE_HEIGHT + GAP_Y);
    positions.set(node.runtimeSessionId, { x, y });

    let childLeft = left;
    for (const child of node.children) {
      const childWidth = widthMap.get(child.runtimeSessionId) ?? NODE_WIDTH;
      placeNode(child, childLeft, depth + 1);
      childLeft += childWidth + GAP_X;
    }
  }

  let currentLeft = 0;
  for (const root of tree) {
    const rootWidth = widthMap.get(root.runtimeSessionId) ?? NODE_WIDTH;
    placeNode(root, currentLeft, 0);
    currentLeft += rootWidth + GAP_X;
  }

  return positions;
}

export function branchLineageToFlow(
  tree: TaskBranchLineageNode[],
  selectedBranchSessionId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const layout = buildLayoutMap(tree);
  const flatNodes = flattenBranchLineage(tree);

  const nodes: Node[] = flatNodes.map((node) => ({
    id: node.runtimeSessionId,
    type: "session",
    position: layout.get(node.runtimeSessionId) ?? { x: 0, y: 0 },
    draggable: false,
    data: {
      sessionId: node.runtimeSessionId,
      title: node.title || node.branchName || node.runtimeSessionId.slice(0, 8),
      branchName: node.branchName,
      shortId: node.runtimeSessionId.slice(0, 8),
      sourceType: node.sourceType,
      isActive: node.isActive,
      selected: node.runtimeSessionId === selectedBranchSessionId,
      summary: node.summary,
    } satisfies BranchLineageFlowNodeData,
  }));

  const edges: Edge[] = flatNodes
    .filter((node) => Boolean(node.parentRuntimeSessionId))
    .map((node) => ({
      id: `e-${node.parentRuntimeSessionId}-${node.runtimeSessionId}`,
      source: node.parentRuntimeSessionId as string,
      target: node.runtimeSessionId,
      type: "smoothstep",
      animated: node.isActive,
      style: {
        stroke: "#8bb3e0",
        strokeWidth: 2,
      },
    }));

  return { nodes, edges };
}

export function useBranchLineageFlow(
  taskId: Ref<string>,
  selectedBranchSessionId: Ref<string | undefined>,
) {
  const tree = ref<TaskBranchLineageNode[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const flatNodes = computed(() => flattenBranchLineage(tree.value));
  const selectedNode = computed(
    () =>
      flatNodes.value.find((node) => node.runtimeSessionId === selectedBranchSessionId.value) ??
      null,
  );
  const flow = computed(() =>
    branchLineageToFlow(tree.value, selectedBranchSessionId.value ?? null),
  );

  async function refresh() {
    if (!taskId.value) {
      tree.value = [];
      error.value = null;
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const response = await getTaskBranchLineage(taskId.value);
      tree.value = response.data ?? [];
    } catch (nextError) {
      tree.value = [];
      error.value = nextError instanceof Error ? nextError.message : "加载分支拓扑失败";
    } finally {
      loading.value = false;
    }
  }

  watch(taskId, () => {
    void refresh();
  }, { immediate: true });

  return {
    tree,
    flatNodes,
    selectedNode,
    nodes: computed(() => flow.value.nodes),
    edges: computed(() => flow.value.edges),
    loading,
    error,
    refresh,
  };
}