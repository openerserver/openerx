# ADR-V2-010: Money, reservation and append-only ledger boundary

- Status: Accepted; M3 local implementation complete
- Date: 2026-08-25
- Owners: Pricing, Billing Ledger, Payment and Desktop

## Decision

1. V1 settles only `CNY`. User-facing and ledger money is stored as non-negative safe integers in
   the currency minor unit (fen). Binary floating point is forbidden for prices, balances, quotes,
   reservations, charges, payments and statements.
2. Model Token rates are versioned integers in micro-fen per Token. Charge arithmetic uses integer
   intermediates and rounds once at the final charge boundary with the snapshot's explicit rule.
3. A `PriceQuote` embeds an immutable `PricingSnapshot`, accepted terms version, expiry and maximum
   debit. Catalog changes never alter an existing quote, reservation or charge.
4. A reservation locks a deterministic allocation across earliest-expiring quota, earliest-expiring
   points and then cash. It changes available funds but does not mutate posted balances or create a
   fake expense. Settlement posts only actual charge; release is idempotent.
5. Quota, points and cash remain distinct assets. Point conversion uses a versioned rational integer
   rule. Ledger transactions balance independently for every unit (`CNY_MINOR` or `POINT`).
6. Posted ledger entries are append-only. Corrections create linked reversal transactions; no posted
   amount is updated or deleted. Cached balances and grant remainders are rebuildable projections.
7. `UsageRecord`, quote, reservation, charge, payment event and business transaction each have stable
   account-scoped dedupe keys. Reusing a key with a different payload fails closed.
8. Payment confirmation is server-only. A signed callback is time-bounded and replay-safe; polling,
   deep links and duplicate callbacks cannot credit an order twice.
9. Renderer, Pi Host and content sync receive read/intent APIs only. They cannot submit Token counts,
   usage estimates, rates, quote amounts, balances, arbitrary ledger entries or provider
   payment-success assertions. Model Gateway and Billing services calculate quotes and charges on the
   server; clients only display the resulting Billing state.

## Consequences

- Unknown billable Token fields keep a charge pending or fail closed; they are never treated as zero.
- Insufficient funds and expired quotes stop execution before provider work.
- Service restart can replay reservation, settlement, payment and refund intents without duplicate
  money movement.
- Statements sum posted transactions and charges; they never recalculate money from aggregated Token
  totals.
- Production Alipay/WeChat credentials, hosted checkout, legal review and native platform validation
  remain environment gates even after the deterministic M3 local implementation passes.
