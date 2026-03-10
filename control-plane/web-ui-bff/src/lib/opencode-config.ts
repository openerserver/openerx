import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OPENCODE_ROOT = resolve(
  process.env.OPENCODE_ROOT || join(__dirname, "../../../../opencode-fork"),
);
const OPENCODE_JSON = join(OPENCODE_ROOT, "opencode.json");

export function readOpencodeJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(OPENCODE_JSON, "utf-8"));
}

/**
 * Check if a provider is configured in opencode.json.
 * Returns the provider key list if found, or null.
 */
export function getConfiguredProviders(): string[] {
  const config = readOpencodeJson();
  return Object.keys((config.provider as Record<string, unknown>) || {});
}

export function resolveModelRoute(
  raw: string,
  fallbackProviderId = process.env.OPENCODE_PROVIDER_ID || "github-copilot",
): { providerId: string; modelId: string } {
  const value = raw.trim();
  const colonIndex = value.indexOf(":");
  if (colonIndex > 0) {
    return { providerId: value.slice(0, colonIndex), modelId: value.slice(colonIndex + 1) };
  }

  const slashIndex = value.indexOf("/");
  if (slashIndex > 0) {
    const providerId = value.slice(0, slashIndex);
    if (getConfiguredProviders().includes(providerId)) {
      return {
        providerId,
        modelId: providerId === "github-copilot" ? value.slice(slashIndex + 1) : value,
      };
    }
  }

  return { providerId: fallbackProviderId, modelId: value };
}

/**
 * Validate that a model's provider is configured and return a descriptive error if not.
 */
export function validateModelProvider(
  providerId: string,
): { valid: true } | { valid: false; error: string; providers: string[] } {
  const providers = getConfiguredProviders();
  if (providers.includes(providerId)) {
    return { valid: true };
  }
  return {
    valid: false,
    error: `模型提供商 "${providerId}" 未在系统中配置。已配置的提供商: ${providers.join(", ") || "(无)"}。请在"系统配置 → 模型"中添加该提供商，或选择其他模型。`,
    providers,
  };
}
