// ── Shared DAG / Graph Types ───────────────────────────────────────
// Single source of truth — mirroring opencode-fork runtime definitions.

export type NodeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "stopped"
  | "paused"
  | "waiting_approval";

export type EdgeType = "blocks" | "informs";

export type TaskCategory = "quick" | "deep" | "ops" | "security" | "architecture";

export type AgentRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped"
  | "terminated";

export type PluginSource = "builtin" | "local" | "registry";
export type PluginStatus = "enabled" | "disabled" | "error" | "not_installed";

// ── Valid State Transitions (same as task-graph-plugin.ts) ─────────

export const VALID_NODE_TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  pending: ["in_progress", "blocked"],
  in_progress: ["completed", "failed", "stopped", "paused", "waiting_approval"],
  completed: [],
  failed: ["in_progress", "stopped"],
  blocked: ["pending"],
  stopped: [],
  paused: ["in_progress", "stopped"],
  waiting_approval: ["in_progress", "stopped"],
};

export function isValidNodeTransition(from: NodeStatus, to: NodeStatus): boolean {
  return VALID_NODE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── API Response Shapes ────────────────────────────────────────────

export interface TaskNodeDTO {
  id: string;
  taskId: string;
  graphId: string;
  subject: string;
  status: NodeStatus;
  agentType: string;
  sessionId: string | null;
  retryCount: number;
  maxRetries: number;
  output: string | null;
  error: string | null;
  tokenUsed: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface TaskEdgeDTO {
  id: string;
  taskId: string;
  graphId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: EdgeType;
}

export interface TaskGraphDTO {
  taskId: string;
  graphId: string;
  nodes: TaskNodeDTO[];
  edges: TaskEdgeDTO[];
}

export interface AgentRunDTO {
  id: string;
  taskId: string;
  nodeId: string | null;
  sessionId: string | null;
  agentType: string;
  status: AgentRunStatus;
  modelUsed: string | null;
  tokenUsed: number;
  result: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface PluginDTO {
  id: string;
  name: string;
  displayName: string;
  pluginPath: string;
  version: string | null;
  source: PluginSource;
  status: PluginStatus;
  description: string | null;
  capabilities: string[];
  lastVerifiedAt: string | null;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
}
