# Desktop and local service security boundaries

Scope: Electron Main, Preload, Renderer, App Service, Pi Host, Tool SDK and shared Remote Host. This is a public technical model, not a claim that every platform has completed release validation.

## Assets and invariants

Protect model/MCP credentials, local conversations and files, device keys, directory grants, approvals and update trust. Treat model output, documents, pages, Skills, MCP services and remote envelopes as untrusted.

- Renderer has no direct Node, filesystem, credential or arbitrary IPC authority.
- Main brokers OS dialogs, protected credentials, navigation and process startup through validated typed contracts.
- App Service owns local product state and transactions, but cannot grant itself host/tool permissions.
- Pi owns the Agent harness, not permission policy. Tool calls still require the appropriate Broker checks.
- Remote transport delivers encrypted commands; authenticated delivery is not approval to execute.
- Credentials and device grants are not ordinary synchronized content. User-requested data exports and redacted diagnostics have different contents and authority.

## Controls and tests

| Risk | Control and public verification |
| --- | --- |
| Renderer compromise reaches host authority | sandbox, context isolation, frozen preload contracts, trusted-frame IPC and desktop security tests |
| Lost credentials or log disclosure | OS-protected credential storage, opaque references and redaction canaries |
| Unauthorized tool or file access | canonical scope checks, exact-operation approvals and platform-backend tests |
| Replay or process restart repeats effects | persistent identities, payload digests, transactions and recovery tests |
| Untrusted Remote or Relay | E2EE, sequence/expiry/revocation and host reauthorization tests |
| Package/update substitution | lockfile, fuses, native signatures, signed manifests and package verification |
| Private material enters public source | file/history checks, privacy metadata checks and manual edition-boundary review |

## Limits

Local storage is not universally encrypted; see [privacy](../../PRIVACY.md). Sandbox behavior differs by OS: a write boundary is not a guarantee of read confidentiality. Full OS/administrator compromise is outside the application's prevention boundary. Native signing, platform behavior, privacy review and recovery drills need real evidence for each release; see [release gates](../../RELEASE_GATES.md).

Changes to IPC, listeners, navigation, persistent secrets, tools or updates must keep this model and their automated tests consistent. A failed check must not silently weaken the boundary.
