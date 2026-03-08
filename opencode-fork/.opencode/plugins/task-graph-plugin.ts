import { type Plugin, tool } from "@opencode-ai/plugin";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────────

type NodeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "stopped"
  | "paused"
  | "waiting_approval";

interface TaskNode {
  id: string;
  subject: string;
  status: NodeStatus;
  agentType: string;
  sessionId: string | null;
  retryCount: number;
  maxRetries: number;
  output: string | null;
  error: string | null;
  tokenUsed: number;
  startedAt: number | null;
  finishedAt: number | null;
}

interface TaskEdge {
  from: string;
  to: string;
  type: "blocks" | "informs";
}

interface TaskGraph {
  id: string;
  taskId: string;
  title: string;
  nodes: TaskNode[];
  edges: TaskEdge[];
  status: "active" | "completed" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
}

// ── Valid State Transitions ────────────────────────────────────────

const VALID_TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  pending: ["in_progress", "blocked"],
  in_progress: ["completed", "failed", "stopped", "paused", "waiting_approval"],
  completed: [], // terminal
  failed: ["in_progress", "stopped"], // retry or give up
  blocked: ["pending"], // unblock when dependency completes
  stopped: [], // terminal
  paused: ["in_progress", "stopped"],
  waiting_approval: ["in_progress", "stopped"],
};

function isValidTransition(from: NodeStatus, to: NodeStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Persistence ────────────────────────────────────────────────────

function getStorageDir(directory: string): string {
  const dir = join(directory, ".opencode", "state", "task-graphs");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function saveGraph(directory: string, graph: TaskGraph): void {
  const filePath = join(getStorageDir(directory), `${graph.id}.json`);
  writeFileSync(filePath, JSON.stringify(graph, null, 2), "utf-8");
}

function loadGraph(directory: string, graphId: string): TaskGraph | null {
  const filePath = join(getStorageDir(directory), `${graphId}.json`);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as TaskGraph;
}

function listGraphs(directory: string): string[] {
  const dir = getStorageDir(directory);
  if (!existsSync(dir)) return [];
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(".json", ""));
}

// ── Graph Operations ───────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getReadyNodes(graph: TaskGraph): TaskNode[] {
  return graph.nodes.filter((node) => {
    if (node.status !== "pending") return false;
    const blockers = graph.edges
      .filter((e) => e.to === node.id && e.type === "blocks")
      .map((e) => e.from);
    return blockers.every((blockerId) => {
      const blockerNode = graph.nodes.find((n) => n.id === blockerId);
      return blockerNode?.status === "completed";
    });
  });
}

function updateDependentNodes(graph: TaskGraph, nodeId: string, newStatus: NodeStatus): void {
  if (newStatus === "completed") {
    // Unblock downstream nodes whose all blockers are now completed
    const downstream = graph.edges
      .filter((e) => e.from === nodeId && e.type === "blocks")
      .map((e) => e.to);

    for (const downId of downstream) {
      const downNode = graph.nodes.find((n) => n.id === downId);
      if (downNode?.status === "blocked") {
        const allBlockers = graph.edges
          .filter((e) => e.to === downId && e.type === "blocks")
          .map((e) => e.from);
        const allDone = allBlockers.every((bid) => {
          const bn = graph.nodes.find((n) => n.id === bid);
          return bn?.status === "completed";
        });
        if (allDone) {
          downNode.status = "pending";
        }
      }
    }
  } else if (newStatus === "stopped" || newStatus === "failed") {
    // Block downstream nodes
    const downstream = graph.edges
      .filter((e) => e.from === nodeId && e.type === "blocks")
      .map((e) => e.to);

    for (const downId of downstream) {
      const downNode = graph.nodes.find((n) => n.id === downId);
      if (downNode && downNode.status === "pending") {
        downNode.status = "blocked";
      }
    }
  }
}

function checkGraphCompletion(graph: TaskGraph): void {
  const allTerminal = graph.nodes.every(
    (n) => n.status === "completed" || n.status === "stopped",
  );
  const anyFailed = graph.nodes.some(
    (n) => n.status === "failed" && n.retryCount >= n.maxRetries,
  );

  if (allTerminal) {
    graph.status = "completed";
  } else if (anyFailed) {
    graph.status = "failed";
  }
}

// ── Plugin Export ──────────────────────────────────────────────────

export const TaskGraphPlugin: Plugin = async ({ directory }) => {
  return {
    tool: {
      task_graph_create: tool({
        description: "Create a new task graph DAG with nodes and dependency edges",
        args: {
          taskId: tool.schema.string("Unique task identifier"),
          title: tool.schema.string("Task title"),
          nodes: tool.schema.string(
            "JSON array of nodes: [{subject, agentType, maxRetries?}]",
          ),
          edges: tool.schema.string(
            "JSON array of edges: [{fromIndex, toIndex, type}] where index refers to node position",
          ),
        },
        async execute({ taskId, title, nodes: nodesJson, edges: edgesJson }) {
          const rawNodes = JSON.parse(nodesJson) as Array<{
            subject: string;
            agentType: string;
            maxRetries?: number;
          }>;
          const rawEdges = JSON.parse(edgesJson) as Array<{
            fromIndex: number;
            toIndex: number;
            type?: "blocks" | "informs";
          }>;

          const graphId = generateId();
          const taskNodes: TaskNode[] = rawNodes.map((rn, i) => ({
            id: `${graphId}-n${i}`,
            subject: rn.subject,
            status: "pending" as NodeStatus,
            agentType: rn.agentType,
            sessionId: null,
            retryCount: 0,
            maxRetries: rn.maxRetries ?? 3,
            output: null,
            error: null,
            tokenUsed: 0,
            startedAt: null,
            finishedAt: null,
          }));

          const taskEdges: TaskEdge[] = rawEdges.map((re) => ({
            from: taskNodes[re.fromIndex]!.id,
            to: taskNodes[re.toIndex]!.id,
            type: re.type ?? "blocks",
          }));

          // Mark nodes with unsatisfied dependencies as blocked
          for (const node of taskNodes) {
            const blockers = taskEdges
              .filter((e) => e.to === node.id && e.type === "blocks")
              .map((e) => e.from);
            if (blockers.length > 0) {
              node.status = "blocked";
            }
          }

          const graph: TaskGraph = {
            id: graphId,
            taskId,
            title,
            nodes: taskNodes,
            edges: taskEdges,
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          saveGraph(directory, graph);

          return JSON.stringify({
            graphId,
            nodeCount: taskNodes.length,
            edgeCount: taskEdges.length,
            readyNodes: getReadyNodes(graph).map((n) => ({
              id: n.id,
              subject: n.subject,
              agentType: n.agentType,
            })),
          });
        },
      }),

      task_graph_update_node: tool({
        description: "Update a node's status in the task graph (enforces valid state transitions)",
        args: {
          graphId: tool.schema.string("Graph ID"),
          nodeId: tool.schema.string("Node ID to update"),
          status: tool.schema.string(
            "New status: pending|in_progress|completed|failed|blocked|stopped|paused|waiting_approval",
          ),
          sessionId: tool.schema.string("OpenCode session ID (optional)"),
          output: tool.schema.string("Node output summary (optional)"),
          error: tool.schema.string("Error message (optional)"),
          tokenUsed: tool.schema.number("Tokens consumed (optional)"),
        },
        async execute({ graphId, nodeId, status, sessionId, output, error, tokenUsed }) {
          const graph = loadGraph(directory, graphId);
          if (!graph) return JSON.stringify({ error: "Graph not found" });

          const node = graph.nodes.find((n) => n.id === nodeId);
          if (!node) return JSON.stringify({ error: "Node not found" });

          const newStatus = status as NodeStatus;
          if (!isValidTransition(node.status, newStatus)) {
            return JSON.stringify({
              error: `Invalid transition: ${node.status} → ${newStatus}`,
              validTransitions: VALID_TRANSITIONS[node.status],
            });
          }

          node.status = newStatus;
          if (sessionId) node.sessionId = sessionId;
          if (output) node.output = output;
          if (error) node.error = error;
          if (tokenUsed) node.tokenUsed += tokenUsed;

          if (newStatus === "in_progress" && !node.startedAt) {
            node.startedAt = Date.now();
          }
          if (newStatus === "completed" || newStatus === "stopped") {
            node.finishedAt = Date.now();
          }
          if (newStatus === "failed") {
            node.retryCount++;
          }

          updateDependentNodes(graph, nodeId, newStatus);
          checkGraphCompletion(graph);

          graph.updatedAt = Date.now();
          saveGraph(directory, graph);

          return JSON.stringify({
            nodeId,
            status: newStatus,
            graphStatus: graph.status,
            readyNodes: getReadyNodes(graph).map((n) => ({
              id: n.id,
              subject: n.subject,
              agentType: n.agentType,
            })),
          });
        },
      }),

      task_graph_query: tool({
        description: "Query the current state of a task graph",
        args: {
          graphId: tool.schema.string("Graph ID to query"),
        },
        async execute({ graphId }) {
          const graph = loadGraph(directory, graphId);
          if (!graph) return JSON.stringify({ error: "Graph not found" });

          const summary = {
            id: graph.id,
            taskId: graph.taskId,
            title: graph.title,
            status: graph.status,
            nodesSummary: {
              total: graph.nodes.length,
              pending: graph.nodes.filter((n) => n.status === "pending").length,
              in_progress: graph.nodes.filter((n) => n.status === "in_progress").length,
              completed: graph.nodes.filter((n) => n.status === "completed").length,
              failed: graph.nodes.filter((n) => n.status === "failed").length,
              blocked: graph.nodes.filter((n) => n.status === "blocked").length,
              stopped: graph.nodes.filter((n) => n.status === "stopped").length,
            },
            nodes: graph.nodes.map((n) => ({
              id: n.id,
              subject: n.subject,
              status: n.status,
              agentType: n.agentType,
              tokenUsed: n.tokenUsed,
              retryCount: n.retryCount,
            })),
            edges: graph.edges,
            readyNodes: getReadyNodes(graph).map((n) => ({
              id: n.id,
              subject: n.subject,
              agentType: n.agentType,
            })),
          };

          return JSON.stringify(summary, null, 2);
        },
      }),

      task_graph_list: tool({
        description: "List all task graphs",
        args: {},
        async execute() {
          const ids = listGraphs(directory);
          const summaries = ids.map((id) => {
            const graph = loadGraph(directory, id);
            if (!graph) return { id, error: "Failed to load" };
            return {
              id: graph.id,
              taskId: graph.taskId,
              title: graph.title,
              status: graph.status,
              nodeCount: graph.nodes.length,
              completedNodes: graph.nodes.filter((n) => n.status === "completed").length,
              createdAt: graph.createdAt,
            };
          });
          return JSON.stringify(summaries, null, 2);
        },
      }),
    },
  };
};

export default TaskGraphPlugin;
