# BCU-003 Browser Bridge security foundation evidence — 2026-08-28

- Date: 2026-08-28 (Asia/Shanghai)
- Result: `LOCAL DETERMINISTIC PASS / SIGNED BRIDGE RUNTIME NOT YET AVAILABLE`
- Branch: `codex/bcu-sync-20260827`
- Scope: closed Browser Bridge protocol, authenticated local grant state, exact-tab Adapter path and
  security-negative tests
- Excluded: installable MV3 extension, packaged Native Messaging Host, owner-only Main socket/endpoint
  record, native Chrome-window correlation, trusted connect/revoke UI, signed-install persistence and a
  real Browser Bridge website smoke test

## Implemented boundary

The local foundation adds:

- `browser-bridge-protocol.ts`: strict `openerx_browser_bridge_v1` authorization, observe, action, event,
  grant-accept and release messages; bounded message size; HTTP(S)-only URL/origin; visible semantic
  elements; sensitive-value rejection; and a closed action union with no selector, DOM/HTML, arbitrary
  JavaScript or generic DevTools command. A baseline/re-navigation requires a redacted PNG, while a stable
  later observation may return semantics only and reuse the prior screenshot digest; this is not a
  screenshot-only loop.
- `browser-bridge-grant-registry.ts`: exact extension-origin and per-launch Main nonce checks; trusted-Main
  application/PID/native-window identity; five-minute maximum authorization TTL; random one-time
  `browserContextRef`; exact-URL claim; duplicate authorization rejection; immediate `grant_accepted`
  handshake; monotonically increasing sequence validation; same-origin navigation invalidation; and
  fail-closed tab switch, cross-origin navigation, revoke, malformed response, replay or disconnect.
- `connected-browser-bridge-driver.ts`: maps the closed protocol to filtered Observation and bounded
  semantic/browser actions, rejects coordinate fallback and user-owned-tab close, and enters user takeover
  before sending sensitive-field input.
- `system-default-browser-adapter.ts` and `tool-capability-host.ts`: optional exact-tab Bridge control path
  alongside the existing dedicated-window AX path. With no authenticated driver injected,
  `browserContextRef` remains fail-closed.

The authorization result returned to trusted UI contains only an opaque context reference, browser
application ID, authorized origin and expiry. Pi-visible results contain neither Chromium `tabId` nor
`browserWindowId`; Main combines those extension-side IDs with the separately resolved native identity.

## Deterministic security results

Command:

```bash
npm test --workspace @openerx/desktop -- tests/browser-computer-use-browser-bridge.test.ts tests/browser-computer-use-system-default.test.ts
```

Result:

```text
Test Files  2 passed (2)
Tests       19 passed (19)
```

Covered negative cases include wrong extension origin, wrong launch nonce, duplicate authorization,
expired/wrong-URL/reused context reference, pre-claim user change, unknown authorization fields, sequence
replay, wrong-tab response, same-origin stale Observation, cross-origin revoke, sensitive-value leakage and
sensitive-field write. The tests also prove that no endpoint action is emitted after the relevant denial.

Full Desktop test result:

```text
Test Files  13 passed (13)
Tests       95 passed (95)
```

## Full V2 regression

Command:

```bash
npm run check:v2
```

Result: PASS.

- Boundary scan: 245 source files.
- Production release graph: 179 files; Pi imports remain isolated.
- Local release gate: consistent; 12 external evidence groups remain.
- Biome: 341 files.
- All workspace typechecks and tests passed; root V2 tests: 12 files / 61 tests.
- iOS and Android exports passed.
- Electron arm64 production package passed.
- Fuse and release-artifact checks passed.
- Native signature verifier correctly reports `LOCAL UNSIGNED`; this is not signed-install evidence.

## Browser mechanism basis

The planned Chrome-first runtime uses a user-click `activeTab` grant, a Manifest V3 service worker with
`scripting` and `nativeMessaging`, an exact Native Messaging `allowed_origins` entry and caller-origin
validation. These constraints follow Chrome's official documentation:

- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [extension message security](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)

## Evidence boundary and next gate

This checkpoint proves the local state machine and Adapter behavior only. It does not prove that Chrome can
currently connect to UWA. BCU-003 remains partial until a minimally privileged MV3 extension and
packaged native host use an owner-only Main transport, trusted UI performs connect/revoke, Main correlates
the exact native Chrome window, a real tab completes the dated search smoke test, and a signed installed
candidate retains the required permissions across restart/upgrade/rollback.
