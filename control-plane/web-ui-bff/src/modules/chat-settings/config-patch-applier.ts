import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { parseFrontmatter, serializeFrontmatter } from "../../lib/frontmatter";
import {
  type OrchestrationStrategy,
  getOrchestrationStrategyVersion,
  normalizeOrchestrationStrategy,
  readOrchestrationStrategy,
  writeOrchestrationStrategy,
} from "../../lib/orchestration-strategy";
import {
  getConfiguredPluginPaths,
  getDisabledPluginPaths,
  normalizePluginConfigPath,
  resolveAllowedPluginInstallSource,
  setConfiguredPluginState,
} from "../config/routes";
import type {
  MarkdownConfigDetail,
  McpServer,
  ModelsConfig,
  PluginsConfig,
  SecurityBaselineConfig,
} from "./types";

const OPENCODE_ROOT = resolve(
  process.env.OPENCODE_ROOT || join(__dirname, "../../../../../opencode-fork"),
);
const OPENCODE_JSON = join(OPENCODE_ROOT, "opencode.json");
const AGENTS_DIR = join(OPENCODE_ROOT, ".opencode", "agents");
const SKILLS_DIR = join(OPENCODE_ROOT, ".opencode", "skills");
const COMMANDS_DIR = join(OPENCODE_ROOT, ".opencode", "commands");
const SECURITY_BASELINE_PATH = join(OPENCODE_ROOT, "SECURITY-BASELINE.md");

const lifecycleHookSchema = z.object({
  id: z.string().min(1),
  trigger: z.enum(["pre-execution", "post-execution", "on-failure", "pre-resume"]),
  enabled: z.boolean(),
  agent: z.string(),
  model: z.string().optional(),
  promptTemplate: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  order: z.number().int().min(0),
});

const workflowTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  mode: z.enum(["single", "parallel"]),
  agents: z.array(z.string()),
  maxParallelCandidates: z.number().int().min(1).max(5).optional(),
  enabled: z.boolean(),
  categoryDefaults: z.array(z.string()).optional(),
});

const judgeConfigSchema = z.object({
  enabled: z.boolean(),
  agent: z.string(),
  model: z.string(),
  promptTemplate: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  selectionStrategy: z.enum(["judge-pick", "highest-score"]),
});

const patchSchema = z
  .object({
    categoryAgentMap: z.record(z.string(), z.array(z.string())).optional(),
    categoryModelMap: z.record(z.string(), z.string()).optional(),
    enablePipeline: z.boolean().optional(),
    hooks: z.array(lifecycleHookSchema).optional(),
    templates: z.array(workflowTemplateSchema).optional(),
    judge: judgeConfigSchema.partial().optional(),
  })
  .strict();

function readOpencodeJson(): Record<string, unknown> {
  if (!existsSync(OPENCODE_JSON)) {
    return {};
  }

  return JSON.parse(readFileSync(OPENCODE_JSON, "utf-8")) as Record<string, unknown>;
}

function writeOpencodeJson(data: Record<string, unknown>): void {
  writeFileSync(OPENCODE_JSON, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function getFileVersion(filePath: string): string {
  if (!existsSync(filePath)) {
    return "missing";
  }
  const stat = statSync(filePath);
  return `${stat.size}-${Math.trunc(stat.mtimeMs)}`;
}

export function getModelsConfigVersion(): string {
  return getFileVersion(OPENCODE_JSON);
}

export function getMcpConfigVersion(): string {
  return getFileVersion(OPENCODE_JSON);
}

export function getAgentConfigVersion(agentName: string): string {
  return getFileVersion(join(AGENTS_DIR, `${agentName}.md`));
}

export function getSkillConfigVersion(skillName: string): string {
  return getFileVersion(join(SKILLS_DIR, skillName, "SKILL.md"));
}

export function getCommandConfigVersion(commandName: string): string {
  return getFileVersion(join(COMMANDS_DIR, `${commandName}.md`));
}

export function getSecurityConfigVersion(): string {
  return getFileVersion(SECURITY_BASELINE_PATH);
}

export function getPluginsConfigVersion(): string {
  return getFileVersion(OPENCODE_JSON);
}

export function readModelsConfig(): ModelsConfig {
  const config = readOpencodeJson();
  const models = (config.models as Record<string, unknown>) || {};
  return {
    defaults:
      ((config.agents as Record<string, unknown> | undefined)?.defaults as Record<
        string,
        unknown
      >) || {},
    providers: (models.providers as Record<string, unknown>) || {},
    list: (models.list as Array<Record<string, unknown>>) || [],
  };
}

export function readMcpConfig(): Record<string, McpServer> {
  const config = readOpencodeJson();
  return ((config.mcp as Record<string, McpServer>) || {}) as Record<string, McpServer>;
}

export function readSkillConfig(skillName: string): MarkdownConfigDetail | null {
  const skillPath = join(SKILLS_DIR, skillName, "SKILL.md");
  if (!existsSync(skillPath)) {
    return null;
  }
  const current = parseFrontmatter(readFileSync(skillPath, "utf-8"));
  return { frontmatter: current.frontmatter, body: current.body };
}

export function readCommandConfig(commandName: string): MarkdownConfigDetail | null {
  const commandPath = join(COMMANDS_DIR, `${commandName}.md`);
  if (!existsSync(commandPath)) {
    return null;
  }
  const current = parseFrontmatter(readFileSync(commandPath, "utf-8"));
  return { frontmatter: current.frontmatter, body: current.body };
}

export function readSecurityBaselineConfig(): SecurityBaselineConfig {
  return {
    raw: existsSync(SECURITY_BASELINE_PATH) ? readFileSync(SECURITY_BASELINE_PATH, "utf-8") : "",
  };
}

export function readPluginsConfig(): PluginsConfig {
  const config = readOpencodeJson();
  const active = getConfiguredPluginPaths(config).map((path) => ({
    path,
    name: path.split("/").at(-1)?.replace(/\.ts$/, "") || path,
    exists: existsSync(resolve(OPENCODE_ROOT, path)),
    enabled: true,
  }));
  const disabled = getDisabledPluginPaths(config).map((path) => ({
    path,
    name: path.split("/").at(-1)?.replace(/\.ts$/, "") || path,
    exists: existsSync(resolve(OPENCODE_ROOT, path)),
    enabled: false,
  }));

  return {
    plugins: [...active, ...disabled],
  };
}

function isSafeConfigName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

function resolveMarkdownConfigFilePath(kind: "agent" | "skill" | "command", name: string) {
  return kind === "agent"
    ? join(AGENTS_DIR, `${name}.md`)
    : kind === "skill"
      ? join(SKILLS_DIR, name, "SKILL.md")
      : join(COMMANDS_DIR, `${name}.md`);
}

function getMarkdownConfigVersion(kind: "agent" | "skill" | "command", name: string) {
  return kind === "agent"
    ? getAgentConfigVersion(name)
    : kind === "skill"
      ? getSkillConfigVersion(name)
      : getCommandConfigVersion(name);
}

function getMarkdownConfigVersionConflictMessage(kind: "agent" | "skill" | "command") {
  return kind === "agent"
    ? "Agent 配置已更新，请刷新后重试。"
    : kind === "skill"
      ? "Skill 配置已更新，请刷新后重试。"
      : "命令配置已更新，请刷新后重试。";
}

function validateRequiredFrontmatterKeys(
  frontmatter: Record<string, unknown>,
  kind: "agent" | "skill" | "command",
  requiredFrontmatterKeys?: string[],
) {
  for (const key of requiredFrontmatterKeys || []) {
    const value = frontmatter[key];
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false as const, status: 400, error: `${kind} frontmatter 必须保留 ${key}` };
    }
  }

  return { ok: true as const };
}

function writeMarkdownPatchedConfig(
  filePath: string,
  kind: "agent" | "skill" | "command",
  name: string,
  frontmatter: Record<string, unknown>,
  body: string,
) {
  writeFileSync(filePath, serializeFrontmatter(frontmatter, body), "utf-8");
  return {
    ok: true as const,
    data: { name, frontmatter, body },
    configVersion: getMarkdownConfigVersion(kind, name),
  };
}

function applyMarkdownPatch(args: {
  patch: Record<string, unknown>;
  configVersion: string;
  kind: "agent" | "skill" | "command";
  requiredFrontmatterKeys?: string[];
}):
  | {
      ok: true;
      data: { name: string; frontmatter: Record<string, unknown>; body: string };
      configVersion: string;
    }
  | { ok: false; status: number; error: string } {
  const parsed = agentPatchSchema.safeParse(args.patch);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: `${args.kind} patch 非法: ${parsed.error.issues[0]?.message || "unknown error"}`,
    };
  }
  if (!isSafeConfigName(parsed.data.name)) {
    return { ok: false, status: 400, error: `${args.kind} 名称非法: ${parsed.data.name}` };
  }

  const filePath = resolveMarkdownConfigFilePath(args.kind, parsed.data.name);
  const currentVersion = getMarkdownConfigVersion(args.kind, parsed.data.name);

  if (args.configVersion !== currentVersion) {
    return {
      ok: false,
      status: 409,
      error: getMarkdownConfigVersionConflictMessage(args.kind),
    };
  }
  if (!existsSync(filePath)) {
    return { ok: false, status: 404, error: `${args.kind} 不存在: ${parsed.data.name}` };
  }

  const current = parseFrontmatter(readFileSync(filePath, "utf-8"));
  const frontmatter = {
    ...current.frontmatter,
    ...(parsed.data.frontmatterPatch || {}),
  };
  const body = parsed.data.body ?? current.body;
  const frontmatterValidation = validateRequiredFrontmatterKeys(
    frontmatter,
    args.kind,
    args.requiredFrontmatterKeys,
  );
  if (!frontmatterValidation.ok) {
    return frontmatterValidation;
  }

  return writeMarkdownPatchedConfig(filePath, args.kind, parsed.data.name, frontmatter, body);
}

function getConfiguredModels(): string[] {
  const config = readOpencodeJson();
  const list = Array.isArray((config.models as Record<string, unknown> | undefined)?.list)
    ? ((config.models as Record<string, unknown>).list as Array<Record<string, unknown>>) || []
    : [];

  return list
    .map((item) => {
      const provider = typeof item.provider === "string" ? item.provider.trim() : "";
      const id = typeof item.id === "string" ? item.id.trim() : "";
      return provider && id ? `${provider}:${id}` : null;
    })
    .filter((item): item is string => Boolean(item));
}

function collectReferencedAgents(strategy: OrchestrationStrategy): string[] {
  return Array.from(
    new Set(
      [
        ...Object.values(strategy.categoryAgentMap).flat(),
        ...strategy.hooks.map((hook) => hook.agent),
        ...strategy.templates.flatMap((template) => template.agents),
        strategy.judge.agent,
      ].filter(Boolean),
    ),
  );
}

function collectReferencedModels(strategy: OrchestrationStrategy): string[] {
  return Array.from(
    new Set(
      [
        ...Object.values(strategy.categoryModelMap).filter(Boolean),
        ...strategy.hooks
          .map((hook) => hook.model)
          .filter((value): value is string => Boolean(value)),
        strategy.judge.model,
      ].filter(Boolean),
    ),
  );
}

export function applyOrchestrationStrategyPatch(args: {
  patch: Record<string, unknown>;
  configVersion: string;
  availableAgents: string[];
}):
  | { ok: true; strategy: OrchestrationStrategy; configVersion: string }
  | { ok: false; status: number; error: string } {
  const currentVersion = getOrchestrationStrategyVersion();
  if (args.configVersion !== currentVersion) {
    return { ok: false, status: 409, error: "配置已更新，请刷新后重试。" };
  }

  const parsedPatch = patchSchema.safeParse(args.patch);
  if (!parsedPatch.success) {
    return {
      ok: false,
      status: 400,
      error: `Patch 非法: ${parsedPatch.error.issues[0]?.message || "unknown error"}`,
    };
  }

  const current = readOrchestrationStrategy();
  const merged = normalizeOrchestrationStrategy({
    ...current,
    ...parsedPatch.data,
    categoryAgentMap: parsedPatch.data.categoryAgentMap
      ? { ...current.categoryAgentMap, ...parsedPatch.data.categoryAgentMap }
      : current.categoryAgentMap,
    categoryModelMap: parsedPatch.data.categoryModelMap
      ? { ...current.categoryModelMap, ...parsedPatch.data.categoryModelMap }
      : current.categoryModelMap,
    judge: parsedPatch.data.judge ? { ...current.judge, ...parsedPatch.data.judge } : current.judge,
    hooks: parsedPatch.data.hooks ?? current.hooks,
    templates: parsedPatch.data.templates ?? current.templates,
  });

  const missingAgents = collectReferencedAgents(merged).filter(
    (agent) => !args.availableAgents.includes(agent) && agent !== "default-executor",
  );
  if (missingAgents.length > 0) {
    return { ok: false, status: 400, error: `存在未注册 Agent: ${missingAgents.join(", ")}` };
  }

  const configuredModels = getConfiguredModels();
  const missingModels = collectReferencedModels(merged).filter(
    (model) => model && !configuredModels.includes(model),
  );
  if (missingModels.length > 0) {
    return { ok: false, status: 400, error: `存在未配置模型: ${missingModels.join(", ")}` };
  }

  writeOrchestrationStrategy(merged);
  return { ok: true, strategy: merged, configVersion: getOrchestrationStrategyVersion() };
}

const modelsSchema = z.object({
  defaults: z.record(z.unknown()),
  providers: z.record(z.unknown()),
  list: z.array(z.record(z.unknown())),
});

const mcpSchema = z.record(
  z.object({
    type: z.string().optional(),
    command: z.union([z.string(), z.array(z.string())]),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    environment: z.record(z.string()).optional(),
    description: z.string().optional(),
  }),
);

const agentPatchSchema = z.object({
  name: z.string().min(1),
  frontmatterPatch: z.record(z.unknown()).optional(),
  body: z.string().optional(),
});

export function applyModelsPatch(args: {
  patch: Record<string, unknown>;
  configVersion: string;
}):
  | { ok: true; data: ModelsConfig; configVersion: string }
  | { ok: false; status: number; error: string } {
  const currentVersion = getModelsConfigVersion();
  if (args.configVersion !== currentVersion) {
    return { ok: false, status: 409, error: "模型配置已更新，请刷新后重试。" };
  }
  const parsed = modelsSchema.safeParse(args.patch);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: `Models patch 非法: ${parsed.error.issues[0]?.message || "unknown error"}`,
    };
  }
  const config = readOpencodeJson();
  const defaultModel =
    typeof parsed.data.defaults.model === "string" ? parsed.data.defaults.model.trim() : "";
  config.agents = { ...(config.agents as object), defaults: parsed.data.defaults };
  config.models = { providers: parsed.data.providers, list: parsed.data.list };
  if (defaultModel) {
    config.model = defaultModel.includes(":") ? defaultModel.replace(":", "/") : defaultModel;
  }
  writeOpencodeJson(config);
  return { ok: true, data: readModelsConfig(), configVersion: getModelsConfigVersion() };
}

export function applyMcpPatch(args: {
  patch: Record<string, unknown>;
  configVersion: string;
}):
  | { ok: true; data: Record<string, McpServer>; configVersion: string }
  | { ok: false; status: number; error: string } {
  const currentVersion = getMcpConfigVersion();
  if (args.configVersion !== currentVersion) {
    return { ok: false, status: 409, error: "MCP 配置已更新，请刷新后重试。" };
  }
  const parsed = mcpSchema.safeParse(args.patch);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: `MCP patch 非法: ${parsed.error.issues[0]?.message || "unknown error"}`,
    };
  }
  const config = readOpencodeJson();
  config.mcp = parsed.data;
  writeOpencodeJson(config);
  return { ok: true, data: readMcpConfig(), configVersion: getMcpConfigVersion() };
}

export function applyAgentPatch(args: {
  patch: Record<string, unknown>;
  configVersion: string;
}):
  | {
      ok: true;
      data: { name: string; frontmatter: Record<string, unknown>; body: string };
      configVersion: string;
    }
  | { ok: false; status: number; error: string } {
  return applyMarkdownPatch({
    patch: args.patch,
    configVersion: args.configVersion,
    kind: "agent",
    requiredFrontmatterKeys: ["name", "description"],
  });
}

export function applySkillPatch(args: {
  patch: Record<string, unknown>;
  configVersion: string;
}):
  | {
      ok: true;
      data: { name: string; frontmatter: Record<string, unknown>; body: string };
      configVersion: string;
    }
  | { ok: false; status: number; error: string } {
  return applyMarkdownPatch({
    patch: args.patch,
    configVersion: args.configVersion,
    kind: "skill",
  });
}

export function applyCommandPatch(args: {
  patch: Record<string, unknown>;
  configVersion: string;
}):
  | {
      ok: true;
      data: { name: string; frontmatter: Record<string, unknown>; body: string };
      configVersion: string;
    }
  | { ok: false; status: number; error: string } {
  return applyMarkdownPatch({
    patch: args.patch,
    configVersion: args.configVersion,
    kind: "command",
  });
}

const securityPatchSchema = z.object({
  raw: z.string(),
});

const pluginPatchSchema = z.object({
  plugins: z.array(
    z.object({
      path: z.string().min(1),
      name: z.string().min(1),
      exists: z.boolean().optional(),
      enabled: z.boolean(),
    }),
  ),
});

const pluginOperationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("replace"),
    plugins: pluginPatchSchema.shape.plugins,
  }),
  z.object({
    operation: z.literal("install"),
    source: z.string().min(1),
    name: z.string().min(1).optional(),
  }),
  z.object({
    operation: z.literal("uninstall"),
    name: z.string().min(1),
  }),
]);

export function applySecurityPatch(args: {
  patch: Record<string, unknown>;
  configVersion: string;
}):
  | { ok: true; data: SecurityBaselineConfig; configVersion: string }
  | { ok: false; status: number; error: string } {
  const currentVersion = getSecurityConfigVersion();
  if (args.configVersion !== currentVersion) {
    return { ok: false, status: 409, error: "安全基线已更新，请刷新后重试。" };
  }
  const parsed = securityPatchSchema.safeParse(args.patch);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: `Security patch 非法: ${parsed.error.issues[0]?.message || "unknown error"}`,
    };
  }
  writeFileSync(SECURITY_BASELINE_PATH, parsed.data.raw, "utf-8");
  return {
    ok: true,
    data: readSecurityBaselineConfig(),
    configVersion: getSecurityConfigVersion(),
  };
}

export function applyPluginsPatch(args: {
  patch: Record<string, unknown>;
  configVersion: string;
}):
  | { ok: true; data: PluginsConfig; configVersion: string }
  | { ok: false; status: number; error: string } {
  const currentVersion = getPluginsConfigVersion();
  if (args.configVersion !== currentVersion) {
    return { ok: false, status: 409, error: "插件配置已更新，请刷新后重试。" };
  }

  const parsed = pluginOperationSchema.safeParse(
    "operation" in args.patch
      ? args.patch
      : { operation: "replace", plugins: (args.patch as { plugins?: unknown }).plugins },
  );
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: `Plugins patch 非法: ${parsed.error.issues[0]?.message || "unknown error"}`,
    };
  }
  const config = readOpencodeJson();

  if (parsed.data.operation === "install") {
    const sourceResult = resolveAllowedPluginInstallSource(parsed.data.source);
    if (!sourceResult.ok) {
      return { ok: false, status: 400, error: sourceResult.error };
    }

    const fileName = parsed.data.name
      ? `${parsed.data.name}.ts`
      : sourceResult.sourcePath.split("/").at(-1) || "plugin.ts";
    const relativePath = normalizePluginConfigPath(fileName);
    const pluginPaths = getConfiguredPluginPaths(config);
    const disabledPaths = getDisabledPluginPaths(config).filter((path) => path !== relativePath);
    if (!pluginPaths.includes(relativePath)) {
      pluginPaths.push(relativePath);
    }
    setConfiguredPluginState(config, pluginPaths, disabledPaths);
  } else if (parsed.data.operation === "uninstall") {
    const relativePath = normalizePluginConfigPath(`${parsed.data.name}.ts`);
    const pluginPaths = getConfiguredPluginPaths(config).filter((path) => path !== relativePath);
    const disabledPaths = getDisabledPluginPaths(config).filter((path) => path !== relativePath);
    setConfiguredPluginState(config, pluginPaths, disabledPaths);
  } else {
    const normalizedPaths = parsed.data.plugins.map((plugin) => {
      const expectedPath = normalizePluginConfigPath(`${plugin.name}.ts`);
      return {
        ...plugin,
        path: plugin.path || expectedPath,
      };
    });

    const activePaths = normalizedPaths
      .filter((plugin) => plugin.enabled !== false)
      .map((plugin) => plugin.path);
    const disabledPaths = normalizedPaths
      .filter((plugin) => plugin.enabled === false)
      .map((plugin) => plugin.path);
    setConfiguredPluginState(config, activePaths, disabledPaths);
  }

  writeOpencodeJson(config);
  return { ok: true, data: readPluginsConfig(), configVersion: getPluginsConfigVersion() };
}
