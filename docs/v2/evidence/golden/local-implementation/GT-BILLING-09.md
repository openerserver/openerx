# GT-BILLING-09 — M3 local implementation

- Result: `PASS` for the M3 local slice.
- Catalog input: `billing.monthly-statement.v1`.
- Automated proof: `tests/v2/golden/billing-m3.test.ts`, `pdfinfo`, Poppler rendering and visual page inspection.
- Verified boundary: an open month cannot be finalized; a closed-month statement reconciles credits, charges, refunds, reversals and closing cash, exports CSV/PDF, and remains byte-stable after later activity.
- Remaining release evidence: localized production statement design, retention and native download/open matrix.
