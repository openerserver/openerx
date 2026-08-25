# ADR-V2-008: Cloud objects, sync cursor and conflict strategy

- Status: Accepted
- Date: 2026-08-25
- Owners: Account Sync and Data Platform

## Decision

1. The account cloud is the eventual cross-device truth for the explicit sync allowlist. M1's SQLite
   Conversation/Message store is the authoritative local profile state until Account Alpha connects
   that cloud in M2.
2. Every local sync mutation will create an immutable outbox operation with `operationId`, object ID,
   `baseRevision`, device ID, payload schema version and idempotency key in the same transaction as
   the local revision.
3. The server returns an opaque, monotonically advancing account cursor. Clients persist a cursor
   only after all preceding operations and downloaded objects commit locally. Client timestamps never
   replace revision or cursor ordering.
4. Concurrent non-overlapping field changes may merge under a versioned rule. Message content,
   branch topology and other ambiguous edits preserve both versions and create an explicit conflict;
   no last-writer-wins overwrite is allowed.
5. Delete creates one revisioned tombstone with a retention deadline. Archive is reversible state,
   not deletion. Clearing a local cache does not create a cloud tombstone.
6. Attachment and Artifact bytes use immutable content-addressed objects; synchronized records carry
   hashes and object references. Absolute paths, local file grants, credentials, cookies, tool grants
   and Runtime handles are device-only fields and are rejected by sync schemas.

## M1 boundary

M1 implements local revisions, ordered replay events, archive state and a single local deletion
tombstone. It does not claim cloud synchronization. M2 must add transactional outbox, cursor replay,
conflict fixtures and two-device tests before Account Alpha exits.

## Consequences

- Retry and reconnect can be idempotent without trusting wall-clock order.
- Branch edits and deletes remain auditable across future device conflicts.
- The current local schema can evolve into sync without making Runtime state cloud data.
