import { readOrchestrationStrategy } from "../../lib/orchestration-strategy";
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
  stageTemplateStrategyJson?: {
    onBlockedTemplateId?: string;
    onWaitingApprovalTemplateId?: string;
    note?: string;
  } | null;
}

interface TaskRecord {
  id: string;
  projectId: string;
  title?: string | null;
  strategy?: string | null;
}

interface ProjectRecord {
  id: string;
  settings?: {
    preferredTemplateId?: string | null;
    allowBossAutoTemplateSwitch?: boolean;
    workflowTemplateId?: string | null;
  } | null;
}

interface OperatingModeSelectionRecord {
  selectedTemplateId?: string | null;
  scenarioKey?: string;
}

type TemplateSelectionTrigger = "startup" | "stage-blocked" | "stage-waiting-approval";

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

interface BossDecisionPayload {
  decisionType: "advance-stage" | "hold-stage" | "request-approval" | "escalate-human";
  reason: string;
  stageKey: string;
  metadata: Record<string, unknown>;
}

interface EscalationPayload {
  reason: string;
  status: "open";
  stageKey: string;
  requestedBy: "boss-agent";
  metadata: Record<string, unknown>;
}

interface EnsureTaskWorkflowStartedInput extends TaskWorkflowContext {
  templateId?: string | null;
}

interface SyncTaskWorkflowTerminalStateInput extends TaskWorkflowContext {
  status: "completed" | "failed" | "cancelled";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTaskStrategy(strategy: unknown) {
  if (typeof strategy !== "string" || !strategy.trim()) {
    return {} as Record<string, unknown>;
  }

  try {
    return asRecord(JSON.parse(strategy)) || {};
  } catch {
    return {} as Record<string, unknown>;
  }
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

async function fetchTaskRecord(authorization: string, taskId: string) {
  const result = await cpFetch<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    authorization,
  });

  return result.ok ? result.data : null;
}

async function fetchProjectRecord(authorization: string, projectId: string) {
  const result = await cpFetch<ProjectRecord>(`/api/projects/${encodeURIComponent(projectId)}`, {
    authorization,
  });

  return result.ok ? result.data : null;
}

async function fetchTaskOperatingMode(authorization: string, taskId: string) {
  const result = await cpFetch<{ data?: OperatingModeSelectionRecord | null }>(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/mode`,
    { authorization },
  );

  return result.ok ? (result.data?.data || null) : null;
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

function buildBossDecisionPayload(stageKey: string, result: StageInterventionResult): BossDecisionPayload | null {
  if (!result.decision) {
    return null;
  }

  const reason = result.reason?.trim() || result.blockingReason?.trim() || "阶段审查完成。";
  const metadata: Record<string, unknown> = {
    source: "stage-intervention",
    disposition: result.disposition,
    finalDecision: result.decision,
  };

  if (result.disposition === "blocked") {
    return {
      decisionType: "hold-stage",
      reason,
      stageKey,
      metadata,
    };
  }

  if (result.disposition === "waiting-approval") {
    return {
      decisionType: result.decision === "human-review" ? "escalate-human" : "request-approval",
      reason,
      stageKey,
      metadata,
    };
  }

  return {
    decisionType: "advance-stage",
    reason,
    stageKey,
    metadata,
  };
}

function buildEscalationPayload(stageKey: string, result: StageInterventionResult): EscalationPayload | null {
  if (result.disposition !== "waiting-approval" || !result.decision) {
    return null;
  }

  return {
    reason: result.reason?.trim() || "阶段需要老板或人工进一步确认。",
    status: "open",
    stageKey,
    requestedBy: "boss-agent",
    metadata: {
      source: "stage-intervention",
      finalDecision: result.decision,
      disposition: result.disposition,
    },
  };
}

async function maybeAutoSelectWorkflowTemplate(
  authorization: string,
  taskId: string,
  fallbackTemplateId?: string | null,
  options?: {
    trigger?: TemplateSelectionTrigger;
    stageKey?: string;
    governanceReason?: string;
    stageTemplateStrategy?: {
      onBlockedTemplateId?: string;
      onWaitingApprovalTemplateId?: string;
      note?: string;
    } | null;
  },
) {
  const task = await fetchTaskRecord(authorization, taskId);
  if (!task?.projectId) {
    return fallbackTemplateId || null;
  }

  const project = await fetchProjectRecord(authorization, task.projectId);
  const projectSettings = project?.settings;
  if (!projectSettings?.allowBossAutoTemplateSwitch) {
    return fallbackTemplateId || null;
  }

  const operatingMode = await fetchTaskOperatingMode(authorization, taskId);
  const parsedStrategy = parseTaskStrategy(task.strategy);
  const currentTemplateId = asNonEmptyString(operatingMode?.selectedTemplateId)
    || asNonEmptyString(parsedStrategy.selectedTemplateId)
    || asNonEmptyString(parsedStrategy.workflowTemplateId)
    || asNonEmptyString(fallbackTemplateId)
    || asNonEmptyString(projectSettings.workflowTemplateId)
    || null;
  const scenarioKey = asNonEmptyString(operatingMode?.scenarioKey) || asNonEmptyString(parsedStrategy.scenarioKey);

  const organizationSettings = readOrchestrationStrategy().organizationSettings;
  const matchedProfile = scenarioKey
    ? (organizationSettings?.recommendedProfiles || []).find((item) => item.scenarioKey === scenarioKey)
    : undefined;
  const recommendedTemplateId = matchedProfile?.templateHints?.find((item) => typeof item === "string" && item.trim())?.trim();
  const preferredTemplateId = asNonEmptyString(projectSettings.preferredTemplateId);
  const trigger = options?.trigger || "startup";
  const stageStrategyTemplateId = trigger === "stage-blocked"
    ? asNonEmptyString(options?.stageTemplateStrategy?.onBlockedTemplateId)
    : trigger === "stage-waiting-approval"
      ? asNonEmptyString(options?.stageTemplateStrategy?.onWaitingApprovalTemplateId)
      : undefined;
  const targetTemplateId = stageStrategyTemplateId || recommendedTemplateId || preferredTemplateId || currentTemplateId;

  if (!targetTemplateId || targetTemplateId === currentTemplateId) {
    return currentTemplateId;
  }

  const triggerReason = trigger === "startup"
    ? "执行启动前"
    : trigger === "stage-blocked"
      ? `阶段 ${options?.stageKey || "unknown"} 阻断后`
      : `阶段 ${options?.stageKey || "unknown"} 升级后`;
  const reason = stageStrategyTemplateId
    ? `老板在${triggerReason}根据阶段策略，自动切换到模板 ${targetTemplateId}。`
    : recommendedTemplateId
    ? `老板在${triggerReason}根据场景 ${scenarioKey} 的推荐策略，自动切换到模板 ${targetTemplateId}。`
    : `老板在${triggerReason}根据项目偏好策略，自动切换到模板 ${targetTemplateId}。`;
  const selectTemplateResult = await cpFetch<{ ok?: boolean }>(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/boss-decisions`,
    {
      method: "POST",
      authorization,
      body: {
        decisionType: "select-template",
        reason,
        metadata: {
          source: stageStrategyTemplateId
            ? "stage-policy"
            : recommendedTemplateId
              ? "recommended-profile"
              : "project-preferred",
          trigger,
          selectedTemplateId: targetTemplateId,
          ...(scenarioKey ? { scenarioKey } : {}),
          ...(matchedProfile?.reason ? { scenarioReason: matchedProfile.reason } : {}),
          ...(preferredTemplateId ? { preferredTemplateId } : {}),
          ...(stageStrategyTemplateId ? { stagePolicyTemplateId: stageStrategyTemplateId } : {}),
          ...(options?.stageTemplateStrategy?.note ? { stagePolicyNote: options.stageTemplateStrategy.note } : {}),
          ...(options?.stageKey ? { triggerStageKey: options.stageKey } : {}),
          ...(options?.governanceReason ? { governanceReason: options.governanceReason } : {}),
        },
      },
    },
  );

  if (!selectTemplateResult.ok) {
    console.warn(`[workflow-sync] failed to auto select template for task ${taskId}`);
    return currentTemplateId;
  }

  return targetTemplateId;
}

async function persistInterventionRuntimeOutcome(
  authorization: string,
  taskId: string,
  stageKey: string,
  result: StageInterventionResult | void,
) {
  if (!result?.decision) {
    return;
  }

  const bossDecision = buildBossDecisionPayload(stageKey, result);
  if (bossDecision) {
    const bossDecisionResult = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/boss-decisions`, {
      method: "POST",
      authorization,
      body: bossDecision,
    });
    if (!bossDecisionResult.ok) {
      console.warn(`[workflow-sync] failed to persist boss decision for task ${taskId} stage ${stageKey}`);
    }
  }

  const escalation = buildEscalationPayload(stageKey, result);
  if (escalation) {
    const escalationResult = await cpFetch(`/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/escalations`, {
      method: "POST",
      authorization,
      body: escalation,
    });
    if (!escalationResult.ok) {
      console.warn(`[workflow-sync] failed to persist escalation for task ${taskId} stage ${stageKey}`);
    }
  }
}

async function applyInterventionOutcome(
  authorization: string,
  taskId: string,
  stageKey: string,
  templateId: string,
  stageTemplateStrategy: WorkflowTemplateStageRecord["stageTemplateStrategyJson"],
  result: StageInterventionResult | void,
) {
  await persistInterventionRuntimeOutcome(authorization, taskId, stageKey, result);

  if (result?.disposition === "blocked") {
    await maybeAutoSelectWorkflowTemplate(authorization, taskId, templateId, {
      trigger: "stage-blocked",
      stageKey,
      governanceReason: result.blockingReason || result.reason,
      stageTemplateStrategy,
    });
    await advanceStage(authorization, taskId, stageKey, {
      status: "blocked",
      blockingReason: result.blockingReason || "角色审查阻断当前阶段。",
    });
    return true;
  }

  if (result?.disposition === "waiting-approval") {
    await maybeAutoSelectWorkflowTemplate(authorization, taskId, templateId, {
      trigger: "stage-waiting-approval",
      stageKey,
      governanceReason: result.reason || result.blockingReason,
      stageTemplateStrategy,
    });
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
  stages: WorkflowTemplateStageRecord[];
  stageKeys: string[];
  startIndex: number;
  endIndex: number;
  completeLastStage?: boolean;
}) {
  for (let index = input.startIndex; index <= input.endIndex; index += 1) {
    const stage = input.stages[index];
    const stageKey = stage?.stageKey;
    if (!stageKey) {
      continue;
    }

    const intervention = await dispatchStageIntervention({
      authorization: input.authorization,
      taskId: input.taskId,
      templateId: input.templateId,
      stageKey,
    });

    const stopped = await applyInterventionOutcome(
      input.authorization,
      input.taskId,
      stageKey,
      input.templateId,
      stage?.stageTemplateStrategyJson ?? null,
      intervention,
    );
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
  const effectiveTemplateId = await maybeAutoSelectWorkflowTemplate(
    input.authorization,
    input.taskId,
    input.templateId,
  );

  if (!effectiveTemplateId) {
    return;
  }

  const templateStages = await fetchWorkflowTemplateStages(input.authorization, effectiveTemplateId);
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
        templateId: effectiveTemplateId,
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
      templateId: effectiveTemplateId,
      stages: templateStages,
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
      templateId: effectiveTemplateId,
      stages: templateStages,
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
    templateId: effectiveTemplateId,
    stages: templateStages,
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
        stages: templateStages,
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