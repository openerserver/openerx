import type { ChainStepInput, ExecutionMode, JudgeConfig, Task } from "./api";

export const DEFAULT_JUDGE_PROMPT = [
  "你是 Opener-X 聚合评判 Agent。以下是同一个任务交给多个不同 Agent 执行的结果。",
  "请根据代码质量、任务完成度和实现合理性为每个 Candidate 打分(0-100)，并选出最佳结果。",
  "",
  "任务标题: {{taskTitle}}",
  "任务需求:",
  "{{taskPrompt}}",
  "",
  "{{candidateResults}}",
  "",
  '请按以下 JSON 格式输出:',
  '{"winnerIndex": 0, "scores": [85, 72], "reasoning": "..."}',
].join("\n");

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  enabled: false,
  agent: "prometheus-enterprise",
  model: "",
  promptTemplate: DEFAULT_JUDGE_PROMPT,
  timeoutMs: 30000,
  selectionStrategy: "judge-pick",
};

export type ExecutionOverrides = {
  mode: ExecutionMode;
  candidates?: Array<{ model: string; label?: string }>;
  steps?: ChainStepInput[];
  judge?: JudgeConfig;
} | null;

type ExecutionPlanLike = {
  mode?: ExecutionMode;
  candidates?: Array<{ model?: string; label?: string }>;
  steps?: Array<{
    id?: string;
    type?: string;
    title?: string;
    instruction?: string;
    model?: string | null;
  }>;
};

type StrategyLike = {
  executionMode?: unknown;
  parallelCandidates?: unknown;
  sequentialSteps?: unknown;
  judge?: unknown;
};

type JudgeLike = Partial<JudgeConfig> | null;

function parseJsonObject(raw?: string | null): Record<string, unknown> | null {
  if (!raw || !raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseExecutionPlan(task: Pick<Task, "executionPlan"> | null | undefined): ExecutionPlanLike | null {
  return parseJsonObject(task?.executionPlan) as ExecutionPlanLike | null;
}

function parseTaskStrategy(task: Pick<Task, "strategy"> | null | undefined): StrategyLike | null {
  return parseJsonObject(task?.strategy) as StrategyLike | null;
}

function isExecutionMode(value: unknown): value is ExecutionMode {
  return value === "single" || value === "parallel" || value === "sequential-chain";
}

function normalizeJudge(raw: JudgeLike): JudgeConfig {
  return {
    enabled: raw?.enabled ?? DEFAULT_JUDGE_CONFIG.enabled,
    agent: typeof raw?.agent === "string" && raw.agent.trim() ? raw.agent : DEFAULT_JUDGE_CONFIG.agent,
    model: typeof raw?.model === "string" ? raw.model : DEFAULT_JUDGE_CONFIG.model,
    promptTemplate:
      typeof raw?.promptTemplate === "string" && raw.promptTemplate.trim()
        ? raw.promptTemplate
        : DEFAULT_JUDGE_CONFIG.promptTemplate,
    timeoutMs:
      typeof raw?.timeoutMs === "number" && Number.isFinite(raw.timeoutMs) && raw.timeoutMs >= 10000
        ? raw.timeoutMs
        : DEFAULT_JUDGE_CONFIG.timeoutMs,
    selectionStrategy:
      raw?.selectionStrategy === "highest-score" || raw?.selectionStrategy === "judge-pick"
        ? raw.selectionStrategy
        : DEFAULT_JUDGE_CONFIG.selectionStrategy,
  };
}

export function resolveEditableExecutionMode(
  task: Pick<Task, "executionMode" | "executionPlan" | "strategy"> | null | undefined,
): ExecutionMode {
  if (isExecutionMode(task?.executionMode)) {
    return task.executionMode;
  }

  const executionPlan = parseExecutionPlan(task);
  if (isExecutionMode(executionPlan?.mode)) {
    return executionPlan.mode;
  }

  const strategy = parseTaskStrategy(task);
  if (isExecutionMode(strategy?.executionMode)) {
    return strategy.executionMode;
  }

  return "single";
}

export function resolveEditableParallelCandidates(
  task: Pick<Task, "strategy" | "executionPlan"> | null | undefined,
) {
  const strategy = parseTaskStrategy(task);
  if (Array.isArray(strategy?.parallelCandidates) && strategy.parallelCandidates.length > 0) {
    return strategy.parallelCandidates
      .filter(
        (candidate): candidate is { model: string; label?: string } =>
          Boolean(candidate) &&
          typeof candidate === "object" &&
          typeof (candidate as { model?: unknown }).model === "string" &&
          (candidate as { model: string }).model.trim().length > 0,
      )
      .map((candidate, index) => ({
        model: candidate.model,
        label: candidate.label || `候选 ${String.fromCharCode(65 + index)}`,
      }));
  }

  const executionPlan = parseExecutionPlan(task);
  if (Array.isArray(executionPlan?.candidates) && executionPlan.candidates.length > 0) {
    return executionPlan.candidates
      .filter(
        (candidate): candidate is { model: string; label?: string } =>
          Boolean(candidate?.model) && typeof candidate.model === "string" && candidate.model.trim().length > 0,
      )
      .map((candidate, index) => ({
        model: candidate.model,
        label: candidate.label || `候选 ${String.fromCharCode(65 + index)}`,
      }));
  }

  return [] as Array<{ model: string; label?: string }>;
}

export function resolveEditableSequentialSteps(
  task: Pick<Task, "strategy" | "executionPlan"> | null | undefined,
): ChainStepInput[] {
  const strategy = parseTaskStrategy(task);
  if (Array.isArray(strategy?.sequentialSteps) && strategy.sequentialSteps.length > 0) {
    return strategy.sequentialSteps
      .filter(
        (step): step is ChainStepInput =>
          Boolean(step) &&
          typeof step === "object" &&
          typeof (step as { id?: unknown }).id === "string" &&
          typeof (step as { title?: unknown }).title === "string" &&
          typeof (step as { instruction?: unknown }).instruction === "string",
      )
      .map((step) => ({
        id: step.id,
        title: step.title,
        instruction: step.instruction,
        ...(step.model ? { model: step.model } : {}),
      }));
  }

  const executionPlan = parseExecutionPlan(task);
  if (Array.isArray(executionPlan?.steps) && executionPlan.steps.length > 0) {
    return executionPlan.steps
      .filter(
        (step): step is Required<Pick<ChainStepInput, "title" | "instruction">> & {
          id?: string;
          model?: string | null;
          type?: string;
        } =>
          step?.type === "chain-step" &&
          typeof step.title === "string" &&
          step.title.trim().length > 0 &&
          typeof step.instruction === "string" &&
          step.instruction.trim().length > 0,
      )
      .map((step, index) => ({
        id: step.id || `step-${index + 1}`,
        title: step.title,
        instruction: step.instruction,
        ...(typeof step.model === "string" && step.model.trim() ? { model: step.model } : {}),
      }));
  }

  return [];
}

export function resolveEditableJudgeConfig(
  task: Pick<Task, "strategy"> | null | undefined,
): JudgeConfig {
  const strategy = parseTaskStrategy(task);
  const rawJudge = strategy?.judge && typeof strategy.judge === "object"
    ? (strategy.judge as Partial<JudgeConfig>)
    : null;
  return normalizeJudge(rawJudge);
}

export function buildSavedExecutionPlan(
  task: Pick<Task, "selectedModel"> | null | undefined,
  overrides: ExecutionOverrides,
): string {
  if (overrides?.mode === "parallel") {
    const candidates = (overrides.candidates ?? []).map((candidate, index) => ({
      label: candidate.label || `候选 ${index + 1}`,
      agent: "default-executor",
      model: candidate.model,
      role: "executor",
      status: "pending",
    }));

    const steps: Array<Record<string, unknown>> = [
      { id: "exec-parallel", type: "execution", status: "pending" },
    ];
    if (overrides.judge?.enabled) {
      steps.push({
        id: "judge-0",
        type: "judge",
        status: "pending",
        dependsOn: ["exec-parallel"],
      });
    }

    return JSON.stringify({
      mode: "parallel",
      steps,
      candidates,
    });
  }

  if (overrides?.mode === "sequential-chain") {
    const steps = (overrides.steps ?? []).map((step, index) => ({
      id: step.id || `step-${index + 1}`,
      type: "chain-step",
      status: "pending",
      title: step.title,
      instruction: step.instruction,
      ...(step.model ? { model: step.model } : {}),
      ...(index > 0 ? { dependsOn: [overrides.steps?.[index - 1]?.id || `step-${index}`] } : {}),
    }));

    return JSON.stringify({
      mode: "sequential-chain",
      steps,
      candidates: [
        {
          label: "主执行",
          agent: "default-executor",
          ...(task?.selectedModel ? { model: task.selectedModel } : {}),
          status: "pending",
        },
      ],
      currentChainStepIndex: 0,
    });
  }

  return JSON.stringify({
    mode: "single",
    steps: [{ id: "exec-0", type: "execution", status: "pending" }],
    candidates: [
      {
        label: "主执行",
        agent: "default-executor",
        ...(task?.selectedModel ? { model: task.selectedModel } : {}),
        status: "pending",
      },
    ],
  });
}

export function serializeTaskStrategy(
  task: Pick<Task, "strategy"> | null | undefined,
  overrides: ExecutionOverrides,
) {
  const current = parseTaskStrategy(task) ?? {};

  const next: Record<string, unknown> = {
    ...current,
    executionMode: overrides?.mode ?? "single",
  };

  if (overrides?.mode === "parallel") {
    next.parallelCandidates = overrides.candidates ?? [];
    next.judge = normalizeJudge(overrides.judge ?? null);
    delete next.sequentialSteps;
  } else if (overrides?.mode === "sequential-chain") {
    next.sequentialSteps = overrides.steps ?? [];
    delete next.judge;
    delete next.parallelCandidates;
  } else {
    delete next.judge;
    delete next.parallelCandidates;
    delete next.sequentialSteps;
  }

  return JSON.stringify(next);
}