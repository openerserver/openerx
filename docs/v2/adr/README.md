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
| [ADR-V2-015](015-personal-beta-diagnostics-and-export.md) | Personal Beta diagnostics, performance budgets and separate personal-data export | Accepted and M8 local slice implemented |
| [ADR-V2-016](016-signed-release-and-update.md) | Signed native candidates, Ed25519 update manifests, promotion and rollback | Accepted and M9 local foundation implemented |
| [ADR-V2-017](017-browser-computer-use-host-and-contract.md) | System-default and managed-Chromium computer-use backends with a semantic/visual V2 contract | Accepted; BCU-002 deterministic Host kernel implemented |
| [ADR-V2-018](018-brokered-bash-and-platform-sandbox.md) | Product raw Bash contract, Broker authority and replaceable platform sandbox backends | Accepted; PBASH-001/PBASH-002 local macOS implementation complete, signed release pending |

ADR-V2-001 through ADR-V2-018 are accepted. The M2 implementation evidence for ADR-V2-008/009 is
recorded in [公共测试说明](../../TESTING.md). ADR-V2-010 is implemented by the
[公共测试说明](../../TESTING.md). ADR-V2-011 is implemented by the
[公共测试说明](../../TESTING.md). ADR-V2-012 is implemented by the
[公共测试说明](../../TESTING.md). ADR-V2-013 is implemented by the
[公共测试说明](../../TESTING.md); native cross-platform release evidence remains.
ADR-V2-014 is implemented by the [公共测试说明](../../TESTING.md); signed catalog and
cross-platform Skill release evidence remain.
ADR-V2-015 is implemented by the [公共测试说明](../../TESTING.md); real-user and native
release evidence remain external gates.
ADR-V2-016 is implemented by the [公共测试说明](../../TESTING.md); native credentials,
store validation, rollback drills and explicit release approval remain external gates.
ADR-V2-017 supersedes only ADR-V2-012's Browser DOM/selector and profile-choice decision. Its BCU-001
contract evidence is recorded in the [公共测试说明](../../TESTING.md), and its
unwired deterministic Observation/action kernel in the [公共测试说明](../../TESTING.md).
Browser Bridge, Accessibility adapters, runtime projection and real-browser smoke evidence remain later
gates.
ADR-V2-018 supersedes ADR-V2-012's argv-only Shell decision while retaining the legacy adapter as a
feature-flag rollback path. PBASH-001 contract evidence is recorded in the
[公共测试说明](../../TESTING.md); the current-host macOS platform sandbox and
real process evidence is recorded in the [公共测试说明](../../TESTING.md).
Streaming/log artifacts, signed packages, supported-OS validation and other platforms remain later gates.
