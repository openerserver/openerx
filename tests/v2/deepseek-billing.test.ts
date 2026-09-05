import { randomUUID } from "node:crypto";
import { BillingLedgerService, ServerModelBilling } from "@openerx/billing-ledger-service";
import {
  createDeepSeekModelCatalog,
  createDeepSeekPriceCatalog,
  deepSeekBillingTerms,
  deepSeekModelRefs,
  ModelGatewayService,
} from "@openerx/model-gateway";
import { PricingService } from "@openerx/pricing-service";
import { UsageStore } from "@openerx/token-usage-store";
import { describe, expect, it } from "vitest";

describe("DeepSeek authoritative billing", () => {
  it("publishes a frozen price entry for the experimental vision model", () => {
    const vision = createDeepSeekPriceCatalog().find(
      ({ modelRef }) => modelRef === deepSeekModelRefs.vision,
    );
    expect(vision).toMatchObject({
      priceRef: "price/deepseek-v4-flash-vision-exp-official-cn-2026-08-26",
      tokenRates: {
        inputMicroMinorPerToken: 100,
        cachedInputMicroMinorPerToken: 2,
        outputMicroMinorPerToken: 200,
      },
    });
  });

  it("settles provider usage with the server-frozen Pro price and exposes only final billing", async () => {
    const accountId = randomUUID();
    const pricing = new PricingService(":memory:", {
      catalog: createDeepSeekPriceCatalog("deepseek-v4-pro"),
      terms: deepSeekBillingTerms,
    });
    const billing = new BillingLedgerService(":memory:");
    const usage = new UsageStore(":memory:");
    pricing.acceptTerms(accountId, deepSeekBillingTerms.version);
    billing.grantQuota({
      accountId,
      source: "deepseek-billing-test",
      amountMinor: 2_000,
      effectiveAt: "2026-08-25T16:00:00.000Z",
      expiresAt: null,
      applicableModelRefs: [],
      reason: "DeepSeek 服务端计费集成测试",
      idempotencyKey: "deepseek-billing-test-quota",
    });
    const serverBilling = new ServerModelBilling({
      pricing,
      ledger: billing,
      usageBudget: () => ({
        estimatedUsage: {
          inputTokens: 1_000_000,
          cachedInputTokens: 1_000_000,
          outputTokens: 1_000_000,
          reasoningTokens: 0,
        },
        maximumUsage: {
          inputTokens: 1_000_000,
          cachedInputTokens: 1_000_000,
          outputTokens: 1_000_000,
          reasoningTokens: 0,
        },
      }),
      userLimitMinor: () => 1_000,
    });
    const gateway = new ModelGatewayService({
      catalog: createDeepSeekModelCatalog("deepseek-v4-pro"),
      usageStore: usage,
      billing: serverBilling,
      executor: {
        async execute() {
          return {
            text: "server billed",
            effectiveModelRef: deepSeekModelRefs.pro,
            usage: {
              inputTokens: 1_000_000,
              cachedInputTokens: 1_000_000,
              outputTokens: 1_000_000,
              reasoningTokens: 0,
              totalTokens: 3_000_000,
              providerReported: true,
              missingReasons: {},
            },
          };
        },
      },
    });

    try {
      const response = await gateway.execute({
        accountId,
        conversationId: randomUUID(),
        messageId: randomUUID(),
        selectedModelRef: deepSeekModelRefs.pro,
        approvedFallbackModelRef: null,
        requestDedupeKey: "deepseek-authoritative-billing",
        requirements: {},
        context: { messages: [{ role: "user", content: "bill this" }] },
      });
      expect(response).not.toHaveProperty("quote");
      expect(response).not.toHaveProperty("charge");
      expect(response.usage).toMatchObject({
        inputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        providerReported: true,
      });

      const charges = billing.listCharges(accountId);
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({
        effectiveModelRef: deepSeekModelRefs.pro,
        grossAmountMinor: 903,
        finalAmountMinor: 903,
        status: "settled",
        pricingSnapshot: {
          version: "deepseek-official-cn-2026-08-26-v1",
          tokenRates: { cachedInputMicroMinorPerToken: 2.5 },
        },
      });
    } finally {
      usage.close();
      billing.close();
      pricing.close();
    }
  });
});
