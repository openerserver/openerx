import { cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import { formatModelRoute, resolveModelRoute } from "../../lib/model-config";
import {
  type ExecutionCandidate,
  type ExecutionStep,
  type FollowupExecutionRecord,
  type FollowupTemplate,
  type JudgeResult,
  type RuntimePlan,
  mergeTaskStrategy,
  parseTaskStrategy,
  readOrchestrationStrategy,
  renderPromptTemplate,
} from "../../lib/orchestration-strategy";
import type { PaidExecutionGuardState } from "../../lib/paid-execution-guard";
import type { RealtimeEvent, RealtimeEventType } from "../../types/events";
import {
  findAgentRunBySessionId,
  updateAgentRunStatus,
} from "../agent-control/agent-run-registry";
import { noteContinueLatencyTaskDomainEvent } from "../agent-control/continue-latency-tracer";
import { extractAssistantResultFromMessages } from "../agent-control/runtime-message-utils";
import {
  createAgentRunRecord,
  patchAgentRunRecord,
  recordAgentAudit,
  recordModelUsage,
} from "../agent-control/run-persistence";
import {
  createSession,
  getSessionMessages,
  runDetachedPrompt,
  terminateAgent,
} from "../agent-control/runtime-provider";
import { collectChangesFromSession } from "../code-changes/change-collector";
import { executeLifecycleHooks } from "../hooks/lifecycle-hooks";
import {
  finalizeTaskState,
  shouldSuppressParallelAwaitingAdoptionFinalization,
} from "../tasks/finalize";
import {
  fetchTaskSessionLineageRecords,
  persistTaskSessionMessageSnapshot,
  toCanonicalTaskSessionId,
  upsertTaskSessionLineageRecord,
} from "../tasks/task-session-store";
import { observeGraphWorkspaceDir, onGraphToolExecuted } from "./dag-sync";
import { buildPipelineStageUpdatedEvents } from "./pipeline-events";

// Aggregates runtime events and transforms them into
// standard RealtimeEvent format for WebSocket broadcast.
// Pi-mono feeds events directly via ingestParsedEvent().

type EventHandler = (event: RealtimeEvent) => void;

interface CompletedTaskContext {
  id: string;
  title: string;
  prompt: string;
  projectId: string;
  status?: string | null;
  sessionId?: string | null;
  currentRunId?: string | null;
  orchestrationKind?: string | null;
  repoName?: string | null;
  remoteUrl?: string | null;
  workingBranch?: string | null;
  result?: string | null;
  strategy?: string | null;
  selectedModel?: string | null;
  finalCommitSha?: string | null;
  finalBranchName?: string | null;
  changesSummary?: {
    filesAdded?: number;
    filesModified?: number;
    filesDeleted?: number;
    totalInsertions?: number;
    totalDeletions?: number;
  } | null;
}

interface TaskPhaseLifecycleRecord {
  id?: string | null;
  phaseIndex?: number | null;
  phaseKind?: string | null;
  status?: string | null;
  awaitingAdoptionSince?: string | null;
  candidateCount?: number | null;
  judgeSessionId?: string | null;
}

interface FollowupDecisionSelection {
  execution: {
    hookId: string;
    agent: string;
    model?: string;
    result?: string;
    decision?: {
      action: string;
      reason?: string;
      followupTemplateId?: string;
      followupGoal?: string;
      targetAgent?: string;
      targetModel?: string;
    };
    completedAt: string;
  };
  templateId: string;
}

type ParallelCandidateSettlementCheck = {
  ready: boolean;
  totalCandidateCount: number;
};

function buildPaidExecutionGuardDetail(
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
    actualTokenUsage: guardState.actualTokenUsage,
    actualCost: guardState.actualCost,
    guardOverridesApplied: guardState.overridesApplied,
    ...detail,
  };
}

function normalizeParallelCandidateExecutionStatus(status: string | null | undefined) {
  const normalizedStatus = asString(status)?.trim().toLowerCase();
  if (!normalizedStatus) {
    return null;
  }
  if (normalizedStatus === "completed") {
    return "complete" as const;
  }
  if (normalizedStatus === "error") {
    return "failed" as const;
  }
  if (normalizedStatus === "stopped" || normalizedStatus === "terminated") {
    return "cancelled" as const;
  }
  return normalizedStatus;
}

function isTerminalParallelCandidateExecutionStatus(status: string | null | undefined) {
  const normalizedStatus = normalizeParallelCandidateExecutionStatus(status);
  return (
    normalizedStatus === "complete" ||
    normalizedStatus === "failed" ||
    normalizedStatus === "cancelled"
  );
}

function isTrackedParallelCandidateRecord(record: { phaseRole?: string | null; sessionKind?: string | null; candidateIndex?: number | null; }) {
  return (
    record.phaseRole === "candidate" ||
    record.sessionKind === "candidate" ||
    typeof record.candidateIndex === "number"
  );
}

function parseModelString(raw: string): { providerId: string; modelId: string } {
  return resolveModelRoute(raw);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function formatChangeSummary(task: CompletedTaskContext): string {
  const summary = task.changesSummary;
  if (!summary) {
    return "No code changes recorded.";
  }

  return [
    `Files added: ${summary.filesAdded || 0}`,
    `Files modified: ${summary.filesModified || 0}`,
    `Files deleted: ${summary.filesDeleted || 0}`,
    `Total insertions: ${summary.totalInsertions || 0}`,
    `Total deletions: ${summary.totalDeletions || 0}`,
    task.finalBranchName ? `Final branch: ${task.finalBranchName}` : undefined,
    task.finalCommitSha ? `Final commit: ${task.finalCommitSha}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

class SSEAggregator {
  private handlers = new Set<EventHandler>();
  private finalizingAgentRuns = new Set<string>();
  private finalizedAgentRuns = new Set<string>();

  // ── Parallel execution tracking ─────────────────────────────────
  // Maps taskId → sessionIds of all candidates
  private parallelTaskSessions = new Map<string, Set<string>>();
  // Maps taskId → active parallel phaseId for the current candidate batch
  private parallelTaskPhaseIds = new Map<string, string>();
  // Maps sessionId → { taskId, candidateIndex }
  private sessionToCandidateMap = new Map<string, { taskId: string; candidateIndex: number }>();
  // Maps taskId → completed candidate sessions with results
  private parallelCandidateResults = new Map<
    string,
    Map<number, { sessionId: string; result?: string }>
  >();
  private judgingTasks = new Set<string>();
  private paidExecutionRuntime = new Map<string, { tripped: boolean; reason?: string }>();

  // ── Sequential-chain execution tracking ─────────────────────────
  // Maps taskId → chain execution context
  private sequentialChainTasks = new Map<
    string,
    {
      plan: RuntimePlan;
      authorization: string;
      projectId?: string;
      projectionBacked?: boolean;
      operationId?: string;
    }
  >();
  // Maps sessionId → { taskId, stepIndex } for chain step sessions
  private sessionToChainStepMap = new Map<string, { taskId: string; stepIndex: number }>();

  // ── Persistent session → task cache ─────────────────────────────
  // Survives across SSE reconnections. Populated from agent runs,
  // candidate/chain maps, and DB lookups. Used as fallback when the
  // in-memory agentRunRegistry has no mapping (e.g. after BFF restart).
  private sessionToTaskCache = new Map<string, { taskId: string; projectId?: string }>();
  private pendingSessionLookups = new Map<
    string,
    Promise<{ taskId: string; projectId?: string } | null>
  >();

  private isPaidExecutionBreakerTripped(taskId: string): boolean {
    return this.paidExecutionRuntime.get(taskId)?.tripped === true;
  }

  private async updatePaidExecutionRuntimeAccounting(args: {
    taskId: string;
    authorization: string;
    usage: {
      providerId: string;
      modelId: string;
      totalTokens: number;
      costUsd: number;
    };
    requestDelta: number;
  }): Promise<{ guardState?: PaidExecutionGuardState; tripped: boolean; breakerReason?: string }> {
    const taskResult = await cpFetch<CompletedTaskContext>(
      `/api/project-tree/tasks/${encodeURIComponent(args.taskId)}`,
      { authorization: args.authorization },
    );
    if (!taskResult.ok) {
      return { tripped: false };
    }

    const task = taskResult.data;
    const taskStrategy = parseTaskStrategy(task.strategy);
    const currentGuard = taskStrategy.paidExecutionGuard as PaidExecutionGuardState | undefined;
    if (!currentGuard?.enabled) {
      return { tripped: false };
    }

    const nextActualRequests = (currentGuard.actualRequests || 0) + args.requestDelta;
    const nextActualTokenUsage = (currentGuard.actualTokenUsage || 0) + args.usage.totalTokens;
    const nextActualCost = Number(((currentGuard.actualCost || 0) + args.usage.costUsd).toFixed(2));
    const overRequestLimit =
      currentGuard.maxRequestsPerRun > 0 && nextActualRequests > currentGuard.maxRequestsPerRun;
    const overCostLimit =
      currentGuard.maxEstimatedCostUsdPerRun > 0 &&
      nextActualCost > currentGuard.maxEstimatedCostUsdPerRun;
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

    await cpFetch(`/api/tasks/${encodeURIComponent(args.taskId)}`, {
      method: "PATCH",
      authorization: args.authorization,
      body: {
        strategy: mergeTaskStrategy(task.strategy, {
          paidExecutionGuard: nextGuard,
        }),
      },
    });

    return {
      guardState: nextGuard,
      tripped: Boolean(breakerReason),
      breakerReason,
    };
  }

  private async recordPaidExecutionUsageEvent(args: {
    taskId: string;
    projectId?: string;
    sessionId?: string;
    agentRunId?: string;
    traceId?: string;
    authorization: string;
    providerId: string;
    modelId: string;
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
  }): Promise<{ guardState?: PaidExecutionGuardState; tripped: boolean; breakerReason?: string }> {
    if (args.tokenUsed <= 0) {
      return { tripped: false };
    }

    const usage = await recordModelUsage({
      projectId: args.projectId || "",
      taskId: args.taskId,
      sessionId: args.sessionId,
      agentRunId: args.agentRunId,
      providerId: args.providerId,
      modelId: args.modelId,
      tokenUsed: args.tokenUsed,
      runtimeLedger: args.runtimeLedger,
      audit: args.action
        ? {
            projectId: args.projectId,
            taskId: args.taskId,
            sessionId: args.sessionId,
            agentRunId: args.agentRunId,
          traceId: args.traceId,
            eventType: "paid_execution",
            action: args.action,
            detail: args.detail,
            riskLevel: args.riskLevel,
          }
        : undefined,
    });

    return this.updatePaidExecutionRuntimeAccounting({
      taskId: args.taskId,
      authorization: args.authorization,
      usage,
      requestDelta: args.requestDelta,
    });
  }

  private async tripPaidExecutionBreaker(args: {
    taskId: string;
    projectId?: string;
    completedSessionId?: string;
    authorization: string;
    guardState?: PaidExecutionGuardState;
    reason: string;
  }) {
    const alreadyTripped = this.isPaidExecutionBreakerTripped(args.taskId);
    this.paidExecutionRuntime.set(args.taskId, { tripped: true, reason: args.reason });
    if (alreadyTripped) {
      return;
    }

    await recordAgentAudit({
      projectId: args.projectId,
      taskId: args.taskId,
      sessionId: args.completedSessionId,
      eventType: "paid_execution",
      action: "breaker_tripped",
      detail: buildPaidExecutionGuardDetail(args.guardState, {
        breakerReason: args.reason,
      }),
      riskLevel: "high",
    });

    const taskSessions = this.parallelTaskSessions.get(args.taskId);
    if (!taskSessions) {
      return;
    }

    for (const sessionId of taskSessions) {
      if (sessionId === args.completedSessionId) {
        continue;
      }

      const run = findAgentRunBySessionId(sessionId);
      if (!run?.agentRunId || run.status !== "running") {
        continue;
      }

      await terminateAgent(run.agentRunId);
      updateAgentRunStatus(run.agentRunId, "stopped");
      await Promise.all([
        patchAgentRunRecord({
          taskId: args.taskId,
          agentRunId: run.agentRunId,
          status: "stopped",
          model: run.model,
          error: `Stopped by paid execution breaker: ${args.reason}`,
          finishedAt: new Date().toISOString(),
        }),
        recordAgentAudit({
          projectId: args.projectId,
          taskId: args.taskId,
          sessionId,
          agentRunId: run.agentRunId,
          eventType: "paid_execution",
          action: "candidate_terminated_by_breaker",
          detail: buildPaidExecutionGuardDetail(args.guardState, {
            breakerReason: args.reason,
          }),
          riskLevel: "high",
        }),
      ]);
    }
  }

  private async emitPipelineStageUpdates(args: {
    taskId: string;
    sessionId?: string;
    projectId?: string;
    agentRunId?: string;
    authorization: string;
    reason:
      | "task.continued"
      | "task.completed"
      | "task.phase.awaiting_adoption"
      | "task.failed"
      | "task.hooks.updated"
      | "task.followup.started"
      | "task.followup.completed"
      | "task.followup.failed"
      | "task.node.updated"
      | "agent.completed";
  }): Promise<void> {
    const events = await buildPipelineStageUpdatedEvents(args);
    for (const event of events) {
      this.emit(event);
    }
  }

  /** Register parallel candidates for aggregated tracking. */
  registerParallelTask(taskId: string, candidates: ExecutionCandidate[], phaseId?: string): void {
    const sessionIds = new Set<string>();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c?.sessionId) {
        sessionIds.add(c.sessionId);
        this.sessionToCandidateMap.set(c.sessionId, { taskId, candidateIndex: i });
      }
    }
    this.parallelTaskSessions.set(taskId, sessionIds);
    if (phaseId) {
      this.parallelTaskPhaseIds.set(taskId, phaseId);
    }
    this.parallelCandidateResults.set(taskId, new Map());
  }

  private isTrackedParallelTask(taskId: string): boolean {
    return (
      this.parallelTaskSessions.has(taskId) ||
      this.parallelTaskPhaseIds.has(taskId) ||
      this.parallelCandidateResults.has(taskId)
    );
  }

  private async recoverParallelTaskTracking(
    taskId: string,
    authorization: string,
  ): Promise<void> {
    const lineageResult = await fetchTaskSessionLineageRecords(taskId, authorization);
    if (!lineageResult.ok) {
      return;
    }

    const mergedSessionIds = new Set(this.parallelTaskSessions.get(taskId) ?? []);
    let recoveredPhaseId: string | undefined;

    for (const record of lineageResult.records) {
      const runtimeSessionId = asString(record.runtimeSessionId);
      if (!runtimeSessionId) {
        continue;
      }

      const candidateIndex =
        typeof record.candidateIndex === "number"
          ? record.candidateIndex
          : typeof record.phaseItemIndex === "number" && record.phaseRole === "candidate"
            ? record.phaseItemIndex
            : undefined;
      const isParallelCandidate =
        typeof candidateIndex === "number" ||
        record.phaseRole === "candidate" ||
        record.sessionKind === "candidate";

      if (!isParallelCandidate) {
        continue;
      }

      mergedSessionIds.add(runtimeSessionId);
      if (typeof candidateIndex === "number") {
        this.sessionToCandidateMap.set(runtimeSessionId, { taskId, candidateIndex });
      }

      const phaseId = asString(record.phaseId);
      if (phaseId && !recoveredPhaseId) {
        recoveredPhaseId = phaseId;
      }
    }

    if (mergedSessionIds.size > 0) {
      this.parallelTaskSessions.set(taskId, mergedSessionIds);
      if (!this.parallelCandidateResults.has(taskId)) {
        this.parallelCandidateResults.set(taskId, new Map());
      }
    }

    if (recoveredPhaseId) {
      this.parallelTaskPhaseIds.set(taskId, recoveredPhaseId);
    }
  }

  private async resolveParallelCandidateInfo(args: {
    taskId: string;
    sessionId: string;
    authorization: string;
    candidateIndexHint?: number;
  }): Promise<{ taskId: string; candidateIndex: number } | null> {
    const existing = this.sessionToCandidateMap.get(args.sessionId);
    if (existing) {
      return existing;
    }

    const trackedSessions = this.parallelTaskSessions.get(args.taskId);
    if (trackedSessions?.has(args.sessionId) && typeof args.candidateIndexHint === "number") {
      const recovered = { taskId: args.taskId, candidateIndex: args.candidateIndexHint };
      this.sessionToCandidateMap.set(args.sessionId, recovered);
      if (!this.parallelCandidateResults.has(args.taskId)) {
        this.parallelCandidateResults.set(args.taskId, new Map());
      }
      return recovered;
    }

    await this.recoverParallelTaskTracking(args.taskId, args.authorization);

    const recovered = this.sessionToCandidateMap.get(args.sessionId);
    if (recovered) {
      return recovered;
    }

    if (
      typeof args.candidateIndexHint === "number" &&
      this.parallelTaskSessions.get(args.taskId)?.has(args.sessionId)
    ) {
      const hinted = { taskId: args.taskId, candidateIndex: args.candidateIndexHint };
      this.sessionToCandidateMap.set(args.sessionId, hinted);
      return hinted;
    }

    return null;
  }

  private async resolveParallelTaskPhaseId(
    taskId: string,
    authorization: string,
  ): Promise<string | null> {
    const cachedPhaseId = this.parallelTaskPhaseIds.get(taskId);
    if (cachedPhaseId) {
      return cachedPhaseId;
    }

    const phasesResult = await cpFetch<{ data?: TaskPhaseLifecycleRecord[] }>(
      `/api/tasks/${encodeURIComponent(taskId)}/phases`,
      { authorization },
    );
    const phases = Array.isArray(phasesResult.data?.data) ? phasesResult.data.data : [];
    const activeParallelPhase = phases
      .filter(
        (phase) =>
          phase.phaseKind === "parallel" &&
          phase.status !== "completed" &&
          phase.status !== "failed" &&
          phase.status !== "cancelled",
      )
      .sort((left, right) => (left.phaseIndex ?? 0) - (right.phaseIndex ?? 0))
      .at(-1);

    if (!activeParallelPhase?.id) {
      return null;
    }

    this.parallelTaskPhaseIds.set(taskId, activeParallelPhase.id);
    return activeParallelPhase.id;
  }

  private async hasCompletedParallelCandidateMessage(args: {
    taskId: string;
    sessionId: string;
    authorization: string;
  }) {
    const messagesResult = await getSessionMessages(args.sessionId, {
      taskId: args.taskId,
      authorization: args.authorization,
      includeLineage: false,
      bypassCircuitBreaker: true,
    });
    if (!messagesResult.ok || !Array.isArray(messagesResult.data)) {
      return false;
    }

    const assistantResult = extractAssistantResultFromMessages(messagesResult.data);
    return assistantResult.completed;
  }

  private isActiveTrackedParallelRun(run: unknown) {
    if (!run || typeof run !== "object") {
      return false;
    }

    const status = normalizeParallelCandidateExecutionStatus(
      asString((run as Record<string, unknown>).status),
    );
    if (status !== "running" && status !== "queued" && status !== "pending" && status !== "paused") {
      return false;
    }

    const agentRunId = asString((run as Record<string, unknown>).agentRunId);
    return !(agentRunId && this.finalizedAgentRuns.has(agentRunId));
  }

  private async confirmParallelCandidatesSettled(args: {
    taskId: string;
    authorization: string;
    candidateResults: Array<[number, { sessionId: string; result?: string }]>;
  }): Promise<ParallelCandidateSettlementCheck> {
    await this.recoverParallelTaskTracking(args.taskId, args.authorization);

    const trackedSessions = new Set(this.parallelTaskSessions.get(args.taskId) ?? []);
    const trackedPhaseId = this.parallelTaskPhaseIds.get(args.taskId) ?? null;
    const lineageResult = await fetchTaskSessionLineageRecords(args.taskId, args.authorization);
    if (!lineageResult.ok) {
      return {
        ready: false,
        totalCandidateCount: Math.max(trackedSessions.size, args.candidateResults.length),
      };
    }

    const candidateRecords = lineageResult.activeRecords.filter((record) => {
      if (!isTrackedParallelCandidateRecord(record)) {
        return false;
      }
      if (trackedPhaseId) {
        return record.phaseId === trackedPhaseId;
      }
      return trackedSessions.has(record.runtimeSessionId);
    });

    const totalCandidateCount = Math.max(
      trackedSessions.size,
      args.candidateResults.length,
      candidateRecords.length,
    );

    if (
      totalCandidateCount === 0 ||
      candidateRecords.length < totalCandidateCount ||
      args.candidateResults.length < totalCandidateCount
    ) {
      return { ready: false, totalCandidateCount };
    }

    for (const candidate of candidateRecords) {
      const liveRun = findAgentRunBySessionId(candidate.runtimeSessionId);
      if (this.isActiveTrackedParallelRun(liveRun)) {
        return { ready: false, totalCandidateCount };
      }

      if (isTerminalParallelCandidateExecutionStatus(candidate.executionStatus)) {
        continue;
      }

      const hasCompletedMessage = await this.hasCompletedParallelCandidateMessage({
        taskId: args.taskId,
        sessionId: candidate.runtimeSessionId,
        authorization: args.authorization,
      });
      if (!hasCompletedMessage) {
        return { ready: false, totalCandidateCount };
      }
    }

    return { ready: true, totalCandidateCount };
  }

  private async deactivateSettledParallelCandidateSessions(args: {
    taskId: string;
    authorization: string;
    phaseId?: string | null;
    trackedSessionIds?: Iterable<string>;
  }): Promise<void> {
    const trackedSessionIds = new Set(args.trackedSessionIds ?? []);
    if (!args.phaseId && trackedSessionIds.size === 0) {
      return;
    }

    const lineageResult = await fetchTaskSessionLineageRecords(args.taskId, args.authorization);
    if (!lineageResult.ok) {
      return;
    }

    const candidateRecords = lineageResult.records.filter((record) => {
      if (record.archivedAt || !record.runtimeSessionId || !isTrackedParallelCandidateRecord(record)) {
        return false;
      }
      if (args.phaseId) {
        return record.phaseId === args.phaseId;
      }
      return trackedSessionIds.has(record.runtimeSessionId);
    });

    if (candidateRecords.length === 0) {
      return;
    }

    await Promise.allSettled(
      candidateRecords.map((record) =>
        upsertTaskSessionLineageRecord(args.taskId, args.authorization, {
          runtimeSessionId: record.runtimeSessionId,
          isActive: false,
        }),
      ),
    );
  }

  /** Register a sequential-chain task for step-by-step tracking. */
  registerSequentialChainTask(
    taskId: string,
    sessionId: string,
    plan: RuntimePlan,
    authorization: string,
    options?: { projectionBacked?: boolean; operationId?: string },
  ): void {
    this.sequentialChainTasks.set(taskId, {
      plan,
      authorization,
      projectionBacked: options?.projectionBacked === true,
      operationId: options?.operationId,
    });
    const stepIndex = plan.currentChainStepIndex ?? 0;
    this.sessionToChainStepMap.set(sessionId, { taskId, stepIndex });
  }

  private async triggerPostExecutionHooks(
    taskId: string,
    resultText: string | undefined,
    authorization: string,
  ): Promise<void> {
    const strategyConfig = readOrchestrationStrategy();

    const taskResult = await cpFetch<CompletedTaskContext>(
      `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
      {
        authorization,
      },
    );
    if (!taskResult.ok) {
      return;
    }

    const task = taskResult.data;
    const taskStrategy = parseTaskStrategy(task.strategy);
    const paidExecutionGuard = taskStrategy.paidExecutionGuard as
      | PaidExecutionGuardState
      | undefined;
    if (paidExecutionGuard?.postHooksDisabled || this.isPaidExecutionBreakerTripped(taskId)) {
      await recordAgentAudit({
        projectId: task.projectId,
        taskId: task.id,
        sessionId: task.sessionId ?? undefined,
        eventType: "paid_execution",
        action: "post_hooks_skipped",
        detail: buildPaidExecutionGuardDetail(paidExecutionGuard, {
          reason: this.isPaidExecutionBreakerTripped(taskId)
            ? this.paidExecutionRuntime.get(taskId)?.reason || "paid execution breaker tripped"
            : "post-execution hooks disabled by paid execution guard",
        }),
        riskLevel: "medium",
      });
      return;
    }

    const hookResult = await executeLifecycleHooks({
      strategy: strategyConfig,
      trigger: "post-execution",
      taskId: task.id,
      projectId: task.projectId,
      taskTitle: task.title,
      taskPrompt: task.prompt,
      titlePrefix: "Post-review",
      context: {
        taskId: task.id,
        projectId: task.projectId,
        taskTitle: task.title,
        taskPrompt: task.prompt,
        taskResult: task.result || resultText || "",
        repoName: task.repoName,
        remoteUrl: task.remoteUrl,
        workingBranch: task.workingBranch,
        selectedAgent:
          typeof taskStrategy.selectedAgent === "string" ? taskStrategy.selectedAgent : "",
        selectedModel:
          typeof taskStrategy.effectiveModel === "string"
            ? taskStrategy.effectiveModel
            : task.selectedModel || "",
        changesSummary: formatChangeSummary(task),
      },
      onHookExecuted: async (execution) => {
        const modelRoute =
          execution.model ||
          (typeof taskStrategy.effectiveModel === "string"
            ? taskStrategy.effectiveModel
            : undefined) ||
          task.selectedModel ||
          paidExecutionGuard?.modelRoute;
        if (
          !execution.sessionId ||
          !modelRoute ||
          !execution.tokenUsed ||
          execution.tokenUsed <= 0
        ) {
          return;
        }

        const resolvedModel = parseModelString(modelRoute);
        const guardOutcome = await this.recordPaidExecutionUsageEvent({
          taskId: task.id,
          projectId: task.projectId,
          sessionId: execution.sessionId,
          authorization,
          providerId: resolvedModel.providerId,
          modelId: resolvedModel.modelId,
          tokenUsed: execution.tokenUsed,
          requestDelta: 1,
          action: "hook_usage_recorded",
          runtimeLedger: {
            executionSource: `task-${execution.trigger}-hook`,
            entrypointType: "hook-only",
            hookRequestCountDelta: 1,
            status: execution.status === "failed" ? "failed" : "completed",
            finishedAt: execution.completedAt,
            step: {
              stepType: "hook",
              triggerType: execution.trigger,
              hookId: execution.hookId,
              amplificationSource: "hook",
              status:
                execution.status === "failed"
                  ? "failed"
                  : execution.status === "skipped"
                    ? "skipped"
                    : "completed",
              finishedAt: execution.completedAt,
            },
          },
          detail: buildPaidExecutionGuardDetail(paidExecutionGuard, {
            hookId: execution.hookId,
            trigger: execution.trigger,
            hookStatus: execution.status,
            agent: execution.agent,
          }),
          riskLevel: "medium",
        });

        if (guardOutcome.tripped) {
          await this.tripPaidExecutionBreaker({
            taskId: task.id,
            projectId: task.projectId,
            completedSessionId: execution.sessionId,
            authorization,
            guardState: guardOutcome.guardState,
            reason: guardOutcome.breakerReason || "paid execution breaker tripped",
          });

          return {
            stop: true,
            reason:
              guardOutcome.breakerReason ||
              "Stopped remaining hooks after the paid execution breaker tripped.",
          };
        }

        return;
      },
    });
    if (hookResult.hookExecutions.length === 0) {
      return;
    }

    const firstHook = hookResult.hookExecutions[0];
    if (!firstHook) {
      return;
    }

    const patchResult = await cpFetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      authorization,
      body: {
        strategy: mergeTaskStrategy(task.strategy, {
          hookExecutions: hookResult.hookExecutions,
        }),
      },
    });

    if (!patchResult.ok) {
      return;
    }

    this.emit({
      id: crypto.randomUUID(),
      type: "task.hooks.updated",
      ts: new Date().toISOString(),
      taskId: task.id,
      projectId: task.projectId,
      data: {
        phase: "postExecution",
        status: firstHook.status,
        agent: firstHook.agent,
        sessionId: firstHook.sessionId,
      },
    });

    await this.emitPipelineStageUpdates({
      taskId: task.id,
      sessionId: task.sessionId ?? undefined,
      projectId: task.projectId,
      authorization,
      reason: "task.hooks.updated",
    });

    const followupDecision = this.pickFollowupDecision(hookResult.hookExecutions);
    if (!followupDecision) {
      return;
    }

    const followupTemplate = this.resolveFollowupTemplate(
      strategyConfig.followups,
      followupDecision,
    );
    if (!followupTemplate) {
      const missingFollowupExecution: FollowupExecutionRecord = {
        templateId: followupDecision.templateId,
        triggerHookId: followupDecision.execution.hookId,
        status: "skipped",
        failureType: "template-missing",
        agent: followupDecision.execution.decision?.targetAgent || "未配置模板",
        model: followupDecision.execution.decision?.targetModel,
        prompt: "",
        error: `找不到已启用的 continue 模板: ${followupDecision.templateId}`,
        completedAt: new Date().toISOString(),
      };

      await cpFetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        authorization,
        body: {
          strategy: mergeTaskStrategy(task.strategy, {
            followupExecutions: [missingFollowupExecution],
          }),
        },
      });

      await recordAgentAudit({
        projectId: task.projectId,
        taskId: task.id,
        sessionId: task.sessionId ?? undefined,
        eventType: "followup",
        action: "followup_template_missing",
        detail: {
          triggerHookId: followupDecision.execution.hookId,
          templateId: followupDecision.templateId,
        },
        riskLevel: "medium",
      });

      this.emit({
        id: crypto.randomUUID(),
        type: "task.followup.failed",
        ts: missingFollowupExecution.completedAt,
        taskId: task.id,
        projectId: task.projectId,
        data: {
          triggerHookId: missingFollowupExecution.triggerHookId,
          templateId: missingFollowupExecution.templateId,
          status: missingFollowupExecution.status,
          failureType: missingFollowupExecution.failureType,
          error: missingFollowupExecution.error,
          agent: missingFollowupExecution.agent,
        },
      });

      await this.emitPipelineStageUpdates({
        taskId: task.id,
        sessionId: task.sessionId ?? undefined,
        projectId: task.projectId,
        authorization,
        reason: "task.followup.failed",
      });
      return;
    }

    this.emit({
      id: crypto.randomUUID(),
      type: "task.followup.started",
      ts: new Date().toISOString(),
      taskId: task.id,
      projectId: task.projectId,
      data: {
        triggerHookId: followupDecision.execution.hookId,
        templateId: followupTemplate.id,
        agent: followupTemplate.agent,
      },
    });

    await this.emitPipelineStageUpdates({
      taskId: task.id,
      sessionId: task.sessionId ?? undefined,
      projectId: task.projectId,
      authorization,
      reason: "task.followup.started",
    });

    const followupExecution = await this.runPostExecutionFollowup({
      task,
      resultText,
      strategy: taskStrategy,
      decisionSelection: followupDecision,
      template: followupTemplate,
    });

    const followupPatchResult = await cpFetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      authorization,
      body: {
        strategy: mergeTaskStrategy(task.strategy, {
          followupExecutions: [followupExecution],
        }),
      },
    });

    if (!followupPatchResult.ok) {
      return;
    }

    const followupModelRoute =
      followupExecution.model ||
      followupDecision.execution.decision?.targetModel ||
      paidExecutionGuard?.modelRoute;
    if (
      followupExecution.sessionId &&
      followupModelRoute &&
      followupExecution.tokenUsed &&
      followupExecution.tokenUsed > 0
    ) {
      const resolvedModel = parseModelString(followupModelRoute);
      const guardOutcome = await this.recordPaidExecutionUsageEvent({
        taskId: task.id,
        projectId: task.projectId,
        sessionId: followupExecution.sessionId,
        authorization,
        providerId: resolvedModel.providerId,
        modelId: resolvedModel.modelId,
        tokenUsed: followupExecution.tokenUsed,
        requestDelta: 1,
        action: "followup_usage_recorded",
        runtimeLedger: {
          executionSource: "post-hook-followup",
          entrypointType: "followup-only",
          status: followupExecution.status === "failed" ? "failed" : "completed",
          finishedAt: followupExecution.completedAt,
          step: {
            stepType: "other",
            amplificationSource: "hook",
            hookId: followupExecution.triggerHookId,
            status: followupExecution.status === "failed" ? "failed" : "completed",
            finishedAt: followupExecution.completedAt,
          },
        },
        detail: buildPaidExecutionGuardDetail(paidExecutionGuard, {
          templateId: followupExecution.templateId,
          triggerHookId: followupExecution.triggerHookId,
          followupStatus: followupExecution.status,
          agent: followupExecution.agent,
        }),
        riskLevel: "medium",
      });

      if (guardOutcome.tripped) {
        await this.tripPaidExecutionBreaker({
          taskId: task.id,
          projectId: task.projectId,
          completedSessionId: followupExecution.sessionId,
          authorization,
          guardState: guardOutcome.guardState,
          reason: guardOutcome.breakerReason || "paid execution breaker tripped",
        });
      }
    }

    await recordAgentAudit({
      projectId: task.projectId,
      taskId: task.id,
      sessionId: followupExecution.sessionId,
      eventType: "followup",
      action: followupExecution.status === "failed" ? "followup_failed" : "followup_completed",
      detail: {
        triggerHookId: followupExecution.triggerHookId,
        templateId: followupExecution.templateId,
        agent: followupExecution.agent,
      },
      riskLevel: followupExecution.status === "failed" ? "medium" : "low",
    });

    this.emit({
      id: crypto.randomUUID(),
      type:
        followupExecution.status === "failed" ? "task.followup.failed" : "task.followup.completed",
      ts: new Date().toISOString(),
      taskId: task.id,
      projectId: task.projectId,
      sessionId: followupExecution.sessionId,
      data: {
        triggerHookId: followupExecution.triggerHookId,
        templateId: followupExecution.templateId,
        status: followupExecution.status,
        failureType: followupExecution.failureType,
        error: followupExecution.error,
        agent: followupExecution.agent,
      },
    });

    await this.emitPipelineStageUpdates({
      taskId: task.id,
      sessionId: task.sessionId ?? undefined,
      projectId: task.projectId,
      authorization,
      reason:
        followupExecution.status === "failed" ? "task.followup.failed" : "task.followup.completed",
    });
  }

  private pickFollowupDecision(
    hookExecutions: Array<{
      hookId: string;
      agent: string;
      model?: string;
      result?: string;
      decision?: {
        action: string;
        reason?: string;
        followupTemplateId?: string;
        followupGoal?: string;
        targetAgent?: string;
        targetModel?: string;
      };
      completedAt: string;
    }>,
  ): FollowupDecisionSelection | undefined {
    const execution = [...hookExecutions]
      .reverse()
      .find(
        (item) =>
          item.decision?.action === "spawn-followup" &&
          typeof item.decision.followupTemplateId === "string" &&
          item.decision.followupTemplateId.length > 0,
      );
    if (!execution?.decision?.followupTemplateId) {
      return undefined;
    }

    return {
      execution,
      templateId: execution.decision.followupTemplateId,
    };
  }

  private resolveFollowupTemplate(
    templates: FollowupTemplate[] | undefined,
    decision: FollowupDecisionSelection,
  ): FollowupTemplate | undefined {
    return templates?.find((item) => item.enabled && item.id === decision.templateId);
  }

  private async runPostExecutionFollowup(args: {
    task: CompletedTaskContext;
    resultText: string | undefined;
    strategy: ReturnType<typeof parseTaskStrategy>;
    decisionSelection: FollowupDecisionSelection;
    template: FollowupTemplate;
  }): Promise<FollowupExecutionRecord> {
    const prompt = renderPromptTemplate(args.template.promptTemplate, {
      taskId: args.task.id,
      projectId: args.task.projectId,
      taskTitle: args.task.title,
      taskPrompt: args.task.prompt,
      taskResult: args.task.result || args.resultText || "",
      hookResult: args.decisionSelection.execution.result || "",
      hookReason: args.decisionSelection.execution.decision?.reason || "",
      hookAgent: args.decisionSelection.execution.agent,
      followupGoal: args.decisionSelection.execution.decision?.followupGoal || "",
      continueGoal: args.decisionSelection.execution.decision?.followupGoal || "",
      repoName: args.task.repoName,
      remoteUrl: args.task.remoteUrl,
      workingBranch: args.task.workingBranch,
      changesSummary: formatChangeSummary(args.task),
      selectedAgent:
        typeof args.strategy.selectedAgent === "string" ? args.strategy.selectedAgent : "",
      selectedModel:
        typeof args.strategy.effectiveModel === "string"
          ? args.strategy.effectiveModel
          : args.task.selectedModel || "",
    });

    const followupModel =
      args.decisionSelection.execution.decision?.targetModel || args.template.model;
    const result = await runDetachedPrompt(
      `[Continue ${args.task.id.slice(0, 8)}] ${args.task.title}`,
      prompt,
      {
        agent: args.decisionSelection.execution.decision?.targetAgent || args.template.agent,
        model: followupModel ? parseModelString(followupModel) : undefined,
        taskId: args.task.id,
        projectId: args.task.projectId,
        timeoutMs: args.template.timeoutMs,
      },
    );

    return {
      templateId: args.template.id,
      triggerHookId: args.decisionSelection.execution.hookId,
      status: result.ok && result.completed ? "completed" : "failed",
      failureType: result.ok && result.completed ? undefined : "runtime-error",
      agent: args.decisionSelection.execution.decision?.targetAgent || args.template.agent,
      model: result.model ? formatModelRoute(result.model) : followupModel,
      prompt,
      result: result.text,
      error: result.ok ? (result.completed ? undefined : "Continue timed out") : result.error,
      sessionId: result.sessionId,
      tokenUsed: result.tokenUsed,
      completedAt: new Date().toISOString(),
    };
  }

  private readWorkspaceDirectory(parsed: Record<string, unknown>): string | undefined {
    return typeof parsed.directory === "string" && parsed.directory.trim()
      ? parsed.directory.trim()
      : undefined;
  }

  private isGraphMutationTool(
    type: string,
    data: Record<string, unknown> | null,
  ): { toolName: string; sessionId?: string } | null {
    if (type !== "tool.execute.after" || !data) {
      return null;
    }

    const properties =
      typeof data.properties === "object" && data.properties
        ? (data.properties as Record<string, unknown>)
        : undefined;
    const toolNameCandidates = [properties?.toolName, data.toolName, data.tool, data.name];
    const toolName = toolNameCandidates.find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );

    if (!toolName || !toolName.startsWith("task_graph_")) {
      return null;
    }

    const sessionId =
      (typeof data.sessionId === "string" && data.sessionId) ||
      (typeof data.sessionID === "string" && data.sessionID) ||
      undefined;

    return { toolName, sessionId };
  }

  private async persistSessionMessageSnapshot(event: RealtimeEvent): Promise<void> {
    if (event.type !== "message.updated" || !event.sessionId) {
      return;
    }

    // Resolve taskId: prefer event-level, then try DB-backed fallback
    let taskId = event.taskId;
    if (!taskId) {
      const resolved = await this.resolveTaskForSession(event.sessionId);
      if (!resolved) return;
      taskId = resolved.taskId;
    }

    const rawType = typeof event.data.rawType === "string" ? event.data.rawType : undefined;
    const part =
      typeof event.data.part === "object" && event.data.part
        ? (event.data.part as Record<string, unknown>)
        : undefined;
    const partType = typeof part?.type === "string" ? part.type : undefined;
    const partState =
      part && typeof part.state === "object" && part.state
        ? (part.state as Record<string, unknown>)
        : undefined;
    const partStatus = typeof partState?.status === "string" ? partState.status : undefined;

    if (rawType === "message.part.updated") {
      if (partType === "tool") {
        const terminal =
          partStatus === "completed" ||
          partStatus === "failed" ||
          partStatus === "error" ||
          partStatus === "cancelled";
        if (!terminal) {
          return;
        }
      } else if (partType !== "text") {
        return;
      }
    }

    const message = await this.resolvePersistableMessageSnapshot(event);
    if (!message) {
      return;
    }

    // For user messages: rewrite ID to match the explicit write's deterministic
    // ID so the DB upsert merges into the same row. Also inject the runtime's
    // full text as promptDecomposition.finalSentText so the tree API can expose
    // user-input vs system-context vs final-sent separately.
    const messageRole = this.extractMessageRole(message);
    if (messageRole === "user" && event.sessionId) {
      const runtimeText = this.extractMessageText(message);
      const info =
        typeof message.info === "object" && message.info
          ? (message.info as Record<string, unknown>)
          : null;
      if (info) {
        info.id = `${event.sessionId}:user-prompt`;
      }
      if (runtimeText) {
        const existing =
          typeof message.promptDecomposition === "object" && message.promptDecomposition
            ? (message.promptDecomposition as Record<string, unknown>)
            : {};
        message.promptDecomposition = {
          ...existing,
          finalSentText: runtimeText,
        };
      }
    }

    const authorization = await createInternalAuthorization();
    const persistResult = await persistTaskSessionMessageSnapshot(taskId, authorization, {
      runtimeSessionId: event.sessionId,
      message,
    });
    this.emitTaskPersistenceAck({
      ts: event.ts,
      taskId,
      projectId: event.projectId,
      phaseId: asString(event.data.phaseId) ?? event.phaseId,
      runtimeSessionId: event.sessionId,
      agentRunId: event.agentRunId,
      persistedMessageId: persistResult.data?.messageId,
      persistedSessionId: persistResult.data?.sessionId,
      seq: persistResult.data?.seq,
    });
  }

  private emitTaskPersistenceAck(args: {
    ts: string;
    taskId: string;
    projectId?: string;
    phaseId?: string;
    runtimeSessionId: string;
    agentRunId?: string;
    persistedMessageId?: string;
    persistedSessionId?: string;
    seq?: number;
  }) {
    if (!args.persistedMessageId || typeof args.seq !== "number") {
      return;
    }

    const roundId =
      toCanonicalTaskSessionId(args.taskId, args.runtimeSessionId) ??
      args.persistedSessionId ??
      args.runtimeSessionId;

    this.emit({
      id: crypto.randomUUID(),
      type: "task.message.persisted",
      ts: args.ts,
      projectId: args.projectId,
      taskId: args.taskId,
      phaseId: args.phaseId,
      sessionId: args.runtimeSessionId,
      agentRunId: args.agentRunId,
      data: {
        roundId,
        taskSessionId: args.persistedSessionId ?? roundId,
        messageId: args.persistedMessageId,
        persistedRevision: args.seq,
        snapshotVersion: args.seq,
        persistedThroughRevision: args.seq,
      },
    });

    this.emit({
      id: crypto.randomUUID(),
      type: "task.round.synced",
      ts: args.ts,
      projectId: args.projectId,
      taskId: args.taskId,
      phaseId: args.phaseId,
      sessionId: args.runtimeSessionId,
      agentRunId: args.agentRunId,
      data: {
        roundId,
        taskSessionId: args.persistedSessionId ?? roundId,
        messageId: args.persistedMessageId,
        snapshotVersion: args.seq,
        persistedThroughRevision: args.seq,
      },
    });
  }

  private extractMessageRole(message: Record<string, unknown>): string | null {
    const info =
      typeof message.info === "object" && message.info
        ? (message.info as Record<string, unknown>)
        : null;
    const role =
      typeof message.role === "string"
        ? message.role
        : typeof info?.role === "string"
          ? info.role
          : null;
    return role;
  }

  private extractMessageText(message: Record<string, unknown>): string | null {
    if (typeof message.textContent === "string" && message.textContent) {
      return message.textContent;
    }
    if (typeof message.text === "string" && message.text) {
      return message.text;
    }
    if (typeof message.content === "string" && message.content) {
      return message.content;
    }
    if (Array.isArray(message.parts)) {
      for (const part of message.parts) {
        if (
          part &&
          typeof part === "object" &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          return (part as Record<string, unknown>).text as string;
        }
      }
    }
    return null;
  }

  private extractToolIdentity(data: Record<string, unknown>): string | undefined {
    const properties =
      typeof data.properties === "object" && data.properties
        ? (data.properties as Record<string, unknown>)
        : undefined;
    const candidates = [
      data.callID,
      data.callId,
      data.toolCallId,
      data.id,
      properties?.callID,
      properties?.callId,
      properties?.toolCallId,
      properties?.id,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    return undefined;
  }

  private normalizePersistableToolIdentity(sessionId: string, toolIdentity: string): string {
    let normalized = toolIdentity.trim();
    const sessionToolPrefix = `${sessionId}:tool:`;
    if (normalized.startsWith(sessionToolPrefix)) {
      normalized = normalized.slice(sessionToolPrefix.length);
    }
    if (normalized.startsWith("tool:")) {
      normalized = normalized.slice("tool:".length);
    }
    const sessionPrefix = `${sessionId}:`;
    if (normalized.startsWith(sessionPrefix)) {
      normalized = normalized.slice(sessionPrefix.length);
    }
    if (normalized.startsWith("tool:")) {
      normalized = normalized.slice("tool:".length);
    }
    return normalized;
  }

  private buildPersistableToolMessageId(sessionId: string, toolIdentity: string) {
    const normalizedToolIdentity = this.normalizePersistableToolIdentity(
      sessionId,
      toolIdentity,
    );
    return {
      toolCallId: normalizedToolIdentity,
      messageId: `${sessionId}:tool:${normalizedToolIdentity}`,
    };
  }

  private buildPersistableToolMessageSnapshot(
    event: RealtimeEvent,
  ): Record<string, unknown> | null {
    if (
      (event.type !== "tool.execute.before" && event.type !== "tool.execute.after") ||
      !event.sessionId
    ) {
      return null;
    }

    const properties =
      typeof event.data.properties === "object" && event.data.properties
        ? (event.data.properties as Record<string, unknown>)
        : undefined;
    const toolName =
      this.readToolName(event.data) ||
      (typeof properties?.toolName === "string" ? properties.toolName : undefined);
    if (!toolName) {
      return null;
    }

    const rawToolIdentity = this.extractToolIdentity(event.data) || toolName;
    const { toolCallId, messageId } = this.buildPersistableToolMessageId(
      event.sessionId,
      rawToolIdentity,
    );
    const resultText =
      typeof properties?.result === "string"
        ? properties.result
        : typeof event.data.result === "string"
          ? event.data.result
          : undefined;
    const errorText =
      typeof properties?.error === "string"
        ? properties.error
        : typeof event.data.error === "string"
          ? event.data.error
          : undefined;
    const inputValue =
      properties?.input ?? event.data.input ?? properties?.arguments ?? event.data.arguments;
    const status =
      event.type === "tool.execute.before" ? "running" : errorText ? "error" : "completed";

    return {
      id: messageId,
      role: "tool",
      info: {
        id: messageId,
        role: "tool",
        sessionID: event.sessionId,
        time: {
          created: event.ts,
          ...(event.type === "tool.execute.after" ? { completed: event.ts } : {}),
        },
      },
      part: {
        id: `tool-part:${toolCallId}`,
        type: "tool",
        tool: toolName,
        toolName,
        callID: toolCallId,
        sessionID: event.sessionId,
        messageID: messageId,
        ...(inputValue !== undefined ? { input: inputValue } : {}),
        state: {
          status,
          ...(resultText !== undefined ? { output: resultText } : {}),
          ...(errorText !== undefined ? { error: errorText } : {}),
        },
      },
    };
  }

  private async persistToolExecutionSnapshot(event: RealtimeEvent): Promise<void> {
    if (
      (event.type !== "tool.execute.before" && event.type !== "tool.execute.after") ||
      !event.sessionId
    ) {
      return;
    }

    let taskId = event.taskId;
    if (!taskId) {
      const resolved = await this.resolveTaskForSession(event.sessionId);
      if (!resolved) {
        return;
      }
      taskId = resolved.taskId;
    }

    const message = this.buildPersistableToolMessageSnapshot(event);
    if (!message) {
      return;
    }

    const authorization = await createInternalAuthorization();
    const persistResult = await persistTaskSessionMessageSnapshot(taskId, authorization, {
      runtimeSessionId: event.sessionId,
      message,
    });
    this.emitTaskPersistenceAck({
      ts: event.ts,
      taskId,
      projectId: event.projectId,
      phaseId: asString(event.data.phaseId) ?? event.phaseId,
      runtimeSessionId: event.sessionId,
      agentRunId: event.agentRunId,
      persistedMessageId: persistResult.data?.messageId,
      persistedSessionId: persistResult.data?.sessionId,
      seq: persistResult.data?.seq,
    });
  }

  private hasInlineMessageContent(message: Record<string, unknown>) {
    const textCandidates = [
      message.textContent,
      message.text,
      message.summaryText,
      message.content,
    ];
    if (textCandidates.some((value) => typeof value === "string" && value.trim().length > 0)) {
      return true;
    }

    return Array.isArray(message.parts) && message.parts.length > 0;
  }

  private extractRealtimeMessageId(message: Record<string, unknown>) {
    const info =
      typeof message.info === "object" && message.info
        ? (message.info as Record<string, unknown>)
        : null;
    const part =
      typeof message.part === "object" && message.part
        ? (message.part as Record<string, unknown>)
        : null;

    const candidates = [message.id, message.messageID, info?.id, part?.messageID, part?.messageId];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    return null;
  }

  private async loadRuntimeMessageSnapshot(
    sessionId: string,
    messageId: string,
  ): Promise<Record<string, unknown> | null> {
    const messagesResult = await getSessionMessages(sessionId, {
      includeLineage: false,
      bypassCircuitBreaker: true,
    });
    if (!messagesResult.ok || !Array.isArray(messagesResult.data)) {
      return null;
    }

    for (const entry of messagesResult.data) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const record = entry as Record<string, unknown>;
      const info =
        typeof record.info === "object" && record.info
          ? (record.info as Record<string, unknown>)
          : null;
      if (info?.id === messageId || record.id === messageId) {
        return record;
      }
    }

    return null;
  }

  private async resolvePersistableMessageSnapshot(
    event: RealtimeEvent,
  ): Promise<Record<string, unknown> | null> {
    if (!event.sessionId) {
      return null;
    }

    const rawType = typeof event.data.rawType === "string" ? event.data.rawType : undefined;
    const messageId = this.extractRealtimeMessageId(event.data);
    const shouldHydrateFromRuntime =
      rawType === "message.part.updated" || !this.hasInlineMessageContent(event.data);

    if (shouldHydrateFromRuntime && messageId) {
      const runtimeMessage = await this.loadRuntimeMessageSnapshot(event.sessionId, messageId);
      if (runtimeMessage) {
        return runtimeMessage;
      }

      if (rawType === "message.part.updated") {
        return null;
      }
    }

    return event.data;
  }

  /**
   * Resolve taskId for a session via local cache or service DB lookup.
   */
  private async resolveTaskForSession(
    sessionId: string,
  ): Promise<{ taskId: string; projectId?: string } | null> {
    const cached = this.sessionToTaskCache.get(sessionId);
    if (cached) return cached;

    // DB lookup via service (deduplicate concurrent requests)
    let pending = this.pendingSessionLookups.get(sessionId);
    if (!pending) {
      pending = cpFetch<{ taskId: string; projectId: string }>(
        `/api/tasks/lookup/session-task/${encodeURIComponent(sessionId)}`,
        { authorization: await createInternalAuthorization() },
      ).then((result) => {
        this.pendingSessionLookups.delete(sessionId);
        if (result.ok && result.data?.taskId) {
          const entry = { taskId: result.data.taskId, projectId: result.data.projectId };
          this.sessionToTaskCache.set(sessionId, entry);
          return entry;
        }
        return null;
      });
      this.pendingSessionLookups.set(sessionId, pending);
    }

    return pending;
  }

  private async maybeSyncDag(
    type: string,
    payload: Record<string, unknown> | null,
    parsed: Record<string, unknown>,
    workspaceDirectory?: string,
  ): Promise<void> {
    const graphMutation = this.isGraphMutationTool(type, payload);
    if (!graphMutation?.sessionId) {
      return;
    }

    const runtimeRun = findAgentRunBySessionId(graphMutation.sessionId);
    if (!runtimeRun?.taskId || !runtimeRun.projectId) {
      return;
    }

    const effectiveWorkspaceDirectory = workspaceDirectory || this.readWorkspaceDirectory(parsed);
    if (effectiveWorkspaceDirectory) {
      observeGraphWorkspaceDir(effectiveWorkspaceDirectory);
    }

    await onGraphToolExecuted();

    const authorization = await createInternalAuthorization();
    this.emit({
      id: crypto.randomUUID(),
      type: "task.node.updated",
      ts: new Date().toISOString(),
      sessionId: graphMutation.sessionId,
      taskId: runtimeRun.taskId,
      projectId: runtimeRun.projectId,
      agentRunId: runtimeRun.agentRunId,
      data: {
        sourceEvent: type,
        toolName: graphMutation.toolName,
      },
    });

    await this.emitPipelineStageUpdates({
      taskId: runtimeRun.taskId,
      sessionId: graphMutation.sessionId,
      projectId: runtimeRun.projectId,
      agentRunId: runtimeRun.agentRunId,
      authorization,
      reason: "task.node.updated",
    });
  }

  /**
   * No-op: pi-mono feeds events directly via ingestParsedEvent().
   */
  async subscribeGlobal(): Promise<void> {
    // pi-mono runtime pushes events via ingestParsedEvent(); no SSE subscription needed.
  }

  /**
   * No-op: pi-mono feeds events directly via ingestParsedEvent().
   */
  async subscribeSession(_sessionId: string): Promise<void> {
    // pi-mono runtime pushes events via ingestParsedEvent(); no SSE subscription needed.
  }

  async ingestParsedEvent(type: string, parsed: Record<string, unknown>): Promise<void> {
    await this.processParsedEvent(type, parsed);
  }

  private async processParsedEvent(type: string, parsed: Record<string, unknown>): Promise<void> {
    const payload =
      typeof parsed.payload === "object" && parsed.payload
        ? (parsed.payload as Record<string, unknown>)
        : null;

    const event = payload
      ? this.transformEvent(String(payload.type || type), {
          ...parsed,
          ...payload,
          ...(typeof payload.sessionId === "string" ? { sessionId: payload.sessionId } : {}),
          ...(typeof payload.sessionID === "string" ? { sessionID: payload.sessionID } : {}),
          ...(typeof payload.properties === "object" && payload.properties
            ? payload.properties
            : {}),
          rawType: payload.type,
        })
      : this.transformEvent(type, parsed);

    if (event) {
      if (event.type === "session.idle" || event.type === "session.updated" || event.type === "session.status") {
        console.log(`[sse-debug] event=${event.type} sessionId=${event.sessionId} taskId=${event.taskId} agentRunId=${event.agentRunId} isCompletion=${this.isCompletionSignal(event)}`);
      }
      for (const derivedEvent of this.buildTaskDomainEvents(event)) {
        this.emit(derivedEvent);
      }
      this.emit(event);
      if (event.type === "message.updated") {
        void this.persistSessionMessageSnapshot(event).catch((error) => {
          console.error(`Failed to persist message snapshot for task ${event.taskId}:`, error);
        });
      }
      if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
        void this.persistToolExecutionSnapshot(event).catch((error) => {
          console.error(`Failed to persist tool snapshot for task ${event.taskId}:`, error);
        });
      }
      if (event.type === "tool.execute.after") {
        await this.maybeSyncDag(
          String(payload?.type || type),
          payload,
          parsed,
          this.readWorkspaceDirectory(parsed),
        );
      }
      if (event.type === "session.error") {
        void this.maybeEmitAuthError(event);
        void this.maybeFinalizeFailure(event);
      }
      if (event.type === "tool.execute.before") {
        void this.maybeFailParallelQuestionTool(event);
      }
      void this.maybeFinalizeRun(event);
    }
  }

  private buildTaskDomainEvents(event: RealtimeEvent): RealtimeEvent[] {
    if (event.type === "message.updated") {
      const rawType = asString(event.data.rawType) ?? event.type;

      if (rawType === "message.updated") {
        const info = asRecord(event.data.info);
        const messageId = asString(info?.id);
        if (!info || !messageId) {
          return [];
        }

        return [
          {
            id: crypto.randomUUID(),
            type: "task.message.updated",
            ts: event.ts,
            projectId: event.projectId,
            taskId: event.taskId,
            phaseId: asString(event.data.phaseId) ?? event.phaseId,
            sessionId: event.sessionId,
            agentRunId: event.agentRunId,
            data: {
              message: event.data,
              reason: rawType,
            },
          },
        ];
      }

      if (rawType === "message.part.updated") {
        const part = asRecord(event.data.part);
        const messageId = asString(part?.messageID);
        const partType = asString(part?.type);
        const delta = asString(event.data.delta) ?? asString(part?.text);

        if (!messageId || partType !== "text" || !delta) {
          return [];
        }

        return [
          {
            id: crypto.randomUUID(),
            type: "task.message.delta",
            ts: event.ts,
            projectId: event.projectId,
            taskId: event.taskId,
            phaseId: asString(event.data.phaseId) ?? event.phaseId,
            sessionId: event.sessionId,
            agentRunId: event.agentRunId,
            data: {
              messageId,
              partType,
              delta,
              reason: rawType,
            },
          },
        ];
      }

      return [];
    }

    if (event.type === "session.created" || event.type === "session.updated") {
      return [
        {
          id: crypto.randomUUID(),
          type: "task.snapshot.updated",
          ts: event.ts,
          projectId: event.projectId,
          taskId: event.taskId,
          phaseId: asString(event.data.phaseId) ?? event.phaseId,
          sessionId: event.sessionId,
          agentRunId: event.agentRunId,
          data: {
            reason: event.type,
            scope: "session",
          },
        },
      ];
    }

    return [];
  }

  /**
   * Transform an OpenCode SSE event into a standard RealtimeEvent.
   */
  private transformEvent(type: string, data: Record<string, unknown>): RealtimeEvent | null {
    const eventTypeMap: Record<string, RealtimeEventType> = {
      "session.created": "session.created",
      "session.updated": "session.updated",
      "session.status": "session.status",
      "session.idle": "session.idle",
      "session.error": "session.error",
      "message.updated": "message.updated",
      "message.part.updated": "message.updated",
      "tool.execute.before": "tool.execute.before",
      "tool.execute.after": "tool.execute.after",
    };

    const mappedType = eventTypeMap[type];
    if (!mappedType) return null;

    const sessionId = this.extractSessionId(type, data);
    const run = sessionId ? findAgentRunBySessionId(sessionId) : undefined;

    // Populate session→task cache when agent run provides the mapping
    if (run?.taskId && sessionId) {
      this.sessionToTaskCache.set(sessionId, {
        taskId: run.taskId,
        projectId: run.projectId,
      });
    }

    return {
      id: crypto.randomUUID(),
      type: mappedType,
      ts: new Date().toISOString(),
      sessionId,
      taskId: run?.taskId,
      projectId: run?.projectId,
      phaseId: asString(data.phaseId) ?? asString(data.phaseID),
      agentRunId: run?.agentRunId,
      data:
        typeof data.rawType === "string" || type === mappedType
          ? data
          : {
              ...data,
              rawType: type,
            },
    };
  }

  private emit(event: RealtimeEvent): void {
    if (event.sessionId && event.type.startsWith("task.")) {
      noteContinueLatencyTaskDomainEvent(event.sessionId, event.type);
    }

    for (const handler of this.handlers) {
      handler(event);
    }
  }

  /**
   * Detect provider-level auth errors (e.g. Copilot 403) and surface
   * them as an explicit agent.auth-error event so the frontend can act
   * immediately instead of waiting for a completion that will never arrive.
   */
  private async maybeEmitAuthError(event: RealtimeEvent): Promise<void> {
    const error =
      typeof event.data.error === "object" && event.data.error
        ? (event.data.error as Record<string, unknown>)
        : undefined;
    if (!error) return;

    const errorData =
      typeof error.data === "object" && error.data
        ? (error.data as Record<string, unknown>)
        : undefined;

    const statusCode = errorData?.statusCode;
    const isAuthError =
      statusCode === 401 ||
      statusCode === 403 ||
      (typeof errorData?.message === "string" &&
        /reauthenticate|unauthorized|auth/i.test(errorData.message as string));

    if (!isAuthError) return;

    const { sessionId, taskId, projectId, agentRunId } = event;

    console.warn(`Provider auth error detected (status=${statusCode}) for session ${sessionId}`);

    this.emit({
      id: crypto.randomUUID(),
      type: "agent.auth-error",
      ts: new Date().toISOString(),
      sessionId,
      taskId,
      projectId,
      agentRunId,
      data: {
        statusCode,
        message: errorData?.message ?? error.name ?? "Provider authentication failed",
        provider: (errorData?.metadata as Record<string, unknown>)?.url ?? undefined,
        isRetryable: errorData?.isRetryable ?? false,
      },
    });

    // Mark the agent run as failed so the system stops waiting for completion
    if (agentRunId) {
      updateAgentRunStatus(agentRunId, "failed");
      const runtimeRun = sessionId ? findAgentRunBySessionId(sessionId) : undefined;
      const errorMessage =
        typeof errorData?.message === "string"
          ? errorData.message
          : (error.name ?? "Provider authentication failed");
      if (runtimeRun?.taskId) {
        await Promise.all([
          patchAgentRunRecord({
            taskId: runtimeRun.taskId,
            agentRunId,
            status: "failed",
            model: runtimeRun.model,
            error: String(errorMessage),
            finishedAt: new Date().toISOString(),
          }),
          recordAgentAudit({
            projectId: runtimeRun.projectId,
            taskId: runtimeRun.taskId,
            sessionId,
            agentRunId,
            eventType: "agent",
            action: "auth_error",
            detail: {
              statusCode,
              message: errorMessage,
            },
            riskLevel: "high",
          }),
        ]);
      }
    }
  }

  private isCompletionSignal(event: RealtimeEvent): boolean {
    if (!event.sessionId || !event.agentRunId || !event.taskId || !event.projectId) {
      return false;
    }

    if (event.type === "session.idle") {
      return true;
    }

    const info =
      typeof event.data.info === "object" && event.data.info
        ? (event.data.info as Record<string, unknown>)
        : undefined;
    const time =
      typeof info?.time === "object" && info.time
        ? (info.time as Record<string, unknown>)
        : undefined;
    const completed = time?.completed;

    if (event.type === "session.updated") {
      return typeof completed === "number" || typeof completed === "string";
    }

    if (event.type === "message.updated") {
      const finish = typeof info?.finish === "string" ? info.finish : undefined;
      return (
        info?.role === "assistant" &&
        finish !== "" &&
        finish !== undefined &&
        (typeof completed === "number" || typeof completed === "string")
      );
    }

    return false;
  }

  private async maybeFinalizeRun(event: RealtimeEvent): Promise<void> {
    if (
      !this.isCompletionSignal(event) ||
      !event.agentRunId ||
      !event.sessionId ||
      !event.taskId ||
      !event.projectId
    ) {
      return;
    }

    const run = findAgentRunBySessionId(event.sessionId);
    if (!run || run.status !== "running") {
      return;
    }

    if (this.finalizedAgentRuns.has(event.agentRunId)) {
      return;
    }

    if (this.finalizingAgentRuns.has(event.agentRunId)) {
      return;
    }

    this.finalizingAgentRuns.add(event.agentRunId);

    try {
      const authorization = await createInternalAuthorization();
      const assistantResult = await this.getLatestAssistantResult(
        event.sessionId,
        event.type === "session.idle" ? 20000 : 8000,
        event.taskId,
        authorization,
        run.lastPromptAt,
        { includeLineage: false, bypassCircuitBreaker: true },
      );

      if (!assistantResult.completed) {
        return;
      }

      const resultText = assistantResult.text;
      const tokenUsed = assistantResult.tokenUsed;

      // Check if this is a sequential-chain step completion
      const chainStepInfo = this.sessionToChainStepMap.get(event.sessionId);
      if (chainStepInfo) {
        const chainCtx = this.sequentialChainTasks.get(chainStepInfo.taskId);
        if (chainCtx) {
          updateAgentRunStatus(event.agentRunId, "completed");
          await Promise.all([
            patchAgentRunRecord({
              taskId: event.taskId,
              agentRunId: event.agentRunId,
              status: "completed",
              model: run.model,
              tokenUsed,
              result: resultText,
              finishedAt: new Date().toISOString(),
            }),
            recordAgentAudit({
              projectId: event.projectId,
              taskId: event.taskId,
              sessionId: event.sessionId,
              agentRunId: event.agentRunId,
              traceId: assistantResult.traceId,
              eventType: "agent",
              action: "chain_step_completed",
              detail: {
                stepIndex: chainStepInfo.stepIndex,
                executionMode: "sequential-chain",
                result: resultText,
              },
              riskLevel: "low",
            }),
          ]);
          this.finalizedAgentRuns.add(event.agentRunId);
          this.sessionToChainStepMap.delete(event.sessionId);

          this.emit({
            id: crypto.randomUUID(),
            type: "agent.completed",
            ts: new Date().toISOString(),
            sessionId: event.sessionId,
            taskId: event.taskId,
            projectId: event.projectId,
            agentRunId: event.agentRunId,
            data: {
              sourceEvent: event.type,
              executionMode: "sequential-chain",
              chainStepIndex: chainStepInfo.stepIndex,
              ...(resultText ? { result: resultText } : {}),
            },
          });

          void this.advanceSequentialChainStep(
            chainStepInfo.taskId,
            chainStepInfo.stepIndex,
            event.sessionId,
            resultText,
            event.projectId ?? "",
            authorization,
          );
          return;
        }
      }

      // Check if this is a parallel candidate completion
      const candidateInfo = await this.resolveParallelCandidateInfo({
        taskId: event.taskId,
        sessionId: event.sessionId,
        authorization,
        candidateIndexHint:
          typeof run.candidateIndex === "number" ? run.candidateIndex : undefined,
      });
      const parallelSessions = candidateInfo
        ? this.parallelTaskSessions.get(candidateInfo.taskId)
        : this.parallelTaskSessions.get(event.taskId);
      if (candidateInfo) {
        const finishedAt = new Date().toISOString();

        // Record this candidate's result
        const taskResults = this.parallelCandidateResults.get(candidateInfo.taskId);
        if (taskResults) {
          taskResults.set(candidateInfo.candidateIndex, {
            sessionId: event.sessionId,
            result: resultText,
          });
        }

        updateAgentRunStatus(event.agentRunId, "completed");
        if (event.taskId) {
          await Promise.all([
            patchAgentRunRecord({
              taskId: event.taskId,
              agentRunId: event.agentRunId,
              status: "completed",
              model: run.model,
              tokenUsed,
              result: resultText,
              finishedAt,
            }),
            recordAgentAudit({
              projectId: event.projectId,
              taskId: event.taskId,
              sessionId: event.sessionId,
              agentRunId: event.agentRunId,
              traceId: assistantResult.traceId,
              eventType: "agent",
              action: "completed",
              detail: {
                candidateIndex: candidateInfo.candidateIndex,
                executionMode: "parallel",
                result: resultText,
              },
              riskLevel: "low",
            }),
            this.updateParallelCandidatePlanState({
              taskId: event.taskId,
              authorization,
              candidateIndex: candidateInfo.candidateIndex,
              status: "completed",
              result: resultText,
              finishedAt,
            }),
          ]);

          const model = run.model || parseModelString("github-copilot:claude-sonnet-4");
          const guardOutcome = await this.recordPaidExecutionUsageEvent({
            taskId: event.taskId,
            projectId: event.projectId,
            sessionId: event.sessionId,
            agentRunId: event.agentRunId,
            traceId: assistantResult.traceId,
            authorization,
            providerId: model.providerId,
            modelId: model.modelId,
            tokenUsed,
            requestDelta: 1,
            runtimeLedger: {
              executionSource: "task-execute",
              entrypointType: "parallel-candidate",
              candidateCount: parallelSessions?.size ?? undefined,
              status: "completed",
              finishedAt: new Date().toISOString(),
              step: {
                stepType: "execution",
                candidateIndex: candidateInfo.candidateIndex,
                amplificationSource: "parallel",
                status: "completed",
                finishedAt: new Date().toISOString(),
              },
            },
          });
          if (guardOutcome.tripped) {
            await this.tripPaidExecutionBreaker({
              taskId: event.taskId,
              projectId: event.projectId,
              completedSessionId: event.sessionId,
              authorization,
              guardState: guardOutcome.guardState,
              reason: guardOutcome.breakerReason || "paid execution breaker tripped",
            });
          }
        }
        this.finalizedAgentRuns.add(event.agentRunId);

        this.emit({
          id: crypto.randomUUID(),
          type: "agent.completed",
          ts: new Date().toISOString(),
          sessionId: event.sessionId,
          taskId: event.taskId,
          projectId: event.projectId,
          agentRunId: event.agentRunId,
          data: {
            sourceEvent: event.type,
            candidateIndex: candidateInfo.candidateIndex,
            executionMode: "parallel",
            ...(resultText ? { result: resultText } : {}),
          },
        });

        await this.emitPipelineStageUpdates({
          taskId: event.taskId,
          sessionId: event.sessionId,
          projectId: event.projectId,
          agentRunId: event.agentRunId,
          authorization,
          reason: "agent.completed",
        });

        // Collect changes for this candidate
        collectChangesFromSession({
          taskId: event.taskId,
          sessionId: event.sessionId,
          agentRunId: event.agentRunId,
          authorization,
        }).catch((err) => {
          console.error(
            `Change collection failed for parallel candidate ${candidateInfo.candidateIndex}:`,
            err,
          );
        });

        // Check if all candidates are done
        const allSessions = this.parallelTaskSessions.get(candidateInfo.taskId);
        if (allSessions && taskResults && taskResults.size >= allSessions.size) {
          void this.finalizeParallelTask(
            candidateInfo.taskId,
            event.projectId ?? "",
            authorization,
          );
        }

        return;
      }

      // Single mode: original flow
      const currentTaskResult = await cpFetch<CompletedTaskContext>(
        `/api/project-tree/tasks/${encodeURIComponent(event.taskId)}`,
        { authorization },
      );
      const currentTask = currentTaskResult.ok ? currentTaskResult.data : undefined;

      if (currentTask?.orchestrationKind === "parallel" || this.isTrackedParallelTask(event.taskId)) {
        updateAgentRunStatus(event.agentRunId, "completed");
        this.finalizedAgentRuns.add(event.agentRunId);
        return;
      }

      const taskUpdate = await finalizeTaskState({
        authorization,
        taskId: event.taskId,
        status: "completed",
        sessionId: event.sessionId,
        agentRunId: event.agentRunId,
        result: resultText,
        task: currentTask,
      });

      if (!taskUpdate) {
        throw new Error(`Task completion sync failed for ${event.taskId}`);
      }

      updateAgentRunStatus(event.agentRunId, "completed");
      await Promise.all([
        patchAgentRunRecord({
          taskId: event.taskId,
          agentRunId: event.agentRunId,
          status: "completed",
          model: run.model,
          tokenUsed,
          result: resultText,
          finishedAt: new Date().toISOString(),
        }),
        recordAgentAudit({
          projectId: event.projectId,
          taskId: event.taskId,
          sessionId: event.sessionId,
          agentRunId: event.agentRunId,
          traceId: assistantResult.traceId,
          eventType: "agent",
          action: "completed",
          detail: {
            sourceEvent: event.type,
            result: resultText,
          },
          riskLevel: "low",
        }),
      ]);
      const model = run.model || parseModelString("github-copilot:claude-sonnet-4");
      const guardOutcome = await this.recordPaidExecutionUsageEvent({
        taskId: event.taskId,
        projectId: event.projectId,
        sessionId: event.sessionId,
        agentRunId: event.agentRunId,
        traceId: assistantResult.traceId,
        authorization,
        providerId: model.providerId,
        modelId: model.modelId,
        tokenUsed,
        requestDelta: 1,
        runtimeLedger: {
          executionSource: "task-execute",
          entrypointType: "single-task",
          candidateCount: 1,
          status: "completed",
          finishedAt: new Date().toISOString(),
          step: {
            stepType: "execution",
            amplificationSource: "execution",
            status: "completed",
            finishedAt: new Date().toISOString(),
          },
        },
      });
      if (guardOutcome.tripped) {
        await this.tripPaidExecutionBreaker({
          taskId: event.taskId,
          projectId: event.projectId,
          completedSessionId: event.sessionId,
          authorization,
          guardState: guardOutcome.guardState,
          reason: guardOutcome.breakerReason || "paid execution breaker tripped",
        });
      }
      this.finalizedAgentRuns.add(event.agentRunId);

      this.emit({
        id: crypto.randomUUID(),
        type: "agent.completed",
        ts: new Date().toISOString(),
        sessionId: event.sessionId,
        taskId: event.taskId,
        projectId: event.projectId,
        agentRunId: event.agentRunId,
        data: {
          sourceEvent: event.type,
          ...(resultText ? { result: resultText } : {}),
        },
      });

      this.emit({
        id: crypto.randomUUID(),
        type: "task.completed",
        ts: new Date().toISOString(),
        sessionId: event.sessionId,
        taskId: event.taskId,
        projectId: event.projectId,
        agentRunId: event.agentRunId,
        data: {
          status: "completed",
          sourceEvent: event.type,
          ...(resultText ? { result: resultText } : {}),
        },
      });

      await this.emitPipelineStageUpdates({
        taskId: event.taskId,
        sessionId: event.sessionId,
        projectId: event.projectId,
        agentRunId: event.agentRunId,
        authorization,
        reason: "task.completed",
      });

      // Collect code changes first, then run any configured post-execution hooks.
      const completedTaskId = event.taskId;
      await collectChangesFromSession({
        taskId: event.taskId,
        sessionId: event.sessionId,
        agentRunId: event.agentRunId,
        authorization,
      }).catch((err) => {
        console.error(`Change collection failed for task ${event.taskId}:`, err);
      });

      if (!completedTaskId) {
        return;
      }

      await this.triggerPostExecutionHooks(completedTaskId, resultText, authorization).catch(
        (err) => {
          console.error(`Post-execution hooks failed for task ${completedTaskId}:`, err);
        },
      );
    } catch (error) {
      console.error(`Failed to finalize agent run ${event.agentRunId}:`, error);
    } finally {
      this.finalizingAgentRuns.delete(event.agentRunId);
    }
  }

  /**
   * Handle session.error events: mark the task as failed and trigger on-failure hooks.
   */
  private async maybeFinalizeFailure(event: RealtimeEvent): Promise<void> {
    if (event.type !== "session.error" || !event.sessionId || !event.taskId) {
      return;
    }

    const run = findAgentRunBySessionId(event.sessionId);
    if (!run) return;

    // Pause/stop currently relies on aborting the runtime session, which may emit
    // session.error even though the local run state is intentional and recoverable.
    if (run.status === "paused" || run.status === "stopped") {
      return;
    }

    // Avoid double-processing if already finalized or finalizing
    if (
      run.agentRunId &&
      (this.finalizedAgentRuns.has(run.agentRunId) || this.finalizingAgentRuns.has(run.agentRunId))
    ) {
      return;
    }

    const errorMessage = this.extractErrorMessage(event);
    const authorization = await createInternalAuthorization();
    const assistantResult = await this.getLatestAssistantResult(
      event.sessionId,
      1000,
      event.taskId,
      authorization,
    );
    const tokenUsed = assistantResult.tokenUsed;
    const candidateInfo = this.sessionToCandidateMap.get(event.sessionId);

    // Mark the agent run as failed
    if (run.agentRunId) {
      updateAgentRunStatus(run.agentRunId, "failed");
      await Promise.all([
        patchAgentRunRecord({
          taskId: event.taskId,
          agentRunId: run.agentRunId,
          status: "failed",
          model: run.model,
          tokenUsed,
          error: errorMessage,
          finishedAt: new Date().toISOString(),
        }),
        recordAgentAudit({
          projectId: event.projectId,
          taskId: event.taskId,
          sessionId: event.sessionId,
          agentRunId: run.agentRunId,
          traceId: assistantResult.traceId,
          eventType: "agent",
          action: "failed",
          detail: { error: errorMessage, sourceEvent: event.type },
          riskLevel: "high",
        }),
      ]);
      this.finalizedAgentRuns.add(run.agentRunId);
    }

    const failureAuthorization = await createInternalAuthorization();
    const model = run.model || parseModelString("github-copilot:claude-sonnet-4");
    const guardOutcome = await this.recordPaidExecutionUsageEvent({
      taskId: event.taskId,
      projectId: event.projectId,
      sessionId: event.sessionId,
      agentRunId: run.agentRunId,
      traceId: assistantResult.traceId,
      authorization: failureAuthorization,
      providerId: model.providerId,
      modelId: model.modelId,
      tokenUsed,
      requestDelta: 1,
      runtimeLedger: {
        executionSource: "task-execute",
        entrypointType: candidateInfo ? "parallel-candidate" : "single-task",
        status: "failed",
        finishedAt: new Date().toISOString(),
        step: {
          stepType: "execution",
          candidateIndex: candidateInfo?.candidateIndex,
          amplificationSource: candidateInfo ? "parallel" : "execution",
          status: "failed",
          finishedAt: new Date().toISOString(),
        },
      },
    });
    if (guardOutcome.tripped) {
      await this.tripPaidExecutionBreaker({
        taskId: event.taskId,
        projectId: event.projectId,
        completedSessionId: event.sessionId,
        authorization: failureAuthorization,
        guardState: guardOutcome.guardState,
        reason: guardOutcome.breakerReason || "paid execution breaker tripped",
      });
    }

    // Check if this is a parallel candidate failure
    if (candidateInfo) {
      const finishedAt = new Date().toISOString();

      await this.updateParallelCandidatePlanState({
        taskId: event.taskId,
        authorization: failureAuthorization,
        candidateIndex: candidateInfo.candidateIndex,
        status: "failed",
        result: `[FAILED] ${errorMessage}`,
        finishedAt,
      });

      this.emit({
        id: crypto.randomUUID(),
        type: "agent.completed",
        ts: new Date().toISOString(),
        sessionId: event.sessionId,
        taskId: event.taskId,
        projectId: event.projectId,
        agentRunId: run.agentRunId,
        data: {
          sourceEvent: event.type,
          candidateIndex: candidateInfo.candidateIndex,
          executionMode: "parallel",
          error: errorMessage,
          status: "failed",
        },
      });

      // Record failure result for the candidate so parallel tracking can proceed
      const taskResults = this.parallelCandidateResults.get(candidateInfo.taskId);
      if (taskResults) {
        taskResults.set(candidateInfo.candidateIndex, {
          sessionId: event.sessionId,
          result: `[FAILED] ${errorMessage}`,
        });
      }

      // Check if all candidates are now done (succeeded or failed)
      const allSessions = this.parallelTaskSessions.get(candidateInfo.taskId);
      if (allSessions && taskResults && taskResults.size >= allSessions.size) {
        void this.finalizeParallelTask(
          candidateInfo.taskId,
          event.projectId ?? "",
          failureAuthorization,
        );
      }
      return;
    }

    // Check if this is a sequential-chain step failure
    const chainStepInfo = this.sessionToChainStepMap.get(event.sessionId);
    if (chainStepInfo) {
      const chainCtx = this.sequentialChainTasks.get(chainStepInfo.taskId);
      if (chainCtx) {
        // Mark the current step as failed in the plan
        const chainSteps = chainCtx.plan.steps.filter((s) => s.type === "chain-step");
        const failedStep = chainSteps[chainStepInfo.stepIndex];
        if (failedStep) {
          failedStep.status = "failed";
          failedStep.result = `[FAILED] ${errorMessage}`;
          failedStep.finishedAt = new Date().toISOString();
        }

        this.sessionToChainStepMap.delete(event.sessionId);

        this.emit({
          id: crypto.randomUUID(),
          type: "agent.completed",
          ts: new Date().toISOString(),
          sessionId: event.sessionId,
          taskId: event.taskId,
          projectId: event.projectId,
          agentRunId: run.agentRunId,
          data: {
            sourceEvent: event.type,
            executionMode: "sequential-chain",
            chainStepIndex: chainStepInfo.stepIndex,
            error: errorMessage,
            status: "failed",
          },
        });

        // Fail the entire chain
        void this.finalizeSequentialChainTask(
          chainStepInfo.taskId,
          event.projectId ?? "",
          failureAuthorization,
          errorMessage,
        );
        return;
      }
    }

    // Single mode: patch task as failed + trigger on-failure hooks
    try {
      const authorization = failureAuthorization;

      const finalized = await finalizeTaskState({
        authorization,
        taskId: event.taskId,
        status: "failed",
        sessionId: event.sessionId,
        agentRunId: run.agentRunId,
        result: errorMessage,
      });

      if (!finalized) {
        throw new Error(`Task failure sync failed for ${event.taskId}`);
      }

      this.emit({
        id: crypto.randomUUID(),
        type: "task.completed",
        ts: new Date().toISOString(),
        sessionId: event.sessionId,
        taskId: event.taskId,
        projectId: event.projectId,
        agentRunId: run.agentRunId,
        data: { status: "failed", error: errorMessage, sourceEvent: event.type },
      });

      await this.emitPipelineStageUpdates({
        taskId: event.taskId,
        sessionId: event.sessionId,
        projectId: event.projectId,
        agentRunId: run.agentRunId,
        authorization,
        reason: "task.failed",
      });

      void this.triggerOnFailureHooks(event.taskId, errorMessage, authorization);
    } catch (error) {
      console.error(`Failed to finalize failure for task ${event.taskId}:`, error);
    }
  }

  private async maybeFailParallelQuestionTool(event: RealtimeEvent): Promise<void> {
    if (event.type !== "tool.execute.before" || !event.sessionId || !event.taskId) {
      return;
    }

    const candidateInfo = this.sessionToCandidateMap.get(event.sessionId);
    if (!candidateInfo) {
      return;
    }

    const toolName = this.readToolName(event.data);
    if (toolName !== "question") {
      return;
    }

    const run = findAgentRunBySessionId(event.sessionId);
    if (!run?.agentRunId || run.status !== "running") {
      return;
    }

    if (
      this.finalizedAgentRuns.has(run.agentRunId) ||
      this.finalizingAgentRuns.has(run.agentRunId)
    ) {
      return;
    }

    const errorMessage =
      "Parallel candidate requested interactive clarification via question tool, which is not supported in unattended parallel execution.";
    const resultText = `[FAILED] ${errorMessage}`;
    const finishedAt = new Date().toISOString();
    const authorization = await createInternalAuthorization();
    const assistantResult = await this.getLatestAssistantResult(
      event.sessionId,
      1000,
      event.taskId,
      authorization,
    );
    const tokenUsed = assistantResult.tokenUsed;

    try {
      const terminateResult = await terminateAgent(run.agentRunId);
      if (!terminateResult.ok) {
        console.warn(
          `Failed to abort parallel question candidate ${run.agentRunId}: ${terminateResult.error}`,
        );
      }

      updateAgentRunStatus(run.agentRunId, "failed");

      await Promise.all([
        patchAgentRunRecord({
          taskId: event.taskId,
          agentRunId: run.agentRunId,
          status: "failed",
          model: run.model,
          tokenUsed,
          error: errorMessage,
          finishedAt,
        }),
        recordAgentAudit({
          projectId: event.projectId,
          taskId: event.taskId,
          sessionId: event.sessionId,
          agentRunId: run.agentRunId,
          traceId: assistantResult.traceId,
          eventType: "agent",
          action: "failed",
          detail: {
            error: errorMessage,
            sourceEvent: event.type,
            candidateIndex: candidateInfo.candidateIndex,
            executionMode: "parallel",
            tool: toolName,
            failureKind: "interactive-question-blocked",
          },
          riskLevel: "medium",
        }),
        this.updateParallelCandidatePlanState({
          taskId: event.taskId,
          authorization,
          candidateIndex: candidateInfo.candidateIndex,
          status: "failed",
          result: resultText,
          finishedAt,
        }),
      ]);

      const model = run.model || parseModelString("github-copilot:claude-sonnet-4");
      const guardOutcome = await this.recordPaidExecutionUsageEvent({
        taskId: event.taskId,
        projectId: event.projectId,
        sessionId: event.sessionId,
        agentRunId: run.agentRunId,
        traceId: assistantResult.traceId,
        authorization,
        providerId: model.providerId,
        modelId: model.modelId,
        tokenUsed,
        requestDelta: 1,
        runtimeLedger: {
          executionSource: "task-execute",
          entrypointType: "parallel-candidate",
          status: "failed",
          finishedAt,
          step: {
            stepType: "execution",
            candidateIndex: candidateInfo.candidateIndex,
            amplificationSource: "parallel",
            status: "failed",
            finishedAt,
          },
        },
      });
      if (guardOutcome.tripped) {
        await this.tripPaidExecutionBreaker({
          taskId: event.taskId,
          projectId: event.projectId,
          completedSessionId: event.sessionId,
          authorization,
          guardState: guardOutcome.guardState,
          reason: guardOutcome.breakerReason || "paid execution breaker tripped",
        });
      }

      const taskResults = this.parallelCandidateResults.get(candidateInfo.taskId);
      if (taskResults) {
        taskResults.set(candidateInfo.candidateIndex, {
          sessionId: event.sessionId,
          result: resultText,
        });
      }

      this.finalizedAgentRuns.add(run.agentRunId);

      this.emit({
        id: crypto.randomUUID(),
        type: "agent.completed",
        ts: finishedAt,
        sessionId: event.sessionId,
        taskId: event.taskId,
        projectId: event.projectId,
        agentRunId: run.agentRunId,
        data: {
          sourceEvent: event.type,
          candidateIndex: candidateInfo.candidateIndex,
          executionMode: "parallel",
          error: errorMessage,
          status: "failed",
          tool: toolName,
        },
      });

      await this.emitPipelineStageUpdates({
        taskId: event.taskId,
        sessionId: event.sessionId,
        projectId: event.projectId,
        agentRunId: run.agentRunId,
        authorization,
        reason: "agent.completed",
      });

      const allSessions = this.parallelTaskSessions.get(candidateInfo.taskId);
      if (allSessions && taskResults && taskResults.size >= allSessions.size) {
        void this.finalizeParallelTask(candidateInfo.taskId, event.projectId ?? "", authorization);
      }
    } catch (error) {
      console.error(
        `Failed to handle question-tool stall for parallel candidate ${run.agentRunId}:`,
        error,
      );
    }
  }

  private extractErrorMessage(event: RealtimeEvent): string {
    const error =
      typeof event.data.error === "object" && event.data.error
        ? (event.data.error as Record<string, unknown>)
        : typeof event.data.error === "string"
          ? event.data.error
          : undefined;
    if (typeof error === "string") return error;
    if (error) {
      const data =
        typeof error.data === "object" && error.data
          ? (error.data as Record<string, unknown>)
          : undefined;
      return String(data?.message ?? error.message ?? error.name ?? "Unknown error");
    }
    return "Session error";
  }

  private readToolName(data: Record<string, unknown>): string | undefined {
    const tool = data.tool;
    if (typeof tool === "string") {
      return tool;
    }

    const toolName = data.toolName;
    if (typeof toolName === "string") {
      return toolName;
    }

    const name = data.name;
    if (typeof name === "string") {
      return name;
    }

    return undefined;
  }

  private async updateParallelCandidatePlanState(args: {
    taskId: string;
    authorization: string;
    candidateIndex: number;
    status: ExecutionCandidate["status"];
    result?: string;
    finishedAt?: string;
  }): Promise<void> {
    void args;
  }

  /**
   * Run all enabled on-failure lifecycle hooks for a failed task.
   */
  private async triggerOnFailureHooks(
    taskId: string,
    errorMessage: string,
    authorization: string,
  ): Promise<void> {
    const strategyConfig = readOrchestrationStrategy();

    const taskResult = await cpFetch<CompletedTaskContext>(
      `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
      { authorization },
    );
    if (!taskResult.ok) return;

    const task = taskResult.data;
    const taskStrategy = parseTaskStrategy(task.strategy);
    const paidExecutionGuard = taskStrategy.paidExecutionGuard as
      | PaidExecutionGuardState
      | undefined;
    if (this.isPaidExecutionBreakerTripped(taskId)) {
      await recordAgentAudit({
        projectId: task.projectId,
        taskId: task.id,
        sessionId: task.sessionId ?? undefined,
        eventType: "paid_execution",
        action: "failure_hooks_skipped",
        detail: buildPaidExecutionGuardDetail(paidExecutionGuard, {
          reason: this.paidExecutionRuntime.get(taskId)?.reason || "paid execution breaker tripped",
        }),
        riskLevel: "medium",
      });
      return;
    }

    const hookResult = await executeLifecycleHooks({
      strategy: strategyConfig,
      trigger: "on-failure",
      taskId: task.id,
      projectId: task.projectId,
      taskTitle: task.title,
      taskPrompt: task.prompt,
      titlePrefix: "on-failure",
      context: {
        taskId: task.id,
        projectId: task.projectId,
        taskTitle: task.title,
        taskPrompt: task.prompt,
        errorMessage,
      },
      onHookExecuted: async (execution) => {
        const modelRoute =
          execution.model ||
          (typeof taskStrategy.effectiveModel === "string"
            ? taskStrategy.effectiveModel
            : undefined) ||
          task.selectedModel ||
          paidExecutionGuard?.modelRoute;
        if (
          !execution.sessionId ||
          !modelRoute ||
          !execution.tokenUsed ||
          execution.tokenUsed <= 0
        ) {
          return;
        }

        const resolvedModel = parseModelString(modelRoute);
        const guardOutcome = await this.recordPaidExecutionUsageEvent({
          taskId: task.id,
          projectId: task.projectId,
          sessionId: execution.sessionId,
          authorization,
          providerId: resolvedModel.providerId,
          modelId: resolvedModel.modelId,
          tokenUsed: execution.tokenUsed,
          requestDelta: 1,
          action: "hook_usage_recorded",
          runtimeLedger: {
            executionSource: `task-${execution.trigger}-hook`,
            entrypointType: "hook-only",
            hookRequestCountDelta: 1,
            status: execution.status === "failed" ? "failed" : "completed",
            finishedAt: execution.completedAt,
            step: {
              stepType: "hook",
              triggerType: execution.trigger,
              hookId: execution.hookId,
              amplificationSource: "hook",
              status:
                execution.status === "failed"
                  ? "failed"
                  : execution.status === "skipped"
                    ? "skipped"
                    : "completed",
              finishedAt: execution.completedAt,
            },
          },
          detail: buildPaidExecutionGuardDetail(paidExecutionGuard, {
            hookId: execution.hookId,
            trigger: execution.trigger,
            hookStatus: execution.status,
            agent: execution.agent,
          }),
          riskLevel: "medium",
        });

        if (guardOutcome.tripped) {
          await this.tripPaidExecutionBreaker({
            taskId: task.id,
            projectId: task.projectId,
            completedSessionId: execution.sessionId,
            authorization,
            guardState: guardOutcome.guardState,
            reason: guardOutcome.breakerReason || "paid execution breaker tripped",
          });

          return {
            stop: true,
            reason:
              guardOutcome.breakerReason ||
              "Stopped remaining failure hooks after the paid execution breaker tripped.",
          };
        }

        return;
      },
    });

    // Append hook execution records to the task strategy
    if (hookResult.hookExecutions.length > 0) {
      await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        authorization,
        body: {
          strategy: mergeTaskStrategy(task.strategy, {
            hookExecutions: hookResult.hookExecutions,
          }),
        },
      });
    }
  }

  private async getLatestAssistantResult(
    sessionId: string,
    timeoutMs: number,
    taskId?: string,
    authorization?: string,
    minCompletedAt?: number,
    options?: { includeLineage?: boolean; bypassCircuitBreaker?: boolean },
  ): Promise<{ text?: string; traceId?: string; completed: boolean; tokenUsed: number }> {
    const deadline = Date.now() + timeoutMs;
    let fallbackText: string | undefined;
    let fallbackTraceId: string | undefined;
    let fallbackTokenUsed = 0;

    while (Date.now() < deadline) {
      const messagesResult = await getSessionMessages(
        sessionId,
        taskId
          ? {
              taskId,
              authorization,
              includeLineage: options?.includeLineage,
              bypassCircuitBreaker: options?.bypassCircuitBreaker,
            }
          : options?.bypassCircuitBreaker
            ? { bypassCircuitBreaker: true }
            : undefined,
      );
      if (!messagesResult.ok || !Array.isArray(messagesResult.data)) {
        return {
          text: fallbackText,
          traceId: fallbackTraceId,
          completed: false,
          tokenUsed: fallbackTokenUsed,
        };
      }

      const assistantResult = extractAssistantResultFromMessages(messagesResult.data, {
        minCompletedAt,
      });
      if (assistantResult.text) {
        fallbackText = assistantResult.text;
      }
      if (assistantResult.traceId) {
        fallbackTraceId = assistantResult.traceId;
      }
      if (assistantResult.tokenUsed > 0) {
        fallbackTokenUsed = assistantResult.tokenUsed;
      }

      if (assistantResult.completed) {
        return assistantResult;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return {
      text: fallbackText,
      traceId: fallbackTraceId,
      completed: false,
      tokenUsed: fallbackTokenUsed,
    };
  }

  private extractSessionId(type: string, data: Record<string, unknown>): string | undefined {
    if (typeof data.sessionId === "string") return data.sessionId;
    if (typeof data.sessionID === "string") return data.sessionID;

    const info =
      typeof data.info === "object" && data.info
        ? (data.info as Record<string, unknown>)
        : undefined;
    if (type.startsWith("session.") && typeof info?.id === "string") {
      return info.id;
    }
    if (typeof info?.sessionID === "string") {
      return info.sessionID;
    }

    const part =
      typeof data.part === "object" && data.part
        ? (data.part as Record<string, unknown>)
        : undefined;
    if (typeof part?.sessionID === "string") {
      return part.sessionID;
    }

    return undefined;
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  // ── Sequential-chain step advancement ───────────────────────────

  /**
   * Advance to the next chain step after the current one completes.
   * If all steps are done, finalize the chain task.
   */
  private async advanceSequentialChainStep(
    taskId: string,
    completedStepIndex: number,
    completedSessionId: string,
    stepResult: string | undefined,
    projectId: string,
    authorization: string,
  ): Promise<void> {
    const chainCtx = this.sequentialChainTasks.get(taskId);
    if (!chainCtx) return;

    const { plan } = chainCtx;
    const chainSteps = plan.steps.filter((s) => s.type === "chain-step");

    // Mark completed step
    const completedStep = chainSteps[completedStepIndex];
    if (completedStep) {
      completedStep.status = "completed";
      completedStep.result = stepResult;
      completedStep.finishedAt = new Date().toISOString();
    }

    const nextIndex = completedStepIndex + 1;
    plan.currentChainStepIndex = nextIndex;

    // Persist intermediate plan progress
    // All steps done?
    if (nextIndex >= chainSteps.length) {
      void this.finalizeSequentialChainTask(taskId, projectId, authorization);
      return;
    }

    // Start next step
    const nextStep = chainSteps[nextIndex];
    if (!nextStep) {
      void this.finalizeSequentialChainTask(taskId, projectId, authorization);
      return;
    }

    nextStep.status = "running";

    // Fetch the task to get prompt and context
    const taskResult = await cpFetch<CompletedTaskContext>(
      `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
      { authorization },
    );
    if (!taskResult.ok) {
      void this.finalizeSequentialChainTask(
        taskId,
        projectId,
        authorization,
        "Failed to fetch task for next chain step",
      );
      return;
    }

    const task = taskResult.data;

    // Build prompt with completed step results injected
    const stepPrompt = this.buildChainStepPrompt(
      task.prompt || "",
      nextStep,
      nextIndex,
      plan.steps,
    );

    // Resolve model override
    let resolvedModel: { providerId: string; modelId: string } | undefined;
    if (nextStep.model) {
      resolvedModel = parseModelString(nextStep.model);
    } else if (task.selectedModel) {
      resolvedModel = parseModelString(task.selectedModel);
    }

    const execResult = await createSession(taskId, task.projectId, stepPrompt, {
      agent: undefined,
      model: resolvedModel,
    });

    if (execResult.agentRunId) {
      await createAgentRunRecord({
        taskId,
        agentRunId: execResult.agentRunId,
        sessionId: execResult.sessionId,
        agentType: "coder",
        status: execResult.ok ? "running" : "failed",
        model: resolvedModel,
        candidateIndex: nextIndex,
        error: execResult.ok ? undefined : execResult.error,
        startedAt: new Date().toISOString(),
        finishedAt: execResult.ok ? undefined : new Date().toISOString(),
      });
    }

    if (!execResult.ok || !execResult.sessionId) {
      nextStep.status = "failed";
      void this.finalizeSequentialChainTask(
        taskId,
        projectId,
        authorization,
        execResult.error || "Failed to start next chain step",
      );
      return;
    }

    // Register the new session for tracking
    this.sessionToChainStepMap.set(execResult.sessionId, { taskId, stepIndex: nextIndex });

    await upsertTaskSessionLineageRecord(taskId, authorization, {
      runtimeSessionId: execResult.sessionId,
      parentRuntimeSessionId:
        completedSessionId && completedSessionId !== execResult.sessionId
          ? completedSessionId
          : undefined,
      branchName: `${task.title} — ${nextStep.title}`,
      sourceType:
        completedSessionId && completedSessionId !== execResult.sessionId ? "fork" : "root",
      sessionKind: "sequential_step",
      executionModeSnapshot: "sequential_chain",
      isActive: true,
      stepIndex: nextIndex,
      selectedModel: resolvedModel
        ? formatModelRoute(resolvedModel)
        : (task.selectedModel ?? undefined),
      operationId: chainCtx.operationId,
    }).catch(() => null);

    // Update plan with new session info
    plan.candidates[0] = {
      ...plan.candidates[0],
      agent: plan.candidates[0]?.agent || "executor",
      sessionId: execResult.sessionId,
      agentRunId: execResult.agentRunId,
      status: "running",
      startedAt: new Date().toISOString(),
    };

    this.emit({
      id: crypto.randomUUID(),
      type: "agent.started",
      ts: new Date().toISOString(),
      taskId,
      projectId,
      agentRunId: execResult.agentRunId,
      sessionId: execResult.sessionId,
      data: {
        taskId,
        executionMode: "sequential-chain",
        chainStepIndex: nextIndex,
        chainStepTitle: nextStep.title,
        totalSteps: chainSteps.length,
      },
    });
  }

  /**
   * Finalize the sequential chain task — aggregate all step results and complete.
   */
  private async finalizeSequentialChainTask(
    taskId: string,
    projectId: string,
    authorization: string,
    failureError?: string,
  ): Promise<void> {
    const chainCtx = this.sequentialChainTasks.get(taskId);
    if (!chainCtx) return;

    try {
      const { plan } = chainCtx;
      const chainSteps = plan.steps.filter((s) => s.type === "chain-step");
      const isFailed = Boolean(failureError);
      const status = isFailed ? "failed" : "completed";

      // Aggregate results from all chain steps
      const aggregatedParts: string[] = [];
      for (const step of chainSteps) {
        if (step.result && step.status === "completed") {
          aggregatedParts.push(`## ${step.title}\n${step.result}`);
        }
      }
      const chainResult = aggregatedParts.join("\n\n") || failureError || undefined;
      plan.chainResult = chainResult;

      await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        authorization,
        body: {
          status,
          ...(chainResult ? { result: chainResult } : {}),
        },
      });

      this.emit({
        id: crypto.randomUUID(),
        type: "task.completed",
        ts: new Date().toISOString(),
        taskId,
        projectId,
        data: {
          status,
          executionMode: "sequential-chain",
          totalSteps: chainSteps.length,
          completedSteps: chainSteps.filter((s) => s.status === "completed").length,
          ...(chainResult ? { result: chainResult } : {}),
          ...(failureError ? { error: failureError } : {}),
        },
      });

      await this.emitPipelineStageUpdates({
        taskId,
        projectId,
        authorization,
        reason: isFailed ? "task.failed" : "task.completed",
      });

      if (!isFailed) {
        this.triggerPostExecutionHooks(taskId, chainResult, authorization).catch((err) => {
          console.error(`Post-execution hooks failed for chain task ${taskId}:`, err);
        });
      } else {
        void this.triggerOnFailureHooks(
          taskId,
          failureError || "Chain execution failed",
          authorization,
        );
      }
    } catch (error) {
      console.error(`Failed to finalize sequential chain task ${taskId}:`, error);
    } finally {
      // Clean up tracking state
      this.sequentialChainTasks.delete(taskId);
      for (const [sid, info] of this.sessionToChainStepMap) {
        if (info.taskId === taskId) this.sessionToChainStepMap.delete(sid);
      }
    }
  }

  /**
   * Build a prompt for a specific chain step, injecting completed step results.
   */
  private buildChainStepPrompt(
    basePrompt: string,
    step: ExecutionStep,
    stepIndex: number,
    allSteps: ExecutionStep[],
  ): string {
    const chainSteps = allSteps.filter((s) => s.type === "chain-step");
    const totalSteps = chainSteps.length;
    const parts: string[] = [basePrompt];

    const completedSteps = chainSteps.filter((s) => s.status === "completed" && s.result);
    if (completedSteps.length > 0) {
      parts.push("\n\n## 已完成步骤产出\n");
      for (const cs of completedSteps) {
        parts.push(`### ${cs.title}\n${cs.result}\n`);
      }
    }

    parts.push(`\n## 当前步骤 (${stepIndex + 1}/${totalSteps}): ${step.title}\n`);
    parts.push(step.instruction || "");
    parts.push("\n请只完成当前步骤的目标。完成后输出本步骤产出摘要。");

    return parts.join("\n");
  }

  /**
   * Finalize a parallel task after all candidates have completed.
   * Optionally triggers a judge evaluation.
   */
  private async finalizeParallelTask(
    taskId: string,
    projectId: string,
    authorization: string,
  ): Promise<void> {
    if (this.judgingTasks.has(taskId)) return;
    this.judgingTasks.add(taskId);

    let preserveTracking = false;

    try {
      const results = this.parallelCandidateResults.get(taskId);
      const candidateResults = results
        ? Array.from(results.entries()).sort(([a], [b]) => a - b)
        : [];
      const settlement = await this.confirmParallelCandidatesSettled({
        taskId,
        authorization,
        candidateResults,
      });
      const trackedSessionIds = new Set(this.parallelTaskSessions.get(taskId) ?? []);
      const totalCandidateCount = settlement.totalCandidateCount;
      if (!settlement.ready) {
        preserveTracking = true;
        return;
      }

      const taskResult = await cpFetch<CompletedTaskContext>(
        `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
        { authorization },
      );
      if (!taskResult.ok) return;

      const task = taskResult.data;
      const taskStrategy = parseTaskStrategy(task.strategy);
      const paidExecutionGuard = taskStrategy.paidExecutionGuard as
        | PaidExecutionGuardState
        | undefined;

      // Try to run judge if configured
      const strategyConfig = readOrchestrationStrategy();
      const judgeConfig = strategyConfig.judge;
      let judgeResult: JudgeResult | undefined;

      const judgeDisabledByGuard = Boolean(
        paidExecutionGuard?.overridesApplied?.includes("judge-disabled") ||
          this.isPaidExecutionBreakerTripped(taskId),
      );

      if (judgeConfig.enabled && candidateResults.length > 1 && !judgeDisabledByGuard) {
        judgeResult = await this.runJudgeEvaluation(
          task,
          candidateResults,
          judgeConfig,
          authorization,
        );
        if (
          judgeResult?.sessionId &&
          judgeResult.model &&
          judgeResult.tokenUsed &&
          judgeResult.tokenUsed > 0
        ) {
          const resolvedModel = parseModelString(judgeResult.model);
          const guardOutcome = await this.recordPaidExecutionUsageEvent({
            taskId,
            projectId: task.projectId,
            sessionId: judgeResult.sessionId,
            authorization,
            providerId: resolvedModel.providerId,
            modelId: resolvedModel.modelId,
            tokenUsed: judgeResult.tokenUsed,
            requestDelta: 1,
            action: "judge_usage_recorded",
            runtimeLedger: {
              executionSource: "parallel-judge",
              entrypointType: "judge-only",
              judgeRequestCountDelta: 1,
              status: judgeResult.status === "failed" ? "failed" : "completed",
              finishedAt: judgeResult.completedAt,
              step: {
                stepType: "judge",
                amplificationSource: "judge",
                status: judgeResult.status === "failed" ? "failed" : "completed",
                finishedAt: judgeResult.completedAt,
              },
            },
            detail: buildPaidExecutionGuardDetail(paidExecutionGuard, {
              judgeAgent: judgeConfig.agent,
              judgeModel: judgeResult.model,
            }),
            riskLevel: "medium",
          });
          if (guardOutcome.tripped) {
            await this.tripPaidExecutionBreaker({
              taskId,
              projectId: task.projectId,
              completedSessionId: judgeResult.sessionId,
              authorization,
              guardState: guardOutcome.guardState,
              reason: guardOutcome.breakerReason || "paid execution breaker tripped",
            });
          }
        }
      }

      const parallelPhaseId = await this.resolveParallelTaskPhaseId(taskId, authorization);
      let awaitingAdoptionPhase: {
        phaseId: string;
        awaitingAdoptionSince: string;
        judgeSessionId?: string;
      } | null = null;

      if (parallelPhaseId) {
        const awaitingAdoptionAt = new Date().toISOString();
        const phaseResult = await cpFetch<TaskPhaseLifecycleRecord>(
          `/api/tasks/${encodeURIComponent(taskId)}/phases`,
          {
            method: "POST",
            authorization,
            body: {
              id: parallelPhaseId,
              phaseKind: "parallel",
              triggerType: "execute",
              status: "awaiting_adoption",
              candidateCount: totalCandidateCount,
              judgeSessionId: judgeResult?.sessionId,
            },
          },
        );

        if (phaseResult.ok) {
          const phaseId = asString(phaseResult.data?.id) ?? parallelPhaseId;
          this.parallelTaskPhaseIds.set(taskId, phaseId);
          awaitingAdoptionPhase = {
            phaseId,
            awaitingAdoptionSince:
              asString(phaseResult.data?.awaitingAdoptionSince) ?? awaitingAdoptionAt,
            judgeSessionId: asString(phaseResult.data?.judgeSessionId) ?? judgeResult?.sessionId,
          };
        } else {
          console.error(`Failed to persist awaiting adoption phase for task ${taskId}`);
        }
      }

      const patchResult = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        authorization,
        body: {
          status: "awaiting_adoption",
          strategy: mergeTaskStrategy(task.strategy, {
            hookExecutions: judgeResult
              ? [
                  {
                    hookId: "judge",
                    trigger: "post-execution",
                    status: judgeResult.status,
                    agent: judgeConfig.agent,
                    model: judgeConfig.model || undefined,
                    prompt: "[judge evaluation]",
                    result: judgeResult.reasoning,
                    sessionId: judgeResult.sessionId,
                    tokenUsed: judgeResult.tokenUsed,
                    completedAt: judgeResult.completedAt,
                  },
                ]
              : undefined,
          }),
        },
      });

      if (!patchResult.ok) {
        return;
      }

      await this.deactivateSettledParallelCandidateSessions({
        taskId,
        authorization,
        phaseId: awaitingAdoptionPhase?.phaseId ?? parallelPhaseId ?? null,
        trackedSessionIds,
      });

      if (awaitingAdoptionPhase) {
        this.emit({
          id: crypto.randomUUID(),
          type: "task.phase.awaiting_adoption",
          ts: new Date().toISOString(),
          taskId,
          projectId,
          phaseId: awaitingAdoptionPhase.phaseId,
          data: {
            phaseId: awaitingAdoptionPhase.phaseId,
            status: "awaiting_adoption",
            candidateCount: totalCandidateCount,
            awaitingAdoptionSince: awaitingAdoptionPhase.awaitingAdoptionSince,
            judgeSessionId: awaitingAdoptionPhase.judgeSessionId,
          },
        });
      }

      await this.emitPipelineStageUpdates({
        taskId,
        projectId,
        authorization,
        reason: "task.phase.awaiting_adoption",
      });
    } catch (error) {
      console.error(`Failed to finalize parallel task ${taskId}:`, error);
    } finally {
      this.judgingTasks.delete(taskId);
      if (!preserveTracking) {
        // Clean up tracking state
        this.parallelTaskSessions.delete(taskId);
        this.parallelTaskPhaseIds.delete(taskId);
        this.parallelCandidateResults.delete(taskId);
        // Clean up session->candidate mappings
        for (const [sid, info] of this.sessionToCandidateMap) {
          if (info.taskId === taskId) this.sessionToCandidateMap.delete(sid);
        }
      }
    }
  }

  /**
   * Run a judge evaluation across multiple candidate results.
   */
  private async runJudgeEvaluation(
    task: CompletedTaskContext,
    candidateResults: Array<[number, { sessionId: string; result?: string }]>,
    judgeConfig: {
      agent: string;
      model: string;
      promptTemplate: string;
      timeoutMs: number;
      selectionStrategy: string;
    },
    _authorization: string,
  ): Promise<JudgeResult> {
    const candidateBlock = candidateResults
      .map(
        ([idx, cr]) =>
          `--- Candidate ${idx}: ---\nStatus: completed\nResult:\n${cr.result ?? "(no result)"}`,
      )
      .join("\n\n");

    const prompt = renderPromptTemplate(judgeConfig.promptTemplate, {
      taskTitle: task.title,
      taskPrompt: task.prompt,
      candidateResults: candidateBlock,
      candidateCount: String(candidateResults.length),
    });

    const hookModel = judgeConfig.model ? parseModelString(judgeConfig.model) : undefined;
    const result = await runDetachedPrompt(`[Judge ${task.id.slice(0, 8)}] ${task.title}`, prompt, {
      agent: judgeConfig.agent,
      model: hookModel,
      taskId: task.id,
      projectId: task.projectId,
      timeoutMs: judgeConfig.timeoutMs,
    });

    if (!result.ok || !result.text) {
      return {
        status: "failed",
        sessionId: result.sessionId,
        model: result.model ? formatModelRoute(result.model) : judgeConfig.model,
        tokenUsed: result.tokenUsed,
        reasoning: result.error || "Judge evaluation failed",
        completedAt: new Date().toISOString(),
      };
    }

    // Try to parse structured JSON from judge response
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*"winnerIndex"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          winnerIndex?: number;
          scores?: number[];
          reasoning?: string;
        };

        let winnerIndex = parsed.winnerIndex;

        // When strategy is highest-score and scores are available, override
        // the judge-picked winner with the candidate that scored highest.
        if (
          judgeConfig.selectionStrategy === "highest-score" &&
          Array.isArray(parsed.scores) &&
          parsed.scores.length > 0
        ) {
          let maxScore = Number.NEGATIVE_INFINITY;
          for (let i = 0; i < parsed.scores.length; i++) {
            const score = parsed.scores[i];
            if (typeof score === "number" && score > maxScore) {
              maxScore = score;
              winnerIndex = candidateResults[i]?.[0] ?? i;
            }
          }
        }

        return {
          status: "completed",
          sessionId: result.sessionId,
          winnerIndex,
          scores: parsed.scores,
          model: result.model ? formatModelRoute(result.model) : judgeConfig.model,
          tokenUsed: result.tokenUsed,
          reasoning: parsed.reasoning || result.text,
          completedAt: new Date().toISOString(),
        };
      }
    } catch {
      // Fall through to unstructured result
    }

    return {
      status: "completed",
      sessionId: result.sessionId,
      winnerIndex: 0,
      model: result.model ? formatModelRoute(result.model) : judgeConfig.model,
      tokenUsed: result.tokenUsed,
      reasoning: result.text,
      completedAt: new Date().toISOString(),
    };
  }

  disconnect(_key: string): void {
    // no-op: pi-mono runtime does not use SSE connections
  }

  disconnectAll(): void {
    // no-op: pi-mono runtime does not use SSE connections
  }
}

export const sseAggregator = new SSEAggregator();
