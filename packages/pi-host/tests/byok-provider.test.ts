import { randomUUID } from "node:crypto";
import { clampThinkingLevel, type Model, normalizeContext } from "@earendil-works/pi-ai";
import { type ByokUsageRecord, usageRecordSchema } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import { byokModelCompatibility, createByokStream } from "../src/byok-provider";

const model: Model<"openai-completions"> = {
  id: "fixture-model",
  name: "Fixture",
  api: "openai-completions",
  provider: "openerx-byok",
  baseUrl: "https://fixture.invalid/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 32_000,
  maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const messages = normalizeContext({
  messages: [{ role: "user", content: "test", timestamp: Date.now() }],
});
function sse(chunks: unknown[], chunkBytes = 17): Response {
  const bytes = new TextEncoder().encode(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join("") +
      "data: [DONE]\r\n\r\n",
  );
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunkBytes));
        offset += chunkBytes;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const finish = {
  model: "actual-model",
  choices: [{ index: 0, delta: { content: "完成" }, finish_reason: "stop" }],
};
const rawUsage = {
  prompt_tokens: 100,
  prompt_cache_hit_tokens: 40,
  completion_tokens: 20,
  completion_tokens_details: { reasoning_tokens: 7 },
  total_tokens: 120,
};
function fixture(fetcher: typeof fetch) {
  const records: ByokUsageRecord[] = [];
  const stream = createByokStream(
    {
      operation: "chat",
      operationId: randomUUID(),
      conversationId: randomUUID(),
      messageId: randomUUID(),
      selectedModelRef: "platform/byok.fixture",
      onUsage: (record) => records.push(record),
    },
    fetcher,
  );
  return { records, stream };
}

describe("BYOK provider accounting", () => {
  it.each([
    ["glm-5.3", "https://open.bigmodel.cn/api/paas/v4"],
    ["kimi-k3", "https://api.moonshot.cn/v1"],
  ])("preserves max effort through Pi session initialization for %s", (id, baseUrl) => {
    const runtimeModel = {
      ...model,
      id,
      baseUrl,
      reasoning: true,
      ...byokModelCompatibility({ modelId: id, baseUrl }),
    };
    expect(clampThinkingLevel(runtimeModel, "max")).toBe("max");
  });

  it.each([
    ["glm-5.3", "https://open.bigmodel.cn/api/paas/v4"],
    ["kimi-k3", "https://api.moonshot.cn/v1"],
    ["kimi-k2.7-code", "https://api.moonshot.cn/v1"],
    ["hy4-preview", "https://tokenhub.tencentmaas.com/v1"],
  ])("replays preserved reasoning in a second turn for %s", async (id, baseUrl) => {
    const fetcher = vi.fn(async () =>
      sse([
        {
          model: id,
          choices: [
            {
              index: 0,
              delta: { reasoning_content: "Synthetic reasoning fixture." },
              finish_reason: null,
            },
          ],
        },
        { ...finish, model: id },
      ]),
    );
    const { stream } = fixture(fetcher);
    const currentModel = { ...model, id, baseUrl, reasoning: true };
    const options = { apiKey: "fixture", maxRetries: 0, reasoning: "high" as const };
    const first = await stream(currentModel, messages, options).result();
    await stream(
      currentModel,
      normalizeContext({
        messages: [
          ...messages.messages,
          first,
          { role: "user", content: "Continue", timestamp: Date.now() },
        ],
      }),
      options,
    ).result();
    const request = JSON.parse(
      String((fetcher.mock.calls[1] as unknown as [unknown, RequestInit])[1].body),
    );
    expect(
      request.messages.find((message: { role: string }) => message.role === "assistant")
        .reasoning_content,
    ).toBe("Synthetic reasoning fixture.");
  });

  it.each([
    ["glm-5.3", "https://open.bigmodel.cn/api/paas/v4", "off", "low"],
    ["glm-5.3-flash", "https://open.bigmodel.cn/api/paas/v4", "medium", "high"],
    ["glm-5.3-flashx", "https://open.bigmodel.cn/api/paas/v4", "max", "max"],
    ["kimi-k3", "https://api.moonshot.cn/v1", "off", "low"],
    ["kimi-k3", "https://api.moonshot.cn/v1", "medium", "high"],
    ["kimi-k3", "https://api.moonshot.cn/v1", "max", "max"],
    ["kimi-k2.7-code", "https://api.moonshot.cn/v1", "off", undefined],
    ["kimi-k2.7-code-highspeed", "https://api.moonshot.cn/v1", "high", undefined],
    ["hy4-preview", "https://tokenhub.tencentmaas.com/v1", "medium", "high"],
    ["hy4-preview", "https://tokenhub.tencentmaas.com/v1", "off", undefined],
    ["hy3", "https://tokenhub.tencentmaas.com/v1", "low", "low"],
    ["hy3", "https://tokenhub.tencentmaas.com/v1", "medium", "high"],
  ] as const)(
    "sends supported reasoning parameters for %s at %s / %s",
    async (id, baseUrl, reasoning, expectedEffort) => {
      const fetcher = vi.fn(async () => sse([finish]));
      const { stream } = fixture(fetcher);
      const result = await stream({ ...model, id, baseUrl, reasoning: true }, messages, {
        apiKey: "synthetic-key",
        maxRetries: 0,
        reasoning: reasoning === "off" ? undefined : reasoning,
        temperature: 0.2,
      }).result();
      expect(result.stopReason).toBe("stop");
      const request = JSON.parse(
        String((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].body),
      );
      expect(request.model).toBe(id);
      expect(request.reasoning_effort).toBe(expectedEffort);
      if (id.startsWith("glm-")) {
        expect(request.thinking).toEqual({ type: "enabled", clear_thinking: false });
      } else if (id.startsWith("hy")) {
        expect(request.thinking).toEqual({ type: reasoning === "off" ? "disabled" : "enabled" });
      } else {
        expect(request.thinking).toBeUndefined();
      }
      if (id.startsWith("kimi-")) expect(request.temperature).toBeUndefined();
      if (id === "kimi-k3") {
        expect(request.max_completion_tokens).toBeGreaterThan(0);
        expect(request.max_tokens).toBeUndefined();
      }
    },
  );

  it("uses provider counts, keeps reasoning inside output, and counts repeated cumulative usage once", async () => {
    const { records, stream } = fixture(
      vi.fn(async () =>
        sse([finish, { choices: [], usage: rawUsage }, { choices: [], usage: rawUsage }]),
      ),
    );
    const result = await stream(model, messages, {
      apiKey: "fixture-secret",
      maxRetries: 0,
    }).result();
    expect(result.stopReason).toBe("stop");
    expect(result.content).toMatchObject([{ type: "text", text: "完成" }]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "byok",
      accountId: null,
      status: "completed",
      inputTokens: 60,
      cachedInputTokens: 40,
      promptTokens: 100,
      outputTokens: 20,
      reasoningTokens: 7,
      totalTokens: 120,
      effectiveModelRef: "byok/actual-model",
      providerReported: true,
      missingReasons: {},
    });
    expect(usageRecordSchema.safeParse(records[0]).success).toBe(false);
    expect(JSON.stringify(records)).not.toContain("fixture-secret");
    expect(JSON.stringify(records)).not.toContain("完成");
  });

  it("retains unknown fields instead of Pi's zero defaults, including partial usage", async () => {
    const { records, stream } = fixture(
      vi.fn(async () =>
        sse([
          finish,
          { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
        ]),
      ),
    );
    await stream(model, messages, { apiKey: "fixture", maxRetries: 0 }).result();
    expect(records[0]).toMatchObject({
      promptTokens: 10,
      inputTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
      totalTokens: 12,
      missingReasons: {
        inputTokens: "provider_cache_breakdown_missing",
        cachedInputTokens: "provider_usage_missing",
      },
    });
    const missing = fixture(vi.fn(async () => sse([finish])));
    await missing.stream(model, messages, { apiKey: "fixture", maxRetries: 0 }).result();
    expect(missing.records[0]).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      providerReported: false,
    });
  });

  it("supports choice usage and Kimi cached tokens without adding reasoning twice", async () => {
    const { records, stream } = fixture(
      vi.fn(async () =>
        sse([
          {
            ...finish,
            choices: [
              {
                ...finish.choices[0],
                usage: { ...rawUsage, prompt_cache_hit_tokens: undefined, cached_tokens: 10 },
              },
            ],
          },
        ]),
      ),
    );
    await stream(model, messages, { apiKey: "fixture", maxRetries: 0 }).result();
    expect(records[0]).toMatchObject({
      inputTokens: 90,
      cachedInputTokens: 10,
      outputTokens: 20,
      totalTokens: 120,
    });
  });

  it.each([
    [503, "overloaded", "MODEL_SERVER_ERROR"],
    [429, '{"error":{"code":"insufficient_quota"}}', "MODEL_QUOTA_EXCEEDED"],
  ])(
    "records each SDK attempt while retaining its retry behavior: HTTP %i",
    async (status, body, code) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response(body, { status, headers: { "retry-after-ms": "1" } }))
        .mockImplementationOnce(async () => sse([finish, { choices: [], usage: rawUsage }]));
      const { records, stream } = fixture(fetcher);
      await stream(model, messages, { apiKey: "fixture", maxRetries: 1 }).result();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        status: "failed",
        totalTokens: null,
        failure: { code, httpStatus: status },
      });
      expect(records[1]).toMatchObject({ status: "completed", totalTokens: 120 });
      expect(new Set(records.map(({ usageId }) => usageId)).size).toBe(2);
    },
  );

  it("classifies authentication and quota errors without retaining the provider body", async () => {
    for (const [status, code, expected] of [
      [401, "invalid_api_key", "MODEL_AUTHENTICATION_FAILED"],
      [429, "insufficient_quota", "MODEL_QUOTA_EXCEEDED"],
    ] as const) {
      const { records, stream } = fixture(
        vi.fn(async () =>
          Response.json({ error: { code, message: "bad fixture-secret" } }, { status }),
        ),
      );
      expect(
        (await stream(model, messages, { apiKey: "fixture", maxRetries: 0 }).result()).stopReason,
      ).toBe("error");
      expect(records[0]).toMatchObject({
        status: "failed",
        failure: { code: expected, httpStatus: status, retryable: false },
        totalTokens: null,
      });
      expect(JSON.stringify(records)).not.toContain("fixture-secret");
    }
  });

  it("retains reported usage on a filtered response", async () => {
    const { records, stream } = fixture(
      vi.fn(async () =>
        sse([
          {
            ...finish,
            choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }],
            usage: rawUsage,
          },
        ]),
      ),
    );
    expect(
      (await stream(model, messages, { apiKey: "fixture", maxRetries: 0 }).result()).stopReason,
    ).toBe("error");
    expect(records[0]).toMatchObject({
      status: "failed",
      totalTokens: 120,
      failure: { code: "MODEL_CONTENT_FILTERED" },
    });
  });

  it("records cancellation with known usage and never invents zero usage", async () => {
    const abort = new AbortController();
    let read = false;
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!read) {
                read = true;
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }], usage: rawUsage })}\n\n`,
                  ),
                );
              } else {
                abort.abort();
                controller.error(new DOMException("Cancelled", "AbortError"));
              }
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const { records, stream } = fixture(fetcher);
    expect(
      (
        await stream(model, messages, {
          apiKey: "fixture",
          maxRetries: 0,
          signal: abort.signal,
        }).result()
      ).stopReason,
    ).toBe("aborted");
    expect(records[0]).toMatchObject({
      status: "cancelled",
      totalTokens: 120,
      failure: { code: "MODEL_REQUEST_ABORTED", retryable: false },
    });
  });
});
