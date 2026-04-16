# OpenerX

OpenerX is an AI Dev/Ops control plane for enterprise engineering organizations that need to run AI agents inside governed delivery workflows. It is not a personal AI IDE or a standalone orchestration engine. It is the operating layer that connects tasks, projects, members, agents, approvals, budgets, audits, and runtime execution into one controllable surface.

## Who It's For

This project is primarily for:

- AI platform and DevOps teams that run shared agent infrastructure
- Engineering managers and technical leads who need controlled, cross-team AI operations
- Security, compliance, and governance owners who require approval paths, audit trails, and policy enforcement
- Cost and operations stakeholders who need budget guardrails and execution visibility
- Internal product and delivery teams that need to integrate external runtimes into their own task and workflow systems

## What Problem It Solves

Most organizations do not struggle because AI tools cannot generate enough output. They struggle because once AI starts touching real engineering work, the organization needs ownership, approvals, cost controls, auditability, and runtime visibility. OpenerX is designed for that stage: it standardizes how agent-driven work is launched, observed, approved, and governed across projects and environments.

## 中文对外介绍

OpenerX 是一个面向企业研发组织的 AI Dev/Ops 控制平面，用来把 AI Agent 纳入可治理、可审计、可追责的研发流程。它不是个人 AI IDE，也不是单纯的 Agent 编排器，而是连接任务、项目、成员、Agent、审批、预算、审计与运行时执行的统一控制面。

它主要适合以下类型的用户和团队：

- 平台工程与 DevOps 团队，需要统一管理组织内的 Agent 基础设施和运行入口
- 研发管理者与技术负责人，需要让多团队协作中的 AI 使用可控、可见、可追踪
- 安全、合规与治理负责人，需要审批、审计、策略和预算约束能力
- 内部产品和交付团队，需要把外部 runtime 能力接入企业自己的任务和流程体系

OpenerX 重点解决的不是“AI 能不能生成内容”这类个人效率问题，而是“企业如何把 AI 纳入正式研发流程”这类组织问题，例如谁可以发起高风险操作、哪些动作需要审批、一次任务里 Agent 实际做了什么、成本和责任如何追溯。

如果用一句话概括，OpenerX 想提供的是一个让企业能够放心使用 AI Agent 的控制面：前台围绕 Project、Task、Member 和 Agent 组织协作，后台通过控制平面治理与运行时执行分离的架构，把执行、审批、预算、审计和追踪统一起来。

The repository currently supports two shapes at the same time:

- The formal split architecture: Web UI -> BFF -> Control Plane Service -> PostgreSQL, plus an external runtime.
- A unified local development app in `control-plane/app` that embeds the Control Plane and BFF behind one HTTP entrypoint on port `4098` for faster day-to-day development and smoke checks.

## What It Helps Teams Do

- Govern AI agent usage across projects, organizations, environments, users, and policies
- Observe task execution, runtime sessions, and task-domain traces in one place
- Add approval, audit, cost, and budget controls around agent operations
- Connect browser workflows to OpenCode-compatible runtimes through a managed control surface
- Give developers and operators a shared system for local development, smoke checks, and regression testing

## Key Capabilities

- Project, organization, environment, user, and policy management
- Task execution views and task-domain trace aggregation
- Approval, audit, cost, and budget governance
- Runtime session control through OpenCode-compatible runtime APIs
- Real-time updates from runtime events to the browser
- Centralized test layout across service, BFF, UI, and E2E layers

## Repository Layout

| Path | Purpose |
| --- | --- |
| `control-plane/app` | Unified local app that mounts the Control Plane, BFF, and Web UI entrypoint |
| `control-plane/service` | Control Plane Service: auth, projects, tasks, approvals, audit, persistence |
| `control-plane/web-ui-bff` | Frontend-facing BFF: auth proxy, task aggregation, runtime control, realtime bridge |
| `control-plane/web-ui` | Vue 3 Web UI |
| `tests` | Centralized automated tests for service, BFF, UI, and E2E |
| `scripts` | Shared developer scripts for startup, checks, and focused regression runs |
| `docs` | Architecture, design, migration, and implementation notes |
| `opencode-fork` | Runtime-side configuration and related runtime assets |
| `pi-mono` | Adjacent mono-repo style packages and experiments |
| `claude-code-main` | Imported or comparison codebase kept in-repo for reference work |

## Runtime Topology

The current operational architecture is still split by responsibility:

```text
Browser
  -> Web UI :5173
  -> BFF :4098
  -> Control Plane Service :4097
  -> PostgreSQL

BFF
  -> OpenCode Runtime :4096
```

For local development, the repository also ships a unified app in `control-plane/app` that:

- embeds the Control Plane app in-process
- mounts the BFF in the same Bun server
- proxies Web UI assets or the Vite dev server
- exposes `/api`, `/ws`, and health endpoints on `:4098`

This is why local scripts and smoke checks often use `control-plane/app`, while architecture docs still describe the split production boundary.

## Requirements

- Bun
- PostgreSQL
- An OpenCode-compatible runtime binary reachable locally
- A database created for `DATABASE_URL`

Recommended local defaults:

- `APP_PORT=4098`
- `DATABASE_URL=postgres://127.0.0.1:5432/openerx`
- `OPENCODE_URL=http://127.0.0.1:4096`
- `JWT_SECRET=change-me-before-sharing`

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Prepare environment variables

```bash
cp .env.example .env
```

If your runtime binary is not at the default path expected by the startup script, export `OPENCODE_BIN` before starting the stack:

```bash
export OPENCODE_BIN=/path/to/opencode
```

### 3. Prepare PostgreSQL

Make sure the target database already exists. For the default local setup, create `openerx` and then apply migrations and seed data:

```bash
createdb openerx
cd control-plane/service
bun run db:migrate:pg
bun run db:seed:pg
cd ../..
```

The seed script creates a default platform admin account:

- username: `admin`
- password: `admin123!`

### 4. Start the local stack

Preferred script:

```bash
bash scripts/start-all-dev.sh
```

This starts:

- OpenCode runtime on `:4096`
- unified app on `:4098`
- Web UI dev server on `:5173`

Open the UI at `http://127.0.0.1:5173`.

### 5. Verify health

```bash
curl http://127.0.0.1:4098/health/live
curl http://127.0.0.1:4098/health/ready
curl http://127.0.0.1:4096/session
```

## Alternative Startup Modes

### Unified app only

```bash
bun run dev:app
bun run dev:ui
```

### Split legacy-style services

```bash
bun run dev:service
bun run dev:bff
bun run dev:ui
```

Use the split mode when you need to debug Control Plane and BFF boundaries independently.

### VS Code tasks

The repository includes workspace tasks for common flows, including:

- `start-all-dev`
- `start-app`
- `start-control-plane-service`
- `start-web-ui-bff`
- `start-web-ui`
- `restart-app`
- `check-app-health`

## Common Commands

### Build and quality

```bash
bun run lint
bun run typecheck
bun run build
bun run check:all
```

### Default tests

```bash
bun run test:service
bun run test:bff
bun run test:ui
bun run test:all
```

### Focused UI test file

```bash
bun run test:ui:file -- tests/web-ui/TaskDetail.test.ts
```

Do not run `bun test tests/web-ui/...` directly for Web UI tests. The UI suite expects the Vitest context from `control-plane/web-ui`.

### Focused BFF and service regressions

```bash
bun run test:bff:realtime-regression
bun run test:bff:execution-integration
bash scripts/run-service-task-domain-current-batch.sh
```

## Environment Variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_PORT` | `4098` | Unified app HTTP port |
| `PORT` | `4098` | Alternate port source for the unified app |
| `DATABASE_URL` | `postgres://127.0.0.1:5432/openerx` | PostgreSQL connection string |
| `OPENCODE_URL` | `http://127.0.0.1:4096` | Runtime base URL used by app and BFF |
| `JWT_SECRET` | `change-me-before-sharing` | JWT signing secret |
| `UI_DEV_SERVER_URL` | `http://127.0.0.1:5173` | Web UI dev server URL used by the unified app |
| `OPENCODE_BIN` | local machine specific | Runtime binary path used by `scripts/start-all-dev.sh` |

## Testing Conventions

- Automated tests live under the root `tests` directory.
- Service, BFF, and UI tests are intentionally centralized instead of being colocated inside each package.
- Root scripts are the preferred way to run broad or fragile regression batches.
- Some BFF integration suites require `RUN_EXECUTION_INTEGRATION=1`.

More details are documented in `tests/README.md`.

## Documentation Map

Start here for architecture and current behavior:

- `docs/architecture-overview.md`
- `docs/runtime-process-architecture.md`
- `docs/current/README.md`
- `tests/README.md`

Useful supporting material:

- `workflow_smoke_test.md`
- `docs/execution-trace-read-boundary-adr.md`
- `docs/dag-node-execution-plan-v2.md`

Most project documentation is currently written in Chinese and reflects the current implementation rather than a greenfield target design.

## Notes for Contributors

- Prefer the root-level scripts and package scripts over ad-hoc commands.
- Keep new tests under `tests/` instead of colocating them under source packages.
- Treat PostgreSQL as the standard runtime database.
- Use the unified app for fast local feedback, and the split services when debugging cross-layer boundaries.