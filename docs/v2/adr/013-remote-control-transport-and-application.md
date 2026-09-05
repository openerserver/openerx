# ADR-V2-013: Common Remote transport and host application boundary

- Scope: shared contracts, desktop Remote Host and optional Gateway.
- Status: implemented protocol boundary; native release evidence is separate.

## Trust and delivery

An external controller can request work on an online execution host without exposing a desktop listener or creating another Agent runtime. Pairing is bound to an authenticated account/device and a one-time expiring challenge. Device private keys remain protected by each device, never at the Relay.

The common protocol uses X25519, HKDF-SHA256, XChaCha20-Poly1305 and Ed25519 to bind context, protect payloads and authenticate canonical envelopes. The Gateway stores routing metadata, ciphertext, expiry and receipts; it does not decrypt business payloads or grant execution authority.

Remote Host is an Electron-supervised utility process with host-originated connections and a private typed MessagePort to App Service. It checks signatures, sequence, revision, expiry and revocation. Delivery may be repeated; App Service persists command identity, payload digest and final result to reject changed-payload replay and avoid duplicate application.

## Execution and permissions

Shared commands map to Pi prompt, steer, followUp and abort. There is no separate Remote SessionManager or execution loop. Remote approvals identify an existing request and pass the same Capability Broker checks, bound to the host, conversation and exact operation. Pairing never transfers ambient filesystem authority.

Only stable product events are encrypted for controllers. Logs contain routing/status metadata rather than plaintext. Revocation stops future authority without deleting local conversation history. Any optional accounting remains server-owned; a transport receipt is not execution or payment proof.

## Edition boundary

Controller-specific screens, native application storage/biometrics, push-provider setup and store delivery belong to the integrating product, not this public protocol ADR. Tests in remote-protocol, remote-host, app-service and remote-control-gateway cover the shared boundary. See [test scope](../../TESTING.md) and [public architecture](../../ARCHITECTURE.md).
