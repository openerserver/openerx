# ADR-V2-004: Main, Preload and Renderer IPC contracts

- Status: Accepted
- Date: 2026-08-25
- Owners: Desktop Foundation and Contracts & Quality

## Decision

1. Renderer is untrusted. Every window uses `nodeIntegration: false`, `contextIsolation: true`,
   `sandbox: true` and `webviewTag: false`.
2. Preload exposes one frozen, typed domain bridge through `contextBridge`. Raw `ipcRenderer`,
   generic `send/on/invoke`, Electron event objects and Node objects are forbidden.
3. Every channel name and DTO is declared in `packages/contracts`. Zod strict schemas validate data
   at both receiving boundaries. Unknown fields fail closed.
4. Main handlers verify that requests come from the expected main frame and authorized window. Each
   command has a correlation ID; mutation commands also have an idempotency key.
5. Subscriptions expose an explicit unsubscribe function, filter event payloads and enforce
   monotonic sequence numbers. Terminal events reject later deltas.
6. Failures cross the bridge only as stable `ErrorEnvelope` values. Stack traces and secrets stay in
   redacted local diagnostics.
7. New windows are denied by default, navigation is fixed to the app entry point and only validated
   HTTPS URLs may be handed to the operating system.

This follows Electron's guidance on [security](https://www.electronjs.org/docs/latest/tutorial/security)
and [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation).

## Consequences

- Adding a desktop capability requires a contract, schema tests and an explicit Main handler.
- A compromised Renderer cannot directly obtain Node, filesystem or process authority.
- IPC compatibility is reviewable and can be versioned independently of UI components.
