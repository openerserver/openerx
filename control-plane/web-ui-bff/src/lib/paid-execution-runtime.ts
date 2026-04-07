import { recordAgentAudit, recordModelUsage } from "../modules/agent-control/run-persistence";
import { cpFetch } from "./control-plane-client";
import { resolveModelRoute } from "./model-config";
import { mergeTaskStrategy, parseTaskStrategy } from "./orchestration-strategy";
import type { PaidExecutionGuardState } from "./paid-execution-guard";

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
  return resolveModelRoute(modelRoute);
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

function buildNoTripOutcome() {
  return { tripped: false } satisfies PaidExecutionRuntimeOutcome;
}

function resolveRuntimeModelRoute(input: {
  modelRoute: string;
  currentGuard?: PaidExecutionGuardState;
  selectedModel?: string | null;
}) {
  return parseModelRoute(
    input.modelRoute ||
      input.currentGuard?.modelRoute ||
      input.selectedModel ||
      "github-copilot:gpt-5-mini",
  );
}

function computeNextPaidExecutionGuardState(args: {
  currentGuard: PaidExecutionGuardState;
  requestDelta: number;
  tokenUsed: number;
  costUsd: number;
}) {
  const nextActualRequests = (args.currentGuard.actualRequests || 0) + args.requestDelta;
  const nextActualTokenUsage = (args.currentGuard.actualTokenUsage || 0) + args.tokenUsed;
  const nextActualCost = Number(((args.currentGuard.actualCost || 0) + args.costUsd).toFixed(2));
  const overRequestLimit =
    args.currentGuard.maxRequestsPerRun > 0 &&
    nextActualRequests > args.currentGuard.maxRequestsPerRun;
  const overCostLimit =
    args.currentGuard.maxEstimatedCostUsdPerRun > 0 &&
    nextActualCost > args.currentGuard.maxEstimatedCostUsdPerRun;
  const breakerReason = overRequestLimit
    ? `actual requests ${nextActualRequests} exceeded ${args.currentGuard.maxRequestsPerRun}`
    : overCostLimit
      ? `actual cost $${nextActualCost} exceeded $${args.currentGuard.maxEstimatedCostUsdPerRun}`
      : undefined;

  return {
    nextGuard: {
      ...args.currentGuard,
      actualRequests: nextActualRequests,
      actualTokenUsage: nextActualTokenUsage,
      actualCost: nextActualCost,
      ...(breakerReason
        ? {
            breakerReason,
            breakerTrippedAt: args.currentGuard.breakerTrippedAt || new Date().toISOString(),
          }
        : {}),
    } satisfies PaidExecutionGuardState,
    breakerReason,
  };
}

async function persistPaidExecutionGuardState(input: {
  authorization: string;
  taskId: string;
  strategy?: string | null;
  nextGuard: PaidExecutionGuardState;
}) {
  await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    method: "PATCH",
    authorization: input.authorization,
    body: {
      strategy: mergeTaskStrategy(input.strategy, {
        paidExecutionGuard: input.nextGuard,
      }),
    },
  });
}

async function recordBreakerAuditIfNeeded(input: {
  breakerReason?: string;
  currentGuard?: PaidExecutionGuardState;
  nextGuard: PaidExecutionGuardState;
  projectId: string;
  taskId: string;
  sessionId?: string;
  agentRunId?: string;
  action?: string;
  providerId: string;
  modelId: string;
}) {
  if (!input.breakerReason || input.currentGuard?.breakerTrippedAt) {
    return;
  }

  await recordAgentAudit({
    projectId: input.projectId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    agentRunId: input.agentRunId,
    eventType: "paid_execution",
    action: "breaker_tripped",
    detail: buildGuardDetail(input.nextGuard, {
      sourceAction: input.action,
      providerId: input.providerId,
      modelId: input.modelId,
    }),
    riskLevel: "high",
  });
}

export async function recordPaidExecutionRuntimeUsage(
  input: RecordPaidExecutionRuntimeUsageInput,
): Promise<PaidExecutionRuntimeOutcome> {
  if (input.tokenUsed <= 0) {
    return buildNoTripOutcome();
  }

  const taskResult = await cpFetch<TaskGuardRecord>(
    `/api/project-tree/tasks/${encodeURIComponent(input.taskId)}`,
    {
      authorization: input.authorization,
    },
  );
  if (!taskResult.ok) {
    return buildNoTripOutcome();
  }

  const task = taskResult.data;
  const taskStrategy = parseTaskStrategy(task.strategy);
  const currentGuard = taskStrategy.paidExecutionGuard as PaidExecutionGuardState | undefined;
  const resolvedModel = resolveRuntimeModelRoute({
    modelRoute: input.modelRoute,
    currentGuard,
    selectedModel: task.selectedModel,
  });
  const usage = await recordModelUsage({
    projectId: input.projectId || task.projectId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    agentRunId: input.agentRunId,
    providerId: resolvedModel.providerId,
    modelId: resolvedModel.modelId,
    tokenUsed: input.tokenUsed,
    runtimeLedger: input.runtimeLedger,
    audit:
      input.action && currentGuard?.enabled
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
    return buildNoTripOutcome();
  }
  const { nextGuard, breakerReason } = computeNextPaidExecutionGuardState({
    currentGuard,
    requestDelta: input.requestDelta,
    tokenUsed: usage.totalTokens,
    costUsd: usage.costUsd,
  });

  await persistPaidExecutionGuardState({
    authorization: input.authorization,
    taskId: input.taskId,
    strategy: task.strategy,
    nextGuard,
  });
  await recordBreakerAuditIfNeeded({
    breakerReason,
    currentGuard,
    nextGuard,
    projectId: input.projectId || task.projectId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    agentRunId: input.agentRunId,
    action: input.action,
    providerId: resolvedModel.providerId,
    modelId: resolvedModel.modelId,
  });

  return {
    guardState: nextGuard,
    tripped: Boolean(breakerReason),
    breakerReason,
  };
}
