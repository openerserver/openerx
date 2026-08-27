# ADR-V2-017: Browser Computer-Use Host and versioned contract

- Status: Accepted; BCU-002 deterministic Host kernel implemented, runtime migration pending
- Date: 2026-08-27
- Owners: Desktop, App Service, Pi Host and Security
- Supersedes: the browser automation decision in ADR-V2-012

## Context

The M5 browser slice opens an isolated Electron `BrowserWindow`, but its model-visible contract accepts
CSS selectors and Main executes selector-derived JavaScript or CDP DOM commands. It proves the M5 local
fixture, yet it does not satisfy the later product decision that browser operation must be an independent
computer-use surface, should use the machine's default browser by default, and should offer managed
Chromium as the more isolated option.

A screenshot-only loop would avoid DOM selectors but would make ordinary forms slower and more brittle.
Conversely, exposing raw DOM, selectors, JavaScript or DevTools to Pi would allow page content to steer a
privileged browser interface and would reveal data that is not visible to the user. The replacement must
therefore combine constrained semantics with visual evidence while preserving the Broker as the authority
boundary and Pi as the only Agent Loop.

## Decision

### Independent surface and two backends

`openerx_browser` remains a distinct capability whose Host operates one exact browser surface. Remote web
content is never embedded in the chat Renderer.

- `system_default` is the default backend. A signed, user-connected Browser Bridge may bind one expressly
  authorized tab. Without the Bridge, the Host must open or confirm a dedicated top-level browser window
  and bind it through OS Accessibility. OpenerX reuses ambient login state but does not enumerate, copy,
  import or export the browser profile, Cookie store, password store, extensions or global history.
- `managed_chromium` uses Electron's Chromium with an OpenerX-owned isolated profile. The initial backend
  uses an ephemeral profile; a persistent managed profile is a later, separately reviewed feature.
- A trusted user setting defines the security minimum. A request may upgrade from `system_default` to
  `managed_chromium`; neither Pi nor page content may downgrade a managed minimum.

Every Session descriptor binds backend, control path, application identity, native window identity,
surface kind and ID, ownership, profile persistence, state and capabilities. A missing or changed identity
fails closed; the Host never falls back to the current foreground browser or the whole screen.

### Semantic-first, visually verified actions

The trusted Adapter produces a filtered snapshot of visible browser semantics and short-lived opaque
`elementRef` values. Pi may request bounded `focus`, `setValue`, `invoke`, `select`, scroll and input
operations. The Host chooses the execution path in this order:

1. constrained semantic action;
2. native keyboard or pointer input bound to the exact surface;
3. coordinates from the current visual Observation when semantics are unavailable.

Screenshots are mandatory for the baseline, material layout/navigation changes, uncertainty, coordinate
fallback, high-impact actions and final verification. Stable low-risk semantic steps may return a semantic
diff and screenshot digest without another full image.

Each interaction references a fresh `observationId`; coordinate targets additionally carry the same
`visualObservationId`. An Observation expires no later than 30 seconds after capture. Navigation, surface
change, Bridge disconnect, user takeover or any completed action invalidates its element and coordinate
references. Audited micro-actions may be atomic, but no batch crosses navigation, domain, external side
effect or approval boundaries.

### Versioned and closed model contract

The replacement payload is `browser_computer_use_v2`. Its Zod schemas live in
`packages/contracts/src/browser-computer-use.ts` and were introduced additively during BCU-001. All objects
are strict. The contract contains only opaque session/observation/element references, approved PersonalFile
IDs, bounded text/keys/coordinates and typed metadata.

The model contract rejects CSS/XPath selectors, raw DOM/HTML, JavaScript, DevTools commands, local paths,
Cookie/password/token fields and unknown extensions. Sensitive semantic elements may be identified for
handoff, but their value must be null and marked redacted. Browser Bridge and managed Chromium Adapter code
may internally use a reviewed, versioned implementation to derive visible semantics; they do not expose a
generic evaluation or selector interface.

The existing `operation: "browser"` shape and Main implementation are classified as `legacy_dom_v1`.
BCU-001 retains them only so persisted ToolCalls and the current runtime remain readable while the new
vertical slices are built. The legacy schema must not gain new capabilities. Pi projection switches to V2
only after a matching Adapter, Broker policy, negative tests and rollback flag are available together.

### Authority, lifecycle and files

Pi continues to own planning and tool order. App Service's Capability Broker selects the effective backend,
checks domain Scope, evaluates risk, owns approvals and idempotency, and dispatches one action. The Browser
Host observes and executes; it cannot plan, approve itself or silently change backend/control path.

`detach` stops control without closing a user-owned browser surface. `close` requires current Observation
state and is valid only for a surface OpenerX can prove it created and owns. System-browser file upload and
download initially require user takeover. Managed Chromium later reuses controlled PersonalFile IDs and
never returns a private filesystem path to Pi.

## Contract transition

| Stage | Pi projection | Host implementation | Release meaning |
| --- | --- | --- | --- |
| BCU-001 | `legacy_dom_v1` remains active | Existing M5 Host | Contract baseline only; no new browser claim |
| BCU-002 | `legacy_dom_v1` remains active; V2 kernel is not projected | Observation registry, identity kernel and action dispatcher | Deterministic fixtures only; no backend claim |
| BCU-003/004 | V2 enabled per completed backend | System browser, then managed Chromium | Backend-specific Alpha evidence |
| BCU-006 | V2 only | Legacy executor removed | Signed package gate may be evaluated |

The feature flag is a creation-time choice. An in-flight Session never migrates contracts, backends or
control paths.

## Consequences

- Standard HTML interactions can use stable accessibility semantics without relying on DOM IDs/classes or
  transmitting a screenshot after every low-risk step.
- Canvas and other non-semantic surfaces remain operable through a bounded, auditable visual fallback.
- Using the system browser improves compatibility and account continuity but carries explicit ambient-state
  risk; managed Chromium provides a clear isolation upgrade.
- The Host and Browser Bridge require more identity, invalidation and redaction logic than the M5 selector
  slice.
- BCU-001/002 are not backend runtime proof. The current executable browser path remains legacy until later
  exit gates pass, and contract or deterministic kernel tests must not be reported as a successful browser
  smoke test.

## Migration and rollback

- The new contract and BCU-002 pure kernel are additive and not imported by the active Host, so rollback can
  remove their future consumers while leaving historical ToolCalls and `legacy_dom_v1` readable.
- Later adapters are enabled independently by backend/control-path flags. Rollback disables new Session
  creation, lets no in-flight Session hot-migrate, and restores the previous signed application version.
- Removal of `legacy_dom_v1` occurs only after persisted-call readers, dual-backend tests and rollback drills
  pass. Historical evidence remains labeled with the implementation that produced it.

## Rejected alternatives

- Screenshot and coordinate control for every action: unnecessary latency and brittleness on semantic HTML.
- Raw DOM, selector, JavaScript or DevTools access for Pi: excessive authority and prompt-injection surface.
- Reusing or copying the user's browser profile into Electron: leaks ambient credentials and creates unclear
  ownership.
- Controlling whichever browser window is foreground: cannot establish target identity or safe cancellation.
- Replacing Pi with a second Browser planner: duplicates the Agent Loop and breaks Broker audit semantics.

## Verification

- [Browser Computer-Use contract test plan](../18-browser-computer-use-contract-test-plan.md)
- `packages/contracts/tests/browser-computer-use.test.ts`
- `apps/desktop/tests/browser-computer-use-kernel.test.ts`
- [BCU-001 implementation evidence](../evidence/bcu-001-2026-08-27.md)
- [BCU-002 implementation evidence](../evidence/bcu-002-2026-08-27.md)
