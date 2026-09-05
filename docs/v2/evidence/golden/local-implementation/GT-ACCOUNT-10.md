# GT-ACCOUNT-10 — M2 local implementation

- Result: `PASS` for M2 conversation data.
- Catalog input: `account.clear-logout-delete.v1` — clear local cache, exit a device and delete cloud data separately.
- Automated proof: `tests/v2/golden/account-m2.test.ts`, `services/account-sync-api/tests/account-sync-service.test.ts`, account/UI tests, and Electron account E2E.
- Verified boundary: unsafe cache clearing is blocked; safe local clearing can restore from cloud; device exit removes credentials without deleting cloud data; cloud deletion writes retention tombstones and prevents restoration.
- Deferred boundary: attachment/Artifact cloud deletion joins this task in M4.
