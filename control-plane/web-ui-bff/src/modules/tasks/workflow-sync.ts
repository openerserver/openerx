import { cpFetch } from "../../lib/control-plane-client";

interface WorkflowRunRecord {
  id: string;
  templateId: string | null;
  currentStage: string | null;
  status: string | null;
}

interface WorkflowStageRecord {
  id: string;
  stageKey: string;
  status: string;
}

interface TaskWorkflowPayload {
  data?: {
    workflowRun?: WorkflowRunRecord | null;
    stages?: WorkflowStageRecord[];
  };
}

interface TaskWorkflowContext {
  authorization: string;
  taskId: string;
}

interface EnsureTaskWorkflowStartedInput extends TaskWorkflowContext {
  templateId?: string | null;
}

interface SyncTaskWorkflowTerminalStateInput extends TaskWorkflowContext {
  status: "completed" | "failed" | "cancelled";
}

async function fetchTaskWorkflow(context: TaskWorkflowContext) {
  const result = await cpFetch<TaskWorkflowPayload>(
    `/api/tasks/${encodeURIComponent(context.taskId)}/workflow`,
    { authorization: context.authorization },
  );

  if (!result.ok) {
    return null;
  }

  return {
    workflowRun: result.data?.data?.workflowRun ?? null,
    stages: Array.isArray(result.data?.data?.stages) ? result.data.data.stages : [],
  };
}

function findStageStatus(stages: WorkflowStageRecord[], stageKey: string) {
  return stages.find((stage) => stage.stageKey === stageKey)?.status;
}

export async function ensureTaskWorkflowStarted(
  input: EnsureTaskWorkflowStartedInput,
): Promise<void> {
  if (!input.templateId) {
    return;
  }

  const workflow = await fetchTaskWorkflow(input);
  if (!workflow) {
    return;
  }

  if (!workflow.workflowRun) {
    await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}/workflow/initialize`, {
      method: "POST",
      authorization: input.authorization,
      body: {
        templateId: input.templateId,
        currentStage: "implement",
      },
    });
    return;
  }

  if (workflow.workflowRun.currentStage === "implement") {
    return;
  }

  const implementStageStatus = findStageStatus(workflow.stages, "implement");
  if (!implementStageStatus || implementStageStatus === "running") {
    return;
  }

  await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}/workflow/advance`, {
    method: "POST",
    authorization: input.authorization,
    body: {
      fromStage: workflow.workflowRun.currentStage || "implement",
      toStage: "implement",
      status: "completed",
    },
  });
}

export async function syncTaskWorkflowTerminalState(
  input: SyncTaskWorkflowTerminalStateInput,
): Promise<void> {
  const workflow = await fetchTaskWorkflow(input);
  if (!workflow?.workflowRun) {
    return;
  }

  const currentStage = workflow.workflowRun.currentStage || "implement";
  const currentStageStatus = findStageStatus(workflow.stages, currentStage);
  const hasVerifyStage = Boolean(findStageStatus(workflow.stages, "verify"));

  if (input.status === "completed") {
    if (currentStage === "verify" || workflow.workflowRun.status === "completed") {
      return;
    }

    await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}/workflow/advance`, {
      method: "POST",
      authorization: input.authorization,
      body: {
        fromStage: currentStage,
        ...(hasVerifyStage ? { toStage: "verify" } : {}),
        status: hasVerifyStage ? "running" : "completed",
      },
    });
    return;
  }

  if (
    workflow.workflowRun.status === input.status
    && (currentStageStatus === "failed" || currentStageStatus === "completed")
  ) {
    return;
  }

  await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}/workflow/advance`, {
    method: "POST",
    authorization: input.authorization,
    body: {
      fromStage: currentStage,
      status: input.status === "cancelled" ? "failed" : input.status,
      ...(input.status === "cancelled"
        ? { blockingReason: "Task cancelled before workflow completion." }
        : {}),
    },
  });
}