import { z } from "zod";
import { entityIdSchema, timestampSchema } from "./chat";
import { usageRecordSchema } from "./model";

export const billingCurrencySchema = z.literal("CNY");
export const minorAmountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const pointAmountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Rates are expressed in micro-minor currency units per token. Three decimal places are
// retained so provider price tables such as 2.5 micro-minor/token can be represented exactly.
export const microRateSchema = z
  .number()
  .nonnegative()
  .max(Math.floor(Number.MAX_SAFE_INTEGER / 1_000))
  .multipleOf(0.001);

export const tokenRateSchema = z
  .object({
    inputMicroMinorPerToken: microRateSchema,
    cachedInputMicroMinorPerToken: microRateSchema,
    outputMicroMinorPerToken: microRateSchema,
    reasoningMicroMinorPerToken: microRateSchema,
  })
  .strict();

export const billingTermsSchema = z
  .object({
    version: z.string().min(1),
    effectiveAt: timestampSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    summary: z.string().min(1),
  })
  .strict();

export const billingTermsAcceptanceSchema = z
  .object({
    accountId: entityIdSchema,
    termsVersion: z.string().min(1),
    acceptedAt: timestampSchema,
  })
  .strict();

export const billingTermsStateSchema = z
  .object({
    terms: billingTermsSchema,
    acceptance: billingTermsAcceptanceSchema.nullable(),
  })
  .strict();

export const acceptBillingTermsInputSchema = z.object({ version: z.string().min(1) }).strict();

export const priceCatalogEntrySchema = z
  .object({
    priceRef: z.string().min(1),
    version: z.string().min(1),
    modelRef: z.string().min(1),
    currency: billingCurrencySchema,
    effectiveFrom: timestampSchema,
    effectiveUntil: timestampSchema.nullable(),
    tokenRates: tokenRateSchema,
    minimumChargeMinor: minorAmountSchema,
    maximumChargeMinor: minorAmountSchema.nullable(),
    rounding: z.literal("ceil_final"),
    termsVersion: z.string().min(1),
    description: z.string().min(1),
    taxInclusive: z.boolean(),
    free: z.boolean(),
  })
  .strict();

export const usageEstimateSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
  })
  .strict();

export const pricingSnapshotSchema = priceCatalogEntrySchema
  .omit({ effectiveFrom: true, effectiveUntil: true })
  .extend({
    pricingSnapshotId: entityIdSchema,
    effectiveFrom: timestampSchema,
    effectiveUntil: timestampSchema.nullable(),
    frozenAt: timestampSchema,
  })
  .strict();

export const createPriceQuoteInputSchema = z
  .object({
    modelRef: z.string().min(1),
    estimatedUsage: usageEstimateSchema,
    maximumUsage: usageEstimateSchema,
    userLimitMinor: minorAmountSchema,
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

export const priceQuoteSchema = z
  .object({
    quoteId: entityIdSchema,
    accountId: entityIdSchema,
    modelRef: z.string().min(1),
    currency: billingCurrencySchema,
    estimatedAmountMinor: minorAmountSchema,
    maximumAmountMinor: minorAmountSchema,
    userLimitMinor: minorAmountSchema,
    termsVersion: z.string().min(1),
    snapshot: pricingSnapshotSchema,
    idempotencyKey: z.string().min(8).max(200),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict();

export const pointConversionRuleSchema = z
  .object({
    version: z.string().min(1),
    minorNumerator: z.number().int().positive(),
    pointDenominator: z.number().int().positive(),
  })
  .strict();

export const quotaGrantSchema = z
  .object({
    grantId: entityIdSchema,
    accountId: entityIdSchema,
    source: z.string().min(1),
    initialMinor: minorAmountSchema,
    remainingMinor: minorAmountSchema,
    effectiveAt: timestampSchema,
    expiresAt: timestampSchema.nullable(),
    applicableModelRefs: z.array(z.string().min(1)),
    reason: z.string().min(1),
    createdAt: timestampSchema,
  })
  .strict();

export const pointGrantSchema = z
  .object({
    grantId: entityIdSchema,
    accountId: entityIdSchema,
    source: z.string().min(1),
    initialPoints: pointAmountSchema,
    remainingPoints: pointAmountSchema,
    conversionRule: pointConversionRuleSchema,
    effectiveAt: timestampSchema,
    expiresAt: timestampSchema.nullable(),
    applicableModelRefs: z.array(z.string().min(1)),
    reason: z.string().min(1),
    createdAt: timestampSchema,
  })
  .strict();

export const cashBalanceSchema = z
  .object({
    accountId: entityIdSchema,
    currency: billingCurrencySchema,
    postedMinor: minorAmountSchema,
    reservedMinor: minorAmountSchema,
    availableMinor: minorAmountSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const billingOverviewSchema = z
  .object({
    accountId: entityIdSchema,
    currency: billingCurrencySchema,
    quotaGrants: z.array(quotaGrantSchema),
    pointGrants: z.array(pointGrantSchema),
    cash: cashBalanceSchema,
    quotaAvailableMinor: minorAmountSchema,
    pointAvailableMinor: minorAmountSchema,
    totalAvailableMinor: minorAmountSchema,
    activeReservationsMinor: minorAmountSchema,
    asOf: timestampSchema,
  })
  .strict();

export const reservationAllocationSchema = z
  .object({
    quota: z.array(z.object({ grantId: entityIdSchema, amountMinor: minorAmountSchema }).strict()),
    points: z.array(
      z
        .object({
          grantId: entityIdSchema,
          points: pointAmountSchema,
          valueMinor: minorAmountSchema,
        })
        .strict(),
    ),
    cashMinor: minorAmountSchema,
  })
  .strict();

export const fundsReservationSchema = z
  .object({
    reservationId: entityIdSchema,
    accountId: entityIdSchema,
    quoteId: entityIdSchema,
    modelRef: z.string().min(1),
    maximumAmountMinor: minorAmountSchema,
    allocation: reservationAllocationSchema,
    status: z.enum(["active", "settled", "released"]),
    idempotencyKey: z.string().min(8).max(200),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    settledAt: timestampSchema.nullable(),
    releasedAt: timestampSchema.nullable(),
    releasedMinor: minorAmountSchema,
  })
  .strict();

export const chargeRecordSchema = z
  .object({
    chargeId: entityIdSchema,
    accountId: entityIdSchema,
    usageId: entityIdSchema,
    messageId: entityIdSchema.nullable(),
    runId: entityIdSchema.nullable(),
    toolCallId: entityIdSchema.nullable(),
    reservationId: entityIdSchema,
    quoteId: entityIdSchema,
    pricingSnapshotId: entityIdSchema,
    pricingSnapshot: pricingSnapshotSchema,
    usage: usageRecordSchema,
    ledgerTransactionId: entityIdSchema.nullable(),
    selectedModelRef: z.string().min(1),
    effectiveModelRef: z.string().min(1),
    grossAmountMinor: minorAmountSchema,
    quotaDeductionMinor: minorAmountSchema,
    pointDeductionMinor: minorAmountSchema,
    pointsDeducted: pointAmountSchema,
    cashDeductionMinor: minorAmountSchema,
    finalAmountMinor: minorAmountSchema,
    status: z.enum(["pending", "settled", "reversed", "refunded", "disputed"]),
    dedupeKey: z.string().min(8).max(200),
    createdAt: timestampSchema,
    settledAt: timestampSchema.nullable(),
    pendingReason: z.string().min(1).nullable(),
    reversedAt: timestampSchema.nullable(),
    reversalTransactionId: entityIdSchema.nullable(),
  })
  .strict();

export const ledgerUnitSchema = z.enum(["CNY_MINOR", "POINT"]);
export const ledgerEntrySchema = z
  .object({
    entryId: entityIdSchema,
    transactionId: entityIdSchema,
    accountId: entityIdSchema,
    ledgerAccount: z.string().min(1),
    unit: ledgerUnitSchema,
    debit: minorAmountSchema,
    credit: minorAmountSchema,
    createdAt: timestampSchema,
  })
  .strict()
  .refine(({ debit, credit }) => (debit === 0) !== (credit === 0), {
    message: "exactly one of debit or credit must be positive",
  });

export const ledgerTransactionSchema = z
  .object({
    transactionId: entityIdSchema,
    accountId: entityIdSchema,
    type: z.enum([
      "quota_grant",
      "point_grant",
      "cash_credit",
      "cash_debit",
      "charge_settlement",
      "charge_reversal",
    ]),
    referenceId: z.string().min(1),
    dedupeKey: z.string().min(8).max(200),
    reversalOf: entityIdSchema.nullable(),
    createdAt: timestampSchema,
    entries: z.array(ledgerEntrySchema).min(2),
  })
  .strict();

export const rechargeOrderSchema = z
  .object({
    orderId: entityIdSchema,
    accountId: entityIdSchema,
    amountMinor: minorAmountSchema.positive(),
    currency: billingCurrencySchema,
    provider: z.enum(["alipay", "wechat"]),
    status: z.enum([
      "created",
      "pending_payment",
      "paid",
      "credited",
      "failed",
      "closed",
      "partially_refunded",
      "refunded",
    ]),
    idempotencyKey: z.string().min(8).max(200),
    checkoutUrl: z.url().nullable(),
    providerReference: z.string().min(1).nullable(),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    paidAt: timestampSchema.nullable(),
    creditedAt: timestampSchema.nullable(),
  })
  .strict();

export const createRechargeOrderInputSchema = z
  .object({
    amountMinor: minorAmountSchema.positive(),
    provider: z.enum(["alipay", "wechat"]),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

export const billingStatementRequestSchema = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
  .strict();

export const paymentCallbackSchema = z
  .object({
    eventId: z.string().min(8),
    orderId: entityIdSchema,
    providerReference: z.string().min(1),
    amountMinor: minorAmountSchema.positive(),
    currency: billingCurrencySchema,
    status: z.enum(["succeeded", "failed"]),
    occurredAt: timestampSchema,
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const refundOrderSchema = z
  .object({
    refundId: entityIdSchema,
    accountId: entityIdSchema,
    orderId: entityIdSchema,
    amountMinor: minorAmountSchema.positive(),
    reason: z.string().min(1),
    status: z.enum(["succeeded", "failed"]),
    idempotencyKey: z.string().min(8).max(200),
    createdAt: timestampSchema,
  })
  .strict();

export const reconciliationDiscrepancySchema = z
  .object({
    discrepancyId: z.string().regex(/^[a-f0-9]{64}$/),
    provider: z.enum(["alipay", "wechat"]),
    orderId: entityIdSchema,
    kind: z.enum(["missing_local", "missing_provider", "amount_mismatch", "status_mismatch"]),
    expectedMinor: minorAmountSchema.nullable(),
    actualMinor: minorAmountSchema.nullable(),
    detectedAt: timestampSchema,
    status: z.literal("open"),
  })
  .strict();

export const billingStatementSchema = z
  .object({
    statementId: entityIdSchema,
    accountId: entityIdSchema,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    currency: billingCurrencySchema,
    openingMinor: minorAmountSchema,
    chargesMinor: minorAmountSchema,
    creditsMinor: minorAmountSchema,
    refundsMinor: minorAmountSchema,
    reversalsMinor: minorAmountSchema,
    adjustmentsMinor: minorAmountSchema,
    closingMinor: minorAmountSchema,
    generatedAt: timestampSchema,
  })
  .strict();

export const billingStatementExportSchema = z
  .object({
    statement: billingStatementSchema,
    csv: z.string().min(1),
    pdfBase64: z.string().min(8),
  })
  .strict();

export const billingSettleInputSchema = z
  .object({
    reservationId: entityIdSchema,
    usage: usageRecordSchema,
    dedupeKey: z.string().min(8).max(200),
  })
  .strict();

export type BillingTerms = z.infer<typeof billingTermsSchema>;
export type BillingTermsAcceptance = z.infer<typeof billingTermsAcceptanceSchema>;
export type BillingTermsState = z.infer<typeof billingTermsStateSchema>;
export type PriceCatalogEntry = z.infer<typeof priceCatalogEntrySchema>;
export type UsageEstimate = z.infer<typeof usageEstimateSchema>;
export type PricingSnapshot = z.infer<typeof pricingSnapshotSchema>;
export type PriceQuote = z.infer<typeof priceQuoteSchema>;
export type PointConversionRule = z.infer<typeof pointConversionRuleSchema>;
export type QuotaGrant = z.infer<typeof quotaGrantSchema>;
export type PointGrant = z.infer<typeof pointGrantSchema>;
export type BillingOverview = z.infer<typeof billingOverviewSchema>;
export type ReservationAllocation = z.infer<typeof reservationAllocationSchema>;
export type FundsReservation = z.infer<typeof fundsReservationSchema>;
export type ChargeRecord = z.infer<typeof chargeRecordSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type LedgerTransaction = z.infer<typeof ledgerTransactionSchema>;
export type RechargeOrder = z.infer<typeof rechargeOrderSchema>;
export type PaymentCallback = z.infer<typeof paymentCallbackSchema>;
export type RefundOrder = z.infer<typeof refundOrderSchema>;
export type ReconciliationDiscrepancy = z.infer<typeof reconciliationDiscrepancySchema>;
export type BillingStatement = z.infer<typeof billingStatementSchema>;
export type BillingStatementExport = z.infer<typeof billingStatementExportSchema>;

export interface BillingBridge {
  getBillingTerms(): Promise<BillingTermsState>;
  acceptBillingTerms(version: string): Promise<BillingTermsAcceptance>;
  getBillingOverview(): Promise<BillingOverview>;
  listCharges(): Promise<ChargeRecord[]>;
  listLedger(): Promise<LedgerTransaction[]>;
  createRechargeOrder(
    input: z.input<typeof createRechargeOrderInputSchema>,
  ): Promise<RechargeOrder>;
  listRechargeOrders(): Promise<RechargeOrder[]>;
  listRefunds(): Promise<RefundOrder[]>;
  exportBillingStatement(month: string): Promise<BillingStatementExport>;
}
