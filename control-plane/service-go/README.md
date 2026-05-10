# OpenerX Go Control Plane

This directory contains the Go-compatible Control Plane service. It is intentionally separate from `control-plane/service` and does not replace or modify the existing Bun/TypeScript implementation.

## Run

```bash
cd control-plane/service-go
PORT=4097 DATABASE_URL=postgres://127.0.0.1:5432/openerx go run ./cmd/control-plane
```

Defaults match the existing service:

- `PORT=4097`
- `DATABASE_URL=postgres://127.0.0.1:5432/openerx`
- `JWT_SECRET=openerx-dev-secret-change-in-production`
- `CONTROL_PLANE_DB_MAX_CONNECTIONS=10`

On startup, the service applies pending SQL migrations from `../service/drizzle-pg` using the same `drizzle.__drizzle_migrations` table and advisory lock key as the Bun service.

## Verify

```bash
cd control-plane/service-go
go test ./...
```

With the Go service running:

```bash
TEST_CP_URL=http://127.0.0.1:4097 bun test tests/service/auth-registration.test.ts tests/service/user-management.test.ts --timeout 30000
```

Broader compatibility check:

```bash
TEST_CP_URL=http://127.0.0.1:4097 bun test tests/service --timeout 30000
```

Root scripts are available for the same gates:

```bash
bun run dev:service-go
bun run test:service-go
TEST_CP_URL=http://127.0.0.1:4097 bun run test:service-go:contract
CONTROL_PLANE_URL=http://127.0.0.1:4097 TEST_BFF_URL=http://127.0.0.1:4098 bun run test:bff:go-smoke
```

Current snapshot from the active development worktree: `257 pass / 0 fail` for
the full `tests/service` suite with `TEST_CP_URL` pointing at the Go service.
The strict Go parity gate passes:

```bash
GO_CONTROL_PLANE_REQUIRE_FULL_PARITY=1 go test ./...
```

See [docs/route-parity.md](docs/route-parity.md) for the route parity gates and
remaining switch-readiness notes.

BFF proxy smoke has also passed with the Go Control Plane and the existing BFF:

```bash
CONTROL_PLANE_URL=http://127.0.0.1:4197 TEST_CP_URL=http://127.0.0.1:4197 BFF_PORT=4098 bun run control-plane/web-ui-bff/src/index.ts
```

The smoke covered login, project list, repository CRUD, credential CRUD, task
create/detail/tree/delete, operating state/mode, boss decisions, escalations,
cost budget, dashboard governance overview, task governance summary, public
registration, user management, and identity proxy paths.

## Current Coverage

Implemented:

- Health checks
- Postgres connection pool and Drizzle migration compatibility
- JWT auth middleware, tokenVersion validation, bcrypt password verification
- `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`, `/api/auth/me`
- User management routes covered by the current service auth/user tests
- Org, project, project-tree, project links, task relation links, audit, env, policy, plugin, and core task routes
- Session-first task routes for sessions, messages, tree, timeline, execution trace, snapshots, run create/update/list, and projection replay
- Runtime usage ledgers and baselines, cost basics, dashboard governance overview, role agents, role conclusions, developer change requests, workflow templates and task workflow reads
- Phase lifecycle routes, workbench layout, approvals, task governance summary, repository CRUD, cost budget list/update, and task operating-runtime mode/decision/escalation routes
- Crowdsourced-development MVP routes for task boundaries, task assignments,
  workspace branches, commit steps, and commit runtime preview records

Still intentionally separate:

- the existing Bun/TypeScript service remains available as rollback/reference code;
- low-frequency BFF-only persistence routes should keep being added behind the same parity gates if new UI paths require them.
