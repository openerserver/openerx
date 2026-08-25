# ADR-V2-007: Pi-owned harness, host boundary and version strategy

- Status: Accepted
- Date: 2026-08-25
- Owners: Runtime Platform and Desktop Foundation

## Context

Pi already provides the agent harness: agent loop, session management, context compaction, model-turn
coordination, retries and the tool-call lifecycle. If V2 implements those responsibilities again in an
`Execution Coordinator` or a generic `Runtime Adapter`, the product would contain two competing
harnesses with different recovery and event semantics.

## Decision

1. The current maintained Pi package is the only production agent harness for V1. V1 does not build
   or ship a second harness.
2. Pi owns the agent loop, `AgentSession`/session management, model-turn coordination, context
   compaction, internal retries, tool-call lifecycle and resumable harness state.
3. V2 owns product and platform concerns around Pi: Runtime Host process supervision, product-ID
   binding, durable Conversation/Message/WorkItem/ExecutionRun projections, permissions and sandbox
   enforcement, model/billing preconditions, files, artifacts, sync and UI.
4. Pi executes only inside the separately supervised Runtime Host utility process. Renderer, Preload,
   Electron Main and App Service do not import Pi or adapter implementations.
5. `packages/runtime-sdk` defines the **Pi Host boundary** and translates versioned Pi events into
   stable product events. It is not a framework for choosing between multiple V1 harnesses. The
   boundary covers start/resume, prompt, stop, permission reply, ordered event streaming, usage and
   disposal.
6. App Service supplies stable `generationId`, `conversationId`, `assistantMessageId`, optional
   `workItemId`/`executionRunId`, and the resolved product-history snapshot. Pi session IDs and handles
   remain private execution references and never become the source of Conversation or Message
   history.
7. V2 capability tools are registered with Pi. Pi owns each tool call's harness lifecycle; the V2
   Capability and Permission Broker owns authorization, sandboxing, privileged side effects,
   idempotency enforcement and audit projection.
8. Pi event translation must cover message deltas, terminal state, tool calls/results, permission
   requests, compaction, retry, usage and session state. Raw Pi payloads are diagnostic data, not
   persisted product truth or Renderer contracts.
9. `fake-runtime/v1` is a deterministic test double of the Pi Host/product-event boundary. It can
   validate M1 streaming, stop, failure, recovery and usage behavior, but it is never a production
   engine or an alternative harness.
10. The Pi package and its integration contract are pinned to explicit versions. Upgrades require
    contract tests and migration notes for event, session, tool and compaction changes. Supporting a
    different harness is post-V1 work and requires a superseding ADR.

## Consequences

- Fake Runtime makes GT-CHAT deterministic without a provider key or charge.
- A Runtime Host crash can fail only active generation attempts; committed history remains readable.
- Replacing the M1 test double with Pi cannot require rewriting persisted Conversation or Message
  rows.
- V2 may supervise and project an execution, but must not plan Pi steps, recreate Pi sessions, perform
  its own context compaction or run a competing retry/tool-call state machine.
- The archived `v1-backup/pi-mono/` tree remains reference-only; production uses the maintained Pi
  package selected and pinned during M4.

## Rejected alternatives

- **Generic multi-harness V1 adapter:** rejected because it optimizes an uncommitted future swap and
  weakens the concrete Pi integration contract.
- **V2-owned Execution Coordinator as an agent orchestrator:** rejected because it duplicates Pi's
  loop, recovery, retry and tool lifecycle.
- **Pi session as product history:** rejected because product history, sync and migration must remain
  readable independently of Pi internals.
