import { createHash } from "node:crypto";
import {
  automaticModelRef,
  type ModelBillingAuthorization,
  type ModelBillingPort,
  type ModelCatalogEntry,
  type ModelGatewayRequestDto,
  type ModelGatewayResponse,
  type ModelGatewayToolCall,
  type ModelRequirement,
  type ModelSelectionCheck,
  modelCatalogEntrySchema,
  modelGatewayRequestSchema,
  modelGatewayResponseSchema,
  modelSelectionCheckSchema,
  type ThinkingLevel,
  type UsageRecord,
  type UsageStorePort,
  usageRecordSchema,
} from "@openerx/contracts";

export interface ModelExecutionUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  providerReported: boolean;
  missingReasons: Record<string, string>;
}

export interface ModelExecutionResult {
  text: string;
  toolCalls?: ModelGatewayToolCall[];
  effectiveModelRef: string;
  fallbackReason?: string;
  finishReason?: string;
  usage: ModelExecutionUsage;
}

export interface ModelExecutor {
  execute(
    request: ModelGatewayRequestDto,
    signal: AbortSignal | undefined,
  ): Promise<ModelExecutionResult>;
  stream?(
    request: ModelGatewayRequestDto,
    onDelta: (delta: string) => void,
    signal: AbortSignal | undefined,
  ): Promise<ModelExecutionResult>;
}

export interface ModelGatewayServiceOptions {
  catalog: ModelCatalogEntry[];
  executor: ModelExecutor;
  usageStore: Pick<UsageStorePort, "record">;
  billing?: ModelBillingPort;
  now?: () => Date;
}

const capabilityKeys = ["imageInput", "fileInput", "functionCalling", "structuredOutput"] as const;

function supportsThinkingLevel(entry: ModelCatalogEntry, thinkingLevel: ThinkingLevel): boolean {
  return (entry.thinkingLevels ?? ["off"]).includes(thinkingLevel);
}

function deterministicUsageId(accountId: string, dedupeKey: string): string {
  const hex = createHash("sha256").update(`${accountId}\0${dedupeKey}`, "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export class ModelGatewayService {
  readonly #catalog: ModelCatalogEntry[];
  readonly #executor: ModelExecutor;
  readonly #usageStore: Pick<UsageStorePort, "record">;
  readonly #billing: ModelBillingPort | undefined;
  readonly #now: () => Date;
  readonly #responses = new Map<string, ModelGatewayResponse>();

  constructor(options: ModelGatewayServiceOptions) {
    const configured = options.catalog.map((entry) => modelCatalogEntrySchema.parse(entry));
    const automatic = configured.find(({ modelRef }) => modelRef === automaticModelRef);
    const firstAvailable = configured.find(
      ({ modelRef, status }) => modelRef !== automaticModelRef && status === "available",
    );
    this.#catalog = automatic
      ? configured
      : firstAvailable
        ? [
            modelCatalogEntrySchema.parse({
              ...firstAvailable,
              modelRef: automaticModelRef,
              displayName: "自动",
              version: `auto:${firstAvailable.version}`,
              priceSummary: `按请求自动选择 · ${firstAvailable.priceSummary}`,
            }),
            ...configured,
          ]
        : configured;
    this.#executor = options.executor;
    this.#usageStore = options.usageStore;
    this.#billing = options.billing;
    this.#now = options.now ?? (() => new Date());
  }

  catalog(): ModelCatalogEntry[] {
    return structuredClone(this.#catalog);
  }

  checkSelection(
    modelRef: string,
    requirements: ModelRequirement,
    thinkingLevel?: ThinkingLevel,
  ): ModelSelectionCheck {
    if (modelRef === automaticModelRef) {
      const candidates = this.#catalog.filter(
        (entry) =>
          entry.modelRef !== automaticModelRef &&
          entry.status === "available" &&
          capabilityKeys.every(
            (capability) => requirements[capability] !== true || entry.capabilities[capability],
          ) &&
          (thinkingLevel === undefined || supportsThinkingLevel(entry, thinkingLevel)),
      );
      if (candidates.length > 0) return { supported: true };
      return modelSelectionCheckSchema.parse({
        supported: false,
        modelRef,
        missingCapabilities: ["no_automatic_route"],
        suggestedModelRefs: [],
      });
    }
    const selected = this.#catalog.find((entry) => entry.modelRef === modelRef);
    if (selected?.status !== "available") {
      return modelSelectionCheckSchema.parse({
        supported: false,
        modelRef,
        missingCapabilities: [selected ? `status:${selected.status}` : "model_not_found"],
        suggestedModelRefs: this.#catalog
          .filter((entry) => entry.modelRef !== automaticModelRef && entry.status === "available")
          .map(({ modelRef: candidate }) => candidate),
      });
    }
    const missingCapabilities: string[] = capabilityKeys.filter(
      (capability) => requirements[capability] === true && !selected.capabilities[capability],
    );
    if (thinkingLevel !== undefined && !supportsThinkingLevel(selected, thinkingLevel)) {
      missingCapabilities.push(`thinking:${thinkingLevel}`);
    }
    if (missingCapabilities.length === 0) return { supported: true };
    const suggestedModelRefs = this.#catalog
      .filter(
        (entry) =>
          entry.modelRef !== automaticModelRef &&
          entry.status === "available" &&
          capabilityKeys.every(
            (capability) => requirements[capability] !== true || entry.capabilities[capability],
          ) &&
          (thinkingLevel === undefined || supportsThinkingLevel(entry, thinkingLevel)),
      )
      .map(({ modelRef: candidate }) => candidate);
    return modelSelectionCheckSchema.parse({
      supported: false,
      modelRef,
      missingCapabilities,
      suggestedModelRefs,
    });
  }

  async execute(
    input: ModelGatewayRequestDto,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResponse> {
    return this.#execute(input, undefined, signal);
  }

  async stream(
    input: ModelGatewayRequestDto,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResponse> {
    return this.#execute(input, onDelta, signal);
  }

  async #execute(
    input: ModelGatewayRequestDto,
    onDelta: ((delta: string) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ModelGatewayResponse> {
    const request = modelGatewayRequestSchema.parse(input);
    const responseKey = `${request.accountId}:${request.requestDedupeKey}`;
    const replay = this.#responses.get(responseKey);
    if (replay) {
      if (onDelta && replay.text) onDelta(replay.text);
      return structuredClone(replay);
    }
    const selection = this.checkSelection(
      request.selectedModelRef,
      request.requirements,
      request.thinkingLevel,
    );
    if (!selection.supported) {
      throw new Error(
        `MODEL_CAPABILITY_UNSUPPORTED:${selection.missingCapabilities.join(",")}:${selection.suggestedModelRefs.join(",")}`,
      );
    }
    if (signal?.aborted) throw new Error("MODEL_REQUEST_ABORTED");
    let billingAuthorization: ModelBillingAuthorization | undefined;
    try {
      billingAuthorization = await this.#billing?.authorize(request);
      let streamedText = "";
      const forwardDelta = (delta: string): void => {
        if (!delta) return;
        streamedText += delta;
        onDelta?.(delta);
      };
      const execution =
        onDelta && this.#executor.stream
          ? await this.#executor.stream(request, forwardDelta, signal)
          : await this.#executor.execute(request, signal);
      if (onDelta && !this.#executor.stream && execution.text) forwardDelta(execution.text);
      if (onDelta && streamedText !== execution.text) {
        throw new Error("MODEL_STREAM_TEXT_MISMATCH");
      }
      if (request.selectedModelRef === automaticModelRef) {
        if (execution.effectiveModelRef === automaticModelRef) {
          throw new Error("MODEL_AUTO_ROUTE_UNRESOLVED");
        }
      } else if (execution.effectiveModelRef !== request.selectedModelRef) {
        if (request.approvedFallbackModelRef !== execution.effectiveModelRef) {
          throw new Error("MODEL_SILENT_FALLBACK_REJECTED");
        }
        if (!execution.fallbackReason) throw new Error("MODEL_FALLBACK_REASON_REQUIRED");
      }
      const usage = usageRecordSchema.parse({
        usageId: deterministicUsageId(request.accountId, request.requestDedupeKey),
        accountId: request.accountId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        runId: null,
        toolCallId: null,
        selectedModelRef: request.selectedModelRef,
        effectiveModelRef: execution.effectiveModelRef,
        fallbackReason: execution.fallbackReason ?? null,
        ...execution.usage,
        dedupeKey: request.requestDedupeKey,
        recordedAt: this.#now().toISOString(),
      } satisfies UsageRecord);
      const stored = this.#usageStore.record(usage).record;
      if (billingAuthorization && this.#billing) {
        await this.#billing.settle(billingAuthorization, stored);
      }
      const response = modelGatewayResponseSchema.parse({
        text: execution.text,
        ...(execution.toolCalls && execution.toolCalls.length > 0
          ? { toolCalls: execution.toolCalls }
          : {}),
        effectiveModelRef: execution.effectiveModelRef,
        fallbackReason: execution.fallbackReason ?? null,
        ...(execution.finishReason ? { finishReason: execution.finishReason } : {}),
        usage: stored,
      });
      this.#responses.set(responseKey, response);
      return structuredClone(response);
    } catch (error) {
      if (billingAuthorization && this.#billing) {
        await this.#billing.release(billingAuthorization);
      }
      throw error;
    }
  }
}
