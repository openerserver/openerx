// ── Realtime Event Types ────────────────────────────────────────────

/**
 * Public realtime event contract for TaskDetail clients.
 *
 * The `task.phase.*` family is the **primary** phase-first contract for the
 * TaskDetail main path: clients must treat these events as the authoritative
 * trigger for phase-local refreshes and phase-block state updates. Legacy
 * events (`session.activated`, round-level signals, etc.) remain supported for
 * compat consumers but must not be used as the primary driver of phase refresh
 * logic. See docs/task-detail/task-detail-phase-first-migration-checklist.md
 * §5.4.
 */
export type RealtimeEventType =
  | "session.created"
  | "session.updated"
  | "session.activated"
  | "session.status"
  | "session.idle"
  | "session.error"
  | "message.updated"
  | "task.message.updated"
  | "task.message.delta"
  | "task.message.persisted"
  | "task.phase.created"
  | "task.phase.updated"
  | "task.phase.awaiting_adoption"
  | "task.phase.paused"
  | "task.phase.resumed"
  | "task.phase.cancelled"
  | "task.phase.completed"
  | "task.phase.failed"
  | "task.round.synced"
  | "task.reconcile.required"
  | "task.snapshot.updated"
  | "tool.execute.before"
  | "tool.execute.after"
  | "agent.started"
  | "agent.paused"
  | "agent.resumed"
  | "agent.completed"
  | "agent.failed"
  | "agent.stopped"
  | "agent.auth-error"
  | "task.created"
  | "task.forked"
  | "task.continued"
  | "task.node.updated"
  | "pipeline.stage.updated"
  | "task.completed"
  | "task.failed"
  | "task.hooks.updated"
  | "task.followup.started"
  | "task.followup.completed"
  | "task.followup.failed"
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
  phaseId?: string;
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
