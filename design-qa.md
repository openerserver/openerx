# Design QA — File Preview Side Panel

## Comparison target

- Source visual truth: `C:\Users\alexe\AppData\Local\Temp\codex-clipboard-99a3daae-5450-4fda-98ae-98ec61462ea3.png`
- Browser-rendered implementation: `C:\Users\alexe\Documents\ChatGPT\openerx\.codex-temp\qa-side-preview-desktop.png`
- Combined comparison evidence: `C:\Users\alexe\Documents\ChatGPT\openerx\.codex-temp\qa-side-preview-comparison.png`
- State: files library with `README.md` selected and Markdown preview open on the right.
- Reference pixels: 1842 × 1222, including Windows/Electron chrome at approximately 1.5× device density. The app content corresponds to roughly 1228 CSS px wide.
- Implementation pixels: 1226 × 758, normalized to the Electron content area's CSS size at 1× for comparison.
- Desktop CSS viewport: 1226 × 758.
- Narrow-window CSS viewport: 906 × 700.

## QA inventory and interaction coverage

- Selecting a file opens a preview beside the library: passed with normal click input.
- The preview is the library's right-hand sibling rather than a child below the list: passed by DOM structure and visible layout.
- Library and preview have independent vertical scrolling: passed; the library pane had `scrollHeight 1115 / clientHeight 758`, while the preview body scrolled independently.
- Selected file state is visible through `.library-card.is-selected` and `aria-pressed="true"`: passed.
- Preview/source mode switch: passed in both directions.
- Close restores the unsplit library width and removes the panel: passed.
- Narrow window keeps the preview anchored to the right as an overlay, with no horizontal document overflow: passed at 906 × 700.
- Console and renderer page errors: none observed after reload and the complete interaction flow.

## Full-view comparison evidence

The combined comparison shows the original files view on the left and the implementation after selection on the right. The established UWA sidebar, typography, color tokens, cards, spacing language, and content hierarchy remain consistent. The intentional change is that the library contracts into the left work area while a full-height preview panel occupies the right edge.

## Required fidelity surfaces

- Fonts and typography: existing UWA font stack, weights, sizes, line heights, wrapping, and hierarchy are preserved. Preview Markdown uses the existing application renderer and remains legible at both tested widths.
- Spacing and layout rhythm: the full-height panel aligns to the content area's top and bottom; its left divider creates a clear split. The list and preview each fit the viewport without document-level scrolling.
- Colors and visual tokens: existing workspace surface, border, accent, muted text, and active-state tokens are reused. No new off-system colors or gradients were introduced.
- Image quality and asset fidelity: no new image assets were required. Existing Phosphor icons and rendered document surfaces are retained.
- Copy and content: all existing library and preview labels are unchanged. The selected Markdown content renders through the existing preview path.

## Focused-region evidence

A separate crop was not needed: the original-resolution implementation screenshot keeps the entire right panel, header controls, Markdown typography, divider, and both scrollbars readable in one view. Numeric bounds additionally confirm the right-hand relationship: library pane `x 258 / width 561.45`, preview `x 819.45 / width 406.55`, with both at height 758.

## Comparison history

### Iteration 1

- Earlier finding [P2]: at the split width, the two library add buttons were compressed and their Chinese labels wrapped vertically.
- Fix: the library header switches to a stacked layout while the preview is open, and its action buttons use `white-space: nowrap`.
- Post-fix evidence: `qa-side-preview-desktop.png` shows both buttons on one readable row with no clipping or vertical label wrapping.

## Findings

No actionable P0, P1, or P2 differences remain. The narrower library column and stacked header controls are intentional consequences of the requested right-side preview.

## Follow-up polish

No blocking polish items. A future optional enhancement could add a draggable divider if user-controlled preview width becomes desirable.

## Final result

final result: passed

---

# Design QA — Composer Model + Thinking Selector

## Comparison target

- Source visual truth: `C:\Users\alexe\AppData\Local\Temp\codex-clipboard-ae28e30f-36f0-4c84-a052-12a6ee06d1ce.png`
- Implementation screenshot path: live Windows capture `screenshot://screenshot-0` from the running UWA Electron window (ephemeral capture reference).
- Viewport: UWA desktop window at 1229 × 815 logical pixels, density 1×.
- Source pixels: 1904 × 1066, including Windows/Codex chrome.
- Implementation pixels: 1229 × 815, including Windows/UWA chrome.
- Density normalization: compared by desktop CSS size and the composer region rather than raw full-window pixel scale.
- State: existing conversation, composer visible; closed combined trigger and open grouped-menu states both inspected.

## Full-view comparison evidence

The UWA composer now follows the Codex reference hierarchy: one compact model control sits in the bottom action row and displays both the active model and thinking strength. Permission remains a separate safety control, while Skill and context remain separate task controls. The rest of the UWA workspace and composer layout are unchanged.

## Focused-region evidence

The composer region was inspected at readable size in both states. The closed trigger reads `DeepSeek V4 Flash · 标准` with a lightning icon and caret. The open popup contains separate `模型` and `思考强度` groups, a divider between them, descriptions for model capability/context, and independent checkmarks for the selected model and selected thinking level.

## Required fidelity surfaces

- Fonts and typography: existing UWA font stack and text weights are preserved; the combined value remains on one line without truncating at the tested desktop width.
- Spacing and layout rhythm: two adjacent controls became one 220–300 px control; the menu opens upward with consistent 9/12 px option spacing and does not collide with the window edge.
- Colors and visual tokens: existing workspace surface, border, accent, muted text, and selected-state tokens are reused; no off-system palette or gradient was introduced.
- Image quality and asset fidelity: no raster assets were required. The lightning, caret, and check icons use the existing Phosphor icon library.
- Copy and content: the trigger combines the real model display name and localized thinking label; the popup retains model capabilities, context size, availability, and every supported thinking level.

## Interaction coverage

- One trigger exposes model and thinking choices: passed.
- Existing conversations keep separate model/thinking persistence calls: passed.
- New conversations can choose both values before sending: passed.
- Native semantic selects remain available to existing automation/accessibility paths: passed.
- Arrow-key navigation, Home/End, Escape, outside-click closing, selected, disabled, hover, and focus states remain supported by the shared menu component.
- Targeted renderer tests: 3 passed.
- Desktop TypeScript check: passed.

## Comparison history

### Iteration 1

- Earlier finding [P2]: the combined label inherited the old 116 px label limit and visually truncated the model name before the thinking value.
- Fix: increased the combined control to 220–300 px and its label allowance to 220 px.
- Post-fix evidence: the running UWA window shows the full `DeepSeek V4 Flash · 标准` label and the action row remains on one line.

### Iteration 2

- Earlier finding [P3]: the footer still presented permission, model, Skill, and context as a row of bordered fields, making the action area visually heavier than the Codex reference.
- Fix: converted those controls to quiet, borderless text actions; moved the combined model/thinking entry to the right; preserved an orange warning treatment for full-access mode; and removed the redundant keyboard hint from the conversation footer.
- Post-fix evidence: the same menu, focus ring, hover surface, selected states, and permission warning remain available without permanent pill borders.

## Findings

No actionable P0, P1, or P2 differences remain for the requested model/thinking merge. The composer footer now follows the Codex reference's quieter hierarchy while retaining UWA's red accent inside the opened menu.

## Follow-up polish

P3: on very narrow windows, the combined label will ellipsize before wrapping so the send action remains reachable.

## Final result

final result: passed
