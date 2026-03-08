import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";

interface TaskGraphProps {
  taskId: string;
  events: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
  }>;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#64748b",
  blocked: "#a855f7",
  in_progress: "#3b82f6",
  completed: "#22c55e",
  failed: "#ef4444",
  stopped: "#6b7280",
  paused: "#f59e0b",
  waiting_approval: "#f97316",
};

function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 80 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 180, height: 60 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutNodes = nodes.map((node) => {
    const { x, y } = g.node(node.id);
    return {
      ...node,
      position: { x: x - 90, y: y - 30 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  });

  return { nodes: layoutNodes, edges };
}

export function TaskGraph({ taskId, events }: TaskGraphProps) {
  // Build graph from events
  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, { id: string; label: string; status: string }>();

    for (const event of events) {
      if (event.type === "task.node.updated" && event.data.nodeId) {
        const nodeId = event.data.nodeId as string;
        nodeMap.set(nodeId, {
          id: nodeId,
          label: (event.data.label as string) || nodeId,
          status: (event.data.status as string) || "pending",
        });
      }
    }

    // If no nodes from events, show placeholder
    if (nodeMap.size === 0) {
      nodeMap.set("placeholder", {
        id: "placeholder",
        label: `Task ${taskId.slice(0, 8)}`,
        status: "pending",
      });
    }

    const flowNodes: Node[] = Array.from(nodeMap.values()).map((n) => ({
      id: n.id,
      data: {
        label: (
          <div className="text-center">
            <div className="text-xs font-medium">{n.label}</div>
            <div
              className="text-[10px] mt-0.5"
              style={{ color: STATUS_COLORS[n.status] || "#64748b" }}
            >
              {n.status}
            </div>
          </div>
        ),
      },
      position: { x: 0, y: 0 },
      style: {
        background: "#1e293b",
        border: `2px solid ${STATUS_COLORS[n.status] || "#64748b"}`,
        borderRadius: 8,
        padding: 8,
        width: 180,
        color: "#e2e8f0",
        fontSize: 12,
      },
    }));

    // Extract edges from dependsOn data
    const flowEdges: Edge[] = [];
    for (const event of events) {
      if (event.type === "task.node.updated" && event.data.dependsOn) {
        const deps = event.data.dependsOn as string[];
        const nodeId = event.data.nodeId as string;
        for (const dep of deps) {
          flowEdges.push({
            id: `${dep}-${nodeId}`,
            source: dep,
            target: nodeId,
            style: { stroke: "#475569" },
            animated: true,
          });
        }
      }
    }

    return layoutGraph(flowNodes, flowEdges);
  }, [events, taskId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      proOptions={{ hideAttribution: true }}
      className="bg-slate-950 rounded-lg"
    >
      <Background color="#334155" gap={20} />
      <Controls />
    </ReactFlow>
  );
}
