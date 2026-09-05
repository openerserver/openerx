import { createHash, randomUUID } from "node:crypto";
import type { BillingTerms, PriceCatalogEntry } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { PricingService } from "../src";

const terms: BillingTerms = {
  version: "terms-2026-08-v1",
  effectiveAt: "2026-08-01T00:00:00.000Z",
  contentHash: createHash("sha256").update("terms").digest("hex"),
  summary: "按实际 Token 结算，失败未用金额释放。",
};

const price: PriceCatalogEntry = {
  priceRef: "price/standard",
  version: "2026-08-v1",
  modelRef: "platform/standard",
  currency: "CNY",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveUntil: null,
  tokenRates: {
    inputMicroMinorPerToken: 100_000,
    cachedInputMicroMinorPerToken: 10_000,
    outputMicroMinorPerToken: 200_000,
    reasoningMicroMinorPerToken: 200_000,
  },
  minimumChargeMinor: 1,
  maximumChargeMinor: null,
  rounding: "ceil_final",
  termsVersion: terms.version,
  description: "标准模型测试价格",
  taxInclusive: true,
  free: false,
};

describe("PricingService", () => {
  it("requires accepted terms and freezes an idempotent integer quote", () => {
    let now = new Date("2026-08-25T10:00:00.000Z");
    const service = new PricingService(":memory:", { catalog: [price], terms, now: () => now });
    const accountId = randomUUID();
    const input = {
      modelRef: price.modelRef,
      estimatedUsage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        reasoningTokens: 0,
      },
      maximumUsage: {
        inputTokens: 20,
        cachedInputTokens: 0,
        outputTokens: 10,
        reasoningTokens: 0,
      },
      userLimitMinor: 10,
      idempotencyKey: "quote-standard-001",
    };
    expect(() => service.createQuote(accountId, input)).toThrow("BILLING_TERMS_NOT_ACCEPTED");
    service.acceptTerms(accountId, terms.version);
    const quote = service.createQuote(accountId, input);
    expect(quote.estimatedAmountMinor).toBe(2);
    expect(quote.maximumAmountMinor).toBe(4);
    expect(service.createQuote(accountId, input)).toEqual(quote);
    expect(() =>
      service.createQuote(accountId, {
        ...input,
        userLimitMinor: 3,
        idempotencyKey: "limit-low-001",
      }),
    ).toThrow("QUOTE_EXCEEDS_USER_LIMIT");

    now = new Date("2026-08-25T10:10:00.000Z");
    expect(new Date(quote.expiresAt).getTime()).toBeLessThan(now.getTime());
    expect(service.getQuote(accountId, quote.quoteId).snapshot.version).toBe(price.version);
    service.close();
  });

  it("does not expose quotes across accounts or allow dedupe mutation", () => {
    const service = new PricingService(":memory:", { catalog: [price], terms });
    const accountId = randomUUID();
    service.acceptTerms(accountId, terms.version);
    const input = {
      modelRef: price.modelRef,
      estimatedUsage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 },
      maximumUsage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 },
      userLimitMinor: 10,
      idempotencyKey: "quote-isolation-001",
    };
    const quote = service.createQuote(accountId, input);
    expect(() => service.getQuote(randomUUID(), quote.quoteId)).toThrow("QUOTE_NOT_FOUND");
    expect(() => service.createQuote(accountId, { ...input, userLimitMinor: 9 })).toThrow(
      "QUOTE_IDEMPOTENCY_KEY_REUSE",
    );
    service.close();
  });
});
