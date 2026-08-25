# GT-ACCOUNT-05 — M2 local implementation

- Result: `PASS` for sessions/account scope; `DEFERRED` for presigned resources.
- Catalog input: `account.revoke-isolation.v1` — revoke a device, then use the old session and another account.
- Automated proof: `services/identity-api/tests/identity-service.test.ts`, account/sync/model/usage scope tests, and `apps/desktop/scripts/e2e-account.mjs`.
- Verified boundary: targeted revoke invalidates the old access token, all-device sign-out revokes every session, and cross-account reads/writes return no data.
- Deferred boundary: presigned attachment/Artifact URL revocation is M4.
