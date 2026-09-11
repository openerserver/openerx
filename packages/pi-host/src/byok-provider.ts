import { randomUUID } from "node:crypto";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type StreamFunction,
} from "@earendil-works/pi-ai";
import { streamSimple as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import {
  type ByokUsageRecord,
  byokUsageRecordSchema,
  classifyModelError,
  type ModelFailure,
} from "@openerx/contracts";

export function createRestrictedByokFetch(baseUrl: string): typeof globalThis.fetch {
  const allowed = new URL(baseUrl);
  const allowedPath = allowed.pathname.replace(/\/$/u, "");
  return async (input, init) => {
    const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
    const pathAllowed =
      allowedPath === "" ||
      allowedPath === "/" ||
      requestUrl.pathname === allowedPath ||
      requestUrl.pathname.startsWith(`${allowedPath}/`);
    if (requestUrl.origin !== allowed.origin || !pathAllowed)
      throw new Error("BYOK_REQUEST_TARGET_FORBIDDEN");
    const response = await fetch(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("BYOK_REDIRECT_FORBIDDEN");
    }
    return response;
  };
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

interface Attempt {
  id: string;
  startedAt: string;
  httpStatus: number | null;
  failure: ModelFailure | null;
  usage: JsonObject;
  responseModel: string | null;
}

/** Observe bytes as Pi consumes them; no clone, second reader, or retained response text. */
function observeUsage(response: Response, attempt: Attempt): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let skipping = false;
  const consume = (text: string) => {
    if (!response.ok) {
      buffer = (buffer + text).slice(0, 16_000);
      attempt.failure = classifyModelError(buffer, { httpStatus: response.status });
      return;
    }
    buffer += text;
    let boundary = buffer.search(/\r?\n\r?\n/u);
    while (boundary >= 0) {
      const data = buffer
        .slice(0, boundary)
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      const separator = buffer.slice(boundary).startsWith("\r\n\r\n") ? 4 : 2;
      buffer = buffer.slice(boundary + separator);
      if (!skipping && data.length <= 1_000_000 && data !== "[DONE]") {
        try {
          const chunk = object(JSON.parse(data));
          const choice = Array.isArray(chunk.choices) ? object(chunk.choices[0]) : {};
          const usage = object(chunk.usage ?? choice.usage);
          attempt.usage = {
            ...attempt.usage,
            ...usage,
            prompt_tokens_details: {
              ...object(attempt.usage.prompt_tokens_details),
              ...object(usage.prompt_tokens_details),
            },
            completion_tokens_details: {
              ...object(attempt.usage.completion_tokens_details),
              ...object(usage.completion_tokens_details),
            },
          };
          if (typeof chunk.model === "string" && /^[a-zA-Z0-9._:/@-]{1,200}$/u.test(chunk.model))
            attempt.responseModel = chunk.model;
        } catch {
          /* Pi owns payload validation; accounting never changes response semantics. */
        }
      }
      skipping = false;
      boundary = buffer.search(/\r?\n\r?\n/u);
    }
    if (buffer.length > 1_000_000) {
      buffer = buffer.slice(-3);
      skipping = true;
    }
  };
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            consume(`${decoder.decode()}\n\n`);
            reader.releaseLock();
            controller.close();
          } else {
            consume(decoder.decode(value, { stream: true }));
            controller.enqueue(value);
          }
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
        reader.releaseLock();
      },
    }),
    { status: response.status, statusText: response.statusText, headers: response.headers },
  );
}

export interface ByokUsageContext {
  conversationId: string | null;
  messageId: string | null;
  operation: ByokUsageRecord["operation"];
  operationId: string;
  selectedModelRef: string;
  onUsage(record: ByokUsageRecord): void;
}

function usageRecord(
  attempt: Attempt,
  context: ByokUsageContext,
  failure: ModelFailure | null,
): ByokUsageRecord {
  const raw = attempt.usage;
  const promptTokens = count(raw.prompt_tokens);
  const cachedInputTokens = count(
    object(raw.prompt_tokens_details).cached_tokens ??
      raw.prompt_cache_hit_tokens ??
      raw.cached_tokens,
  );
  const miss = count(raw.prompt_cache_miss_tokens);
  const inputTokens =
    miss ??
    (promptTokens !== null && cachedInputTokens !== null && promptTokens >= cachedInputTokens
      ? promptTokens - cachedInputTokens
      : null);
  const tokens = {
    inputTokens,
    cachedInputTokens,
    outputTokens: count(raw.completion_tokens),
    reasoningTokens: count(object(raw.completion_tokens_details).reasoning_tokens),
    totalTokens: count(raw.total_tokens),
  };
  const missingReasons = Object.fromEntries(
    Object.entries(tokens)
      .filter(([, value]) => value === null)
      .map(([name]) => [
        name,
        name === "inputTokens" && promptTokens !== null
          ? "provider_cache_breakdown_missing"
          : "provider_usage_missing",
      ]),
  );
  return byokUsageRecordSchema.parse({
    usageId: attempt.id,
    source: "byok",
    accountId: null,
    conversationId: context.conversationId,
    messageId: context.messageId,
    runId: null,
    toolCallId: null,
    selectedModelRef: context.selectedModelRef,
    effectiveModelRef: attempt.responseModel
      ? `byok/${attempt.responseModel}`
      : context.selectedModelRef,
    fallbackReason: null,
    operation: context.operation,
    operationId: context.operationId,
    status: failure?.category === "cancelled" ? "cancelled" : failure ? "failed" : "completed",
    failure,
    promptTokens,
    ...tokens,
    providerReported:
      promptTokens !== null || Object.values(tokens).some((value) => value !== null),
    missingReasons,
    dedupeKey: `byok:${attempt.id}`,
    startedAt: attempt.startedAt,
    recordedAt: new Date().toISOString(),
  });
}

/** Retains Pi's retry policy and records every actual HTTP attempt, including SDK retries. */
export function createByokStream(
  context: ByokUsageContext,
  restrictedFetch: typeof fetch,
): StreamFunction<"openai-completions"> {
  return (model, messages, options) => {
    const output = createAssistantMessageEventStream();
    const attempts: Attempt[] = [];
    const recorded = new Set<string>();
    const report = (message: AssistantMessage) => {
      const last = attempts.at(-1);
      const failure =
        message.stopReason === "error" || message.stopReason === "aborted"
          ? classifyModelError(message.errorMessage, {
              httpStatus: last?.httpStatus,
              cancelled: message.stopReason === "aborted",
            })
          : message.stopReason === "length"
            ? classifyModelError("MODEL_OUTPUT_LIMIT_REACHED")
            : null;
      for (const attempt of attempts) {
        if (recorded.has(attempt.id)) continue;
        recorded.add(attempt.id);
        context.onUsage(
          usageRecord(
            attempt,
            context,
            attempt === last ? (failure ?? attempt.failure) : attempt.failure,
          ),
        );
      }
    };
    const observedFetch: typeof fetch = async (input, init) => {
      const attempt: Attempt = {
        id: randomUUID(),
        startedAt: new Date().toISOString(),
        httpStatus: null,
        failure: null,
        usage: {},
        responseModel: null,
      };
      attempts.push(attempt);
      try {
        const response = await restrictedFetch(input, init);
        attempt.httpStatus = response.status;
        if (!response.ok) attempt.failure = classifyModelError("", { httpStatus: response.status });
        return observeUsage(response, attempt);
      } catch (error) {
        attempt.failure = classifyModelError(error, { cancelled: options?.signal?.aborted });
        throw error;
      }
    };
    void (async () => {
      const source = streamOpenAICompletions(model, messages, { ...options, fetch: observedFetch });
      for await (const event of source) {
        if (event.type === "done" || event.type === "error") {
          const message: AssistantMessage = event.type === "done" ? event.message : event.error;
          report(message);
        }
        output.push(event);
      }
      output.end();
    })().catch((error: unknown) => {
      const stopReason = options?.signal?.aborted ? "aborted" : "error";
      const message: AssistantMessage = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason,
        timestamp: Date.now(),
        errorMessage: classifyModelError(error, { cancelled: stopReason === "aborted" }).code,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      report(message);
      output.push({ type: "error", reason: stopReason, error: message });
      output.end();
    });
    return output;
  };
}
