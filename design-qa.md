# Design QA — OpenerX Context Dock

## Reference

- Selected visual target: `/Users/wanglei/.codex/generated_images/01a03954-f942-7b22-ac6f-820a18fe9269/exec-6351b972-0939-472c-81da-9e080839ae84.png`
- Surface: Electron desktop renderer, dark three-zone workspace direction.

## Checks

- The running Electron renderer was captured at `localhost:5173/#/chat/new` and visually checked for the dark workspace background, 258px navigation rail, green primary action, restrained suggestion list, and bottom composer.
- The conversation route is the only route that enables the Context Dock. The dock exposes close/reopen controls, one file workflow, parsed/pending states, and a safe local file picker.
- Existing route structure and bridge calls remain intact; no backend or persistence behavior was added.
- `npm run typecheck --workspace @openerx/desktop` passed.
- `npm run test --workspace @openerx/desktop` passed: 4 files, 14 tests.
- `npm run build:v2` passed and packaged the desktop app.
- `git diff --check` and targeted Biome checks passed.

## Result

final result: passed

Remaining follow-up: capture the conversation route with a real persisted conversation when the desktop test fixture exposes one, then compare the open drawer at the same viewport as the reference.

## Three-theme follow-up — 2026-08-25

- Added `system`, `dark`, and `light` preferences under account settings.
- `system` resolves from `prefers-color-scheme` and subscribes only while that preference is active.
- The selected preference persists as `openerx.theme`; unavailable storage falls back safely to `system`.
- Theme controls use native radio inputs with visible focus treatment and immediate application.
- Light-mode tokens cover the workspace, navigation, composer, Context Dock, settings, Billing, code blocks, status surfaces, and responsive layouts.
- Desktop renderer typecheck passed.
- Desktop renderer tests passed: 4 files, 15 tests, including all three theme selections and persistence.
- Targeted Biome and `git diff --check` passed after fixing the radio semantics and selector ordering.
- Electron Forge launched the native app and renderer successfully. A fresh native screenshot could not be captured because macOS was locked; no visual-pass claim is made for that locked run.
