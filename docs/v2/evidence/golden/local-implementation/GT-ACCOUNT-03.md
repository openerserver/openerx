# GT-ACCOUNT-03 — M2 local implementation

- Result: `PASS` for message/Outbox replay; `DEFERRED` for file replay.
- Catalog input: `account.offline-replay.v1` — send offline and synchronize after reconnect.
- Automated proof: `services/account-sync-api/tests/account-sync-service.test.ts`, `packages/app-service/tests/sync-coordinator.test.ts`, and storage transaction tests.
- Verified boundary: local writes remain pending, ordered operations replay idempotently, and duplicate messages are not created.
- Deferred boundary: duplicate-file prevention is M4.
