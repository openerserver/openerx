# GT-ACCOUNT-01 — M2 local implementation

- Result: `PASS` for the M2 local slice.
- Catalog input: `account.login-refresh.v1` — login, refresh, then simulate expiry.
- Automated proof: `services/identity-api/tests/identity-service.test.ts`, `apps/desktop/tests/account-session-manager.test.ts`, `apps/desktop/tests/credential-vault.test.ts`, and `apps/desktop/scripts/e2e-account.mjs`.
- Verified boundary: single-use challenge, refresh rotation/replay revocation, explicit expiry, protected reusable credential, restart refresh and credential removal on sign-out.
- Remaining release evidence: native Windows/macOS credential-store and reauthentication matrix.
