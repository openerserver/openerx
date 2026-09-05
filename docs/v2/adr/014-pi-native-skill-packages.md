# ADR-V2-014: Pi-native Skill packages and Broker execution

> Status: Accepted and M7 local slice implemented
>
> Date: 2026-08-26 (Asia/Shanghai)

## Context

V1 requires bundled, personal and workspace Skills without introducing another agent loop or granting
package code direct filesystem, network, Shell, browser, desktop or MCP authority. A Skill must remain
an open directory package with progressive disclosure, visible provenance and a recoverable lifecycle.

## Decision

Pi remains the only Skill discovery and invocation engine. App Service supplies the enabled, resolved
package mounts for one generation. Pi's native resource loader parses name and description, exposes only
auto-invocable metadata to the model and expands an explicitly selected `/skill:name` command. OpenERX
does not add a second keyword matcher.

Packages contain `SKILL.md`, optional `scripts/`, `references/`, `assets/` and optional
`agents/openai.yaml`. The package service validates frontmatter and manifest schemas, copies content to a
profile-owned immutable version directory, rejects traversal/symlinks/oversized packages and records a
SHA-256 tree checksum plus a separate permission digest. Scope resolution is workspace over personal
over bundled; disabled, missing or damaged packages are excluded. A damaged higher-priority package is
isolated so a valid lower-priority package or ordinary chat can continue.

Full instructions are loaded only after explicit selection or a model decision based on Pi's native
metadata. Relative references use a custom `read` tool restricted to mounted package roots. Declared
scripts use `openerx_skill_script`; both become `PiToolRequestFrame` operations and enter the M5
Capability Broker. Resource reads are L0. Script execution is L5 and always requires exact per-call
approval in addition to package-permission approval. Script argv, root, timeout and network intent are
validated; a Skill cannot submit a raw shell command or idempotency key.

Install, enable, auto-invoke, permission approval/reset, update, rollback and uninstall are App Service
commands behind the typed Desktop Bridge. Versions are immutable. Permission-digest expansion clears
approval and disables execution until the current device reapproves it. Uninstall tombstones the record
and moves local content to the profile trash instead of deleting it immediately.

Account Sync carries installation identity, selected version/checksum, provenance, declarations and
non-sensitive settings. It never carries absolute package paths or device approvals. A second device
without matching content restores the record as missing, disabled and unapproved.

## Consequences

- Pi owns Skill matching, progressive loading and explicit expansion; V2 owns package state, scope,
  permissions, Broker execution and audit.
- Renderer never receives package paths or Node/filesystem access.
- Package approval does not waive per-call approval for L5 script execution.
- Local JavaScript script execution currently depends on a compatible host Node runtime. A bundled,
  signed cross-platform runtime must be proven before release packaging.
- Signed platform-catalog delivery, publisher trust verification and native Windows/macOS matrices remain
  release-environment work; local directory, ZIP and bundled package paths are implemented in M7.

## Rollback

Disable the installation or select an immutable prior version. Uninstall moves package data to the
profile trash and writes the sync tombstone. No Conversation, Message, Artifact or Pi session data is
deleted by Skill rollback.
