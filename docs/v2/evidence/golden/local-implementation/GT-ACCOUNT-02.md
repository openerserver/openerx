# GT-ACCOUNT-02 — M2 local implementation

- Result: `PASS` for Conversation/Branch/Message/model recovery; `DEFERRED` for attachment and Artifact recovery.
- Catalog input: `account.cross-device-history.v1` — create on Windows and continue on macOS.
- Automated proof: `tests/v2/golden/account-m2.test.ts` uses two independent account-scoped SQLite replicas and `apps/desktop/scripts/e2e-account.mjs` verifies restart restoration.
- Verified boundary: cloud changes restore messages, branches and selected model without restoring device-private grants.
- Deferred boundary: attachment/cloud-copy and Artifact recovery are M4; native Windows-to-macOS execution is a release-environment gate.
