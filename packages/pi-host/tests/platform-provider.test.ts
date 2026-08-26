import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  automaticModelRef,
  type ModelCatalogEntry,
  type ModelGatewayResponse,
} from "@openerx/contracts";
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
    text: true,
    imageInput: false,
    fileInput: false,
    tools: false,
    mcp: false,
    imageGeneration: false,
  },
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  status: "available",
  priceRef: "price/standard-alpha",
  priceSummary: "Alpha 免费计量",
  free: true,
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
    const onUsage = vi.fn();
    const platform = createPlatformModelProvider({
      catalog: [model],
      transport: { execute },
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
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, conversationId, messageId }),
      expect.any(AbortSignal),
    );
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
});
