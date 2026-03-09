// ── Realtime Event Types ────────────────────────────────────────────

export type RealtimeEventType =
  | "session.created"
  | "session.updated"
  | "session.idle"
  | "session.error"
  | "message.updated"
  | "tool.execute.before"
  | "tool.execute.after"
  | "agent.started"
  | "agent.paused"
  | "agent.resumed"
  | "agent.completed"
  | "agent.failed"
  | "agent.auth-error"
  | "task.created"
  | "task.continued"
  | "task.node.updated"
  | "task.completed"
  | "approval.required"
  | "approval.resolved"
  | "cost.threshold"
  | "guidance.injected";

export interface RealtimeEvent {
  id: string;
  type: RealtimeEventType;
  ts: string;
  projectId?: string;
  taskId?: string;
  sessionId?: string;
  agentRunId?: string;
  data: Record<string, unknown>;
}

// ── Task & Agent Models ─────────────────────────────────────────────

export type AgentRunStatus = "running" | "paused" | "completed" | "failed" | "stopped";

export interface AgentRun {
  id: string;
  taskId: string;
  agentType: string;
  subSessionId: string;
  status: AgentRunStatus;
  startedAt: string;
  finishedAt?: string;
  rounds: number;
  tokensUsed: number;
}

export type TaskNodeStatus =
  | "pending"
  | "blocked"
  | "in_progress"
  | "completed"
  | "failed"
  | "stopped"
  | "paused"
  | "waiting_approval";

export interface TaskNode {
  id: string;
  label: string;
  status: TaskNodeStatus;
  agentRunId?: string;
  dependsOn: string[];
  dod: string;
  metadata?: Record<string, unknown>;
}

export interface TaskEdge {
  from: string;
  to: string;
}

export interface Task {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  status: "active" | "completed" | "failed" | "stopped";
  nodes: TaskNode[];
  edges: TaskEdge[];
  agentRuns: AgentRun[];
  createdAt: string;
  finishedAt?: string;
}

// ── Approval ────────────────────────────────────────────────────────

export interface ApprovalTicket {
  id: string;
  taskId: string;
  agentRunId?: string;
  nodeId?: string;
  actionType: string;
  riskLevel: "medium" | "high" | "critical";
  status: "pending" | "approved" | "rejected" | "expired";
  requestDetail: Record<string, unknown>;
  approver?: string;
  comment?: string;
  createdAt: string;
  expiresAt: string;
}

// ── Guidance ────────────────────────────────────────────────────────

export interface GuidanceRequest {
  agentRunId: string;
  content: string;
  mode: "reply" | "noReply";
}
