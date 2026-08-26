import {
  automaticModelRef,
  type ModelCatalogEntry,
  type ModelGatewayRequestDto,
  redactSensitiveText,
} from "@openerx/contracts";
import type {
  ModelExecutionResult,
  ModelExecutionUsage,
  ModelExecutor,
} from "./model-gateway-service";

export const deepSeekApiBaseUrl = "https://api.deepseek.com" as const;
export const deepSeekProviderMaxOutputTokens = 384_000 as const;

export const deepSeekModelRefs = {
  flash: "platform/deepseek-v4-flash",
  pro: "platform/deepseek-v4-pro",
} as const;

export const deepSeekPriceRefs = {
  flash: "price/deepseek-v4-flash-official-cn-2026-08-26",
  pro: "price/deepseek-v4-pro-official-cn-2026-08-26",
  automaticFlash: "price/deepseek-auto-flash-official-cn-2026-08-26",
  automaticPro: "price/deepseek-auto-pro-official-cn-2026-08-26",
} as const;

export type DeepSeekModelId = "deepseek-v4-flash" | "deepseek-v4-pro";
export type DeepSeekThinkingMode = "enabled" | "disabled";
export type DeepSeekFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export type DeepSeekEnvironment = Readonly<Record<string, string | undefined>>;

const modelIdByRef: Readonly<Record<string, DeepSeekModelId>> = {
  [deepSeekModelRefs.flash]: "deepseek-v4-flash",
  [deepSeekModelRefs.pro]: "deepseek-v4-pro",
};

const modelRefById: Readonly<Record<DeepSeekModelId, string>> = {
  "deepseek-v4-flash": deepSeekModelRefs.flash,
  "deepseek-v4-pro": deepSeekModelRefs.pro,
};

const deepSeekProviderModelCatalog: ModelCatalogEntry[] = [
  {
    modelRef: deepSeekModelRefs.flash,
    displayName: "DeepSeek V4 Flash",
    version: "official-latest",
    capabilities: {
      text: true,
      imageInput: false,
      fileInput: false,
      tools: false,
      mcp: false,
      imageGeneration: false,
    },
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    status: "available",
    priceRef: deepSeekPriceRefs.flash,
    priceSummary: "服务端按 DeepSeek 官方人民币费率和实际 Token 结算",
    free: false,
  },
  {
    modelRef: deepSeekModelRefs.pro,
    displayName: "DeepSeek V4 Pro",
    version: "official-latest",
    capabilities: {
      text: true,
      imageInput: false,
      fileInput: false,
      tools: false,
      mcp: false,
      imageGeneration: false,
    },
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    status: "available",
    priceRef: deepSeekPriceRefs.pro,
    priceSummary: "服务端按 DeepSeek 官方人民币费率和实际 Token 结算",
    free: false,
  },
];

export function createDeepSeekModelCatalog(
  defaultModel: DeepSeekModelId = "deepseek-v4-flash",
): ModelCatalogEntry[] {
  const defaultRef = modelRefById[defaultModel];
  const defaultEntry = deepSeekProviderModelCatalog.find(({ modelRef }) => modelRef === defaultRef);
  if (!defaultEntry) throw new Error("DEEPSEEK_DEFAULT_MODEL_NOT_CATALOGED");
  const automatic: ModelCatalogEntry = {
    ...defaultEntry,
    modelRef: automaticModelRef,
    displayName: `自动 · ${defaultEntry.displayName}`,
    version: `auto:${defaultEntry.version}`,
    priceRef:
      defaultModel === "deepseek-v4-flash"
        ? deepSeekPriceRefs.automaticFlash
        : deepSeekPriceRefs.automaticPro,
  };
  return [
    automatic,
    ...deepSeekProviderModelCatalog
      .filter(({ modelRef }) => modelRef === defaultRef)
      .concat(deepSeekProviderModelCatalog.filter(({ modelRef }) => modelRef !== defaultRef))
      .map((entry) => structuredClone(entry)),
  ];
}

export const deepSeekModelCatalog = createDeepSeekModelCatalog();

interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface DeepSeekUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_cache_hit_tokens?: unknown;
  prompt_cache_miss_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown };
  completion_tokens_details?: { reasoning_tokens?: unknown };
}

interface DeepSeekResponse {
  model?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    message?: { content?: unknown };
  }>;
  usage?: DeepSeekUsage;
}

export interface DeepSeekModelExecutorOptions {
  apiKey: string;
  defaultModel?: DeepSeekModelId;
  thinking?: DeepSeekThinkingMode;
  timeoutMs?: number;
  fetch?: DeepSeekFetch;
}

function requiredApiKey(value: string): string {
  const apiKey = value.trim();
  if (!/^sk-[A-Za-z0-9_-]{16,}$/u.test(apiKey)) {
    throw new Error("DEEPSEEK_API_KEY_INVALID");
  }
  return apiKey;
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function textParts(content: unknown): { text: string; hasUnsupportedMedia: boolean } {
  if (typeof content === "string") return { text: content, hasUnsupportedMedia: false };
  if (!Array.isArray(content)) return { text: "", hasUnsupportedMedia: false };
  const text: string[] = [];
  let hasUnsupportedMedia = false;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      text.push(candidate.text);
    } else if (candidate.type !== "thinking") {
      hasUnsupportedMedia = true;
    }
  }
  return { text: text.join("\n"), hasUnsupportedMedia };
}

function toDeepSeekMessages(context: unknown): DeepSeekMessage[] {
  if (!context || typeof context !== "object") throw new Error("DEEPSEEK_CONTEXT_INVALID");
  const candidate = context as { systemPrompt?: unknown; messages?: unknown };
  if (!Array.isArray(candidate.messages)) throw new Error("DEEPSEEK_CONTEXT_INVALID");
  const messages: DeepSeekMessage[] = [];
  if (typeof candidate.systemPrompt === "string" && candidate.systemPrompt.trim()) {
    messages.push({ role: "system", content: candidate.systemPrompt });
  }
  for (const raw of candidate.messages) {
    if (!raw || typeof raw !== "object") continue;
    const message = raw as {
      role?: unknown;
      content?: unknown;
      toolName?: unknown;
      isError?: unknown;
    };
    const content = textParts(message.content);
    if (content.hasUnsupportedMedia) throw new Error("DEEPSEEK_MEDIA_INPUT_UNSUPPORTED");
    if (!content.text) continue;
    if (message.role === "user" || message.role === "assistant") {
      messages.push({ role: message.role, content: content.text });
      continue;
    }
    if (message.role === "toolResult") {
      const toolName = typeof message.toolName === "string" ? message.toolName : "tool";
      const status = message.isError === true ? "error" : "result";
      messages.push({ role: "user", content: `[${toolName} ${status}]\n${content.text}` });
    }
  }
  if (!messages.some(({ role }) => role === "user"))
    throw new Error("DEEPSEEK_USER_MESSAGE_REQUIRED");
  return messages;
}

function providerError(body: unknown, status: number): Error {
  const candidate = body as { error?: { code?: unknown; message?: unknown } } | null;
  const code =
    typeof candidate?.error?.code === "string" ? candidate.error.code.slice(0, 80) : "HTTP_ERROR";
  const message =
    typeof candidate?.error?.message === "string"
      ? redactSensitiveText(candidate.error.message).slice(0, 240)
      : "DeepSeek request failed";
  return new Error(`DEEPSEEK_API_ERROR:${status}:${code}:${message}`);
}

function usageFrom(response: DeepSeekResponse): ModelExecutionUsage {
  const usage = response.usage;
  if (!usage) {
    return {
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      providerReported: false,
      missingReasons: {
        inputTokens: "provider_usage_missing",
        cachedInputTokens: "provider_usage_missing",
        outputTokens: "provider_usage_missing",
        reasoningTokens: "provider_usage_missing",
        totalTokens: "provider_usage_missing",
      },
    };
  }
  const promptTokens = nonnegativeInteger(usage.prompt_tokens);
  const cachedInputTokens = nonnegativeInteger(
    usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens,
  );
  const reportedMissTokens = nonnegativeInteger(usage.prompt_cache_miss_tokens);
  const inputTokens =
    reportedMissTokens ??
    (promptTokens !== null && cachedInputTokens !== null && cachedInputTokens <= promptTokens
      ? promptTokens - cachedInputTokens
      : promptTokens);
  const result = {
    inputTokens,
    cachedInputTokens,
    outputTokens: nonnegativeInteger(usage.completion_tokens),
    reasoningTokens: nonnegativeInteger(usage.completion_tokens_details?.reasoning_tokens),
    totalTokens: nonnegativeInteger(usage.total_tokens),
  };
  return {
    ...result,
    providerReported: true,
    missingReasons: Object.fromEntries(
      Object.entries(result)
        .filter(([, value]) => value === null)
        .map(([field]) => [field, "provider_not_reported"]),
    ),
  };
}

export class DeepSeekModelExecutor implements ModelExecutor {
  readonly #apiKey: string;
  readonly #defaultModel: DeepSeekModelId;
  readonly #thinking: DeepSeekThinkingMode;
  readonly #timeoutMs: number;
  readonly #fetch: DeepSeekFetch;

  constructor(options: DeepSeekModelExecutorOptions) {
    this.#apiKey = requiredApiKey(options.apiKey);
    this.#defaultModel = options.defaultModel ?? "deepseek-v4-flash";
    this.#thinking = options.thinking ?? "disabled";
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#fetch = options.fetch ?? fetch;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new Error("DEEPSEEK_TIMEOUT_MS_INVALID");
    }
  }

  async execute(
    request: ModelGatewayRequestDto,
    signal: AbortSignal | undefined,
  ): Promise<ModelExecutionResult> {
    const model =
      request.selectedModelRef === automaticModelRef
        ? this.#defaultModel
        : modelIdByRef[request.selectedModelRef];
    if (!model) throw new Error(`DEEPSEEK_MODEL_NOT_CONFIGURED:${request.selectedModelRef}`);
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.#fetch(`${deepSeekApiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: toDeepSeekMessages(request.context),
          thinking: { type: this.#thinking },
          max_tokens: deepSeekProviderMaxOutputTokens,
          stream: false,
          user_id: request.accountId,
        }),
        signal: requestSignal,
      });
    } catch (error) {
      if (signal?.aborted) throw new Error("MODEL_REQUEST_ABORTED");
      if (timeout.aborted) throw new Error("DEEPSEEK_REQUEST_TIMEOUT");
      throw new Error(`DEEPSEEK_NETWORK_ERROR:${redactSensitiveText(String(error)).slice(0, 240)}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(`DEEPSEEK_RESPONSE_INVALID_JSON:${response.status}`);
    }
    if (!response.ok) throw providerError(body, response.status);
    const parsed = body as DeepSeekResponse;
    const text = parsed.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("DEEPSEEK_RESPONSE_TEXT_MISSING");
    const rawFinishReason = parsed.choices?.[0]?.finish_reason;
    const finishReason =
      typeof rawFinishReason === "string" && rawFinishReason.length > 0
        ? rawFinishReason.slice(0, 80)
        : undefined;
    const responseModel =
      typeof parsed.model === "string" && parsed.model in modelRefById
        ? (parsed.model as DeepSeekModelId)
        : null;
    if (!responseModel) throw new Error("DEEPSEEK_RESPONSE_MODEL_INVALID");
    const effectiveModelRef = modelRefById[responseModel];
    const fallbackReason =
      responseModel === model ? undefined : `provider_response_model:${model}->${responseModel}`;
    return {
      text,
      effectiveModelRef,
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(finishReason ? { finishReason } : {}),
      usage: usageFrom(parsed),
    };
  }
}

function optionalPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("DEEPSEEK_NUMERIC_CONFIG_INVALID");
  return parsed;
}

export function createDeepSeekModelExecutorFromEnv(
  environment: DeepSeekEnvironment = process.env,
): DeepSeekModelExecutor {
  const defaultModel = deepSeekDefaultModelFromEnv(environment);
  const thinking = environment.DEEPSEEK_THINKING?.trim() || "disabled";
  if (thinking !== "enabled" && thinking !== "disabled") {
    throw new Error("DEEPSEEK_THINKING_INVALID");
  }
  return new DeepSeekModelExecutor({
    apiKey: environment.DEEPSEEK_API_KEY ?? "",
    defaultModel,
    thinking,
    timeoutMs: optionalPositiveInteger(environment.DEEPSEEK_TIMEOUT_MS, 120_000),
  });
}

export function deepSeekDefaultModelFromEnv(
  environment: DeepSeekEnvironment = process.env,
): DeepSeekModelId {
  const defaultModel = environment.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
  if (defaultModel !== "deepseek-v4-flash" && defaultModel !== "deepseek-v4-pro") {
    throw new Error("DEEPSEEK_MODEL_INVALID");
  }
  return defaultModel;
}
