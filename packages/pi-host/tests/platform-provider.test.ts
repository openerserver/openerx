import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  automaticModelRef,
  type ModelCatalogEntry,
  type ModelGatewayRequestDto,
  type ModelGatewayResponse,
} from "@openerx/contracts";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductPiSession, ModelRuntime } from "../src/agent-session";
import { createPlatformModelProvider } from "../src/platform-provider";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const model: ModelCatalogEntry = {
  modelRef: "platform/standard",
  displayName: "标准模型",
  version: "2026-08-25",
  capabilities: {
    textInput: true,
    imageInput: false,
    fileInput: false,
    functionCalling: false,
    structuredOutput: false,
  },
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  status: "available",
  priceRef: "price/standard-alpha",
  priceSummary: "Alpha 免费计量",
  free: true,
  thinkingLevels: ["off", "medium"],
};

const visionModel: ModelCatalogEntry = {
  ...model,
  modelRef: "platform/deepseek-v4-flash-vision-exp",
  displayName: "DeepSeek V4 Flash Vision（实验）",
  capabilities: { ...model.capabilities, imageInput: true },
};

describe("Platform Model Pi Provider", () => {
  it("binds the automatic product selection to a concrete Pi model", () => {
    const automatic: ModelCatalogEntry = {
      ...model,
      modelRef: automaticModelRef,
      displayName: "自动",
    };
    const platform = createPlatformModelProvider({
      catalog: [automatic, model],
      transport: { execute: vi.fn() },
      request: {
        accountId: randomUUID(),
        conversationId: randomUUID(),
        messageId: randomUUID(),
        selectedModelRef: automaticModelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: "model-call-auto-binding",
      },
    });
    expect(platform.model.id).toBe(model.modelRef);
  });

  it("binds automatic image prompts to an image-capable Pi model", () => {
    const automatic: ModelCatalogEntry = {
      ...model,
      modelRef: automaticModelRef,
      displayName: "自动",
    };
    const platform = createPlatformModelProvider({
      catalog: [automatic, model, visionModel],
      transport: { execute: vi.fn() },
      requiresImageInput: true,
      request: {
        accountId: randomUUID(),
        conversationId: randomUUID(),
        messageId: randomUUID(),
        selectedModelRef: automaticModelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: "model-call-auto-vision-binding",
      },
    });
    expect(platform.model.id).toBe(visionModel.modelRef);
    expect(platform.model.input).toEqual(["text", "image"]);
  });

  it("rejects an explicit text-only model before accepting image input", () => {
    expect(() =>
      createPlatformModelProvider({
        catalog: [model, visionModel],
        transport: { execute: vi.fn() },
        requiresImageInput: true,
        request: {
          accountId: randomUUID(),
          conversationId: randomUUID(),
          messageId: randomUUID(),
          selectedModelRef: model.modelRef,
          approvedFallbackModelRef: null,
          requestDedupeKey: "model-call-explicit-image-rejection",
        },
      }),
    ).toThrow(`MODEL_CAPABILITY_UNSUPPORTED:imageInput:${visionModel.modelRef}`);
  });

  it("rejects a thinking level the selected model does not expose", () => {
    const offOnly: ModelCatalogEntry = {
      ...model,
      modelRef: "platform/off-only",
      displayName: "无推理模型",
      thinkingLevels: ["off"],
    };
    expect(() =>
      createPlatformModelProvider({
        catalog: [offOnly, model],
        transport: { execute: vi.fn() },
        thinkingLevel: "medium",
        request: {
          accountId: randomUUID(),
          conversationId: randomUUID(),
          messageId: randomUUID(),
          selectedModelRef: offOnly.modelRef,
          approvedFallbackModelRef: null,
          requestDedupeKey: "model-call-thinking-rejection",
        },
      }),
    ).toThrow(`MODEL_CAPABILITY_UNSUPPORTED:thinking:medium:${model.modelRef}`);
  });

  it("marks image-bearing Pi context as a gateway imageInput requirement", async () => {
    const accountId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const execute = vi.fn(async (gatewayRequest: ModelGatewayRequestDto) => ({
      text: "视觉回答",
      effectiveModelRef: visionModel.modelRef,
      fallbackReason: null,
      finishReason: "stop" as const,
      usage: {
        usageId: randomUUID(),
        accountId,
        conversationId,
        messageId,
        runId: null,
        toolCallId: null,
        selectedModelRef: gatewayRequest.selectedModelRef,
        effectiveModelRef: visionModel.modelRef,
        fallbackReason: null,
        inputTokens: 5,
        cachedInputTokens: 0,
        outputTokens: 2,
        reasoningTokens: null,
        totalTokens: 7,
        providerReported: true,
        missingReasons: { reasoningTokens: "provider_not_reported" },
        dedupeKey: gatewayRequest.requestDedupeKey,
        recordedAt: "2026-08-26T10:00:00.000Z",
      },
    }));
    const platform = createPlatformModelProvider({
      catalog: [visionModel],
      transport: { execute },
      requiresImageInput: true,
      request: {
        accountId,
        conversationId,
        messageId,
        selectedModelRef: visionModel.modelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: "model-call-image-requirement",
      },
    });
    const stream = platform.provider.streamSimple(
      platform.model,
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "图片里有什么？" },
              { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      undefined,
    );
    for await (const _event of stream) {
      // Exhaust the provider stream so the transport request completes.
    }
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ requirements: { imageInput: true }, thinkingLevel: "off" }),
      undefined,
    );
  });

  it("redacts private host paths before hashing and sending model context", async () => {
    const privateDirectory = "/private/profile/pi-workspace";
    const accountId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const execute = vi.fn(async (gatewayRequest: ModelGatewayRequestDto) => ({
      text: "ok",
      effectiveModelRef: model.modelRef,
      fallbackReason: null,
      finishReason: "stop" as const,
      usage: {
        usageId: randomUUID(),
        accountId,
        conversationId,
        messageId,
        runId: null,
        toolCallId: null,
        selectedModelRef: gatewayRequest.selectedModelRef,
        effectiveModelRef: model.modelRef,
        fallbackReason: null,
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningTokens: null,
        totalTokens: 2,
        providerReported: true,
        missingReasons: { reasoningTokens: "provider_not_reported" },
        dedupeKey: gatewayRequest.requestDedupeKey,
        recordedAt: "2026-08-28T10:00:00.000Z",
      },
    }));
    const platform = createPlatformModelProvider({
      catalog: [model],
      transport: { execute },
      request: {
        accountId,
        conversationId,
        messageId,
        selectedModelRef: model.modelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: "model-call-context-redaction",
      },
      contextRedactions: [
        {
          value: privateDirectory,
          replacement: "<private-pi-session-directory-not-a-tool-workspace>",
        },
      ],
    });
    const stream = platform.provider.streamSimple(
      platform.model,
      {
        systemPrompt: `Current working directory: ${privateDirectory}`,
        messages: [
          {
            role: "user",
            content: `do not use ${privateDirectory}`,
            timestamp: Date.now(),
          },
        ],
      },
      undefined,
    );
    for await (const _event of stream) {
      // Exhaust the provider stream so the transport request completes.
    }
    const request = execute.mock.calls[0]?.[0];
    expect(JSON.stringify(request?.context)).not.toContain(privateDirectory);
    expect(JSON.stringify(request?.context)).toContain(
      "<private-pi-session-directory-not-a-tool-workspace>",
    );
  });

  it("streams a Gateway response through Pi and preserves authoritative unknown usage", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-platform-provider-"));
    temporaryDirectories.push(root);
    const cwd = path.join(root, "workspace");
    const agentDir = path.join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    const accountId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const usageId = randomUUID();
    const response: ModelGatewayResponse = {
      text: "这是来自平台模型网关的流式回答。",
      effectiveModelRef: model.modelRef,
      fallbackReason: null,
      usage: {
        usageId,
        accountId,
        conversationId,
        messageId,
        runId: null,
        toolCallId: null,
        selectedModelRef: model.modelRef,
        effectiveModelRef: model.modelRef,
        inputTokens: 13,
        cachedInputTokens: 4,
        outputTokens: 8,
        reasoningTokens: null,
        totalTokens: 25,
        providerReported: true,
        missingReasons: { reasoningTokens: "provider_not_reported" },
        dedupeKey: "model-call-provider-test",
        recordedAt: "2026-08-25T10:00:00.000Z",
      },
    };
    const execute = vi.fn(async () => response);
    const stream = vi.fn(async function* () {
      yield { type: "delta" as const, delta: "这是来自平台" };
      yield { type: "delta" as const, delta: "模型网关的流式回答。" };
      yield { type: "completed" as const, response };
    });
    const onUsage = vi.fn();
    const platform = createPlatformModelProvider({
      catalog: [model],
      transport: { execute, stream },
      request: {
        accountId,
        conversationId,
        messageId,
        selectedModelRef: model.modelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: "model-call-provider-test",
      },
      onUsage,
      streamChunkSize: 4,
    });
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    runtime.registerNativeProvider(platform.provider);
    const { session } = await createProductPiSession({
      cwd,
      agentDir,
      history: [],
      thinkingLevel: "medium",
      modelRuntime: runtime,
      model: platform.model,
    });
    const deltas: string[] = [];
    session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        deltas.push(event.assistantMessageEvent.delta);
      }
    });
    await session.prompt("测试平台模型", { expandPromptTemplates: false });
    await session.waitForIdle();
    expect(deltas.join("")).toBe(response.text);
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, conversationId, messageId, thinkingLevel: "medium" }),
      expect.any(AbortSignal),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(onUsage).toHaveBeenCalledWith(response.usage);
    expect(session.messages.at(-1)).toMatchObject({
      role: "assistant",
      provider: "openerx-platform",
      model: model.modelRef,
      usage: { input: 13, cacheRead: 4, output: 8, totalTokens: 25 },
    });
    session.dispose();
  });

  it("preserves a provider output-limit finish reason", async () => {
    const response: ModelGatewayResponse = {
      text: "partial",
      effectiveModelRef: model.modelRef,
      fallbackReason: null,
      finishReason: "length",
      usage: {
        usageId: randomUUID(),
        accountId: randomUUID(),
        conversationId: randomUUID(),
        messageId: randomUUID(),
        runId: null,
        toolCallId: null,
        selectedModelRef: model.modelRef,
        effectiveModelRef: model.modelRef,
        fallbackReason: null,
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 256,
        reasoningTokens: null,
        totalTokens: 257,
        providerReported: true,
        missingReasons: { reasoningTokens: "provider_not_reported" },
        dedupeKey: "model-call-output-limit-test",
        recordedAt: "2026-08-26T10:00:00.000Z",
      },
    };
    const platform = createPlatformModelProvider({
      catalog: [model],
      transport: { execute: async () => response },
      request: {
        accountId: response.usage.accountId,
        conversationId: response.usage.conversationId,
        messageId: response.usage.messageId,
        selectedModelRef: model.modelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: response.usage.dedupeKey,
      },
    });
    const events: Array<{ type: string; reason?: string }> = [];
    const stream = platform.provider.streamSimple(
      platform.model,
      { messages: [{ role: "user", content: "long", timestamp: Date.now() }] },
      undefined,
    );
    for await (const event of stream) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "done", reason: "length" });
  });

  it("surfaces provider filtering as a failed model stream after usage is recorded", async () => {
    const response: ModelGatewayResponse = {
      text: "",
      effectiveModelRef: model.modelRef,
      fallbackReason: null,
      finishReason: "content_filter",
      usage: {
        usageId: randomUUID(),
        accountId: randomUUID(),
        conversationId: randomUUID(),
        messageId: randomUUID(),
        runId: null,
        toolCallId: null,
        selectedModelRef: model.modelRef,
        effectiveModelRef: model.modelRef,
        fallbackReason: null,
        inputTokens: 4,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: null,
        totalTokens: 4,
        providerReported: true,
        missingReasons: { reasoningTokens: "provider_not_reported" },
        dedupeKey: "model-call-content-filter-test",
        recordedAt: "2026-08-26T10:00:00.000Z",
      },
    };
    const onUsage = vi.fn();
    const platform = createPlatformModelProvider({
      catalog: [model],
      transport: { execute: async () => response },
      request: {
        accountId: response.usage.accountId,
        conversationId: response.usage.conversationId,
        messageId: response.usage.messageId,
        selectedModelRef: model.modelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: response.usage.dedupeKey,
      },
      onUsage,
    });
    const events: Array<{ type: string; reason?: string }> = [];
    const stream = platform.provider.streamSimple(
      platform.model,
      { messages: [{ role: "user", content: "filtered", timestamp: Date.now() }] },
      undefined,
    );
    for await (const event of stream) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "error", reason: "error" });
    expect(onUsage).toHaveBeenCalledWith(response.usage);
  });

  it("executes a native gateway tool call and continues with a distinct model-round key", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "openerx-platform-tool-loop-"));
    temporaryDirectories.push(root);
    const cwd = path.join(root, "workspace");
    const agentDir = path.join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    const accountId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const toolModel: ModelCatalogEntry = {
      ...model,
      capabilities: { ...model.capabilities, functionCalling: true },
    };
    const requests: ModelGatewayRequestDto[] = [];
    const execute = vi.fn(async (gatewayRequest: ModelGatewayRequestDto) => {
      requests.push(gatewayRequest);
      const context = gatewayRequest.context as { messages?: Array<{ role?: unknown }> };
      const hasToolResult = context.messages?.some(({ role }) => role === "toolResult") ?? false;
      const response: ModelGatewayResponse = {
        text: hasToolResult ? "检查完成，最优先处理消息协议。" : "我先检查项目。",
        ...(hasToolResult
          ? { finishReason: "stop" }
          : {
              finishReason: "tool_calls",
              toolCalls: [
                {
                  id: "call_inspect_1",
                  name: "inspect_project",
                  arguments: {},
                },
              ],
            }),
        effectiveModelRef: toolModel.modelRef,
        fallbackReason: null,
        usage: {
          usageId: randomUUID(),
          accountId,
          conversationId,
          messageId,
          runId: null,
          toolCallId: null,
          selectedModelRef: toolModel.modelRef,
          effectiveModelRef: toolModel.modelRef,
          fallbackReason: null,
          inputTokens: hasToolResult ? 20 : 10,
          cachedInputTokens: 0,
          outputTokens: hasToolResult ? 8 : 4,
          reasoningTokens: null,
          totalTokens: hasToolResult ? 28 : 14,
          providerReported: true,
          missingReasons: { reasoningTokens: "provider_not_reported" },
          dedupeKey: gatewayRequest.requestDedupeKey,
          recordedAt: "2026-08-26T10:00:00.000Z",
        },
      };
      return response;
    });
    const onUsage = vi.fn();
    const platform = createPlatformModelProvider({
      catalog: [toolModel],
      transport: { execute },
      request: {
        accountId,
        conversationId,
        messageId,
        selectedModelRef: toolModel.modelRef,
        approvedFallbackModelRef: null,
        requestDedupeKey: "model-call-tool-loop",
      },
      onUsage,
      streamChunkSize: 1_000,
    });
    const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    runtime.registerNativeProvider(platform.provider);
    const executeTool = vi.fn(async () => ({
      content: [
        { type: "text" as const, text: "package.json" },
        { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" },
      ],
      details: { entries: ["package.json"] },
    }));
    const { session } = await createProductPiSession({
      cwd,
      agentDir,
      history: [],
      modelRuntime: runtime,
      model: platform.model,
      customTools: [
        defineTool({
          name: "inspect_project",
          label: "Inspect project",
          description: "List the project root.",
          parameters: Type.Object({}, { additionalProperties: false }),
          execute: executeTool,
        }),
      ],
    });
    const deltas: string[] = [];
    const toolStarts: string[] = [];
    session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        deltas.push(event.assistantMessageEvent.delta);
      }
      if (event.type === "tool_execution_start") toolStarts.push(event.toolName);
    });

    await session.prompt("检查项目", { expandPromptTemplates: false });
    await session.waitForIdle();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(new Set(onUsage.mock.calls.map(([usage]) => usage.usageId)).size).toBe(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(toolStarts).toEqual(["inspect_project"]);
    expect(deltas.join("")).toBe("我先检查项目。检查完成，最优先处理消息协议。");
    expect(deltas.join("")).not.toContain("DSML");
    expect(requests.every(({ requirements }) => requirements.functionCalling === true)).toBe(true);
    expect(new Set(requests.map(({ requestDedupeKey }) => requestDedupeKey)).size).toBe(2);
    expect(
      requests.every(({ requestDedupeKey }) =>
        /^model-call-tool-loop:ctx:[a-f0-9]{64}$/u.test(requestDedupeKey),
      ),
    ).toBe(true);
    const continuationContext = requests[1]?.context as
      | { messages?: Array<{ role?: unknown; content?: unknown }> }
      | undefined;
    const toolResult = continuationContext?.messages?.find(({ role }) => role === "toolResult");
    expect(toolResult?.content).toEqual([
      { type: "text", text: "package.json" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ]);
    expect(session.messages.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "stop",
    });
    session.dispose();
  });
});
