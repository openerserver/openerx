# GT-BILLING-08 — M3 local implementation

- Result: `PASS` for the M3 local slice.
- Catalog input: `billing.reversal-refund.v1`.
- Automated proof: Billing Ledger tests, Payment Adapter tests and `tests/v2/golden/billing-m3.test.ts`.
- Verified boundary: the original charge remains addressable, reversal entries link to the original transaction, and a partial payment refund posts one balanced cash debit.
- Remaining release evidence: provider-side refund arrival, operator approval and customer-support audit workflow.
