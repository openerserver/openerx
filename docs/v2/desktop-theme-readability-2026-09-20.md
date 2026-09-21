# Desktop theme readability — 2026-09-20

## Fix

The dark palette previously replaced the primary background with pale green while retaining white ink. Legacy fixed colors, undefined CSS variables and an independent UWA inline brand override also bypassed theme selection. Light mode inherited pale error/success labels and low-opacity metadata.

- Centralize paired workspace, foreground, action, status, border and code colors in `apps/desktop/src/renderer/theme.css`.
- Replace fixed application colors across settings, diagnostics, chat, automations, projects, remote settings, approvals, account access and workspace history with semantic tokens. Media/document preview pixels and QR images retain their own colors.
- Give native select options, placeholders, selection and keyboard focus explicit theme colors. Correct project-dialog primary actions and hover labels; remove opacity from file-count text.
- UWA retains its product identity, central-account extension and `OpenerX-Enterprise` data directory. Its `brand-theme.css` provides paired Unicom red colors for dark/light themes; the renderer no longer pins UWA's workspace accents using inline styles.

## Verification

- Both common regression runners include `tests/theme-contrast.test.ts`: normal/secondary/link text against workspace surfaces, primary normal/hover labels, semantic status pairs, code text, strong borders, and undefined CSS variables. UWA additionally tests its brand overlay.
- `npm run test:desktop-common`: openerx passed 332 desktop + 162 shared tests (494 total) and the five required project type checks.
- UWA `core/scripts/test-desktop-common.mjs`, executed with Node 24: passed 347 desktop + 162 shared tests (509 total), including the preserved mobile readiness tests and the five project type checks. The shell's initial Node 18 invocation was incompatible with current dependencies; Node 24 completed the runner successfully.
- `OPENERX_THEME_BROWSER_CHANNEL=chrome node apps/desktop/scripts/test-theme-rendering.mjs`: passed 120 rendered text/hover checks per edition, plus keyboard focus and placeholder checks. This uses an isolated headless browser with the real CSS and component fixtures, not a user browser profile. Text checks require at least 4.5:1; token tests require 3:1 for strong boundaries.
- Native Electron development windows, maintained by the existing `npm run dev:desktop` processes on ports 5173 / 5174, received the changes through Vite. Inspected dark and light appearance pages in both editions, openerx dark diagnostics cards, and UWA dark account settings. No app crash or unreadable inspected text.
- Changed files pass Biome's error gate and `git diff --check`. Existing stylesheet specificity warnings remain; rendered regressions cover the affected interaction states.

## Delivery boundary

This is source and local development-runtime verification. No package build, installed-application replacement, profile migration, credential change, release or deployment was performed. The UWA outer repository records the paired source/core revisions and reviewed edition overlays in its desktop parity manifest.
