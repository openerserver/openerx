# Memory Phase B Semantic Review Foundation Evidence

Date: 2026-08-30 (Asia/Shanghai)

## Outcome

UWA now routes fuzzy relationships found while extracting new memories through an explicit user-review boundary. The restricted Pi memory task receives at most 50 existing memories, may label a new candidate as `none`, `duplicate`, or `conflict`, and may only reference an existing memory ID supplied in the same request and of the same kind.

`duplicate` and `conflict` suggestions do not become active memories. They are persisted in the local v25 `memory_merge_reviews` table and surfaced in Memory Settings. The user can:

- confirm a duplicate, which adds the new conversation as another source without creating a second active memory;
- confirm a conflict, which creates an explicit, reversible replacement and preserves the previous value through a shared conflict slot and supersede chain;
- dismiss the suggestion without changing any active memory.

The review queue is local derived state and is not synchronized. Accepted conflict decisions synchronize the changed predecessor and replacement `MemoryEntry` objects. Complete cross-device source-link synchronization remains a separate slice.

## Safety boundaries

- Existing memories and conversation messages are passed as untrusted data to a no-tool, in-memory Pi session.
- Existing-memory input is bounded to 50 items and 500 characters per item.
- Model output remains strict-schema validated, including source message ownership, relation/target consistency, target kind, a 0.85 relation-confidence floor, and sensitive-content rejection.
- A fuzzy suggestion cannot alter recall state before explicit acceptance.
- Explicitly forgetting the proposal source, or deleting a related memory, removes its review record; local cache clearing and personal-data export include the new table.
- Review acceptance is idempotent. A stale or already-resolved target cannot be silently applied.

## Verification

The implementation is covered across contracts, migration, repository, App Service, Pi Host, and renderer boundaries:

- strict relation and related-ID contracts;
- migration v24 to v25 and review indexes;
- duplicate acceptance, conflict replacement, dismissal, idempotent replay, and delete restoration;
- extraction scheduling with bounded existing memories and no automatic-created notification for reviews;
- Pi Host no-tool semantic labeling and supplied-ID validation;
- App Service commands, desktop IPC bridge, and the Settings confirmation flow;
- package typechecks for Contracts, Storage, App Service, Pi Host, Observability, and Desktop.

Recorded verification:

- Contracts + Storage + Pi Host: 27 files, 146 tests passed;
- App Service: 11 files, 57 tests passed (the existing Office workflow test used a 30-second Windows test timeout);
- Observability: 1 file, 3 tests passed;
- memory-related Desktop renderer selection: 1 file, 5 tests passed (38 unrelated tests skipped);
- all six affected TypeScript projects passed `tsc --noEmit`;
- affected files passed Biome formatting/lint with only the repository's existing stylesheet specificity warnings.

Historical all-to-all fuzzy clustering, real-model precision/recall Golden evaluation, and the 1,000-memory latency benchmark remain open.
