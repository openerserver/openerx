# Working in openerx

- Use Node.js 24.3.0 or newer and npm workspaces from the repository root.
- Read the relevant source and tests before changing behavior. Preserve unrelated work and record a recoverable source checkpoint when needed.
- Use `npm run dev:desktop` for desktop runtime checks. Keep its server running for renderer changes and reuse `apps/desktop/.vite/`.
- Package only for packaged-app validation or an explicit package request. Use `npm run package:v2`, exit the application before replacing its fixed output, and keep outputs under `apps/desktop/out/`.
- Never copy application bundles, Electron distributions, dependency trees or complete user profiles into checkpoints.
- Keep the product name lowercase `openerx`. Preserve persisted identifiers and upgrade compatibility unless a migration is explicitly part of the task.
- Run relevant tests and `npm run check:public-surface`. Generated reports belong under ignored `artifacts/` directories.
- Run checks, tests, builds and release verification locally. Before pushing code, run `npm run check:local`; run packaging and desktop E2E on the target operating system when required. Report commands, results and unverified platforms. Do not add or run GitHub Actions workflows unless the user explicitly changes this policy; GitHub hosts source and uploaded releases only.
- Public documentation is limited to `README.md`, `AGENTS.md`, `SECURITY.md`, and the four guides in `docs/`. Update these guides instead of adding task logs, proposals or presentations. A deliberate documentation expansion must update the allowlist in `scripts/check-public-surface.mjs`.
- Never commit credentials, user data, private infrastructure addresses or local build products. Report source, runtime and packaged-release verification separately.
