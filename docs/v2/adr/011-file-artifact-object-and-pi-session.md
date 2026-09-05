# ADR-V2-011: Device file scopes, cloud objects, artifact versions and Pi session recovery

- Status: Accepted and M4 local slice implemented
- Date: 2026-08-26
- Owners: Desktop, App Service, Platform and Pi Host

## Context

M4 must let a user select local files and folders, ground answers in stable source locations, create
versioned deliverables, and reopen those deliverables on another device. It must not turn a selected
path into ambient filesystem access, synchronize a device permission to another machine, expose raw
filesystem tools to Pi, or make Pi's private session log the product-history truth.

The same boundary must cover PDF, OOXML office formats, CSV/text/code/JSON/YAML, images and HTML;
corrupt, encrypted, oversized and unsupported inputs must fail with typed results. HTML is executable
content and therefore needs a stronger preview boundary than parsed office text.

## Decision

### Device access and controlled copies

Electron Main owns the native chooser. Each selection creates an exact file or directory `FileScope`
whose canonical root, access mode, expiry and revocation remain local. `FileScopeBroker` rejects
lexical traversal, real-path escape and every symbolic-link hop. Reads first copy bytes into a
profile-local SHA-256 content-addressed store; revoking the original scope does not destroy that copy.
Writes use an explicit read/write scope and exclusive creation with a collision suffix, so originals
are never silently overwritten.

### Personal files, citations and artifacts

`PersonalFile` is an account record over a controlled byte copy. Parsers emit typed citations using
page, sheet/range, slide, text-range or image-region locators. `Attachment` only links a PersonalFile
to a Conversation or Message.

`Artifact` has a stable account ID and an append-only sequence of `ArtifactVersion` records. Every
version has its own checksum, size, local content reference and cloud object ID. Editing appends a
version; downloading, previewing or reusing an artifact never depends on a Pi temporary path.

Office/PDF previews use parsed content. Text and HTML may expose source; HTML rendering uses an iframe
with `sandbox="allow-scripts"`, no `allow-same-origin`, no Node integration and no Preload Bridge.

### Account metadata and object synchronization

File metadata uses the existing operation/revision/cursor sync protocol. PersonalFile and
ArtifactVersion bytes move through a separate object service. Upload/download intents are short-lived,
single-use, account/session/device-bound tokens. The service validates exact byte count and SHA-256,
keeps object IDs immutable, and invalidates outstanding intents when the device session is revoked.

Sync payloads may contain display metadata, parsed text/citations, checksums, byte counts and stable
cloud object IDs. They must not contain `rootPath`, absolute/local paths, `sourceScopeId`, local
`objectRef`, permission grants or Pi session paths. A restored PersonalFile therefore has
`sourceScopeId = null`; a user must explicitly grant a new local path if later source access is needed.

### Pi integration and recovery

Pi Host continues to use Pi 0.84.4 as the only agent harness. It registers four product tools—file
list, search, cited read and artifact write—and disables Pi's raw built-in filesystem tools for this
surface. Tool calls use stable file/artifact IDs over a private protocol to App Service, where account,
attachment and Broker checks are applied.

Each Conversation maps to a persistent Pi `SessionManager` file in the device profile. The registry is
written atomically and can be rebuilt from Pi session headers after corruption. Pi owns context and
compaction; the independent Conversation/Message SQLite projection remains the recoverable product
history and is never replaced by Pi session storage.

## Consequences

- Revoking a source grant stops future source reads but preserves already imported controlled bytes.
- Cross-device recovery transfers account content without granting access to the original machine's
  filesystem.
- Large binaries stay outside sync metadata and can be independently retried and integrity checked.
- Pi can use files and create deliverables without receiving arbitrary paths or a parallel agent loop.
- Native Windows/macOS chooser, open/download and signed-package evidence remains a release gate even
  though the local implementation and deterministic fixtures pass.

## Rejected alternatives

- Synchronizing bookmarks, absolute paths or permission grants: paths are device-specific and this
  would fabricate authority on another machine.
- Giving Pi raw `read`, `write` or shell filesystem tools: this bypasses account attachment and Broker
  scope checks.
- Storing generated files only under Pi session/work directories: those paths are temporary and cannot
  provide stable versions or cross-device recovery.
- Rendering HTML in the Renderer origin or with `allow-same-origin`: that would make untrusted content
  materially closer to desktop bridge authority.
- Replacing product history with Pi SessionManager data: Pi sessions are implementation-private and
  cannot satisfy product sync, search, branch or deletion contracts.

## Evidence

Implementation and reproducible checks are recorded in
[公共测试说明](../../TESTING.md).
