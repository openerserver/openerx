import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LedgerTransaction } from "@openerx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentAdapter, signPaymentCallback } from "../src";

const now = new Date("2026-08-25T10:00:00.000Z");
const secrets = { alipay: "alipay-test-secret", wechat: "wechat-test-secret" };
const directories: string[] = [];

class TestLedger {
  readonly balances = new Map<string, number>();
  readonly transactions = new Map<string, LedgerTransaction>();

  creditCash(
    accountId: string,
    amountMinor: number,
    referenceId: string,
    idempotencyKey: string,
  ): LedgerTransaction {
    return this.#move(accountId, amountMinor, referenceId, idempotencyKey, "credit");
  }

  debitCash(
    accountId: string,
    amountMinor: number,
    referenceId: string,
    idempotencyKey: string,
  ): LedgerTransaction {
    if ((this.balances.get(accountId) ?? 0) < amountMinor)
      throw new Error("CASH_BALANCE_INSUFFICIENT");
    return this.#move(accountId, amountMinor, referenceId, idempotencyKey, "debit");
  }

  balance(accountId: string): number {
    return this.balances.get(accountId) ?? 0;
  }

  #move(
    accountId: string,
    amountMinor: number,
    referenceId: string,
    idempotencyKey: string,
    direction: "credit" | "debit",
  ): LedgerTransaction {
    const replay = this.transactions.get(idempotencyKey);
    if (replay) return replay;
    const transactionId = randomUUID();
    const createdAt = now.toISOString();
    const debit = direction === "credit" ? amountMinor : 0;
    const credit = direction === "debit" ? amountMinor : 0;
    const transaction: LedgerTransaction = {
      transactionId,
      accountId,
      type: direction === "credit" ? "cash_credit" : "cash_debit",
      referenceId,
      dedupeKey: idempotencyKey,
      reversalOf: null,
      createdAt,
      entries: [
        {
          entryId: randomUUID(),
          transactionId,
          accountId,
          ledgerAccount: "asset:cash",
          unit: "CNY_MINOR",
          debit,
          credit,
          createdAt,
        },
        {
          entryId: randomUUID(),
          transactionId,
          accountId,
          ledgerAccount: "liability:cash:platform",
          unit: "CNY_MINOR",
          debit: credit,
          credit: debit,
          createdAt,
        },
      ],
    };
    this.transactions.set(idempotencyKey, transaction);
    this.balances.set(
      accountId,
      (this.balances.get(accountId) ?? 0) + (direction === "credit" ? amountMinor : -amountMinor),
    );
    return transaction;
  }
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function callback(
  orderId: string,
  amountMinor: number,
  secret: string,
  eventId: string = randomUUID(),
) {
  const unsigned = {
    eventId,
    orderId,
    providerReference: `provider-${orderId}`,
    amountMinor,
    currency: "CNY" as const,
    status: "succeeded" as const,
    occurredAt: now.toISOString(),
  };
  return { ...unsigned, signature: signPaymentCallback(unsigned, secret) };
}

describe("PaymentAdapter", () => {
  it("credits an Alipay callback once across duplicate signals and service restart", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openerx-payment-"));
    directories.push(directory);
    const database = path.join(directory, "payment.sqlite");
    const ledger = new TestLedger();
    const accountId = randomUUID();
    let adapter = new PaymentAdapter(database, { ledger, secrets, now: () => now });
    const order = adapter.createOrder(accountId, {
      amountMinor: 1_000,
      provider: "alipay",
      idempotencyKey: "alipay-order-001",
    });
    const event = callback(order.orderId, order.amountMinor, secrets.alipay);
    expect(adapter.handleCallback(event).status).toBe("credited");
    expect(adapter.handleCallback(event).status).toBe("credited");
    expect(ledger.balance(accountId)).toBe(1_000);
    adapter.close();

    adapter = new PaymentAdapter(database, { ledger, secrets, now: () => now });
    expect(adapter.handleCallback(event).status).toBe("credited");
    expect(ledger.balance(accountId)).toBe(1_000);
    adapter.close();
  });

  it("rejects signatures, stale callbacks, payload mutation and cross-account reads", () => {
    let clock = new Date(now);
    const ledger = new TestLedger();
    const adapter = new PaymentAdapter(":memory:", {
      ledger,
      secrets,
      now: () => clock,
      callbackToleranceMs: 60_000,
    });
    const accountId = randomUUID();
    const order = adapter.createOrder(accountId, {
      amountMinor: 500,
      provider: "wechat",
      idempotencyKey: "wechat-security-001",
    });
    const event = callback(order.orderId, 500, secrets.wechat, "event-security-001");
    expect(() => adapter.handleCallback({ ...event, signature: "0".repeat(64) })).toThrow(
      "PAYMENT_SIGNATURE_INVALID",
    );
    clock = new Date("2026-08-25T10:02:00.000Z");
    expect(() => adapter.handleCallback(event)).toThrow("PAYMENT_CALLBACK_EXPIRED");
    clock = new Date(now);
    adapter.handleCallback(event);
    const mutated = callback(order.orderId, 400, secrets.wechat, event.eventId);
    expect(() => adapter.handleCallback(mutated)).toThrow("PAYMENT_EVENT_ID_REUSE");
    expect(adapter.listOrders(randomUUID())).toEqual([]);
    adapter.close();
  });

  it("never credits a closed WeChat order and credits a new retry order once", () => {
    const ledger = new TestLedger();
    const adapter = new PaymentAdapter(":memory:", { ledger, secrets, now: () => now });
    const accountId = randomUUID();
    const closed = adapter.createOrder(accountId, {
      amountMinor: 300,
      provider: "wechat",
      idempotencyKey: "wechat-closed-001",
    });
    adapter.closeOrder(accountId, closed.orderId);
    expect(() => adapter.handleCallback(callback(closed.orderId, 300, secrets.wechat))).toThrow(
      "PAYMENT_ORDER_CLOSED",
    );
    const retry = adapter.createOrder(accountId, {
      amountMinor: 300,
      provider: "wechat",
      idempotencyKey: "wechat-retry-001",
    });
    adapter.handleCallback(callback(retry.orderId, 300, secrets.wechat));
    expect(ledger.balance(accountId)).toBe(300);
    adapter.close();
  });

  it("posts idempotent refunds and emits stable reconciliation discrepancies", () => {
    const ledger = new TestLedger();
    const adapter = new PaymentAdapter(":memory:", { ledger, secrets, now: () => now });
    const accountId = randomUUID();
    const order = adapter.createOrder(accountId, {
      amountMinor: 800,
      provider: "alipay",
      idempotencyKey: "refund-order-001",
    });
    adapter.handleCallback(callback(order.orderId, 800, secrets.alipay));
    const refund = adapter.refund(accountId, order.orderId, 300, "用户批准退款", "refund-001");
    expect(adapter.refund(accountId, order.orderId, 300, "用户批准退款", "refund-001")).toEqual(
      refund,
    );
    expect(ledger.balance(accountId)).toBe(500);
    const rows = adapter.reconcile("alipay", [
      { provider: "alipay", orderId: order.orderId, amountMinor: 700, status: "succeeded" },
      { provider: "alipay", orderId: randomUUID(), amountMinor: 100, status: "succeeded" },
    ]);
    expect(rows.map(({ kind }) => kind).sort()).toEqual(["amount_mismatch", "missing_local"]);
    expect(
      adapter
        .reconcile("alipay", [
          { provider: "alipay", orderId: order.orderId, amountMinor: 700, status: "succeeded" },
          {
            provider: "alipay",
            orderId: rows.find(({ kind }) => kind === "missing_local")?.orderId ?? "",
            amountMinor: 100,
            status: "succeeded",
          },
        ])
        .map(({ discrepancyId }) => discrepancyId),
    ).toEqual(rows.map(({ discrepancyId }) => discrepancyId));
    adapter.close();
  });
});
