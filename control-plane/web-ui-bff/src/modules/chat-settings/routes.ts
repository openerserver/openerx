import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  buildJsonVisualizations,
  buildModelsVisualizations,
} from "../../lib/chat-settings-visualization";
import { parseFrontmatter } from "../../lib/frontmatter";
import { buildStrategyMermaidMap } from "../../lib/orchestration-mermaid";
import {
  type OrchestrationStrategy,
  type WorkflowTemplate,
  getOrchestrationStrategyVersion,
  readOrchestrationStrategy,
} from "../../lib/orchestration-strategy";
import type { JWTPayload } from "../../middleware/auth";
import { getAllowedPluginSourcePrefixes } from "../config/routes";
import { runChatSettingsAssistant } from "./assistant-engine";
import {
  applyAgentPatch,
  applyCommandPatch,
  applyMcpPatch,
  applyModelsPatch,
  applyOrchestrationStrategyPatch,
  applyPluginsPatch,
  applySecurityPatch,
  applySkillPatch,
  getAgentConfigVersion,
  getCommandConfigVersion,
  getMcpConfigVersion,
  getModelsConfigVersion,
  getPluginsConfigVersion,
  getSecurityConfigVersion,
  getSkillConfigVersion,
  readCommandConfig,
  readMcpConfig,
  readModelsConfig,
  readPluginsConfig,
  readSecurityBaselineConfig,
  readSkillConfig,
} from "./config-patch-applier";
import {
  type PendingPatch,
  chatSettingsConversationManager,
  verifyPendingPatchSignature,
} from "./conversation-manager";
import { assertAllowedChatSettingsModel } from "./model-guard";
import type {
  OrchestrationCategorySummary,
  OrchestrationChangeCard,
  OrchestrationExecutionMode,
  OrchestrationJudgeChange,
  OrchestrationRiskHint,
  OrchestrationStrategyPreview,
  OrchestrationTemplateChange,
} from "./types";

type AppEnv = { Variables: { user: JWTPayload } };

const OPENCODE_ROOT = resolve(
  process.env.OPENCODE_ROOT || join(__dirname, "../../../../../opencode-fork"),
);
const DOT_OPENCODE = join(OPENCODE_ROOT, ".opencode");
const OPENCODE_JSON = join(OPENCODE_ROOT, "opencode.json");
const AGENTS_DIR = join(DOT_OPENCODE, "agents");
const SKILLS_DIR = join(DOT_OPENCODE, "skills");
const COMMANDS_DIR = join(DOT_OPENCODE, "commands");
const PLUGINS_DIR = join(DOT_OPENCODE, "plugins");
const ORCHESTRATION_CATEGORIES = ["quick", "deep", "ops", "security", "architecture"] as const;

function requireSystemAdmin(user: JWTPayload): string | null {
  if (user.role === "platform_admin" || user.role === "org_admin" || user.role === "admin") {
    return null;
  }
  return "Requires org_admin role";
}

function readOpencodeJson(): Record<string, unknown> {
  if (!existsSync(OPENCODE_JSON)) {
    return {};
  }
  return JSON.parse(readFileSync(OPENCODE_JSON, "utf-8")) as Record<string, unknown>;
}

function getConfiguredDefaultModelRoute(config: Record<string, unknown>): string | null {
  const defaults = (config.agents as Record<string, unknown> | undefined)?.defaults as
    | Record<string, unknown>
    | undefined;
  const defaultsModel = typeof defaults?.model === "string" ? defaults.model.trim() : "";
  const rootModel = typeof config.model === "string" ? config.model.trim() : "";
  return defaultsModel || rootModel || null;
}

function parseModelRoute(
  route: string,
): { providerId: string; modelId: string; route: string } | null {
  const value = route.trim();
  if (!value) return null;
  const slashIndex = value.indexOf("/");
  if (slashIndex > 0) {
    return {
      providerId: value.slice(0, slashIndex),
      modelId: value.slice(slashIndex + 1),
      route: `${value.slice(0, slashIndex)}:${value.slice(slashIndex + 1)}`,
    };
  }
  const colonIndex = value.indexOf(":");
  if (colonIndex > 0) {
    return {
      providerId: value.slice(0, colonIndex),
      modelId: value.slice(colonIndex + 1),
      route: value,
    };
  }
  return null;
}

const WELL_KNOWN_COPILOT_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "gpt-4o",
  "o3-mini",
  "gemini-2.5-pro",
];

function getRawConfiguredModels(config: Record<string, unknown>) {
  const models = config.models as Record<string, unknown> | undefined;
  return Array.isArray(models?.list) ? (models.list as Array<Record<string, unknown>>) : [];
}

function buildConfiguredModelRoute(item: Record<string, unknown>) {
  const provider = typeof item.provider === "string" ? item.provider.trim() : "";
  const id = typeof item.id === "string" ? item.id.trim() : "";
  return provider && id ? `${provider}:${id}` : null;
}

function appendExplicitProviderModels(
  routes: string[],
  providerName: string,
  providerConfig: Record<string, unknown>,
) {
  if (!providerConfig.models || typeof providerConfig.models !== "object") {
    return;
  }

  for (const modelId of Object.keys(providerConfig.models as Record<string, unknown>)) {
    const trimmedModelId = modelId.trim();
    if (trimmedModelId) {
      routes.push(`${providerName}:${trimmedModelId}`);
    }
  }
}

function appendWellKnownCopilotModels(routes: string[], providerName: string) {
  if (providerName !== "github-copilot" && !providerName.startsWith("github-copilot-")) {
    return;
  }

  for (const modelId of WELL_KNOWN_COPILOT_MODELS) {
    routes.push(`${providerName}:${modelId}`);
  }
}

function listConfiguredModels(): string[] {
  const config = readOpencodeJson();
  const routes = getRawConfiguredModels(config)
    .map(buildConfiguredModelRoute)
    .filter((item): item is string => Boolean(item));
  const providers = (config.provider as Record<string, Record<string, unknown>> | undefined) || {};

  for (const [providerName, providerConfig] of Object.entries(providers)) {
    if (!providerConfig || typeof providerConfig !== "object") continue;

    appendExplicitProviderModels(routes, providerName, providerConfig);
    appendWellKnownCopilotModels(routes, providerName);
  }

  const defaultRoute = getConfiguredDefaultModelRoute(config);
  if (defaultRoute) {
    routes.unshift(defaultRoute.includes("/") ? defaultRoute.replace("/", ":") : defaultRoute);
  }

  return Array.from(new Set(routes));
}

function listAgents(): string[] {
  if (!existsSync(AGENTS_DIR)) {
    return [];
  }

  return readdirSync(AGENTS_DIR)
    .filter((fileName) => fileName.endsWith(".md"))
    .map((fileName) => {
      const content = readFileSync(join(AGENTS_DIR, fileName), "utf-8");
      const { frontmatter } = parseFrontmatter(content);
      return typeof frontmatter.name === "string" && frontmatter.name.trim()
        ? frontmatter.name.trim()
        : basename(fileName, ".md");
    });
}

function listAgentSummaries() {
  if (!existsSync(AGENTS_DIR)) {
    return [] as Array<{ fileName: string; name: string; description: string; model: string }>;
  }

  return readdirSync(AGENTS_DIR)
    .filter((fileName) => fileName.endsWith(".md"))
    .map((fileName) => {
      const content = readFileSync(join(AGENTS_DIR, fileName), "utf-8");
      const { frontmatter } = parseFrontmatter(content);
      return {
        fileName,
        name:
          typeof frontmatter.name === "string" && frontmatter.name.trim()
            ? frontmatter.name.trim()
            : basename(fileName, ".md"),
        description: typeof frontmatter.description === "string" ? frontmatter.description : "",
        model: typeof frontmatter.model === "string" ? frontmatter.model : "",
      };
    });
}

function listSkillSummaries() {
  if (!existsSync(SKILLS_DIR)) {
    return [] as Array<{
      dirName: string;
      name: string;
      description: string;
      permissions?: Record<string, unknown>;
    }>;
  }

  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillName = entry.name;
      const detail = readSkillConfig(skillName);
      return {
        dirName: skillName,
        name: typeof detail?.frontmatter.name === "string" ? detail.frontmatter.name : skillName,
        description:
          typeof detail?.frontmatter.description === "string" ? detail.frontmatter.description : "",
        permissions:
          detail?.frontmatter.metadata && typeof detail.frontmatter.metadata === "object"
            ? ((detail.frontmatter.metadata as Record<string, unknown>).permissions as
                | Record<string, unknown>
                | undefined)
            : undefined,
      };
    });
}

function listCommandSummaries() {
  if (!existsSync(COMMANDS_DIR)) {
    return [] as Array<{ fileName: string; name: string; description: string }>;
  }

  return readdirSync(COMMANDS_DIR)
    .filter((fileName) => fileName.endsWith(".md"))
    .map((fileName) => {
      const name = basename(fileName, ".md");
      const detail = readCommandConfig(name);
      return {
        fileName,
        name,
        description:
          typeof detail?.frontmatter.description === "string" ? detail.frontmatter.description : "",
      };
    });
}

function listInstallablePluginSources() {
  const pluginState = new Map(
    readPluginsConfig().plugins.map((plugin) => [plugin.name, plugin.enabled !== false] as const),
  );

  if (!existsSync(PLUGINS_DIR)) {
    return [] as Array<{ source: string; name: string; installed: boolean; enabled: boolean }>;
  }

  return readdirSync(PLUGINS_DIR)
    .filter((fileName) => fileName.endsWith(".ts"))
    .map((fileName) => {
      const name = basename(fileName, ".ts");
      const installed = pluginState.has(name);
      return {
        source: `./.opencode/plugins/${fileName}`,
        name,
        installed,
        enabled: installed ? Boolean(pluginState.get(name)) : false,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildConfigVersions() {
  const agents = listAgents();
  const skills = listSkillSummaries();
  const commands = listCommandSummaries();
  return {
    "orchestration-strategy": getOrchestrationStrategyVersion(),
    models: getModelsConfigVersion(),
    mcp: getMcpConfigVersion(),
    security: getSecurityConfigVersion(),
    plugins: getPluginsConfigVersion(),
    agents: agents.reduce<Record<string, string>>((accumulator, name) => {
      accumulator[name] = getAgentConfigVersion(name);
      return accumulator;
    }, {}),
    skills: skills.reduce<Record<string, string>>((accumulator, skill) => {
      accumulator[skill.dirName] = getSkillConfigVersion(skill.dirName);
      return accumulator;
    }, {}),
    commands: commands.reduce<Record<string, string>>((accumulator, command) => {
      accumulator[command.name] = getCommandConfigVersion(command.name);
      return accumulator;
    }, {}),
  };
}

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

function resolveExecutionMode(template: WorkflowTemplate | null): OrchestrationExecutionMode {
  return template?.mode || "unknown";
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

function buildCategorySummaries(strategy: OrchestrationStrategy): OrchestrationCategorySummary[] {
  return [...ORCHESTRATION_CATEGORIES].map((category) => {
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

function extractAffectedCategories(
  patch: Record<string, unknown>,
  mermaidPreview: Record<string, string>,
): string[] {
  const categories = new Set<string>();
  for (const category of Object.keys(mermaidPreview || {})) {
    categories.add(category);
  }

  const typedPatch = patch as {
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

function buildJudgeChange(
  strategy: OrchestrationStrategy,
  patch: Record<string, unknown>,
): OrchestrationJudgeChange {
  const typedJudgePatch = (patch as Partial<OrchestrationStrategy>).judge;
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

function buildTemplateChanges(
  strategyBefore: OrchestrationStrategy,
  strategyAfter: OrchestrationStrategy,
  affectedCategories: string[],
): OrchestrationTemplateChange[] {
  return affectedCategories.map((category) => {
    const beforeTemplate = resolveTemplateForCategory(strategyBefore, category);
    const afterTemplate = resolveTemplateForCategory(strategyAfter, category);
    return {
      category,
      beforeTemplate: beforeTemplate?.name || beforeTemplate?.id || "未命中模板",
      afterTemplate: afterTemplate?.name || afterTemplate?.id || "未命中模板",
      beforeMode: resolveExecutionMode(beforeTemplate),
      afterMode: resolveExecutionMode(afterTemplate),
    };
  });
}

function getCategorySummary(
  summaries: OrchestrationCategorySummary[],
  category: string,
): OrchestrationCategorySummary {
  const summary = summaries.find((item) => item.category === category);
  if (!summary) {
    throw new Error(`Missing orchestration summary for category: ${category}`);
  }
  return summary;
}

function buildCategoryChangeCard(args: {
  category: string;
  beforeSummary: OrchestrationCategorySummary;
  afterSummary: OrchestrationCategorySummary;
  mermaidCode?: string;
}): OrchestrationChangeCard {
  const { category, beforeSummary, afterSummary, mermaidCode } = args;
  return {
    id: `category-${category}`,
    category,
    changeType: "template",
    title: `${category} 编排策略预览`,
    summary: `${beforeSummary.executionMode} -> ${afterSummary.executionMode}，模板 ${beforeSummary.templateName} -> ${afterSummary.templateName}`,
    beforeLabel: `${beforeSummary.templateName} / ${beforeSummary.executionMode}`,
    afterLabel: `${afterSummary.templateName} / ${afterSummary.executionMode}`,
    riskLevel: beforeSummary.executionMode !== afterSummary.executionMode ? "medium" : "low",
    affectsJudge: beforeSummary.judgeEnabled !== afterSummary.judgeEnabled,
    affectsTemplate: beforeSummary.templateName !== afterSummary.templateName,
    mermaidCode,
  };
}

function buildJudgeChangeCard(
  affectedCategories: string[],
  judgeChange: OrchestrationJudgeChange,
): OrchestrationChangeCard | null {
  if (!judgeChange.changed) {
    return null;
  }

  return {
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
  };
}

function buildPipelineChangeCard(
  affectedCategories: string[],
  patch: Partial<OrchestrationStrategy>,
): OrchestrationChangeCard | null {
  if (typeof patch.enablePipeline !== "boolean") {
    return null;
  }

  return {
    id: "pipeline-change",
    category: affectedCategories[0] || "global",
    changeType: "pipeline",
    title: "Pipeline 开关变化",
    summary: `${patch.enablePipeline ? "启用" : "关闭"} pipeline 并影响当前分类执行链路`,
    beforeLabel: patch.enablePipeline ? "pipeline 已关闭" : "pipeline 已启用",
    afterLabel: patch.enablePipeline ? "pipeline 已启用" : "pipeline 已关闭",
    riskLevel: patch.enablePipeline ? "medium" : "high",
    affectsJudge: false,
    affectsTemplate: false,
  };
}

function buildChangeCards(args: {
  affectedCategories: string[];
  beforeSummaries: OrchestrationCategorySummary[];
  afterSummaries: OrchestrationCategorySummary[];
  judgeChange: OrchestrationJudgeChange;
  patch: Record<string, unknown>;
  mermaidPreview: Record<string, string>;
}): OrchestrationChangeCard[] {
  const typedPatch = args.patch as Partial<OrchestrationStrategy>;
  const cards = args.affectedCategories.map((category) =>
    buildCategoryChangeCard({
      category,
      beforeSummary: getCategorySummary(args.beforeSummaries, category),
      afterSummary: getCategorySummary(args.afterSummaries, category),
      mermaidCode: args.mermaidPreview[category],
    }),
  );
  const judgeCard = buildJudgeChangeCard(args.affectedCategories, args.judgeChange);
  const pipelineCard = buildPipelineChangeCard(args.affectedCategories, typedPatch);

  return [pipelineCard, judgeCard, ...cards].filter((card): card is OrchestrationChangeCard =>
    Boolean(card),
  );
}

function hasExecutionModeChange(templateChanges: OrchestrationTemplateChange[]) {
  return templateChanges.some((item) => item.beforeMode !== item.afterMode);
}

function buildNoOpRiskHint(): OrchestrationRiskHint {
  return { level: "low", summary: "这次变更主要是编排摘要层面的微调，影响范围有限。" };
}

function buildRiskHints(args: {
  affectedCategories: string[];
  judgeChange: OrchestrationJudgeChange;
  templateChanges: OrchestrationTemplateChange[];
  patch: Record<string, unknown>;
}): OrchestrationRiskHint[] {
  const riskHints: OrchestrationRiskHint[] = [];
  if (args.judgeChange.changed && args.judgeChange.afterEnabled) {
    riskHints.push({
      level: "high",
      summary: "本次变更会启用 judge，执行路径与最终候选选择逻辑会发生变化。",
    });
  }
  if (hasExecutionModeChange(args.templateChanges)) {
    riskHints.push({
      level: "medium",
      summary: `执行模式变化影响 ${args.affectedCategories.join(", ")} 分类的主执行链路。`,
    });
  }
  if (typeof (args.patch as Partial<OrchestrationStrategy>).enablePipeline === "boolean") {
    riskHints.push({ level: "medium", summary: "Pipeline 开关变化会影响预处理与后处理链路。" });
  }
  if (riskHints.length === 0) {
    riskHints.push(buildNoOpRiskHint());
  }
  return riskHints;
}

function buildPreviewState(
  strategyBefore: OrchestrationStrategy,
  patch: Record<string, unknown>,
  mermaidPreview: Record<string, string>,
) {
  const strategyAfter = mergeStrategyPatch(strategyBefore, patch);
  const affectedCategories = extractAffectedCategories(patch, mermaidPreview);
  const strategySummaryBefore = buildCategorySummaries(strategyBefore);
  const strategySummaryAfter = buildCategorySummaries(strategyAfter);
  const judgeChange = buildJudgeChange(strategyBefore, patch);
  const templateChanges = buildTemplateChanges(strategyBefore, strategyAfter, affectedCategories);

  return {
    strategyAfter,
    affectedCategories,
    strategySummaryBefore,
    strategySummaryAfter,
    judgeChange,
    templateChanges,
  };
}

function buildOrchestrationPreview(args: {
  strategyBefore: OrchestrationStrategy;
  patch: Record<string, unknown>;
  explanation: string;
  configVersion: string;
  mermaidPreview: Record<string, string>;
}): OrchestrationStrategyPreview {
  const previewState = buildPreviewState(args.strategyBefore, args.patch, args.mermaidPreview);
  return {
    configVersion: args.configVersion,
    explanation: args.explanation,
    affectedCategories: previewState.affectedCategories,
    changeCards: buildChangeCards({
      affectedCategories: previewState.affectedCategories,
      beforeSummaries: previewState.strategySummaryBefore,
      afterSummaries: previewState.strategySummaryAfter,
      judgeChange: previewState.judgeChange,
      patch: args.patch,
      mermaidPreview: args.mermaidPreview,
    }),
    judgeChange: previewState.judgeChange,
    templateChanges: previewState.templateChanges,
    strategySummaryBefore: previewState.strategySummaryBefore,
    strategySummaryAfter: previewState.strategySummaryAfter,
    riskHints: buildRiskHints({
      affectedCategories: previewState.affectedCategories,
      judgeChange: previewState.judgeChange,
      templateChanges: previewState.templateChanges,
      patch: args.patch,
    }),
    mermaidPreview: args.mermaidPreview,
    rawPatch: args.patch,
  };
}

const chatSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1),
  model: z.string().optional(),
});

const pendingPatchSchema = z.object({
  index: z.number().int().min(0),
  action: z.enum(["preview", "apply", "explain", "validate"]),
  configType: z.enum([
    "orchestration-strategy",
    "models",
    "agents",
    "mcp",
    "skills",
    "commands",
    "security",
    "plugins",
  ]),
  patch: z.record(z.string(), z.unknown()),
  explanation: z.string(),
  rawText: z.string(),
  mermaidPreview: z.record(z.string(), z.string()).optional(),
  visualizations: z
    .array(
      z.object({
        kind: z.enum(["mermaid", "json"]),
        title: z.string(),
        content: z.string(),
      }),
    )
    .optional(),
  orchestrationPreview: z.custom<PendingPatch["orchestrationPreview"]>(
    (value) => value === undefined || typeof value === "object",
  ),
  configVersion: z.string().min(1),
  createdAt: z.string().min(1),
  signature: z.string().min(1).optional(),
});

const applySchema = z.object({
  conversationId: z.string().min(1),
  patchIndex: z.number().int().min(0),
  configVersion: z.string().min(1),
  pendingPatch: pendingPatchSchema.optional(),
});

function resolvePendingPatch(body: z.infer<typeof applySchema>): PendingPatch | undefined {
  const inMemoryPatch = chatSettingsConversationManager.getPendingPatch(
    body.conversationId,
    body.patchIndex,
  );
  if (inMemoryPatch) {
    return inMemoryPatch;
  }

  if (
    !body.pendingPatch ||
    body.pendingPatch.index !== body.patchIndex ||
    !body.pendingPatch.signature
  ) {
    return undefined;
  }

  const fallbackPatch = body.pendingPatch as PendingPatch;
  return verifyPendingPatchSignature(fallbackPatch) ? fallbackPatch : undefined;
}

function loadChatSettingsAssistantContext() {
  return {
    strategy: readOrchestrationStrategy(),
    modelsConfig: readModelsConfig(),
    mcpConfig: readMcpConfig(),
    availableAgents: listAgents(),
    availableModels: listConfiguredModels(),
    agentSummaries: listAgentSummaries(),
    skillSummaries: listSkillSummaries(),
    commandSummaries: listCommandSummaries(),
    securityBaseline: readSecurityBaselineConfig(),
    pluginsConfig: readPluginsConfig(),
    allowedPluginSourcePrefixes: getAllowedPluginSourcePrefixes(),
    installablePluginSources: listInstallablePluginSources(),
  };
}

function resolveAssistantPatchConfigVersion(
  response: Awaited<ReturnType<typeof runChatSettingsAssistant>>,
) {
  if (response.configType === "orchestration-strategy") {
    return getOrchestrationStrategyVersion();
  }
  if (response.configType === "models") {
    return getModelsConfigVersion();
  }
  if (response.configType === "mcp") {
    return getMcpConfigVersion();
  }
  if (response.configType === "security") {
    return getSecurityConfigVersion();
  }
  if (response.configType === "plugins") {
    return getPluginsConfigVersion();
  }

  const patchName = typeof response.patch.name === "string" ? response.patch.name : undefined;
  if (!patchName) {
    return "missing";
  }
  if (response.configType === "agents") {
    return getAgentConfigVersion(patchName);
  }
  if (response.configType === "skills") {
    return getSkillConfigVersion(patchName);
  }
  if (response.configType === "commands") {
    return getCommandConfigVersion(patchName);
  }

  return "missing";
}

function buildPendingPatchRecord(args: {
  conversationId: string;
  strategy: OrchestrationStrategy;
  response: Awaited<ReturnType<typeof runChatSettingsAssistant>>;
}) {
  const { conversationId, strategy, response } = args;
  return chatSettingsConversationManager.addPendingPatch(conversationId, {
    action: response.action,
    configType: response.configType,
    explanation: response.explanation,
    patch: response.patch as Record<string, unknown>,
    rawText: response.rawText,
    mermaidPreview: response.mermaidPreview,
    visualizations: response.visualizations,
    orchestrationPreview:
      response.configType === "orchestration-strategy"
        ? buildOrchestrationPreview({
            strategyBefore: strategy,
            patch: response.patch as Record<string, unknown>,
            explanation: response.explanation,
            configVersion: getOrchestrationStrategyVersion(),
            mermaidPreview: response.mermaidPreview,
          })
        : undefined,
    configVersion: resolveAssistantPatchConfigVersion(response),
  });
}

function applyPendingPatchByType(bodyConfigVersion: string, pendingPatch: PendingPatch) {
  if (pendingPatch.configType === "models") {
    return applyModelsPatch({ patch: pendingPatch.patch, configVersion: bodyConfigVersion });
  }
  if (pendingPatch.configType === "mcp") {
    return applyMcpPatch({ patch: pendingPatch.patch, configVersion: bodyConfigVersion });
  }
  if (pendingPatch.configType === "agents") {
    return applyAgentPatch({ patch: pendingPatch.patch, configVersion: bodyConfigVersion });
  }
  if (pendingPatch.configType === "skills") {
    return applySkillPatch({ patch: pendingPatch.patch, configVersion: bodyConfigVersion });
  }
  if (pendingPatch.configType === "commands") {
    return applyCommandPatch({ patch: pendingPatch.patch, configVersion: bodyConfigVersion });
  }
  if (pendingPatch.configType === "security") {
    return applySecurityPatch({ patch: pendingPatch.patch, configVersion: bodyConfigVersion });
  }
  if (pendingPatch.configType === "plugins") {
    return applyPluginsPatch({ patch: pendingPatch.patch, configVersion: bodyConfigVersion });
  }

  return applyOrchestrationStrategyPatch({
    patch: pendingPatch.patch,
    configVersion: bodyConfigVersion,
    availableAgents: listAgents(),
  });
}

function buildApplyVisualizations(configType: PendingPatch["configType"], result: unknown) {
  if (!result || typeof result !== "object" || !("data" in result)) {
    return [] as Array<{ kind: "mermaid" | "json"; title: string; content: string }>;
  }
  const resultData = (result as { data: unknown }).data;
  if (configType === "models") {
    return buildModelsVisualizations(resultData as import("./types").ModelsConfig);
  }
  if (configType === "mcp") {
    return buildJsonVisualizations("MCP 配置", resultData);
  }
  if (configType === "agents") {
    return buildJsonVisualizations("Agent 配置", resultData);
  }
  if (configType === "skills") {
    return buildJsonVisualizations("Skill 配置", resultData);
  }
  if (configType === "commands") {
    return buildJsonVisualizations("命令配置", resultData);
  }
  if (configType === "security") {
    return buildJsonVisualizations("安全基线", resultData);
  }
  if (configType === "plugins") {
    return buildJsonVisualizations("插件配置", resultData);
  }

  return [] as Array<{ kind: "mermaid" | "json"; title: string; content: string }>;
}

export const chatSettingsRoutes = new Hono<AppEnv>();

chatSettingsRoutes.get("/current-context", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);

  chatSettingsConversationManager.pruneInactive();
  const strategy = readOrchestrationStrategy();
  const modelsConfig = readModelsConfig();
  const mcpConfig = readMcpConfig();
  const skillSummaries = listSkillSummaries();
  const commandSummaries = listCommandSummaries();
  const pluginsConfig = readPluginsConfig();
  const installablePluginSources = listInstallablePluginSources();
  const configVersions = buildConfigVersions();
  return c.json({
    data: {
      configVersion: configVersions["orchestration-strategy"],
      orchestrationVersion: configVersions["orchestration-strategy"],
      configVersions,
      strategy,
      categorySummaries: buildCategorySummaries(strategy),
      supportedCategories: [...ORCHESTRATION_CATEGORIES],
      modelsConfig,
      mcpConfig,
      mermaidByCategory: buildStrategyMermaidMap(strategy),
      modelsVisualizations: buildModelsVisualizations(modelsConfig),
      agents: listAgents(),
      models: listConfiguredModels(),
      agentSummaries: listAgentSummaries(),
      skillSummaries,
      commandSummaries,
      securityBaseline: readSecurityBaselineConfig(),
      pluginsConfig,
      allowedPluginSourcePrefixes: getAllowedPluginSourcePrefixes(),
      installablePluginSources,
      supportedConfigTypes: [
        "orchestration-strategy",
        "models",
        "agents",
        "mcp",
        "skills",
        "commands",
        "security",
        "plugins",
      ],
    },
  });
});

chatSettingsRoutes.get("/history", (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);
  const conversationId = c.req.query("conversationId");
  if (conversationId) {
    const conversation = chatSettingsConversationManager.get(conversationId);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, 404);
    }
    return c.json({ data: conversation });
  }

  return c.json({
    data: chatSettingsConversationManager.list().map((conversation) => ({
      id: conversation.id,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastMessage: conversation.messages.at(-1)?.content ?? "",
      messageCount: conversation.messages.length,
    })),
  });
});

chatSettingsRoutes.post("/chat", zValidator("json", chatSchema), async (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);

  chatSettingsConversationManager.pruneInactive();
  const body = c.req.valid("json");
  const conversation = chatSettingsConversationManager.getOrCreate(body.conversationId);
  const chatContext = loadChatSettingsAssistantContext();
  const requestedModel = body.model || chatContext.availableModels[0];
  const modelErr = assertAllowedChatSettingsModel(requestedModel);
  if (modelErr) {
    return c.json({ error: modelErr }, 403);
  }

  const parsedModel = parseModelRoute(requestedModel || "");
  if (!parsedModel) {
    return c.json({ error: "未找到可用的强推理模型，请先在设置中配置。" }, 400);
  }

  chatSettingsConversationManager.appendMessage(conversation.id, "user", body.message);

  try {
    const assistantResponse = await runChatSettingsAssistant({
      strategy: chatContext.strategy,
      modelsConfig: chatContext.modelsConfig,
      mcpConfig: chatContext.mcpConfig,
      agentSummaries: chatContext.agentSummaries,
      skillSummaries: chatContext.skillSummaries,
      commandSummaries: chatContext.commandSummaries,
      securityBaseline: chatContext.securityBaseline,
      pluginsConfig: chatContext.pluginsConfig,
      allowedPluginSourcePrefixes: chatContext.allowedPluginSourcePrefixes,
      installablePluginSources: chatContext.installablePluginSources,
      availableAgents: chatContext.availableAgents,
      availableModels: chatContext.availableModels,
      history: conversation.messages,
      message: body.message,
      model: parsedModel,
    });

    chatSettingsConversationManager.appendMessage(
      conversation.id,
      "assistant",
      assistantResponse.explanation,
    );

    const pendingPatch = buildPendingPatchRecord({
      conversationId: conversation.id,
      strategy: chatContext.strategy,
      response: assistantResponse,
    });

    return c.json({
      data: {
        conversationId: conversation.id,
        configVersion: pendingPatch.configVersion,
        message: assistantResponse.explanation,
        patch: pendingPatch,
      },
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "生成配置建议失败" },
      error instanceof Error && error.message.includes("AI 返回的编排建议暂时无法直接应用")
        ? 400
        : 500,
    );
  }
});

chatSettingsRoutes.post("/apply", zValidator("json", applySchema), (c) => {
  const adminErr = requireSystemAdmin(c.get("user"));
  if (adminErr) return c.json({ error: adminErr }, 403);

  const body = c.req.valid("json");
  const pendingPatch = resolvePendingPatch(body);
  if (!pendingPatch) {
    return c.json({ error: "Pending patch not found" }, 404);
  }

  const result = applyPendingPatchByType(body.configVersion, pendingPatch);

  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 400 | 409 | 404);
  }

  const strategy = readOrchestrationStrategy();
  const visualizations = buildApplyVisualizations(pendingPatch.configType, result);

  return c.json({
    data: {
      ok: true,
      configVersion: result.configVersion,
      orchestrationVersion: getOrchestrationStrategyVersion(),
      strategy,
      categorySummaries: buildCategorySummaries(strategy),
      mermaidByCategory: buildStrategyMermaidMap(strategy),
      visualizations,
      configVersions: buildConfigVersions(),
    },
  });
});
