import { cpFetch } from "../../lib/control-plane-client";
import { DEFAULT_EXECUTION_AGENT, mergeTaskStrategy } from "../../lib/orchestration-strategy";
import { stageLabelFromKey } from "./workflow-view";

interface WorkflowRunPayload {
  id?: string;
  templateId?: string | null;
  currentStage?: string | null;
  status?: string | null;
}

interface WorkflowStageRunPayload {
  id?: string;
  stageKey?: string | null;
  status?: string | null;
  approvalState?: string | null;
  blockingReason?: string | null;
  artifactsSummaryJson?: unknown;
}

interface WorkflowTemplateStagePayload {
  id?: string;
  stageKey?: string | null;
  name?: string | null;
  mode?: "single" | "parallel" | "sequential-chain" | null;
  orderIndex?: number | null;
  enabled?: boolean;
  exitCriteriaJson?: string[] | null;
  hooksJson?: Array<Record<string, unknown>> | null;
  initialTaskDefinitionJson?: WorkflowTemplateStageInitialTaskDefinitionPayload | null;
}

interface WorkflowTemplateStageInitialTaskDefinitionPayload {
  version?: 1;
  titleTemplate?: string | null;
  goalTemplate?: string | null;
  instructionTemplate?: string | null;
  doneWhen?: string[] | null;
  defaultExecutionMode?: "single" | "parallel" | "sequential-chain" | null;
  defaultCandidates?: Array<{
    model?: string | null;
    label?: string | null;
  }> | null;
  defaultSteps?: Array<{
    id?: string | null;
    title?: string | null;
    instruction?: string | null;
    model?: string | null;
  }> | null;
  contextBindings?: {
    includeProjectBrief?: boolean;
    includePreviousStageSummary?: boolean;
    includeCurrentStageExitCriteria?: boolean;
  } | null;
  outputContract?: {
    summaryLabel?: string | null;
    artifactKeys?: string[] | null;
    requireStageCompleteMarker?: boolean;
  } | null;
}

interface TaskPayload {
  id: string;
  title: string;
  prompt: string;
  projectId: string;
  autoAdvanceStages?: boolean | null;
  strategy?: string | null;
  selectedModel?: string | null;
  repoId?: string | null;
  workingBranch?: string | null;
  credentialId?: string | null;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
  gitCommitterName?: string | null;
  gitCommitterEmail?: string | null;
  result?: string | null;
}

interface OperatingModeSelectionPayload {
  collaborationMode: "solo" | "team" | "hybrid";
  autopilotLevel: "L0" | "L1" | "L2";
  bossParticipationMode: "disabled" | "advisory" | "exception-only" | "full-manager";
  selectedTemplateId?: string | null;
  scenarioKey?: string;
  source?: "system-default" | "project-default" | "task-override" | "boss-decision";
}

interface SpawnedTaskDraft {
  title: string;
  prompt: string;
  selectedModel?: string;
  definition: ReturnType<typeof normalizeInitialTaskDefinition>;
}

interface SpawnedTaskExecutionConfig {
  taskExecutionMode: "single" | "parallel";
  executionPlan: string;
}

interface WorkflowPayload {
  data?: {
    workflowRun?: WorkflowRunPayload | null;
    stages?: WorkflowStageRunPayload[];
  };
}

interface WorkflowTemplateStagesPayload {
  data?: WorkflowTemplateStagePayload[];
}

export interface WorkflowStageArtifactSummary {
  summary: string;
  excerpt: string;
  completionMarked: boolean;
  capturedAt: string;
  source: "assistant-output" | "parallel-winner" | "sequential-chain" | "manual-adopt";
}

export interface WorkflowExecutionPromptSnapshot {
  workflowStatus?: string;
  currentStageKey?: string;
  currentStageLabel?: string;
  currentStageStatus?: string;
  currentStageExitCriteria: string[];
  completedStageOutputs: string[];
  pendingStageLabels: string[];
}

interface WorkflowExecutionState {
  workflowRun: WorkflowRunPayload;
  stageRuns: WorkflowStageRunPayload[];
  templateStages: WorkflowTemplateStagePayload[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item): item is string => Boolean(item));
}

function normalizeInitialTaskDefinition(
  value: WorkflowTemplateStageInitialTaskDefinitionPayload | null | undefined,
  stageKey: string | undefined,
  stageName: string | undefined,
) {
  const resolvedStageName = asNonEmptyString(stageName) || stageLabelFromKey(stageKey);
  const record = asRecord(value);
  const contextBindings = asRecord(record?.contextBindings);
  const outputContract = asRecord(record?.outputContract);
  const defaultCandidates = Array.isArray(record?.defaultCandidates)
    ? record.defaultCandidates
        .map((item) => ({
          model: asNonEmptyString(asRecord(item)?.model),
          label: asNonEmptyString(asRecord(item)?.label),
        }))
        .filter((item) => item.model)
    : [];
  const defaultSteps = Array.isArray(record?.defaultSteps)
    ? record.defaultSteps
        .map((item) => ({
          id: asNonEmptyString(asRecord(item)?.id),
          title: asNonEmptyString(asRecord(item)?.title),
          instruction: asNonEmptyString(asRecord(item)?.instruction),
          model: asNonEmptyString(asRecord(item)?.model),
        }))
        .filter((item) => item.title || item.instruction || item.model)
    : [];

  return {
    titleTemplate:
      asNonEmptyString(record?.titleTemplate) || `${resolvedStageName || stageKey || "下一阶段"}：初始任务`,
    goalTemplate:
      asNonEmptyString(record?.goalTemplate) ||
      `完成 ${resolvedStageName || stageKey || "下一阶段"} 阶段的首个任务目标，并输出阶段摘要。`,
    instructionTemplate:
      asNonEmptyString(record?.instructionTemplate) ||
      `请围绕 ${resolvedStageName || stageKey || "下一阶段"} 的目标展开执行，产出结构化结论。`,
    doneWhen: normalizeStringArray(record?.doneWhen),
    defaultExecutionMode:
      record?.defaultExecutionMode === "parallel" ||
      record?.defaultExecutionMode === "sequential-chain" ||
      record?.defaultExecutionMode === "pipeline" ||
      record?.defaultExecutionMode === "single"
        ? record.defaultExecutionMode === "pipeline"
          ? "sequential-chain"
          : record.defaultExecutionMode
        : undefined,
    defaultCandidates,
    defaultSteps,
    contextBindings: {
      includeProjectBrief: contextBindings?.includeProjectBrief !== false,
      includePreviousStageSummary: contextBindings?.includePreviousStageSummary !== false,
      includeCurrentStageExitCriteria: contextBindings?.includeCurrentStageExitCriteria !== false,
    },
    outputContract: {
      summaryLabel: asNonEmptyString(outputContract?.summaryLabel),
      artifactKeys: normalizeStringArray(outputContract?.artifactKeys),
      requireStageCompleteMarker: outputContract?.requireStageCompleteMarker !== false,
    },
  };
}

function renderTemplateString(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => variables[key] || "");
}

function buildTemplateVariables(args: {
  currentTask: TaskPayload;
  nextStage: WorkflowTemplateStagePayload;
  currentStageKey: string;
  currentSummary: WorkflowStageArtifactSummary;
}) {
  const nextStageKey = asNonEmptyString(args.nextStage.stageKey) || "";
  const nextStageName = asNonEmptyString(args.nextStage.name) || stageLabelFromKey(nextStageKey);
  return {
    projectId: args.currentTask.projectId,
    currentTaskId: args.currentTask.id,
    currentTaskTitle: args.currentTask.title,
    currentTaskPrompt: args.currentTask.prompt,
    currentTaskResult: asNonEmptyString(args.currentTask.result) || "",
    currentStageKey: args.currentStageKey,
    nextStageKey,
    nextStageName,
    previousStageSummary: args.currentSummary.summary,
    repoId: asNonEmptyString(args.currentTask.repoId) || "",
    workingBranch: asNonEmptyString(args.currentTask.workingBranch) || "",
  };
}

function pickInitialTaskModel(
  definition: ReturnType<typeof normalizeInitialTaskDefinition>,
  currentTask: TaskPayload,
) {
  const candidateModel = definition.defaultCandidates.find((item) => item.model)?.model;
  if (candidateModel) {
    return candidateModel;
  }
  const stepModel = definition.defaultSteps.find((item) => item.model)?.model;
  if (stepModel) {
    return stepModel;
  }
  return asNonEmptyString(currentTask.selectedModel) || undefined;
}

function resolveInitialTaskExecutionMode(
  definition: ReturnType<typeof normalizeInitialTaskDefinition>,
  nextStage: WorkflowTemplateStagePayload,
) {
  return definition.defaultExecutionMode || nextStage.mode || "single";
}

function buildPendingCandidate(args: { label: string; model?: string; agent?: string }) {
  return {
    label: args.label,
    agent: args.agent || DEFAULT_EXECUTION_AGENT,
    ...(args.model ? { model: args.model } : {}),
    role: "executor" as const,
    status: "pending" as const,
  };
}

function buildSpawnedTaskExecutionConfig(args: {
  definition: ReturnType<typeof normalizeInitialTaskDefinition>;
  nextStage: WorkflowTemplateStagePayload;
  selectedModel?: string;
}) {
  const requestedMode = resolveInitialTaskExecutionMode(args.definition, args.nextStage);

  if (requestedMode === "parallel") {
    const candidates = args.definition.defaultCandidates.length > 0
      ? args.definition.defaultCandidates.map((candidate, index) =>
          buildPendingCandidate({
            label: candidate.label || `候选 ${index + 1}`,
            model: candidate.model,
          }),
        )
      : [
          buildPendingCandidate({ label: "候选 1", model: args.selectedModel }),
          buildPendingCandidate({ label: "候选 2", model: args.selectedModel }),
        ];

    return {
      taskExecutionMode: "parallel" as const,
      executionPlan: JSON.stringify({
        templateId: asNonEmptyString(args.nextStage.id) || asNonEmptyString(args.nextStage.stageKey) || "spawned-stage",
        mode: "parallel",
        steps: [
          { id: "exec-parallel", type: "execution", status: "pending" },
          ...(candidates.length > 1
            ? [{ id: "judge-0", type: "judge", status: "pending", dependsOn: ["exec-parallel"] }]
            : []),
        ],
        candidates,
        source: "initialTaskDefinition",
      }),
    } satisfies SpawnedTaskExecutionConfig;
  }

  if (requestedMode === "sequential-chain") {
    const pipelineSteps =
      args.definition.defaultSteps.length > 0
        ? args.definition.defaultSteps.map((step, index) => ({
            id: step.id || `pipeline-step-${index + 1}`,
            type: "execution",
            status: "pending",
            ...(index > 0
              ? { dependsOn: [args.definition.defaultSteps[index - 1]?.id || `pipeline-step-${index}`] }
              : {}),
            title: step.title || `步骤 ${index + 1}`,
            instruction: step.instruction || "",
            model: step.model || args.selectedModel || null,
            sourceType: "initialTask.sequentialChain.step",
          }))
        : [
            {
              id: "pipeline-step-1",
              type: "execution",
              status: "pending",
              title: asNonEmptyString(args.nextStage.name) || stageLabelFromKey(args.nextStage.stageKey),
              instruction: "",
              model: args.selectedModel || null,
              sourceType: "initialTask.sequentialChain.step",
            },
          ];

    return {
      taskExecutionMode: "single" as const,
      executionPlan: JSON.stringify({
        templateId: asNonEmptyString(args.nextStage.id) || asNonEmptyString(args.nextStage.stageKey) || "spawned-stage",
        mode: "single",
        steps: pipelineSteps,
        candidates: [buildPendingCandidate({ label: "主执行", model: args.selectedModel })],
        pipelineMetadata: {
          requestedMode: "sequential-chain",
          stepCount: pipelineSteps.length,
        },
        source: "initialTaskDefinition",
      }),
    } satisfies SpawnedTaskExecutionConfig;
  }

  return {
    taskExecutionMode: "single" as const,
    executionPlan: JSON.stringify({
      templateId: asNonEmptyString(args.nextStage.id) || asNonEmptyString(args.nextStage.stageKey) || "spawned-stage",
      mode: "single",
      steps: [{ id: "exec-0", type: "execution", status: "pending" }],
      candidates: [buildPendingCandidate({ label: "主执行", model: args.selectedModel })],
      source: "initialTaskDefinition",
    }),
  } satisfies SpawnedTaskExecutionConfig;
}

function buildSpawnedTaskPrompt(args: {
  currentTask: TaskPayload;
  nextStage: WorkflowTemplateStagePayload;
  currentStageKey: string;
  currentSummary: WorkflowStageArtifactSummary;
}): SpawnedTaskDraft {
  const definition = normalizeInitialTaskDefinition(
    args.nextStage.initialTaskDefinitionJson,
    asNonEmptyString(args.nextStage.stageKey),
    asNonEmptyString(args.nextStage.name),
  );
  const variables = buildTemplateVariables(args);
  const title = renderTemplateString(definition.titleTemplate, variables).trim();
  const goal = renderTemplateString(definition.goalTemplate, variables).trim();
  const instruction = renderTemplateString(definition.instructionTemplate, variables).trim();
  const sections = [
    `阶段：${variables.nextStageName} (${variables.nextStageKey})`,
    `目标：${goal}`,
    `执行指令：\n${instruction}`,
  ];

  if (definition.doneWhen.length > 0) {
    sections.push(`完成条件：\n${definition.doneWhen.map((item) => `- ${renderTemplateString(item, variables)}`).join("\n")}`);
  }

  const contextLines: string[] = [];
  if (definition.contextBindings.includeProjectBrief) {
    contextLines.push(`当前任务背景：${args.currentTask.prompt}`);
  }
  if (definition.contextBindings.includePreviousStageSummary) {
    contextLines.push(`上一阶段摘要：${args.currentSummary.summary}`);
  }
  if (definition.contextBindings.includeCurrentStageExitCriteria) {
    const exitCriteria = normalizeStringArray(args.nextStage.exitCriteriaJson);
    if (exitCriteria.length > 0) {
      contextLines.push(`本阶段退出条件：\n${exitCriteria.map((item) => `- ${item}`).join("\n")}`);
    }
  }
  if (asNonEmptyString(args.currentTask.result)) {
    contextLines.push(`当前任务最新结果：${args.currentTask.result}`);
  }
  if (contextLines.length > 0) {
    sections.push(`上下文：\n${contextLines.join("\n\n")}`);
  }

  const outputLines: string[] = [];
  if (definition.outputContract.summaryLabel) {
    outputLines.push(`摘要标签：${definition.outputContract.summaryLabel}`);
  }
  if (definition.outputContract.artifactKeys.length > 0) {
    outputLines.push(`产物键：${definition.outputContract.artifactKeys.join("、")}`);
  }
  if (definition.outputContract.requireStageCompleteMarker) {
    outputLines.push("完成本阶段时必须显式输出 [STAGE_COMPLETE]。");
  }
  if (outputLines.length > 0) {
    sections.push(`输出约束：\n${outputLines.map((item) => `- ${item}`).join("\n")}`);
  }

  return {
    title,
    prompt: sections.join("\n\n"),
    selectedModel: pickInitialTaskModel(definition, args.currentTask),
    definition,
  };
}

async function fetchTask(taskId: string, authorization: string) {
  const taskResult = await cpFetch<TaskPayload>(
    `/api/project-tree/tasks/${encodeURIComponent(taskId)}`,
    {
      authorization,
    },
  );
  return taskResult.ok ? taskResult.data : null;
}

async function fetchTaskOperatingMode(taskId: string, authorization: string) {
  const modeResult = await cpFetch<{ data?: OperatingModeSelectionPayload | null }>(
    `/api/tasks/${encodeURIComponent(taskId)}/operating-runtime/mode`,
    { authorization },
  );
  return modeResult.ok ? modeResult.data?.data || null : null;
}

async function syncSpawnedTaskContext(args: {
  newTaskId: string;
  authorization: string;
  templateId: string;
  nextStageKey: string;
  currentTask: TaskPayload;
  operatingMode: OperatingModeSelectionPayload | null;
  executionConfig: SpawnedTaskExecutionConfig;
}) {
  await cpFetch(`/api/tasks/${encodeURIComponent(args.newTaskId)}`, {
    method: "PATCH",
    authorization: args.authorization,
    body: {
      executionMode: args.executionConfig.taskExecutionMode,
      executionPlan: args.executionConfig.executionPlan,
      strategy: mergeTaskStrategy(args.currentTask.strategy, {
        workflowTemplateId: args.templateId,
        selectedTemplateId: args.templateId,
        currentStageKey: args.nextStageKey,
        executionMode: args.executionConfig.taskExecutionMode,
        ...(args.operatingMode?.scenarioKey ? { scenarioKey: args.operatingMode.scenarioKey } : {}),
      }),
    },
  });

  if (args.operatingMode) {
    await cpFetch(`/api/tasks/${encodeURIComponent(args.newTaskId)}/operating-runtime/mode`, {
      method: "PUT",
      authorization: args.authorization,
      body: {
        collaborationMode: args.operatingMode.collaborationMode,
        autopilotLevel: args.operatingMode.autopilotLevel,
        bossParticipationMode: args.operatingMode.bossParticipationMode,
        selectedTemplateId: args.templateId,
        ...(args.operatingMode.scenarioKey ? { scenarioKey: args.operatingMode.scenarioKey } : {}),
        source: args.operatingMode.source || "task-override",
      },
    });
  }

  await cpFetch(`/api/tasks/${encodeURIComponent(args.newTaskId)}/workflow/initialize`, {
    method: "POST",
    authorization: args.authorization,
    body: {
      templateId: args.templateId,
      currentStage: args.nextStageKey,
    },
  });
}

async function spawnNextStageTask(args: {
  currentTaskId: string;
  authorization: string;
  templateId: string;
  currentStageKey: string;
  nextStage: WorkflowTemplateStagePayload;
  summary: WorkflowStageArtifactSummary;
}) {
  const currentTask = await fetchTask(args.currentTaskId, args.authorization);
  const nextStageKey = asNonEmptyString(args.nextStage.stageKey);
  if (!currentTask || !nextStageKey) {
    return undefined;
  }

  const operatingMode = await fetchTaskOperatingMode(args.currentTaskId, args.authorization);
  const draft = buildSpawnedTaskPrompt({
    currentTask,
    nextStage: args.nextStage,
    currentStageKey: args.currentStageKey,
    currentSummary: args.summary,
  });
  const executionConfig = buildSpawnedTaskExecutionConfig({
    definition: draft.definition,
    nextStage: args.nextStage,
    selectedModel: draft.selectedModel,
  });
  const createResult = await cpFetch<TaskPayload>("/api/tasks", {
    method: "POST",
    authorization: args.authorization,
    body: {
      title: draft.title,
      prompt: draft.prompt,
      projectId: currentTask.projectId,
      ...(asNonEmptyString(currentTask.repoId) ? { repoId: currentTask.repoId } : {}),
      ...(asNonEmptyString(currentTask.workingBranch)
        ? { workingBranch: currentTask.workingBranch }
        : {}),
      ...(asNonEmptyString(currentTask.credentialId)
        ? { credentialId: currentTask.credentialId }
        : {}),
      ...(draft.selectedModel ? { selectedModel: draft.selectedModel } : {}),
      ...(asNonEmptyString(currentTask.gitAuthorName)
        ? { gitAuthorName: currentTask.gitAuthorName }
        : {}),
      ...(asNonEmptyString(currentTask.gitAuthorEmail)
        ? { gitAuthorEmail: currentTask.gitAuthorEmail }
        : {}),
      ...(asNonEmptyString(currentTask.gitCommitterName)
        ? { gitCommitterName: currentTask.gitCommitterName }
        : {}),
      ...(asNonEmptyString(currentTask.gitCommitterEmail)
        ? { gitCommitterEmail: currentTask.gitCommitterEmail }
        : {}),
      relationContext: {
        spawnedFromTaskId: currentTask.id,
        metadata: {
          source: "workflow-stage-auto-advance",
          fromStageKey: args.currentStageKey,
          toStageKey: nextStageKey,
          templateId: args.templateId,
        },
      },
    },
  });

  if (!createResult.ok || !createResult.data?.id) {
    return undefined;
  }

  await syncSpawnedTaskContext({
    newTaskId: createResult.data.id,
    authorization: args.authorization,
    templateId: args.templateId,
    nextStageKey,
    currentTask,
    operatingMode,
    executionConfig,
  });

  return createResult.data.id;
}

function summarizeText(rawText: string, maxLength = 220) {
  const normalized = rawText.replace(/\[STAGE_COMPLETE\]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function buildExcerpt(rawText: string, maxLength = 1200) {
  const normalized = rawText.replace(/\[STAGE_COMPLETE\]/g, "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function parseArtifactSummary(value: unknown): WorkflowStageArtifactSummary | null {
  if (typeof value === "string") {
    const summary = summarizeText(value);
    return summary
      ? {
          summary,
          excerpt: buildExcerpt(value),
          completionMarked: value.includes("[STAGE_COMPLETE]"),
          capturedAt: new Date(0).toISOString(),
          source: "assistant-output",
        }
      : null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const summary = asNonEmptyString(record.summary);
  if (!summary) {
    return null;
  }

  return {
    summary,
    excerpt: asNonEmptyString(record.excerpt) || summary,
    completionMarked: record.completionMarked === true,
    capturedAt: asNonEmptyString(record.capturedAt) || new Date(0).toISOString(),
    source:
      record.source === "parallel-winner"
        ? "parallel-winner"
        : record.source === "sequential-chain"
          ? "sequential-chain"
          : record.source === "manual-adopt"
            ? "manual-adopt"
            : "assistant-output",
  };
}

function sortTemplateStages(stages: WorkflowTemplateStagePayload[]) {
  return [...stages]
    .filter((stage) => stage.enabled !== false && asNonEmptyString(stage.stageKey))
    .sort((left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0));
}

function findTemplateStage(
  templateStages: WorkflowTemplateStagePayload[],
  stageKey: string | undefined,
) {
  if (!stageKey) {
    return undefined;
  }
  return templateStages.find((stage) => stage.stageKey === stageKey);
}

function findStageRun(stageRuns: WorkflowStageRunPayload[], stageKey: string | undefined) {
  if (!stageKey) {
    return undefined;
  }
  return stageRuns.find((stage) => stage.stageKey === stageKey);
}

function nextTemplateStage(
  templateStages: WorkflowTemplateStagePayload[],
  currentStageKey: string | undefined,
) {
  if (!currentStageKey) {
    return undefined;
  }
  const currentIndex = templateStages.findIndex((stage) => stage.stageKey === currentStageKey);
  if (currentIndex < 0) {
    return undefined;
  }
  return templateStages[currentIndex + 1];
}

async function fetchWorkflowExecutionState(
  taskId: string,
  authorization: string,
): Promise<WorkflowExecutionState | null> {
  const workflowResult = await cpFetch<WorkflowPayload>(
    `/api/tasks/${encodeURIComponent(taskId)}/workflow`,
    { authorization },
  );
  if (!workflowResult.ok || !workflowResult.data?.data?.workflowRun) {
    return null;
  }

  const workflowRun = workflowResult.data.data.workflowRun;
  const stageRuns = Array.isArray(workflowResult.data.data.stages)
    ? workflowResult.data.data.stages
    : [];

  if (!workflowRun.templateId) {
    return {
      workflowRun,
      stageRuns,
      templateStages: [],
    };
  }

  const templateResult = await cpFetch<WorkflowTemplateStagesPayload>(
    `/api/workflow-templates/${encodeURIComponent(workflowRun.templateId)}/stages`,
    { authorization },
  );

  return {
    workflowRun,
    stageRuns,
    templateStages: templateResult.ok ? sortTemplateStages(templateResult.data?.data || []) : [],
  };
}

export function hasStageCompletionMarker(resultText: string | undefined | null) {
  return typeof resultText === "string" && resultText.includes("[STAGE_COMPLETE]");
}

export function buildStageArtifactSummary(
  resultText: string | undefined | null,
  source: WorkflowStageArtifactSummary["source"] = "assistant-output",
): WorkflowStageArtifactSummary | null {
  if (typeof resultText !== "string") {
    return null;
  }

  const summary = summarizeText(resultText);
  const excerpt = buildExcerpt(resultText);
  const completionMarked = hasStageCompletionMarker(resultText);
  if (!summary && !completionMarked) {
    return null;
  }

  return {
    summary: summary || "阶段已完成，未提供额外摘要。",
    excerpt: excerpt || "[STAGE_COMPLETE]",
    completionMarked,
    capturedAt: new Date().toISOString(),
    source,
  };
}

export async function buildWorkflowExecutionPromptSnapshot(
  taskId: string,
  authorization: string,
): Promise<WorkflowExecutionPromptSnapshot | null> {
  const state = await fetchWorkflowExecutionState(taskId, authorization);
  if (!state) {
    return null;
  }

  const currentStageKey = asNonEmptyString(state.workflowRun.currentStage);
  const currentStageRun = findStageRun(state.stageRuns, currentStageKey);
  const currentTemplateStage = findTemplateStage(state.templateStages, currentStageKey);
  const pendingStageLabels = state.templateStages
    .filter((stage) => {
      const stageKey = asNonEmptyString(stage.stageKey);
      if (!stageKey || stageKey === currentStageKey) {
        return false;
      }

      const stageRun = findStageRun(state.stageRuns, stageKey);
      return !stageRun || stageRun.status === "pending";
    })
    .map((stage) => asNonEmptyString(stage.name) || stageLabelFromKey(stage.stageKey));

  const completedStageOutputs = state.templateStages
    .map((stage) => {
      const stageKey = asNonEmptyString(stage.stageKey);
      if (!stageKey) {
        return null;
      }

      const stageRun = findStageRun(state.stageRuns, stageKey);
      if (!stageRun || stageRun.status !== "completed") {
        return null;
      }

      const artifact = parseArtifactSummary(stageRun.artifactsSummaryJson);
      const label = asNonEmptyString(stage.name) || stageLabelFromKey(stageKey);
      return artifact ? `${stageKey}：${artifact.summary}` : `${stageKey}：${label} 已完成`;
    })
    .filter((item): item is string => Boolean(item));

  return {
    workflowStatus: asNonEmptyString(state.workflowRun.status),
    currentStageKey,
    currentStageLabel:
      asNonEmptyString(currentTemplateStage?.name) || stageLabelFromKey(currentStageKey),
    currentStageStatus: asNonEmptyString(currentStageRun?.status),
    currentStageExitCriteria: normalizeStringArray(currentTemplateStage?.exitCriteriaJson),
    completedStageOutputs,
    pendingStageLabels,
  };
}

/**
 * Fetch the lifecycle hooks configured on the current workflow stage template.
 * Returns an empty array if no workflow is active or the stage has no hooks.
 */
export async function fetchCurrentStageHooks(
  taskId: string,
  authorization: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const state = await fetchWorkflowExecutionState(taskId, authorization);
    if (!state) return [];
    const currentStageKey = asNonEmptyString(state.workflowRun.currentStage);
    const currentTemplateStage = findTemplateStage(state.templateStages, currentStageKey);
    return Array.isArray(currentTemplateStage?.hooksJson) ? currentTemplateStage.hooksJson : [];
  } catch {
    return [];
  }
}

export async function persistWorkflowStageExecutionOutcome(args: {
  taskId: string;
  authorization: string;
  resultText: string | undefined;
  source?: WorkflowStageArtifactSummary["source"];
  forceAdvance?: boolean;
  disableSpawnNextTask?: boolean;
}) {
  const state = await fetchWorkflowExecutionState(args.taskId, args.authorization);
  if (!state) {
    return { updated: false, advanced: false } as const;
  }

  const currentTask = await fetchTask(args.taskId, args.authorization);

  const currentStageKey = asNonEmptyString(state.workflowRun.currentStage);
  const currentStageRun = findStageRun(state.stageRuns, currentStageKey);
  if (!currentStageKey || !currentStageRun) {
    return { updated: false, advanced: false } as const;
  }

  const summary = buildStageArtifactSummary(args.resultText, args.source || "assistant-output");
  if (!summary) {
    return { updated: false, advanced: false, currentStageKey } as const;
  }

  const nextStage = nextTemplateStage(state.templateStages, currentStageKey);
  const currentStatus =
    currentStageRun.status === "blocked" ||
    currentStageRun.status === "waiting-approval" ||
    currentStageRun.status === "failed" ||
    currentStageRun.status === "completed"
      ? currentStageRun.status
      : "running";

  const shouldAdvance =
    currentStatus === "running" &&
    (args.forceAdvance === true ||
      (summary.completionMarked && currentTask?.autoAdvanceStages === true));
  const advanceResult = await cpFetch(`/api/tasks/${encodeURIComponent(args.taskId)}/workflow/advance`, {
    method: "POST",
    authorization: args.authorization,
    body: {
      fromStage: currentStageKey,
      ...(shouldAdvance && nextStage?.stageKey ? { toStage: nextStage.stageKey } : {}),
      status: shouldAdvance ? "completed" : currentStatus,
      artifactsSummaryJson: summary,
    },
  });

  let spawnedTaskId: string | undefined;
  let spawnedTaskError: string | undefined;
  if (
    advanceResult.ok &&
    shouldAdvance &&
    !args.disableSpawnNextTask &&
    nextStage?.stageKey &&
    state.workflowRun.templateId
  ) {
    try {
      spawnedTaskId = await spawnNextStageTask({
        currentTaskId: args.taskId,
        authorization: args.authorization,
        templateId: state.workflowRun.templateId,
        currentStageKey,
        nextStage,
        summary,
      });
    } catch (error) {
      spawnedTaskError = error instanceof Error ? error.message : "spawn-next-stage-task-failed";
      console.warn(
        `[workflow-stage-execution] failed to spawn next stage task for ${args.taskId}: ${spawnedTaskError}`,
      );
    }
  }

  return {
    updated: advanceResult.ok,
    advanced: advanceResult.ok && shouldAdvance,
    currentStageKey,
    nextStageKey: shouldAdvance ? asNonEmptyString(nextStage?.stageKey) : undefined,
    spawnedTaskId,
    spawnedTaskError,
    summary,
  } as const;
}