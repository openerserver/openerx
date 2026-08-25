# Electron and local App Service threat model

> Baseline: M1 Chat Alpha
>
> Date: 2026-08-25 (Asia/Shanghai)
>
> Scope: Electron Main, Preload, Renderer, App Service, Pi Host and planned Remote Host Connector boundaries

## Assets and security invariants

Protected assets are account sessions, OS credential handles, Remote device keys/pairings, local
conversation/cache data, file grants, attachment/artifact content, model/payment credentials, tool
approvals and update integrity.

The M1 invariants are:

1. Renderer has no Node, filesystem, process, credential, ledger-write or raw IPC authority.
2. Main is the only broker for windows, navigation, OS credentials, dialogs and process startup.
3. App Service is the only local database owner and cannot approve its own OS/tool capabilities.
4. Pi owns the agent harness but is not an authority boundary; Pi Host and tool processes receive
   explicit, expiring capabilities rather than ambient user access.
5. Client-provided balance, payment-success or model-usage totals are never commercial truth.
6. V1 code and state cannot enter a V2 dependency graph or release artifact.

## Trust boundaries and attackers

- Remote content, pasted HTML, model output, attachments, web pages, MCP servers, Skills and Pi
  output are hostile inputs.
- Renderer compromise is assumed possible; it must not become local code execution.
- Another local unprivileged process may attempt IPC connection, file replacement or credential reuse.
- A valid account on one device may attempt cross-account/cross-device access.
- A lost or malicious phone, forged pairing QR, compromised Relay, replayed Remote command or competing controller may attempt to control the desktop.
- Supply-chain packages and update infrastructure may be compromised.
- Physical administrator/root compromise and a fully compromised operating system are outside the
  app's prevention boundary; recovery and credential revocation still apply.

## Threats, controls and verification

| Threat | Required control | M0/M1 verification |
| --- | --- | --- |
| Renderer remote-code execution becomes Node execution | sandbox, no Node integration, context isolation, no webview | window-option unit test and packaged smoke test |
| XSS or model output invokes privileged IPC | frozen domain bridge, no raw IPC, strict request schemas | bridge review and contract rejection tests |
| iframe or unexpected window sends IPC | main-frame/window identity checks | trusted-main-frame and forged-frame rejection tests |
| Navigation loads a privileged remote page | deny new windows, prevent navigation, HTTPS allowlist only for OS handoff | URL/window policy unit tests |
| Malicious URL uses `file:`, `javascript:` or custom protocol | URL parser and explicit `https:` policy | scheme test matrix |
| Local process impersonates App Service | private MessagePort, random one-use boot nonce, contract negotiation | nonce mismatch, version mismatch and duplicate-handshake rejection tests |
| App Service crash freezes UI or corrupts writes | utility process, bounded restart, transactional single-writer storage | live Electron crash injection plus interrupted-message recovery E2E |
| Database theft reveals reusable credentials | credentials outside DB; OS-protected key and authenticated field encryption | M1 schema inspection proves no credential/token tables; OS store and encrypted account fields remain M2 |
| Path traversal or symlink escapes a grant | canonical path checks at capability broker and operation time | file-scope E2E in M4 |
| Pi/Skill/MCP expands its own authority | isolated Pi Host, V2 capability port, explicit scope and approval; Pi tool lifecycle does not grant side-effect authority | denial/revocation E2E in M5/M7 |
| Remote exposes a desktop listener | supervised Connector makes outbound TLS/WSS connections only; no localhost/public Remote server | socket scan and packaged-host E2E in M6 |
| Forged/replayed/expired Remote command controls Pi twice | same-account pairing, device signatures, E2EE, TTL, sequence, baseRevision and host idempotency | mutation, replay, reorder and duplicate E2E in M6 |
| Lost/revoked phone continues approval or event access | protected device key, biometric gates, immediate pairing/session revocation and short-lived encrypted resources | lost-device/revocation E2E in M6 |
| Relay or push leaks content | Relay routes ciphertext only; push uses opaque IDs; redacted metadata logs | ciphertext/log/push canary tests in M6 |
| Duplicate event/retry creates repeated state or charge | stable IDs, sequence checks and idempotency keys | contract tests from M1; billing tests in M3 |
| Client forges usage, balance or payment result | cloud Usage/Ledger/Payment services are sole truth | cross-account and replay E2E in M2/M3 |
| Package/update tampering | exact lockfile, CI, Electron fuses, signed/notarized desktop release, signed mobile release and signed feed | package inspection in M0; signing gate in M9 |
| Legacy implementation leaks into V2 | workspace isolation and source-boundary checker | `npm run check:boundaries:v2` |
| Secrets leak through logs/errors | stable error envelopes and structured redaction | snapshot/secret-canary tests before M2 |

## Default-deny behavior

- Unknown IPC channels, DTO fields, contract versions and process handshakes are rejected.
- New windows and in-app navigation are denied unless a future ADR grants an explicit route.
- External URLs are never loaded with a Preload Bridge.
- Tool, file, browser, desktop and MCP permissions do not imply one another.
- A failed security check produces a stable error and audit event; it does not silently downgrade.

## Residual risks and follow-up gates

- M0 output is unsigned and suitable only for development. Distribution waits for M9 signing and
  notarization evidence.
- Forge's Vite integration is experimental. Exact pins and three-target CI packaging contain, but do
  not eliminate, upstream compatibility risk.
- The stable Forge development dependency tree has known audit findings in archive/image build tools.
  They are excluded from the packaged runtime; CI uses the integrity-pinned lockfile and only trusted
  repository inputs. The risk remains open until upstream-compatible fixes are available.
- `node:sqlite` remains an experimental Node API. Ordered checksummed migrations, startup
  `quick_check`, transactional tests, newer-schema refusal and corrupt-file fail-closed tests contain
  data-loss risk; automated restoration from a backup remains a later reliability feature.
- M1 process E2E runs natively on the development macOS arm64 host. Windows x64 and macOS x64 are
  cross-packaged locally and have native E2E jobs in CI; hosted results are required before release.

## Change rule

Any new Bridge method, local listener, custom protocol, navigation exception, persistent secret,
executable tool or update path must update this threat model and its automated verification in the
same change.
