# ADR-V2-018: Brokered Bash and platform sandbox boundary

- Status: Accepted; PBASH-001/PBASH-002/PBASH-003 local implementation complete, signed release pending
- Date: 2026-08-28
- Owners: Desktop, App Service, Pi Host and Security
- Supersedes: the Shell execution decision in ADR-V2-012

## Context

ADR-V2-012 introduced an argv-based `openerx_shell` adapter. It is auditable and safer than handing Pi a
host shell, but it does not preserve the raw Bash expression that makes Pi effective for normal coding
tasks. Enabling Pi's builtin Bash would restore that expression at the cost of moving process creation,
filesystem access and host environment authority into Pi Host.

The product needs raw Shell semantics without creating a second Agent Loop and without treating command
parsing or a working-directory string as a security boundary.

## Decision

Pi remains the only Agent Loop, while App Service remains the only authority boundary. Pi builtin tools
stay disabled with `noTools: "builtin"`. Pi Host may register an OpenERX-owned tool named `bash`, whose
model-visible input is limited to `command` and `timeout`. It preserves Pi's tool-call identity and sends a
strict, versioned `shell_command_execute` operation to the Capability Broker.

The operation's active and additional WorkspaceGrant IDs, execution profile, environment policy, network
policy and sandbox policy version come only from trusted product state. App Service freezes that execution
context per Generation. A Pi request that changes any frozen field is rejected, and grants are resolved
again immediately before dispatch so revocation, expiry and Conversation mismatch fail closed.

Real process creation belongs to a separate Brokered Shell Runner. The Runner may spawn only through a
verified `PlatformSandboxEngine` backend that declares and proves its filesystem, environment, network,
process-tree, cancellation and cleanup capabilities. Missing capabilities never fall back to an ordinary
host spawn. The initial profiles are `read_only` and `workspace_write`; network is denied by default and
the environment starts from a minimal `core` policy.

The first migration slice, PBASH-001, uses a deterministic fake adapter. It validates the full contract,
grant state and policy binding, returns `executionPerformed=false`, and never imports or invokes a process
API. `OPENERX_BROKERED_BASH_V1` defaults off. When enabled, legacy `openerx_shell` tools are suppressed;
if a trusted active workspace cannot be selected, Shell exposure is empty rather than falling back.

PBASH-002 adds explicit `fake`/`macos` runner modes, a stable `PlatformSandboxEngine` contract and a
`macos-seatbelt-v1` backend. App Service projects real `bash` only after the backend capability probe
passes. The backend launches `/bin/bash --noprofile --norc` through the external system
`/usr/bin/sandbox-exec` process, starts from an empty environment, denies network and broad Mach/process
access, constrains roots and resources, and owns one process group per ToolCall. A pre-spawn inode scan
rejects hard links with aliases outside the authorized root set or across writable/read-only boundaries;
the profile also denies creating hard links and file clones. PBASH-002 deliberately returned only bounded
final output.

PBASH-003 upgrades the private Pi IPC to v5 with ordered `pi.tool.progress` and request-scoped
`pi.tool.cancel`. Runner output is sanitized across chunks before progress, model context or Artifact
storage; model context is limited to 2,000 lines/50 KiB and the controlled text log to 2 MiB. Late frames,
Abort, Pi Host disconnect and AppService close are handled by the same pending-request and Runner cleanup
boundary.

## Consequences

- Models keep the familiar raw Bash call shape without receiving grant IDs, host paths or policy knobs.
- Pi Host cannot create a host process or approve a broader execution profile.
- App Service gains a generation-bound contract that later platform backends can implement without
  changing the model tool.
- PBASH-001 remains contract-only evidence; PBASH-002 supplies current-host macOS process, filesystem,
  environment, network, hard-link and process-tree evidence; PBASH-003 supplies local ordered progress,
  cross-chunk sanitization, cancellation and controlled-log evidence.
- `/usr/bin/sandbox-exec` is marked deprecated by the current macOS manual. It remains a replaceable local
  backend and cannot become release evidence without signed-package and supported-OS matrix validation.
- Linux and Windows remain unavailable; a missing or drifting backend never falls back to host Bash.

## Migration and rollback

- The private Pi IPC contract is version 5 after adding trusted execution context, ordered progress and
  request-scoped cancellation.
- The new path is creation-time gated by `OPENERX_BROKERED_BASH_V1`; existing Generations never hot-migrate.
- Disabling the flag restores the existing `openerx_shell` projection and leaves persisted ToolCalls
  readable.
- The legacy adapter is removed only after real platform backends, Golden A/B results and rollback evidence
  pass. It is never exposed beside brokered `bash` in one Generation.

## Rejected alternatives

- Enable Pi builtin Bash: process and filesystem authority would bypass the product Broker.
- Parse or blacklist dangerous command text: descendants, interpreters and path indirection make this an
  unreliable security boundary.
- Keep argv-only execution as the final Coding UX: it loses standard Shell composition and reduces task
  effectiveness.
- Require Docker or a VM on every platform: useful high-isolation backends remain optional implementations,
  not a universal product contract.
- Treat `/usr/bin/sandbox-exec` as a newly installed sandbox: it is only one macOS backend implementation
  detail, is deprecated by macOS, and still requires versioned policy and signed-build evidence.

## Verification

- [Brokered Bash architecture](../19-pi-bash-brokered-execution-plan.md)
- [PBASH implementation plan](../20-pbash-implementation-plan.md)
- [公共测试说明](../../TESTING.md)
- [公共测试说明](../../TESTING.md)
- `packages/contracts/tests/brokered-bash.test.ts`
- `packages/pi-host/tests/brokered-bash-tool.test.ts`
- `packages/tool-sdk/tests/brokered-bash-fake-adapter.test.ts`
- `packages/tool-sdk/tests/brokered-bash-adapter.test.ts`
- `packages/tool-sdk/tests/macos-sandbox-engine.test.ts`
- `packages/app-service/tests/tool-app-service.test.ts`
