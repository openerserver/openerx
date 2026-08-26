import { randomUUID } from "node:crypto";
import { automaticModelRef, type ModelGatewayRequestDto } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createDeepSeekModelExecutorFromEnv,
  DeepSeekModelExecutor,
  deepSeekApiBaseUrl,
  deepSeekModelRefs,
} from "../src/deepseek-model-executor";

function request(values: Partial<ModelGatewayRequestDto> = {}): ModelGatewayRequestDto {
  return {
    accountId: randomUUID(),
    conversationId: randomUUID(),
    messageId: randomUUID(),
    selectedModelRef: automaticModelRef,
    approvedFallbackModelRef: null,
    requestDedupeKey: `deepseek-${randomUUID()}`,
    requirements: {},
    context: {
      systemPrompt: "You are OpenerX.",
      messages: [{ role: "user", content: "只回答：连接成功", timestamp: Date.now() }],
    },
    ...values,
  };
}

function successResponse(): Response {
  return Response.json({
    model: "deepseek-v4-flash",
    choices: [{ finish_reason: "stop", message: { content: "连接成功" } }],
    usage: {
      prompt_tokens: 12,
      prompt_cache_hit_tokens: 4,
      prompt_cache_miss_tokens: 8,
      completion_tokens: 3,
      total_tokens: 15,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  });
}

describe("DeepSeekModelExecutor", () => {
  it("calls only the official endpoint and maps automatic selection to V4 Flash", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      successResponse(),
    );
    const executor = new DeepSeekModelExecutor({
      apiKey: `sk-${"a".repeat(32)}`,
      fetch: fetchMock,
      thinking: "disabled",
    });
    const result = await executor.execute(request(), undefined);
    expect(result).toEqual({
      text: "连接成功",
      effectiveModelRef: deepSeekModelRefs.flash,
      finishReason: "stop",
      usage: {
        inputTokens: 8,
        cachedInputTokens: 4,
        outputTokens: 3,
        reasoningTokens: 0,
        totalTokens: 15,
        providerReported: true,
        missingReasons: {},
      },
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${deepSeekApiBaseUrl}/chat/completions`);
    expect(init?.headers).toEqual({
      authorization: `Bearer sk-${"a".repeat(32)}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: "You are OpenerX." },
        { role: "user", content: "只回答：连接成功" },
      ],
      thinking: { type: "disabled" },
      max_tokens: 384_000,
      stream: false,
      user_id: expect.any(String),
    });
  });

  it("supports an explicit V4 Pro route and preserves unknown usage fields", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        model: "deepseek-v4-pro",
        choices: [{ finish_reason: "length", message: { content: "pro" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    const executor = new DeepSeekModelExecutor({
      apiKey: `sk-${"b".repeat(32)}`,
      fetch: fetchMock,
    });
    const result = await executor.execute(
      request({ selectedModelRef: deepSeekModelRefs.pro }),
      undefined,
    );
    expect(result.effectiveModelRef).toBe(deepSeekModelRefs.pro);
    expect(result.finishReason).toBe("length");
    expect(result.usage).toMatchObject({
      cachedInputTokens: null,
      reasoningTokens: null,
      missingReasons: {
        cachedInputTokens: "provider_not_reported",
        reasoningTokens: "provider_not_reported",
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).model).toBe("deepseek-v4-pro");
  });

  it("uses the provider response model as the authoritative billing route", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        model: "deepseek-v4-pro",
        choices: [{ finish_reason: "stop", message: { content: "provider route" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    const executor = new DeepSeekModelExecutor({
      apiKey: `sk-${"d".repeat(32)}`,
      fetch: fetchMock,
    });
    const result = await executor.execute(
      request({ selectedModelRef: deepSeekModelRefs.flash }),
      undefined,
    );
    expect(result.effectiveModelRef).toBe(deepSeekModelRefs.pro);
    expect(result.fallbackReason).toBe(
      "provider_response_model:deepseek-v4-flash->deepseek-v4-pro",
    );
  });

  it("redacts provider errors and validates environment configuration", async () => {
    const secret = `sk-${"c".repeat(32)}`;
    const executor = new DeepSeekModelExecutor({
      apiKey: secret,
      fetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json(
          { error: { code: "invalid_request", message: `bad token ${secret}` } },
          { status: 401 },
        ),
      ),
    });
    await expect(executor.execute(request(), undefined)).rejects.toThrow(
      "DEEPSEEK_API_ERROR:401:invalid_request:bad token [REDACTED]",
    );
    expect(() => createDeepSeekModelExecutorFromEnv({})).toThrow("DEEPSEEK_API_KEY_INVALID");
    expect(() =>
      createDeepSeekModelExecutorFromEnv({
        DEEPSEEK_API_KEY: secret,
        DEEPSEEK_MODEL: "retired-model",
      }),
    ).toThrow("DEEPSEEK_MODEL_INVALID");
  });
});
