# BCU-003 Physical Takeover Live Gate — 2026-08-28

- Environment: local unlocked macOS desktop, system-default Google Chrome
- Result: `PASS — PHYSICAL EXACT-WINDOW INPUT + TRUSTED TOOL CENTER LIVE GATES`
- Scope: exact-window human-input monitor and production Main/Preload/Renderer/Pi takeover controls
- Historical implementation checkpoint: [bcu-003-2026-08-27.md](bcu-003-2026-08-27.md)

## Finding

The live runner now reaches its exact dedicated Chrome window on the unlocked machine. Computer Use actions
generated through Accessibility or the automation input path do not appear at the read-only macOS
`.cgSessionEventTap` used to identify human takeover. This is the required security separation: an Agent
must not pause itself and claim that the user took control.

The monitor reports only that an eligible event occurred. It emits no key, text, pointer coordinate or page
payload. The product must not broaden it to Accessibility notifications merely to make an automated live
test pass, because that would make the Agent's own semantic actions indistinguishable from human takeover.

## Initial no-input run

Command:

```bash
npm run test:e2e:browser:takeover:macos --workspace @openerx/desktop
```

The prepared fixture opened and reached:

```text
BCU_TAKEOVER_WAITING:{"nativeWindowId":"mac_window_151575","requiredInput":"physical_pointer_or_keyboard","target":"exact_dedicated_window","timeoutMs":120000}
```

No physical input was supplied before the deadline, so the runner failed closed:

```text
BCU_TAKEOVER_FAILED:wait-user-input:BCU_TAKEOVER_INPUT_TIMEOUT
```

No `apps/desktop/.vite/browser-takeover/evidence/result.json` was generated. The dedicated fixture window was
closed by cleanup.

## Passing physical-input run

The runner was repeated with a ten-minute operator window:

```bash
OPENERX_BCU_TAKEOVER_TIMEOUT_MS=600000 \
  npm run test:e2e:browser:takeover:macos --workspace @openerx/desktop
```

After the runner opened `mac_window_151685`, the operator physically clicked the blue fixture panel. The
runner completed:

```text
BCU_TAKEOVER_OK:{"contractVersion":"browser_computer_use_v2","backend":"system_default","controlPath":"os_accessibility","nativeWindowId":"mac_window_151685","inputGate":"physical_exact_window_event","inputTimeoutMs":600000,"pausedAt":"2026-08-28T06:47:07.797Z","pausedState":"paused_for_user","pausedObserveRejected":true,"pausedActionRejected":true,"resumedWithFreshObservation":true,"oldObservationRejectedAfterResume":true,"closeState":"closed"}
```

Evidence artifact:

```text
path   apps/desktop/.vite/browser-takeover/evidence/result.json
mode   0600
sha256 d6bd78f95f4b7ffccfbbb2a8d85fe54f2aa592af5a21184aaa588bef863a4439
```

The result proves that an event in the exact dedicated window immediately paused automation, observation
and action were refused while paused, resume created a fresh baseline, the pre-takeover Observation stayed
expired, and the owned window closed cleanly.

## Passing trusted Tool Center run

Command:

```bash
npm run test:e2e:browser:tool-center:macos --workspace @openerx/desktop
```

The E2E launches the Desktop package root with the deterministic Pi fixture, opens a loopback page through
the production `browser_computer_use_v2` tool path, and then uses the real Renderer buttons through Preload,
trusted IPC and Main. It finally closes the owned browser window through Pi `observe` followed by `close`.
No production test backdoor is used.

The passing marker was:

```text
BCU_TOOL_CENTER_OK:{"contractVersion":"browser_computer_use_v2","backend":"system_default","controlPath":"os_accessibility","nativeWindowId":"mac_window_151985","rendererPageDataAbsent":true,"rendererIframeCount":0,"trustedPauseState":"paused_for_user","trustedResumeState":"active","closeState":"closed"}
```

Evidence artifact:

```text
path   apps/desktop/.vite/browser-tool-center/evidence/result.json
mode   0600
sha256 94bb07c6b5445753830546bab7444cecb20805769dc5d70c4970a07d55883400
```

The Renderer exposed only browser/backend/control-path/state metadata. Assertions proved that it contained
no iframe, fixture title, loopback URL or raw `com.google.Chrome` identifier. Pause reached
`paused_for_user`, resume returned to `active`, and close removed the session and exact owned window.

An initial E2E attempt launched Electron with the compiled `main.js` file as its application path. That
made `app.getAppPath()` unsuitable for the production helper lookup and correctly failed with
`BROWSER_BACKEND_UNAVAILABLE`. The runner now launches the Desktop package root, matching the real app path
contract; it does not inject a helper path or bypass readiness checks.

## Synthetic-input diagnostic

Before the manual gate, an unfiltered one-shot `.cgSessionEventTap` probe was armed. A Computer Use
Accessibility element click, a coordinate click and a key press produced no event in that probe. The same
actions also did not pause three dedicated takeover fixtures. `CGPreflightListenEventAccess()` returned
`true`, so the observation is not explained by missing macOS listen-event permission.

This diagnostic alone is negative boundary evidence. The passing physical-input run above supplies the
separate positive proof that a physical event reaches the monitor.

## Runner correction

`apps/desktop/scripts/e2e-browser-computer-use-takeover.mts` now:

- labels the required source as `physical_pointer_or_keyboard`;
- tells the operator that automation-generated Computer Use input is not accepted;
- waits 120 seconds by default and validates a configurable 10-second-to-10-minute timeout;
- labels successful evidence as `physical_exact_window_event`.

## Regression proof

Commands completed after the runner correction:

```bash
npm run typecheck --workspace @openerx/desktop
npm run test --workspace @openerx/desktop -- \
  --run tests/browser-computer-use-system-default.test.ts tests/chat-ui.test.tsx
npx biome check apps/desktop/scripts/e2e-browser-computer-use-takeover.mts
npm run test:e2e:browser:tool-center:macos --workspace @openerx/desktop
npm run check:v2
```

Results:

- the targeted Desktop suite passed 2 files / 43 tests;
- the full Desktop suite passed 12 files / 89 tests;
- V2 boundaries, release graph, local release readiness, lint and every workspace typecheck passed;
- every workspace and root V2 test suite passed, including contracts 3 files / 31 tests and root V2
  12 files / 61 tests;
- mobile iOS/Android export, Desktop arm64 package, fuse and release-artifact verification passed;
- native signature verification correctly remained `LOCAL UNSIGNED` and is not signing evidence.

## Remaining BCU-003 gates

1. Implement and validate signed Browser Bridge exact-tab authorization.
2. Validate Accessibility and Screen Recording permission retention in a signed installed build.

BCU-003 remains partial, but this file is valid PASS evidence for both the physical exact-window input and
trusted Tool Center live gates.
