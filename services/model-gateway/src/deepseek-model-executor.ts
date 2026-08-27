import {
  automaticModelRef,
  type ModelCatalogEntry,
  type ModelGatewayRequestDto,
  type ModelGatewayToolCall,
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
  vision: "platform/deepseek-v4-flash-vision-exp",
} as const;

export const deepSeekPriceRefs = {
  flash: "price/deepseek-v4-flash-official-cn-2026-08-26",
  pro: "price/deepseek-v4-pro-official-cn-2026-08-26",
  vision: "price/deepseek-v4-flash-vision-exp-official-cn-2026-08-26",
  automaticFlash: "price/deepseek-auto-flash-official-cn-2026-08-26",
  automaticPro: "price/deepseek-auto-pro-official-cn-2026-08-26",
} as const;

export type DeepSeekDefaultModelId = "deepseek-v4-flash" | "deepseek-v4-pro";
export type DeepSeekModelId = DeepSeekDefaultModelId | "deepseek-v4-flash-vision-exp";
export type DeepSeekThinkingMode = "enabled" | "disabled";
export type DeepSeekFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export type DeepSeekEnvironment = Readonly<Record<string, string | undefined>>;

const modelIdByRef: Readonly<Record<string, DeepSeekModelId>> = {
  [deepSeekModelRefs.flash]: "deepseek-v4-flash",
  [deepSeekModelRefs.pro]: "deepseek-v4-pro",
  [deepSeekModelRefs.vision]: "deepseek-v4-flash-vision-exp",
};

const modelRefById: Readonly<Record<DeepSeekModelId, string>> = {
  "deepseek-v4-flash": deepSeekModelRefs.flash,
  "deepseek-v4-pro": deepSeekModelRefs.pro,
  "deepseek-v4-flash-vision-exp": deepSeekModelRefs.vision,
};

const deepSeekProviderModelCatalog: ModelCatalogEntry[] = [
  {
    modelRef: deepSeekModelRefs.flash,
    displayName: "DeepSeek V4 Flash",
    version: "official-latest",
    capabilities: {
      textInput: true,
      imageInput: false,
      fileInput: false,
      functionCalling: true,
      structuredOutput: true,
    },
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    status: "available",
    priceRef: deepSeekPriceRefs.flash,
    priceSummary: "服务端按 DeepSeek 官方人民币费率和实际 Token 结算",
    free: false,
    thinkingLevels: ["off", "medium"],
  },
  {
    modelRef: deepSeekModelRefs.pro,
    displayName: "DeepSeek V4 Pro",
    version: "official-latest",
    capabilities: {
      textInput: true,
      imageInput: false,
      fileInput: false,
      functionCalling: true,
      structuredOutput: true,
    },
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    status: "available",
    priceRef: deepSeekPriceRefs.pro,
    priceSummary: "服务端按 DeepSeek 官方人民币费率和实际 Token 结算",
    free: false,
    thinkingLevels: ["off", "medium"],
  },
  {
    modelRef: deepSeekModelRefs.vision,
    displayName: "DeepSeek V4 Flash Vision（实验）",
    version: "official-experimental-2026-08-21",
    capabilities: {
      textInput: true,
      imageInput: true,
      fileInput: false,
      functionCalling: true,
      structuredOutput: true,
    },
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    status: "available",
    priceRef: deepSeekPriceRefs.vision,
    priceSummary: "实验视觉模型；服务端按 DeepSeek 官方费率和实际 Token 结算",
    free: false,
    thinkingLevels: ["off", "medium"],
  },
];

export function createDeepSeekModelCatalog(
  defaultModel: DeepSeekDefaultModelId = "deepseek-v4-flash",
): ModelCatalogEntry[] {
  const defaultRef = modelRefById[defaultModel];
  const defaultEntry = deepSeekProviderModelCatalog.find(({ modelRef }) => modelRef === defaultRef);
  if (!defaultEntry) throw new Error("DEEPSEEK_DEFAULT_MODEL_NOT_CATALOGED");
  const automatic: ModelCatalogEntry = {
    ...defaultEntry,
    modelRef: automaticModelRef,
    displayName: `自动 · ${defaultEntry.displayName}`,
    version: `auto:${defaultEntry.version}`,
    capabilities: { ...defaultEntry.capabilities, imageInput: true },
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

interface DeepSeekFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface DeepSeekWireToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface DeepSeekTextContentPart {
  type: "text";
  text: string;
}

interface DeepSeekImageContentPart {
  type: "image_url";
  image_url: { url: string };
}

type DeepSeekUserContentPart = DeepSeekTextContentPart | DeepSeekImageContentPart;

type DeepSeekMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | DeepSeekUserContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: DeepSeekWireToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

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
    message?: { content?: unknown; tool_calls?: unknown };
  }>;
  usage?: DeepSeekUsage;
}

interface DeepSeekStreamChunk {
  model?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: unknown;
    };
  }>;
  usage?: DeepSeekUsage | null;
}

export interface DeepSeekModelExecutorOptions {
  apiKey: string;
  defaultModel?: DeepSeekDefaultModelId;
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

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function productToolCall(value: unknown): ModelGatewayToolCall {
  if (!plainRecord(value)) throw new Error("DEEPSEEK_TOOL_CALL_INVALID");
  const id = value.id;
  const name = value.name;
  const args = value.arguments;
  if (
    typeof id !== "string" ||
    id.length < 1 ||
    id.length > 240 ||
    typeof name !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(name) ||
    !plainRecord(args)
  ) {
    throw new Error("DEEPSEEK_TOOL_CALL_INVALID");
  }
  return { id, name, arguments: structuredClone(args) };
}

function contentParts(content: unknown): {
  text: string;
  toolCalls: ModelGatewayToolCall[];
  userContent: DeepSeekUserContentPart[];
  hasUnsupportedMedia: boolean;
} {
  if (typeof content === "string") {
    return {
      text: content,
      toolCalls: [],
      userContent: content ? [{ type: "text", text: content }] : [],
      hasUnsupportedMedia: false,
    };
  }
  if (!Array.isArray(content)) {
    return { text: "", toolCalls: [], userContent: [], hasUnsupportedMedia: false };
  }
  const text: string[] = [];
  const toolCalls: ModelGatewayToolCall[] = [];
  const userContent: DeepSeekUserContentPart[] = [];
  let hasUnsupportedMedia = false;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as {
      type?: unknown;
      text?: unknown;
      id?: unknown;
      name?: unknown;
      arguments?: unknown;
      data?: unknown;
      mimeType?: unknown;
    };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      text.push(candidate.text);
      userContent.push({ type: "text", text: candidate.text });
    } else if (candidate.type === "image") {
      const data = candidate.data;
      const mimeType = candidate.mimeType;
      if (
        typeof data !== "string" ||
        data.length < 4 ||
        data.length > 44_739_244 ||
        data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/u.test(data) ||
        (mimeType !== "image/gif" &&
          mimeType !== "image/jpeg" &&
          mimeType !== "image/png" &&
          mimeType !== "image/webp")
      ) {
        throw new Error("DEEPSEEK_IMAGE_INPUT_INVALID");
      }
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${data}` },
      });
    } else if (candidate.type === "toolCall") {
      toolCalls.push(productToolCall(candidate));
    } else if (candidate.type !== "thinking") {
      hasUnsupportedMedia = true;
    }
  }
  return { text: text.join("\n"), toolCalls, userContent, hasUnsupportedMedia };
}

function wireToolCall(toolCall: ModelGatewayToolCall): DeepSeekWireToolCall {
  return {
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function parseToolCallArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") throw new Error("DEEPSEEK_TOOL_ARGUMENTS_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("DEEPSEEK_TOOL_ARGUMENTS_INVALID");
  }
  if (!plainRecord(parsed)) throw new Error("DEEPSEEK_TOOL_ARGUMENTS_INVALID");
  return parsed;
}

function parseDeepSeekToolCalls(value: unknown): ModelGatewayToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("DEEPSEEK_TOOL_CALLS_INVALID");
  }
  return value.map((raw) => {
    if (!plainRecord(raw) || raw.type !== "function" || !plainRecord(raw.function)) {
      throw new Error("DEEPSEEK_TOOL_CALL_INVALID");
    }
    return productToolCall({
      id: raw.id,
      name: raw.function.name,
      arguments: parseToolCallArguments(raw.function.arguments),
    });
  });
}

function toDeepSeekTools(context: unknown): DeepSeekFunctionTool[] {
  if (!plainRecord(context)) throw new Error("DEEPSEEK_CONTEXT_INVALID");
  if (context.tools === undefined) return [];
  if (!Array.isArray(context.tools) || context.tools.length > 128) {
    throw new Error("DEEPSEEK_TOOL_LIMIT_EXCEEDED");
  }
  return context.tools.map((raw) => {
    if (!plainRecord(raw)) throw new Error("DEEPSEEK_TOOL_DEFINITION_INVALID");
    const { name, description, parameters } = raw;
    if (
      typeof name !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/u.test(name) ||
      typeof description !== "string" ||
      !plainRecord(parameters)
    ) {
      throw new Error("DEEPSEEK_TOOL_DEFINITION_INVALID");
    }
    return {
      type: "function",
      function: { name, description, parameters: structuredClone(parameters) },
    };
  });
}

function toDeepSeekMessages(context: unknown, allowImages: boolean): DeepSeekMessage[] {
  if (!plainRecord(context)) throw new Error("DEEPSEEK_CONTEXT_INVALID");
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
      toolCallId?: unknown;
      toolName?: unknown;
      isError?: unknown;
    };
    const content = contentParts(message.content);
    if (content.hasUnsupportedMedia) throw new Error("DEEPSEEK_MEDIA_INPUT_UNSUPPORTED");
    if (message.role === "user") {
      if (content.toolCalls.length > 0) throw new Error("DEEPSEEK_CONTEXT_INVALID");
      const hasImages = content.userContent.some(({ type }) => type === "image_url");
      if (hasImages && !allowImages) throw new Error("DEEPSEEK_MEDIA_INPUT_UNSUPPORTED");
      if (content.userContent.length > 0) {
        messages.push({
          role: "user",
          content: hasImages ? content.userContent : content.text,
        });
      }
      continue;
    }
    if (message.role === "assistant") {
      if (content.userContent.some(({ type }) => type === "image_url")) {
        throw new Error("DEEPSEEK_MEDIA_INPUT_UNSUPPORTED");
      }
      if (!content.text && content.toolCalls.length === 0) continue;
      messages.push({
        role: "assistant",
        content: content.text || null,
        ...(content.toolCalls.length > 0
          ? { tool_calls: content.toolCalls.map(wireToolCall) }
          : {}),
      });
      continue;
    }
    if (message.role === "toolResult") {
      if (
        content.toolCalls.length > 0 ||
        content.userContent.some(({ type }) => type === "image_url") ||
        typeof message.toolCallId !== "string"
      ) {
        throw new Error("DEEPSEEK_CONTEXT_INVALID");
      }
      messages.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.isError === true ? `[tool error]\n${content.text}` : content.text,
      });
    }
  }
  if (!messages.some(({ role }) => role === "user"))
    throw new Error("DEEPSEEK_USER_MESSAGE_REQUIRED");
  return messages;
}

function modelForRequest(
  request: ModelGatewayRequestDto,
  defaultModel: DeepSeekDefaultModelId,
): DeepSeekModelId {
  if (request.selectedModelRef === automaticModelRef) {
    return request.requirements.imageInput === true ? "deepseek-v4-flash-vision-exp" : defaultModel;
  }
  const model = modelIdByRef[request.selectedModelRef];
  if (!model) throw new Error(`DEEPSEEK_MODEL_NOT_CONFIGURED:${request.selectedModelRef}`);
  return model;
}

function thinkingModeForRequest(
  request: ModelGatewayRequestDto,
  fallback: DeepSeekThinkingMode,
): DeepSeekThinkingMode {
  if (request.thinkingLevel === undefined) return fallback;
  return request.thinkingLevel === "off" ? "disabled" : "enabled";
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

function sseEventData(event: string): string | null {
  const values = event
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return values.length > 0 ? values.join("\n") : null;
}

async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let readerDone = false;
  try {
    while (!readerDone) {
      const result = await reader.read();
      readerDone = result.done;
      buffer += decoder.decode(result.value, { stream: !readerDone });
      if (buffer.length > 1_000_000) throw new Error("DEEPSEEK_STREAM_EVENT_TOO_LARGE");
      let boundary = buffer.search(/\r?\n\r?\n/u);
      while (boundary >= 0) {
        const separator = buffer.slice(boundary).startsWith("\r\n\r\n") ? 4 : 2;
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + separator);
        const data = sseEventData(event);
        if (data !== null) yield data;
        boundary = buffer.search(/\r?\n\r?\n/u);
      }
    }
    const trailing = sseEventData(buffer);
    if (trailing !== null) yield trailing;
  } finally {
    if (!readerDone) await reader.cancel();
    reader.releaseLock();
  }
}

interface StreamToolCallAccumulator {
  id: string;
  name: string;
  argumentsJson: string;
}

function mergeStreamName(current: string, next: string): string {
  if (!current || next.startsWith(current)) return next;
  if (current.startsWith(next)) return current;
  return `${current}${next}`;
}

function accumulateStreamToolCalls(
  value: unknown,
  accumulators: Map<number, StreamToolCallAccumulator>,
): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) throw new Error("DEEPSEEK_TOOL_CALLS_INVALID");
  for (const raw of value) {
    if (!plainRecord(raw)) throw new Error("DEEPSEEK_TOOL_CALL_INVALID");
    const index = nonnegativeInteger(raw.index);
    if (index === null || index >= 128) throw new Error("DEEPSEEK_TOOL_CALL_INVALID");
    const current = accumulators.get(index) ?? { id: "", name: "", argumentsJson: "" };
    if (raw.type !== undefined && raw.type !== "function") {
      throw new Error("DEEPSEEK_TOOL_CALL_INVALID");
    }
    if (raw.id !== undefined) {
      if (typeof raw.id !== "string" || (current.id && current.id !== raw.id)) {
        throw new Error("DEEPSEEK_TOOL_CALL_INVALID");
      }
      current.id = raw.id;
    }
    if (raw.function !== undefined) {
      if (!plainRecord(raw.function)) throw new Error("DEEPSEEK_TOOL_CALL_INVALID");
      if (raw.function.name !== undefined) {
        if (typeof raw.function.name !== "string") {
          throw new Error("DEEPSEEK_TOOL_CALL_INVALID");
        }
        current.name = mergeStreamName(current.name, raw.function.name);
      }
      if (raw.function.arguments !== undefined) {
        if (typeof raw.function.arguments !== "string") {
          throw new Error("DEEPSEEK_TOOL_CALL_INVALID");
        }
        current.argumentsJson += raw.function.arguments;
      }
    }
    accumulators.set(index, current);
  }
}

function completedStreamToolCalls(
  accumulators: Map<number, StreamToolCallAccumulator>,
): ModelGatewayToolCall[] {
  return [...accumulators.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) =>
      productToolCall({
        id: toolCall.id,
        name: toolCall.name,
        arguments: parseToolCallArguments(toolCall.argumentsJson),
      }),
    );
}

export class DeepSeekModelExecutor implements ModelExecutor {
  readonly #apiKey: string;
  readonly #defaultModel: DeepSeekDefaultModelId;
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
    const model = modelForRequest(request, this.#defaultModel);
    const messages = toDeepSeekMessages(request.context, model === "deepseek-v4-flash-vision-exp");
    const tools = toDeepSeekTools(request.context);
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
          messages,
          ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
          thinking: { type: thinkingModeForRequest(request, this.#thinking) },
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
    const choice = parsed.choices?.[0];
    const toolCalls = parseDeepSeekToolCalls(choice?.message?.tool_calls);
    const rawText = choice?.message?.content;
    const text = rawText === null || rawText === undefined ? "" : rawText;
    if (typeof text !== "string") throw new Error("DEEPSEEK_RESPONSE_TEXT_INVALID");
    const rawFinishReason = choice?.finish_reason;
    const finishReason =
      typeof rawFinishReason === "string" && rawFinishReason.length > 0
        ? rawFinishReason.slice(0, 80)
        : undefined;
    if (finishReason === "tool_calls" && toolCalls.length === 0) {
      throw new Error("DEEPSEEK_TOOL_CALLS_MISSING");
    }
    if (!text && toolCalls.length === 0 && (!finishReason || finishReason === "stop")) {
      throw new Error("DEEPSEEK_RESPONSE_CONTENT_MISSING");
    }
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
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      effectiveModelRef,
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(finishReason ? { finishReason } : {}),
      usage: usageFrom(parsed),
    };
  }

  async stream(
    request: ModelGatewayRequestDto,
    onDelta: (delta: string) => void,
    signal: AbortSignal | undefined,
  ): Promise<ModelExecutionResult> {
    const model = modelForRequest(request, this.#defaultModel);
    const messages = toDeepSeekMessages(request.context, model === "deepseek-v4-flash-vision-exp");
    const tools = toDeepSeekTools(request.context);
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
          messages,
          ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
          thinking: { type: thinkingModeForRequest(request, this.#thinking) },
          max_tokens: deepSeekProviderMaxOutputTokens,
          stream: true,
          stream_options: { include_usage: true },
          user_id: request.accountId,
        }),
        signal: requestSignal,
      });
    } catch (error) {
      if (signal?.aborted) throw new Error("MODEL_REQUEST_ABORTED");
      if (timeout.aborted) throw new Error("DEEPSEEK_REQUEST_TIMEOUT");
      throw new Error(`DEEPSEEK_NETWORK_ERROR:${redactSensitiveText(String(error)).slice(0, 240)}`);
    }
    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // providerError supplies a redacted generic message for non-JSON failures.
      }
      throw providerError(body, response.status);
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
      throw new Error("DEEPSEEK_STREAM_CONTENT_TYPE_INVALID");
    }
    if (!response.body) throw new Error("DEEPSEEK_STREAM_BODY_MISSING");

    let text = "";
    let finishReason: string | undefined;
    let responseModel: DeepSeekModelId | null = null;
    let usage: DeepSeekUsage | undefined;
    let completed = false;
    const streamedToolCalls = new Map<number, StreamToolCallAccumulator>();
    try {
      for await (const data of sseData(response.body)) {
        if (signal?.aborted) throw new Error("MODEL_REQUEST_ABORTED");
        if (data === "[DONE]") {
          completed = true;
          break;
        }
        let chunk: DeepSeekStreamChunk;
        try {
          chunk = JSON.parse(data) as DeepSeekStreamChunk;
        } catch {
          throw new Error("DEEPSEEK_STREAM_CHUNK_INVALID");
        }
        if (typeof chunk.model === "string") {
          if (!(chunk.model in modelRefById)) {
            throw new Error("DEEPSEEK_RESPONSE_MODEL_INVALID");
          }
          responseModel = chunk.model as DeepSeekModelId;
          const effectiveModelRef = modelRefById[responseModel];
          if (responseModel !== model && request.approvedFallbackModelRef !== effectiveModelRef) {
            throw new Error("MODEL_SILENT_FALLBACK_REJECTED");
          }
        }
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          text += delta;
          onDelta(delta);
        }
        accumulateStreamToolCalls(choice?.delta?.tool_calls, streamedToolCalls);
        if (typeof choice?.finish_reason === "string" && choice.finish_reason.length > 0) {
          finishReason = choice.finish_reason.slice(0, 80);
        }
      }
    } catch (error) {
      if (signal?.aborted) throw new Error("MODEL_REQUEST_ABORTED");
      if (timeout.aborted) throw new Error("DEEPSEEK_REQUEST_TIMEOUT");
      if (
        error instanceof Error &&
        (error.message.startsWith("DEEPSEEK_") || error.message.startsWith("MODEL_"))
      ) {
        throw error;
      }
      throw new Error(`DEEPSEEK_STREAM_ERROR:${redactSensitiveText(String(error)).slice(0, 240)}`);
    }
    if (!completed) throw new Error("DEEPSEEK_STREAM_INCOMPLETE");
    if (!responseModel) throw new Error("DEEPSEEK_RESPONSE_MODEL_INVALID");
    const toolCalls = completedStreamToolCalls(streamedToolCalls);
    if (finishReason === "tool_calls" && toolCalls.length === 0) {
      throw new Error("DEEPSEEK_TOOL_CALLS_MISSING");
    }
    if (!text && toolCalls.length === 0 && (!finishReason || finishReason === "stop")) {
      throw new Error("DEEPSEEK_RESPONSE_CONTENT_MISSING");
    }
    const effectiveModelRef = modelRefById[responseModel];
    const fallbackReason =
      responseModel === model ? undefined : `provider_response_model:${model}->${responseModel}`;
    return {
      text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      effectiveModelRef,
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(finishReason ? { finishReason } : {}),
      usage: usageFrom({ usage }),
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
): DeepSeekDefaultModelId {
  const defaultModel = environment.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
  if (defaultModel !== "deepseek-v4-flash" && defaultModel !== "deepseek-v4-pro") {
    throw new Error("DEEPSEEK_MODEL_INVALID");
  }
  return defaultModel;
}
