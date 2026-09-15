# Desktop debugging and build storage

- When the task needs desktop runtime validation, use `npm run dev:desktop` from the repository root. Forge reuses `apps/desktop/.vite/` and the installed Electron runtime; keep the dev server running for renderer changes. Once it is ready, continue the task without waiting for the long-running process to exit.
- Package only when the change needs packaged-app validation or the user requests an application package. Use `npm run package:v2`, which replaces `apps/desktop/out/openerx-<platform>-<arch>/`. Stop the application using that output before replacing it.
- Do not create a new application name, dated output directory, `--out-dir`, or checkpoint `build/` directory for each debugging task. Do not copy `.app`, Electron distributions, `out/`, `.vite/`, `node_modules/`, or complete browser profiles into task checkpoints.
- Preserve source work with the existing Git commit plus a small source-only diff/archive when needed. Database changes may require a targeted database backup; ordinary UI changes do not require a complete user profile backup.
- When cleanup is requested or obsolete build artifacts block the task, preview cleanup with `npm run clean:desktop`. Add `-- --apply` to remove the listed unused build artifacts. `--legacy-checkpoints` also inspects recognized Electron outputs inside sibling checkpoint `build/` directories. Keep source archives, databases, screenshots, release installers, and running applications.

# Paired desktop delivery

- The open-source edition is `openerx`; `UWA` is the Unicom edition in the sibling `openerx-advanced` repository, with its common desktop implementation in `core/`.
- For a common desktop bug or behavior change, inspect and update both editions in the same task. Preserve UWA branding, its `OpenerX-Enterprise` data directory, and central-account extensions. Verify both editions before reporting the common issue fixed.
- Add meaningful common regressions to `scripts/test-desktop-common.mjs` in both common implementations. Run those checks and the UWA desktop parity check against the current openerx checkout; review and reconcile differences before refreshing the parity baseline.
- When the task includes updating the installed application, deliver and validate both desktop applications. Report code, package and runtime status separately; if one edition is blocked, name the blocker explicitly.
