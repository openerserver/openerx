import type { PricingSnapshot } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { calculateEstimatedChargeMinor } from "../src/billing";

function snapshot(): PricingSnapshot {
  return {
    pricingSnapshotId: "ac3d7f13-6b2e-4cca-9df1-f299c020cfff",
    priceRef: "price/fractional-rate",
    version: "fractional-v1",
    modelRef: "platform/fractional",
    currency: "CNY",
    effectiveFrom: "2026-08-25T16:00:00.000Z",
    effectiveUntil: null,
    tokenRates: {
      inputMicroMinorPerToken: 300,
      cachedInputMicroMinorPerToken: 2.5,
      outputMicroMinorPerToken: 600,
      reasoningMicroMinorPerToken: 0,
    },
    minimumChargeMinor: 0,
    maximumChargeMinor: null,
    rounding: "ceil_final",
    termsVersion: "terms-v1",
    description: "fractional micro-minor rate",
    taxInclusive: false,
    free: false,
    frozenAt: "2026-08-26T00:00:00.000Z",
  };
}

describe("billing calculation", () => {
  it("retains fractional micro-minor token rates until final minor-unit rounding", () => {
    expect(
      calculateEstimatedChargeMinor(snapshot(), {
        inputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        outputTokens: 1_000_000,
        reasoningTokens: 0,
      }),
    ).toBe(903);
  });
});
