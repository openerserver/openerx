# GT-BILLING-04 — M3 local implementation

- Result: `PASS` for the deterministic payment-adapter slice.
- Catalog input: `billing.alipay-replay.v1`.
- Automated proof: Payment Adapter tests, M3 Golden tests and Electron account/Billing E2E.
- Verified boundary: server signature/time checks and stable idempotency credit one Alipay order once across duplicate callbacks and adapter restart.
- Remaining release evidence: Alipay merchant sandbox callback, query, deep-link and settlement reconciliation.
