import type { PricingSnapshot, UsageEstimate, UsageRecord } from "@openerx/contracts";

const microMinorPerMinor = 1_000_000n;
const ratePrecision = 1_000n;

function ceilDivide(value: bigint, divisor: bigint): bigint {
  return value === 0n ? 0n : (value + divisor - 1n) / divisor;
}

function scaledRate(rate: number): bigint {
  const scaled = rate * Number(ratePrecision);
  if (!Number.isSafeInteger(scaled)) throw new Error("BILLING_RATE_PRECISION_INVALID");
  return BigInt(scaled);
}

export function calculateEstimatedChargeMinor(
  snapshot: PricingSnapshot,
  usage: UsageEstimate,
): number {
  const rates = snapshot.tokenRates;
  const scaledMicroMinor =
    BigInt(usage.inputTokens) * scaledRate(rates.inputMicroMinorPerToken) +
    BigInt(usage.cachedInputTokens) * scaledRate(rates.cachedInputMicroMinorPerToken) +
    BigInt(usage.outputTokens) * scaledRate(rates.outputMicroMinorPerToken) +
    BigInt(usage.reasoningTokens) * scaledRate(rates.reasoningMicroMinorPerToken);
  const rounded = Number(ceilDivide(scaledMicroMinor, microMinorPerMinor * ratePrecision));
  const withMinimum = Math.max(snapshot.minimumChargeMinor, rounded);
  return snapshot.maximumChargeMinor === null
    ? withMinimum
    : Math.min(snapshot.maximumChargeMinor, withMinimum);
}

export function calculateUsageChargeMinor(snapshot: PricingSnapshot, usage: UsageRecord): number {
  const required: Array<keyof UsageEstimate> = [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningTokens",
  ];
  for (const field of required) {
    if (
      snapshot.tokenRates[
        `${field.replace("Tokens", "")}MicroMinorPerToken` as keyof typeof snapshot.tokenRates
      ] !== 0 &&
      usage[field] === null
    ) {
      throw new Error(`BILLING_USAGE_UNKNOWN:${field}`);
    }
  }
  return calculateEstimatedChargeMinor(snapshot, {
    inputTokens: usage.inputTokens ?? 0,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
  });
}

export function pointValueMinor(
  points: number,
  rule: { minorNumerator: number; pointDenominator: number },
): number {
  return Number((BigInt(points) * BigInt(rule.minorNumerator)) / BigInt(rule.pointDenominator));
}

export function pointsNeededForMinor(
  minor: number,
  rule: { minorNumerator: number; pointDenominator: number },
): number {
  return Number(
    ceilDivide(BigInt(minor) * BigInt(rule.pointDenominator), BigInt(rule.minorNumerator)),
  );
}
