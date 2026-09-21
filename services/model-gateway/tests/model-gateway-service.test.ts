import { randomUUID } from "node:crypto";
import {
  automaticModelRef,
  type ModelCatalogEntry,
  type ModelGatewayRequestDto,
  type UsageRecord,
  type UsageStorePort,
} from "@openerx/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelGatewayService } from "../src/model-gateway-service";

class TestUsageStore implements Pick<UsageStorePort, "record"> {
  readonly records: UsageRecord[] = [];

  record(record: UsageRecord): { record: UsageRecord; replayed: boolean } {
    const existing = this.records.find(
      (candidate) =>
        candidate.accountId === record.accountId && candidate.dedupeKey === record.dedupeKey,
    );
    if (existing) return { record: existing, replayed: true };
    this.records.push(record);
    return { record, replayed: false };
  }
}

const stores: TestUsageStore[] = [];

afterEach(() => stores.splice(0));

const catalog: ModelCatalogEntry[] = [
  {
    modelRef: "platform/standard",
    displayName: "标准模型",
    version: "2026-08-25",
    capabilities: {
      textInput: true,
      imageInput: true,
      fileInput: false,
      functionCalling: false,
      structuredOutput: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    status: "available",
    priceRef: "price/standard-2026-08",
    priceSummary: "Alpha 免费计量",
    free: true,
    thinkingLevels: ["off"],
  },
  {
    modelRef: "platform/tools",
    displayName: "工具模型",
    version: "2026-08-25",
    capabilities: {
      textInput: true,
      imageInput: true,
      fileInput: true,
      functionCalling: true,
      structuredOutput: true,
    },
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    status: "available",
    priceRef: "price/tools-2026-08",
    priceSummary: "Alpha 免费计量",
    free: true,
    thinkingLevels: ["off", "medium"],
  },
];

function request(values: Partial<ModelGatewayRequestDto> = {}): ModelGatewayRequestDto {
  return {
    accountId: randomUUID(),
    conversationId: randomUUID(),
    messageId: randomUUID(),
    selectedModelRef: "platform/standard",
    approvedFallbackModelRef: null,
    requestDedupeKey: `model-${randomUUID()}`,
    requirements: {},
    context: { messages: [{ role: "user", content: "hello" }] },
    ...values,
  };
}

function setup(effectiveModelRef = "platform/standard") {
  const usageStore = new TestUsageStore();
  stores.push(usageStore);
  const execute = vi.fn(async () => ({
    text: "平台回答",
    effectiveModelRef,
    ...(effectiveModelRef === "platform/standard" ? {} : { fallbackReason: "approved outage" }),
    usage: {
      inputTokens: 11,
      cachedInputTokens: 3,
      outputTokens: 7,
      reasoningTokens: null,
      totalTokens: 21,
      providerReported: true,
      missingReasons: { reasoningTokens: "provider_not_reported" },
    },
  }));
  return {
    usageStore,
    execute,
    gateway: new ModelGatewayService({ catalog, executor: { execute }, usageStore }),
  };
}

describe("ModelGatewayService", () => {
  it("publishes an automatic model and records its resolved effective model", async () => {
    const { gateway } = setup();
    expect(gateway.catalog()[0]).toMatchObject({
      modelRef: automaticModelRef,
      displayName: "自动",
    });
    const result = await gateway.execute(request({ selectedModelRef: automaticModelRef }));
    expect(result.usage).toMatchObject({
      selectedModelRef: automaticModelRef,
      effectiveModelRef: "platform/standard",
    });
  });

  it("executes an explicit model and records authoritative token usage once", async () => {
    const { gateway, usageStore, execute } = setup();
    const input = request();
    const first = await gateway.execute(input);
    const replay = await gateway.execute(input);
    expect(first.text).toBe("平台回答");
    expect(first.usage).toMatchObject({
      selectedModelRef: "platform/standard",
      effectiveModelRef: "platform/standard",
      cachedInputTokens: 3,
      reasoningTokens: null,
    });
    expect(replay).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(usageStore.records).toHaveLength(1);
  });

  it("forwards executor deltas and records usage only at the completed terminal", async () => {
    const usageStore = new TestUsageStore();
    stores.push(usageStore);
    const execution = {
      text: "平台流式回答",
      effectiveModelRef: "platform/standard",
      usage: {
        inputTokens: 11,
        cachedInputTokens: 3,
        outputTokens: 7,
        reasoningTokens: null,
        totalTokens: 21,
        providerReported: true,
        missingReasons: { reasoningTokens: "provider_not_reported" },
      },
    };
    const stream = vi.fn(async (_input, onDelta: (delta: string) => void) => {
      expect(usageStore.records).toHaveLength(0);
      onDelta("平台");
      onDelta("流式回答");
      expect(usageStore.records).toHaveLength(0);
      return execution;
    });
    const gateway = new ModelGatewayService({
      catalog,
      executor: { execute: vi.fn(async () => execution), stream },
      usageStore,
    });
    const deltas: string[] = [];
    const result = await gateway.stream(request(), (delta) => deltas.push(delta));

    expect(deltas).toEqual(["平台", "流式回答"]);
    expect(result.text).toBe("平台流式回答");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(usageStore.records).toHaveLength(1);
  });

  it("preserves structured tool calls in the unified response", async () => {
    const usageStore = new TestUsageStore();
    stores.push(usageStore);
    const execution = {
      text: "我先检查。",
      toolCalls: [
        {
          id: "call_inspect_1",
          name: "inspect_project",
          arguments: { depth: 2 },
        },
      ],
      finishReason: "tool_calls",
      effectiveModelRef: "platform/tools",
      usage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 4,
        reasoningTokens: null,
        totalTokens: 14,
        providerReported: true,
        missingReasons: { reasoningTokens: "provider_not_reported" },
      },
    };
    const gateway = new ModelGatewayService({
      catalog,
      executor: { execute: vi.fn(async () => execution) },
      usageStore,
    });

    const result = await gateway.execute(
      request({ selectedModelRef: "platform/tools", requirements: { functionCalling: true } }),
    );

    expect(result).toMatchObject({
      text: "我先检查。",
      finishReason: "tool_calls",
      toolCalls: execution.toolCalls,
    });
    expect(usageStore.records).toHaveLength(1);
  });

  it("blocks unsupported capabilities before execution and suggests compatible models", async () => {
    const { gateway, execute } = setup();
    const check = gateway.checkSelection("platform/standard", {
      functionCalling: true,
      fileInput: true,
    });
    expect(check).toEqual({
      supported: false,
      modelRef: "platform/standard",
      missingCapabilities: ["fileInput", "functionCalling"],
      suggestedModelRefs: ["platform/tools"],
    });
    await expect(
      gateway.execute(request({ requirements: { functionCalling: true } })),
    ).rejects.toThrow("MODEL_CAPABILITY_UNSUPPORTED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks unsupported thinking levels before provider execution", async () => {
    const { gateway, execute } = setup();
    expect(gateway.checkSelection("platform/standard", {}, "medium")).toEqual({
      supported: false,
      modelRef: "platform/standard",
      missingCapabilities: ["thinking:medium"],
      suggestedModelRefs: ["platform/tools"],
    });
    expect(gateway.checkSelection("platform/tools", {}, "medium")).toEqual({ supported: true });
    await expect(gateway.execute(request({ thinkingLevel: "medium" }))).rejects.toThrow(
      "MODEL_CAPABILITY_UNSUPPORTED:thinking:medium",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects silent replacement and accepts only an explicitly approved fallback", async () => {
    const { gateway } = setup("platform/tools");
    await expect(gateway.execute(request())).rejects.toThrow("MODEL_SILENT_FALLBACK_REJECTED");
    const approved = await gateway.execute(request({ approvedFallbackModelRef: "platform/tools" }));
    expect(approved).toMatchObject({
      effectiveModelRef: "platform/tools",
      fallbackReason: "approved outage",
    });
  });
});
