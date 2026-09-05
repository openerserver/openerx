# GT-ACCOUNT-04 — M2 local implementation

- Result: `PASS`.
- Catalog input: `account.concurrent-edit.v1` — edit the same message from two devices.
- Automated proof: `tests/v2/golden/account-m2.test.ts`, `services/account-sync-api/tests/account-sync-service.test.ts`, and `apps/desktop/tests/chat-ui.test.tsx`.
- Verified boundary: both client/server payloads remain visible, unresolved conflicts block unsafe cache clearing, and the user can explicitly choose local or cloud resolution.
- Remaining release evidence: native two-device interaction matrix.
