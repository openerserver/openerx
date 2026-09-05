import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  createRechargeOrderInputSchema,
  type LedgerTransaction,
  type PaymentCallback,
  paymentCallbackSchema,
  type RechargeOrder,
  type ReconciliationDiscrepancy,
  type RefundOrder,
  rechargeOrderSchema,
  reconciliationDiscrepancySchema,
  refundOrderSchema,
} from "@openerx/contracts";

type SqlRow = Record<string, unknown>;

export interface CashLedgerPort {
  creditCash(
    accountId: string,
    amountMinor: number,
    referenceId: string,
    idempotencyKey: string,
  ): LedgerTransaction;
  debitCash(
    accountId: string,
    amountMinor: number,
    referenceId: string,
    idempotencyKey: string,
  ): LedgerTransaction;
}

export interface ProviderSettlementRow {
  provider: "alipay" | "wechat";
  orderId: string;
  amountMinor: number;
  status: "succeeded" | "failed";
}

export interface PaymentAdapterOptions {
  ledger: CashLedgerPort;
  secrets: Record<"alipay" | "wechat", string>;
  now?: () => Date;
  idFactory?: () => string;
  callbackToleranceMs?: number;
  orderTtlMs?: number;
  minimumRechargeMinor?: number;
  maximumRechargeMinor?: number;
}

type UnsignedCallback = Omit<PaymentCallback, "signature">;

function canonicalCallback(input: UnsignedCallback): string {
  return [
    input.eventId,
    input.orderId,
    input.providerReference,
    input.amountMinor,
    input.currency,
    input.status,
    input.occurredAt,
  ].join("|");
}

export function signPaymentCallback(input: UnsignedCallback, secret: string): string {
  return createHmac("sha256", secret).update(canonicalCallback(input), "utf8").digest("hex");
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export class PaymentAdapter {
  readonly #database: DatabaseSync;
  readonly #ledger: CashLedgerPort;
  readonly #secrets: Record<"alipay" | "wechat", string>;
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  readonly #callbackToleranceMs: number;
  readonly #orderTtlMs: number;
  readonly #minimumRechargeMinor: number;
  readonly #maximumRechargeMinor: number;

  constructor(databasePath: string, options: PaymentAdapterOptions) {
    this.#database = new DatabaseSync(databasePath);
    this.#ledger = options.ledger;
    this.#secrets = options.secrets;
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#callbackToleranceMs = options.callbackToleranceMs ?? 5 * 60_000;
    this.#orderTtlMs = options.orderTtlMs ?? 30 * 60_000;
    this.#minimumRechargeMinor = options.minimumRechargeMinor ?? 100;
    this.#maximumRechargeMinor = options.maximumRechargeMinor ?? 1_000_000;
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  createOrder(accountId: string, input: unknown): RechargeOrder {
    const request = createRechargeOrderInputSchema.parse(input);
    if (
      request.amountMinor < this.#minimumRechargeMinor ||
      request.amountMinor > this.#maximumRechargeMinor
    ) {
      throw new Error("RECHARGE_AMOUNT_OUT_OF_RANGE");
    }
    const requestHash = hash(request);
    const replay = this.#database
      .prepare(
        "SELECT request_hash, order_json FROM recharge_orders WHERE account_id = ? AND idempotency_key = ?",
      )
      .get(accountId, request.idempotencyKey) as SqlRow | undefined;
    if (replay) {
      if (replay.request_hash !== requestHash) throw new Error("PAYMENT_ORDER_DEDUPE_KEY_REUSE");
      return rechargeOrderSchema.parse(JSON.parse(String(replay.order_json)));
    }
    const now = this.#now();
    const orderId = this.#idFactory();
    const order = rechargeOrderSchema.parse({
      orderId,
      accountId,
      amountMinor: request.amountMinor,
      currency: "CNY",
      provider: request.provider,
      status: "pending_payment",
      idempotencyKey: request.idempotencyKey,
      checkoutUrl: `https://checkout.test.openerx.invalid/${request.provider}/${orderId}`,
      providerReference: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#orderTtlMs).toISOString(),
      paidAt: null,
      creditedAt: null,
    });
    this.#database
      .prepare(
        `INSERT INTO recharge_orders
         (order_id, account_id, provider, amount_minor, status, idempotency_key,
          request_hash, order_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        order.orderId,
        order.accountId,
        order.provider,
        order.amountMinor,
        order.status,
        order.idempotencyKey,
        requestHash,
        JSON.stringify(order),
        order.createdAt,
      );
    return order;
  }

  closeOrder(accountId: string, orderId: string): RechargeOrder {
    const order = this.#order(accountId, orderId);
    if (["credited", "paid", "refunded", "partially_refunded"].includes(order.status)) {
      throw new Error("PAYMENT_ORDER_NOT_CLOSABLE");
    }
    if (order.status === "closed") return order;
    return this.#saveOrder({ ...order, status: "closed", checkoutUrl: null });
  }

  handleCallback(input: PaymentCallback): RechargeOrder {
    const callback = paymentCallbackSchema.parse(input);
    const payloadHash = hash(callback);
    const event = this.#database
      .prepare("SELECT payload_hash, order_json FROM payment_events WHERE event_id = ?")
      .get(callback.eventId) as SqlRow | undefined;
    if (event) {
      if (event.payload_hash !== payloadHash) throw new Error("PAYMENT_EVENT_ID_REUSE");
      return rechargeOrderSchema.parse(JSON.parse(String(event.order_json)));
    }
    const order = this.#orderById(callback.orderId);
    this.#verifyCallback(callback, order.provider);
    if (callback.amountMinor !== order.amountMinor || callback.currency !== order.currency) {
      throw new Error("PAYMENT_AMOUNT_MISMATCH");
    }
    if (order.status === "closed") throw new Error("PAYMENT_ORDER_CLOSED");
    if (new Date(order.expiresAt).getTime() <= this.#now().getTime()) {
      throw new Error("PAYMENT_ORDER_EXPIRED");
    }
    let result: RechargeOrder;
    if (callback.status === "failed") {
      result = this.#saveOrder({
        ...order,
        status: "failed",
        providerReference: callback.providerReference,
        checkoutUrl: null,
      });
    } else if (order.status === "credited") {
      result = order;
    } else {
      this.#ledger.creditCash(
        order.accountId,
        order.amountMinor,
        order.orderId,
        `payment-credit:${order.orderId}`,
      );
      result = this.#saveOrder({
        ...order,
        status: "credited",
        providerReference: callback.providerReference,
        checkoutUrl: null,
        paidAt: callback.occurredAt,
        creditedAt: this.#now().toISOString(),
      });
    }
    this.#database
      .prepare(
        `INSERT INTO payment_events(event_id, order_id, payload_hash, order_json, received_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        callback.eventId,
        callback.orderId,
        payloadHash,
        JSON.stringify(result),
        this.#now().toISOString(),
      );
    return result;
  }

  refund(
    accountId: string,
    orderId: string,
    amountMinor: number,
    reason: string,
    idempotencyKey: string,
  ): RefundOrder {
    const replay = this.#database
      .prepare(
        "SELECT request_hash, refund_json FROM refunds WHERE account_id = ? AND idempotency_key = ?",
      )
      .get(accountId, idempotencyKey) as SqlRow | undefined;
    const request = { accountId, orderId, amountMinor, reason, idempotencyKey };
    if (replay) {
      if (replay.request_hash !== hash(request)) throw new Error("REFUND_DEDUPE_KEY_REUSE");
      return refundOrderSchema.parse(JSON.parse(String(replay.refund_json)));
    }
    const order = this.#order(accountId, orderId);
    if (!["credited", "partially_refunded"].includes(order.status)) {
      throw new Error("PAYMENT_ORDER_NOT_REFUNDABLE");
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      throw new Error("REFUND_AMOUNT_INVALID");
    const refunded = this.#refundedMinor(accountId, orderId);
    if (refunded + amountMinor > order.amountMinor) throw new Error("REFUND_EXCEEDS_PAYMENT");
    const refundId = this.#idFactory();
    this.#ledger.debitCash(accountId, amountMinor, refundId, `payment-refund:${idempotencyKey}`);
    const refund = refundOrderSchema.parse({
      refundId,
      accountId,
      orderId,
      amountMinor,
      reason,
      status: "succeeded",
      idempotencyKey,
      createdAt: this.#now().toISOString(),
    });
    this.#database
      .prepare(
        `INSERT INTO refunds
         (refund_id, account_id, order_id, amount_minor, idempotency_key,
          request_hash, refund_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        refund.refundId,
        refund.accountId,
        refund.orderId,
        refund.amountMinor,
        refund.idempotencyKey,
        hash(request),
        JSON.stringify(refund),
        refund.createdAt,
      );
    const totalRefunded = refunded + amountMinor;
    this.#saveOrder({
      ...order,
      status: totalRefunded === order.amountMinor ? "refunded" : "partially_refunded",
    });
    return refund;
  }

  listOrders(accountId: string): RechargeOrder[] {
    return (
      this.#database
        .prepare(
          "SELECT order_json FROM recharge_orders WHERE account_id = ? ORDER BY created_at, order_id",
        )
        .all(accountId) as SqlRow[]
    ).map((row) => rechargeOrderSchema.parse(JSON.parse(String(row.order_json))));
  }

  listRefunds(accountId: string): RefundOrder[] {
    return (
      this.#database
        .prepare(
          "SELECT refund_json FROM refunds WHERE account_id = ? ORDER BY created_at, refund_id",
        )
        .all(accountId) as SqlRow[]
    ).map((row) => refundOrderSchema.parse(JSON.parse(String(row.refund_json))));
  }

  reconcile(
    provider: "alipay" | "wechat",
    providerRows: ProviderSettlementRow[],
  ): ReconciliationDiscrepancy[] {
    const local = (
      this.#database
        .prepare("SELECT order_json FROM recharge_orders WHERE provider = ?")
        .all(provider) as SqlRow[]
    ).map((row) => rechargeOrderSchema.parse(JSON.parse(String(row.order_json))));
    const byProvider = new Map(providerRows.map((row) => [row.orderId, row]));
    const discrepancies: ReconciliationDiscrepancy[] = [];
    const add = (
      orderId: string,
      kind: ReconciliationDiscrepancy["kind"],
      expectedMinor: number | null,
      actualMinor: number | null,
    ) => {
      const stable = { provider, orderId, kind, expectedMinor, actualMinor };
      discrepancies.push(
        reconciliationDiscrepancySchema.parse({
          discrepancyId: hash(stable),
          ...stable,
          detectedAt: this.#now().toISOString(),
          status: "open",
        }),
      );
    };
    for (const order of local) {
      const remote = byProvider.get(order.orderId);
      if (!remote) {
        add(order.orderId, "missing_provider", order.amountMinor, null);
        continue;
      }
      byProvider.delete(order.orderId);
      if (remote.amountMinor !== order.amountMinor) {
        add(order.orderId, "amount_mismatch", order.amountMinor, remote.amountMinor);
      }
      const localSucceeded = ["credited", "partially_refunded", "refunded"].includes(order.status);
      if (localSucceeded !== (remote.status === "succeeded")) {
        add(
          order.orderId,
          "status_mismatch",
          localSucceeded ? order.amountMinor : 0,
          remote.amountMinor,
        );
      }
    }
    for (const remote of byProvider.values()) {
      add(remote.orderId, "missing_local", null, remote.amountMinor);
    }
    return discrepancies.sort((left, right) =>
      left.discrepancyId.localeCompare(right.discrepancyId),
    );
  }

  #verifyCallback(callback: PaymentCallback, provider: "alipay" | "wechat"): void {
    const expected = signPaymentCallback(callback, this.#secrets[provider]);
    const supplied = Buffer.from(callback.signature, "hex");
    const expectedBytes = Buffer.from(expected, "hex");
    if (supplied.length !== expectedBytes.length || !timingSafeEqual(supplied, expectedBytes)) {
      throw new Error("PAYMENT_SIGNATURE_INVALID");
    }
    if (
      Math.abs(this.#now().getTime() - new Date(callback.occurredAt).getTime()) >
      this.#callbackToleranceMs
    ) {
      throw new Error("PAYMENT_CALLBACK_EXPIRED");
    }
  }

  #order(accountId: string, orderId: string): RechargeOrder {
    const order = this.#orderById(orderId);
    if (order.accountId !== accountId) throw new Error("PAYMENT_ORDER_NOT_FOUND");
    return order;
  }

  #orderById(orderId: string): RechargeOrder {
    const row = this.#database
      .prepare("SELECT order_json FROM recharge_orders WHERE order_id = ?")
      .get(orderId) as SqlRow | undefined;
    if (!row) throw new Error("PAYMENT_ORDER_NOT_FOUND");
    return rechargeOrderSchema.parse(JSON.parse(String(row.order_json)));
  }

  #saveOrder(input: RechargeOrder): RechargeOrder {
    const order = rechargeOrderSchema.parse(input);
    this.#database
      .prepare("UPDATE recharge_orders SET status = ?, order_json = ? WHERE order_id = ?")
      .run(order.status, JSON.stringify(order), order.orderId);
    return order;
  }

  #refundedMinor(accountId: string, orderId: string): number {
    const row = this.#database
      .prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) AS total FROM refunds WHERE account_id = ? AND order_id = ?",
      )
      .get(accountId, orderId) as SqlRow;
    return Number(row.total);
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS recharge_orders (
        order_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('alipay', 'wechat')),
        amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        order_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(account_id, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS payment_events (
        event_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        order_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS refunds (
        refund_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        refund_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(account_id, idempotency_key)
      ) STRICT;
    `);
  }
}
