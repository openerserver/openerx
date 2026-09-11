import { randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import { type ByokUsageRecord, usageRecordSchema } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import { createByokStream } from "../src/byok-provider";

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
const messages = { messages: [{ role: "user" as const, content: "test", timestamp: Date.now() }] };
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
