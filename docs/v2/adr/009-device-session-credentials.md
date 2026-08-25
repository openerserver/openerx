# ADR-V2-009: Email verification, device credentials and session refresh

- Status: Accepted and implemented
- Date: 2026-08-25
- Owners: Identity Platform and Desktop Security

## Decision

1. V1 authentication uses short-lived, single-use email verification challenges. Challenge responses
   are rate-limited and bound to an intended account flow; the desktop never stores an email password.
2. A successful verification creates a distinct `DeviceSession` with a random device credential.
   Reusable access or refresh material is stored only through the OS credential boundary: macOS
   Keychain or Windows Credential Manager. It is forbidden in Renderer state, SQLite, logs, URLs and
   ordinary cloud-sync payloads.
3. Access tokens are short-lived. Refresh rotates both token and server-side session version; replay
   of a superseded refresh credential revokes that device session and requires verification again.
4. Main brokers credential operations through named business actions. Preload exposes no generic
   keychain API, and App Service receives only the minimum short-lived authorization result needed for
   a request.
5. Users can revoke the current device, another device or all devices. Server revocation prevents
   further refresh and sync writes. Offline local history remains readable, while new cloud/model
   operations show an authentication-required state.
6. Device identity is not hardware fingerprinting. It is a generated identifier plus user-visible
   platform metadata and last-active/revoked timestamps.

## Implementation status

M1 was local-only and created no reusable account secret. M2 now implements the Electron
`safeStorage` credential boundary, refresh rotation/replay revocation, device inventory, targeted and
all-device revocation, account-scoped profiles and credential canary redaction tests. Native
Keychain/Credential Manager behavior remains part of the Windows/macOS release matrix.

## Consequences

- Database theft alone does not yield a reusable cloud session.
- Session revocation and local data deletion remain separate user actions.
- Identity was implemented in M2 without exposing a generic credential API to Renderer.
