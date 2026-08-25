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

ADR-V2-001 through ADR-V2-009 are accepted. The M2 implementation evidence for ADR-V2-008/009 is
recorded in [the checkpoint report](../evidence/m2-2026-08-25.md). ADR-V2-010 is the next
milestone-blocking decision.
