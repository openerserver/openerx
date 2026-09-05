import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BillingLedgerService, ServerModelBilling } from "@openerx/billing-ledger-service";
import {
  type BillingTerms,
  type ModelCatalogEntry,
  modelGatewayRequestSchema,
  type PriceCatalogEntry,
} from "@openerx/contracts";
import { ModelGatewayService } from "@openerx/model-gateway";
import { PaymentAdapter, signPaymentCallback } from "@openerx/payment-adapter";
import { PricingService } from "@openerx/pricing-service";
import { UsageStore } from "@openerx/token-usage-store";
import { afterEach, describe, expect, it } from "vitest";

const initialTime = "2026-08-25T10:00:00.000Z";
const terms: BillingTerms = {
  version: "terms-2026-08-v1",
  effectiveAt: "2026-08-01T00:00:00.000Z",
  contentHash: createHash("sha256").update("OpenERX Billing Alpha terms").digest("hex"),
  summary: "按服务端记录的实际用量结算；失败时释放未使用预留。",
};
const modelCatalog: ModelCatalogEntry[] = [
  {
    modelRef: "platform/standard",
    displayName: "标准模型",
    version: "m3-alpha",
    capabilities: {
      textInput: true,
      imageInput: false,
      fileInput: false,
      functionCalling: false,
      structuredOutput: false,
    },
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    status: "available",
    priceRef: "price/standard",
    priceSummary: "服务端按实际 Token 结算",
    free: false,
  },
];
const secrets = { alipay: "m3-alipay-secret", wechat: "m3-wechat-secret" };
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "openerx-billing-m3-"));
  tempDirectories.push(directory);
  return directory;
}

function price(version = "price-2026-08-v1"): PriceCatalogEntry {
  return {
    priceRef: "price/standard",
    version,
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
    termsVersion: terms.version,
    description: "测试价：输入 Token 每个一分，其余字段不收费",
    taxInclusive: true,
    free: false,
  };
}

function modelRequest(accountId: string, key: string) {
  return {
    accountId,
    conversationId: randomUUID(),
    messageId: randomUUID(),
    selectedModelRef: "platform/standard",
    approvedFallbackModelRef: null,
    requestDedupeKey: key,
    requirements: {},
    context: { messages: [] },
  };
}

function usageBudget(inputTokens = 100) {
  return {
    estimatedUsage: {
      inputTokens: Math.min(10, inputTokens),
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    },
    maximumUsage: {
      inputTokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    },
  };
}

function callback(
  order: { orderId: string; amountMinor: number },
  provider: "alipay" | "wechat",
  occurredAt = initialTime,
  eventId = randomUUID(),
) {
  const unsigned = {
    eventId,
    orderId: order.orderId,
    providerReference: `${provider}-${order.orderId}`,
    amountMinor: order.amountMinor,
    currency: "CNY" as const,
    status: "succeeded" as const,
    occurredAt,
  };
  return { ...unsigned, signature: signPaymentCallback(unsigned, secrets[provider]) };
}

function serverBilling(
  pricing: PricingService,
  ledger: BillingLedgerService,
  maximumInputTokens = 100,
) {
  return new ServerModelBilling({
    pricing,
    ledger,
    usageBudget: () => usageBudget(maximumInputTokens),
    userLimitMinor: () => 10_000,
  });
}

describe("M3 Billing Alpha golden tasks", () => {
  it("GT-BILLING-01 keeps quota, points and recharge cash separately explainable", () => {
    const ledger = new BillingLedgerService(":memory:", { now: () => new Date(initialTime) });
    const accountId = randomUUID();
    ledger.grantQuota({
      accountId,
      source: "welcome",
      amountMinor: 300,
      effectiveAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      applicableModelRefs: ["platform/standard"],
      reason: "新用户额度",
      idempotencyKey: "gt01-quota-grant",
    });
    ledger.grantPoints({
      accountId,
      source: "activity",
      points: 200,
      conversionRule: { version: "points-v1", minorNumerator: 1, pointDenominator: 2 },
      effectiveAt: "2026-08-01T00:00:00.000Z",
      expiresAt: null,
      applicableModelRefs: [],
      reason: "活动积分",
      idempotencyKey: "gt01-point-grant",
    });
    ledger.creditCash(accountId, 1_000, "gt01-recharge", "gt01-cash-credit");

    const overview = ledger.overview(accountId);
    expect(overview).toMatchObject({
      quotaAvailableMinor: 300,
      pointAvailableMinor: 100,
      totalAvailableMinor: 1_400,
      cash: { postedMinor: 1_000, availableMinor: 1_000 },
    });
    expect(overview.quotaGrants[0]).toMatchObject({
      source: "welcome",
      reason: "新用户额度",
      expiresAt: "2026-09-01T00:00:00.000Z",
      applicableModelRefs: ["platform/standard"],
    });
    expect(overview.pointGrants[0]?.conversionRule.version).toBe("points-v1");
    ledger.assertBalanced(accountId);
    ledger.close();
  });

  it("GT-BILLING-02 accepts versioned terms and freezes a server-created quote snapshot", async () => {
    const directory = tempDirectory();
    const database = path.join(directory, "pricing.sqlite");
    const accountId = randomUUID();
    let pricing = new PricingService(database, {
      catalog: [price("price-v1")],
      terms,
      now: () => new Date(initialTime),
    });
    const ledger = new BillingLedgerService(":memory:", { now: () => new Date(initialTime) });
    ledger.creditCash(accountId, 1_000, "gt02-credit", "gt02-credit-key");
    expect(pricing.termsAcceptance(accountId)).toBeNull();
    pricing.acceptTerms(accountId, terms.version);
    const authorization = await serverBilling(pricing, ledger, 20).authorize(
      modelGatewayRequestSchema.parse(modelRequest(accountId, "gt02-server-request")),
    );
    expect(authorization.quote).toMatchObject({
      accountId,
      estimatedAmountMinor: 10,
      maximumAmountMinor: 20,
      termsVersion: terms.version,
      snapshot: { version: "price-v1", rounding: "ceil_final" },
    });
    expect(
      modelGatewayRequestSchema.safeParse({
        ...modelRequest(accountId, "gt02-forged-client"),
        estimatedUsage: usageBudget(20).estimatedUsage,
        quoteAmountMinor: 1,
      }).success,
    ).toBe(false);
    const quoteId = authorization.quote.quoteId;
    pricing.close();
    pricing = new PricingService(database, {
      catalog: [price("price-v2")],
      terms,
      now: () => new Date(initialTime),
    });
    expect(pricing.getQuote(accountId, quoteId).snapshot.version).toBe("price-v1");
    pricing.close();
    ledger.close();
  });

  it("GT-BILLING-03 blocks execution before the provider when server funds are insufficient", async () => {
    const accountId = randomUUID();
    const pricing = new PricingService(":memory:", {
      catalog: [price()],
      terms,
      now: () => new Date(initialTime),
    });
    const ledger = new BillingLedgerService(":memory:", { now: () => new Date(initialTime) });
    const usage = new UsageStore(":memory:");
    pricing.acceptTerms(accountId, terms.version);
    let executions = 0;
    const gateway = new ModelGatewayService({
      catalog: modelCatalog,
      usageStore: usage,
      billing: serverBilling(pricing, ledger, 50),
      executor: {
        async execute() {
          executions += 1;
          throw new Error("provider must not execute");
        },
      },
      now: () => new Date(initialTime),
    });

    await expect(gateway.execute(modelRequest(accountId, "gt03-insufficient"))).rejects.toThrow(
      "BILLING_INSUFFICIENT_FUNDS",
    );
    expect(executions).toBe(0);
    expect(usage.list({ accountId })).toEqual([]);
    expect(ledger.listCharges(accountId)).toEqual([]);
    expect(ledger.overview(accountId).totalAvailableMinor).toBe(0);
    usage.close();
    ledger.close();
    pricing.close();
  });

  it("GT-BILLING-04 credits an Alipay server callback exactly once across replay and restart", () => {
    const directory = tempDirectory();
    const accountId = randomUUID();
    const ledger = new BillingLedgerService(path.join(directory, "ledger.sqlite"), {
      now: () => new Date(initialTime),
    });
    const paymentDatabase = path.join(directory, "payment.sqlite");
    let payments = new PaymentAdapter(paymentDatabase, {
      ledger,
      secrets,
      now: () => new Date(initialTime),
    });
    const order = payments.createOrder(accountId, {
      amountMinor: 5_000,
      provider: "alipay",
      idempotencyKey: "gt04-alipay-order",
    });
    const event = callback(order, "alipay");
    expect(payments.handleCallback(event).status).toBe("credited");
    expect(payments.handleCallback(event).status).toBe("credited");
    payments.close();
    payments = new PaymentAdapter(paymentDatabase, {
      ledger,
      secrets,
      now: () => new Date(initialTime),
    });
    expect(payments.handleCallback(event).status).toBe("credited");
    expect(ledger.overview(accountId).cash.postedMinor).toBe(5_000);
    expect(ledger.listLedger(accountId).filter(({ type }) => type === "cash_credit")).toHaveLength(
      1,
    );
    payments.close();
    ledger.close();
  });

  it("GT-BILLING-05 never credits a closed WeChat order and credits its retry once", () => {
    const accountId = randomUUID();
    const ledger = new BillingLedgerService(":memory:", { now: () => new Date(initialTime) });
    const payments = new PaymentAdapter(":memory:", {
      ledger,
      secrets,
      now: () => new Date(initialTime),
    });
    const closed = payments.createOrder(accountId, {
      amountMinor: 1_000,
      provider: "wechat",
      idempotencyKey: "gt05-wechat-closed",
    });
    payments.closeOrder(accountId, closed.orderId);
    expect(() => payments.handleCallback(callback(closed, "wechat"))).toThrow(
      "PAYMENT_ORDER_CLOSED",
    );
    const retry = payments.createOrder(accountId, {
      amountMinor: 1_000,
      provider: "wechat",
      idempotencyKey: "gt05-wechat-retry",
    });
    payments.handleCallback(callback(retry, "wechat"));
    expect(ledger.overview(accountId).cash.postedMinor).toBe(1_000);
    payments.close();
    ledger.close();
  });

  it("GT-BILLING-06 settles server Usage once in quota-expiry, points, then cash order", async () => {
    const accountId = randomUUID();
    const pricing = new PricingService(":memory:", {
      catalog: [price()],
      terms,
      now: () => new Date(initialTime),
    });
    const ledger = new BillingLedgerService(":memory:", { now: () => new Date(initialTime) });
    const usage = new UsageStore(":memory:");
    pricing.acceptTerms(accountId, terms.version);
    ledger.grantQuota({
      accountId,
      source: "first",
      amountMinor: 30,
      effectiveAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-30T00:00:00.000Z",
      applicableModelRefs: [],
      reason: "最早到期",
      idempotencyKey: "gt06-quota-first",
    });
    ledger.grantQuota({
      accountId,
      source: "second",
      amountMinor: 20,
      effectiveAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-09-30T00:00:00.000Z",
      applicableModelRefs: [],
      reason: "较晚到期",
      idempotencyKey: "gt06-quota-second",
    });
    ledger.grantPoints({
      accountId,
      source: "reward",
      points: 20,
      conversionRule: { version: "points-v1", minorNumerator: 1, pointDenominator: 1 },
      effectiveAt: "2026-08-01T00:00:00.000Z",
      expiresAt: null,
      applicableModelRefs: [],
      reason: "奖励",
      idempotencyKey: "gt06-points",
    });
    ledger.creditCash(accountId, 50, "gt06-recharge", "gt06-cash");
    const gateway = new ModelGatewayService({
      catalog: modelCatalog,
      usageStore: usage,
      billing: serverBilling(pricing, ledger, 100),
      executor: {
        async execute() {
          return {
            text: "server billed",
            effectiveModelRef: "platform/standard",
            usage: {
              inputTokens: 80,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningTokens: 0,
              totalTokens: 80,
              providerReported: true,
              missingReasons: {},
            },
          };
        },
      },
      now: () => new Date(initialTime),
    });

    const request = modelRequest(accountId, "gt06-server-charge");
    const response = await gateway.execute(request);
    expect(response).not.toHaveProperty("charge");
    expect(await gateway.execute(request)).toEqual(response);
    const restartedGateway = new ModelGatewayService({
      catalog: modelCatalog,
      usageStore: usage,
      billing: serverBilling(pricing, ledger, 100),
      executor: {
        async execute() {
          return {
            text: "server billed",
            effectiveModelRef: "platform/standard",
            usage: {
              inputTokens: 80,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningTokens: 0,
              totalTokens: 80,
              providerReported: true,
              missingReasons: {},
            },
          };
        },
      },
      now: () => new Date("2026-08-25T10:01:00.000Z"),
    });
    expect(await restartedGateway.execute(request)).toEqual(response);
    expect(usage.list({ accountId })).toHaveLength(1);
    const charges = ledger.listCharges(accountId);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      grossAmountMinor: 80,
      quotaDeductionMinor: 50,
      pointDeductionMinor: 20,
      pointsDeducted: 20,
      cashDeductionMinor: 10,
      status: "settled",
    });
    expect(ledger.overview(accountId)).toMatchObject({
      quotaAvailableMinor: 0,
      pointAvailableMinor: 0,
      cash: { postedMinor: 40 },
      activeReservationsMinor: 0,
    });
    ledger.assertBalanced(accountId);
    usage.close();
    ledger.close();
    pricing.close();
  });

  it("GT-BILLING-07 releases failed work and leaves unknown priced usage pending without estimates", async () => {
    const accountId = randomUUID();
    const pricing = new PricingService(":memory:", {
      catalog: [price()],
      terms,
      now: () => new Date(initialTime),
    });
    const ledger = new BillingLedgerService(":memory:", { now: () => new Date(initialTime) });
    const usage = new UsageStore(":memory:");
    pricing.acceptTerms(accountId, terms.version);
    ledger.creditCash(accountId, 20, "gt07-credit", "gt07-credit-key");
    const failed = new ModelGatewayService({
      catalog: modelCatalog,
      usageStore: usage,
      billing: serverBilling(pricing, ledger, 10),
      executor: {
        async execute() {
          throw new Error("PROVIDER_FAILED");
        },
      },
      now: () => new Date(initialTime),
    });
    await expect(failed.execute(modelRequest(accountId, "gt07-provider-failed"))).rejects.toThrow(
      "PROVIDER_FAILED",
    );
    expect(ledger.overview(accountId)).toMatchObject({
      totalAvailableMinor: 20,
      activeReservationsMinor: 0,
    });
    expect(ledger.listCharges(accountId)).toEqual([]);

    const unknown = new ModelGatewayService({
      catalog: modelCatalog,
      usageStore: usage,
      billing: serverBilling(pricing, ledger, 10),
      executor: {
        async execute() {
          return {
            text: "usage awaiting provider correction",
            effectiveModelRef: "platform/standard",
            usage: {
              inputTokens: null,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningTokens: 0,
              totalTokens: null,
              providerReported: false,
              missingReasons: {
                inputTokens: "provider_not_reported",
                totalTokens: "provider_not_reported",
              },
            },
          };
        },
      },
      now: () => new Date(initialTime),
    });
    await expect(
      unknown.execute(modelRequest(accountId, "gt07-unknown-usage")),
    ).resolves.toMatchObject({ text: "usage awaiting provider correction" });
    expect(ledger.listCharges(accountId)).toEqual([
      expect.objectContaining({
        status: "pending",
        finalAmountMinor: 0,
        pendingReason: "BILLING_USAGE_UNKNOWN:inputTokens",
      }),
    ]);
    expect(ledger.overview(accountId).cash.postedMinor).toBe(20);
    usage.close();
    ledger.close();
    pricing.close();
  });

  it("GT-BILLING-08 preserves original charges while linking reversal and payment refund entries", () => {
    const accountId = randomUUID();
    const pricing = new PricingService(":memory:", {
      catalog: [price()],
      terms,
      now: () => new Date(initialTime),
    });
    const ledger = new BillingLedgerService(":memory:", { now: () => new Date(initialTime) });
    pricing.acceptTerms(accountId, terms.version);
    ledger.creditCash(accountId, 100, "gt08-start", "gt08-start-credit");
    const quote = pricing.createQuote(accountId, {
      modelRef: "platform/standard",
      ...usageBudget(20),
      userLimitMinor: 100,
      idempotencyKey: "gt08-server-quote",
    });
    const reservation = ledger.reserve(quote, "gt08-server-reservation");
    const usageId = randomUUID();
    const charge = ledger.settle(
      accountId,
      reservation.reservationId,
      {
        usageId,
        accountId,
        conversationId: randomUUID(),
        messageId: randomUUID(),
        runId: null,
        toolCallId: null,
        selectedModelRef: "platform/standard",
        effectiveModelRef: "platform/standard",
        inputTokens: 20,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 20,
        providerReported: true,
        missingReasons: {},
        dedupeKey: "gt08-usage-record",
        recordedAt: initialTime,
      },
      "gt08-charge-record",
    );
    const reversed = ledger.reverseCharge(accountId, charge.chargeId, "gt08-charge-reversal");
    expect(reversed).toMatchObject({ chargeId: charge.chargeId, status: "reversed" });
    const reversal = ledger
      .listLedger(accountId)
      .find(({ transactionId }) => transactionId === reversed.reversalTransactionId);
    expect(reversal?.reversalOf).toBe(charge.ledgerTransactionId);
    expect(ledger.overview(accountId).cash.postedMinor).toBe(100);

    const payments = new PaymentAdapter(":memory:", {
      ledger,
      secrets,
      now: () => new Date(initialTime),
    });
    const order = payments.createOrder(accountId, {
      amountMinor: 500,
      provider: "alipay",
      idempotencyKey: "gt08-refund-order",
    });
    payments.handleCallback(callback(order, "alipay"));
    const refund = payments.refund(
      accountId,
      order.orderId,
      200,
      "错误充值批准退款",
      "gt08-refund",
    );
    expect(refund.status).toBe("succeeded");
    expect(payments.listOrders(accountId)[0]?.status).toBe("partially_refunded");
    expect(ledger.overview(accountId).cash.postedMinor).toBe(400);
    ledger.assertBalanced(accountId);
    payments.close();
    ledger.close();
    pricing.close();
  });

  it("GT-BILLING-09 exports an immutable closed-month CSV and openable PDF", () => {
    let clock = new Date(initialTime);
    const accountId = randomUUID();
    const pricing = new PricingService(":memory:", {
      catalog: [price()],
      terms,
      now: () => clock,
    });
    const ledger = new BillingLedgerService(":memory:", { now: () => clock });
    pricing.acceptTerms(accountId, terms.version);
    ledger.creditCash(accountId, 1_000, "gt09-recharge", "gt09-recharge-credit");
    const quote = pricing.createQuote(accountId, {
      modelRef: "platform/standard",
      ...usageBudget(20),
      userLimitMinor: 100,
      idempotencyKey: "gt09-server-quote",
    });
    const reservation = ledger.reserve(quote, "gt09-reservation");
    const charge = ledger.settle(
      accountId,
      reservation.reservationId,
      {
        usageId: randomUUID(),
        accountId,
        conversationId: randomUUID(),
        messageId: randomUUID(),
        runId: null,
        toolCallId: null,
        selectedModelRef: "platform/standard",
        effectiveModelRef: "platform/standard",
        inputTokens: 20,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 20,
        providerReported: true,
        missingReasons: {},
        dedupeKey: "gt09-usage-record",
        recordedAt: initialTime,
      },
      "gt09-charge-record",
    );
    ledger.reverseCharge(accountId, charge.chargeId, "gt09-charge-reversal");
    ledger.debitCash(accountId, 100, "gt09-refund", "gt09-refund-debit");
    expect(() => ledger.exportStatement(accountId, "2026-08")).toThrow("STATEMENT_PERIOD_OPEN");
    clock = new Date("2026-09-01T00:00:00.000Z");
    const statement = ledger.exportStatement(accountId, "2026-08");
    expect(statement.statement).toMatchObject({
      creditsMinor: 1_000,
      chargesMinor: 20,
      refundsMinor: 100,
      reversalsMinor: 20,
      closingMinor: 900,
    });
    expect(statement.csv).toContain("charge_settlement");
    expect(statement.csv).toContain("charge_reversal");
    const outputDirectory = path.resolve("tmp/pdfs");
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(
      path.join(outputDirectory, "m3-billing-statement.pdf"),
      Buffer.from(statement.pdfBase64, "base64"),
    );
    ledger.creditCash(accountId, 50, "gt09-next-period", "gt09-next-period-credit");
    expect(ledger.exportStatement(accountId, "2026-08")).toEqual(statement);
    ledger.close();
    pricing.close();
  });

  it("GT-BILLING-10 isolates accounts, rebuilds asset projections and detects stable discrepancies", () => {
    const directory = tempDirectory();
    const ledgerDatabase = path.join(directory, "ledger.sqlite");
    const accountId = randomUUID();
    const stranger = randomUUID();
    let ledger = new BillingLedgerService(ledgerDatabase, { now: () => new Date(initialTime) });
    ledger.grantQuota({
      accountId,
      source: "rebuild",
      amountMinor: 100,
      effectiveAt: "2026-08-01T00:00:00.000Z",
      expiresAt: null,
      applicableModelRefs: [],
      reason: "重建额度",
      idempotencyKey: "gt10-quota",
    });
    ledger.grantPoints({
      accountId,
      source: "rebuild",
      points: 100,
      conversionRule: { version: "points-v1", minorNumerator: 1, pointDenominator: 1 },
      effectiveAt: "2026-08-01T00:00:00.000Z",
      expiresAt: null,
      applicableModelRefs: [],
      reason: "重建积分",
      idempotencyKey: "gt10-points",
    });
    const expected = ledger.overview(accountId);
    expect(ledger.overview(stranger).totalAvailableMinor).toBe(0);
    expect(ledger.listLedger(stranger)).toEqual([]);
    ledger.close();

    const database = new DatabaseSync(ledgerDatabase);
    database.exec("UPDATE quota_grants SET remaining_minor = 0");
    database.exec("UPDATE point_grants SET remaining_points = 0");
    database.close();
    ledger = new BillingLedgerService(ledgerDatabase, { now: () => new Date(initialTime) });
    expect(ledger.overview(accountId).totalAvailableMinor).toBe(0);
    expect(ledger.rebuildAssetProjections(accountId).totalAvailableMinor).toBe(
      expected.totalAvailableMinor,
    );
    ledger.assertBalanced(accountId);

    const payments = new PaymentAdapter(":memory:", {
      ledger,
      secrets,
      now: () => new Date(initialTime),
    });
    const order = payments.createOrder(accountId, {
      amountMinor: 500,
      provider: "alipay",
      idempotencyKey: "gt10-reconcile-order",
    });
    expect(payments.listOrders(stranger)).toEqual([]);
    const before = ledger.overview(accountId);
    const providerRows = [
      {
        provider: "alipay" as const,
        orderId: order.orderId,
        amountMinor: 400,
        status: "succeeded" as const,
      },
    ];
    const first = payments.reconcile("alipay", providerRows);
    const second = payments.reconcile("alipay", providerRows);
    expect(first.map(({ kind }) => kind).sort()).toEqual(["amount_mismatch", "status_mismatch"]);
    expect(second.map(({ discrepancyId }) => discrepancyId)).toEqual(
      first.map(({ discrepancyId }) => discrepancyId),
    );
    expect(ledger.overview(accountId).totalAvailableMinor).toBe(before.totalAvailableMinor);
    payments.close();
    ledger.close();
  });
});
