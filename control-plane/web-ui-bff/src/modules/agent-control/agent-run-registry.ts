import type { AgentRunStatus } from "../../types/events";
import type { RuntimeModelRef } from "./runtime-provider-types";

export interface AgentRunRecord {
  subSessionId: string;
  status: AgentRunStatus;
  taskId: string;
  projectId: string;
  model?: RuntimeModelRef;
  candidateIndex?: number;
  startedAt: number;
  finishedAt?: string;
  pausedAt?: number;
  lastPromptAt?: number;
}

const agentRunRegistry = new Map<string, AgentRunRecord>();

function parseStartedAt(value?: string | number | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function setFinishedAt(run: AgentRunRecord, status: AgentRunStatus): void {
  if (status === "completed" || status === "failed" || status === "stopped") {
    run.finishedAt = new Date().toISOString();
    return;
  }

  run.finishedAt = undefined;
}

export function registerAgentRun(
  agentRunId: string,
  subSessionId: string,
  taskId: string,
  projectId: string,
  model?: RuntimeModelRef,
  candidateIndex?: number,
): void {
  agentRunRegistry.set(agentRunId, {
    subSessionId,
    status: "running",
    taskId,
    projectId,
    model,
    candidateIndex,
    startedAt: Date.now(),
  });
}

export function recoverAgentRun(
  agentRunId: string,
  subSessionId: string,
  taskId: string,
  projectId: string,
  startedAt?: string | number | null,
  model?: RuntimeModelRef,
  candidateIndex?: number,
): void {
  agentRunRegistry.set(agentRunId, {
    subSessionId,
    status: "running",
    taskId,
    projectId,
    model,
    candidateIndex,
    startedAt: parseStartedAt(startedAt),
  });
}

export function getAgentRunState(agentRunId: string) {
  return agentRunRegistry.get(agentRunId);
}

export function markAgentRunPromptSent(agentRunId: string, at = Date.now()) {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) {
    return undefined;
  }

  run.lastPromptAt = at;
  return run;
}

export function setAgentRunPausedAt(agentRunId: string, pausedAt?: number) {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) {
    return undefined;
  }

  run.pausedAt = pausedAt;
  return run;
}

export function updateAgentRunStatus(agentRunId: string, status: AgentRunStatus) {
  const run = agentRunRegistry.get(agentRunId);
  if (!run) {
    return undefined;
  }

  run.status = status;
  setFinishedAt(run, status);

  return {
    agentRunId,
    ...run,
  };
}

export function getAgentRun(agentRunId: string) {
  const run = agentRunRegistry.get(agentRunId);
  return run
    ? {
        agentRunId,
        ...run,
      }
    : undefined;
}

export function findAgentRunBySessionId(sessionId: string) {
  for (const [agentRunId, run] of agentRunRegistry.entries()) {
    if (run.subSessionId === sessionId) {
      return { agentRunId, ...run };
    }
  }

  return undefined;
}

export function listAgentRuns() {
  return Array.from(agentRunRegistry.entries()).map(([agentRunId, run]) => ({
    agentRunId,
    ...run,
  }));
}

export function ensureAgentRunForSession(
  sessionId: string,
  taskId: string,
  projectId: string,
  model?: RuntimeModelRef,
  agentRunId?: string,
) {
  const existing = findAgentRunBySessionId(sessionId);

  if (existing) {
    const run = agentRunRegistry.get(existing.agentRunId);
    if (run) {
      run.status = "running";
      run.taskId = taskId;
      run.projectId = projectId;
      run.startedAt = Date.now();
      run.pausedAt = undefined;
      run.finishedAt = undefined;
      if (model) {
        run.model = model;
      }
      markAgentRunPromptSent(existing.agentRunId);
    }

    return existing.agentRunId;
  }

  const resolvedAgentRunId = agentRunId || crypto.randomUUID();
  registerAgentRun(resolvedAgentRunId, sessionId, taskId, projectId, model);
  markAgentRunPromptSent(resolvedAgentRunId);
  return resolvedAgentRunId;
}
