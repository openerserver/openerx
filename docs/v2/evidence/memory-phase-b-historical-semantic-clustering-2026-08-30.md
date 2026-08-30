# Memory Phase B Historical Semantic Clustering Evidence

Date: 2026-08-30 (Asia/Shanghai)

## Outcome

OpenerX now performs a bounded semantic review pass over existing active memories after a deterministic consolidation run completes. The App Service sends at most 40 memories to the restricted `pi.memory.cluster` task. Pi Host runs an in-memory, no-tool session and may return at most 20 high-confidence `duplicate` or `conflict` pairs.

The model output never mutates active memory directly. Valid pairs are staged in the existing Memory Settings review queue. A semantic-model failure is best effort: expiration cleanup, supersede-link repair, and the persisted deterministic consolidation run remain completed.

## Review and recovery semantics

- Migration v26 generalizes merge reviews to reference an optional second existing memory and records both revisions and exact content snapshots.
- A proposal is rejected as stale if either memory changed after the scan.
- Historical duplicate acceptance keeps the higher-priority entry (explicit, then consolidated, then automatic; most recent breaks ties), moves the other entry to `superseded`, and creates a recoverable chain.
- Historical conflict acceptance promotes the displayed newer entry to an explicit decision and supersedes the older entry.
- Dismissal leaves both entries active.
- Deleting the accepted winner restores its predecessor through the same existing undo behavior.
- Existing conflict-slot members are excluded from model clustering because their ordering is already determined by strict product semantics.

## Security and cost boundaries

- Memory contents are untrusted model input and cannot become instructions.
- The cluster session exposes no tools and validates that both IDs came from the supplied batch, differ, and have the same memory kind.
- Relation confidence must be at least 0.85; repeated pairs and out-of-batch IDs fail the whole model result.
- Platform calls use `memory-cluster:<consolidationRunId>` as the server-side dedupe key. Client-side remaining-usage data is not consulted.
- BYOK remains available only when platform authorization is unavailable.

## Current bound

This slice scans the most recent 40 eligible active memories per consolidation run. Full catalog rotation for profiles above that bound, real-model Golden precision/recall evaluation, and the 1,000-memory latency benchmark remain open.

## Verification

Covered behavior includes:

- strict cluster request/result contracts and Pi Host contract versioning;
- v25-to-v26 review migration and proposal-memory index;
- historical duplicate/conflict staging, explicit acceptance, restoration, and two-sided stale protection;
- best-effort semantic scheduling after deterministic consolidation;
- MessagePort result correlation and Pi Host no-tool execution;
- Memory Settings labeling for an existing-memory proposal;
- personal-data export of proposal memory snapshots.

Recorded verification:

- Contracts + Storage + Pi Host: 27 files, 150 tests passed;
- App Service: 11 files, 61 tests passed with a 30-second Windows test timeout;
- Observability: 1 file, 3 tests passed;
- memory-related Desktop renderer selection: 1 file, 3 tests passed (40 unrelated tests skipped);
- the complete Desktop renderer file passed 40 of 43 tests; the three failures are pre-existing order-dependent fixtures for thinking-level options, Skill options, and local Web Search state, outside this memory slice;
- all six affected TypeScript projects passed `tsc --noEmit`;
- all affected source and test files passed Biome check, and `git diff --check` passed apart from Windows line-ending notices.
