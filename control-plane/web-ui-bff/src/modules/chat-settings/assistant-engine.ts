import {
  type ChatSettingsVisualization,
  buildJsonVisualizations,
  buildModelsVisualizations,
  buildStrategyVisualizations,
} from "../../lib/chat-settings-visualization";
import { buildStrategyMermaidMap } from "../../lib/orchestration-mermaid";
import type {
  ExecutionMode,
  OrchestrationStrategy,
  WorkflowTemplate,
} from "../../lib/orchestration-strategy";
import { normalizeOrchestrationStrategy } from "../../lib/orchestration-strategy";
import { runDetachedPrompt } from "../agent-control/opencode-adapter";
import type { ChatSettingsMessage } from "./conversation-manager";
import type {
  ChatSettingsConfigType,
  CommandSummary,
  McpServer,
  ModelsConfig,
  PluginConfigItem,
  PluginInstallSource,
  PluginsConfig,
  SecurityBaselineConfig,
  SkillSummary,
} from "./types";

export interface ChatSettingsModelRef {
  providerId: string;
  modelId: string;
  route: string;
}

export interface ChatSettingsAssistantResponse {
  action: "preview" | "apply" | "explain" | "validate";
  configType: ChatSettingsConfigType;
  explanation: string;
  patch: Record<string, unknown>;
  mermaidPreview: Record<string, string>;
  visualizations: ChatSettingsVisualization[];
  rawText: string;
  sessionId?: string;
}

function buildAssistantPatchError(message: string): Error {
  return new Error(
    `AI 返回的编排建议暂时无法直接应用：${message} 请换一种更明确的表述后重试，例如“执行模式改为 single / parallel”或“开启 pipeline 但保持当前执行模式不变”。`,
  );
}

function buildAssistantResponseFormatError(): Error {
  return new Error(
    "AI 返回的编排建议暂时无法直接应用：本次回复没有形成可解析的配置结构。请用更直接的方式描述目标，例如“只修改 ops 分类，执行模式改为 parallel，其他保持不变”。",
  );
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildPrompt(args: {
  strategy: OrchestrationStrategy;
  modelsConfig: ModelsConfig;
  mcpConfig: Record<string, McpServer>;
  agentSummaries: Array<{ fileName: string; name: string; description: string; model: string }>;
  skillSummaries: SkillSummary[];
  commandSummaries: CommandSummary[];
  securityBaseline: SecurityBaselineConfig;
  pluginsConfig: PluginsConfig;
  allowedPluginSourcePrefixes: string[];
  installablePluginSources: PluginInstallSource[];
  availableAgents: string[];
  availableModels: string[];
  history: ChatSettingsMessage[];
  message: string;
}): string {
  const historyBlock = args.history
    .map((item) => `${item.role === "user" ? "User" : "Assistant"}: ${item.content}`)
    .join("\n");

  return [
    "[SYSTEM INSTRUCTIONS]",
    "你是 Opener-X Chat Settings 配置助手。你只能生成系统配置变更建议，不能生成无关代码。",
    "你必须输出一个 JSON 对象，不要输出 Markdown 代码块。",
    "JSON 格式为:",
    safeJsonStringify({
      action: "preview",
      configType: "orchestration-strategy",
      explanation: "简洁说明为什么这样改",
      patch: {
        categoryAgentMap: args.strategy.categoryAgentMap,
      },
    }),
    "支持的 configType: orchestration-strategy | models | agents | mcp | skills | commands | security | plugins。",
    "当 configType=orchestration-strategy 时，patch 只允许包含以下顶级字段中的任意子集: categoryAgentMap, categoryModelMap, enablePipeline, hooks, templates, judge。",
    "WorkflowTemplate.mode 只能是 single 或 parallel，绝不能返回 pipeline。若要开关 pipeline，请使用顶级字段 enablePipeline。",
    "当 configType=models 时，patch 必须是完整 models 配置对象: { defaults, providers, list }。",
    "当 configType=mcp 时，patch 必须是完整 MCP server map。",
    "当 configType=agents 时，patch 必须为 { name, frontmatterPatch, body? }。",
    "当 configType=skills 时，patch 必须为 { name, frontmatterPatch?, body? }，其中 name 必须使用 skill 目录名(dirName)。",
    "当 configType=commands 时，patch 必须为 { name, frontmatterPatch?, body? }，其中 name 必须使用命令文件名（不含 .md）。",
    "当 configType=security 时，patch 必须为 { raw }，表示 SECURITY-BASELINE.md 的完整内容。",
    "当 configType=plugins 时，patch 支持三种格式：",
    '1) { operation: "install", source, name? }，仅允许从受控目录安装；',
    '2) { operation: "uninstall", name }，取消注册插件；',
    '3) { operation: "replace", plugins } 或 { plugins }，用于整体调整启用/禁用状态。',
    "当你不需要修改某个字段时，不要在 patch 中返回该字段。",
    `可用 Agent: ${args.availableAgents.join(", ") || "(none)"}`,
    `可用模型: ${args.availableModels.join(", ") || "(none)"}`,
    "[ORCHESTRATION STRATEGY]",
    safeJsonStringify(args.strategy),
    "[MODELS CONFIG]",
    safeJsonStringify(args.modelsConfig),
    "[MCP CONFIG]",
    safeJsonStringify(args.mcpConfig),
    "[AGENT SUMMARIES]",
    safeJsonStringify(args.agentSummaries),
    "[SKILL SUMMARIES]",
    safeJsonStringify(args.skillSummaries),
    "[COMMAND SUMMARIES]",
    safeJsonStringify(args.commandSummaries),
    "[SECURITY BASELINE]",
    safeJsonStringify(args.securityBaseline),
    "[PLUGINS CONFIG]",
    safeJsonStringify(args.pluginsConfig),
    "[ALLOWED PLUGIN SOURCES]",
    safeJsonStringify(args.allowedPluginSourcePrefixes),
    "[INSTALLABLE PLUGIN SOURCES]",
    safeJsonStringify(args.installablePluginSources),
    historyBlock ? "[CONVERSATION HISTORY]" : "",
    historyBlock,
    "[CURRENT USER MESSAGE]",
    args.message,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseJsonFromText(text: string | undefined): Record<string, unknown> | null {
  if (!text) {
    return null;
  }

  const direct = text.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = direct.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const stripped = fenceMatch?.[1]?.trim() || direct;

  const candidates = [stripped, direct, ...(direct.match(/\{[\s\S]*\}/g) || [])];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (typeof parsed === "object" && parsed) {
        return parsed;
      }
    } catch {
      // Ignore invalid candidate and continue.
    }
  }

  return null;
}

function mergeStrategyPatch(
  strategy: OrchestrationStrategy,
  patch: Partial<OrchestrationStrategy>,
): OrchestrationStrategy {
  return normalizeOrchestrationStrategy({
    ...strategy,
    ...patch,
    categoryAgentMap: patch.categoryAgentMap
      ? { ...strategy.categoryAgentMap, ...patch.categoryAgentMap }
      : strategy.categoryAgentMap,
    categoryModelMap: patch.categoryModelMap
      ? { ...strategy.categoryModelMap, ...patch.categoryModelMap }
      : strategy.categoryModelMap,
    hooks: patch.hooks ?? strategy.hooks,
    templates: patch.templates ?? strategy.templates,
    judge: patch.judge ? { ...strategy.judge, ...patch.judge } : strategy.judge,
  });
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

  return (
    strategy.templates.find((template) => template.enabled !== false) ||
    strategy.templates[0] ||
    null
  );
}

function inferTemplateMode(
  strategy: OrchestrationStrategy,
  templatePatch: Record<string, unknown>,
): ExecutionMode {
  const templateId = typeof templatePatch.id === "string" ? templatePatch.id : "";
  if (templateId) {
    const existingTemplate = strategy.templates.find((template) => template.id === templateId);
    if (existingTemplate?.mode) {
      return existingTemplate.mode;
    }
  }

  const categoryDefaults = Array.isArray(templatePatch.categoryDefaults)
    ? templatePatch.categoryDefaults.filter((value): value is string => typeof value === "string")
    : [];
  const primaryCategory = categoryDefaults[0];
  if (primaryCategory) {
    const categoryTemplate = resolveTemplateForCategory(strategy, primaryCategory);
    if (categoryTemplate?.mode) {
      return categoryTemplate.mode;
    }
  }

  const agents = Array.isArray(templatePatch.agents)
    ? templatePatch.agents.filter((value): value is string => typeof value === "string")
    : [];
  return agents.length > 1 ? "parallel" : "single";
}

function assertTemplatePatch(template: unknown, index: number): Record<string, unknown> {
  if (!template || typeof template !== "object") {
    throw buildAssistantPatchError(`第 ${index + 1} 个模板配置不是合法对象。`);
  }

  return { ...(template as Record<string, unknown>) };
}

function normalizeTemplateMode(
  strategy: OrchestrationStrategy,
  templatePatch: Record<string, unknown>,
): { templatePatch: Record<string, unknown>; enablePipeline: boolean } {
  const rawMode = templatePatch.mode;
  if (rawMode === undefined) {
    return { templatePatch, enablePipeline: false };
  }

  if (rawMode === "single" || rawMode === "parallel") {
    return { templatePatch, enablePipeline: false };
  }

  if (typeof rawMode !== "string") {
    throw buildAssistantPatchError(
      `模板执行模式填写为 ${String(rawMode)}，但当前只支持 single 或 parallel。`,
    );
  }

  const normalizedMode = rawMode.trim().toLowerCase();
  if (normalizedMode === "pipeline") {
    templatePatch.mode = inferTemplateMode(strategy, templatePatch);
    return { templatePatch, enablePipeline: true };
  }

  if (normalizedMode === "serial" || normalizedMode === "sequential") {
    templatePatch.mode = "single";
    return { templatePatch, enablePipeline: false };
  }

  if (
    normalizedMode === "concurrent" ||
    normalizedMode === "multi" ||
    normalizedMode === "multi-agent"
  ) {
    templatePatch.mode = "parallel";
    return { templatePatch, enablePipeline: false };
  }

  throw buildAssistantPatchError(
    `模板执行模式填写为 ${rawMode}，但当前只支持 single 或 parallel；如果你想控制 pipeline，请明确说明开启或关闭 pipeline。`,
  );
}

function normalizeOrchestrationPatch(
  strategy: OrchestrationStrategy,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedPatch = { ...patch };
  let shouldEnablePipeline = false;

  if (Array.isArray(patch.templates)) {
    normalizedPatch.templates = patch.templates.map((template, index) => {
      const templatePatch = assertTemplatePatch(template, index);
      const normalizedTemplate = normalizeTemplateMode(strategy, templatePatch);
      shouldEnablePipeline ||= normalizedTemplate.enablePipeline;
      return normalizedTemplate.templatePatch;
    });
  }

  if (shouldEnablePipeline && normalizedPatch.enablePipeline === undefined) {
    normalizedPatch.enablePipeline = true;
  }

  return normalizedPatch;
}

function normalizeConfigType(value: unknown): ChatSettingsConfigType {
  return value === "models" ||
    value === "agents" ||
    value === "mcp" ||
    value === "skills" ||
    value === "commands" ||
    value === "security" ||
    value === "plugins"
    ? value
    : "orchestration-strategy";
}

function normalizeVisualizations(args: {
  configType: ChatSettingsConfigType;
  strategy: OrchestrationStrategy;
  patch: Record<string, unknown>;
}): { mermaidPreview: Record<string, string>; visualizations: ChatSettingsVisualization[] } {
  if (args.configType === "models") {
    return {
      mermaidPreview: {},
      visualizations: buildModelsVisualizations(args.patch as unknown as ModelsConfig),
    };
  }

  if (args.configType === "mcp") {
    return {
      mermaidPreview: {},
      visualizations: buildJsonVisualizations("MCP 配置预览", args.patch),
    };
  }

  if (args.configType === "agents") {
    return {
      mermaidPreview: {},
      visualizations: buildJsonVisualizations("Agent 变更预览", args.patch),
    };
  }

  if (args.configType === "skills") {
    return {
      mermaidPreview: {},
      visualizations: buildJsonVisualizations("Skill 变更预览", args.patch),
    };
  }

  if (args.configType === "commands") {
    return {
      mermaidPreview: {},
      visualizations: buildJsonVisualizations("命令变更预览", args.patch),
    };
  }

  if (args.configType === "security") {
    return {
      mermaidPreview: {},
      visualizations: buildJsonVisualizations("安全基线预览", args.patch),
    };
  }

  if (args.configType === "plugins") {
    const patch = args.patch as {
      operation?: string;
      source?: string;
      name?: string;
      plugins?: PluginConfigItem[];
    };
    return {
      mermaidPreview: {},
      visualizations: buildJsonVisualizations("插件配置预览", patch),
    };
  }

  const nextStrategy = mergeStrategyPatch(
    args.strategy,
    args.patch as Partial<OrchestrationStrategy>,
  );
  return {
    mermaidPreview: buildStrategyMermaidMap(nextStrategy),
    visualizations: buildStrategyVisualizations(nextStrategy),
  };
}

function normalizeAssistantResponse(
  raw: Record<string, unknown>,
  strategy: OrchestrationStrategy,
  fallbackText: string,
): ChatSettingsAssistantResponse {
  const configType = normalizeConfigType(raw.configType);
  const rawPatch =
    raw.patch && typeof raw.patch === "object" ? (raw.patch as Record<string, unknown>) : {};
  const patch =
    configType === "orchestration-strategy"
      ? normalizeOrchestrationPatch(strategy, rawPatch)
      : rawPatch;
  const action =
    raw.action === "apply" || raw.action === "validate" || raw.action === "explain"
      ? raw.action
      : "preview";
  const preview = normalizeVisualizations({ configType, strategy, patch });

  return {
    action,
    configType,
    explanation:
      typeof raw.explanation === "string" && raw.explanation.trim()
        ? raw.explanation
        : "已生成编排策略变更预览。",
    patch,
    mermaidPreview: preview.mermaidPreview,
    visualizations: preview.visualizations,
    rawText: fallbackText,
  };
}

export async function runChatSettingsAssistant(args: {
  strategy: OrchestrationStrategy;
  modelsConfig: ModelsConfig;
  mcpConfig: Record<string, McpServer>;
  agentSummaries: Array<{ fileName: string; name: string; description: string; model: string }>;
  skillSummaries: SkillSummary[];
  commandSummaries: CommandSummary[];
  securityBaseline: SecurityBaselineConfig;
  pluginsConfig: PluginsConfig;
  allowedPluginSourcePrefixes: string[];
  installablePluginSources: PluginInstallSource[];
  availableAgents: string[];
  availableModels: string[];
  history: ChatSettingsMessage[];
  message: string;
  model: ChatSettingsModelRef;
}): Promise<ChatSettingsAssistantResponse> {
  const prompt = buildPrompt(args);
  const result = await runDetachedPrompt("[Chat Settings] configuration", prompt, {
    timeoutMs: 45000,
    model: {
      providerId: args.model.providerId,
      modelId: args.model.modelId,
    },
  });

  if (!result.ok) {
    throw new Error(result.error || "调用配置助手失败");
  }

  let parsed = parseJsonFromText(result.text);
  let rawText = result.text || "";

  if (!parsed) {
    const retryPrompt = `${prompt}\n\n请仅输出严格 JSON 对象，不要包含解释文本。`;
    const retryResult = await runDetachedPrompt(
      "[Chat Settings Retry] configuration",
      retryPrompt,
      {
        timeoutMs: 45000,
        model: {
          providerId: args.model.providerId,
          modelId: args.model.modelId,
        },
      },
    );

    if (!retryResult.ok) {
      throw new Error(retryResult.error || "配置助手重试失败");
    }

    rawText = retryResult.text || rawText;
    parsed = parseJsonFromText(retryResult.text);
  }

  if (!parsed) {
    throw buildAssistantResponseFormatError();
  }

  const normalized = normalizeAssistantResponse(parsed, args.strategy, rawText);
  normalized.sessionId = result.sessionId;
  return normalized;
}
