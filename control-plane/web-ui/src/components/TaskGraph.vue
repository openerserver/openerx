<template>
  <VueFlow
    :nodes="graphNodes"
    :edges="graphEdges"
    :fit-view-on-init="true"
    :style="taskGraphTheme.canvas"
  >
    <Background :gap="20" :color="taskGraphTheme.backgroundColor" />
    <Controls />
    <template #node-default="{ data }">
      <div :style="nodeStyle(data.status)">
        <div style="font-size: 12px; font-weight: 500">{{ data.label }}</div>
        <div
          :style="{ fontSize: '10px', marginTop: '2px', color: taskGraphTheme.statusColors[data.status] || '#64748b' }"
        >
          {{ statusLabel(data.status) }}
        </div>
      </div>
    </template>
  </VueFlow>
</template>

<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { VueFlow } from "@vue-flow/core";
import { type CSSProperties, computed, ref, watch } from "vue";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import dagre from "dagre";
import { type TaskGraphData, getTaskGraph } from "../lib/api";
import { buildTaskGraphNodeStyle, taskGraphTheme } from "../theme/ui-theme";

interface TaskEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

const props = defineProps<{
  taskId: string;
  events: TaskEvent[];
  fallbackStatus?: string;
}>();

const apiGraph = ref<TaskGraphData | null>(null);

// Fetch graph data from API when taskId changes
watch(
  () => props.taskId,
  async (id) => {
    if (!id) return;
    try {
      apiGraph.value = await getTaskGraph(id);
    } catch {
      apiGraph.value = null;
    }
  },
  { immediate: true },
);

// Periodically refresh graph when task is running
watch(
  () => props.events.length,
  async () => {
    if (!props.taskId) return;
    try {
      apiGraph.value = await getTaskGraph(props.taskId);
    } catch {
      // Keep existing data
    }
  },
);

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: "待执行",
    blocked: "已阻塞",
    in_progress: "进行中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    stopped: "已停止",
    paused: "已暂停",
    waiting_approval: "待审批",
    cancelled: "已取消",
  };

  return map[status] || status;
}

function nodeStyle(status: string): CSSProperties {
  return buildTaskGraphNodeStyle(status);
}

const layoutResult = computed(() => {
  const nodeMap = new Map<string, { id: string; label: string; status: string }>();
  const edgeList: Array<{ source: string; target: string }> = [];

  // 1. Populate from API graph data (primary source)
  if (apiGraph.value && apiGraph.value.nodes.length > 0) {
    for (const node of apiGraph.value.nodes) {
      nodeMap.set(node.id, {
        id: node.id,
        label: node.subject,
        status: node.status,
      });
    }
    for (const edge of apiGraph.value.edges) {
      edgeList.push({ source: edge.fromNodeId, target: edge.toNodeId });
    }
  }

  // 2. Overlay real-time event updates (incremental refresh)
  for (const event of props.events) {
    if (event.type === "task.node.updated" && event.data.nodeId) {
      const nodeId = event.data.nodeId as string;
      const existing = nodeMap.get(nodeId);
      nodeMap.set(nodeId, {
        id: nodeId,
        label: (event.data.label as string) || existing?.label || nodeId,
        status: (event.data.status as string) || existing?.status || "pending",
      });

      // Add edges from dependsOn if not from API
      if (event.data.dependsOn && edgeList.length === 0) {
        const deps = event.data.dependsOn as string[];
        for (const dep of deps) {
          edgeList.push({ source: dep, target: nodeId });
        }
      }
    }
  }

  // 3. Placeholder if no data at all
  if (nodeMap.size === 0) {
    nodeMap.set("placeholder", {
      id: "placeholder",
      label: `Task ${props.taskId.slice(0, 8)}`,
      status: props.fallbackStatus || "pending",
    });
  }

  // Dagre layout
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 80 });

  for (const node of nodeMap.values()) {
    g.setNode(node.id, { width: 180, height: 60 });
  }
  for (const edge of edgeList) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  const flowNodes = Array.from(nodeMap.values()).map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: "default",
      position: { x: pos.x - 90, y: pos.y - 30 },
      data: { label: n.label, status: n.status },
    };
  });

  const flowEdges = edgeList.map((e) => ({
    id: `${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    animated: true,
    style: { stroke: taskGraphTheme.edgeStroke },
  }));

  return { nodes: flowNodes, edges: flowEdges };
});

const graphNodes = computed(() => layoutResult.value.nodes);
const graphEdges = computed(() => layoutResult.value.edges);
</script>
