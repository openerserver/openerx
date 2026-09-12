# Desktop update validation — 2026-09-12

This source candidate applies the desktop improvements from local revision `fcd2d7d` onto public main `7d8e6eef3fa592cf4bd44c7ad622f8274dc80309`. It imports selected source changes, not the private repository's history, mobile application, enterprise assets, product decks, personal paths, profiles, or runtime logs.

## Behavior

- Expand projects into their conversations; exclude project conversations from the general history; delete conversations directly from lists.
- Hide unconfigured composer models. Paste image and file attachments, keep text paste unchanged, enforce input limits, and prevent late imports from attaching to a different conversation.
- Parse legacy XLS files using the exact SheetJS 0.20.3 official archive and its lockfile integrity. Picker and parser share the supported extension catalog. Third-party notices include the Apache-2.0 package.
- Collect generated workspace outputs, retain HTML relative assets, browse a file tree, search results, and open files/sources in independent preview tabs.
- Distinguish primary and additional directories, preserve an explicit conversation override, and remove duplicate effective directory grants.
- Classify model failures and persist provider-reported BYOK usage for new requests. Keep unknown usage unknown and separate these records from hosted billing.
- Keep approvals visible, handle queued approvals when permissions change, expose missing native permissions, and recover unreadable credentials only after backing up encrypted data.
- Preserve public main's managed Chromium, Chrome extension routing, browser settings, remote pairing, provider model additions and custom endpoints. Browser settings include the new permission guidance.
- Preserve the public executable, OS credential identity and workspace directory while using the lowercase openerx display name. Bump bundled Skills to 1.0.3 per brand so immutable installed packages can upgrade safely.
- Improve data export consistency and update-manifest bounds/product checks. Seal macOS packages after finalization and select artifacts through the product identity in packaging checks.

## Validation

- Workspace tests: 847 passed, 2 existing optional tests skipped. The final Desktop run contains 307 tests; all other workspace suites passed in the full workspace run.
- Cross-package integration: 109 passed, including the development remote gateway lifecycle.
- All workspace TypeScript checks passed. Source formatting, boundary and bundled Skill checks passed; existing lint warnings remain.
- Full dependency audit: zero reported vulnerabilities. Third-party inventory regenerated for 852 locked package paths; notice consistency checked separately from release approval.
- macOS arm64 package and package checks passed: fuses, artifact content, real packaged App Service startup, settings, five bundled Skills, automation listing, memory write and restart persistence. The test uses a temporary profile.
- Native clipboard E2E passed: text/table cells, image thumbnail, copied XLS, parsing, Pi file tool, message attachments and restart persistence. Model execution uses an isolated faux provider.
- Managed browser E2E passed: open/fill/invoke/navigation, stale-reference rejection, cross-origin denial, screenshot redaction, profile isolation, user takeover, resume and close.
- Original development checkout and user application data are not changed by this publication workflow.

## Existing source-gate limitation

`npm run check:source` still stops at `check:public` because six existing public main commits contain personal author emails and an older committed remote-test placeholder matches the provider-key detector. The current placeholder is replaced with a short explicit fixture; the old blobs and commit identities remain in public history. No history rewrite, rule exemption or check bypass is introduced. Functional checks listed above were run independently; this document does not claim the aggregate source gate or GitHub CI passes.

No Windows native run, official signing/notarization, new release tag, or GitHub Release is claimed. Existing third-party release review remains unapproved.
