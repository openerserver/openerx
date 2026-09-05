# ADR-V2-012: Capability Broker, host adapters and Pi tool projection

- Status: Accepted and M5 local slice implemented
- Date: 2026-08-26
- Owners: Desktop, App Service, Pi Host and Security
- Partially superseded by: ADR-V2-017 for browser automation and browser profile selection

## Context

M5 adds Web search, platform image generation, isolated browser automation, Shell/code execution,
desktop control and MCP. These capabilities cross network, process, filesystem, credential and desktop
trust boundaries. Pi must remain the only agent harness and tool-lifecycle owner, while the product must
show durable task progress, ask for permission before expanding authority, and recover safely after a
host crash.

The implementation must also avoid three look-alike executors: a Renderer tool runtime, an App Service
planner, or a WorkItem workflow engine. Product records are projections of Pi activity, not a second
source of execution truth.

## Decision

### Pi owns invocation; Broker owns authority

Pi Host registers product `ToolDefinition` values and sends a typed `pi.tool.request` containing the Pi
call reference, product generation context, operation and host-derived idempotency key. Pi waits for the
normalized result and continues its own Agent Loop. It retains tool ordering, retry, compaction and
abort semantics.

App Service owns `CapabilityBroker`. The Broker maps every operation to a capability, resource, action
set and L0-L5 risk; checks an unrevoked, unexpired Scope; creates an exact SHA-256 payload approval when
needed; dispatches one adapter; and commits/replays side effects by idempotency key. Changed payloads do
not reuse an approval. L4/L5 high-impact actions cannot create persistent grants.

### Process and credential boundaries

Deterministic calculation and structured-data transforms run in App Service. Authenticated Web search
and image generation call first-party platform endpoints using the generation's account token. Shell
runs argv without a shell, canonicalizes the working directory under the Pi workspace, denies network
by default, caps output, applies timeouts and kills the process group on cancellation or shutdown.

Browser and desktop operations execute only in Electron Main. Browser sessions use dedicated in-memory
`openerx-isolated-browser-*` partitions, sandboxed windows with no preload/Node authority, fixed HTTP(S)
navigation policy and a profile download directory. Uploads carry a stable PersonalFile ID; App Service
resolves only its M4 controlled copy and Main rejects paths outside the profile CAS. Downloads return a
private path only across Main's internal port; App Service immediately imports it and returns only the
new PersonalFile ID and display name to Pi. Desktop capture/control uses native OS mechanisms;
submit, send, purchase and delete always require per-call approval.

The paragraph above records the M5 implementation. Its Browser DOM/selector contract and isolated-browser-
only product choice are superseded by [ADR-V2-017](017-browser-computer-use-host-and-contract.md). The M5
runtime remains `legacy_dom_v1` during staged migration and is not evidence that the new system-default or
managed-Chromium backends are implemented.

MCP uses the official v2 TypeScript client for STDIO and Streamable HTTP. Bearer secrets and OAuth
client credentials are referenced from Electron Main's OS-protected tool vault; Renderer, SQLite and Pi
never receive the secret. Disabling a server closes its client/child and clearing authorization removes
the vault entry.

### Durable product projection

`WorkItem`, `ExecutionRun`, `RunStep`, `ToolCall` and `PermissionRequest` are account/profile-scoped
SQLite projections. They record Pi package/contract versions, summaries, risk, status and error codes,
but never become an executable step plan. Startup recovery fails interrupted calls/runs, expires pending
approvals and revokes temporary scopes. The conversation remains independently readable after any tool
failure.

## Consequences

- No tool adapter can grant itself authority or bypass the Broker.
- Renderer exposes narrow task, permission, Scope and MCP configuration methods, not raw IPC or generic
  execution.
- Browser upload cannot turn a model-provided path into local file access; it reuses M4 PersonalFile
  identity and controlled bytes.
- Browser downloads enter the same controlled file store and never expose a device path to Pi or
  Renderer.
- Long-running Shell children and isolated browser windows have one owner and are reclaimed by stop,
  disconnect or supervisor shutdown.
- First-party Web/image operations depend on authenticated platform endpoints; real provider evidence
  remains an environment gate.
- M5 does not implement Skill loading or lifecycle. GT-TOOL-07 through GT-TOOL-09 remain M7 gates.

## Rejected alternatives

- A V2 workflow executor over WorkItem/RunStep: duplicates Pi's Agent Loop and retry semantics.
- Giving Pi direct `child_process`, Electron or arbitrary network access: bypasses product Scope and
  audit policy.
- Reusing the user's daily Chrome/Edge profile: leaks ambient cookies and makes session authority
  unreviewable.
- Saving MCP tokens in Renderer state, Pi history or SQLite: exposes reusable credentials outside Main.
- Approving by tool name only: a later payload could change the target or side effect.

## Evidence

Implementation and reproducible checks are recorded in
[公共测试说明](../../TESTING.md).
