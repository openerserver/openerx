# Electron and local App Service threat model

> Baseline: M0
>
> Date: 2026-08-25 (Asia/Shanghai)
>
> Scope: Electron Main, Preload, Renderer, App Service process and their local data/IPC boundaries

## Assets and security invariants

Protected assets are account sessions, OS credential handles, local conversation/cache data, file
grants, attachment/artifact content, model/payment credentials, tool approvals and update integrity.

The M0 invariants are:

1. Renderer has no Node, filesystem, process, credential, ledger-write or raw IPC authority.
2. Main is the only broker for windows, navigation, OS credentials, dialogs and process startup.
3. App Service is the only local database owner and cannot approve its own OS/tool capabilities.
4. Runtime and tool processes receive explicit, expiring capabilities rather than ambient user access.
5. Client-provided balance, payment-success or model-usage totals are never commercial truth.
6. V1 code and state cannot enter a V2 dependency graph or release artifact.

## Trust boundaries and attackers

- Remote content, pasted HTML, model output, attachments, web pages, MCP servers, Skills and Runtime
  output are hostile inputs.
- Renderer compromise is assumed possible; it must not become local code execution.
- Another local unprivileged process may attempt IPC connection, file replacement or credential reuse.
- A valid account on one device may attempt cross-account/cross-device access.
- Supply-chain packages and update infrastructure may be compromised.
- Physical administrator/root compromise and a fully compromised operating system are outside the
  app's prevention boundary; recovery and credential revocation still apply.

## Threats, controls and verification

| Threat | Required control | M0/M1 verification |
| --- | --- | --- |
| Renderer remote-code execution becomes Node execution | sandbox, no Node integration, context isolation, no webview | window-option unit test and packaged smoke test |
| XSS or model output invokes privileged IPC | frozen domain bridge, no raw IPC, strict request schemas | bridge review and contract rejection tests |
| iframe or unexpected window sends IPC | main-frame/window identity checks | forged sender integration test in M1 |
| Navigation loads a privileged remote page | deny new windows, prevent navigation, HTTPS allowlist only for OS handoff | URL/window policy unit tests |
| Malicious URL uses `file:`, `javascript:` or custom protocol | URL parser and explicit `https:` policy | scheme test matrix |
| Local process impersonates App Service | private MessagePort, random one-use boot nonce, contract negotiation | handshake replay/mismatch tests in M1 |
| App Service crash freezes UI or corrupts writes | utility process, bounded restart, transactional single-writer storage | crash-loop and transaction recovery tests in M1 |
| Database theft reveals reusable credentials | credentials outside DB; OS-protected key and authenticated field encryption | storage inspection and tamper tests in M1 |
| Path traversal or symlink escapes a grant | canonical path checks at capability broker and operation time | file-scope E2E in M4 |
| Runtime/Skill/MCP expands its own authority | separate process, capability port, explicit scope and approval | denial/revocation E2E in M5/M6 |
| Duplicate event/retry creates repeated state or charge | stable IDs, sequence checks and idempotency keys | contract tests from M1; billing tests in M3 |
| Client forges usage, balance or payment result | cloud Usage/Ledger/Payment services are sole truth | cross-account and replay E2E in M2/M3 |
| Package/update tampering | exact lockfile, CI, Electron fuses, signed/notarized release and signed feed | package inspection in M0; signing gate in M8 |
| Legacy implementation leaks into V2 | workspace isolation and source-boundary checker | `npm run check:boundaries:v2` |
| Secrets leak through logs/errors | stable error envelopes and structured redaction | snapshot/secret-canary tests before M2 |

## Default-deny behavior

- Unknown IPC channels, DTO fields, contract versions and process handshakes are rejected.
- New windows and in-app navigation are denied unless a future ADR grants an explicit route.
- External URLs are never loaded with a Preload Bridge.
- Tool, file, browser, desktop and MCP permissions do not imply one another.
- A failed security check produces a stable error and audit event; it does not silently downgrade.

## Residual risks and follow-up gates

- M0 output is unsigned and suitable only for development. Distribution waits for M8 signing and
  notarization evidence.
- Forge's Vite integration is experimental. Exact pins and three-target CI packaging contain, but do
  not eliminate, upstream compatibility risk.
- The stable Forge development dependency tree has known audit findings in archive/image build tools.
  They are excluded from the packaged runtime; CI uses the integrity-pinned lockfile and only trusted
  repository inputs. The risk remains open until upstream-compatible fixes are available.
- `node:sqlite` is not yet a stable Node API. The storage adapter and migration tests contain driver
  replacement risk; M1 must prove corruption recovery before persistent chat exits Alpha.
- Renderer sender verification and App Service boot authentication need process-level integration
  tests when the utility process is implemented in M1.

## Change rule

Any new Bridge method, local listener, custom protocol, navigation exception, persistent secret,
executable tool or update path must update this threat model and its automated verification in the
same change.
