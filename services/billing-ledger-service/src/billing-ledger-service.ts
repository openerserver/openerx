import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type BillingOverview,
  type BillingStatementExport,
  billingOverviewSchema,
  billingStatementExportSchema,
  type ChargeRecord,
  chargeRecordSchema,
  type FundsReservation,
  fundsReservationSchema,
  type LedgerEntry,
  type LedgerTransaction,
  ledgerTransactionSchema,
  type PointGrant,
  type PriceQuote,
  pointGrantSchema,
  priceQuoteSchema,
  type QuotaGrant,
  quotaGrantSchema,
  type ReservationAllocation,
  reservationAllocationSchema,
  type UsageRecord,
  usageRecordSchema,
} from "@openerx/contracts";
import { calculateUsageChargeMinor, pointsNeededForMinor, pointValueMinor } from "@openerx/domain";

type SqlRow = Record<string, unknown>;

export interface BillingLedgerServiceOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export interface GrantQuotaInput {
  accountId: string;
  source: string;
  amountMinor: number;
  effectiveAt: string;
  expiresAt: string | null;
  applicableModelRefs: string[];
  reason: string;
  idempotencyKey: string;
}

export interface GrantPointsInput {
  accountId: string;
  source: string;
  points: number;
  conversionRule: { version: string; minorNumerator: number; pointDenominator: number };
  effectiveAt: string;
  expiresAt: string | null;
  applicableModelRefs: string[];
  reason: string;
  idempotencyKey: string;
}

interface ChargeAllocation {
  quota: Array<{ grantId: string; amountMinor: number }>;
  points: Array<{ grantId: string; points: number; valueMinor: number }>;
  cashMinor: number;
}

function recordHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function applicable(modelRefs: string[], modelRef: string): boolean {
  return modelRefs.length === 0 || modelRefs.includes(modelRef);
}

function sortExpiry<T extends { expiresAt: string | null; createdAt: string }>(rows: T[]): T[] {
  return rows.sort((left, right) => {
    const leftExpiry = left.expiresAt
      ? new Date(left.expiresAt).getTime()
      : Number.POSITIVE_INFINITY;
    const rightExpiry = right.expiresAt
      ? new Date(right.expiresAt).getTime()
      : Number.POSITIVE_INFINITY;
    return leftExpiry - rightExpiry || left.createdAt.localeCompare(right.createdAt);
  });
}

function escapePdf(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function minimalPdf(lines: string[]): Buffer {
  const stream = lines
    .slice(0, 40)
    .map((line, index) => `BT /F1 10 Tf 48 ${790 - index * 18} Td (${escapePdf(line)}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

export class BillingLedgerService {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #idFactory: () => string;

  constructor(databasePath: string, options: BillingLedgerServiceOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  grantQuota(input: GrantQuotaInput): QuotaGrant {
    const existing = this.#quotaByDedupe(input.accountId, input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== recordHash(input)) throw new Error("LEDGER_DEDUPE_KEY_REUSE");
      return existing.grant;
    }
    return this.#transaction(() => {
      const createdAt = this.#now().toISOString();
      const grant = quotaGrantSchema.parse({
        grantId: this.#idFactory(),
        accountId: input.accountId,
        source: input.source,
        initialMinor: input.amountMinor,
        remainingMinor: input.amountMinor,
        effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt,
        applicableModelRefs: input.applicableModelRefs,
        reason: input.reason,
        createdAt,
      });
      this.#database
        .prepare(
          `INSERT INTO quota_grants
           (grant_id, account_id, source, initial_minor, remaining_minor, effective_at,
            expires_at, applicable_models_json, reason, idempotency_key, request_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          grant.grantId,
          grant.accountId,
          grant.source,
          grant.initialMinor,
          grant.remainingMinor,
          grant.effectiveAt,
          grant.expiresAt,
          JSON.stringify(grant.applicableModelRefs),
          grant.reason,
          input.idempotencyKey,
          recordHash(input),
          grant.createdAt,
        );
      this.#postTransaction(
        grant.accountId,
        "quota_grant",
        grant.grantId,
        `ledger:${input.idempotencyKey}`,
        null,
        [
          this.#entry(
            `asset:quota:${grant.grantId}`,
            "CNY_MINOR",
            grant.initialMinor,
            0,
            createdAt,
          ),
          this.#entry("equity:quota:platform", "CNY_MINOR", 0, grant.initialMinor, createdAt),
        ],
      );
      return grant;
    });
  }

  grantPoints(input: GrantPointsInput): PointGrant {
    const existing = this.#pointByDedupe(input.accountId, input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== recordHash(input)) throw new Error("LEDGER_DEDUPE_KEY_REUSE");
      return existing.grant;
    }
    return this.#transaction(() => {
      const createdAt = this.#now().toISOString();
      const grant = pointGrantSchema.parse({
        grantId: this.#idFactory(),
        accountId: input.accountId,
        source: input.source,
        initialPoints: input.points,
        remainingPoints: input.points,
        conversionRule: input.conversionRule,
        effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt,
        applicableModelRefs: input.applicableModelRefs,
        reason: input.reason,
        createdAt,
      });
      this.#database
        .prepare(
          `INSERT INTO point_grants
           (grant_id, account_id, source, initial_points, remaining_points,
            conversion_rule_json, effective_at, expires_at, applicable_models_json,
            reason, idempotency_key, request_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          grant.grantId,
          grant.accountId,
          grant.source,
          grant.initialPoints,
          grant.remainingPoints,
          JSON.stringify(grant.conversionRule),
          grant.effectiveAt,
          grant.expiresAt,
          JSON.stringify(grant.applicableModelRefs),
          grant.reason,
          input.idempotencyKey,
          recordHash(input),
          grant.createdAt,
        );
      this.#postTransaction(
        grant.accountId,
        "point_grant",
        grant.grantId,
        `ledger:${input.idempotencyKey}`,
        null,
        [
          this.#entry(`asset:points:${grant.grantId}`, "POINT", grant.initialPoints, 0, createdAt),
          this.#entry("equity:points:platform", "POINT", 0, grant.initialPoints, createdAt),
        ],
      );
      return grant;
    });
  }

  creditCash(
    accountId: string,
    amountMinor: number,
    referenceId: string,
    idempotencyKey: string,
  ): LedgerTransaction {
    return this.#cashMovement(accountId, amountMinor, referenceId, idempotencyKey, "credit");
  }

  debitCash(
    accountId: string,
    amountMinor: number,
    referenceId: string,
    idempotencyKey: string,
  ): LedgerTransaction {
    return this.#cashMovement(accountId, amountMinor, referenceId, idempotencyKey, "debit");
  }

  overview(accountId: string): BillingOverview {
    const now = this.#now();
    const quotaGrants = this.#quotaGrants(accountId);
    const pointGrants = this.#pointGrants(accountId);
    const active = this.#activeReservations(accountId, now);
    const reservedQuota = new Map<string, number>();
    const reservedPoints = new Map<string, number>();
    let reservedCash = 0;
    for (const reservation of active) {
      for (const item of reservation.allocation.quota) {
        reservedQuota.set(item.grantId, (reservedQuota.get(item.grantId) ?? 0) + item.amountMinor);
      }
      for (const item of reservation.allocation.points) {
        reservedPoints.set(item.grantId, (reservedPoints.get(item.grantId) ?? 0) + item.points);
      }
      reservedCash += reservation.allocation.cashMinor;
    }
    const quotaAvailableMinor = quotaGrants.reduce(
      (sum, grant) =>
        sum +
        (this.#grantActive(grant, now)
          ? Math.max(0, grant.remainingMinor - (reservedQuota.get(grant.grantId) ?? 0))
          : 0),
      0,
    );
    const pointAvailableMinor = pointGrants.reduce((sum, grant) => {
      if (!this.#grantActive(grant, now)) return sum;
      const points = Math.max(0, grant.remainingPoints - (reservedPoints.get(grant.grantId) ?? 0));
      return sum + pointValueMinor(points, grant.conversionRule);
    }, 0);
    const postedMinor = this.#cashPosted(accountId);
    const cashAvailable = Math.max(0, postedMinor - reservedCash);
    const activeReservationsMinor = active.reduce(
      (sum, reservation) => sum + reservation.maximumAmountMinor,
      0,
    );
    return billingOverviewSchema.parse({
      accountId,
      currency: "CNY",
      quotaGrants,
      pointGrants,
      cash: {
        accountId,
        currency: "CNY",
        postedMinor,
        reservedMinor: reservedCash,
        availableMinor: cashAvailable,
        updatedAt: now.toISOString(),
      },
      quotaAvailableMinor,
      pointAvailableMinor,
      totalAvailableMinor: quotaAvailableMinor + pointAvailableMinor + cashAvailable,
      activeReservationsMinor,
      asOf: now.toISOString(),
    });
  }

  reserve(quoteInput: PriceQuote, idempotencyKey: string): FundsReservation {
    const quote = priceQuoteSchema.parse(quoteInput);
    return this.#transaction(() => {
      const replay = this.#reservationByDedupe(quote.accountId, idempotencyKey);
      if (replay) {
        if (replay.quoteId !== quote.quoteId) throw new Error("RESERVATION_DEDUPE_KEY_REUSE");
        return replay;
      }
      const now = this.#now();
      if (new Date(quote.expiresAt).getTime() <= now.getTime()) throw new Error("QUOTE_EXPIRED");
      const allocation = this.#allocate(quote, now);
      const reservation = fundsReservationSchema.parse({
        reservationId: this.#idFactory(),
        accountId: quote.accountId,
        quoteId: quote.quoteId,
        modelRef: quote.modelRef,
        maximumAmountMinor: quote.maximumAmountMinor,
        allocation,
        status: "active",
        idempotencyKey,
        createdAt: now.toISOString(),
        expiresAt: quote.expiresAt,
        settledAt: null,
        releasedAt: null,
        releasedMinor: 0,
      });
      this.#database
        .prepare(
          `INSERT INTO reservations
           (reservation_id, account_id, quote_id, quote_json, reservation_json,
            idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reservation.reservationId,
          reservation.accountId,
          reservation.quoteId,
          JSON.stringify(quote),
          JSON.stringify(reservation),
          reservation.idempotencyKey,
          reservation.createdAt,
        );
      return reservation;
    });
  }

  release(accountId: string, reservationId: string): FundsReservation {
    return this.#transaction(() => {
      const reservation = this.#reservation(accountId, reservationId);
      if (reservation.status !== "active") return reservation;
      const now = this.#now().toISOString();
      const released = fundsReservationSchema.parse({
        ...reservation,
        status: "released",
        releasedAt: now,
        releasedMinor: reservation.maximumAmountMinor,
      });
      this.#updateReservation(released);
      return released;
    });
  }

  settle(
    accountId: string,
    reservationId: string,
    usageInput: UsageRecord,
    dedupeKey: string,
  ): ChargeRecord {
    const usage = usageRecordSchema.parse(usageInput);
    if (usage.accountId !== accountId) throw new Error("ACCOUNT_SCOPE_VIOLATION");
    const usageReplay = this.#chargeByUsage(accountId, usage.usageId);
    if (usageReplay) {
      if (usageReplay.reservationId !== reservationId) throw new Error("USAGE_ALREADY_CHARGED");
      return usageReplay;
    }
    const existing = this.#chargeByDedupe(accountId, dedupeKey);
    if (existing) {
      if (existing.usageId !== usage.usageId || existing.reservationId !== reservationId) {
        throw new Error("CHARGE_DEDUPE_KEY_REUSE");
      }
      return existing;
    }
    return this.#transaction(() => {
      const reservation = this.#reservation(accountId, reservationId);
      if (reservation.status !== "active") throw new Error("RESERVATION_NOT_ACTIVE");
      const now = this.#now();
      if (new Date(reservation.expiresAt).getTime() <= now.getTime()) {
        throw new Error("RESERVATION_EXPIRED");
      }
      if (usage.selectedModelRef !== reservation.modelRef) {
        throw new Error("CHARGE_MODEL_MISMATCH");
      }
      const quote = this.#quoteForReservation(accountId, reservationId);
      let grossAmountMinor: number;
      try {
        grossAmountMinor = calculateUsageChargeMinor(quote.snapshot, usage);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "BILLING_USAGE_UNKNOWN";
        if (!reason.startsWith("BILLING_USAGE_UNKNOWN:")) throw error;
        const createdAt = now.toISOString();
        const pending = chargeRecordSchema.parse({
          chargeId: this.#idFactory(),
          accountId,
          usageId: usage.usageId,
          messageId: usage.messageId,
          runId: usage.runId,
          toolCallId: usage.toolCallId,
          reservationId,
          quoteId: quote.quoteId,
          pricingSnapshotId: quote.snapshot.pricingSnapshotId,
          pricingSnapshot: quote.snapshot,
          usage,
          ledgerTransactionId: null,
          selectedModelRef: usage.selectedModelRef,
          effectiveModelRef: usage.effectiveModelRef,
          grossAmountMinor: 0,
          quotaDeductionMinor: 0,
          pointDeductionMinor: 0,
          pointsDeducted: 0,
          cashDeductionMinor: 0,
          finalAmountMinor: 0,
          status: "pending",
          dedupeKey,
          createdAt,
          settledAt: null,
          pendingReason: reason,
          reversedAt: null,
          reversalTransactionId: null,
        });
        this.#insertCharge(pending, { quota: [], points: [], cashMinor: 0 });
        this.#updateReservation(
          fundsReservationSchema.parse({
            ...reservation,
            status: "released",
            releasedAt: createdAt,
            releasedMinor: reservation.maximumAmountMinor,
          }),
        );
        return pending;
      }
      if (grossAmountMinor > reservation.maximumAmountMinor) {
        throw new Error("CHARGE_EXCEEDS_RESERVATION");
      }
      const allocation = this.#consumeAllocation(reservation.allocation, grossAmountMinor);
      const settledAt = now.toISOString();
      const entries = this.#settlementEntries(allocation, settledAt);
      const ledger =
        entries.length === 0
          ? null
          : this.#postTransaction(
              accountId,
              "charge_settlement",
              usage.usageId,
              `ledger:${dedupeKey}`,
              null,
              entries,
            );
      const charge = chargeRecordSchema.parse({
        chargeId: this.#idFactory(),
        accountId,
        usageId: usage.usageId,
        messageId: usage.messageId,
        runId: usage.runId,
        toolCallId: usage.toolCallId,
        reservationId,
        quoteId: quote.quoteId,
        pricingSnapshotId: quote.snapshot.pricingSnapshotId,
        pricingSnapshot: quote.snapshot,
        usage,
        ledgerTransactionId: ledger?.transactionId ?? null,
        selectedModelRef: usage.selectedModelRef,
        effectiveModelRef: usage.effectiveModelRef,
        grossAmountMinor,
        quotaDeductionMinor: allocation.quota.reduce((sum, item) => sum + item.amountMinor, 0),
        pointDeductionMinor: allocation.points.reduce((sum, item) => sum + item.valueMinor, 0),
        pointsDeducted: allocation.points.reduce((sum, item) => sum + item.points, 0),
        cashDeductionMinor: allocation.cashMinor,
        finalAmountMinor: grossAmountMinor,
        status: "settled",
        dedupeKey,
        createdAt: settledAt,
        settledAt,
        pendingReason: null,
        reversedAt: null,
        reversalTransactionId: null,
      });
      this.#insertCharge(charge, allocation);
      const settledReservation = fundsReservationSchema.parse({
        ...reservation,
        status: "settled",
        settledAt,
        releasedMinor: reservation.maximumAmountMinor - grossAmountMinor,
      });
      this.#updateReservation(settledReservation);
      return charge;
    });
  }

  reverseCharge(accountId: string, chargeId: string, idempotencyKey: string): ChargeRecord {
    return this.#transaction(() => {
      const charge = this.#charge(accountId, chargeId);
      if (charge.status === "reversed") return charge;
      if (charge.status !== "settled") throw new Error("CHARGE_NOT_REVERSIBLE");
      const row = this.#database
        .prepare("SELECT allocation_json FROM charges WHERE account_id = ? AND charge_id = ?")
        .get(accountId, chargeId) as SqlRow;
      const allocation = JSON.parse(String(row.allocation_json)) as ChargeAllocation;
      this.#restoreAllocation(allocation);
      const now = this.#now().toISOString();
      let reversal: LedgerTransaction | null = null;
      if (charge.ledgerTransactionId) {
        const original = this.#ledgerTransaction(accountId, charge.ledgerTransactionId);
        reversal = this.#postTransaction(
          accountId,
          "charge_reversal",
          chargeId,
          idempotencyKey,
          original.transactionId,
          original.entries.map((entry) =>
            this.#entry(entry.ledgerAccount, entry.unit, entry.credit, entry.debit, now),
          ),
        );
      }
      const reversed = chargeRecordSchema.parse({
        ...charge,
        status: "reversed",
        reversedAt: now,
        reversalTransactionId: reversal?.transactionId ?? null,
      });
      this.#database
        .prepare("UPDATE charges SET charge_json = ? WHERE account_id = ? AND charge_id = ?")
        .run(JSON.stringify(reversed), accountId, chargeId);
      return reversed;
    });
  }

  listCharges(accountId: string): ChargeRecord[] {
    return (
      this.#database
        .prepare(
          "SELECT charge_json FROM charges WHERE account_id = ? ORDER BY created_at, charge_id",
        )
        .all(accountId) as SqlRow[]
    ).map((row) => chargeRecordSchema.parse(JSON.parse(String(row.charge_json))));
  }

  listLedger(accountId: string): LedgerTransaction[] {
    return (
      this.#database
        .prepare(
          "SELECT transaction_json FROM ledger_transactions WHERE account_id = ? ORDER BY created_at, transaction_id",
        )
        .all(accountId) as SqlRow[]
    ).map((row) => ledgerTransactionSchema.parse(JSON.parse(String(row.transaction_json))));
  }

  exportStatement(accountId: string, month: string): BillingStatementExport {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("STATEMENT_MONTH_INVALID");
    const existing = this.#database
      .prepare(
        "SELECT statement_export_json FROM billing_statements WHERE account_id = ? AND month = ?",
      )
      .get(accountId, month) as SqlRow | undefined;
    if (existing) {
      return billingStatementExportSchema.parse(JSON.parse(String(existing.statement_export_json)));
    }
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    if (end.getTime() > this.#now().getTime()) throw new Error("STATEMENT_PERIOD_OPEN");
    const transactions = this.listLedger(accountId);
    const inMonth = transactions.filter(({ createdAt }) => {
      const timestamp = new Date(createdAt).getTime();
      return timestamp >= start.getTime() && timestamp < end.getTime();
    });
    const cashDelta = (rows: LedgerTransaction[]): number =>
      rows
        .flatMap(({ entries }) => entries)
        .filter(({ ledgerAccount }) => ledgerAccount === "asset:cash")
        .reduce((sum, entry) => sum + entry.debit - entry.credit, 0);
    const openingMinor = cashDelta(
      transactions.filter(({ createdAt }) => new Date(createdAt).getTime() < start.getTime()),
    );
    const creditsMinor = inMonth
      .filter(({ type }) => type === "cash_credit")
      .reduce((sum, transaction) => sum + Math.max(0, cashDelta([transaction])), 0);
    const refundsMinor = inMonth
      .filter(({ type }) => type === "cash_debit")
      .reduce((sum, transaction) => sum + Math.max(0, -cashDelta([transaction])), 0);
    const allCharges = this.listCharges(accountId);
    const charges = allCharges.filter(({ settledAt }) => {
      if (!settledAt) return false;
      const timestamp = new Date(settledAt).getTime();
      return timestamp >= start.getTime() && timestamp < end.getTime();
    });
    const chargesMinor = charges.reduce((sum, charge) => sum + charge.finalAmountMinor, 0);
    const reversalsMinor = allCharges
      .filter(({ reversedAt }) => {
        if (!reversedAt) return false;
        const timestamp = new Date(reversedAt).getTime();
        return timestamp >= start.getTime() && timestamp < end.getTime();
      })
      .reduce((sum, charge) => sum + charge.finalAmountMinor, 0);
    const closingMinor = openingMinor + cashDelta(inMonth);
    const generatedAt = this.#now().toISOString();
    const statement = {
      statementId: this.#idFactory(),
      accountId,
      month,
      currency: "CNY" as const,
      openingMinor,
      chargesMinor,
      creditsMinor,
      refundsMinor,
      reversalsMinor,
      adjustmentsMinor: 0,
      closingMinor,
      generatedAt,
    };
    const csvRows = [
      "transaction_id,type,reference_id,unit,debit,credit,created_at",
      ...inMonth.flatMap((transaction) =>
        transaction.entries.map((entry) =>
          [
            transaction.transactionId,
            transaction.type,
            transaction.referenceId,
            entry.unit,
            entry.debit,
            entry.credit,
            entry.createdAt,
          ].join(","),
        ),
      ),
    ];
    const pdf = minimalPdf([
      "OpenERX Billing Statement",
      `Month: ${month}`,
      `Account: ${accountId}`,
      `Opening CNY minor: ${openingMinor}`,
      `Charges CNY minor: ${chargesMinor}`,
      `Credits CNY minor: ${creditsMinor}`,
      `Refunds CNY minor: ${refundsMinor}`,
      `Reversals CNY minor: ${reversalsMinor}`,
      "Adjustments CNY minor: 0",
      `Closing CNY minor: ${closingMinor}`,
    ]);
    const exported = billingStatementExportSchema.parse({
      statement,
      csv: `${csvRows.join("\n")}\n`,
      pdfBase64: pdf.toString("base64"),
    });
    this.#database
      .prepare(
        `INSERT INTO billing_statements
         (statement_id, account_id, month, statement_export_json, generated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        statement.statementId,
        accountId,
        month,
        JSON.stringify(exported),
        statement.generatedAt,
      );
    return exported;
  }

  assertBalanced(accountId: string): void {
    for (const transaction of this.listLedger(accountId)) {
      const units = new Set(transaction.entries.map(({ unit }) => unit));
      for (const unit of units) {
        const entries = transaction.entries.filter((entry) => entry.unit === unit);
        const debit = entries.reduce((sum, entry) => sum + entry.debit, 0);
        const credit = entries.reduce((sum, entry) => sum + entry.credit, 0);
        if (debit !== credit) throw new Error(`LEDGER_UNBALANCED:${transaction.transactionId}`);
      }
    }
  }

  rebuildCashBalance(accountId: string): number {
    return this.listLedger(accountId)
      .flatMap(({ entries }) => entries)
      .filter(({ ledgerAccount }) => ledgerAccount === "asset:cash")
      .reduce((sum, entry) => sum + entry.debit - entry.credit, 0);
  }

  rebuildAssetProjections(accountId: string): BillingOverview {
    return this.#transaction(() => {
      for (const grant of this.#quotaGrants(accountId)) {
        const remaining = this.#ledgerAccountBalance(
          accountId,
          `asset:quota:${grant.grantId}`,
          "CNY_MINOR",
        );
        this.#database
          .prepare("UPDATE quota_grants SET remaining_minor = ? WHERE grant_id = ?")
          .run(remaining, grant.grantId);
      }
      for (const grant of this.#pointGrants(accountId)) {
        const remaining = this.#ledgerAccountBalance(
          accountId,
          `asset:points:${grant.grantId}`,
          "POINT",
        );
        this.#database
          .prepare("UPDATE point_grants SET remaining_points = ? WHERE grant_id = ?")
          .run(remaining, grant.grantId);
      }
      return this.overview(accountId);
    });
  }

  #cashMovement(
    accountId: string,
    amountMinor: number,
    referenceId: string,
    idempotencyKey: string,
    direction: "credit" | "debit",
  ): LedgerTransaction {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("AMOUNT_INVALID");
    const existing = this.#transactionByDedupe(accountId, idempotencyKey);
    const request = { accountId, amountMinor, referenceId, idempotencyKey, direction };
    if (existing) {
      if (this.#transactionHash(existing.transactionId) !== recordHash(request)) {
        throw new Error("LEDGER_DEDUPE_KEY_REUSE");
      }
      return existing;
    }
    return this.#transaction(() => {
      if (direction === "debit" && this.#cashPosted(accountId) < amountMinor) {
        throw new Error("CASH_BALANCE_INSUFFICIENT");
      }
      const now = this.#now().toISOString();
      const transaction = this.#postTransaction(
        accountId,
        direction === "credit" ? "cash_credit" : "cash_debit",
        referenceId,
        idempotencyKey,
        null,
        direction === "credit"
          ? [
              this.#entry("asset:cash", "CNY_MINOR", amountMinor, 0, now),
              this.#entry("liability:cash:platform", "CNY_MINOR", 0, amountMinor, now),
            ]
          : [
              this.#entry("liability:cash:platform", "CNY_MINOR", amountMinor, 0, now),
              this.#entry("asset:cash", "CNY_MINOR", 0, amountMinor, now),
            ],
        recordHash(request),
      );
      return transaction;
    });
  }

  #allocate(quote: PriceQuote, now: Date): ReservationAllocation {
    let remaining = quote.maximumAmountMinor;
    const allocation: ReservationAllocation = { quota: [], points: [], cashMinor: 0 };
    const active = this.#activeReservations(quote.accountId, now);
    const reservedQuota = new Map<string, number>();
    const reservedPoints = new Map<string, number>();
    let reservedCash = 0;
    for (const reservation of active) {
      for (const item of reservation.allocation.quota) {
        reservedQuota.set(item.grantId, (reservedQuota.get(item.grantId) ?? 0) + item.amountMinor);
      }
      for (const item of reservation.allocation.points) {
        reservedPoints.set(item.grantId, (reservedPoints.get(item.grantId) ?? 0) + item.points);
      }
      reservedCash += reservation.allocation.cashMinor;
    }
    for (const grant of sortExpiry(this.#quotaGrants(quote.accountId))) {
      if (remaining === 0) break;
      if (
        !this.#grantActive(grant, now) ||
        !applicable(grant.applicableModelRefs, quote.modelRef)
      ) {
        continue;
      }
      const available = Math.max(0, grant.remainingMinor - (reservedQuota.get(grant.grantId) ?? 0));
      const amountMinor = Math.min(remaining, available);
      if (amountMinor > 0) allocation.quota.push({ grantId: grant.grantId, amountMinor });
      remaining -= amountMinor;
    }
    for (const grant of sortExpiry(this.#pointGrants(quote.accountId))) {
      if (remaining === 0) break;
      if (
        !this.#grantActive(grant, now) ||
        !applicable(grant.applicableModelRefs, quote.modelRef)
      ) {
        continue;
      }
      const availablePoints = Math.max(
        0,
        grant.remainingPoints - (reservedPoints.get(grant.grantId) ?? 0),
      );
      const points = Math.min(
        availablePoints,
        pointsNeededForMinor(remaining, grant.conversionRule),
      );
      const valueMinor = Math.min(remaining, pointValueMinor(points, grant.conversionRule));
      if (points > 0 && valueMinor > 0) {
        allocation.points.push({ grantId: grant.grantId, points, valueMinor });
      }
      remaining -= valueMinor;
    }
    const cashAvailable = Math.max(0, this.#cashPosted(quote.accountId) - reservedCash);
    allocation.cashMinor = Math.min(remaining, cashAvailable);
    remaining -= allocation.cashMinor;
    if (remaining > 0) throw new Error("BILLING_INSUFFICIENT_FUNDS");
    return reservationAllocationSchema.parse(allocation);
  }

  #consumeAllocation(allocation: ReservationAllocation, gross: number): ChargeAllocation {
    let remaining = gross;
    const consumed: ChargeAllocation = { quota: [], points: [], cashMinor: 0 };
    for (const item of allocation.quota) {
      const amountMinor = Math.min(remaining, item.amountMinor);
      if (amountMinor > 0) {
        this.#database
          .prepare(
            `UPDATE quota_grants SET remaining_minor = remaining_minor - ?
             WHERE grant_id = ? AND remaining_minor >= ?`,
          )
          .run(amountMinor, item.grantId, amountMinor);
        consumed.quota.push({ grantId: item.grantId, amountMinor });
      }
      remaining -= amountMinor;
    }
    for (const item of allocation.points) {
      if (remaining === 0) break;
      const grant = this.#pointGrantById(item.grantId);
      const points = Math.min(item.points, pointsNeededForMinor(remaining, grant.conversionRule));
      const valueMinor = Math.min(remaining, pointValueMinor(points, grant.conversionRule));
      this.#database
        .prepare(
          `UPDATE point_grants SET remaining_points = remaining_points - ?
           WHERE grant_id = ? AND remaining_points >= ?`,
        )
        .run(points, item.grantId, points);
      consumed.points.push({ grantId: item.grantId, points, valueMinor });
      remaining -= valueMinor;
    }
    consumed.cashMinor = Math.min(remaining, allocation.cashMinor);
    remaining -= consumed.cashMinor;
    if (remaining !== 0) throw new Error("RESERVATION_ALLOCATION_INVALID");
    return consumed;
  }

  #restoreAllocation(allocation: ChargeAllocation): void {
    for (const item of allocation.quota) {
      this.#database
        .prepare("UPDATE quota_grants SET remaining_minor = remaining_minor + ? WHERE grant_id = ?")
        .run(item.amountMinor, item.grantId);
    }
    for (const item of allocation.points) {
      this.#database
        .prepare(
          "UPDATE point_grants SET remaining_points = remaining_points + ? WHERE grant_id = ?",
        )
        .run(item.points, item.grantId);
    }
  }

  #settlementEntries(allocation: ChargeAllocation, createdAt: string): LedgerEntry[] {
    const entries: LedgerEntry[] = [];
    for (const item of allocation.quota) {
      entries.push(this.#entry("expense:model", "CNY_MINOR", item.amountMinor, 0, createdAt));
      entries.push(
        this.#entry(`asset:quota:${item.grantId}`, "CNY_MINOR", 0, item.amountMinor, createdAt),
      );
    }
    if (allocation.cashMinor > 0) {
      entries.push(this.#entry("expense:model", "CNY_MINOR", allocation.cashMinor, 0, createdAt));
      entries.push(this.#entry("asset:cash", "CNY_MINOR", 0, allocation.cashMinor, createdAt));
    }
    for (const item of allocation.points) {
      entries.push(this.#entry("expense:model:points", "POINT", item.points, 0, createdAt));
      entries.push(this.#entry(`asset:points:${item.grantId}`, "POINT", 0, item.points, createdAt));
    }
    return entries;
  }

  #entry(
    ledgerAccount: string,
    unit: "CNY_MINOR" | "POINT",
    debit: number,
    credit: number,
    createdAt: string,
  ): LedgerEntry {
    return {
      entryId: this.#idFactory(),
      transactionId: this.#idFactory(),
      accountId: this.#idFactory(),
      ledgerAccount,
      unit,
      debit,
      credit,
      createdAt,
    };
  }

  #postTransaction(
    accountId: string,
    type: LedgerTransaction["type"],
    referenceId: string,
    dedupeKey: string,
    reversalOf: string | null,
    entryInputs: LedgerEntry[],
    requestHash = recordHash({ accountId, type, referenceId, dedupeKey, reversalOf, entryInputs }),
  ): LedgerTransaction {
    const existing = this.#transactionByDedupe(accountId, dedupeKey);
    if (existing) {
      if (this.#transactionHash(existing.transactionId) !== requestHash) {
        throw new Error("LEDGER_DEDUPE_KEY_REUSE");
      }
      return existing;
    }
    const transactionId = this.#idFactory();
    const createdAt = this.#now().toISOString();
    const entries = entryInputs.map((entry) => ({
      ...entry,
      entryId: this.#idFactory(),
      transactionId,
      accountId,
      createdAt,
    }));
    const transaction = ledgerTransactionSchema.parse({
      transactionId,
      accountId,
      type,
      referenceId,
      dedupeKey,
      reversalOf,
      createdAt,
      entries,
    });
    const units = new Set(entries.map(({ unit }) => unit));
    for (const unit of units) {
      const inUnit = entries.filter((entry) => entry.unit === unit);
      if (
        inUnit.reduce((sum, entry) => sum + entry.debit, 0) !==
        inUnit.reduce((sum, entry) => sum + entry.credit, 0)
      ) {
        throw new Error("LEDGER_TRANSACTION_UNBALANCED");
      }
    }
    this.#database
      .prepare(
        `INSERT INTO ledger_transactions
         (transaction_id, account_id, type, reference_id, dedupe_key, reversal_of,
          request_hash, transaction_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        transaction.transactionId,
        transaction.accountId,
        transaction.type,
        transaction.referenceId,
        transaction.dedupeKey,
        transaction.reversalOf,
        requestHash,
        JSON.stringify(transaction),
        transaction.createdAt,
      );
    for (const entry of transaction.entries) {
      this.#database
        .prepare(
          `INSERT INTO ledger_entries
           (entry_id, transaction_id, account_id, ledger_account, unit, debit, credit, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.entryId,
          entry.transactionId,
          entry.accountId,
          entry.ledgerAccount,
          entry.unit,
          entry.debit,
          entry.credit,
          entry.createdAt,
        );
    }
    return transaction;
  }

  #transactionByDedupe(accountId: string, dedupeKey: string): LedgerTransaction | null {
    const row = this.#database
      .prepare(
        "SELECT transaction_json FROM ledger_transactions WHERE account_id = ? AND dedupe_key = ?",
      )
      .get(accountId, dedupeKey) as SqlRow | undefined;
    return row ? ledgerTransactionSchema.parse(JSON.parse(String(row.transaction_json))) : null;
  }

  #transactionHash(transactionId: string): string {
    const row = this.#database
      .prepare("SELECT request_hash FROM ledger_transactions WHERE transaction_id = ?")
      .get(transactionId) as SqlRow;
    return String(row.request_hash);
  }

  #ledgerTransaction(accountId: string, transactionId: string): LedgerTransaction {
    const row = this.#database
      .prepare(
        "SELECT transaction_json FROM ledger_transactions WHERE account_id = ? AND transaction_id = ?",
      )
      .get(accountId, transactionId) as SqlRow | undefined;
    if (!row) throw new Error("LEDGER_TRANSACTION_NOT_FOUND");
    return ledgerTransactionSchema.parse(JSON.parse(String(row.transaction_json)));
  }

  #quotaByDedupe(
    accountId: string,
    dedupeKey: string,
  ): { grant: QuotaGrant; requestHash: string } | null {
    const row = this.#database
      .prepare("SELECT * FROM quota_grants WHERE account_id = ? AND idempotency_key = ?")
      .get(accountId, dedupeKey) as SqlRow | undefined;
    return row ? { grant: this.#quotaGrant(row), requestHash: String(row.request_hash) } : null;
  }

  #pointByDedupe(
    accountId: string,
    dedupeKey: string,
  ): { grant: PointGrant; requestHash: string } | null {
    const row = this.#database
      .prepare("SELECT * FROM point_grants WHERE account_id = ? AND idempotency_key = ?")
      .get(accountId, dedupeKey) as SqlRow | undefined;
    return row ? { grant: this.#pointGrant(row), requestHash: String(row.request_hash) } : null;
  }

  #quotaGrants(accountId: string): QuotaGrant[] {
    return (
      this.#database
        .prepare("SELECT * FROM quota_grants WHERE account_id = ? ORDER BY created_at, grant_id")
        .all(accountId) as SqlRow[]
    ).map((row) => this.#quotaGrant(row));
  }

  #pointGrants(accountId: string): PointGrant[] {
    return (
      this.#database
        .prepare("SELECT * FROM point_grants WHERE account_id = ? ORDER BY created_at, grant_id")
        .all(accountId) as SqlRow[]
    ).map((row) => this.#pointGrant(row));
  }

  #quotaGrant(row: SqlRow): QuotaGrant {
    return quotaGrantSchema.parse({
      grantId: row.grant_id,
      accountId: row.account_id,
      source: row.source,
      initialMinor: row.initial_minor,
      remainingMinor: row.remaining_minor,
      effectiveAt: row.effective_at,
      expiresAt: row.expires_at,
      applicableModelRefs: JSON.parse(String(row.applicable_models_json)),
      reason: row.reason,
      createdAt: row.created_at,
    });
  }

  #pointGrant(row: SqlRow): PointGrant {
    return pointGrantSchema.parse({
      grantId: row.grant_id,
      accountId: row.account_id,
      source: row.source,
      initialPoints: row.initial_points,
      remainingPoints: row.remaining_points,
      conversionRule: JSON.parse(String(row.conversion_rule_json)),
      effectiveAt: row.effective_at,
      expiresAt: row.expires_at,
      applicableModelRefs: JSON.parse(String(row.applicable_models_json)),
      reason: row.reason,
      createdAt: row.created_at,
    });
  }

  #pointGrantById(grantId: string): PointGrant {
    const row = this.#database
      .prepare("SELECT * FROM point_grants WHERE grant_id = ?")
      .get(grantId) as SqlRow | undefined;
    if (!row) throw new Error("POINT_GRANT_NOT_FOUND");
    return this.#pointGrant(row);
  }

  #grantActive(grant: { effectiveAt: string; expiresAt: string | null }, now: Date): boolean {
    return (
      new Date(grant.effectiveAt).getTime() <= now.getTime() &&
      (grant.expiresAt === null || new Date(grant.expiresAt).getTime() > now.getTime())
    );
  }

  #cashPosted(accountId: string): number {
    const row = this.#database
      .prepare(
        `SELECT COALESCE(SUM(debit - credit), 0) AS balance
         FROM ledger_entries WHERE account_id = ? AND ledger_account = 'asset:cash'`,
      )
      .get(accountId) as SqlRow;
    return Number(row.balance);
  }

  #ledgerAccountBalance(
    accountId: string,
    ledgerAccount: string,
    unit: "CNY_MINOR" | "POINT",
  ): number {
    const row = this.#database
      .prepare(
        `SELECT COALESCE(SUM(debit - credit), 0) AS balance
         FROM ledger_entries
         WHERE account_id = ? AND ledger_account = ? AND unit = ?`,
      )
      .get(accountId, ledgerAccount, unit) as SqlRow;
    const balance = Number(row.balance);
    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw new Error(`LEDGER_PROJECTION_INVALID:${ledgerAccount}`);
    }
    return balance;
  }

  #activeReservations(accountId: string, now: Date): FundsReservation[] {
    return (
      this.#database
        .prepare("SELECT reservation_json FROM reservations WHERE account_id = ?")
        .all(accountId) as SqlRow[]
    )
      .map((row) => fundsReservationSchema.parse(JSON.parse(String(row.reservation_json))))
      .filter(
        ({ status, expiresAt }) =>
          status === "active" && new Date(expiresAt).getTime() > now.getTime(),
      );
  }

  #reservationByDedupe(accountId: string, idempotencyKey: string): FundsReservation | null {
    const row = this.#database
      .prepare(
        "SELECT reservation_json FROM reservations WHERE account_id = ? AND idempotency_key = ?",
      )
      .get(accountId, idempotencyKey) as SqlRow | undefined;
    return row ? fundsReservationSchema.parse(JSON.parse(String(row.reservation_json))) : null;
  }

  #reservation(accountId: string, reservationId: string): FundsReservation {
    const row = this.#database
      .prepare(
        "SELECT reservation_json FROM reservations WHERE account_id = ? AND reservation_id = ?",
      )
      .get(accountId, reservationId) as SqlRow | undefined;
    if (!row) throw new Error("RESERVATION_NOT_FOUND");
    return fundsReservationSchema.parse(JSON.parse(String(row.reservation_json)));
  }

  #quoteForReservation(accountId: string, reservationId: string): PriceQuote {
    const row = this.#database
      .prepare("SELECT quote_json FROM reservations WHERE account_id = ? AND reservation_id = ?")
      .get(accountId, reservationId) as SqlRow | undefined;
    if (!row) throw new Error("RESERVATION_NOT_FOUND");
    return priceQuoteSchema.parse(JSON.parse(String(row.quote_json)));
  }

  #updateReservation(reservation: FundsReservation): void {
    this.#database
      .prepare(
        "UPDATE reservations SET reservation_json = ? WHERE account_id = ? AND reservation_id = ?",
      )
      .run(JSON.stringify(reservation), reservation.accountId, reservation.reservationId);
  }

  #chargeByDedupe(accountId: string, dedupeKey: string): ChargeRecord | null {
    const row = this.#database
      .prepare("SELECT charge_json FROM charges WHERE account_id = ? AND dedupe_key = ?")
      .get(accountId, dedupeKey) as SqlRow | undefined;
    return row ? chargeRecordSchema.parse(JSON.parse(String(row.charge_json))) : null;
  }

  #insertCharge(charge: ChargeRecord, allocation: ChargeAllocation): void {
    this.#database
      .prepare(
        `INSERT INTO charges
         (charge_id, account_id, usage_id, reservation_id, dedupe_key,
          charge_json, allocation_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        charge.chargeId,
        charge.accountId,
        charge.usageId,
        charge.reservationId,
        charge.dedupeKey,
        JSON.stringify(charge),
        JSON.stringify(allocation),
        charge.createdAt,
      );
  }

  #chargeByUsage(accountId: string, usageId: string): ChargeRecord | null {
    const row = this.#database
      .prepare("SELECT charge_json FROM charges WHERE account_id = ? AND usage_id = ?")
      .get(accountId, usageId) as SqlRow | undefined;
    return row ? chargeRecordSchema.parse(JSON.parse(String(row.charge_json))) : null;
  }

  #charge(accountId: string, chargeId: string): ChargeRecord {
    const row = this.#database
      .prepare("SELECT charge_json FROM charges WHERE account_id = ? AND charge_id = ?")
      .get(accountId, chargeId) as SqlRow | undefined;
    if (!row) throw new Error("CHARGE_NOT_FOUND");
    return chargeRecordSchema.parse(JSON.parse(String(row.charge_json)));
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #migrate(): void {
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS quota_grants (
        grant_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        source TEXT NOT NULL,
        initial_minor INTEGER NOT NULL CHECK(initial_minor >= 0),
        remaining_minor INTEGER NOT NULL CHECK(remaining_minor >= 0),
        effective_at TEXT NOT NULL,
        expires_at TEXT,
        applicable_models_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(account_id, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS point_grants (
        grant_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        source TEXT NOT NULL,
        initial_points INTEGER NOT NULL CHECK(initial_points >= 0),
        remaining_points INTEGER NOT NULL CHECK(remaining_points >= 0),
        conversion_rule_json TEXT NOT NULL,
        effective_at TEXT NOT NULL,
        expires_at TEXT,
        applicable_models_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(account_id, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS reservations (
        reservation_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        quote_id TEXT NOT NULL,
        quote_json TEXT NOT NULL,
        reservation_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(account_id, quote_id),
        UNIQUE(account_id, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS charges (
        charge_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        usage_id TEXT NOT NULL,
        reservation_id TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        charge_json TEXT NOT NULL,
        allocation_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(account_id, usage_id),
        UNIQUE(account_id, dedupe_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ledger_transactions (
        transaction_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        type TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        reversal_of TEXT,
        request_hash TEXT NOT NULL,
        transaction_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(account_id, dedupe_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ledger_entries (
        entry_id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES ledger_transactions(transaction_id),
        account_id TEXT NOT NULL,
        ledger_account TEXT NOT NULL,
        unit TEXT NOT NULL CHECK(unit IN ('CNY_MINOR', 'POINT')),
        debit INTEGER NOT NULL CHECK(debit >= 0),
        credit INTEGER NOT NULL CHECK(credit >= 0),
        created_at TEXT NOT NULL,
        CHECK((debit = 0 AND credit > 0) OR (credit = 0 AND debit > 0))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS ledger_account_idx
        ON ledger_entries(account_id, ledger_account, created_at);
      CREATE TABLE IF NOT EXISTS billing_statements (
        statement_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        month TEXT NOT NULL,
        statement_export_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        UNIQUE(account_id, month)
      ) STRICT;
    `);
  }
}
