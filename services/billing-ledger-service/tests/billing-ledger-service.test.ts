import { randomUUID } from "node:crypto";
import type { PriceQuote, UsageRecord } from "@openerx/contracts";
import { describe, expect, it } from "vitest";
import { BillingLedgerService } from "../src";

const baseTime = "2026-08-25T10:00:00.000Z";

function quote(accountId: string, maximumAmountMinor: number, key: string): PriceQuote {
  return {
    quoteId: randomUUID(),
    accountId,
    modelRef: "platform/standard",
    currency: "CNY",
    estimatedAmountMinor: Math.min(100, maximumAmountMinor),
    maximumAmountMinor,
    userLimitMinor: maximumAmountMinor,
    termsVersion: "terms-v1",
    snapshot: {
      pricingSnapshotId: randomUUID(),
      priceRef: "price/standard",
      version: "price-v1",
      modelRef: "platform/standard",
      currency: "CNY",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveUntil: null,
      tokenRates: {
        inputMicroMinorPerToken: 1_000_000,
        cachedInputMicroMinorPerToken: 0,
        outputMicroMinorPerToken: 0,
        reasoningMicroMinorPerToken: 0,
      },
      minimumChargeMinor: 0,
      maximumChargeMinor: null,
      rounding: "ceil_final",
      termsVersion: "terms-v1",
      description: "每输入 Token 一分",
      taxInclusive: true,
      free: false,
      frozenAt: baseTime,
    },
    idempotencyKey: key,
    createdAt: baseTime,
    expiresAt: "2026-08-25T11:00:00.000Z",
  };
}

function usage(accountId: string, inputTokens: number): UsageRecord {
  return {
    usageId: randomUUID(),
    accountId,
    conversationId: randomUUID(),
    messageId: randomUUID(),
    runId: null,
    toolCallId: null,
    selectedModelRef: "platform/standard",
    effectiveModelRef: "platform/standard",
    inputTokens,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: inputTokens,
    providerReported: true,
    missingReasons: {
      cachedInputTokens: "not_billed",
      outputTokens: "not_billed",
      reasoningTokens: "not_billed",
    },
    dedupeKey: `usage-${randomUUID()}`,
    recordedAt: baseTime,
  };
}

function seed(service: BillingLedgerService, accountId: string): void {
  service.grantQuota({
    accountId,
    source: "welcome",
    amountMinor: 50,
    effectiveAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-08-30T00:00:00.000Z",
    applicableModelRefs: [],
    reason: "最早到期额度",
    idempotencyKey: "quota-expiring-001",
  });
  service.grantQuota({
    accountId,
    source: "monthly",
    amountMinor: 50,
    effectiveAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-30T00:00:00.000Z",
    applicableModelRefs: [],
    reason: "月度额度",
    idempotencyKey: "quota-monthly-001",
  });
  service.grantPoints({
    accountId,
    source: "reward",
    points: 40,
    conversionRule: { version: "points-v1", minorNumerator: 1, pointDenominator: 1 },
    effectiveAt: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    applicableModelRefs: [],
    reason: "活动积分",
    idempotencyKey: "points-reward-001",
  });
  service.creditCash(accountId, 100, "recharge-001", "cash-credit-001");
}

describe("BillingLedgerService", () => {
  it("reserves and settles in quota, points, then cash order without duplicate charge", () => {
    const service = new BillingLedgerService(":memory:", { now: () => new Date(baseTime) });
    const accountId = randomUUID();
    seed(service, accountId);
    const reservation = service.reserve(quote(accountId, 150, "quote-order-001"), "reserve-001");
    expect(reservation.allocation).toMatchObject({ cashMinor: 10 });
    expect(reservation.allocation.quota.map(({ amountMinor }) => amountMinor)).toEqual([50, 50]);
    expect(reservation.allocation.points).toEqual([
      expect.objectContaining({ points: 40, valueMinor: 40 }),
    ]);

    const measured = usage(accountId, 120);
    const charge = service.settle(accountId, reservation.reservationId, measured, "charge-001");
    expect(charge).toMatchObject({
      grossAmountMinor: 120,
      quotaDeductionMinor: 100,
      pointDeductionMinor: 20,
      pointsDeducted: 20,
      cashDeductionMinor: 0,
      finalAmountMinor: 120,
    });
    expect(
      service.settle(accountId, reservation.reservationId, measured, "changed-key-001"),
    ).toEqual(charge);
    const overview = service.overview(accountId);
    expect(overview.quotaAvailableMinor).toBe(0);
    expect(overview.pointGrants[0]?.remainingPoints).toBe(20);
    expect(overview.cash.postedMinor).toBe(100);
    expect(overview.activeReservationsMinor).toBe(0);
    service.assertBalanced(accountId);
    expect(service.rebuildCashBalance(accountId)).toBe(100);
    expect(service.rebuildAssetProjections(accountId)).toEqual(service.overview(accountId));
    service.close();
  });

  it("blocks over-reservation atomically and releases an unused reservation once", () => {
    const service = new BillingLedgerService(":memory:", { now: () => new Date(baseTime) });
    const accountId = randomUUID();
    service.creditCash(accountId, 100, "recharge", "cash-only-credit");
    const first = service.reserve(quote(accountId, 80, "quote-first-001"), "reserve-first-001");
    const ledgerBefore = service.listLedger(accountId);
    expect(() =>
      service.reserve(quote(accountId, 30, "quote-second-001"), "reserve-second-001"),
    ).toThrow("BILLING_INSUFFICIENT_FUNDS");
    expect(service.listLedger(accountId)).toEqual(ledgerBefore);
    const released = service.release(accountId, first.reservationId);
    expect(released).toMatchObject({ status: "released", releasedMinor: 80 });
    expect(service.release(accountId, first.reservationId)).toEqual(released);
    expect(service.overview(accountId).cash.availableMinor).toBe(100);
    service.close();
  });

  it("reverses with linked entries while preserving the original charge evidence", () => {
    const service = new BillingLedgerService(":memory:", { now: () => new Date(baseTime) });
    const accountId = randomUUID();
    seed(service, accountId);
    const reservation = service.reserve(
      quote(accountId, 80, "quote-reverse-001"),
      "reserve-reverse",
    );
    const charge = service.settle(
      accountId,
      reservation.reservationId,
      usage(accountId, 80),
      "charge-reverse",
    );
    const reversed = service.reverseCharge(accountId, charge.chargeId, "reverse-charge-001");
    expect(reversed).toMatchObject({
      chargeId: charge.chargeId,
      grossAmountMinor: charge.grossAmountMinor,
      status: "reversed",
    });
    expect(reversed.reversalTransactionId).not.toBeNull();
    expect(service.reverseCharge(accountId, charge.chargeId, "reverse-charge-001")).toEqual(
      reversed,
    );
    expect(service.overview(accountId).quotaAvailableMinor).toBe(100);
    service.assertBalanced(accountId);
    service.close();
  });

  it("isolates accounts, rebuilds cash and exports deterministic CSV/PDF statement bytes", () => {
    let clock = new Date(baseTime);
    const service = new BillingLedgerService(":memory:", { now: () => clock });
    const accountId = randomUUID();
    const stranger = randomUUID();
    service.creditCash(accountId, 250, "recharge", "statement-credit-001");
    expect(service.overview(stranger).totalAvailableMinor).toBe(0);
    expect(service.listLedger(stranger)).toEqual([]);
    expect(service.rebuildCashBalance(accountId)).toBe(
      service.overview(accountId).cash.postedMinor,
    );
    expect(() => service.exportStatement(accountId, "2026-08")).toThrow("STATEMENT_PERIOD_OPEN");
    clock = new Date("2026-09-01T00:00:00.000Z");
    const exported = service.exportStatement(accountId, "2026-08");
    expect(exported.csv).toContain("cash_credit");
    expect(Buffer.from(exported.pdfBase64, "base64").subarray(0, 8).toString()).toBe("%PDF-1.4");
    service.creditCash(accountId, 50, "late-adjustment", "late-statement-credit");
    expect(service.exportStatement(accountId, "2026-08")).toEqual(exported);
    service.close();
  });
});
