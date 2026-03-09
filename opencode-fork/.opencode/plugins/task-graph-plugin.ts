import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Plugin, tool } from "@opencode-ai/plugin";

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

function getBlockingEdges(graph: TaskGraph, nodeId: string): TaskEdge[] {
  return graph.edges.filter((edge) => edge.to === nodeId && edge.type === "blocks");
}

function getDownstreamBlockTargets(graph: TaskGraph, nodeId: string): string[] {
  return graph.edges
    .filter((edge) => edge.from === nodeId && edge.type === "blocks")
    .map((edge) => edge.to);
}

function areAllBlockersCompleted(graph: TaskGraph, nodeId: string): boolean {
  return getBlockingEdges(graph, nodeId)
    .map((edge) => edge.from)
    .every(
      (blockerId) => graph.nodes.find((node) => node.id === blockerId)?.status === "completed",
    );
}

function unblockCompletedDependents(graph: TaskGraph, nodeId: string): void {
  for (const downstreamId of getDownstreamBlockTargets(graph, nodeId)) {
    const downstreamNode = graph.nodes.find((node) => node.id === downstreamId);
    if (downstreamNode?.status === "blocked" && areAllBlockersCompleted(graph, downstreamId)) {
      downstreamNode.status = "pending";
    }
  }
}

function blockDownstreamNodes(graph: TaskGraph, nodeId: string): void {
  for (const downstreamId of getDownstreamBlockTargets(graph, nodeId)) {
    const downstreamNode = graph.nodes.find((node) => node.id === downstreamId);
    if (downstreamNode?.status === "pending") {
      downstreamNode.status = "blocked";
    }
  }
}

function updateDependentNodes(graph: TaskGraph, nodeId: string, newStatus: NodeStatus): void {
  if (newStatus === "completed") {
    unblockCompletedDependents(graph, nodeId);
  } else if (newStatus === "stopped" || newStatus === "failed") {
    blockDownstreamNodes(graph, nodeId);
  }
}

function applyNodeUpdate(
  node: TaskNode,
  newStatus: NodeStatus,
  sessionId?: string,
  output?: string,
  error?: string,
  tokenUsed?: number,
): void {
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
}

function checkGraphCompletion(graph: TaskGraph): void {
  const allTerminal = graph.nodes.every((n) => n.status === "completed" || n.status === "stopped");
  const anyFailed = graph.nodes.some((n) => n.status === "failed" && n.retryCount >= n.maxRetries);

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
          nodes: tool.schema.string("JSON array of nodes: [{subject, agentType, maxRetries?}]"),
          edges: tool.schema.string(
            "JSON array of edges: [{fromIndex, toIndex, type}] where index refers to node position",
          ),
        },
        async execute({ taskId, title, nodes: nodesJson, edges: edgesJson }) {
          const rawNodes = JSON.parse(nodesJson) as Array<Record<string, unknown>>;
          const rawEdges = JSON.parse(edgesJson) as Array<Record<string, unknown>>;

          const isNodeStatus = (value: unknown): value is NodeStatus =>
            typeof value === "string" &&
            [
              "pending",
              "in_progress",
              "completed",
              "failed",
              "blocked",
              "stopped",
              "paused",
              "waiting_approval",
            ].includes(value);

          const externalNodeIds = rawNodes.map((rn, i) => String(rn.id ?? i));

          const graphId = generateId();
          const taskNodes: TaskNode[] = rawNodes.map((rn, i) => ({
            id: `${graphId}-n${i}`,
            subject:
              typeof rn.subject === "string"
                ? rn.subject
                : typeof rn.title === "string"
                  ? rn.title
                  : typeof rn.name === "string"
                    ? rn.name
                    : typeof rn.description === "string"
                      ? rn.description
                      : `Step ${i + 1}`,
            status: isNodeStatus(rn.status) ? rn.status : ("pending" as NodeStatus),
            agentType:
              typeof rn.agentType === "string"
                ? rn.agentType
                : typeof rn.agent === "string"
                  ? rn.agent
                  : "build",
            sessionId: null,
            retryCount: 0,
            maxRetries: typeof rn.maxRetries === "number" ? rn.maxRetries : 3,
            output: null,
            error: null,
            tokenUsed: 0,
            startedAt: null,
            finishedAt: null,
          }));

          const resolveNodeIndex = (value: unknown): number => {
            if (typeof value === "number" && Number.isInteger(value)) {
              return value;
            }
            if (typeof value === "string") {
              const byExternalId = externalNodeIds.indexOf(value);
              if (byExternalId >= 0) return byExternalId;

              const byGraphNodeId = taskNodes.findIndex((node) => node.id === value);
              if (byGraphNodeId >= 0) return byGraphNodeId;

              const bySubject = taskNodes.findIndex((node) => node.subject === value);
              if (bySubject >= 0) return bySubject;
            }
            return -1;
          };

          const edgeKeys = new Set<string>();
          const taskEdges: TaskEdge[] = [];
          const pushEdge = (fromIndex: number, toIndex: number, type?: unknown) => {
            const fromNode = taskNodes[fromIndex];
            const toNode = taskNodes[toIndex];
            if (!fromNode || !toNode) return;

            const edgeType = type === "informs" ? "informs" : "blocks";
            const key = `${fromNode.id}:${toNode.id}:${edgeType}`;
            if (edgeKeys.has(key)) return;
            edgeKeys.add(key);
            taskEdges.push({ from: fromNode.id, to: toNode.id, type: edgeType });
          };

          for (const re of rawEdges) {
            const fromIndex = resolveNodeIndex(re.fromIndex ?? re.from);
            const toIndex = resolveNodeIndex(re.toIndex ?? re.to);
            pushEdge(fromIndex, toIndex, re.type);
          }

          rawNodes.forEach((rn, toIndex) => {
            const dependencies = Array.isArray(rn.dependencies) ? rn.dependencies : [];
            for (const dependency of dependencies) {
              const fromIndex = resolveNodeIndex(dependency);
              pushEdge(fromIndex, toIndex, "blocks");
            }
          });

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

          applyNodeUpdate(node, newStatus, sessionId, output, error, tokenUsed);

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
