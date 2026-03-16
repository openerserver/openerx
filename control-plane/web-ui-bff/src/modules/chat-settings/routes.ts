import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  buildJsonVisualizations,
  buildModelsVisualizations,
} from "../../lib/chat-settings-visualization";
import {
  getOrchestrationStrategyVersion,
  readOrchestrationStrategy,
  type OrchestrationStrategy,
  type WorkflowTemplate,
} from "../../lib/orchestration-strategy";
import { buildStrategyMermaidMap } from "../../lib/orchestration-mermaid";
import { parseFrontmatter } from "../../lib/frontmatter";
import type { JWTPayload } from "../../middleware/auth";
import { getAllowedPluginSourcePrefixes } from "../config/routes";
import { runChatSettingsAssistant } from "./assistant-engine";
import {
  chatSettingsConversationManager,
  verifyPendingPatchSignature,
  type PendingPatch,
} from "./conversation-manager";
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

function parseModelRoute(route: string): { providerId: string; modelId: string; route: string } | null {
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

function listConfiguredModels(): string[] {
  const config = readOpencodeJson();
  const rawList = Array.isArray((config.models as Record<string, unknown> | undefined)?.list)
    ? (((config.models as Record<string, unknown>).list as Array<Record<string, unknown>>) || [])
    : [];

  const routes = rawList
    .map((item) => {
      const provider = typeof item.provider === "string" ? item.provider.trim() : "";
      const id = typeof item.id === "string" ? item.id.trim() : "";
      return provider && id ? `${provider}:${id}` : null;
    })
    .filter((item): item is string => Boolean(item));

  // Extract models from provider config (provider.<name>.models)
  const providers = (config.provider as Record<string, Record<string, unknown>> | undefined) || {};
  for (const [providerName, providerConfig] of Object.entries(providers)) {
    if (!providerConfig || typeof providerConfig !== "object") continue;

    // Explicit models
    if (providerConfig.models && typeof providerConfig.models === "object") {
      for (const modelId of Object.keys(providerConfig.models as Record<string, unknown>)) {
        if (modelId.trim()) {
          routes.push(`${providerName}:${modelId.trim()}`);
        }
      }
    }

    // Add well-known models for copilot providers
    if (providerName === "github-copilot" || providerName.startsWith("github-copilot-")) {
      for (const modelId of WELL_KNOWN_COPILOT_MODELS) {
        routes.push(`${providerName}:${modelId}`);
      }
    }
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
    return [] as Array<{ dirName: string; name: string; description: string; permissions?: Record<string, unknown> }>;
  }

  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillName = entry.name;
      const detail = readSkillConfig(skillName);
      return {
        dirName: skillName,
        name: typeof detail?.frontmatter.name === "string" ? detail.frontmatter.name : skillName,
        description: typeof detail?.frontmatter.description === "string" ? detail.frontmatter.description : "",
        permissions:
          detail?.frontmatter.metadata && typeof detail.frontmatter.metadata === "object"
            ? ((detail.frontmatter.metadata as Record<string, unknown>).permissions as Record<string, unknown> | undefined)
            : undefined,
      };
    });
}

function listSkillDetails() {
  return listSkillSummaries()
    .map((summary) => {
      const detail = readSkillConfig(summary.dirName);
      return detail ? { dirName: summary.dirName, detail } : null;
    })
    .filter((item): item is { dirName: string; detail: NonNullable<ReturnType<typeof readSkillConfig>> } => Boolean(item));
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
        description: typeof detail?.frontmatter.description === "string" ? detail.frontmatter.description : "",
      };
    });
}

function listCommandDetails() {
  return listCommandSummaries()
    .map((summary) => {
      const detail = readCommandConfig(summary.name);
      return detail ? { name: summary.name, detail } : null;
    })
    .filter((item): item is { name: string; detail: NonNullable<ReturnType<typeof readCommandConfig>> } => Boolean(item));
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

function resolveTemplateForCategory(strategy: OrchestrationStrategy, category: string): WorkflowTemplate | null {
  const directMatch = strategy.templates.find(
    (template) => template.enabled !== false && template.categoryDefaults?.includes(category),
  );
  if (directMatch) {
    return directMatch;
  }

  const namedMatch = strategy.templates.find(
    (template) => template.enabled !== false && (template.id === category || template.name === category),
  );
  if (namedMatch) {
    return namedMatch;
  }

  return strategy.templates.find((template) => template.enabled !== false) || strategy.templates[0] || null;
}

function resolveExecutionMode(template: WorkflowTemplate | null): OrchestrationExecutionMode {
  return template?.mode || "unknown";
}

function resolvePrimaryAgents(strategy: OrchestrationStrategy, category: string, template: WorkflowTemplate | null): string[] {
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

function buildSummaryNotes(strategy: OrchestrationStrategy, category: string, template: WorkflowTemplate | null): string[] {
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

function mergeStrategyPatch(strategy: OrchestrationStrategy, patch: Record<string, unknown>): OrchestrationStrategy {
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

function extractAffectedCategories(patch: Record<string, unknown>, mermaidPreview: Record<string, string>): string[] {
  const categories = new Set<string>();
  Object.keys(mermaidPreview || {}).forEach((category) => categories.add(category));

  const typedPatch = patch as {
    categoryAgentMap?: Record<string, string[]>;
    categoryModelMap?: Record<string, string>;
    templates?: Array<{ categoryDefaults?: string[] }>;
  };

  Object.keys(typedPatch.categoryAgentMap || {}).forEach((category) => categories.add(category));
  Object.keys(typedPatch.categoryModelMap || {}).forEach((category) => categories.add(category));
  (typedPatch.templates || []).forEach((template) => {
    (template.categoryDefaults || []).forEach((category) => categories.add(category));
  });

  return categories.size > 0 ? [...categories] : ["deep"];
}

function buildJudgeChange(strategy: OrchestrationStrategy, patch: Record<string, unknown>): OrchestrationJudgeChange {
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

function buildChangeCards(args: {
  affectedCategories: string[];
  beforeSummaries: OrchestrationCategorySummary[];
  afterSummaries: OrchestrationCategorySummary[];
  judgeChange: OrchestrationJudgeChange;
  patch: Record<string, unknown>;
  mermaidPreview: Record<string, string>;
}): OrchestrationChangeCard[] {
  const cards: OrchestrationChangeCard[] = args.affectedCategories.map((category) => {
    const beforeSummary = args.beforeSummaries.find((item) => item.category === category)!;
    const afterSummary = args.afterSummaries.find((item) => item.category === category)!;
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
      mermaidCode: args.mermaidPreview[category],
    };
  });

  if (args.judgeChange.changed) {
    cards.unshift({
      id: "judge-change",
      category: args.affectedCategories[0] || "global",
      changeType: "judge",
      title: "Judge 策略变化",
      summary: `${args.judgeChange.beforeEnabled ? "启用" : "关闭"} -> ${args.judgeChange.afterEnabled ? "启用" : "关闭"}`,
      beforeLabel: `${args.judgeChange.beforeAgent} / ${args.judgeChange.beforeModel}`,
      afterLabel: `${args.judgeChange.afterAgent} / ${args.judgeChange.afterModel}`,
      riskLevel: args.judgeChange.afterEnabled ? "high" : "medium",
      affectsJudge: true,
      affectsTemplate: false,
    });
  }

  const typedPatch = args.patch as Partial<OrchestrationStrategy>;
  if (typeof typedPatch.enablePipeline === "boolean") {
    cards.unshift({
      id: "pipeline-change",
      category: args.affectedCategories[0] || "global",
      changeType: "pipeline",
      title: "Pipeline 开关变化",
      summary: `${typedPatch.enablePipeline ? "启用" : "关闭"} pipeline 并影响当前分类执行链路`,
      beforeLabel: typedPatch.enablePipeline ? "pipeline 已关闭" : "pipeline 已启用",
      afterLabel: typedPatch.enablePipeline ? "pipeline 已启用" : "pipeline 已关闭",
      riskLevel: typedPatch.enablePipeline ? "medium" : "high",
      affectsJudge: false,
      affectsTemplate: false,
    });
  }

  return cards;
}

function buildRiskHints(args: {
  affectedCategories: string[];
  judgeChange: OrchestrationJudgeChange;
  templateChanges: OrchestrationTemplateChange[];
  patch: Record<string, unknown>;
}): OrchestrationRiskHint[] {
  const riskHints: OrchestrationRiskHint[] = [];
  if (args.judgeChange.changed && args.judgeChange.afterEnabled) {
    riskHints.push({ level: "high", summary: "本次变更会启用 judge，执行路径与最终候选选择逻辑会发生变化。" });
  }
  if (args.templateChanges.some((item) => item.beforeMode !== item.afterMode)) {
    riskHints.push({ level: "medium", summary: `执行模式变化影响 ${args.affectedCategories.join(", ")} 分类的主执行链路。` });
  }
  if (typeof (args.patch as Partial<OrchestrationStrategy>).enablePipeline === "boolean") {
    riskHints.push({ level: "medium", summary: "Pipeline 开关变化会影响预处理与后处理链路。" });
  }
  if (riskHints.length === 0) {
    riskHints.push({ level: "low", summary: "这次变更主要是编排摘要层面的微调，影响范围有限。" });
  }
  return riskHints;
}

function buildOrchestrationPreview(args: {
  strategyBefore: OrchestrationStrategy;
  patch: Record<string, unknown>;
  explanation: string;
  configVersion: string;
  mermaidPreview: Record<string, string>;
}): OrchestrationStrategyPreview {
  const strategyAfter = mergeStrategyPatch(args.strategyBefore, args.patch);
  const affectedCategories = extractAffectedCategories(args.patch, args.mermaidPreview);
  const strategySummaryBefore = buildCategorySummaries(args.strategyBefore);
  const strategySummaryAfter = buildCategorySummaries(strategyAfter);
  const judgeChange = buildJudgeChange(args.strategyBefore, args.patch);
  const templateChanges = buildTemplateChanges(args.strategyBefore, strategyAfter, affectedCategories);
  return {
    configVersion: args.configVersion,
    explanation: args.explanation,
    affectedCategories,
    changeCards: buildChangeCards({
      affectedCategories,
      beforeSummaries: strategySummaryBefore,
      afterSummaries: strategySummaryAfter,
      judgeChange,
      patch: args.patch,
      mermaidPreview: args.mermaidPreview,
    }),
    judgeChange,
    templateChanges,
    strategySummaryBefore,
    strategySummaryAfter,
    riskHints: buildRiskHints({
      affectedCategories,
      judgeChange,
      templateChanges,
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
  visualizations: z.array(
    z.object({
      kind: z.enum(["mermaid", "json"]),
      title: z.string(),
      content: z.string(),
    }),
  ).optional(),
  orchestrationPreview: z.custom<PendingPatch["orchestrationPreview"]>((value) => value === undefined || typeof value === "object"),
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
  const inMemoryPatch = chatSettingsConversationManager.getPendingPatch(body.conversationId, body.patchIndex);
  if (inMemoryPatch) {
    return inMemoryPatch;
  }

  if (!body.pendingPatch || body.pendingPatch.index !== body.patchIndex || !body.pendingPatch.signature) {
    return undefined;
  }

  const fallbackPatch = body.pendingPatch as PendingPatch;
  return verifyPendingPatchSignature(fallbackPatch) ? fallbackPatch : undefined;
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
      supportedConfigTypes: ["orchestration-strategy", "models", "agents", "mcp", "skills", "commands", "security", "plugins"],
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
  const availableAgents = listAgents();
  const availableModels = listConfiguredModels();
  const agentSummaries = listAgentSummaries();
  const skillSummaries = listSkillSummaries();
  const commandSummaries = listCommandSummaries();
  const requestedModel = body.model || availableModels[0];
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
    const strategy = readOrchestrationStrategy();
    const modelsConfig = readModelsConfig();
    const mcpConfig = readMcpConfig();
    const assistantResponse = await runChatSettingsAssistant({
      strategy,
      modelsConfig,
      mcpConfig,
      agentSummaries,
      skillSummaries,
      commandSummaries,
      securityBaseline: readSecurityBaselineConfig(),
      pluginsConfig: readPluginsConfig(),
      allowedPluginSourcePrefixes: getAllowedPluginSourcePrefixes(),
      installablePluginSources: listInstallablePluginSources(),
      availableAgents,
      availableModels,
      history: conversation.messages,
      message: body.message,
      model: parsedModel,
    });

    chatSettingsConversationManager.appendMessage(
      conversation.id,
      "assistant",
      assistantResponse.explanation,
    );

    const pendingPatch = chatSettingsConversationManager.addPendingPatch(conversation.id, {
      action: assistantResponse.action,
      configType: assistantResponse.configType,
      explanation: assistantResponse.explanation,
      patch: assistantResponse.patch as Record<string, unknown>,
      rawText: assistantResponse.rawText,
      mermaidPreview: assistantResponse.mermaidPreview,
      visualizations: assistantResponse.visualizations,
      orchestrationPreview:
        assistantResponse.configType === "orchestration-strategy"
          ? buildOrchestrationPreview({
              strategyBefore: strategy,
              patch: assistantResponse.patch as Record<string, unknown>,
              explanation: assistantResponse.explanation,
              configVersion: getOrchestrationStrategyVersion(),
              mermaidPreview: assistantResponse.mermaidPreview,
            })
          : undefined,
      configVersion:
        assistantResponse.configType === "orchestration-strategy"
          ? getOrchestrationStrategyVersion()
          : assistantResponse.configType === "models"
            ? getModelsConfigVersion()
            : assistantResponse.configType === "mcp"
              ? getMcpConfigVersion()
              : assistantResponse.configType === "agents" && typeof assistantResponse.patch.name === "string"
                ? getAgentConfigVersion(assistantResponse.patch.name)
                : assistantResponse.configType === "skills" && typeof assistantResponse.patch.name === "string"
                  ? getSkillConfigVersion(assistantResponse.patch.name)
                  : assistantResponse.configType === "commands" && typeof assistantResponse.patch.name === "string"
                    ? getCommandConfigVersion(assistantResponse.patch.name)
                    : assistantResponse.configType === "security"
                      ? getSecurityConfigVersion()
                      : assistantResponse.configType === "plugins"
                        ? getPluginsConfigVersion()
                      : "missing",
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
      error instanceof Error && error.message.includes("AI 返回的编排建议暂时无法直接应用") ? 400 : 500,
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

  const result =
    pendingPatch.configType === "models"
      ? applyModelsPatch({ patch: pendingPatch.patch, configVersion: body.configVersion })
      : pendingPatch.configType === "mcp"
        ? applyMcpPatch({ patch: pendingPatch.patch, configVersion: body.configVersion })
        : pendingPatch.configType === "agents"
          ? applyAgentPatch({ patch: pendingPatch.patch, configVersion: body.configVersion })
          : pendingPatch.configType === "skills"
            ? applySkillPatch({ patch: pendingPatch.patch, configVersion: body.configVersion })
            : pendingPatch.configType === "commands"
              ? applyCommandPatch({ patch: pendingPatch.patch, configVersion: body.configVersion })
              : pendingPatch.configType === "security"
                ? applySecurityPatch({ patch: pendingPatch.patch, configVersion: body.configVersion })
                : pendingPatch.configType === "plugins"
                  ? applyPluginsPatch({ patch: pendingPatch.patch, configVersion: body.configVersion })
          : applyOrchestrationStrategyPatch({
              patch: pendingPatch.patch,
              configVersion: body.configVersion,
              availableAgents: listAgents(),
            });

  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 400 | 409 | 404);
  }

  const strategy = readOrchestrationStrategy();
  let visualizations: Array<{ kind: "mermaid" | "json"; title: string; content: string }> = [];
  if (pendingPatch.configType === "models" && "data" in result) {
    visualizations = buildModelsVisualizations(result.data as import("./types").ModelsConfig);
  } else if (pendingPatch.configType === "mcp" && "data" in result) {
    visualizations = buildJsonVisualizations("MCP 配置", result.data);
  } else if (pendingPatch.configType === "agents" && "data" in result) {
    visualizations = buildJsonVisualizations("Agent 配置", result.data);
  } else if (pendingPatch.configType === "skills" && "data" in result) {
    visualizations = buildJsonVisualizations("Skill 配置", result.data);
  } else if (pendingPatch.configType === "commands" && "data" in result) {
    visualizations = buildJsonVisualizations("命令配置", result.data);
  } else if (pendingPatch.configType === "security" && "data" in result) {
    visualizations = buildJsonVisualizations("安全基线", result.data);
  } else if (pendingPatch.configType === "plugins" && "data" in result) {
    visualizations = buildJsonVisualizations("插件配置", result.data);
  }

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