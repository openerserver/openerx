# Codex 风格设置页 Design QA

## Artifacts

- source visual truth: `C:\Users\alexe\AppData\Local\Temp\codex-clipboard-97bfa152-9b01-4df0-a4ce-8518ad6427e0.png`
- implementation screenshot: `C:\Users\alexe\Documents\ChatGPT\openerx\.codex-temp\codex-style-settings-account.png`
- tool-section screenshot: `C:\Users\alexe\Documents\ChatGPT\openerx\.codex-temp\codex-style-settings-tools.png`
- normalized full-view comparison: `C:\Users\alexe\Documents\ChatGPT\openerx\.codex-temp\codex-settings-qa-comparison.png`
- focused comparison: `C:\Users\alexe\Documents\ChatGPT\openerx\.codex-temp\codex-settings-qa-focused.png`
- source pixels: 2239 × 1339
- implementation pixels / CSS viewport: 1229 × 815 at 1× density
- state: Windows Electron app, `/settings/account`, light theme, signed-out account, no dialog open
- density normalization: the 2239 × 1339 source was scaled proportionally to 815 px high (1363 px wide), then cropped only from the right to the 1229 px implementation width. The left settings rail and primary content origin remain intact. The implementation stayed at native 1× pixels.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- Fonts and typography: both use a compact Windows/system sans-serif stack with a 30–32 px primary title, 16 px section title, 13 px navigation labels, and restrained muted copy. Weight, hierarchy, line height, and truncation follow the reference without introducing a new display font.
- Spacing and layout rhythm: the settings rail, return action, search field, grouped navigation, selected pill, rounded content canvas, independent scroll region, content origin, section-heading gap, and card rhythm track the reference. Tall windows retain the reference's generous 140 px content offset; windows under 900 px high reduce it to 82 px to preserve the same proportional composition.
- Colors and visual tokens: the rail uses a low-contrast neutral surface, selected rows use a darker translucent neutral, and the content canvas remains white with quiet borders. OpenerX red is intentionally retained only for primary product actions and enabled tool switches.
- Image quality and asset fidelity: the reference contains no product imagery or decorative raster assets. Existing Phosphor icons are used consistently; no emoji, placeholder art, CSS illustration, handcrafted SVG, or fake asset replaces a visible source asset.
- Copy and content: navigation labels are intentionally limited to real OpenerX capabilities and grouped as “个人 / 智能与能力 / 应用”. The right-side content remains real OpenerX account/tool/model/memory/update/diagnostic functionality rather than copied Codex-only settings.
- Accessibility and affordances: “返回应用”, settings search, section buttons, selected state, tool search, tabs, add-tool flow, and existing settings forms remain keyboard-addressable with semantic labels.

## Full-view comparison evidence

`codex-settings-qa-comparison.png` shows the same two-region composition: a compact settings-only rail on the left and a large rounded white canvas on the right. The rail-to-content ratio, title origin, section hierarchy, muted palette, and selected-navigation treatment align after normalization. The implementation contains more empty space because the signed-out account state has one real card, while the reference's “常规” section contains multiple populated setting groups; this is an intentional content-state difference, not layout drift.

## Focused region comparison evidence

`codex-settings-qa-focused.png` keeps the navigation, search, selected row, primary title, section title, and first card readable at original comparison density. It confirms that icon size, row height, label rhythm, content inset, corner treatment, and vertical hierarchy match the reference direction closely.

## Comparison history

- Initial comparison — P2: the first implementation retained too little horizontal inset at wide sizes, used a narrower maximum rail, and did not visibly emphasize the selected settings row.
- Fix: changed the rail to `clamp(220px, 17vw, 376px)`, left-aligned the 1054 px content column with a `13vw` inset, and strengthened the neutral selected-row fill.
- Initial comparison — P2: the fixed 140 px top inset and 54 px title gap placed content too low in the real 1229 × 815 Electron window after normalizing the reference.
- Fix: added a height-aware breakpoint below 900 px that uses an 82 px top inset and 28 px title gap, while retaining the reference spacing on tall windows. Added explicit section headings so the title-to-card hierarchy matches Codex.
- Post-fix evidence: `codex-settings-qa-comparison.png` and `codex-settings-qa-focused.png` show the corrected content origin, selected state, section rhythm, and first-card placement.

## Primary interactions tested

- Settings opens as a full-window workspace without the app conversation sidebar.
- “返回应用” restores the previous application route.
- Settings search filters the grouped navigation and restores it when cleared.
- Section navigation changes active content and focus.
- Tool categories, tool search, add-tool dialog, Web Search settings, MCP OAuth state, and runtime status remain functional.
- Billing remains nested inside settings.

## Implementation checklist

- [x] Replace the former settings header/sidebar arrangement with the Codex-style full-window shell.
- [x] Add return-to-app and settings-search controls.
- [x] Group only real OpenerX sections in the left rail.
- [x] Match neutral selected-state and content-canvas styling.
- [x] Preserve every existing settings/tool workflow.
- [x] Add height-aware responsive spacing.
- [x] Verify the account and tool states in the real Electron window.
- [x] Run TypeScript and focused renderer tests.

## Follow-up Polish

- P3: Computer Use screenshots include the Windows pointer highlight over the selected navigation row; this is capture chrome and is not rendered by OpenerX.

final result: passed
