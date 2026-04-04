import { cpFetch } from "../../lib/control-plane-client";
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
  artifactsSummaryJson?: unknown;
}

interface WorkflowTemplateStagePayload {
  id?: string;
  stageKey?: string | null;
  name?: string | null;
  orderIndex?: number | null;
  enabled?: boolean;
  exitCriteriaJson?: string[] | null;
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

function summarizeText(rawText: string, maxLength = 220) {
  const normalized = rawText
    .replace(/\[STAGE_COMPLETE\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function buildExcerpt(rawText: string, maxLength = 1200) {
  const normalized = rawText.replace(/\[STAGE_COMPLETE\]/g, "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
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
