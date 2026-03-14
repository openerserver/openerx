import type {
  ExecutionPlan,
  LifecycleHook,
  OrchestrationStrategy,
  WorkflowTemplate,
} from "./orchestration-strategy";

const DEFAULT_CATEGORIES = ["quick", "deep", "ops", "security", "architecture"];

function sanitizeParticipantId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_") || "participant";
}

function pushUnique(lines: string[], seen: Set<string>, line: string) {
  if (!seen.has(line)) {
    seen.add(line);
    lines.push(line);
  }
}

function formatAgentLabel(agent: string): string {
  return agent || "default-executor";
}

function resolveTemplateForCategory(
  strategy: OrchestrationStrategy,
  category: string,
): WorkflowTemplate | undefined {
  return (
    strategy.templates.find((template) => template.enabled && template.categoryDefaults?.includes(category)) ??
    strategy.templates.find((template) => template.enabled)
  );
}

export function strategyToSequenceDiagram(
  strategy: OrchestrationStrategy,
  category?: string,
): string {
  const targetCategory = category || DEFAULT_CATEGORIES[0] || "quick";
  const template = resolveTemplateForCategory(strategy, targetCategory);
  const participantLines: string[] = [
    "participant Admin as 管理员",
    "participant Engine as 编排引擎",
  ];
  const seenParticipants = new Set<string>(participantLines);
  const sequenceLines: string[] = [
    "sequenceDiagram",
    ...participantLines,
    `Admin->>Engine: 提交任务(${targetCategory})`,
    `Engine->>Engine: 意图分类 -> ${targetCategory}`,
  ];

  if (template) {
    sequenceLines.push(`Engine->>Engine: 模板匹配 -> ${template.id}`);
  } else {
    sequenceLines.push("Engine->>Engine: 模板匹配 -> default-single");
  }

  const preHooks = strategy.hooks
    .filter((hook) => hook.enabled && hook.trigger === "pre-execution")
    .sort((left, right) => left.order - right.order);

  for (const hook of preHooks) {
    const id = sanitizeParticipantId(`hook_${hook.id}`);
    pushUnique(sequenceLines, seenParticipants, `participant ${id} as 预执行Hook(${formatAgentLabel(hook.agent)})`);
    sequenceLines.push(`Engine->>${id}: 执行预检查`);
    sequenceLines.push(`${id}-->>Engine: 返回决策`);
  }

  const configuredAgents = template?.agents?.length
    ? template.agents
    : strategy.categoryAgentMap[targetCategory] || [];

  if (template?.mode === "parallel" && configuredAgents.length > 1) {
    sequenceLines.push("par 并行候选执行");
    configuredAgents
      .slice(0, template.maxParallelCandidates ?? 3)
      .forEach((agent: string, index: number) => {
      const id = sanitizeParticipantId(`candidate_${index}_${agent}`);
      pushUnique(sequenceLines, seenParticipants, `participant ${id} as ${formatAgentLabel(agent)}`);
      sequenceLines.push(`  Engine->>${id}: 候选 ${index + 1} 执行`);
      sequenceLines.push(`  ${id}-->>Engine: 返回结果 ${index + 1}`);
      });
    sequenceLines.push("end");
  } else {
    const agent = configuredAgents[0] || "default-executor";
    const id = sanitizeParticipantId(`executor_${agent}`);
    pushUnique(sequenceLines, seenParticipants, `participant ${id} as ${formatAgentLabel(agent)}`);
    sequenceLines.push(`Engine->>${id}: 主执行`);
    sequenceLines.push(`${id}-->>Engine: 返回结果`);
  }

  if (strategy.judge.enabled && configuredAgents.length > 1) {
    const judgeId = sanitizeParticipantId(`judge_${strategy.judge.agent || "judge"}`);
    pushUnique(sequenceLines, seenParticipants, `participant ${judgeId} as 裁判(${formatAgentLabel(strategy.judge.agent)})`);
    sequenceLines.push(`Engine->>${judgeId}: 评分选优`);
    sequenceLines.push(`${judgeId}-->>Engine: 返回胜出候选`);
  }

  const postHooks = strategy.hooks
    .filter((hook) => hook.enabled && hook.trigger === "post-execution")
    .sort((left, right) => left.order - right.order);

  for (const hook of postHooks) {
    const id = sanitizeParticipantId(`post_${hook.id}`);
    pushUnique(sequenceLines, seenParticipants, `participant ${id} as 后执行Hook(${formatAgentLabel(hook.agent)})`);
    sequenceLines.push(`Engine->>${id}: 执行后检查`);
    sequenceLines.push(`${id}-->>Engine: 返回审查结论`);
  }

  sequenceLines.push("Engine-->>Admin: 返回结果");
  return sequenceLines.join("\n");
}

export function buildStrategyMermaidMap(strategy: OrchestrationStrategy): Record<string, string> {
  return DEFAULT_CATEGORIES.reduce<Record<string, string>>((accumulator, category) => {
    accumulator[category] = strategyToSequenceDiagram(strategy, category);
    return accumulator;
  }, {});
}

export function executionPlanToSequenceDiagram(
  plan: ExecutionPlan,
  hooks: LifecycleHook[] = [],
): string {
  const lines = ["sequenceDiagram", "participant Engine as 编排引擎"];
  const seen = new Set(lines);

  hooks.forEach((hook) => {
    const id = sanitizeParticipantId(`hook_${hook.id}`);
    pushUnique(lines, seen, `participant ${id} as ${hook.trigger}(${formatAgentLabel(hook.agent)})`);
  });

  plan.candidates.forEach((candidate, index) => {
    const id = sanitizeParticipantId(`candidate_${index}_${candidate.agent}`);
    pushUnique(lines, seen, `participant ${id} as ${formatAgentLabel(candidate.agent)}`);
  });

  hooks
    .filter((hook) => hook.trigger === "pre-execution")
    .forEach((hook) => {
      const id = sanitizeParticipantId(`hook_${hook.id}`);
      lines.push(`Engine->>${id}: 执行 ${hook.trigger}`);
      lines.push(`${id}-->>Engine: ${hook.trigger} 完成`);
    });

  if (plan.mode === "parallel" && plan.candidates.length > 1) {
    lines.push("par 并行执行");
    plan.candidates.forEach((candidate, index) => {
      const id = sanitizeParticipantId(`candidate_${index}_${candidate.agent}`);
      lines.push(`  Engine->>${id}: ${candidate.label}`);
      lines.push(`  ${id}-->>Engine: ${candidate.status}`);
    });
    lines.push("end");
  } else if (plan.candidates[0]) {
    const candidate = plan.candidates[0];
    const id = sanitizeParticipantId(`candidate_0_${candidate.agent}`);
    lines.push(`Engine->>${id}: ${candidate.label}`);
    lines.push(`${id}-->>Engine: ${candidate.status}`);
  }

  if (typeof plan.winnerCandidateIndex === "number") {
    lines.push(`Engine->>Engine: 选中候选 ${plan.winnerCandidateIndex + 1}`);
  }

  return lines.join("\n");
}