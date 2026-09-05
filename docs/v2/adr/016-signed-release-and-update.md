# ADR-V2-016: Signed desktop releases and update trust

- Scope: Windows x64 and macOS arm64/x64 desktop packages.
- Extends: [ADR-V2-002](002-electron-build-release.md).

## Decision

1. Internal, preview and stable channels are distinct. Stable requires completed desktop evidence and explicit approval, not just a successful local build.
2. Signing mode embeds only the update manifest URL, key ID and Ed25519 public key. Native signing credentials and the manifest private key stay in the protected release environment.
3. Main verifies manifest size, schema, signature, channel, version, time, rollout and platform/architecture before invoking the native updater. Renderer receives typed status rather than authority to choose an update feed.
4. Windows uses native Authenticode signing. macOS uses Developer ID and notarization. Signature, Electron fuses, package-content and release configuration verification must pass.
5. Artifacts, hashes and signed manifests are immutable release facts. Publish verified artifacts before publishing the manifest that authorizes them.
6. Stop bad rollouts. Recovery normally rolls forward with a higher patch version from a known-good source, preserving user data and schema compatibility; do not disable signatures or permit unsigned downgrades.
7. Key rotation requires an authenticated bridge to a new trust root. Losing signing authority is not permission to bypass verification.

Public CI may produce explicitly unsigned development packages. Mobile application distribution and commercial deployment are separate enterprise processes. The current desktop evidence requirements are in [release gates](../../RELEASE_GATES.md); operational setup is in [publishing](../../PUBLISHING.md).
