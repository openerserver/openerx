import { cpFetch } from "../../lib/control-plane-client";
import { dispatchStageIntervention, type StageInterventionResult } from "./stage-intervention";

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

interface WorkflowTemplateStageRecord {
  id: string;
  stageKey: string;
  orderIndex: number;
  enabled?: boolean;
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

async function fetchWorkflowTemplateStages(authorization: string, templateId: string) {
  const result = await cpFetch<{ data?: WorkflowTemplateStageRecord[] }>(
    `/api/workflow-templates/${encodeURIComponent(templateId)}/stages`,
    { authorization },
  );

  if (!result.ok) {
    return [];
  }

  return (result.data?.data || [])
    .filter((stage) => stage.enabled !== false)
    .sort((left, right) => left.orderIndex - right.orderIndex);
}

function orderedStageKeys(stages: WorkflowTemplateStageRecord[]) {
  return stages
    .map((stage) => stage.stageKey)
    .filter((stageKey): stageKey is string => Boolean(stageKey && stageKey.trim()));
}

function resolveExecutionEntryStage(stageKeys: string[]) {
  if (stageKeys.includes("implement")) {
    return "implement";
  }
  return stageKeys[0] || null;
}

async function advanceStage(
  authorization: string,
  taskId: string,
  fromStage: string,
  options: {
    toStage?: string;
    status: "running" | "blocked" | "waiting-approval" | "failed" | "completed";
    blockingReason?: string;
    approvalState?: "not-required" | "pending" | "approved" | "rejected" | "expired" | "cancelled";
  },
) {
  await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/workflow/advance`, {
    method: "POST",
    authorization,
    body: {
      fromStage,
      ...(options.toStage ? { toStage: options.toStage } : {}),
      status: options.status,
      ...(options.blockingReason ? { blockingReason: options.blockingReason } : {}),
      ...(options.approvalState ? { approvalState: options.approvalState } : {}),
    },
  });
}

async function applyInterventionOutcome(
  authorization: string,
  taskId: string,
  stageKey: string,
  result: StageInterventionResult | void,
) {
  if (result?.disposition === "blocked") {
    await advanceStage(authorization, taskId, stageKey, {
      status: "blocked",
      blockingReason: result.blockingReason || "角色审查阻断当前阶段。",
    });
    return true;
  }

  if (result?.disposition === "waiting-approval") {
    await advanceStage(authorization, taskId, stageKey, {
      status: "waiting-approval",
      approvalState: "pending",
    });
    return true;
  }

  return false;
}

async function progressWorkflowStages(input: {
  authorization: string;
  taskId: string;
  templateId: string;
  stageKeys: string[];
  startIndex: number;
  endIndex: number;
  completeLastStage?: boolean;
}) {
  for (let index = input.startIndex; index <= input.endIndex; index += 1) {
    const stageKey = input.stageKeys[index];
    if (!stageKey) {
      continue;
    }

    const intervention = await dispatchStageIntervention({
      authorization: input.authorization,
      taskId: input.taskId,
      templateId: input.templateId,
      stageKey,
    });

    const stopped = await applyInterventionOutcome(input.authorization, input.taskId, stageKey, intervention);
    if (stopped) {
      return;
    }

    const isLastVisitedStage = index === input.endIndex;
    if (!isLastVisitedStage) {
      await advanceStage(input.authorization, input.taskId, stageKey, {
        toStage: input.stageKeys[index + 1] as string,
        status: "completed",
      });
      continue;
    }

    if (input.completeLastStage) {
      await advanceStage(input.authorization, input.taskId, stageKey, {
        status: "completed",
      });
    }
  }
}

export async function ensureTaskWorkflowStarted(
  input: EnsureTaskWorkflowStartedInput,
): Promise<void> {
  if (!input.templateId) {
    return;
  }

  const templateStages = await fetchWorkflowTemplateStages(input.authorization, input.templateId);
  const stageKeys = orderedStageKeys(templateStages);
  if (stageKeys.length === 0) {
    return;
  }

  const initialStage = stageKeys[0] as string;
  const executionStage = resolveExecutionEntryStage(stageKeys);
  if (!executionStage) {
    return;
  }

  let workflow = await fetchTaskWorkflow(input);
  if (!workflow) {
    return;
  }

  if (!workflow.workflowRun) {
    await cpFetch(`/api/tasks/${encodeURIComponent(input.taskId)}/workflow/initialize`, {
      method: "POST",
      authorization: input.authorization,
      body: {
        templateId: input.templateId,
        currentStage: initialStage,
      },
    });
    workflow = await fetchTaskWorkflow(input);
    if (!workflow?.workflowRun) {
      return;
    }
  }

  if (workflow.workflowRun.currentStage === executionStage) {
    await progressWorkflowStages({
      authorization: input.authorization,
      taskId: input.taskId,
      templateId: input.templateId,
      stageKeys,
      startIndex: Math.max(0, stageKeys.indexOf(executionStage)),
      endIndex: Math.max(0, stageKeys.indexOf(executionStage)),
    });
    return;
  }

  const executionStageStatus = findStageStatus(workflow.stages, executionStage);
  if (executionStageStatus === "running") {
    await progressWorkflowStages({
      authorization: input.authorization,
      taskId: input.taskId,
      templateId: input.templateId,
      stageKeys,
      startIndex: Math.max(0, stageKeys.indexOf(executionStage)),
      endIndex: Math.max(0, stageKeys.indexOf(executionStage)),
    });
    return;
  }

  const currentIndex = Math.max(0, stageKeys.indexOf(workflow.workflowRun.currentStage || initialStage));
  const targetIndex = Math.max(0, stageKeys.indexOf(executionStage));

  await progressWorkflowStages({
    authorization: input.authorization,
    taskId: input.taskId,
    templateId: input.templateId,
    stageKeys,
    startIndex: currentIndex,
    endIndex: targetIndex,
  });
}

export async function syncTaskWorkflowTerminalState(
  input: SyncTaskWorkflowTerminalStateInput,
): Promise<void> {
  const workflow = await fetchTaskWorkflow(input);
  if (!workflow?.workflowRun) {
    return;
  }

  const templateId = workflow.workflowRun.templateId;
  if (!templateId) {
    return;
  }

  const templateStages = await fetchWorkflowTemplateStages(input.authorization, templateId);
  const stageKeys = orderedStageKeys(templateStages);
  if (stageKeys.length === 0) {
    return;
  }

  const currentStage = workflow.workflowRun.currentStage || (stageKeys[0] as string);
  const currentStageStatus = findStageStatus(workflow.stages, currentStage);
  const currentIndex = Math.max(0, stageKeys.indexOf(currentStage));

  if (input.status === "completed") {
    if (workflow.workflowRun.status === "completed" && currentStageStatus === "completed") {
      return;
    }

    if (currentIndex >= 0) {
      await progressWorkflowStages({
        authorization: input.authorization,
        taskId: input.taskId,
        templateId,
        stageKeys,
        startIndex: currentIndex,
        endIndex: stageKeys.length - 1,
        completeLastStage: true,
      });
    }
    return;
  }

  if (
    workflow.workflowRun.status === input.status
    && (currentStageStatus === "failed" || currentStageStatus === "completed")
  ) {
    return;
  }

  await advanceStage(input.authorization, input.taskId, currentStage, {
    status: input.status === "cancelled" ? "failed" : input.status,
    ...(input.status === "cancelled"
      ? { blockingReason: "Task cancelled before workflow completion." }
      : {}),
  });
}