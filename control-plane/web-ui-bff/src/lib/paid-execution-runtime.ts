import { cpFetch } from "./control-plane-client";
import { type PaidExecutionGuardState } from "./paid-execution-guard";
import { mergeTaskStrategy, parseTaskStrategy } from "./orchestration-strategy";
import { recordAgentAudit, recordModelUsage } from "../modules/agent-control/run-persistence";

interface TaskGuardRecord {
  projectId: string;
  strategy?: string | null;
  selectedModel?: string | null;
}

interface RecordPaidExecutionRuntimeUsageInput {
  authorization: string;
  taskId: string;
  projectId?: string;
  sessionId?: string;
  agentRunId?: string;
  modelRoute: string;
  tokenUsed: number;
  requestDelta: number;
  action?: string;
  detail?: Record<string, unknown>;
  riskLevel?: "low" | "medium" | "high" | "critical";
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
}

export interface PaidExecutionRuntimeOutcome {
  guardState?: PaidExecutionGuardState;
  tripped: boolean;
  breakerReason?: string;
}

function parseModelRoute(modelRoute: string) {
  const separatorIndex = modelRoute.indexOf(":");
  if (separatorIndex > 0) {
    return {
      providerId: modelRoute.slice(0, separatorIndex),
      modelId: modelRoute.slice(separatorIndex + 1),
    };
  }

  return {
    providerId: "github-copilot",
    modelId: modelRoute,
  };
}

function buildGuardDetail(
  guardState: PaidExecutionGuardState | undefined,
  detail: Record<string, unknown> = {},
) {
  if (!guardState?.enabled) {
    return detail;
  }

  return {
    leaseId: guardState.leaseId,
    guardDecision: guardState.guardDecision,
    guardReason: guardState.guardReason,
    estimatedRequestUpperBound: guardState.estimatedRequestUpperBound,
    estimatedTokenUpperBound: guardState.estimatedTokenUpperBound,
    estimatedCostUpperBound: guardState.estimatedCostUpperBound,
    actualRequests: guardState.actualRequests,
    actualTokenUsage: guardState.actualTokenUsage,
    actualCost: guardState.actualCost,
    guardOverridesApplied: guardState.overridesApplied,
    breakerTrippedAt: guardState.breakerTrippedAt,
    breakerReason: guardState.breakerReason,
    ...detail,
  };
}

export async function recordPaidExecutionRuntimeUsage(
  input: RecordPaidExecutionRuntimeUsageInput,
): Promise<PaidExecutionRuntimeOutcome> {
  if (input.tokenUsed <= 0) {
    return { tripped: false };
  }

  const taskResult = await cpFetch<TaskGuardRecord>(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    authorization: input.authorization,
  });
  if (!taskResult.ok) {
    return { tripped: false };
  }

  const task = taskResult.data;
  const taskStrategy = parseTaskStrategy(task.strategy);
  const currentGuard = taskStrategy.paidExecutionGuard as PaidExecutionGuardState | undefined;

  const resolvedModel = parseModelRoute(input.modelRoute || currentGuard?.modelRoute || task.selectedModel || "github-copilot:gpt-5-mini");
  const usage = await recordModelUsage({
    projectId: input.projectId || task.projectId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    agentRunId: input.agentRunId,
    providerId: resolvedModel.providerId,
    modelId: resolvedModel.modelId,
    tokenUsed: input.tokenUsed,
    runtimeLedger: input.runtimeLedger,
    audit: input.action
      && currentGuard?.enabled
      ? {
          projectId: input.projectId || task.projectId,
          taskId: input.taskId,
          sessionId: input.sessionId,
          agentRunId: input.agentRunId,
          eventType: "paid_execution",
          action: input.action,
          detail: input.detail,
          riskLevel: input.riskLevel,
        }
      : undefined,
  });

  if (!currentGuard?.enabled) {
    return { tripped: false };
  }

  const nextActualRequests = (currentGuard.actualRequests || 0) + input.requestDelta;
  const nextActualTokenUsage = (currentGuard.actualTokenUsage || 0) + usage.totalTokens;
  const nextActualCost = Number(((currentGuard.actualCost || 0) + usage.costUsd).toFixed(2));
  const overRequestLimit =
    currentGuard.maxRequestsPerRun > 0 && nextActualRequests > currentGuard.maxRequestsPerRun;
  const overCostLimit =
    currentGuard.maxEstimatedCostUsdPerRun > 0
    && nextActualCost > currentGuard.maxEstimatedCostUsdPerRun;
  const breakerReason = overRequestLimit
    ? `actual requests ${nextActualRequests} exceeded ${currentGuard.maxRequestsPerRun}`
    : overCostLimit
      ? `actual cost $${nextActualCost} exceeded $${currentGuard.maxEstimatedCostUsdPerRun}`
      : undefined;

  const nextGuard: PaidExecutionGuardState = {
    ...currentGuard,
    actualRequests: nextActualRequests,
    actualTokenUsage: nextActualTokenUsage,
    actualCost: nextActualCost,
    ...(breakerReason
      ? {
          breakerReason,
          breakerTrippedAt: currentGuard.breakerTrippedAt || new Date().toISOString(),
        }
      : {}),
  };

  await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    method: "PATCH",
    authorization: input.authorization,
    body: {
      strategy: mergeTaskStrategy(task.strategy, {
        paidExecutionGuard: nextGuard,
      }),
    },
  });

  if (breakerReason && !currentGuard.breakerTrippedAt) {
    await recordAgentAudit({
      projectId: input.projectId || task.projectId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      agentRunId: input.agentRunId,
      eventType: "paid_execution",
      action: "breaker_tripped",
      detail: buildGuardDetail(nextGuard, {
        sourceAction: input.action,
        providerId: resolvedModel.providerId,
        modelId: resolvedModel.modelId,
      }),
      riskLevel: "high",
    });
  }

  return {
    guardState: nextGuard,
    tripped: Boolean(breakerReason),
    breakerReason,
  };
}