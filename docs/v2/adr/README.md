# V2 Architecture Decision Records

These records are normative for the V2 implementation. `Accepted` decisions can change only through
a superseding ADR that records migration and rollback impact.

| ID | Decision | Status |
| --- | --- | --- |
| [ADR-V2-001](001-workspace-and-dependencies.md) | npm workspaces, naming and dependency direction | Accepted |
| [ADR-V2-002](002-electron-build-release.md) | Electron build, package, signing and update | Accepted |
| [ADR-V2-003](003-react-ui-state.md) | React routing, asynchronous state and UI foundation | Accepted |
| [ADR-V2-004](004-ipc-contracts.md) | Main/Preload/Renderer IPC contract | Accepted |
| [ADR-V2-005](005-local-storage.md) | Local database, migration, encryption and cache cleanup | Accepted |
| [ADR-V2-006](006-app-service-process.md) | App Service process shape and authentication | Accepted |
| [ADR-V2-007](007-pi-harness-boundary.md) | Pi owns the agent harness | Accepted and implemented |
| [ADR-V2-008](008-sync-cursor-and-conflicts.md) | Cloud objects, sync cursor and conflict strategy | Accepted and M2 slice implemented |
| [ADR-V2-009](009-device-session-credentials.md) | Email verification, device credentials and session refresh | Accepted and implemented |
| [ADR-V2-010](010-billing-ledger-and-money.md) | Integer money, reservation and append-only ledger | Accepted and M3 local slice implemented |
| [ADR-V2-011](011-file-artifact-object-and-pi-session.md) | Device file scopes, cloud objects, artifact versions and Pi session recovery | Accepted and M4 local slice implemented |
| [ADR-V2-012](012-capability-broker-and-tool-projection.md) | Pi tool invocation, Capability Broker, host adapters and durable projection | Accepted and M5 local slice implemented |
| [ADR-V2-013](013-remote-control-transport-and-application.md) | E2EE Remote transport, outbound Connector and exactly-once application | Accepted and M6 local slice implemented |
| [ADR-V2-014](014-pi-native-skill-packages.md) | Pi-native Skill discovery, package lifecycle, Broker execution and sync | Accepted and M7 local slice implemented |

ADR-V2-001 through ADR-V2-013 are accepted. The M2 implementation evidence for ADR-V2-008/009 is
recorded in [the checkpoint report](../evidence/m2-2026-08-25.md). ADR-V2-010 is implemented by the
[M3 checkpoint](../evidence/m3-2026-08-25.md). ADR-V2-011 is implemented by the
[M4 checkpoint](../evidence/m4-2026-08-26.md). ADR-V2-012 is implemented by the
[M5 checkpoint](../evidence/m5-2026-08-26.md). ADR-V2-013 is implemented by the
[M6 checkpoint](../evidence/m6-2026-08-26.md); native cross-platform release evidence remains.
ADR-V2-014 is implemented by the [M7 checkpoint](../evidence/m7-2026-08-26.md); signed catalog and
cross-platform Skill release evidence remain.
