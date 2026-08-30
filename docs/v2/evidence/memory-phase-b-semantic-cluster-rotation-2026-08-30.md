# Memory Phase B Semantic Cluster Rotation Evidence

Date: 2026-08-30 (Asia/Shanghai)

## Outcome

Profiles with more than 40 eligible active memories now receive eventual full same-kind block-pair coverage without increasing a single model request beyond 40 memories.

The catalog is grouped by memory kind, ordered stably, and divided into blocks of 20. OpenerX enumerates every within-block and cross-block combination for each kind. A persisted v27 cursor identifies the next combination. A stable catalog therefore eventually places every pair of same-kind memories in one bounded `pi.memory.cluster` request.

## Scheduling semantics

- A consolidation run processes two block pairs by default and allows a bounded configuration of one to four.
- Each request uses `memory-cluster:<runId>:<stateRevision>-<cursor>` as its platform dedupe key.
- The cursor advances only after model output is validated and its reviews are staged.
- A model, transport, validation, or storage failure leaves the cursor unchanged and stops the semantic portion of that run.
- Semantic failure does not change the already-completed deterministic consolidation result.
- Completing the final pair increments the completed-cycle counter and wraps the cursor to zero.
- Restarting App Service resumes from the persisted pair rather than returning to the newest memories.

## Data handling

`memory_semantic_cluster_state` contains only the owner-scoped numeric cursor, completed-cycle count, timestamp, and revision. It contains no memory text. The state is included in personal-data export and removed by local-cache clearing. It remains local derived state and is not synchronized.

## Verification

Targeted coverage verifies:

- migration v27 creates the strict cursor table;
- a 45-memory catalog produces six block combinations of 20, 40, 25, 20, 25, and 5 memories;
- the cursor survives repository close/reopen, rejects stale completion, covers all 45 memory IDs, then wraps after one completed cycle;
- the scheduler advances two combinations in one run;
- a failed model request leaves the cursor on the same pair;
- personal-data export and local-cache clearing include the cursor state.

Recorded verification:

- Contracts + Storage + Pi Host: 27 files, 152 tests passed;
- App Service: 11 files, 62 tests passed with a 30-second Windows test timeout;
- Observability: 1 file, 3 tests passed, including exported cursor state;
- all six affected TypeScript projects passed `tsc --noEmit`;
- all affected source and test files passed Biome check;
- `git diff --check` passed apart from Windows line-ending notices.
