# ADR-V2-007: Pi owns the agent harness

- Status: Accepted and implemented
- Date: 2026-08-25
- Owners: Pi Integration and Desktop Foundation

## Context

Pi already defines the execution model: `AgentSession`, the agent loop, message and tool events,
context compaction, retry and session state. A V2 `RuntimeAdapter`, execution coordinator or generic
multi-harness API would duplicate those semantics and create two sources of truth.

## Decision

1. V1 has one production harness: `@earendil-works/pi-coding-agent`, pinned to `0.84.4`.
2. Pi owns `AgentSession`, the agent loop, model turns, context, compaction, retry and tool-call
   lifecycle.
3. Pi runs only in the supervised `@openerx/pi-host` Electron utility process.
4. V2 owns product concerns around Pi: process supervision, product IDs, durable
   Conversation/Message/WorkItem/ExecutionRun projections, model and billing preconditions,
   capability authorization, sandboxing, files, artifacts, sync and UI.
5. The App Service bridge uses four explicit actions/events: `pi-host.bootstrap`,
   `pi.session.prompt`, `pi.session.abort` and `pi.product-event`. It is an Electron process contract,
   not a harness abstraction.
6. Product history is supplied to Pi as approved context. Pi session references remain private and
   never become the durable Conversation or Message truth.
7. V2 tools are registered through Pi's native tool model. Pi chooses and sequences tool calls; the
   V2 Capability and Permission Broker authorizes and performs privileged side effects.
8. Product events are projections of Pi events. V2 does not plan steps, compact context, retry model
   turns or dispatch tools independently.
9. Deterministic tests use Pi's native `faux` model Provider from test files only. Production source
   and release artifacts contain no fake harness or canned model path.
10. A Pi upgrade requires event, session, stop, retry, compaction, tool, packaging and recovery
    regression evidence. OpenERX does not expose an alternate harness extension point.

## Consequences

- `packages/runtime-sdk` and the generic `RuntimeAdapter` do not exist.
- `packages/pi-host` imports Pi directly and exposes only Pi session composition plus the isolated
  process entry.
- Conversation history remains readable if a Pi session or host process fails.
- The maintained package is authoritative when V2 terminology or proposed behavior conflicts with
  Pi's API and event semantics.

## Rejected alternatives

- **Generic multi-harness adapter:** adds abstraction without a V1 requirement and obscures Pi
  semantics.
- **V2 execution coordinator:** duplicates Pi's loop, retry, compaction and tool lifecycle.
- **Pi session as product history:** couples user data, sync and migrations to private harness state.
- **Archived `v1-backup/pi-mono` as runtime code:** bypasses the pinned maintained dependency and its
  upgrade path.
