import { cpFetch } from "../../lib/control-plane-client";
import {
  fetchBranchCompatLineageRecords,
  upsertBranchCompatLineageRecord,
} from "./task-session-compat";
import { syncTaskWorkflowTerminalState } from "./workflow-sync";

type FinalizedTaskStatus = "completed" | "failed" | "cancelled";

interface FinalizableTaskRecord {
  id: string;
  status?: string | null;
  sessionId?: string | null;
  agentRunId?: string | null;
  orchestrationKind?: string | null;
  currentRunId?: string | null;
  startedAt?: string | null;
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

async function deactivateActiveBranchCompatSession(
  authorization: string,
  taskId: string,
  sessionId: string | undefined,
): Promise<void> {
  const lineageResult = await fetchBranchCompatLineageRecords(taskId, authorization);
  if (!lineageResult.ok) {
    return;
  }

  const record =
    lineageResult.records.find(
      (entry) =>
        !entry.archivedAt && entry.isActive && (!sessionId || entry.runtimeSessionId === sessionId),
    ) ?? lineageResult.records.find((entry) => !entry.archivedAt && entry.isActive);

  if (!record) {
    return;
  }

  await upsertBranchCompatLineageRecord(taskId, authorization, {
    runtimeSessionId: record.runtimeSessionId,
    isActive: false,
  });
}

async function loadTaskForFinalization(
  authorization: string,
  taskId: string,
): Promise<FinalizableTaskRecord | null> {
  const taskResult = await cpFetch<FinalizableTaskRecord>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
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

  const resolvedSessionId = input.sessionId ?? task.sessionId ?? undefined;
  const resolvedAgentRunId = input.agentRunId ?? task.agentRunId ?? undefined;

  const patchResult = await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}`, {
    method: "PATCH",
    authorization: input.authorization,
    body: {
      status: input.status,
      sessionId: resolvedSessionId,
      agentRunId: resolvedAgentRunId,
      ...(input.result !== undefined ? { result: input.result } : {}),
    },
  });

  if (!patchResult.ok) {
    return false;
  }

  await deactivateActiveBranchCompatSession(
    input.authorization,
    input.taskId,
    resolvedSessionId,
  );

  if (input.syncWorkflowTerminalState !== false) {
    await syncTaskWorkflowTerminalState({
      authorization: input.authorization,
      taskId: input.taskId,
      status: input.status,
    });
  }
  return true;
}
