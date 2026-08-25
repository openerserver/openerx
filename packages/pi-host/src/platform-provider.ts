import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  createProvider,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  automaticModelRef,
  type ModelCatalogEntry,
  type ModelGatewayRequestDto,
  type ModelGatewayResponse,
  modelCatalogEntrySchema,
  modelGatewayResponseSchema,
  type UsageRecord,
} from "@openerx/contracts";

export interface PlatformModelTransport {
  execute(request: ModelGatewayRequestDto, signal?: AbortSignal): Promise<ModelGatewayResponse>;
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

  async #json(pathname: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.#baseUrl}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#accessToken}`,
        "content-type": "application/json",
      },
    });
    const body = (await response.json()) as { error?: { code?: string } };
    if (!response.ok) throw new Error(body.error?.code ?? `PLATFORM_HTTP_${response.status}`);
    return body;
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
  onUsage?: (record: UsageRecord) => void;
  streamChunkSize?: number;
}

export interface PlatformProviderHandle {
  provider: Provider<string>;
  model: Model<string>;
}

function toPiModel(entry: ModelCatalogEntry): Model<string> {
  return {
    id: entry.modelRef,
    name: entry.displayName,
    api: "openerx-platform",
    provider: "openerx-platform",
    baseUrl: "openerx://model-gateway",
    reasoning: false,
    input: entry.capabilities.imageInput ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxOutputTokens,
  };
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

function streamPlatform(
  model: Model<string>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  configuration: CreatePlatformProviderOptions,
): AssistantMessageEventStream {
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
      const response = modelGatewayResponseSchema.parse(
        await configuration.transport.execute(
          {
            ...configuration.request,
            requirements: {},
            context,
          },
          options?.signal,
        ),
      );
      if (options?.signal?.aborted) throw new Error("MODEL_REQUEST_ABORTED");
      output.responseModel = response.effectiveModelRef;
      output.usage = piUsage(response.usage);
      output.content.push({ type: "text", text: "" });
      const contentIndex = output.content.length - 1;
      stream.push({ type: "text_start", contentIndex, partial: output });
      const chunkSize = Math.max(1, configuration.streamChunkSize ?? 24);
      for (let index = 0; index < response.text.length; index += chunkSize) {
        if (options?.signal?.aborted) throw new Error("MODEL_REQUEST_ABORTED");
        const delta = response.text.slice(index, index + chunkSize);
        const block = output.content[contentIndex];
        if (block?.type !== "text") throw new Error("Platform text block is missing");
        block.text += delta;
        stream.push({ type: "text_delta", contentIndex, delta, partial: output });
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const block = output.content[contentIndex];
      if (block?.type !== "text") throw new Error("Platform text block is missing");
      stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
      output.stopReason = "stop";
      configuration.onUsage?.(response.usage);
      stream.push({ type: "done", reason: "stop", message: output });
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
  const selected =
    options.request.selectedModelRef === automaticModelRef
      ? models.find(({ id }) => id !== automaticModelRef)
      : models.find(({ id }) => id === options.request.selectedModelRef);
  if (!selected) throw new Error(`PLATFORM_MODEL_NOT_FOUND:${options.request.selectedModelRef}`);
  const provider = createProvider<string>({
    id: "openerx-platform",
    name: "OpenerX Platform",
    auth: {
      apiKey: {
        name: "OpenerX device session",
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
