import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type BillingTerms,
  type BillingTermsAcceptance,
  billingTermsAcceptanceSchema,
  billingTermsSchema,
  createPriceQuoteInputSchema,
  type PriceCatalogEntry,
  type PriceQuote,
  type PricingSnapshot,
  priceCatalogEntrySchema,
  priceQuoteSchema,
  pricingSnapshotSchema,
  type UsageEstimate,
} from "@openerx/contracts";
import { calculateEstimatedChargeMinor } from "@openerx/domain";

type SqlRow = Record<string, unknown>;

export interface PricingServiceOptions {
  catalog: PriceCatalogEntry[];
  terms: BillingTerms;
  now?: () => Date;
  idFactory?: () => string;
  quoteTtlMs?: number;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function estimateWithinMaximum(estimate: UsageEstimate, maximum: UsageEstimate): boolean {
  return (
    estimate.inputTokens <= maximum.inputTokens &&
    estimate.cachedInputTokens <= maximum.cachedInputTokens &&
    estimate.outputTokens <= maximum.outputTokens &&
    estimate.reasoningTokens <= maximum.reasoningTokens
  );
}

export class PricingService {
  readonly #database: DatabaseSync;
  readonly #catalog: PriceCatalogEntry[];
  readonly #terms: BillingTerms;
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  readonly #quoteTtlMs: number;

  constructor(databasePath: string, options: PricingServiceOptions) {
    this.#database = new DatabaseSync(databasePath);
    this.#catalog = options.catalog.map((entry) => priceCatalogEntrySchema.parse(entry));
    this.#terms = billingTermsSchema.parse(options.terms);
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#quoteTtlMs = options.quoteTtlMs ?? 5 * 60_000;
    if (this.#catalog.some(({ termsVersion }) => termsVersion !== this.#terms.version)) {
      throw new Error("PRICE_TERMS_VERSION_MISMATCH");
    }
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  terms(): BillingTerms {
    return structuredClone(this.#terms);
  }

  catalog(at: Date = this.#now()): PriceCatalogEntry[] {
    const timestamp = at.getTime();
    return this.#catalog
      .filter(
        ({ effectiveFrom, effectiveUntil }) =>
          new Date(effectiveFrom).getTime() <= timestamp &&
          (effectiveUntil === null || new Date(effectiveUntil).getTime() > timestamp),
      )
      .map((entry) => structuredClone(entry));
  }

  acceptTerms(accountId: string, version: string): BillingTermsAcceptance {
    if (version !== this.#terms.version) throw new Error("BILLING_TERMS_VERSION_INVALID");
    const existing = this.#database
      .prepare(
        "SELECT accepted_at FROM billing_terms_acceptances WHERE account_id = ? AND terms_version = ?",
      )
      .get(accountId, version) as SqlRow | undefined;
    const acceptedAt = existing ? String(existing.accepted_at) : this.#now().toISOString();
    if (!existing) {
      this.#database
        .prepare(
          `INSERT INTO billing_terms_acceptances(account_id, terms_version, accepted_at)
           VALUES (?, ?, ?)`,
        )
        .run(accountId, version, acceptedAt);
    }
    return billingTermsAcceptanceSchema.parse({ accountId, termsVersion: version, acceptedAt });
  }

  termsAcceptance(accountId: string, version = this.#terms.version): BillingTermsAcceptance | null {
    const row = this.#database
      .prepare(
        "SELECT accepted_at FROM billing_terms_acceptances WHERE account_id = ? AND terms_version = ?",
      )
      .get(accountId, version) as SqlRow | undefined;
    return row
      ? billingTermsAcceptanceSchema.parse({
          accountId,
          termsVersion: version,
          acceptedAt: row.accepted_at,
        })
      : null;
  }

  createQuote(accountId: string, input: unknown): PriceQuote {
    const request = createPriceQuoteInputSchema.parse(input);
    const requestHash = hash(request);
    const replay = this.#database
      .prepare(
        `SELECT request_hash, quote_json FROM price_quotes
         WHERE account_id = ? AND idempotency_key = ?`,
      )
      .get(accountId, request.idempotencyKey) as SqlRow | undefined;
    if (replay) {
      if (replay.request_hash !== requestHash) throw new Error("QUOTE_IDEMPOTENCY_KEY_REUSE");
      return priceQuoteSchema.parse(JSON.parse(String(replay.quote_json)));
    }
    const accepted = this.#database
      .prepare(
        `SELECT 1 FROM billing_terms_acceptances
         WHERE account_id = ? AND terms_version = ?`,
      )
      .get(accountId, this.#terms.version);
    if (!accepted) throw new Error("BILLING_TERMS_NOT_ACCEPTED");
    if (!estimateWithinMaximum(request.estimatedUsage, request.maximumUsage)) {
      throw new Error("QUOTE_ESTIMATE_EXCEEDS_MAXIMUM");
    }
    const now = this.#now();
    const price = this.catalog(now).find(({ modelRef }) => modelRef === request.modelRef);
    if (!price) throw new Error("PRICE_NOT_FOUND");
    const snapshot: PricingSnapshot = pricingSnapshotSchema.parse({
      ...price,
      pricingSnapshotId: this.#idFactory(),
      frozenAt: now.toISOString(),
    });
    const estimatedAmountMinor = calculateEstimatedChargeMinor(snapshot, request.estimatedUsage);
    const maximumAmountMinor = calculateEstimatedChargeMinor(snapshot, request.maximumUsage);
    if (maximumAmountMinor > request.userLimitMinor) throw new Error("QUOTE_EXCEEDS_USER_LIMIT");
    const catalogExpiry = price.effectiveUntil
      ? new Date(price.effectiveUntil).getTime()
      : Number.POSITIVE_INFINITY;
    const expiresAt = new Date(Math.min(now.getTime() + this.#quoteTtlMs, catalogExpiry));
    if (expiresAt.getTime() <= now.getTime()) throw new Error("PRICE_EXPIRED");
    const quote = priceQuoteSchema.parse({
      quoteId: this.#idFactory(),
      accountId,
      modelRef: request.modelRef,
      currency: price.currency,
      estimatedAmountMinor,
      maximumAmountMinor,
      userLimitMinor: request.userLimitMinor,
      termsVersion: price.termsVersion,
      snapshot,
      idempotencyKey: request.idempotencyKey,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    this.#database
      .prepare(
        `INSERT INTO price_quotes
         (quote_id, account_id, idempotency_key, request_hash, quote_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        quote.quoteId,
        accountId,
        quote.idempotencyKey,
        requestHash,
        JSON.stringify(quote),
        quote.createdAt,
      );
    return quote;
  }

  getQuote(accountId: string, quoteId: string): PriceQuote {
    const row = this.#database
      .prepare("SELECT quote_json FROM price_quotes WHERE account_id = ? AND quote_id = ?")
      .get(accountId, quoteId) as SqlRow | undefined;
    if (!row) throw new Error("QUOTE_NOT_FOUND");
    return priceQuoteSchema.parse(JSON.parse(String(row.quote_json)));
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS billing_terms_acceptances (
        account_id TEXT NOT NULL,
        terms_version TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        PRIMARY KEY(account_id, terms_version)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS price_quotes (
        quote_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        quote_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(account_id, idempotency_key)
      ) STRICT;
    `);
  }
}
