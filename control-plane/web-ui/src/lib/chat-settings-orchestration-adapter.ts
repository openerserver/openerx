import type {
  ChatSettingsCurrentContext,
  ChatSettingsPendingPatch,
  ExecutionMode,
  OrchestrationCategorySummary,
  OrchestrationJudgeChange,
  OrchestrationPreviewModel,
  OrchestrationRiskHint,
  OrchestrationStrategy,
  OrchestrationStrategyChangeCard,
  OrchestrationTemplateChange,
  WorkflowTemplate,
} from "./api";

export const ORCHESTRATION_CATEGORIES = [
  "quick",
  "deep",
  "ops",
  "security",
  "architecture",
] as const;

function resolveTemplateForCategory(
  strategy: OrchestrationStrategy,
  category: string,
): WorkflowTemplate | null {
  const directMatch = strategy.templates.find(
    (template) => template.enabled !== false && template.categoryDefaults?.includes(category),
  );
  if (directMatch) {
    return directMatch;
  }

  const namedMatch = strategy.templates.find(
    (template) =>
      template.enabled !== false && (template.id === category || template.name === category),
  );
  if (namedMatch) {
    return namedMatch;
  }

  return (
    strategy.templates.find((template) => template.enabled !== false) ||
    strategy.templates[0] ||
    null
  );
}

function resolvePrimaryAgents(
  strategy: OrchestrationStrategy,
  category: string,
  template: WorkflowTemplate | null,
): string[] {
  const categoryAgents = strategy.categoryAgentMap[category];
  if (Array.isArray(categoryAgents) && categoryAgents.length > 0) {
    return categoryAgents;
  }

  if (template?.agents?.length) {
    return template.agents;
  }

  return [];
}

function resolvePrimaryModel(strategy: OrchestrationStrategy, category: string): string {
  return strategy.categoryModelMap[category] || "未指定";
}

function resolveExecutionMode(template: WorkflowTemplate | null): ExecutionMode | "unknown" {
  return template?.mode || "unknown";
}

function buildSummaryNotes(
  strategy: OrchestrationStrategy,
  category: string,
  template: WorkflowTemplate | null,
): string[] {
  const notes = [
    strategy.enablePipeline ? "pipeline 已启用" : "pipeline 已关闭",
    strategy.judge.enabled ? `judge 使用 ${strategy.judge.selectionStrategy}` : "judge 未启用",
  ];

  if (template?.description) {
    notes.push(template.description);
  }

  if (template?.categoryDefaults?.includes(category)) {
    notes.push(`默认模板命中 ${category}`);
  }

  return notes;
}

export function buildCategorySummariesFromStrategy(
  strategy: OrchestrationStrategy,
  categories: string[] = [...ORCHESTRATION_CATEGORIES],
): OrchestrationCategorySummary[] {
  return categories.map((category) => {
    const template = resolveTemplateForCategory(strategy, category);
    return {
      category,
      templateName: template?.name || template?.id || "未命中模板",
      executionMode: resolveExecutionMode(template),
      pipelineEnabled: strategy.enablePipeline,
      judgeEnabled: strategy.judge.enabled,
      judgeAgent: strategy.judge.agent || "未指定",
      judgeModel: strategy.judge.model || "未指定",
      primaryAgents: resolvePrimaryAgents(strategy, category, template),
      primaryModel: resolvePrimaryModel(strategy, category),
      notes: buildSummaryNotes(strategy, category, template),
    };
  });
}

function mergeStrategyPatch(
  strategy: OrchestrationStrategy,
  patch: Record<string, unknown>,
): OrchestrationStrategy {
  const typedPatch = patch as Partial<OrchestrationStrategy>;
  return {
    ...strategy,
    ...typedPatch,
    categoryAgentMap: typedPatch.categoryAgentMap
      ? { ...strategy.categoryAgentMap, ...typedPatch.categoryAgentMap }
      : strategy.categoryAgentMap,
    categoryModelMap: typedPatch.categoryModelMap
      ? { ...strategy.categoryModelMap, ...typedPatch.categoryModelMap }
      : strategy.categoryModelMap,
    hooks: typedPatch.hooks ?? strategy.hooks,
    templates: typedPatch.templates ?? strategy.templates,
    judge: typedPatch.judge ? { ...strategy.judge, ...typedPatch.judge } : strategy.judge,
  };
}

export function extractAffectedCategories(patch: ChatSettingsPendingPatch): string[] {
  const categories = new Set<string>();

  for (const category of Object.keys(patch.mermaidPreview || {})) {
    categories.add(category);
  }

  const typedPatch = patch.patch as {
    categoryAgentMap?: Record<string, string[]>;
    categoryModelMap?: Record<string, string>;
    templates?: Array<{ categoryDefaults?: string[] }>;
  };

  for (const category of Object.keys(typedPatch.categoryAgentMap || {})) {
    categories.add(category);
  }
  for (const category of Object.keys(typedPatch.categoryModelMap || {})) {
    categories.add(category);
  }
  for (const template of typedPatch.templates || []) {
    for (const category of template.categoryDefaults || []) {
      categories.add(category);
    }
  }

  return categories.size > 0 ? [...categories] : ["deep"];
}

export function buildJudgeChange(
  strategy: OrchestrationStrategy,
  patch: ChatSettingsPendingPatch,
): OrchestrationJudgeChange {
  const typedJudgePatch = (patch.patch as Partial<OrchestrationStrategy>).judge;
  return {
    changed: Boolean(typedJudgePatch),
    beforeEnabled: strategy.judge.enabled,
    afterEnabled: typedJudgePatch?.enabled ?? strategy.judge.enabled,
    beforeAgent: strategy.judge.agent || "未指定",
    afterAgent: (typedJudgePatch?.agent ?? strategy.judge.agent) || "未指定",
    beforeModel: strategy.judge.model || "未指定",
    afterModel: (typedJudgePatch?.model ?? strategy.judge.model) || "未指定",
  };
}

export function buildTemplateChanges(
  strategy: OrchestrationStrategy,
  patch: ChatSettingsPendingPatch,
  affectedCategories: string[],
): OrchestrationTemplateChange[] {
  const nextStrategy = mergeStrategyPatch(strategy, patch.patch);
  return affectedCategories.map((category) => {
    const beforeTemplate = resolveTemplateForCategory(strategy, category);
    const afterTemplate = resolveTemplateForCategory(nextStrategy, category);
    return {
      category,
      beforeTemplate: beforeTemplate?.name || beforeTemplate?.id || "未命中模板",
      afterTemplate: afterTemplate?.name || afterTemplate?.id || "未命中模板",
      beforeMode: resolveExecutionMode(beforeTemplate),
      afterMode: resolveExecutionMode(afterTemplate),
    };
  });
}

function buildCategoryChangeCards(
  strategy: OrchestrationStrategy,
  nextStrategy: OrchestrationStrategy,
  patch: ChatSettingsPendingPatch,
  affectedCategories: string[],
): OrchestrationStrategyChangeCard[] {
  return affectedCategories.map((category): OrchestrationStrategyChangeCard => {
    const beforeSummary = buildCategorySummariesFromStrategy(strategy, [category])[0];
    const afterSummary = buildCategorySummariesFromStrategy(nextStrategy, [category])[0];
    return {
      id: `category-${category}`,
      category,
      changeType: "template" as const,
      title: `${category} 编排策略预览`,
      summary: `${beforeSummary.executionMode} -> ${afterSummary.executionMode}，模板 ${beforeSummary.templateName} -> ${afterSummary.templateName}`,
      beforeLabel: `${beforeSummary.templateName} / ${beforeSummary.executionMode}`,
      afterLabel: `${afterSummary.templateName} / ${afterSummary.executionMode}`,
      riskLevel: beforeSummary.executionMode !== afterSummary.executionMode ? "medium" : "low",
      affectsJudge: beforeSummary.judgeEnabled !== afterSummary.judgeEnabled,
      affectsTemplate: beforeSummary.templateName !== afterSummary.templateName,
      mermaidCode: patch.mermaidPreview?.[category],
    };
  });
}

function prependJudgeChangeCard(
  cards: OrchestrationStrategyChangeCard[],
  judgeChange: OrchestrationJudgeChange,
  affectedCategories: string[],
) {
  if (!judgeChange.changed) {
    return;
  }

  cards.unshift({
    id: "judge-change",
    category: affectedCategories[0] || "global",
    changeType: "judge",
    title: "Judge 策略变化",
    summary: `${judgeChange.beforeEnabled ? "启用" : "关闭"} -> ${judgeChange.afterEnabled ? "启用" : "关闭"}`,
    beforeLabel: `${judgeChange.beforeAgent} / ${judgeChange.beforeModel}`,
    afterLabel: `${judgeChange.afterAgent} / ${judgeChange.afterModel}`,
    riskLevel: judgeChange.afterEnabled ? "high" : "medium",
    affectsJudge: true,
    affectsTemplate: false,
  });
}

function prependPipelineChangeCard(
  cards: OrchestrationStrategyChangeCard[],
  strategy: OrchestrationStrategy,
  patch: ChatSettingsPendingPatch,
  affectedCategories: string[],
) {
  const typedPatch = patch.patch as Partial<OrchestrationStrategy>;
  if (typeof typedPatch.enablePipeline !== "boolean") {
    return;
  }

  cards.unshift({
    id: "pipeline-change",
    category: affectedCategories[0] || "global",
    changeType: "pipeline",
    title: "Pipeline 开关变化",
    summary: `${strategy.enablePipeline ? "启用" : "关闭"} -> ${typedPatch.enablePipeline ? "启用" : "关闭"}`,
    beforeLabel: strategy.enablePipeline ? "pipeline 已启用" : "pipeline 已关闭",
    afterLabel: typedPatch.enablePipeline ? "pipeline 已启用" : "pipeline 已关闭",
    riskLevel: typedPatch.enablePipeline ? "medium" : "high",
    affectsJudge: false,
    affectsTemplate: false,
  });
}

export function buildChangeCards(
  strategy: OrchestrationStrategy,
  patch: ChatSettingsPendingPatch,
  affectedCategories: string[],
): OrchestrationStrategyChangeCard[] {
  const nextStrategy = mergeStrategyPatch(strategy, patch.patch);
  const cards = buildCategoryChangeCards(strategy, nextStrategy, patch, affectedCategories);
  const judgeChange = buildJudgeChange(strategy, patch);
  prependJudgeChangeCard(cards, judgeChange, affectedCategories);
  prependPipelineChangeCard(cards, strategy, patch, affectedCategories);

  return cards;
}

export function buildPreviewFromPatch(
  strategy: OrchestrationStrategy,
  patch: ChatSettingsPendingPatch,
): OrchestrationPreviewModel {
  const affectedCategories = extractAffectedCategories(patch);
  const strategyAfter = mergeStrategyPatch(strategy, patch.patch);
  const strategySummaryBefore = buildCategorySummariesFromStrategy(strategy);
  const strategySummaryAfter = buildCategorySummariesFromStrategy(strategyAfter);
  const judgeChange = buildJudgeChange(strategy, patch);
  const templateChanges = buildTemplateChanges(strategy, patch, affectedCategories);
  return {
    configVersion: patch.configVersion,
    explanation: patch.explanation,
    affectedCategories,
    changeCards: buildChangeCards(strategy, patch, affectedCategories),
    judgeChange,
    templateChanges,
    strategySummaryBefore,
    strategySummaryAfter,
    riskHints: [
      judgeChange.changed && judgeChange.afterEnabled
        ? { level: "high", summary: "本次变更会启用 judge，最终候选选择逻辑会发生变化。" }
        : null,
      templateChanges.some((item) => item.beforeMode !== item.afterMode)
        ? {
            level: "medium",
            summary: `执行模式变化影响 ${affectedCategories.join(", ")} 分类的主执行链路。`,
          }
        : null,
    ].filter((item): item is OrchestrationRiskHint => Boolean(item)),
    mermaidPreview: patch.mermaidPreview || {},
    rawPatch: patch.patch,
  };
}

export function buildOrchestrationContext(
  context: ChatSettingsCurrentContext,
): ChatSettingsCurrentContext & {
  orchestrationVersion: string;
  categorySummaries: OrchestrationCategorySummary[];
  supportedCategories: string[];
} {
  return {
    ...context,
    orchestrationVersion:
      context.orchestrationVersion || context.configVersions["orchestration-strategy"],
    categorySummaries:
      context.categorySummaries || buildCategorySummariesFromStrategy(context.strategy),
    supportedCategories: context.supportedCategories || [...ORCHESTRATION_CATEGORIES],
  };
}
