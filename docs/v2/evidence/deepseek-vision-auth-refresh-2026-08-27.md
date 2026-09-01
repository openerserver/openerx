# DeepSeek Vision desktop authentication refresh evidence — 2026-08-27

## Reported failure

- Desktop conversation: `1d99aea9-d3de-489d-bc16-32feeb37b589`
- User message created at: `2026-08-27T00:43:24.511Z`
- The PNG attachment was already persisted, parsed as `ready`, and bound to the user message.
- The assistant message failed before provider execution with `ACCESS_TOKEN_INVALID`.

This rules out attachment selection, file ingestion, message binding, and image encoding as the cause of
the reported failure.

## Root cause

`IdentityService` rotates the refresh credential and removes older access tokens on every refresh. It
also revokes a device session when the immediately previous refresh credential is replayed.

`AccountSessionManager.accessToken()` previously allowed more than one near-expiry caller to refresh
the same active grant concurrently. The first caller rotated the credential; the second caller reused
the now-previous credential and triggered replay protection. The affected development session was
revoked at `2026-08-27T00:41:09.564Z`, after which the 00:43 image request used an access token that no
longer existed server-side.

## Fix

- Coalesce concurrent access-token refreshes into one shared in-flight promise.
- Reject a completed refresh with `AUTH_SESSION_CHANGED` if sign-out or another authentication change
  replaced the active grant while the network request was running.
- Add a regression test that starts two concurrent token requests behind a controlled refresh gate and
  proves the identity transport is called exactly once and both callers receive the same new token.
- Keep `@resvg/resvg-js` external in the App Service Vite bundle so the existing Office preview work
  does not make Rollup parse its platform-native `.node` binary as JavaScript during desktop startup.

## Verification

Commands:

```text
npx vitest run apps/desktop/tests/account-session-manager.test.ts
npm run typecheck --workspace @openerx/desktop
npx biome check apps/desktop/src/main/account-session-manager.ts apps/desktop/tests/account-session-manager.test.ts apps/desktop/vite.app-service.config.mts
npx vitest run apps/desktop/tests/account-session-manager.test.ts packages/file-service/tests/file-service.test.ts packages/pi-host/tests/platform-provider.test.ts services/model-gateway/tests/deepseek-model-executor.test.ts services/model-gateway/tests/model-gateway-service.test.ts
```

Results:

- Account-session regression: `7/7` passed.
- Related desktop/file/Pi/provider/model-gateway regression: `48/48` passed.
- Desktop typecheck: passed.
- Biome check for changed files: passed.
- Restarted development desktop: App Service reached `service.ready` at
  `2026-08-27T00:55:19.095Z`.

## Live image proof

- Source image: `codex-clipboard-54607bf1-37c5-4f27-aa84-13f1453b67ca.png`
- New desktop conversation: `42d5c425-4341-458c-991a-326422cc5717`
- Attachment: `image/png`, `369015` bytes, parse status `ready`
- Assistant result: `completed`, no error code
- Selected model: `platform/auto`
- Effective model: `platform/deepseek-v4-flash-vision-exp`
- Provider-reported aggregate usage shown by the desktop: input `8600`, cached input `0`, output
  `994`, reasoning `455`, total `9594`

The response correctly identified the attached screenshot as the UWA macOS AI conversation UI and
read the visible failed-generation message. This proves the desktop attachment-to-vision-model path,
not only a direct provider smoke request.

## Live expiry-window proof

The replacement device session initially held a version-2 token issued at
`2026-08-27T00:55:18.745Z`, expiring at `2026-08-27T01:00:18.745Z`. At the 30-second refresh window,
the running desktop rotated it once:

- session version: `2` → `3`
- refresh time: `2026-08-27T01:00:05.488Z`
- new token expiry: `2026-08-27T01:05:05.488Z`
- session `revoked_at`: `null`

A follow-up in the same image conversation was sent at `2026-08-27T01:01:08.355Z`, after that
rotation. The assistant completed at `2026-08-27T01:01:09.330Z` with no error and the desktop again
reported `platform/deepseek-v4-flash-vision-exp` as the effective model. This exercises the runtime
expiry boundary that previously revoked the session.
