import { cpFetch } from "../../lib/control-plane-client";
import type { ExecutionPlan } from "../../lib/orchestration-strategy";
import { syncTaskWorkflowTerminalState } from "./workflow-sync";

type FinalizedTaskStatus = "completed" | "failed" | "cancelled";

interface FinalizableTaskRecord {
  id: string;
  status?: string | null;
  sessionId?: string | null;
  agentRunId?: string | null;
  executionPlan?: string | null;
  startedAt?: string | null;
}

interface TaskSessionRecord {
  runtimeSessionId: string;
  isActive: boolean;
  archivedAt?: string | null;
}

interface FinalizeTaskStateInput {
  authorization: string;
  taskId: string;
  status: FinalizedTaskStatus;
  sessionId?: string;
  agentRunId?: string;
  result?: string;
  task?: FinalizableTaskRecord;
  syncWorkflowTerminalState?: boolean;
}

function parseExecutionPlan(raw: FinalizableTaskRecord["executionPlan"]): ExecutionPlan | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ExecutionPlan;
    if (!parsed || !Array.isArray(parsed.candidates) || !Array.isArray(parsed.steps)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function toCandidateStatus(status: FinalizedTaskStatus): "completed" | "failed" {
  return status === "completed" ? "completed" : "failed";
}

function findExecutionPlanCandidate(
  plan: ExecutionPlan,
  sessionId: string | undefined,
  agentRunId: string | undefined,
) {
  return (
    plan.candidates.find(
      (entry) =>
        (sessionId && entry.sessionId === sessionId) ||
        (agentRunId && entry.agentRunId === agentRunId),
    ) || (plan.candidates.length === 1 ? plan.candidates[0] : undefined)
  );
}

function updateExecutionPlanCandidate(
  candidate: ExecutionPlan["candidates"][number],
  task: FinalizableTaskRecord,
  candidateStatus: "completed" | "failed",
  finishedAt: string,
  result: string | undefined,
  sessionId: string | undefined,
  agentRunId: string | undefined,
) {
  let changed = false;

  if (sessionId && candidate.sessionId !== sessionId) {
    candidate.sessionId = sessionId;
    changed = true;
  }
  if (agentRunId && candidate.agentRunId !== agentRunId) {
    candidate.agentRunId = agentRunId;
    changed = true;
  }
  if (candidate.status !== candidateStatus) {
    candidate.status = candidateStatus;
    changed = true;
  }
  if (!candidate.startedAt && task.startedAt) {
    candidate.startedAt = task.startedAt;
    changed = true;
  }
  if (candidate.finishedAt !== finishedAt) {
    candidate.finishedAt = finishedAt;
    changed = true;
  }
  if (result !== undefined && candidate.result !== result) {
    candidate.result = result;
    changed = true;
  }

  return changed;
}

function updateSingleExecutionStepStatus(
  plan: ExecutionPlan,
  candidateStatus: "completed" | "failed",
) {
  const executionSteps = plan.steps.filter((step) => step.type === "execution");
  if (executionSteps.length !== 1 || !executionSteps[0]) {
    return false;
  }
  if (executionSteps[0].status === candidateStatus) {
    return false;
  }

  executionSteps[0].status = candidateStatus;
  return true;
}

function updateExecutionPlan(
  plan: ExecutionPlan,
  task: FinalizableTaskRecord,
  status: FinalizedTaskStatus,
  finishedAt: string,
  result: string | undefined,
  sessionId: string | undefined,
  agentRunId: string | undefined,
): string | undefined {
  const candidateStatus = toCandidateStatus(status);
  const candidate = findExecutionPlanCandidate(plan, sessionId, agentRunId);

  let changed = false;

  if (candidate) {
    changed =
      updateExecutionPlanCandidate(
        candidate,
        task,
        candidateStatus,
        finishedAt,
        result,
        sessionId,
        agentRunId,
      ) || changed;
  }

  changed = updateSingleExecutionStepStatus(plan, candidateStatus) || changed;

  return changed ? JSON.stringify(plan) : undefined;
}

async function deactivateTaskSession(
  authorization: string,
  taskId: string,
  sessionId: string | undefined,
): Promise<void> {
  const lineageResult = await cpFetch<{ data?: TaskSessionRecord[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/task-sessions`,
    { authorization },
  );

  if (!lineageResult.ok || !Array.isArray(lineageResult.data?.data)) {
    return;
  }

  const record =
    lineageResult.data.data.find(
      (entry) =>
        !entry.archivedAt && entry.isActive && (!sessionId || entry.runtimeSessionId === sessionId),
    ) ?? lineageResult.data.data.find((entry) => !entry.archivedAt && entry.isActive);

  if (!record) {
    return;
  }

  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/task-sessions`, {
    method: "POST",
    authorization,
    body: {
      runtimeSessionId: record.runtimeSessionId,
      isActive: false,
    },
  });
}

async function loadTaskForFinalization(
  authorization: string,
  taskId: string,
): Promise<FinalizableTaskRecord | null> {
  const taskResult = await cpFetch<FinalizableTaskRecord>(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    {
      authorization,
    },
  );

  if (!taskResult.ok || !taskResult.data) {
    return null;
  }

  return taskResult.data;
}

export async function finalizeTaskState(input: FinalizeTaskStateInput): Promise<boolean> {
  const task = input.task ?? (await loadTaskForFinalization(input.authorization, input.taskId));
  if (!task) {
    return false;
  }

  const finishedAt = new Date().toISOString();
  const resolvedSessionId = input.sessionId ?? task.sessionId ?? undefined;
  const resolvedAgentRunId = input.agentRunId ?? task.agentRunId ?? undefined;
  const executionPlan = parseExecutionPlan(task.executionPlan);
  const serializedPlan = executionPlan
    ? updateExecutionPlan(
        executionPlan,
        task,
        input.status,
        finishedAt,
        input.result,
        resolvedSessionId,
        resolvedAgentRunId,
      )
    : undefined;

  const patchResult = await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    method: "PATCH",
    authorization: input.authorization,
    body: {
      status: input.status,
      sessionId: resolvedSessionId,
      agentRunId: resolvedAgentRunId,
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(serializedPlan ? { executionPlan: serializedPlan } : {}),
    },
  });

  if (!patchResult.ok) {
    return false;
  }

  await deactivateTaskSession(input.authorization, input.taskId, resolvedSessionId);

  if (input.syncWorkflowTerminalState !== false) {
    await syncTaskWorkflowTerminalState({
      authorization: input.authorization,
      taskId: input.taskId,
      status: input.status,
    });
  }
  return true;
}
