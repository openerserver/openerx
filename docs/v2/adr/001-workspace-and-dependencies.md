# ADR-V2-001: Workspace and dependency direction

- Status: Accepted
- Date: 2026-08-25
- Owners: Desktop Foundation and Contracts & Quality

## Context

V2 must build independently from archived V1 code while keeping desktop, local services, cloud
services and reusable contracts in one repository.

## Decision

1. Use npm 11 workspaces rooted at `apps/*`, `packages/*` and `services/*`; commit `package-lock.json`.
2. Workspace packages use the `@openerx/*` namespace and exact external dependency versions.
3. `apps` and `services` may depend on `packages`. They may not import another app/service
   implementation. Cross-process and cross-service communication goes through `packages/contracts`.
4. `packages` may depend only on lower-level packages and external libraries. They may never depend
   on `apps`, `services` or `v1-backup`.
5. `v1-backup` is outside every workspace, quality command and production bundle.
6. Root commands ending in `:v2` are the only M0 quality/build entry points.

The dependency boundary is enforced by `npm run check:boundaries:v2` and CI. npm workspace linking
is documented in the [npm workspaces guide](https://docs.npmjs.com/cli/using-npm/workspaces/).

## Consequences

- V2 gets one reproducible lockfile and can refactor shared contracts atomically.
- Direct implementation coupling is rejected even when the source is in the same repository.
- Archived code remains available for read-only comparison without entering a V2 artifact.
