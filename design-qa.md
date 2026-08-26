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

## Unified sidebar scrolling — 2026-08-26

### Evidence

- Source visual truth: `/var/folders/1v/0886jgvs7hg9chd3jqlcnxfm0000gn/T/codex-clipboard-f0dc8dc6-cdf2-4b81-9b6b-7c2282c74743.png`
- Final Electron screenshot: `/var/folders/1v/0886jgvs7hg9chd3jqlcnxfm0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-08-26 at 6.27.37 PM.jpeg`
- Scrolled interaction screenshot: `/var/folders/1v/0886jgvs7hg9chd3jqlcnxfm0000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-08-26 at 6.27.26 PM.jpeg`
- Full-view comparison: `/tmp/openerx-sidebar-qa.XsH9XW/full-comparison.png`
- Focused sidebar comparison: `/tmp/openerx-sidebar-qa.XsH9XW/sidebar-comparison.png`
- Viewport/state: 1162 × 768 desktop capture, light theme, `#/chat/new`, two local history rows. The overflow interaction was exercised at three zoom increments and then reset to default zoom.
- Density normalization: the 2408 × 1588 source was scaled to 1162 × 768 beside the 1162 × 768 implementation capture. The focused comparison uses matching 242 × 738 sidebar crops.

### Findings

- No actionable P0, P1, or P2 issues remain.
- Typography: existing product font family, weights, truncation, and hierarchy remain unchanged and align with the reference sidebar.
- Spacing/layout: Logo and `新对话` remain in a fixed top group. `搜索` through `设置` and `历史` now occupy one scroll region. Sync and account controls remain fixed below it.
- Colors/tokens: no color or theme token changed; light-mode surfaces and semantic green remain aligned with the reference.
- Image quality/assets: the existing official China Unicom logo and Phosphor icons are preserved without replacement or raster degradation.
- Copy/content: all sidebar labels and history metadata are unchanged. The implementation screenshot has fewer history rows because it uses current local data rather than the reference fixture.

### Interaction and console checks

- Scrolled down inside the sidebar at high effective density: upper menu rows moved upward together with history while Logo and `新对话` stayed visible; sync and account controls also remained fixed.
- Restored default zoom after the interaction check.
- The Electron development process showed no renderer error caused by the sidebar change. The existing `PLATFORM_ENDPOINT_NOT_CONFIGURED` model-catalog message remains unrelated to this layout work.

### Comparison history

- Earlier finding [P1]: the first grouping placed Logo, `新对话`, the remaining menu, and history in the same scroll container, which contradicted the clarified requirement that `新对话` stay alone at the top.
- Fix: split the fixed `.sidebar-top` group from `.sidebar-scroll`; kept only Logo and `新对话` in the fixed group.
- Post-fix evidence: the scrolled interaction screenshot keeps `新对话` stationary while the main menu and history move as one region.

### Verification

- `npm run typecheck --workspace @openerx/desktop` passed.
- `npm run test --workspace @openerx/desktop -- --run tests/chat-ui.test.tsx` passed: 1 file, 12 tests.
- `git diff --check` passed.

final result: passed
