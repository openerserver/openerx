import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  RUNTIME_RECOVERY_ERROR_CODES,
  RUNTIME_RECOVERY_SUGGESTION_IDS,
  RUNTIME_RECOVERY_SUGGESTION_KINDS,
  type RuntimeRecoveryErrorCode,
  type RuntimeRecoverySuggestion,
} from "./runtime-recovery-contract";

const UI_OPENCODE_ROOT = resolve(
  process.env.OPENCODE_ROOT || join(__dirname, "../../../../opencode-fork"),
);
const UI_OPENCODE_JSON = join(UI_OPENCODE_ROOT, "opencode.json");
const WORKSPACE_ROOT = resolve(process.env.OPENCODE_RUNTIME_ROOT || join(__dirname, "../../../../"));
const RUNTIME_OPENCODE_JSON = join(WORKSPACE_ROOT, "opencode.json");
const RUNTIME_STATE_DIR = join(WORKSPACE_ROOT, ".opencode", "state");
const UI_STATE_DIR = join(UI_OPENCODE_ROOT, ".opencode", "state");
const LEGACY_AUTH_JSON = resolve(homedir(), ".local/share/opencode/auth.json");
const LEGACY_AUTH_BACKUP = `${LEGACY_AUTH_JSON}.bak`;

type ConfigSource = "runtime" | "ui";

export const ALLOWED_TEST_EXECUTION_MODELS = [
  "github-copilot:gpt-5-mini",
  "github-copilot:gpt-4o",
] as const;

const DEFAULT_TEST_EXECUTION_MODEL = ALLOWED_TEST_EXECUTION_MODELS[0];

type ProviderConfig = {
  providerId: string;
  api?: string;
  name?: string;
  baseURL?: string;
  apiKey?: string;
  configPath: string;
  source: ConfigSource;
};

export type ModelReadinessFailure = {
  status: 400 | 503;
  code: RuntimeRecoveryErrorCode;
  error: string;
  diagnostics: Record<string, unknown>;
  recoverySuggestions?: RuntimeRecoverySuggestion[];
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

export function readOpencodeJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(UI_OPENCODE_JSON, "utf-8"));
}

export function readRuntimeOpencodeJson(): Record<string, unknown> {
  return readJsonFile(RUNTIME_OPENCODE_JSON) ?? readOpencodeJson();
}

function getTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeTestExecutionModel(raw: string | undefined | null): string | undefined {
  const value = getTrimmedString(raw);
  if (!value) {
    return undefined;
  }

  const normalized = value.includes(":") ? value : `github-copilot:${value}`;
  return ALLOWED_TEST_EXECUTION_MODELS.includes(
    normalized as (typeof ALLOWED_TEST_EXECUTION_MODELS)[number],
  )
    ? normalized
    : undefined;
}

export function readDefaultExecutionModel(): string | undefined {
  const config = readOpencodeJson();
  const defaults = (config.agents as Record<string, unknown> | undefined)?.defaults as
    | Record<string, unknown>
    | undefined;

  return getTrimmedString(defaults?.model) ?? getTrimmedString(config.model);
}

export function readConfiguredTestExecutionModel(): string | undefined {
  const config = readOpencodeJson();
  const defaults = (config.agents as Record<string, unknown> | undefined)?.defaults as
    | Record<string, unknown>
    | undefined;

  return normalizeTestExecutionModel(getTrimmedString(defaults?.testModel));
}

export function readEnforcedTestExecutionModel(): string {
  return (
    readConfiguredTestExecutionModel()
    || normalizeTestExecutionModel(process.env.TEST_EXECUTION_MODEL)
    || normalizeTestExecutionModel(process.env.LOW_COST_EXECUTION_MODEL)
    || DEFAULT_TEST_EXECUTION_MODEL
  );
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

function readProviderConfig(
  config: Record<string, unknown>,
  providerId: string,
  configPath: string,
  source: ConfigSource,
): ProviderConfig | null {
  const providerRoot = ((config.provider as Record<string, unknown> | undefined) || {})[providerId] as
    | Record<string, unknown>
    | undefined;
  const modelsProvider = (
    ((config.models as Record<string, unknown> | undefined)?.providers as Record<string, unknown> | undefined) || {}
  )[providerId] as Record<string, unknown> | undefined;

  if (!providerRoot && !modelsProvider) {
    return null;
  }

  const providerOptions = (providerRoot?.options as Record<string, unknown> | undefined) || {};
  return {
    providerId,
    api:
      getTrimmedString(providerRoot?.api) || getTrimmedString(modelsProvider?.api) || undefined,
    name:
      getTrimmedString(providerRoot?.name) || getTrimmedString(modelsProvider?.name) || undefined,
    baseURL:
      getTrimmedString(providerOptions.baseURL) ||
      getTrimmedString(providerRoot?.baseURL) ||
      getTrimmedString(modelsProvider?.baseURL) ||
      undefined,
    apiKey:
      getTrimmedString(providerOptions.apiKey) ||
      getTrimmedString(providerRoot?.apiKey) ||
      getTrimmedString(modelsProvider?.apiKey) ||
      undefined,
    configPath,
    source,
  };
}

function getProviderConfigCandidates(providerId: string): ProviderConfig[] {
  const candidates: ProviderConfig[] = [];
  const runtimeConfig = readJsonFile(RUNTIME_OPENCODE_JSON);
  const uiConfig = readJsonFile(UI_OPENCODE_JSON);

  if (runtimeConfig) {
    const runtimeProvider = readProviderConfig(
      runtimeConfig,
      providerId,
      RUNTIME_OPENCODE_JSON,
      "runtime",
    );
    if (runtimeProvider) {
      candidates.push(runtimeProvider);
    }
  }

  if (UI_OPENCODE_JSON !== RUNTIME_OPENCODE_JSON && uiConfig) {
    const uiProvider = readProviderConfig(uiConfig, providerId, UI_OPENCODE_JSON, "ui");
    if (uiProvider) {
      candidates.push(uiProvider);
    }
  }

  return candidates;
}

function buildCopilotTokenFile(providerId: string, stateDir: string): string {
  const suffix = providerId === "github-copilot" ? "" : `-${providerId.replace(/[^a-zA-Z0-9-]/g, "")}`;
  return join(stateDir, `copilot-token${suffix}.json`);
}

function hasStoredCopilotToken(providerId: string) {
  const tokenFiles = [
    buildCopilotTokenFile(providerId, RUNTIME_STATE_DIR),
    buildCopilotTokenFile(providerId, UI_STATE_DIR),
  ];

  return tokenFiles.some((filePath) => {
    const token = readJsonFile(filePath);
    return Boolean(getTrimmedString(token?.access_token));
  });
}

function hasLegacyAuthCredential(providerId: string) {
  const auth = readJsonFile(LEGACY_AUTH_JSON);
  if (!auth) {
    return false;
  }

  const providerRecord = auth[providerId] as Record<string, unknown> | undefined;
  if (providerRecord && typeof providerRecord === "object") {
    return true;
  }

  return Object.keys(auth).includes(providerId);
}

async function probeOpenAiCompatibleProvider(provider: ProviderConfig) {
  if (!provider.baseURL) {
    return {
      ok: false,
      message: `Provider ${provider.providerId} 缺少 baseURL 配置`,
      diagnostics: {
        providerId: provider.providerId,
        configPath: provider.configPath,
        source: provider.source,
      },
    };
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
    headers["api-key"] = provider.apiKey;
    headers["x-api-key"] = provider.apiKey;
  }

  try {
    const response = await fetch(`${provider.baseURL.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return { ok: true };
    }

    const text = await response.text();
    return {
      ok: false,
      message: text ? `HTTP ${response.status}: ${text}` : `HTTP ${response.status}`,
      diagnostics: {
        providerId: provider.providerId,
        baseURL: provider.baseURL,
        status: response.status,
        configPath: provider.configPath,
        source: provider.source,
      },
    };
  } catch (error) {
    const detail =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "连接超时（5 秒）"
        : error instanceof TypeError
          ? `网络不可达：${error.message}`
          : String(error);
    return {
      ok: false,
      message: detail,
      diagnostics: {
        providerId: provider.providerId,
        baseURL: provider.baseURL,
        configPath: provider.configPath,
        source: provider.source,
      },
    };
  }
}

export async function diagnoseModelReadiness(
  resolvedModel: { providerId: string; modelId: string },
): Promise<ModelReadinessFailure | null> {
  const providerCandidates = getProviderConfigCandidates(resolvedModel.providerId);
  const activeProvider = providerCandidates[0];
  const alternateProvider = providerCandidates[1];
  const configMismatch =
    activeProvider &&
    alternateProvider &&
    (activeProvider.baseURL !== alternateProvider.baseURL || activeProvider.api !== alternateProvider.api)
      ? {
          runtime: {
            api: activeProvider.source === "runtime" ? activeProvider.api : alternateProvider.api,
            baseURL:
              activeProvider.source === "runtime"
                ? activeProvider.baseURL
                : alternateProvider.baseURL,
            configPath:
              activeProvider.source === "runtime"
                ? activeProvider.configPath
                : alternateProvider.configPath,
          },
          ui: {
            api: activeProvider.source === "ui" ? activeProvider.api : alternateProvider.api,
            baseURL:
              activeProvider.source === "ui" ? activeProvider.baseURL : alternateProvider.baseURL,
            configPath:
              activeProvider.source === "ui"
                ? activeProvider.configPath
                : alternateProvider.configPath,
          },
        }
      : undefined;

  if (resolvedModel.providerId.startsWith("github-copilot")) {
    const hasCredential =
      hasStoredCopilotToken(resolvedModel.providerId) || hasLegacyAuthCredential(resolvedModel.providerId);
    if (!hasCredential) {
      const backupHasCredential = (() => {
        const bak = readJsonFile(LEGACY_AUTH_BACKUP);
        if (!bak) return false;
        const rec = bak[resolvedModel.providerId] as Record<string, unknown> | undefined;
        return rec != null && typeof rec === "object";
      })();

      return {
        status: 503,
        code: RUNTIME_RECOVERY_ERROR_CODES.providerAuthRequired,
        error:
          `模型 ${resolvedModel.providerId}:${resolvedModel.modelId} 需要 GitHub Copilot 认证，但当前运行时未检测到可用凭据。` +
          (backupHasCredential
            ? `检测到有效备份文件 auth.json.bak，可执行 cp ~/.local/share/opencode/auth.json.bak ~/.local/share/opencode/auth.json 恢复，或`
            : ``) +
          `请在系统配置 → 模型完成 GitHub Copilot 登录，或执行 opencode auth login 后重试。`,
        diagnostics: {
          providerId: resolvedModel.providerId,
          modelId: resolvedModel.modelId,
          authFile: LEGACY_AUTH_JSON,
          backupAvailable: backupHasCredential,
          runtimeStateDir: RUNTIME_STATE_DIR,
          uiStateDir: UI_STATE_DIR,
          configMismatch,
        },
        recoverySuggestions: [
          ...(backupHasCredential
            ? [
                {
                  id: RUNTIME_RECOVERY_SUGGESTION_IDS.copilotRestoreBackup,
                  kind: RUNTIME_RECOVERY_SUGGESTION_KINDS.command,
                  title: "从备份恢复 Copilot 凭据文件。",
                  detail:
                    "检测到 auth.json.bak 中仍有有效凭据，可能是凭据文件被意外清空。",
                  command:
                    "cp ~/.local/share/opencode/auth.json.bak ~/.local/share/opencode/auth.json",
                } as const,
              ]
            : []),
          {
            id: RUNTIME_RECOVERY_SUGGESTION_IDS.copilotLoginSettings,
            kind: RUNTIME_RECOVERY_SUGGESTION_KINDS.auth,
            title: "在系统配置 → 模型中重新登录 GitHub Copilot。",
          },
          {
            id: RUNTIME_RECOVERY_SUGGESTION_IDS.copilotLoginRuntime,
            kind: RUNTIME_RECOVERY_SUGGESTION_KINDS.command,
            title: "在运行时环境重新建立 Copilot 凭据。",
            detail: "如果当前任务实际跑在独立 runtime 环境，页面登录后仍可能需要同步运行时凭据。",
            command: "opencode auth login",
          },
        ],
      };
    }

    // Credentials valid — silently back up auth.json for recovery
    try {
      if (existsSync(LEGACY_AUTH_JSON)) {
        copyFileSync(LEGACY_AUTH_JSON, LEGACY_AUTH_BACKUP);
      }
    } catch {
      // best-effort, ignore errors
    }

    return null;
  }

  if (!activeProvider) {
    return null;
  }

  if (
    activeProvider.api &&
    ["openai-completions", "openai-responses", "github-models", "azure-openai"].includes(activeProvider.api)
  ) {
    const probe = await probeOpenAiCompatibleProvider(activeProvider);
    if (!probe.ok) {
      return {
        status: 503,
        code: RUNTIME_RECOVERY_ERROR_CODES.providerUnreachable,
        error:
          `模型 ${resolvedModel.providerId}:${resolvedModel.modelId} 当前不可达：${probe.message}。` +
          `请检查模型服务地址、网络连通性，或切换到其他可用模型后重试。`,
        diagnostics: {
          modelId: resolvedModel.modelId,
          configMismatch,
          ...probe.diagnostics,
        },
        recoverySuggestions: [
          {
            id: RUNTIME_RECOVERY_SUGGESTION_IDS.verifyProviderService,
            kind: RUNTIME_RECOVERY_SUGGESTION_KINDS.check,
            title: "检查模型服务是否已启动。",
            detail: "确认当前 baseURL 可从 BFF 或运行时所在机器访问。",
          },
          {
            id: RUNTIME_RECOVERY_SUGGESTION_IDS.verifyProviderConfig,
            kind: RUNTIME_RECOVERY_SUGGESTION_KINDS.config,
            title: "确认运行时实际使用的模型配置与页面配置一致。",
            detail: "尤其要检查 opencode.json 的 provider 地址、API 类型和运行时加载路径。",
          },
        ],
      };
    }
  }

  return null;
}
