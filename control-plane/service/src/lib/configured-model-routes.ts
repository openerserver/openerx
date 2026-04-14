import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type ResolvedModelRoute = {
  providerId: string;
  modelId: string;
};

type ConfiguredModelRegistry = {
  providers: string[];
  modelIdsByProvider: Map<string, Set<string>>;
};

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function getTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function getOpencodeConfigPaths() {
  const roots = new Set<string>();

  if (process.env.OPENCODE_ROOT) {
    roots.add(resolve(process.env.OPENCODE_ROOT));
  }

  roots.add(resolve(import.meta.dir, "../../../../opencode-fork"));
  roots.add(resolve(process.cwd(), "../../opencode-fork"));
  roots.add(resolve(process.cwd(), "opencode-fork"));

  return Array.from(roots).map((root) => join(root, "opencode.json"));
}

function readOpencodeJson() {
  for (const path of getOpencodeConfigPaths()) {
    const config = readJsonFile(path);
    if (config) {
      return config;
    }
  }

  return null;
}

function collectConfiguredProviders(config: Record<string, unknown>) {
  const providerIds = Object.keys((config.provider as Record<string, unknown>) || {});
  const modelProviderIds = Object.keys(
    ((config.models as Record<string, unknown> | undefined)?.providers as
      | Record<string, unknown>
      | undefined) || {},
  );

  return Array.from(new Set([...providerIds, ...modelProviderIds])).filter(Boolean);
}

function resolveConfiguredModelRoute(
  raw: string,
  configuredProviders: string[],
  fallbackProviderId = process.env.OPENCODE_PROVIDER_ID || "github-copilot",
): ResolvedModelRoute {
  const value = raw.trim();
  const colonIndex = value.indexOf(":");
  if (colonIndex > 0) {
    return { providerId: value.slice(0, colonIndex), modelId: value.slice(colonIndex + 1) };
  }

  const slashIndex = value.indexOf("/");
  if (slashIndex > 0) {
    const providerId = value.slice(0, slashIndex);
    if (configuredProviders.includes(providerId)) {
      return {
        providerId,
        modelId: providerId === "github-copilot" ? value.slice(slashIndex + 1) : value,
      };
    }
  }

  return { providerId: fallbackProviderId, modelId: value };
}

function normalizeModelId(providerId: string, modelId: string) {
  const trimmedModelId = modelId.trim();
  if (trimmedModelId.startsWith(`${providerId}/`)) {
    return trimmedModelId.slice(providerId.length + 1);
  }
  if (trimmedModelId.startsWith(`${providerId}:`)) {
    return trimmedModelId.slice(providerId.length + 1);
  }
  return trimmedModelId;
}

function hasExplicitProvider(raw: string, configuredProviders: string[]) {
  const value = raw.trim();
  const colonIndex = value.indexOf(":");
  if (colonIndex > 0) {
    return true;
  }

  const slashIndex = value.indexOf("/");
  return slashIndex > 0 && configuredProviders.includes(value.slice(0, slashIndex));
}

function addConfiguredModel(
  registry: ConfiguredModelRegistry,
  providerId: string | undefined,
  modelId: string | undefined,
) {
  const normalizedProviderId = getTrimmedString(providerId);
  const normalizedModelId = getTrimmedString(modelId);
  if (!normalizedProviderId || !normalizedModelId) {
    return;
  }

  const providerModels =
    registry.modelIdsByProvider.get(normalizedProviderId) ?? new Set<string>();
  providerModels.add(normalizeModelId(normalizedProviderId, normalizedModelId));
  registry.modelIdsByProvider.set(normalizedProviderId, providerModels);
}

function buildConfiguredModelRegistry(config: Record<string, unknown>): ConfiguredModelRegistry {
  const providers = collectConfiguredProviders(config);
  const registry: ConfiguredModelRegistry = {
    providers,
    modelIdsByProvider: new Map<string, Set<string>>(),
  };

  const configuredDefaultModel =
    getTrimmedString(((config.agents as Record<string, unknown> | undefined)?.defaults as
      | Record<string, unknown>
      | undefined)?.model) ?? getTrimmedString(config.model);
  if (configuredDefaultModel) {
    const resolvedDefault = resolveConfiguredModelRoute(configuredDefaultModel, providers);
    addConfiguredModel(registry, resolvedDefault.providerId, resolvedDefault.modelId);
  }

  const modelList = Array.isArray((config.models as Record<string, unknown> | undefined)?.list)
    ? (((config.models as Record<string, unknown>).list as Array<Record<string, unknown>>) ?? [])
    : [];

  for (const model of modelList) {
    const route = getTrimmedString(model.route);
    if (route) {
      const resolvedRoute = resolveConfiguredModelRoute(route, providers);
      addConfiguredModel(registry, resolvedRoute.providerId, resolvedRoute.modelId);
      continue;
    }

    addConfiguredModel(
      registry,
      getTrimmedString(model.provider),
      getTrimmedString(model.id),
    );
  }

  const providerConfigs = (config.provider as Record<string, unknown>) || {};
  for (const [providerId, providerConfig] of Object.entries(providerConfigs)) {
    const providerModels = (providerConfig as Record<string, unknown> | undefined)?.models as
      | Record<string, unknown>
      | undefined;
    for (const [modelKey, modelValue] of Object.entries(providerModels || {})) {
      addConfiguredModel(
        registry,
        providerId,
        getTrimmedString((modelValue as Record<string, unknown> | undefined)?.id) ?? modelKey,
      );
    }
  }

  return registry;
}

export function isConfiguredModelRoute(raw: string | null | undefined) {
  const value = getTrimmedString(raw);
  if (!value) {
    return true;
  }

  const config = readOpencodeJson();
  if (!config) {
    return true;
  }

  const registry = buildConfiguredModelRegistry(config);
  if (registry.modelIdsByProvider.size === 0) {
    return true;
  }

  const resolvedModel = resolveConfiguredModelRoute(value, registry.providers);
  const normalizedModelId = normalizeModelId(resolvedModel.providerId, resolvedModel.modelId);
  if (registry.modelIdsByProvider.get(resolvedModel.providerId)?.has(normalizedModelId)) {
    return true;
  }

  if (hasExplicitProvider(value, registry.providers)) {
    return false;
  }

  let matchCount = 0;
  for (const providerModels of registry.modelIdsByProvider.values()) {
    if (!providerModels.has(normalizedModelId)) {
      continue;
    }

    matchCount += 1;
    if (matchCount > 1) {
      return false;
    }
  }

  return matchCount === 1;
}

export function validateConfiguredModelRoute(
  raw: string | null | undefined,
  fieldLabel = "模型",
) {
  const value = getTrimmedString(raw);
  if (!value) {
    return null;
  }

  return isConfiguredModelRoute(value)
    ? null
    : `${fieldLabel} \"${value}\" 不在当前系统配置的可用模型集合内，请重新选择。`;
}