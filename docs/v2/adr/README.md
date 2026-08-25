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

The next blocking decisions, ADR-V2-007 through ADR-V2-009, must be accepted before M1 exits.
