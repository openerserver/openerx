# ADR-V2-008: Cloud objects, sync cursor and conflict strategy

- Status: Accepted; M2 Conversation/Branch/Message slice implemented
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
   and Pi Session handles are device-only fields and are rejected by sync schemas.

## Implementation status

M1 implemented local revisions, ordered replay events, archive state and a single local deletion
tombstone. M2 now implements transactional Outbox, cursor replay, visible local/cloud conflict
resolution, retained cloud tombstones, cache restoration and independent-replica tests for
Conversation, Branch and Message. Attachment/Artifact object synchronization remains M4, and native
Windows/macOS two-device evidence remains a release-environment gate.

## Consequences

- Retry and reconnect can be idempotent without trusting wall-clock order.
- Branch edits and deletes remain auditable across future device conflicts.
- The current local schema can evolve into sync without making Pi Session state cloud data.
