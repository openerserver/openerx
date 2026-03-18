import { cpFetch, createInternalAuthorization } from "../../lib/control-plane-client";
import { resolveModelRoute } from "../../lib/opencode-config";
import {
  type ExecutionCandidate,
  type ExecutionPlan,
  type JudgeResult,
  mergeTaskStrategy,
  parseTaskStrategy,
  readOrchestrationStrategy,
  renderPromptTemplate,
} from "../../lib/orchestration-strategy";
import type { PaidExecutionGuardState } from "../../lib/paid-execution-guard";
import type { RealtimeEvent, RealtimeEventType } from "../../types/events";
import {
  extractAssistantResultFromMessages,
  findAgentRunBySessionId,
  getSessionMessages,
  runDetachedPrompt,
  terminateAgent,
  updateAgentRunStatus,
} from "../agent-control/opencode-adapter";
import {
  patchAgentRunRecord,
  recordAgentAudit,
  recordModelUsage,
} from "../agent-control/run-persistence";
import { collectChangesFromSession } from "../code-changes/change-collector";
import { executeLifecycleHooks } from "../hooks/lifecycle-hooks";
import { finalizeTaskState } from "../tasks/finalize";
import { observeGraphWorkspaceDir, onGraphToolExecuted } from "./dag-sync";
import { buildPipelineStageUpdatedEvents } from "./pipeline-events";

// Subscribes to OpenCode Runtime SSE events and transforms them into
// standard RealtimeEvent format for WebSocket broadcast.

interface SSEConnection {
  url: string;
  abortController: AbortController | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

type EventHandler = (event: RealtimeEvent) => void;

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";

interface CompletedTaskContext {
  id: string;
  title: string;
  prompt: string;
  projectId: string;
  sessionId?: string | null;
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

function parseModelString(raw: string): { providerId: string; modelId: string } {
  return resolveModelRoute(raw);
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
  private connections = new Map<string, SSEConnection>();
  private handlers = new Set<EventHandler>();
  private reconnectDelay = 1000;
  private finalizingAgentRuns = new Set<string>();
  private finalizedAgentRuns = new Set<string>();

  // ── Parallel execution tracking ─────────────────────────────────
  // Maps taskId → sessionIds of all candidates
  private parallelTaskSessions = new Map<string, Set<string>>();
  // Maps sessionId → { taskId, candidateIndex }
  private sessionToCandidateMap = new Map<string, { taskId: string; candidateIndex: number }>();
  // Maps taskId → completed candidate sessions with results
  private parallelCandidateResults = new Map<
    string,
    Map<number, { sessionId: string; result?: string }>
  >();
  private judgingTasks = new Set<string>();
  private paidExecutionRuntime = new Map<string, { tripped: boolean; reason?: string }>();

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
      `/api/tasks/${encodeURIComponent(args.taskId)}`,
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
      | "task.failed"
      | "task.hooks.updated"
      | "task.node.updated"
      | "agent.completed";
  }): Promise<void> {
    const events = await buildPipelineStageUpdatedEvents(args);
    for (const event of events) {
      this.emit(event);
    }
  }

  /** Register parallel candidates for aggregated tracking. */
  registerParallelTask(taskId: string, candidates: ExecutionCandidate[]): void {
    const sessionIds = new Set<string>();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c?.sessionId) {
        sessionIds.add(c.sessionId);
        this.sessionToCandidateMap.set(c.sessionId, { taskId, candidateIndex: i });
      }
    }
    this.parallelTaskSessions.set(taskId, sessionIds);
    this.parallelCandidateResults.set(taskId, new Map());
  }

  private async triggerPostExecutionHooks(
    taskId: string,
    resultText: string | undefined,
    authorization: string,
  ): Promise<void> {
    const strategyConfig = readOrchestrationStrategy();

    const taskResult = await cpFetch<CompletedTaskContext>(
      `/api/tasks/${encodeURIComponent(taskId)}`,
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
  }

  /**
   * Subscribe to the global OpenCode SSE event stream.
   */
  async subscribeGlobal(): Promise<void> {
    const url = `${OPENCODE_URL}/global/event`;
    await this.connect("global", url);
  }

  /**
   * Subscribe to a specific session's SSE stream.
   */
  async subscribeSession(_sessionId: string): Promise<void> {
    await this.subscribeGlobal();
  }

  private async connect(key: string, url: string): Promise<void> {
    if (this.connections.has(key)) return;

    const conn: SSEConnection = {
      url,
      abortController: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 10,
    };

    this.connections.set(key, conn);
    await this.startSSE(key, conn);
  }

  private async startSSE(key: string, conn: SSEConnection): Promise<void> {
    try {
      conn.abortController = new AbortController();
      const response = await fetch(conn.url, {
        headers: { Accept: "text/event-stream" },
        signal: conn.abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "message";
      const dataLines: string[] = [];

      conn.reconnectAttempts = 0;

      const read = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const rawLine of lines) {
              const line = rawLine.replace(/\r$/, "");
              if (line.startsWith("event:")) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trim());
              } else if (line === "" && dataLines.length > 0) {
                // End of event
                this.handleSSEEvent(eventType, dataLines.join("\n"));
                eventType = "message";
                dataLines.length = 0;
              }
            }
          }
        } catch {
          // Connection lost, try reconnect
          this.scheduleReconnect(key, conn);
        }
      };

      read();
    } catch {
      this.scheduleReconnect(key, conn);
    }
  }

  private scheduleReconnect(key: string, conn: SSEConnection): void {
    if (conn.reconnectAttempts >= conn.maxReconnectAttempts) {
      console.error(`SSE ${key}: max reconnect attempts reached`);
      this.connections.delete(key);
      return;
    }

    conn.reconnectAttempts++;
    const delay = this.reconnectDelay * 2 ** (conn.reconnectAttempts - 1);
    console.log(`SSE ${key}: reconnecting in ${delay}ms (attempt ${conn.reconnectAttempts})`);

    setTimeout(() => this.startSSE(key, conn), delay);
  }

  private async handleSSEEvent(type: string, data: string): Promise<void> {
    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      await this.processParsedEvent(type, parsed as Record<string, unknown>);
    } catch {
      // Malformed event, skip
    }
  }

  async ingestParsedEvent(type: string, parsed: Record<string, unknown>): Promise<void> {
    await this.processParsedEvent(type, parsed);
  }

  private async processParsedEvent(type: string, parsed: Record<string, unknown>): Promise<void> {
    const workspaceDirectory =
      typeof parsed.directory === "string" ? String(parsed.directory || "") : "";
    observeGraphWorkspaceDir(workspaceDirectory);
    const payload =
      typeof parsed.payload === "object" && parsed.payload
        ? (parsed.payload as Record<string, unknown>)
        : null;

    const event = payload
      ? this.transformEvent(String(payload.type || type), {
          ...parsed,
          ...(typeof payload.properties === "object" && payload.properties
            ? payload.properties
            : {}),
          rawType: payload.type,
        })
      : this.transformEvent(type, parsed);

    if (event) {
      this.emit(event);
      if (event.type === "session.error") {
        void this.maybeEmitAuthError(event);
        void this.maybeFinalizeFailure(event);
      }
      void this.maybeFinalizeRun(event);
    }

    await this.maybeSyncDag(type, payload, parsed, workspaceDirectory);
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

    return {
      id: crypto.randomUUID(),
      type: mappedType,
      ts: new Date().toISOString(),
      sessionId,
      taskId: run?.taskId,
      projectId: run?.projectId,
      agentRunId: run?.agentRunId,
      data,
    };
  }

  private emit(event: RealtimeEvent): void {
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
        run.lastPromptAt,
      );

      if (!assistantResult.completed) {
        return;
      }

      const resultText = assistantResult.text;
      const tokenUsed = assistantResult.tokenUsed;

      // Check if this is a parallel candidate completion
      const candidateInfo = this.sessionToCandidateMap.get(event.sessionId);
      const parallelSessions = candidateInfo
        ? this.parallelTaskSessions.get(candidateInfo.taskId)
        : undefined;
      if (candidateInfo) {
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
              finishedAt: new Date().toISOString(),
            }),
            recordAgentAudit({
              projectId: event.projectId,
              taskId: event.taskId,
              sessionId: event.sessionId,
              agentRunId: event.agentRunId,
              eventType: "agent",
              action: "completed",
              detail: {
                candidateIndex: candidateInfo.candidateIndex,
                executionMode: "parallel",
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
      const taskUpdate = await finalizeTaskState({
        authorization,
        taskId: event.taskId,
        status: "completed",
        sessionId: event.sessionId,
        agentRunId: event.agentRunId,
        result: resultText,
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
      collectChangesFromSession({
        taskId: event.taskId,
        sessionId: event.sessionId,
        agentRunId: event.agentRunId,
        authorization,
      })
        .catch((err) => {
          console.error(`Change collection failed for task ${event.taskId}:`, err);
        })
        .finally(() => {
          if (!completedTaskId) {
            return;
          }
          this.triggerPostExecutionHooks(completedTaskId, resultText, authorization).catch(
            (err) => {
              console.error(`Post-execution hooks failed for task ${completedTaskId}:`, err);
            },
          );
        });
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
    const assistantResult = await this.getLatestAssistantResult(event.sessionId, 1000);
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
      `/api/tasks/${encodeURIComponent(taskId)}`,
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
    minCompletedAt?: number,
  ): Promise<{ text?: string; completed: boolean; tokenUsed: number }> {
    const deadline = Date.now() + timeoutMs;
    let fallbackText: string | undefined;
    let fallbackTokenUsed = 0;

    while (Date.now() < deadline) {
      const messagesResult = await getSessionMessages(sessionId);
      if (!messagesResult.ok || !Array.isArray(messagesResult.data)) {
        return { text: fallbackText, completed: false, tokenUsed: fallbackTokenUsed };
      }

      const assistantResult = extractAssistantResultFromMessages(messagesResult.data, {
        minCompletedAt,
      });
      if (assistantResult.text) {
        fallbackText = assistantResult.text;
      }
      if (assistantResult.tokenUsed > 0) {
        fallbackTokenUsed = assistantResult.tokenUsed;
      }

      if (assistantResult.completed) {
        return assistantResult;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return { text: fallbackText, completed: false, tokenUsed: fallbackTokenUsed };
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

  private async maybeSyncDag(
    type: string,
    payload: Record<string, unknown> | null,
    parsed: Record<string, unknown>,
    workspaceDirectory?: string,
  ): Promise<void> {
    const eventType = payload ? String(payload.type || type) : type;
    if (eventType !== "tool.execute.after") return;

    const props =
      (typeof payload?.properties === "object" && payload.properties
        ? (payload.properties as Record<string, unknown>)
        : parsed) || {};
    const toolName = String(props.toolName || props.name || "");
    if (!toolName.startsWith("task_graph_")) return;

    const toolResult = String(props.result || props.output || "{}");
    const sessionId = this.extractSessionId(eventType, payload ?? parsed);
    await onGraphToolExecuted(toolName, toolResult, workspaceDirectory, sessionId);
    if (!sessionId) return;

    const run = findAgentRunBySessionId(sessionId);
    if (!run?.taskId) return;

    const authorization = await createInternalAuthorization();
    this.emit({
      id: crypto.randomUUID(),
      type: "task.node.updated",
      ts: new Date().toISOString(),
      sessionId,
      taskId: run.taskId,
      projectId: run.projectId,
      agentRunId: run.agentRunId,
      data: { toolName },
    });
    await this.emitPipelineStageUpdates({
      taskId: run.taskId,
      sessionId,
      projectId: run.projectId,
      agentRunId: run.agentRunId,
      authorization,
      reason: "task.node.updated",
    });
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
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

    try {
      const results = this.parallelCandidateResults.get(taskId);
      const candidateResults = results
        ? Array.from(results.entries()).sort(([a], [b]) => a - b)
        : [];

      // Fetch the task to get its execution plan
      const taskResult = await cpFetch<CompletedTaskContext & { executionPlan?: string }>(
        `/api/tasks/${encodeURIComponent(taskId)}`,
        { authorization },
      );
      if (!taskResult.ok) return;

      const task = taskResult.data;
      const taskStrategy = parseTaskStrategy(task.strategy);
      const paidExecutionGuard = taskStrategy.paidExecutionGuard as
        | PaidExecutionGuardState
        | undefined;
      let plan: ExecutionPlan | undefined;
      if (task.executionPlan) {
        try {
          plan = JSON.parse(task.executionPlan as string) as ExecutionPlan;
        } catch {
          /* ignore */
        }
      }

      // Update each candidate's status in the execution plan
      if (plan) {
        for (const [idx, cr] of candidateResults) {
          if (plan.candidates[idx]) {
            plan.candidates[idx].status = "completed";
            plan.candidates[idx].result = cr.result;
            plan.candidates[idx].finishedAt = new Date().toISOString();
          }
        }
      }

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
        if (plan && judgeResult) {
          plan.judgeResult = judgeResult;
          plan.winnerCandidateIndex = judgeResult.winnerIndex;
        }
      } else if (candidateResults.length > 0) {
        // No judge: pick the first completed candidate as the winner
        if (plan) {
          plan.winnerCandidateIndex = candidateResults[0]?.[0] ?? 0;
        }
      }

      // Use winner's result as the task result
      const winnerIdx = plan?.winnerCandidateIndex ?? candidateResults[0]?.[0] ?? 0;
      const winnerResult = results?.get(winnerIdx)?.result;

      // Final PATCH to complete the task
      await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        authorization,
        body: {
          status: "completed",
          executionPlan: plan ? JSON.stringify(plan) : undefined,
          ...(winnerResult ? { result: winnerResult } : {}),
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

      this.emit({
        id: crypto.randomUUID(),
        type: "task.completed",
        ts: new Date().toISOString(),
        taskId,
        projectId,
        data: {
          status: "completed",
          executionMode: "parallel",
          winnerCandidateIndex: winnerIdx,
          candidateCount: candidateResults.length,
          hasJudge: !!judgeResult,
          ...(winnerResult ? { result: winnerResult } : {}),
        },
      });

      await this.emitPipelineStageUpdates({
        taskId,
        projectId,
        authorization,
        reason: "task.completed",
      });

      // Run post-execution hooks after parallel completion
      this.triggerPostExecutionHooks(taskId, winnerResult, authorization).catch((err) => {
        console.error(`Post-execution hooks failed for parallel task ${taskId}:`, err);
      });
    } catch (error) {
      console.error(`Failed to finalize parallel task ${taskId}:`, error);
    } finally {
      // Clean up tracking state
      this.parallelTaskSessions.delete(taskId);
      this.parallelCandidateResults.delete(taskId);
      this.judgingTasks.delete(taskId);
      // Clean up session->candidate mappings
      for (const [sid, info] of this.sessionToCandidateMap) {
        if (info.taskId === taskId) this.sessionToCandidateMap.delete(sid);
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
        model: result.model
          ? `${result.model.providerId}:${result.model.modelId}`
          : judgeConfig.model,
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
          model: result.model
            ? `${result.model.providerId}:${result.model.modelId}`
            : judgeConfig.model,
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
      model: result.model
        ? `${result.model.providerId}:${result.model.modelId}`
        : judgeConfig.model,
      tokenUsed: result.tokenUsed,
      reasoning: result.text,
      completedAt: new Date().toISOString(),
    };
  }

  disconnect(key: string): void {
    const conn = this.connections.get(key);
    if (conn) {
      conn.abortController?.abort();
      this.connections.delete(key);
    }
  }

  disconnectAll(): void {
    for (const [key] of this.connections) {
      this.disconnect(key);
    }
  }
}

export const sseAggregator = new SSEAggregator();
