import { recordAgentAudit, recordModelUsage } from "../modules/agent-control/run-persistence";
import { cpFetch } from "./control-plane-client";
import { resolveModelRoute } from "./model-config";
import { mergeTaskStrategy, parseTaskStrategy } from "./orchestration-strategy";
import type { PaidExecutionGuardState } from "./paid-execution-guard";
import { consumeProjectFund, refundProjectFund } from "./project-fund";

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

function roundUsd(value: number) {
  return Number(Number(value || 0).toFixed(4));
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
    guardDecision: guardState.guardDecision,
    guardReason: guardState.guardReason,
    estimatedRequestUpperBound: guardState.estimatedRequestUpperBound,
    estimatedTokenUpperBound: guardState.estimatedTokenUpperBound,
    estimatedCostUpperBound: guardState.estimatedCostUpperBound,
    actualRequests: guardState.actualRequests,
    actualTokenUsage: guardState.actualTokenUsage,
    actualCost: guardState.actualCost,
    guardOverridesApplied: guardState.overridesApplied,
    fundReservedTotalUsd: guardState.fundReservedTotalUsd,
    fundReservedRemainingUsd: guardState.fundReservedRemainingUsd,
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
  fundReservedRemainingUsd?: number;
  breakerReason?: string;
}) {
  const nextActualRequests = (args.currentGuard.actualRequests || 0) + args.requestDelta;
  const nextActualTokenUsage = (args.currentGuard.actualTokenUsage || 0) + args.tokenUsed;
  const nextActualCost = roundUsd((args.currentGuard.actualCost || 0) + args.costUsd);
  const breakerReason =
    args.breakerReason ??
    (nextActualRequests > args.currentGuard.maxRequestsPerRun
      ? `Paid execution request limit exceeded: ${nextActualRequests}/${args.currentGuard.maxRequestsPerRun}`
      : nextActualCost > args.currentGuard.maxEstimatedCostUsdPerRun
        ? `Paid execution cost limit exceeded: $${nextActualCost}/$${args.currentGuard.maxEstimatedCostUsdPerRun}`
        : undefined);

  return {
    nextGuard: {
      ...args.currentGuard,
      actualRequests: nextActualRequests,
      actualTokenUsage: nextActualTokenUsage,
      actualCost: nextActualCost,
      ...(typeof args.fundReservedRemainingUsd === "number"
        ? {
            fundReservedRemainingUsd: roundUsd(Math.max(0, args.fundReservedRemainingUsd)),
          }
        : {}),
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

async function consumeReservedProjectFund(input: {
  authorization: string;
  projectId: string;
  taskId: string;
  sessionId?: string;
  modelRoute: string;
  currentGuard: PaidExecutionGuardState;
  amountUsd: number;
}) {
  const normalizedAmount = roundUsd(input.amountUsd);
  if (normalizedAmount <= 0) {
    return {
      ok: true as const,
      remainingUsd: input.currentGuard.fundReservedRemainingUsd ?? 0,
    };
  }

  const result = await consumeProjectFund(input.projectId, input.authorization, {
    amountUsd: normalizedAmount,
    modelRoute: input.modelRoute,
    taskId: input.taskId,
    runtimeSessionId: input.sessionId,
    note: "runtime settlement",
  });

  if (!result.ok) {
    const errorPayload = result.data as unknown as { error?: unknown };
    return {
      ok: false as const,
      error:
        typeof errorPayload?.error === "string"
          ? (errorPayload.error ?? "Failed to consume reserved project fund")
          : "Failed to consume reserved project fund",
    };
  }

  return {
    ok: true as const,
    remainingUsd: roundUsd((input.currentGuard.fundReservedRemainingUsd ?? 0) - normalizedAmount),
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
  let breakerReason: string | undefined;
  let fundReservedRemainingUsd = currentGuard.fundReservedRemainingUsd;

  if (usage.costUsd > 0) {
    const consumeResult = await consumeReservedProjectFund({
      authorization: input.authorization,
      projectId: input.projectId || task.projectId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      modelRoute: input.modelRoute,
      currentGuard,
      amountUsd: usage.costUsd,
    });

    if (!consumeResult.ok) {
      breakerReason = consumeResult.error;
    } else {
      fundReservedRemainingUsd = consumeResult.remainingUsd;
    }
  }

  const nextGuardState = computeNextPaidExecutionGuardState({
    currentGuard,
    requestDelta: input.requestDelta,
    tokenUsed: usage.totalTokens,
    costUsd: usage.costUsd,
    fundReservedRemainingUsd,
    breakerReason,
  });
  const { nextGuard } = nextGuardState;
  breakerReason = nextGuardState.breakerReason;

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

export async function releasePaidExecutionReservation(input: {
  authorization: string;
  taskId: string;
  reason: string;
  sessionId?: string;
  agentRunId?: string;
}) {
  const taskResult = await cpFetch<TaskGuardRecord>(
    `/api/project-tree/tasks/${encodeURIComponent(input.taskId)}`,
    {
      authorization: input.authorization,
    },
  );
  if (!taskResult.ok) {
    return { ok: false as const, releasedUsd: 0 };
  }

  const task = taskResult.data;
  const taskStrategy = parseTaskStrategy(task.strategy);
  const currentGuard = taskStrategy.paidExecutionGuard as PaidExecutionGuardState | undefined;
  const remainingUsd = roundUsd(currentGuard?.fundReservedRemainingUsd ?? 0);
  if (!currentGuard?.enabled || remainingUsd <= 0) {
    return { ok: true as const, releasedUsd: 0, guardState: currentGuard };
  }

  const refundResult = await refundProjectFund(task.projectId, input.authorization, {
    amountUsd: remainingUsd,
    modelRoute: currentGuard.modelRoute,
    taskId: input.taskId,
    runtimeSessionId: input.sessionId,
    note: input.reason,
  });
  if (!refundResult.ok) {
    return { ok: false as const, releasedUsd: 0, guardState: currentGuard };
  }

  const nextGuard: PaidExecutionGuardState = {
    ...currentGuard,
    fundReservedRemainingUsd: 0,
  };
  await persistPaidExecutionGuardState({
    authorization: input.authorization,
    taskId: input.taskId,
    strategy: task.strategy,
    nextGuard,
  });
  await recordAgentAudit({
    projectId: task.projectId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    agentRunId: input.agentRunId,
    eventType: "paid_execution",
    action: "reservation_released",
    detail: buildGuardDetail(nextGuard, {
      reason: input.reason,
      releasedUsd: remainingUsd,
    }),
    riskLevel: "low",
  });

  return {
    ok: true as const,
    releasedUsd: remainingUsd,
    guardState: nextGuard,
  };
}
