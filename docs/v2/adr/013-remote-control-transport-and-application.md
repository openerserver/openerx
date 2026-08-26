# ADR-V2-013: E2EE Remote transport, outbound Connector and exactly-once application

- Status: Accepted and M6 local slice implemented
- Date: 2026-08-26
- Owners: Mobile, Desktop, App Service, Identity and Remote Gateway

## Context

M6 lets an iOS/Android control plane operate an online Windows/macOS execution host without exposing a
desktop listener or creating a second agent runtime. Commands cross an untrusted Relay and may be
retried, reordered, delayed, duplicated or delivered after a device has been revoked. The Relay must
route and recover delivery without reading Prompt, answer, approval target or local runtime details.

Transport delivery and product application therefore have different semantics: the transport is at
least once, while calling Pi, a tool side effect, Usage settlement or Billing must remain exactly once.

## Decision

### Device trust and payload protection

Each desktop host and mobile controller owns a device key pair whose private key stays in OS-protected
storage. Pairing requires an authenticated same-account DeviceSession and a one-time, expiring desktop
challenge; the QR contains no reusable access token. X25519 derives the shared secret, HKDF-SHA256 binds
protocol context, XChaCha20-Poly1305 encrypts commands/events with authenticated context, and Ed25519
signs the canonical command envelope. Gateway never receives a device private key or plaintext payload.

### Relay and Connector boundary

Remote Control Gateway persists host Presence, pairings, routing metadata, ciphertext, TTL, receipts,
event cursors and opaque push envelopes. It rejects invalid account/device/pairing state and obvious
expiry/sequence conflicts, but it does not decrypt, authorize or execute a product command.

Remote Host Connector is an Electron-supervised utility process. It creates only host-originated TLS
connections, exposes no localhost or public listener, verifies and decrypts on the host, rechecks
revision/sequence/expiry/revocation, and communicates with App Service through a private typed
MessagePort. The local Alpha transport adapter uses outbound HTTPS polling; production may use WSS
without changing the product command contract.

### Exactly-once product application

Gateway and Connector provide at-least-once delivery and durable receipts. App Service stores the
command identity, canonical payload digest and final result before replaying that result to duplicate
delivery. A reused command ID with different content is rejected. This application boundary is the
final guard against a duplicate Pi call, tool side effect, UsageRecord or ChargeRecord.

App Service maps `task.start`/`session.prompt`, `session.steer`, `session.follow_up` and `session.abort`
to Pi `prompt()`, `steer()`, `followUp()` and `abort()`. It does not implement a Remote queue or
SessionManager. Permission decisions must identify an existing pending request and pass the same M5
Broker checks; remote Scope is additionally bound to the host and Conversation and cannot inherit a
different device's local authority.

### Product event projection

Only stable product events are projected for Remote. Connector encrypts each controller's event stream
separately, and the phone resumes with a durable cursor. Relay logs routing metadata and result codes,
not plaintext. Push registration stores a token reference and sends an opaque object envelope; sensitive
content must be fetched after authentication and decryption.

## Consequences

- Desktop Remote can be disabled or revoked without changing Pi sessions or account history.
- Relay compromise does not disclose command/event plaintext or grant device authority.
- Transport retry is safe, but stale revision, expired TTL, sequence conflict and changed-payload replay
  remain explicit failures rather than last-write-wins behavior.
- Connector, Gateway and mobile app cannot bypass server-side pricing/Billing or the desktop Broker.
- Production APNs/FCM, native mobile secure-storage/biometric behavior, signed host packages and the full
  iOS/Android by Windows/macOS fault matrix remain release-environment gates.

## Rejected alternatives

- Opening a desktop HTTP/WebSocket listener: expands the network attack surface and complicates NAT.
- Letting Gateway decrypt commands: makes Relay a sensitive execution control plane.
- Treating successful Gateway submission as application: duplicates Pi and paid side effects on retry.
- Queueing commands while a host is offline: can trigger surprising execution after context has changed.
- Sharing desktop Scope with a paired phone: turns pairing into broad ambient authority.
- Sending Pi-private events to mobile: couples the product contract to the harness and leaks internals.

## Evidence

Implementation and reproducible checks are recorded in
[M6 checkpoint evidence](../evidence/m6-2026-08-26.md).
