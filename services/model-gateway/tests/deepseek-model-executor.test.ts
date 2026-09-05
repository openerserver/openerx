import { randomUUID } from "node:crypto";
import { automaticModelRef, type ModelGatewayRequestDto } from "@openerx/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createDeepSeekModelCatalog,
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
      systemPrompt: "You are OpenERX.",
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

function streamingResponse(
  model: "deepseek-v4-flash" | "deepseek-v4-pro" = "deepseek-v4-flash",
): Response {
  const events = [
    {
      model,
      choices: [{ delta: { role: "assistant", content: "连接" }, finish_reason: null }],
      usage: null,
    },
    {
      model,
      choices: [{ delta: { content: "成功" }, finish_reason: "stop" }],
      usage: null,
    },
    {
      model: "deepseek-v4-flash",
      choices: [],
      usage: {
        prompt_tokens: 12,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 8,
        completion_tokens: 3,
        total_tokens: 15,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    },
  ];
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function streamingToolResponse(): Response {
  const events = [
    {
      model: "deepseek-v4-flash",
      choices: [{ delta: { role: "assistant", content: "我先检查。" }, finish_reason: null }],
      usage: null,
    },
    {
      model: "deepseek-v4-flash",
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_shell_1",
                type: "function",
                function: {
                  name: "openerx_shell",
                  arguments: '{"cwd":"/workspace","command":"ls",',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
      usage: null,
    },
    {
      model: "deepseek-v4-flash",
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"args":["-la"]}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: null,
    },
    {
      model: "deepseek-v4-flash",
      choices: [],
      usage: {
        prompt_tokens: 20,
        prompt_cache_hit_tokens: 5,
        prompt_cache_miss_tokens: 15,
        completion_tokens: 12,
        total_tokens: 32,
      },
    },
  ];
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("DeepSeekModelExecutor", () => {
  it("publishes the experimental vision model with image input enabled", () => {
    const catalog = createDeepSeekModelCatalog();
    expect(catalog.find(({ modelRef }) => modelRef === automaticModelRef)).toMatchObject({
      capabilities: { imageInput: true },
      thinkingLevels: ["off", "medium"],
    });
    expect(catalog).toContainEqual(
      expect.objectContaining({
        modelRef: deepSeekModelRefs.vision,
        version: "official-experimental-2026-08-21",
        capabilities: expect.objectContaining({ imageInput: true, functionCalling: true }),
      }),
    );
  });

  it("maps each explicit product thinking level to the DeepSeek request", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      successResponse(),
    );
    const executor = new DeepSeekModelExecutor({
      apiKey: `sk-${"r".repeat(32)}`,
      fetch: fetchMock,
      thinking: "enabled",
    });

    await executor.execute(request({ thinkingLevel: "off" }), undefined);
    await executor.execute(request({ thinkingLevel: "medium" }), undefined);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.thinking).toEqual({ type: "disabled" });
    expect(secondBody.thinking).toEqual({ type: "enabled" });
  });

  it("routes automatic image input to Vision and emits the official image_url payload", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        model: "deepseek-v4-flash-vision-exp",
        choices: [{ finish_reason: "stop", message: { content: "图中是蓝色方块。" } }],
        usage: { prompt_tokens: 18, completion_tokens: 6, total_tokens: 24 },
      }),
    );
    const executor = new DeepSeekModelExecutor({
      apiKey: `sk-${"v".repeat(32)}`,
      fetch: fetchMock,
      thinking: "disabled",
    });
    const imageData = Buffer.from("fixture-image", "utf8").toString("base64");

    const result = await executor.execute(
      request({
        requirements: { imageInput: true },
        context: {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "图片里有什么？" },
                { type: "image", data: imageData, mimeType: "image/png" },
              ],
              timestamp: Date.now(),
            },
          ],
        },
      }),
      undefined,
    );

    expect(result.effectiveModelRef).toBe(deepSeekModelRefs.vision);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      model: "deepseek-v4-flash-vision-exp",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "图片里有什么？" },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageData}` },
            },
          ],
        },
      ],
    });
  });

  it("never forwards image content to a text-only DeepSeek model", async () => {
    const fetchMock = vi.fn(async () => successResponse());
    const executor = new DeepSeekModelExecutor({
      apiKey: `sk-${"n".repeat(32)}`,
      fetch: fetchMock,
    });
    await expect(
      executor.execute(
        request({
          selectedModelRef: deepSeekModelRefs.flash,
          context: {
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "解析图片" },
                  {
                    type: "image",
                    data: Buffer.from("image").toString("base64"),
                    mimeType: "image/png",
                  },
                ],
              },
            ],
          },
        }),
        undefined,
      ),
    ).rejects.toThrow("DEEPSEEK_MEDIA_INPUT_UNSUPPORTED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards official SSE deltas before the authoritative usage terminal", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      streamingResponse(),
    );
    const executor = new DeepSeekModelExecutor({
      apiKey: `sk-${"s".repeat(32)}`,
      fetch: fetchMock,
      thinking: "disabled",
    });
    const deltas: string[] = [];
    const result = await executor.stream(request(), (delta) => deltas.push(delta), undefined);

    expect(deltas).toEqual(["连接", "成功"]);
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
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("streams native tool calls structurally instead of leaking provider markup as text", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      streamingToolResponse(),
    );
    const executor = new DeepSeekModelExecutor({
      apiKey: `sk-${"t".repeat(32)}`,
      fetch: fetchMock,
      thinking: "disabled",
    });
    const deltas: string[] = [];
    const result = await executor.stream(
      request({
        requirements: { functionCalling: true },
        context: {
          systemPrompt: "You are OpenERX.",
          messages: [{ role: "user", content: "检查项目", timestamp: Date.now() }],
          tools: [
            {
              name: "openerx_shell",
              description: "Run one approved command.",
              parameters: {
                type: "object",
                properties: {
                  cwd: { type: "string" },
                  command: { type: "string" },
                  args: { type: "array", items: { type: "string" } },
                },
                required: ["cwd", "command", "args"],
              },
            },
          ],
        },
      }),
      (delta) => deltas.push(delta),
      undefined,
    );

    expect(deltas).toEqual(["我先检查。"]);
    expect(deltas.join("")).not.toContain("DSML");
    expect(result).toMatchObject({
      text: "我先检查。",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_shell_1",
          name: "openerx_shell",
          arguments: { cwd: "/workspace", command: "ls", args: ["-la"] },
        },
      ],
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.tool_choice).toBe("auto");
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({ name: "openerx_shell" }),
      }),
    ]);
  });

  it("round-trips assistant tool calls and tool results as native DeepSeek messages", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      successResponse(),
    );
    const executor = new DeepSeekModelExecutor({
      apiKey: `sk-${"r".repeat(32)}`,
      fetch: fetchMock,
      thinking: "disabled",
    });
    await executor.execute(
      request({
        context: {
          messages: [
            { role: "user", content: "检查项目", timestamp: 1 },
            {
              role: "assistant",
              content: [
                { type: "text", text: "我先检查。" },
                {
                  type: "toolCall",
                  id: "call_shell_1",
                  name: "openerx_shell",
                  arguments: { cwd: "/workspace", command: "ls", args: ["-la"] },
                },
              ],
              timestamp: 2,
            },
            {
              role: "toolResult",
              toolCallId: "call_shell_1",
              toolName: "openerx_shell",
              content: [{ type: "text", text: "package.json" }],
              isError: false,
              timestamp: 3,
            },
          ],
        },
      }),
      undefined,
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages).toEqual([
      { role: "user", content: "检查项目" },
      {
        role: "assistant",
        content: "我先检查。",
        tool_calls: [
          {
            id: "call_shell_1",
            type: "function",
            function: {
              name: "openerx_shell",
              arguments: '{"cwd":"/workspace","command":"ls","args":["-la"]}',
            },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_shell_1", content: "package.json" },
    ]);
  });

  it("rejects an unapproved provider fallback before forwarding its first delta", async () => {
    const executor = new DeepSeekModelExecutor({
      apiKey: `sk-${"f".repeat(32)}`,
      fetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
        streamingResponse("deepseek-v4-pro"),
      ),
      thinking: "disabled",
    });
    const deltas: string[] = [];

    await expect(
      executor.stream(request(), (delta) => deltas.push(delta), undefined),
    ).rejects.toThrow("MODEL_SILENT_FALLBACK_REJECTED");
    expect(deltas).toEqual([]);
  });

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
        { role: "system", content: "You are OpenERX." },
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
