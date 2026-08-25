# GT-ACCOUNT-08 — M2 local implementation

- Result: `PASS`.
- Catalog input: `account.message-token.v1` — inspect fixed message and conversation Token totals.
- Automated proof: `services/token-usage-store/tests/usage-store.test.ts`, `tests/v2/platform-alpha-m2.test.ts`, `apps/desktop/tests/chat-ui.test.tsx`, and Electron account E2E.
- Verified boundary: known input/cached/output/reasoning/total classes remain attributable while unknown categories remain `null`/unknown rather than synthetic zero.
- Remaining release evidence: real paid-provider usage reconciliation.
