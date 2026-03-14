import { cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";

type AgentRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "stopped" | "terminated";
type RiskLevel = "low" | "medium" | "high" | "critical";

function toModelUsed(model?: { providerId: string; modelId: string }) {
  return model ? `${model.providerId}:${model.modelId}` : undefined;
}

interface CreateAgentRunRecordInput {
  taskId: string;
  agentRunId: string;
  sessionId?: string;
  agentType: string;
  status: AgentRunStatus;
  model?: { providerId: string; modelId: string };
  candidateIndex?: number;
  startedAt?: string;
  finishedAt?: string;
  tokenUsed?: number;
  result?: string;
  error?: string;
}

interface PatchAgentRunRecordInput {
  taskId: string;
  agentRunId: string;
  status: Exclude<AgentRunStatus, "pending">;
  model?: { providerId: string; modelId: string };
  startedAt?: string;
  finishedAt?: string;
  tokenUsed?: number;
  result?: string;
  error?: string;
}

interface RecordAgentAuditInput {
  projectId?: string;
  taskId?: string;
  sessionId?: string;
  agentRunId?: string;
  eventType: string;
  action: string;
  detail?: Record<string, unknown>;
  riskLevel?: RiskLevel;
}

export async function createAgentRunRecord(input: CreateAgentRunRecordInput): Promise<void> {
  const authorization = await createInternalAuthorization();
  const response = await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}/runs`, {
    method: "POST",
    authorization,
    body: {
      id: input.agentRunId,
      sessionId: input.sessionId,
      agentType: input.agentType,
      status: input.status,
      modelUsed: toModelUsed(input.model),
      candidateIndex: input.candidateIndex,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      tokenUsed: input.tokenUsed,
      result: input.result,
      error: input.error,
    },
  });

  if (!response.ok && response.status !== 409) {
    console.warn(`[agent-run-persistence] failed to create run ${input.agentRunId}:`, response.data);
  }
}

export async function patchAgentRunRecord(input: PatchAgentRunRecordInput): Promise<void> {
  const authorization = await createInternalAuthorization();
  const response = await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}/runs/${encodeURIComponent(input.agentRunId)}`, {
    method: "PATCH",
    authorization,
    body: {
      status: input.status,
      modelUsed: toModelUsed(input.model),
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      tokenUsed: input.tokenUsed,
      result: input.result,
      error: input.error,
    },
  });

  if (!response.ok) {
    console.warn(`[agent-run-persistence] failed to patch run ${input.agentRunId}:`, response.data);
  }
}

export async function recordAgentAudit(input: RecordAgentAuditInput): Promise<void> {
  const authorization = await createInternalAuthorization();
  const response = await cpFetch("/api/audit", {
    method: "POST",
    authorization,
    body: {
      projectId: input.projectId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      agentRunId: input.agentRunId,
      eventType: input.eventType,
      action: input.action,
      detail: input.detail,
      riskLevel: input.riskLevel,
    },
  });

  if (!response.ok) {
    console.warn(`[agent-run-persistence] failed to record audit ${input.eventType}.${input.action}:`, response.data);
  }
}