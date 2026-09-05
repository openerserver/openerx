# Browser Computer-Use Contract Test Plan

- Status: BCU-001/002 implemented; BCU-003 macOS AX and Windows default Edge/Chrome UIA local live gates passed and
  deterministic Browser Bridge security foundation implemented; signed extension/native-host transport remains pending
- Date: 2026-08-27; live gate updated 2026-08-29 (Asia/Shanghai)
- Normative decision: [ADR-V2-017](adr/017-browser-computer-use-host-and-contract.md)
- Implementation plan: [17-browser-computer-use-plan.md](17-browser-computer-use-plan.md)

## 1. Purpose and evidence boundary

This plan turns the browser decision into staged, repeatable gates. BCU-001 proves that the versioned
contract is strict and internally consistent. BCU-002 proves the in-memory Observation and action-ordering
kernel against deterministic fakes. BCU-003 separately proves the current local macOS AX Adapter, native
action matrix, deterministic takeover lifecycle and trusted Renderer control path. It now also proves the
Bridge grant/protocol/Adapter state machine against a closed fake endpoint; it does not prove an installed
MV3 extension, Native Messaging transport, signed build or managed Chromium.

## 2. BCU-001 contract matrix

| ID | Requirement | Automated evidence |
| --- | --- | --- |
| BCU-C-001 | Accept only `browser_computer_use_v2` and HTTP(S) open requests | Contract positive/negative tests |
| BCU-C-002 | Reject selector, XPath, DOM/HTML, JavaScript, DevTools, local path and unknown fields | Strict-operation negative table |
| BCU-C-003 | Never downgrade a managed security minimum or managed request | Backend-selection refinement test |
| BCU-C-004 | Bind backend to compatible control path, surface kind, ownership and profile persistence | Session-descriptor tests |
| BCU-C-005 | Require opaque element references and typed visual Observation IDs | Semantic and coordinate-action tests |
| BCU-C-006 | Expire Observations in at most 30 seconds | TTL boundary test |
| BCU-C-007 | Pair screenshots with a reason and require an image for visual fallback | Observation refinement tests |
| BCU-C-008 | Redact password, payment and authentication element values | Sensitive-element negative test |
| BCU-C-009 | Keep `legacy_dom_v1` readable but frozen and separate from V2 | Source marker plus version rejection test |
| BCU-C-010 | Keep pause/resume on a strict trusted-UI input and reject model `resume` | Session-control strictness and operation-union negative tests |

BCU-001 command:

```bash
npm run test --workspace @openerx/contracts -- --run tests/browser-computer-use.test.ts
```

## 3. BCU-002 deterministic Host tests

BCU-002 adds a Fake Adapter and Observation registry without launching a real browser. Implemented cases:

1. Generate unguessable Session, semantic snapshot, Observation and element references.
2. Reject expired, replayed, cross-Session, cross-surface, cross-backend and cross-control-path references.
3. Invalidate all references after navigation, resize/scale change, Bridge disconnect and user takeover.
4. Reject coordinates outside the captured viewport and images that do not belong to the exact surface.
5. Prove action ordering is semantic, then native input, then visual coordinate fallback.
6. Expose only one-operation dispatch; no micro-batch API can cross navigation, domain, side-effect or
   approval boundaries.
7. Redact sensitive semantic values and audit/error text using credential canaries; reject whole-screen or
   Adapter-declared unredacted captures. Pixel-level masking remains a real-Adapter test in BCU-003/004.
8. Stop produces zero later input after cancellation, Host disconnect or App Service restart.

Implementation evidence:

- `apps/desktop/src/main/browser-computer-use/ui-observation-registry.ts`
- `apps/desktop/src/main/browser-computer-use/browser-action-dispatcher.ts`
- `apps/desktop/tests/browser-computer-use-kernel.test.ts`

BCU-002 command:

```bash
npm run test --workspace @openerx/desktop -- --run tests/browser-computer-use-kernel.test.ts
```

## 4. BCU-003 system-browser fixtures

The system-browser suite has two explicit modes:

- Deterministic Browser Bridge security fixture: implemented for one-time exact-tab grant and bounded
  request/response behavior; signed installed transport remains pending.
- OS Accessibility fixture: OpenERX-created or confirmed dedicated top-level window.

A randomized standard HTML fixture changes DOM IDs/classes on every run. Search, form input, selection and
navigation must complete with semantic `elementRef` actions and no coordinates. A separate Canvas fixture
must require visual fallback and prove viewport, scale and TTL enforcement. Neither fixture may expose
Cookie, password-store, extension, history, full-DOM or local-path data.

The deterministic Bridge fixture lives in
`apps/desktop/tests/browser-computer-use-browser-bridge.test.ts` and must prove:

1. Exact extension origin and per-launch Main nonce are both required; no wildcard origin is accepted.
2. `browserContextRef` is random, expires in at most five minutes, matches one exact URL and can be claimed
   once. Duplicate authorization IDs and user changes before claim invalidate it.
3. Main-supplied application/PID/native-window identity is combined with one browser window, tab, document
   and origin. Pi output contains neither raw tab ID nor browser-window ID.
4. Every response/event has a strictly increasing sequence. Replay, malformed sensitive data, wrong tab,
   cross-origin navigation, tab close/deactivation, explicit revoke or channel loss fails closed before a
   later action.
5. Same-origin navigation invalidates the old Observation. Sensitive-field text pauses for user takeover
   before any endpoint request.
6. Requests contain only the versioned observe/action union and source node references; no selector, XPath,
   DOM/HTML, arbitrary JavaScript, Cookie/history or generic DevTools command exists. Bridge sessions have
   no coordinate fallback and cannot close a user-owned tab.

Run it together with the existing system-browser regression:

```bash
npm test --workspace @openerx/desktop -- tests/browser-computer-use-browser-bridge.test.ts tests/browser-computer-use-system-default.test.ts
```

Passing this fixture is a protocol/state-machine checkpoint only. Promotion still requires the packaged
MV3 extension, exact `allowed_origins` Native Messaging manifest, caller-origin validation, owner-only Main
transport, trusted connection/revoke UI, real exact-tab smoke test and signed-install persistence.

The OS Accessibility fixture additionally requires a one-shot input monitor that emits no key, text or
coordinate payload. Tests must prove exact-window pointer filtering, exact focused-window keyboard
filtering, immediate `paused_for_user`, no post-takeover fallback, no Observation returned while paused,
same-surface trusted resume with a fresh baseline, and fail-closed monitor loss. The repository runner is:

```bash
npm run test:e2e:browser:takeover:macos --workspace @openerx/desktop
```

The runner prints the exact native window ID and waits up to 120 seconds by default; the timeout can be set
from 10 seconds through 10 minutes with `OPENERX_BCU_TAKEOVER_TIMEOUT_MS`. It must be satisfied with a
physical mouse, trackpad or keyboard event in the exact dedicated window. Agent-generated Accessibility or
synthetic Computer Use input is intentionally not accepted as human takeover evidence. A locked desktop,
missing physical input or timeout is an environment block, never a pass.

The 2026-08-28 physical-input run passed and produced
[公共测试说明](../TESTING.md). This does not replace the
separate native Tool Center UI-to-browser gate, which is run with:

```bash
npm run test:e2e:browser:tool-center:macos --workspace @openerx/desktop
```

That gate also passed on 2026-08-28 through the production Main/Preload/Renderer/Pi path and is recorded in
the same dated evidence file.

The trusted Renderer fixture must list only session metadata, invoke pause/resume with an opaque session ID,
render no iframe/page content, and keep these controls out of the Pi operation contract. Deterministic UI
coverage lives in `apps/desktop/tests/chat-ui.test.tsx`; native UI-to-browser proof remains part of the
unlocked-machine gate.

## 5. BCU-004 managed-Chromium fixtures

Run the same semantic and Canvas fixtures in an Electron `BrowserWindow` with an isolated temporary
partition. Assert that system-browser Cookie/login canaries are absent, teardown removes temporary profile
data, and the semantic/visual contract is identical to the system-browser contract.

Persistent managed profiles are excluded until BCU-007. When implemented, tests must prove same-profile
restart persistence, cross-profile isolation, per-site clearing and full deletion without touching system
browser data.

## 6. Broker, approval and lifecycle gates

Before V2 is projected to Pi, integration tests must prove:

- user security minimum wins over model and page requests;
- domain Scope and payload digest include backend, control path, surface, target and relevant data;
- changed payloads or stale Observations cannot reuse approval;
- Bridge connect/revoke is L3 and high-impact actions remain per-call approvals;
- `detach` never closes user-owned surfaces, while `close` rejects unowned surfaces;
- CAPTCHA, password, payment, browser security prompts, first system-browser upload/download and 2FA pause
  for user takeover.

## 7. Dated real-site smoke test

After deterministic gates pass, each backend must separately perform “open Baidu and search phonescloud”.
Record date, signed build identity, browser/application identity, backend, control path, Session/surface/window
IDs, semantic/visual Observation sequence, approvals and final evidence. The action must prefer
`elementRef + setValue`; coordinates require a recorded semantic failure reason. A baseline and final exact-
surface screenshot are mandatory. CAPTCHA, Bridge loss, identity ambiguity or network failure is an
environment block, not a pass.

## 8. Required release evidence

A backend is not complete from contract tests or an unsigned development run. Promotion requires relevant
unit/integration/E2E results, security-negative tests, cancellation/restart evidence, redacted logs, a dated
real-site smoke artifact and a rollback result from the signed desktop candidate.
