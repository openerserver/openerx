# GT-BILLING-07 — M3 local implementation

- Result: `PASS` for the M3 local slice.
- Catalog input: `billing.stop-failure.v1`.
- Automated proof: `tests/v2/golden/billing-m3.test.ts` and Billing Ledger tests.
- Verified boundary: pre-Usage provider failure releases the reservation with no charge; unknown priced Token fields create a pending zero-deduction Charge and release funds instead of estimating.
- Remaining release evidence: real provider stop-stream partial-Usage behavior and delayed Usage correction policy.
