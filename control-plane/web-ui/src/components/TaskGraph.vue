<template>
  <VueFlow
    :nodes="graphNodes"
    :edges="graphEdges"
    :fit-view-on-init="true"
    style="height: 100%; background: #0f172a; border-radius: 8px"
  >
    <Background :gap="20" :color="'#334155'" />
    <Controls />
    <template #node-default="{ data }">
      <div :style="nodeStyle(data.status)">
        <div style="font-size: 12px; font-weight: 500">{{ data.label }}</div>
        <div
          :style="{ fontSize: '10px', marginTop: '2px', color: statusColors[data.status] || '#64748b' }"
        >
          {{ data.status }}
        </div>
      </div>
    </template>
  </VueFlow>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from "vue";
import { VueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import dagre from "dagre";

interface TaskEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

const props = defineProps<{
  taskId: string;
  events: TaskEvent[];
}>();

const statusColors: Record<string, string> = {
  pending: "#64748b",
  blocked: "#a855f7",
  in_progress: "#3b82f6",
  completed: "#22c55e",
  failed: "#ef4444",
  stopped: "#6b7280",
  paused: "#f59e0b",
  waiting_approval: "#f97316",
};

function nodeStyle(status: string): CSSProperties {
  return {
    background: "#1e293b",
    border: `2px solid ${statusColors[status] || "#64748b"}`,
    borderRadius: "8px",
    padding: "8px 12px",
    color: "#e2e8f0",
    textAlign: "center",
    minWidth: "140px",
  };
}

const layoutResult = computed(() => {
  const nodeMap = new Map<
    string,
    { id: string; label: string; status: string }
  >();

  for (const event of props.events) {
    if (event.type === "task.node.updated" && event.data.nodeId) {
      const nodeId = event.data.nodeId as string;
      nodeMap.set(nodeId, {
        id: nodeId,
        label: (event.data.label as string) || nodeId,
        status: (event.data.status as string) || "pending",
      });
    }
  }

  // Placeholder if no nodes
  if (nodeMap.size === 0) {
    nodeMap.set("placeholder", {
      id: "placeholder",
      label: `Task ${props.taskId.slice(0, 8)}`,
      status: "pending",
    });
  }

  // Extract edges
  const edges: Array<{ source: string; target: string }> = [];
  for (const event of props.events) {
    if (event.type === "task.node.updated" && event.data.dependsOn) {
      const deps = event.data.dependsOn as string[];
      const nodeId = event.data.nodeId as string;
      for (const dep of deps) {
        edges.push({ source: dep, target: nodeId });
      }
    }
  }

  // Dagre layout
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 80 });

  for (const node of nodeMap.values()) {
    g.setNode(node.id, { width: 180, height: 60 });
  }
  for (const edge of edges) {
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

  const flowEdges = edges.map((e) => ({
    id: `${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    animated: true,
    style: { stroke: "#475569" },
  }));

  return { nodes: flowNodes, edges: flowEdges };
});

const graphNodes = computed(() => layoutResult.value.nodes);
const graphEdges = computed(() => layoutResult.value.edges);
</script>
