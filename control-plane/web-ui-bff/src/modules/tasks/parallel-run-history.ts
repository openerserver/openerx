import type { ExecutionPlan } from "../../lib/orchestration-strategy";

export interface ParallelRunHistoryCandidateRecord {
  label: string;
  agent?: string;
  model?: string;
  role?: string;
  status: string;
  sessionId?: string;
  agentRunId?: string;
  result?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ParallelRunHistoryRecord {
  parallelRunId: string;
  templateId?: string;
  startedAt: string;
  finishedAt?: string;
  parentSessionId?: string | null;
  executionSessionId?: string | null;
  winnerCandidateIndex?: number;
  judgeResult?: ExecutionPlan["judgeResult"];
  candidateSessions: ParallelRunHistoryCandidateRecord[];
}

export type ParallelExecutionPlanRecord = ExecutionPlan & { parallelRunId?: string };

interface ParallelRunHistoryTaskLike {
  parallelRunHistory?: string | null;
  sessionId?: string | null;
}

export function parseParallelRunHistory(
  task: Pick<ParallelRunHistoryTaskLike, "parallelRunHistory">,
): ParallelRunHistoryRecord[] {
  if (!task.parallelRunHistory) {
    return [];
  }

  try {
    const parsed = JSON.parse(task.parallelRunHistory) as ParallelRunHistoryRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ensureParallelRunId(plan: ParallelExecutionPlanRecord) {
  if (!plan.parallelRunId || !plan.parallelRunId.trim()) {
    plan.parallelRunId = `prun_${crypto.randomUUID()}`;
  }
  return plan.parallelRunId;
}

export function resolveParallelRunStartedAt(plan: ExecutionPlan) {
  return (
    plan.candidates
      .map((candidate) => candidate.startedAt)
      .find((value): value is string => typeof value === "string" && value.length > 0) ||
    new Date().toISOString()
  );
}

export function resolveParallelRunFinishedAt(plan: ExecutionPlan) {
  const executionFinishedAt = plan.steps.find(
    (step) => step.type === "execution" && typeof step.finishedAt === "string" && step.finishedAt.length > 0,
  )?.finishedAt;
  if (executionFinishedAt) {
    return executionFinishedAt;
  }

  const candidateFinishedAts = plan.candidates
    .map((candidate) => candidate.finishedAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return candidateFinishedAts.at(-1);
}

export function upsertParallelRunHistory(
  task: Pick<ParallelRunHistoryTaskLike, "parallelRunHistory" | "sessionId">,
  plan: ParallelExecutionPlanRecord,
  options?: { parentSessionId?: string | null },
) {
  const nextHistory = parseParallelRunHistory(task);
  const parallelRunId = ensureParallelRunId(plan);
  const nextRecord: ParallelRunHistoryRecord = {
    parallelRunId,
    templateId: plan.templateId,
    startedAt: resolveParallelRunStartedAt(plan),
    finishedAt: resolveParallelRunFinishedAt(plan),
    parentSessionId: options?.parentSessionId ?? task.sessionId ?? null,
    executionSessionId: task.sessionId ?? null,
    winnerCandidateIndex:
      typeof plan.winnerCandidateIndex === "number" ? plan.winnerCandidateIndex : undefined,
    judgeResult: plan.judgeResult,
    candidateSessions: plan.candidates.map((candidate) => ({
      label: candidate.label,
      agent: candidate.agent,
      model: candidate.model,
      role: candidate.role,
      status: candidate.status,
      sessionId: candidate.sessionId,
      agentRunId: candidate.agentRunId,
      result: candidate.result,
      startedAt: candidate.startedAt,
      finishedAt: candidate.finishedAt,
    })),
  };

  const existingIndex = nextHistory.findIndex((record) => record.parallelRunId === parallelRunId);
  if (existingIndex >= 0) {
    nextHistory[existingIndex] = {
      ...nextHistory[existingIndex],
      ...nextRecord,
    };
  } else {
    nextHistory.push(nextRecord);
  }

  nextHistory.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  return JSON.stringify(nextHistory);
}