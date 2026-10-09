import { createHash } from "node:crypto";
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  createProvider,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Model,
  type Provider,
  type SimpleStreamOptions,
  type ToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  automaticModelRef,
  classifyModelError,
  hostedModelCatalogSchema,
  hostedModelUsageSchema,
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
import {
  decodePlatformState,
  encodePlatformState,
  projectPlatformContext,
} from "./platform-context";
import { browserToolContent, officeVisualReviewUnavailable } from "./tool-result";

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
      if (buffer.length > 32 * 1024 * 1024) throw new Error("MODEL_STREAM_EVENT_TOO_LARGE");
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

export interface PlatformTransportOptions {
  apiVersion?: "v3";
  authorize?: (rejectedAccessToken?: string) => Promise<string>;
}

export class HttpPlatformModelTransport implements PlatformModelTransport {
  readonly #baseUrl: string;
  #accessToken: string;
  readonly #options: PlatformTransportOptions;
  constructor(baseUrl: string, accessToken: string, options: PlatformTransportOptions = {}) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#accessToken = accessToken;
    this.#options = options;
  }
  #path(path: string): string {
    return `/api/${this.#options.apiVersion ?? "v2"}/${path}`;
  }
  async catalog(): Promise<ModelCatalogEntry[]> {
    const body = await this.#json(this.#path("models"), { method: "GET" });
    if (this.#options.apiVersion !== "v3") return modelCatalogEntrySchema.array().parse(body);
    const catalog = hostedModelCatalogSchema.parse(body);
    return catalog.models
      .map((model) => ({
        ...model,
        recommended: model.modelRef === catalog.defaultModelRef,
        catalogVersion: catalog.catalogVersion,
      }))
      .sort(
        (a, b) =>
          Number(b.modelRef === catalog.defaultModelRef) -
          Number(a.modelRef === catalog.defaultModelRef),
      );
  }
  async usage(query: { conversationId?: string; messageId?: string } = {}) {
    const search = new URLSearchParams(query).toString();
    return hostedModelUsageSchema.parse(
      await this.#json(this.#path(`model/usage${search ? `?${search}` : ""}`), { method: "GET" }),
    );
  }
  async execute(
    request: ModelGatewayRequestDto,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResponse> {
    return modelGatewayResponseSchema.parse(
      await this.#json(this.#path("model/execute"), {
        method: "POST",
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      }),
    );
  }
  async *stream(
    request: ModelGatewayRequestDto,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelGatewayStreamEvent> {
    const response = await this.#fetch(this.#path("model/stream"), {
      method: "POST",
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await this.#responseError(response);
    if (!response.body) throw new Error("MODEL_STREAM_BODY_MISSING");
    yield* readModelStream(response.body);
  }
  async #fetch(pathname: string, init: RequestInit): Promise<Response> {
    if (this.#options.authorize) {
      try {
        this.#accessToken = await this.#options.authorize();
      } catch {
        throw new Error("MODEL_ACCOUNT_AUTH_REQUIRED");
      }
    }
    const send = () =>
      fetch(`${this.#baseUrl}${pathname}`, {
        ...init,
        redirect: "error",
        signal: init.signal ?? AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${this.#accessToken}`,
          "content-type": "application/json",
        },
      });
    let response = await send();
    // v3 guarantees a 401 is returned before reserving quota or contacting upstream.
    if (response.status === 401 && this.#options.apiVersion === "v3" && this.#options.authorize) {
      await response.body?.cancel();
      try {
        this.#accessToken = await this.#options.authorize(this.#accessToken);
      } catch {
        throw new Error("MODEL_ACCOUNT_AUTH_REQUIRED");
      }
      response = await send();
    }
    return response;
  }
  async #json(pathname: string, init: RequestInit): Promise<unknown> {
    const response = await this.#fetch(pathname, init);
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
    if (this.#options.apiVersion === "v3" && response.status === 401)
      return new Error("MODEL_ACCOUNT_AUTH_REQUIRED");
    const failure = classifyModelError(code, { httpStatus: response.status });
    const message =
      /^(?:AUTH_|ACCESS_|ACCOUNT_|DEVICE_|MODEL_REQUEST_CONFLICT|MODEL_REQUEST_IN_PROGRESS|MODEL_RESULT_UNAVAILABLE)/u.test(
        code,
      )
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
  responseFormat?: ModelGatewayRequestDto["responseFormat"];
  toolChoice?: ModelGatewayRequestDto["toolChoice"];
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

function roundDedupeKey(baseKey: string, context: unknown): string {
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
      const state = decodePlatformState(value);
      if (state)
        return encodePlatformState({
          ...state,
          items: state.items.map((item) =>
            Object.fromEntries(
              Object.entries(item).map(([key, nested]) => [
                key,
                key === "encrypted_content"
                  ? nested
                  : item.type === "function_call" &&
                      key === "arguments" &&
                      typeof nested === "string"
                    ? JSON.stringify(redact(JSON.parse(nested)))
                    : redact(nested),
              ]),
            ),
          ),
        });
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
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
  configuration: CreatePlatformProviderOptions,
): AssistantMessageEventStream {
  const entry = configuration.catalog.find((item) => item.modelRef === model.id);
  // The gateway carries prompt/tools outside the transcript. Replay Pi's system
  // deltas before projecting so resumed sessions and tool changes keep their state.
  const modelContext = redactContext(
    {
      systemPrompt: getCurrentSystemPrompt(context.messages),
      tools: getCurrentTools(context.messages),
      messages: context.messages
        .filter((message) => message.role !== "system")
        .map((message) => {
          // Older sessions can contain optional Office previews or browser screenshots.
          // User images and tools that require visual input retain capability checks.
          const browserSnapshot =
            message.role === "toolResult" &&
            (message.toolName === "openerx_browser" ||
              (message.toolName === "openerx_web_search" &&
                message.details !== null &&
                typeof message.details === "object" &&
                "webSearchFallback" in message.details));
          if (entry?.capabilities.imageInput !== true && browserSnapshot) {
            return {
              ...message,
              content: browserToolContent(message.content, false),
            };
          }
          if (
            entry?.capabilities.imageInput !== true &&
            message.role === "toolResult" &&
            message.toolName === "openerx_office_artifact" &&
            message.content.some((part) => part.type === "image")
          ) {
            return {
              ...message,
              content: [
                ...message.content.filter((part) => part.type !== "image"),
                { type: "text" as const, text: officeVisualReviewUnavailable },
              ],
            };
          }
          return message;
        }),
    },
    configuration.contextRedactions,
  );
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
      const wireContext = projectPlatformContext(
        modelContext,
        entry?.capabilities.structuredOutput,
      );
      const thinkingLevel = options?.reasoning ?? "off";
      const toolChoice = modelContext.tools?.length
        ? (options?.toolChoice ?? configuration.toolChoice)
        : undefined;
      const responseFormat = configuration.responseFormat;
      const request: ModelGatewayRequestDto = {
        ...configuration.request,
        thinkingLevel,
        reasoningReplay: true,
        responsesReplay: true,
        ...(responseFormat ? { responseFormat } : {}),
        ...(toolChoice ? { toolChoice } : {}),
        requestDedupeKey: roundDedupeKey(configuration.request.requestDedupeKey, {
          context: wireContext,
          thinkingLevel,
          toolChoice,
          responseFormat,
        }),
        requirements: {
          ...(contextHasImages(modelContext) ? { imageInput: true } : {}),
          ...(modelContext.tools && modelContext.tools.length > 0 ? { functionCalling: true } : {}),
          ...(responseFormat && responseFormat.type !== "text" ? { structuredOutput: true } : {}),
        },
        context: wireContext,
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
      if (response.providerState) {
        output.content.push({
          type: "thinking",
          thinking: "",
          redacted: true,
          thinkingSignature: encodePlatformState(response.providerState),
        });
      }
      if (response.reasoning) {
        const contentIndex = output.content.length;
        output.content.push({
          type: "thinking",
          thinking: "",
          thinkingSignature: response.reasoning.signature,
        });
        stream.push({ type: "thinking_start", contentIndex, partial: output });
        const block = output.content[contentIndex];
        if (block?.type === "thinking") block.thinking = response.reasoning.text;
        stream.push({
          type: "thinking_delta",
          contentIndex,
          delta: response.reasoning.text,
          partial: output,
        });
        stream.push({
          type: "thinking_end",
          contentIndex,
          content: response.reasoning.text,
          partial: output,
        });
      }
      if (response.finishReason === "aborted") throw new Error("MODEL_REQUEST_ABORTED");
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
        block.arguments = JSON.parse(argumentsJson) as ToolCall["arguments"];
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
      output.stopReason =
        options?.signal?.aborted ||
        (error instanceof Error && error.message === "MODEL_REQUEST_ABORTED")
          ? "aborted"
          : "error";
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
            (!options.responseFormat ||
              options.responseFormat.type === "text" ||
              entry.capabilities.structuredOutput) &&
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
    options.responseFormat &&
    options.responseFormat.type !== "text" &&
    !selectedEntry.capabilities.structuredOutput
  ) {
    throw new Error("MODEL_CAPABILITY_UNSUPPORTED:structuredOutput");
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
    name: "openerx Platform",
    auth: {
      apiKey: {
        name: "openerx device session",
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
