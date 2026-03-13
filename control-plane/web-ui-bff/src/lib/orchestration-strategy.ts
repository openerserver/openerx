import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OPENCODE_ROOT = resolve(
  process.env.OPENCODE_ROOT || join(__dirname, "../../../../opencode-fork"),
);
const OPENCODE_STATE_DIR = join(OPENCODE_ROOT, ".opencode/state");
const STRATEGY_FILE = join(OPENCODE_STATE_DIR, "orchestration-strategy.json");

interface LegacyWorkflowEvaluationHook {
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

// ── Phase 1: Lifecycle Hooks ───────────────────────────────────────

export type HookTrigger = "pre-execution" | "post-execution" | "on-failure" | "pre-resume";

export interface LifecycleHook {
  id: string;
  trigger: HookTrigger;
  enabled: boolean;
  agent: string;
  model?: string;
  promptTemplate: string;
  timeoutMs: number;
  order: number;
}

export interface HookDecision {
  action:
    | "allow"
    | "deny"
    | "rewrite-prompt"
    | "request-approval"
    | "switch-model"
    | "spawn-followup";
  reason?: string;
  rewrittenPrompt?: string;
  targetModel?: string;
}

export interface HookExecutionRecord {
  hookId: string;
  trigger: HookTrigger;
  status: "completed" | "failed" | "skipped";
  agent: string;
  model?: string;
  prompt: string;
  result?: string;
  error?: string;
  sessionId?: string;
  decision?: HookDecision;
  completedAt: string;
}

/**
 * Try to parse a structured HookDecision from hook agent output.
 * Looks for a JSON block containing an "action" field.
 * Returns undefined if the output is unstructured.
 */
export function parseHookDecision(text: string | undefined): HookDecision | undefined {
  if (!text) return undefined;
  try {
    const jsonMatch = text.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (!jsonMatch) return undefined;
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const action = parsed.action;
    if (
      typeof action !== "string" ||
      ![
        "allow",
        "deny",
        "rewrite-prompt",
        "request-approval",
        "switch-model",
        "spawn-followup",
      ].includes(action)
    ) {
      return undefined;
    }
    return {
      action: action as HookDecision["action"],
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      rewrittenPrompt:
        typeof parsed.rewrittenPrompt === "string" ? parsed.rewrittenPrompt : undefined,
      targetModel: typeof parsed.targetModel === "string" ? parsed.targetModel : undefined,
    };
  } catch {
    return undefined;
  }
}

// ── Phase 2: Workflow Templates & Execution Plan ───────────────────

export type ExecutionMode = "single" | "parallel";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  mode: ExecutionMode;
  agents: string[];
  maxParallelCandidates?: number;
  enabled: boolean;
  categoryDefaults?: string[];
}

export interface ExecutionCandidate {
  label: string;
  agent: string;
  model?: string;
  role?: "planner" | "executor" | "reviewer" | "judge" | "merger";
  sessionId?: string;
  agentRunId?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ExecutionStep {
  id: string;
  type: "hook" | "execution" | "judge";
  status: "pending" | "running" | "completed" | "failed";
  dependsOn?: string[];
}

export interface ExecutionPlan {
  templateId: string;
  mode: ExecutionMode;
  steps: ExecutionStep[];
  candidates: ExecutionCandidate[];
  judgeResult?: JudgeResult;
  winnerCandidateIndex?: number;
}

// ── Phase 3: Judge ─────────────────────────────────────────────────

export interface JudgeConfig {
  enabled: boolean;
  agent: string;
  model: string;
  promptTemplate: string;
  timeoutMs: number;
  selectionStrategy: "judge-pick" | "highest-score";
}

export interface JudgeResult {
  status: "completed" | "failed" | "skipped";
  sessionId?: string;
  winnerIndex?: number;
  scores?: number[];
  reasoning: string;
  completedAt: string;
}

// ── Persisted Task Strategy ────────────────────────────────────────

export interface PersistedTaskStrategy {
  selectedTemplateId?: string;
  complexity?: string;
  suggestedAgents?: string[];
  requiresPlan?: boolean;
  confidence?: number;
  selectedAgent?: string;
  effectiveModel?: string;
  executionMode?: ExecutionMode;
  hookExecutions?: HookExecutionRecord[];
  [key: string]: unknown;
}

// ── Orchestration Strategy ─────────────────────────────────────────

export interface OrchestrationStrategy {
  categoryAgentMap: Record<string, string[]>;
  categoryModelMap: Record<string, string>;
  enablePipeline: boolean;
  hooks: LifecycleHook[];
  templates: WorkflowTemplate[];
  judge: JudgeConfig;
}

export const DEFAULT_EXECUTION_AGENT = "default-executor";
export const LEGACY_DEFAULT_EXECUTION_AGENT = "build";

export function isDefaultExecutionAgent(agentName: string | undefined | null): boolean {
  return agentName === DEFAULT_EXECUTION_AGENT || agentName === LEGACY_DEFAULT_EXECUTION_AGENT;
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

const DEFAULT_JUDGE_PROMPT = [
  "你是 OpenerX 聚合评判 Agent。以下是同一个任务交给多个不同 Agent 执行的结果。",
  "请根据代码质量、任务完成度和实现合理性为每个 Candidate 打分(0-100)，并选出最佳结果。",
  "",
  "任务标题: {{taskTitle}}",
  "任务需求:",
  "{{taskPrompt}}",
  "",
  "{{candidateResults}}",
  "",
  "请按以下 JSON 格式输出:",
  '{"winnerIndex": 0, "scores": [85, 72], "reasoning": "..."}',
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
  hooks: [],
  templates: [
    {
      id: "default-single",
      name: "标准单执行",
      mode: "single",
      agents: [],
      enabled: true,
      categoryDefaults: ["quick", "deep", "ops", "security", "architecture"],
    },
  ],
  judge: {
    enabled: false,
    agent: "prometheus-enterprise",
    model: "",
    promptTemplate: DEFAULT_JUDGE_PROMPT,
    timeoutMs: 30000,
    selectionStrategy: "judge-pick",
  },
};

function cloneDefaultStrategy(): OrchestrationStrategy {
  return JSON.parse(JSON.stringify(DEFAULT_ORCHESTRATION_STRATEGY)) as OrchestrationStrategy;
}

const LEGACY_PRE_HOOK_DEFAULTS: LegacyWorkflowEvaluationHook = {
  enabled: false,
  agent: "prometheus-enterprise",
  model: "",
  promptTemplate: DEFAULT_PRE_PROMPT,
  timeoutMs: 15000,
};

const LEGACY_POST_HOOK_DEFAULTS: LegacyWorkflowEvaluationHook = {
  enabled: false,
  agent: "oracle-enterprise",
  model: "",
  promptTemplate: DEFAULT_POST_PROMPT,
  timeoutMs: 15000,
};

function normalizeLegacyHook(
  raw: Partial<LegacyWorkflowEvaluationHook> | undefined,
  fallback: LegacyWorkflowEvaluationHook,
): LegacyWorkflowEvaluationHook {
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

function normalizeJudge(raw: Partial<JudgeConfig> | undefined, fallback: JudgeConfig): JudgeConfig {
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
    selectionStrategy:
      raw?.selectionStrategy === "judge-pick" || raw?.selectionStrategy === "highest-score"
        ? raw.selectionStrategy
        : fallback.selectionStrategy,
  };
}

/** Migrate legacy pre/postExecutionReview to hooks array if not yet migrated. */
function migrateToHooks(raw: Record<string, unknown>): LifecycleHook[] {
  if (Array.isArray(raw.hooks) && raw.hooks.length > 0) {
    return raw.hooks as LifecycleHook[];
  }

  const hooks: LifecycleHook[] = [];
  const preRaw = raw.preExecutionReview as Partial<LegacyWorkflowEvaluationHook> | undefined;
  const pre = normalizeLegacyHook(preRaw, LEGACY_PRE_HOOK_DEFAULTS);
  if (preRaw?.agent) {
    hooks.push({
      id: "legacy-pre-execution",
      trigger: "pre-execution",
      enabled: pre.enabled,
      agent: pre.agent,
      model: pre.model || undefined,
      promptTemplate: pre.promptTemplate,
      timeoutMs: pre.timeoutMs,
      order: 0,
    });
  }

  const postRaw = raw.postExecutionReview as Partial<LegacyWorkflowEvaluationHook> | undefined;
  const post = normalizeLegacyHook(postRaw, LEGACY_POST_HOOK_DEFAULTS);
  if (postRaw?.agent) {
    hooks.push({
      id: "legacy-post-execution",
      trigger: "post-execution",
      enabled: post.enabled,
      agent: post.agent,
      model: post.model || undefined,
      promptTemplate: post.promptTemplate,
      timeoutMs: post.timeoutMs,
      order: 0,
    });
  }

  return hooks;
}

export function normalizeOrchestrationStrategy(
  raw: Partial<OrchestrationStrategy> | undefined,
): OrchestrationStrategy {
  const defaults = cloneDefaultStrategy();
  const rawRecord = (raw as Record<string, unknown> | undefined) ?? {};
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
    hooks: migrateToHooks(rawRecord),
    templates:
      Array.isArray(raw?.templates) && raw.templates.length > 0
        ? raw.templates
        : defaults.templates,
    judge: normalizeJudge(raw?.judge, defaults.judge),
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
    hookExecutions: patch.hookExecutions
      ? [...(existing.hookExecutions || []), ...patch.hookExecutions]
      : existing.hookExecutions,
  };
  return JSON.stringify(merged);
}

// ── Template Resolution ────────────────────────────────────────────

export function resolveWorkflowTemplate(
  strategy: OrchestrationStrategy,
  category: string,
  templateId?: string,
): WorkflowTemplate {
  if (templateId) {
    const found = strategy.templates.find((t) => t.id === templateId && t.enabled);
    if (found) return found;
  }

  const byCategory = strategy.templates.find(
    (t) => t.enabled && t.categoryDefaults?.includes(category),
  );
  if (byCategory) return byCategory;

  return (
    strategy.templates.find((t) => t.enabled) ?? {
      id: "fallback-single",
      name: "Fallback Single",
      mode: "single",
      agents: [],
      enabled: true,
    }
  );
}

export function buildExecutionPlan(
  template: WorkflowTemplate,
  strategy: OrchestrationStrategy,
  category: string,
): ExecutionPlan {
  const configuredAgents = strategy.categoryAgentMap[category] || [];

  if (template.mode === "single") {
    const agent = template.agents[0] || configuredAgents[0] || DEFAULT_EXECUTION_AGENT;
    return {
      templateId: template.id,
      mode: "single",
      steps: [{ id: "exec-0", type: "execution", status: "pending" }],
      candidates: [{ label: "主执行", agent, status: "pending" }],
    };
  }

  // parallel mode
  const maxCandidates = template.maxParallelCandidates ?? 3;
  const agents = template.agents.length > 0 ? template.agents : configuredAgents;
  const candidates: ExecutionCandidate[] = agents.slice(0, maxCandidates).map((agent, index) => ({
    label: `候选 ${index + 1}`,
    agent,
    role: "executor" as const,
    status: "pending" as const,
  }));

  const steps: ExecutionStep[] = [{ id: "exec-parallel", type: "execution", status: "pending" }];

  if (strategy.judge.enabled && candidates.length > 1) {
    steps.push({ id: "judge-0", type: "judge", status: "pending", dependsOn: ["exec-parallel"] });
  }

  return {
    templateId: template.id,
    mode: "parallel",
    steps,
    candidates,
  };
}
