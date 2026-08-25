# GT-BILLING-03 — M3 local implementation

- Result: `PASS` for the M3 local slice.
- Catalog input: `billing.insufficient-funds.v1`.
- Automated proof: `tests/v2/golden/billing-m3.test.ts`.
- Verified boundary: reservation fails before the upstream executor, with no Usage, Charge, ledger mutation or overdraft.
- Remaining release evidence: real-provider request suppression and user-facing recharge/model-switch guidance on both desktop platforms.
