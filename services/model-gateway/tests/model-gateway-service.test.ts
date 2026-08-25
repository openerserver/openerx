import { randomUUID } from "node:crypto";
import type {
  ModelCatalogEntry,
  ModelGatewayRequestDto,
  UsageRecord,
  UsageStorePort,
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
      text: true,
      imageInput: true,
      fileInput: false,
      tools: false,
      mcp: false,
      imageGeneration: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    status: "available",
    priceRef: "price/standard-2026-08",
    priceSummary: "Alpha 免费计量",
    free: true,
  },
  {
    modelRef: "platform/tools",
    displayName: "工具模型",
    version: "2026-08-25",
    capabilities: {
      text: true,
      imageInput: true,
      fileInput: true,
      tools: true,
      mcp: true,
      imageGeneration: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    status: "available",
    priceRef: "price/tools-2026-08",
    priceSummary: "Alpha 免费计量",
    free: true,
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

  it("blocks unsupported capabilities before execution and suggests compatible models", async () => {
    const { gateway, execute } = setup();
    const check = gateway.checkSelection("platform/standard", { tools: true, fileInput: true });
    expect(check).toEqual({
      supported: false,
      modelRef: "platform/standard",
      missingCapabilities: ["fileInput", "tools"],
      suggestedModelRefs: ["platform/tools"],
    });
    await expect(gateway.execute(request({ requirements: { tools: true } }))).rejects.toThrow(
      "MODEL_CAPABILITY_UNSUPPORTED",
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
