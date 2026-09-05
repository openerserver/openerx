# ADR-V2-006: App Service process shape and authentication

- Status: Accepted
- Date: 2026-08-25
- Owners: Personal App Service and Desktop Foundation

## Decision

1. Personal App Service runs as a supervised Electron utility process. It is not an unauthenticated
   loopback HTTP server and is not loaded into Renderer or Main.
2. Electron Main starts exactly one App Service for the active profile, passes a dedicated
   `MessagePort`, a random boot nonce and the profile directory, and restarts it with bounded backoff.
3. The first message must prove the boot nonce and negotiate one supported contract version. Main
   closes the port on mismatch, timeout, duplicate handshake or unexpected sender.
4. All later messages use strict schemas, correlation IDs and explicit query/command/event kinds.
   Mutations require idempotency keys. App Service never accepts executable code or arbitrary paths.
5. Main brokers OS credential, dialog and permission operations. App Service owns conversations,
   local storage, outbox and orchestration; it cannot create windows or directly approve tools.
6. Pi Host is a separate supervised process with a smaller capability port. A Pi Host crash
   cannot terminate App Service or corrupt committed conversation state.
7. Process logs are structured and redacted. Crash loops surface a recoverable UI state and stop
   after the configured retry budget.

The process choice follows Electron's separation of Main, Renderer and utility processes described in
the [process model](https://www.electronjs.org/docs/latest/tutorial/process-model) and its
[sandboxing guidance](https://www.electronjs.org/docs/latest/tutorial/sandbox).

## Consequences

- App Service failure and restart are observable without freezing Electron Main.
- No localhost port expands the default attack surface.
- M1 must implement handshake, supervision and restart tests before real conversation persistence.
