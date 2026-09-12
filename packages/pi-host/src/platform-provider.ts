import { createHash } from "node:crypto";
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  createProvider,
  type Model,
  type Provider,
  type SimpleStreamOptions,
  type ToolCall,
} from "@earendil-works/pi-ai";
import {
  automaticModelRef,
  classifyModelError,
  type ModelCatalogEntry,
  type ModelGatewayRequestDto,
  type ModelGatewayResponse,
  type ModelGatewayStreamEvent,
  modelCatalogEntrySchema,
  modelGatewayResponseSchema,
  modelGatewayStreamEventSchema,
  type ThinkingLevel,
  thinkingLevelValues,
  type UsageRecord,
} from "@openerx/contracts";
import { desktopBrand } from "../../branding/src/index";

export interface PlatformModelTransport {
  execute(request: ModelGatewayRequestDto, signal?: AbortSignal): Promise<ModelGatewayResponse>;
  stream?(
    request: ModelGatewayRequestDto,
    signal?: AbortSignal,
  ): AsyncIterable<ModelGatewayStreamEvent>;
}

function streamEventData(event: string): string | null {
  const values = event
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return values.length > 0 ? values.join("\n") : null;
}

async function* readModelStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ModelGatewayStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let readerDone = false;
  try {
    while (!readerDone) {
      const result = await reader.read();
      readerDone = result.done;
      buffer += decoder.decode(result.value, { stream: !readerDone });
      if (buffer.length > 1_000_000) throw new Error("MODEL_STREAM_EVENT_TOO_LARGE");
      let boundary = buffer.search(/\r?\n\r?\n/u);
      while (boundary >= 0) {
        const separator = buffer.slice(boundary).startsWith("\r\n\r\n") ? 4 : 2;
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + separator);
        const data = streamEventData(event);
        if (data !== null) {
          yield modelGatewayStreamEventSchema.parse(JSON.parse(data));
        }
        boundary = buffer.search(/\r?\n\r?\n/u);
      }
    }
    const trailing = streamEventData(buffer);
    if (trailing !== null) {
      yield modelGatewayStreamEventSchema.parse(JSON.parse(trailing));
    }
  } finally {
    if (!readerDone) await reader.cancel();
    reader.releaseLock();
  }
}

export class HttpPlatformModelTransport implements PlatformModelTransport {
  readonly #baseUrl: string;
  readonly #accessToken: string;

  constructor(baseUrl: string, accessToken: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#accessToken = accessToken;
  }

  async catalog(): Promise<ModelCatalogEntry[]> {
    const body = await this.#json("/api/v2/models", { method: "GET" });
    return modelCatalogEntrySchema.array().parse(body);
  }

  async execute(
    request: ModelGatewayRequestDto,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResponse> {
    return modelGatewayResponseSchema.parse(
      await this.#json("/api/v2/model/execute", {
        method: "POST",
        body: JSON.stringify(request),
        signal,
      }),
    );
  }

  async *stream(
    request: ModelGatewayRequestDto,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelGatewayStreamEvent> {
    const response = await fetch(`${this.#baseUrl}/api/v2/model/stream`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) {
      throw await this.#responseError(response);
    }
    if (!response.body) throw new Error("MODEL_STREAM_BODY_MISSING");
    yield* readModelStream(response.body);
  }

  async #json(pathname: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.#baseUrl}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#accessToken}`,
        "content-type": "application/json",
      },
    });
    if (!response.ok) throw await this.#responseError(response);
    try {
      return await response.json();
    } catch {
      throw new Error("MODEL_RESPONSE_INVALID");
    }
  }

  async #responseError(response: Response): Promise<Error> {
    const payload: unknown = await response.json().catch(() => ({}));
    const body = (payload && typeof payload === "object" ? payload : {}) as {
      error?: { code?: unknown; message?: unknown };
    };
    const code =
      typeof body.error?.code === "string" ? body.error.code : `PLATFORM_HTTP_${response.status}`;
    const failure = classifyModelError(
      `${code}:${typeof body.error?.message === "string" ? body.error.message : ""}`,
      { httpStatus: response.status },
    );
    // Keep a safe cause and HTTP status through Pi's string error boundary.
    // Pi recognizes insufficient_quota as a limit that should not be retried.
    const message = /^(?:ACCESS_|ACCOUNT_|DEVICE_)/u.test(code)
      ? code
      : `${failure.code}:HTTP ${response.status}${failure.category === "quota" ? ":insufficient_quota" : ""}`;
    return Object.assign(new Error(message), { status: response.status });
  }
}

export interface PlatformModelRequestContext {
  accountId: string;
  conversationId: string;
  messageId: string;
  selectedModelRef: string;
  approvedFallbackModelRef: string | null;
  requestDedupeKey: string;
}

export interface CreatePlatformProviderOptions {
  catalog: ModelCatalogEntry[];
  transport: PlatformModelTransport;
  request: PlatformModelRequestContext;
  thinkingLevel?: ThinkingLevel;
  requiresImageInput?: boolean;
  onUsage?: (record: UsageRecord) => void;
  streamChunkSize?: number;
  contextRedactions?: ReadonlyArray<{
    value: string;
    replacement: string;
  }>;
}

export interface PlatformProviderHandle {
  provider: Provider<string>;
  model: Model<string>;
}

function toPiModel(entry: ModelCatalogEntry): Model<string> {
  const supported = new Set(entry.thinkingLevels ?? ["off"]);
  const thinkingLevelMap: NonNullable<Model<string>["thinkingLevelMap"]> = {};
  for (const level of thinkingLevelValues) {
    thinkingLevelMap[level] = supported.has(level) ? level : null;
  }
  return {
    id: entry.modelRef,
    name: entry.displayName,
    api: "openerx-platform",
    provider: "openerx-platform",
    baseUrl: "openerx://model-gateway",
    reasoning: [...supported].some((level) => level !== "off"),
    thinkingLevelMap,
    input: entry.capabilities.imageInput ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxOutputTokens,
  };
}

function supportsThinkingLevel(entry: ModelCatalogEntry, thinkingLevel: ThinkingLevel): boolean {
  return (entry.thinkingLevels ?? ["off"]).includes(thinkingLevel);
}

function piUsage(record: UsageRecord): AssistantMessage["usage"] {
  const input = record.inputTokens ?? 0;
  const output = record.outputTokens ?? 0;
  const cacheRead = record.cachedInputTokens ?? 0;
  // Pi requires numeric counters. Product/UI accounting always uses the authoritative UsageRecord,
  // where an unavailable category remains null and carries a missing reason.
  const totalTokens = record.totalTokens ?? input + output + cacheRead;
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    ...(record.reasoningTokens === null ? {} : { reasoning: record.reasoningTokens }),
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function roundDedupeKey(baseKey: string, context: Context): string {
  const digest = createHash("sha256").update(JSON.stringify(context), "utf8").digest("hex");
  return `${baseKey.slice(0, 160)}:ctx:${digest}`;
}

function contextHasImages(context: Context): boolean {
  return context.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some(
        (part) => typeof part === "object" && part !== null && part.type === "image",
      ),
  );
}

function redactContext(
  context: Context,
  redactions: CreatePlatformProviderOptions["contextRedactions"],
): Context {
  if (!redactions || redactions.length === 0) return context;
  const redact = (value: unknown): unknown => {
    if (typeof value === "string") {
      return redactions.reduce(
        (current, item) =>
          item.value.length > 0 ? current.replaceAll(item.value, item.replacement) : current,
        value,
      );
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [key, redact(nestedValue)]),
      );
    }
    return value;
  };
  return redact(context) as Context;
}

function streamPlatform(
  model: Model<string>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  configuration: CreatePlatformProviderOptions,
): AssistantMessageEventStream {
  const modelContext = redactContext(context, configuration.contextRedactions);
  const stream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
  stream.push({ type: "start", partial: output });
  void (async () => {
    try {
      let textContentIndex: number | undefined;
      const ensureTextBlock = (): number => {
        if (textContentIndex !== undefined) return textContentIndex;
        output.content.push({ type: "text", text: "" });
        textContentIndex = output.content.length - 1;
        stream.push({ type: "text_start", contentIndex: textContentIndex, partial: output });
        return textContentIndex;
      };
      const request: ModelGatewayRequestDto = {
        ...configuration.request,
        thinkingLevel: options?.reasoning ?? "off",
        requestDedupeKey: roundDedupeKey(configuration.request.requestDedupeKey, modelContext),
        requirements: {
          ...(contextHasImages(modelContext) ? { imageInput: true } : {}),
          ...(modelContext.tools && modelContext.tools.length > 0 ? { functionCalling: true } : {}),
        },
        context: modelContext,
      };
      const pushDelta = (delta: string): void => {
        if (options?.signal?.aborted) throw new Error("MODEL_REQUEST_ABORTED");
        const contentIndex = ensureTextBlock();
        const block = output.content[contentIndex];
        if (block?.type !== "text") throw new Error("Platform text block is missing");
        block.text += delta;
        stream.push({ type: "text_delta", contentIndex, delta, partial: output });
      };
      let response: ModelGatewayResponse | undefined;
      if (configuration.transport.stream) {
        for await (const event of configuration.transport.stream(request, options?.signal)) {
          if (event.type === "delta") {
            pushDelta(event.delta);
          } else if (event.type === "completed") {
            response = modelGatewayResponseSchema.parse(event.response);
          } else {
            throw new Error(event.errorCode);
          }
        }
      } else {
        response = modelGatewayResponseSchema.parse(
          await configuration.transport.execute(request, options?.signal),
        );
        const chunkSize = Math.max(1, configuration.streamChunkSize ?? 24);
        for (let index = 0; index < response.text.length; index += chunkSize) {
          pushDelta(response.text.slice(index, index + chunkSize));
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      if (!response) throw new Error("MODEL_STREAM_TERMINAL_EVENT_MISSING");
      if (options?.signal?.aborted) throw new Error("MODEL_REQUEST_ABORTED");
      // The gateway has already settled this model call once it emits the terminal
      // response. Preserve that authoritative usage even when the payload is later
      // rejected locally (for example, a provider content filter or malformed stream).
      output.responseModel = response.effectiveModelRef;
      output.usage = piUsage(response.usage);
      configuration.onUsage?.(response.usage);
      const textBlock =
        textContentIndex === undefined ? undefined : output.content[textContentIndex];
      if (textBlock !== undefined && textBlock.type !== "text") {
        throw new Error("Platform text block is missing");
      }
      if ((textBlock?.text ?? "") !== response.text) throw new Error("MODEL_STREAM_TEXT_MISMATCH");
      if (textBlock && textContentIndex !== undefined) {
        stream.push({
          type: "text_end",
          contentIndex: textContentIndex,
          content: textBlock.text,
          partial: output,
        });
      }
      const toolCalls = response.toolCalls ?? [];
      if (response.finishReason === "tool_calls" && toolCalls.length === 0) {
        throw new Error("MODEL_TOOL_CALLS_MISSING");
      }
      if (
        !response.text &&
        toolCalls.length === 0 &&
        (!response.finishReason || response.finishReason === "stop")
      ) {
        throw new Error("MODEL_RESPONSE_CONTENT_MISSING");
      }
      for (const responseToolCall of toolCalls) {
        const block: ToolCall = {
          type: "toolCall",
          id: responseToolCall.id,
          name: responseToolCall.name,
          arguments: {},
        };
        output.content.push(block);
        const contentIndex = output.content.length - 1;
        stream.push({ type: "toolcall_start", contentIndex, partial: output });
        const argumentsJson = JSON.stringify(responseToolCall.arguments);
        block.arguments = structuredClone(responseToolCall.arguments);
        stream.push({
          type: "toolcall_delta",
          contentIndex,
          delta: argumentsJson,
          partial: output,
        });
        stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
      }
      output.stopReason =
        toolCalls.length > 0
          ? "toolUse"
          : response.finishReason === "length"
            ? "length"
            : response.finishReason === "content_filter" ||
                response.finishReason === "insufficient_system_resource"
              ? "error"
              : "stop";
      output.rawStopReason = response.finishReason ?? undefined;
      if (output.stopReason === "error") {
        output.errorMessage = `MODEL_FINISH_REASON:${response.finishReason ?? "unknown"}`;
        stream.push({ type: "error", reason: "error", error: output });
      } else {
        stream.push({ type: "done", reason: output.stopReason, message: output });
      }
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();
  return stream;
}

export function createPlatformModelProvider(
  options: CreatePlatformProviderOptions,
): PlatformProviderHandle {
  const catalog = options.catalog.map((entry) => modelCatalogEntrySchema.parse(entry));
  const models = catalog.map(toPiModel);
  const available = catalog.filter(
    ({ modelRef, status }) => modelRef !== automaticModelRef && status === "available",
  );
  const requestedThinkingLevel = options.thinkingLevel;
  const selectedEntry =
    options.request.selectedModelRef === automaticModelRef
      ? available.find(
          (entry) =>
            (options.requiresImageInput !== true || entry.capabilities.imageInput === true) &&
            (requestedThinkingLevel === undefined ||
              supportsThinkingLevel(entry, requestedThinkingLevel)),
        )
      : catalog.find(({ modelRef }) => modelRef === options.request.selectedModelRef);
  if (selectedEntry?.status !== "available") {
    throw new Error(`PLATFORM_MODEL_NOT_FOUND:${options.request.selectedModelRef}`);
  }
  if (options.requiresImageInput && !selectedEntry.capabilities.imageInput) {
    const suggestions = available
      .filter(({ capabilities }) => capabilities.imageInput)
      .map(({ modelRef }) => modelRef)
      .join(",");
    throw new Error(`MODEL_CAPABILITY_UNSUPPORTED:imageInput:${suggestions}`);
  }
  if (
    requestedThinkingLevel !== undefined &&
    !supportsThinkingLevel(selectedEntry, requestedThinkingLevel)
  ) {
    const suggestions = available
      .filter(
        (entry) =>
          supportsThinkingLevel(entry, requestedThinkingLevel) &&
          (options.requiresImageInput !== true || entry.capabilities.imageInput),
      )
      .map(({ modelRef }) => modelRef)
      .join(",");
    throw new Error(
      `MODEL_CAPABILITY_UNSUPPORTED:thinking:${requestedThinkingLevel}:${suggestions}`,
    );
  }
  const selected = models.find(({ id }) => id === selectedEntry.modelRef);
  if (!selected) throw new Error(`PLATFORM_MODEL_NOT_FOUND:${selectedEntry.modelRef}`);
  const provider = createProvider<string>({
    id: "openerx-platform",
    name: `${desktopBrand.productName} Platform`,
    auth: {
      apiKey: {
        name: `${desktopBrand.productName} device session`,
        resolve: async () => ({ auth: {}, source: "brokered device session" }),
      },
    },
    models,
    api: {
      stream: (model, context, streamOptions) =>
        streamPlatform(model, context, streamOptions, options),
      streamSimple: (model, context, streamOptions) =>
        streamPlatform(model, context, streamOptions, options),
    },
  });
  return { provider, model: selected };
}
