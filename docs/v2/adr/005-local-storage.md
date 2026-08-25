# ADR-V2-005: Local database, migration, encryption and cache cleanup

- Status: Accepted
- Date: 2026-08-25
- Owners: Personal App Service and Security

## Decision

1. Use SQLite through Node 24 `node:sqlite`, isolated behind `packages/storage` interfaces and owned
   exclusively by App Service. Renderer, Preload and Pi Host never open the database.
2. Database access executes outside Electron Main so synchronous SQLite work cannot block window or
   permission handling. WAL mode, foreign keys and an explicit busy timeout are enabled at open.
3. Schema migrations are ordered, checksummed and transactional. Startup refuses to open a database
   newer than the client. Each release is tested from a clean database and the previous two schema
   versions.
4. Reusable credentials are never stored in SQLite. Electron Main protects the local data-encryption
   key with the OS credential facility; App Service receives only a scoped in-memory key handle.
   Sensitive columns and private cached blobs use authenticated encryption with per-record nonces.
5. Local absolute paths, grants, browser data and shell history are device-local. Account sync stores
   only the cloud-safe objects listed in the product contract.
6. “Clear local cache” closes all handles, removes rebuildable cache/search projections and revokes
   temporary grants. It does not delete cloud history. “Delete cloud data” is a separate authenticated
   operation with tombstones and retention behavior.
7. SQLite is currently release-candidate in Node 24, so the adapter has contract tests and no domain
   type may expose driver-specific objects. A driver replacement does not change application APIs.

The selected API and current stability are tracked in the official
[`node:sqlite` documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).

## Consequences

- Local storage has one writer and deterministic migrations.
- Native addon rebuild risk is avoided for the first implementation.
- The adapter boundary contains upstream SQLite API changes without rewriting domain services.
