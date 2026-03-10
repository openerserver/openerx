import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OPENCODE_ROOT = resolve(
  process.env.OPENCODE_ROOT || join(__dirname, "../../../../opencode-fork"),
);
const OPENCODE_STATE_DIR = join(OPENCODE_ROOT, ".opencode/state");
const STRATEGY_FILE = join(OPENCODE_STATE_DIR, "orchestration-strategy.json");

export interface WorkflowEvaluationHook {
  enabled: boolean;
  agent: string;
  model: string;
  promptTemplate: string;
  timeoutMs: number;
}

export interface WorkflowEvaluationRecord {
  status: "completed" | "failed" | "skipped";
  agent: string;
  model?: string;
  prompt: string;
  result?: string;
  error?: string;
  sessionId?: string;
  completedAt: string;
}

export interface PersistedTaskStrategy {
  complexity?: string;
  suggestedAgents?: string[];
  requiresPlan?: boolean;
  confidence?: number;
  selectedAgent?: string;
  effectiveModel?: string;
  workflowEvaluations?: {
    preExecution?: WorkflowEvaluationRecord;
    postExecution?: WorkflowEvaluationRecord;
  };
  [key: string]: unknown;
}

export interface OrchestrationStrategy {
  categoryAgentMap: Record<string, string[]>;
  categoryModelMap: Record<string, string>;
  enablePipeline: boolean;
  preExecutionReview: WorkflowEvaluationHook;
  postExecutionReview: WorkflowEvaluationHook;
}

const DEFAULT_PRE_PROMPT = [
  "You are performing a pre-execution assessment for an OpenerX task.",
  "Summarize the task intent, key risks, required clarifications, and a concise execution recommendation.",
  "Return a short structured assessment suitable to hand off to the main execution agent.",
  "",
  "Task title: {{taskTitle}}",
  "Task prompt:",
  "{{taskPrompt}}",
].join("\n");

const DEFAULT_POST_PROMPT = [
  "You are performing a post-execution review for an OpenerX task.",
  "Assess result quality, remaining risks, and any follow-up actions.",
  "Keep the response concise and action-oriented.",
  "",
  "Task title: {{taskTitle}}",
  "Original task prompt:",
  "{{taskPrompt}}",
  "",
  "Execution result:",
  "{{taskResult}}",
  "",
  "Code change summary:",
  "{{changesSummary}}",
].join("\n");

export const DEFAULT_ORCHESTRATION_STRATEGY: OrchestrationStrategy = {
  categoryAgentMap: {
    quick: ["explore-enterprise"],
    deep: ["hephaestus-enterprise"],
    ops: ["oracle-enterprise"],
    security: ["oracle-enterprise", "hephaestus-enterprise"],
    architecture: ["prometheus-enterprise", "oracle-enterprise"],
  },
  categoryModelMap: {
    quick: "",
    deep: "",
    ops: "",
    security: "",
    architecture: "",
  },
  enablePipeline: true,
  preExecutionReview: {
    enabled: false,
    agent: "prometheus-enterprise",
    model: "",
    promptTemplate: DEFAULT_PRE_PROMPT,
    timeoutMs: 15000,
  },
  postExecutionReview: {
    enabled: false,
    agent: "oracle-enterprise",
    model: "",
    promptTemplate: DEFAULT_POST_PROMPT,
    timeoutMs: 15000,
  },
};

function cloneDefaultStrategy(): OrchestrationStrategy {
  return JSON.parse(JSON.stringify(DEFAULT_ORCHESTRATION_STRATEGY)) as OrchestrationStrategy;
}

function normalizeHook(
  raw: Partial<WorkflowEvaluationHook> | undefined,
  fallback: WorkflowEvaluationHook,
): WorkflowEvaluationHook {
  return {
    enabled: raw?.enabled ?? fallback.enabled,
    agent: typeof raw?.agent === "string" ? raw.agent : fallback.agent,
    model: typeof raw?.model === "string" ? raw.model : fallback.model,
    promptTemplate:
      typeof raw?.promptTemplate === "string" && raw.promptTemplate.trim()
        ? raw.promptTemplate
        : fallback.promptTemplate,
    timeoutMs:
      typeof raw?.timeoutMs === "number" && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0
        ? raw.timeoutMs
        : fallback.timeoutMs,
  };
}

export function normalizeOrchestrationStrategy(
  raw: Partial<OrchestrationStrategy> | undefined,
): OrchestrationStrategy {
  const defaults = cloneDefaultStrategy();
  return {
    categoryAgentMap: {
      ...defaults.categoryAgentMap,
      ...(raw?.categoryAgentMap || {}),
    },
    categoryModelMap: {
      ...defaults.categoryModelMap,
      ...(raw?.categoryModelMap || {}),
    },
    enablePipeline: raw?.enablePipeline ?? defaults.enablePipeline,
    preExecutionReview: normalizeHook(raw?.preExecutionReview, defaults.preExecutionReview),
    postExecutionReview: normalizeHook(raw?.postExecutionReview, defaults.postExecutionReview),
  };
}

export function readOrchestrationStrategy(): OrchestrationStrategy {
  if (!existsSync(STRATEGY_FILE)) {
    return cloneDefaultStrategy();
  }

  try {
    const parsed = JSON.parse(
      readFileSync(STRATEGY_FILE, "utf-8"),
    ) as Partial<OrchestrationStrategy>;
    return normalizeOrchestrationStrategy(parsed);
  } catch {
    return cloneDefaultStrategy();
  }
}

export function writeOrchestrationStrategy(data: OrchestrationStrategy): void {
  if (!existsSync(OPENCODE_STATE_DIR)) {
    mkdirSync(OPENCODE_STATE_DIR, { recursive: true });
  }
  writeFileSync(
    STRATEGY_FILE,
    JSON.stringify(normalizeOrchestrationStrategy(data), null, 2),
    "utf-8",
  );
}

export function renderPromptTemplate(
  template: string,
  context: Record<string, string | undefined | null>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return context[key] ?? "";
  });
}

export function parseTaskStrategy(raw: string | undefined | null): PersistedTaskStrategy {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as PersistedTaskStrategy;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function mergeTaskStrategy(
  existingRaw: string | undefined | null,
  patch: Partial<PersistedTaskStrategy>,
): string {
  const existing = parseTaskStrategy(existingRaw);
  const merged: PersistedTaskStrategy = {
    ...existing,
    ...patch,
    workflowEvaluations: {
      ...(existing.workflowEvaluations || {}),
      ...(patch.workflowEvaluations || {}),
    },
  };
  return JSON.stringify(merged);
}
