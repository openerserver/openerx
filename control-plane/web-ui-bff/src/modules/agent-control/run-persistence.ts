import { cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import { estimatePaidExecutionUsage } from "../../lib/paid-execution-guard";
import { syncRuntimeUsageLedger } from "../../lib/runtime-usage-ledger";

type AgentRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped"
  | "terminated";
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

interface CreateCostRecordInput {
  projectId: string;
  taskId?: string;
  sessionId?: string;
  agentRunId?: string;
  userId?: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  budgetPeriod?: "daily" | "weekly" | "monthly";
}

interface RecordModelUsageInput {
  projectId: string;
  taskId?: string;
  sessionId?: string;
  agentRunId?: string;
  userId?: string;
  providerId: string;
  modelId: string;
  tokenUsed: number;
  budgetPeriod?: "daily" | "weekly" | "monthly";
  runtimeLedger?: {
    executionSource: string;
    entrypointType: string;
    orchestrationFingerprint?: string;
    candidateCount?: number;
    judgeRequestCountDelta?: number;
    hookRequestCountDelta?: number;
    status?: "running" | "completed" | "failed" | "cancelled";
    startedAt?: string;
    finishedAt?: string;
    step?: {
      stepType: "execution" | "judge" | "hook" | "resume" | "other";
      triggerType?: string;
      hookId?: string;
      candidateIndex?: number;
      requestIndex?: number;
      amplificationSource?: string;
      status?: "pending" | "completed" | "failed" | "skipped";
      startedAt?: string;
      finishedAt?: string;
    };
  };
  audit?: RecordAgentAuditInput;
}

interface ModelUsageRecord {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
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
    console.warn(
      `[agent-run-persistence] failed to create run ${input.agentRunId}:`,
      response.data,
    );
  }
}

export async function patchAgentRunRecord(input: PatchAgentRunRecordInput): Promise<void> {
  const authorization = await createInternalAuthorization();
  const response = await cpFetch(
    `/api/tasks/${encodeURIComponent(input.taskId)}/runs/${encodeURIComponent(input.agentRunId)}`,
    {
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
    },
  );

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
    console.warn(
      `[agent-run-persistence] failed to record audit ${input.eventType}.${input.action}:`,
      response.data,
    );
  }
}

export async function createCostRecord(input: CreateCostRecordInput): Promise<void> {
  const authorization = await createInternalAuthorization();
  const response = await cpFetch("/api/cost/records", {
    method: "POST",
    authorization,
    body: input,
  });

  if (!response.ok) {
    console.warn(
      `[agent-run-persistence] failed to create cost record for task ${input.taskId ?? "unknown"}:`,
      response.data,
    );
  }
}

export async function recordModelUsage(input: RecordModelUsageInput): Promise<ModelUsageRecord> {
  const usage = estimatePaidExecutionUsage(
    {
      providerId: input.providerId,
      modelId: input.modelId,
    },
    input.tokenUsed,
  );

  await createCostRecord({
    projectId: input.projectId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    agentRunId: input.agentRunId,
    userId: input.userId,
    providerId: input.providerId,
    modelId: input.modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: usage.costUsd,
    budgetPeriod: input.budgetPeriod,
  });

  if (input.runtimeLedger && input.sessionId) {
    await syncRuntimeUsageLedger({
      projectId: input.projectId,
      taskId: input.taskId,
      agentRunId: input.agentRunId,
      runtimeSessionId: input.sessionId,
      executionSource: input.runtimeLedger.executionSource,
      entrypointType: input.runtimeLedger.entrypointType,
      orchestrationFingerprint: input.runtimeLedger.orchestrationFingerprint,
      defaultProviderId: input.providerId,
      defaultModelId: input.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      costUsd: usage.costUsd,
      candidateCount: input.runtimeLedger.candidateCount,
      judgeRequestCountDelta: input.runtimeLedger.judgeRequestCountDelta,
      hookRequestCountDelta: input.runtimeLedger.hookRequestCountDelta,
      status: input.runtimeLedger.status,
      startedAt: input.runtimeLedger.startedAt,
      finishedAt: input.runtimeLedger.finishedAt,
      step: input.runtimeLedger.step
        ? {
            stepType: input.runtimeLedger.step.stepType,
            triggerType: input.runtimeLedger.step.triggerType,
            hookId: input.runtimeLedger.step.hookId,
            candidateIndex: input.runtimeLedger.step.candidateIndex,
            requestIndex: input.runtimeLedger.step.requestIndex,
            providerId: input.providerId,
            modelId: input.modelId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            costUsd: usage.costUsd,
            amplificationSource: input.runtimeLedger.step.amplificationSource,
            status: input.runtimeLedger.step.status,
            startedAt: input.runtimeLedger.step.startedAt,
            finishedAt: input.runtimeLedger.step.finishedAt,
          }
        : undefined,
    });
  }

  if (input.audit) {
    await recordAgentAudit({
      ...input.audit,
      detail: {
        providerId: input.providerId,
        modelId: input.modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        costUsd: usage.costUsd,
        ...(input.audit.detail || {}),
      },
    });
  }

  return {
    providerId: input.providerId,
    modelId: input.modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: usage.costUsd,
  };
}
