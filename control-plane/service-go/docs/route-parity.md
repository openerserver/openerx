# Go Control Plane Route Parity Plan

Status: Go service now satisfies the current service contract suite and the
existing BFF smoke paths.

The Go Control Plane is a parallel implementation under `control-plane/service-go`.
The old `control-plane/service` remains in place as the rollback/reference implementation.
Production replacement means:

- no Go route returns the generic `NotImplemented` response;
- every public TS Control Plane route is either implemented in Go or explicitly removed from the product contract;
- all BFF-visible Control Plane paths used by the UI have smoke coverage against Go;
- raw `TEST_CP_URL=<go-service> bun test tests/service --timeout 30000` is green.

## Current Snapshot

Latest command:

```bash
TEST_CP_URL=http://127.0.0.1:4197 bun test tests/service --timeout 30000
```

Latest result: `257 pass / 0 fail` across `257` tests.

Additional parity checks that pass:

- `go test ./...`
- strict gate: `GO_CONTROL_PLANE_REQUIRE_FULL_PARITY=1 go test ./...`
- BFF proxy smoke with `CONTROL_PLANE_URL=http://127.0.0.1:4197`, covering
  public registration, login, user management, repository/credential identity
  proxy paths, task create/list/detail/tree, operating state/mode, boss
  decisions, escalations, cost budget, dashboard governance overview, task
  governance, and delete cleanup
- manual HTTP smoke for `/api/workbench/layout`, `/api/approvals`, `/api/governance/tasks/:taskId/summary`,
  `/api/tasks/:taskId/operating-runtime/{mode,boss-decisions,escalations}`,
  `/api/projects/:projectId/repositories`, `/api/projects/:projectId/runtime-usage-baselines`,
  and `/api/cost/budget`

| Area | Current Go Status | Remaining Work |
| --- | --- | --- |
| Auth + users | Implemented; service and BFF auth/user suites pass | Keep token/bcrypt/rate-limit contract covered |
| Org/project/project tree | Main CRUD, tree, links, task relation links pass | Continue edge-case route parity as BFF usage reveals it |
| Task/session/message/run reads | Session-first create/read/message/tree/timeline/execution-trace/runs and phase create/view/adopt/pause/resume/cancel pass current service coverage | Broaden route-shape tests when new BFF task views are added |
| Runtime usage/cost/dashboard | Runtime ledger, cost budget/records/detail, governance overview pass service and smoke coverage | Add deeper cost/dashboard aggregations only when product paths require them |
| Workflow/role/governance | Role conclusions, developer change requests, workflow templates/runs, approvals, task governance summary, workbench layout, operating-runtime mode/decisions/escalations pass current coverage | Add richer governance rule parity as governance UI expands |
| Test harness parity | Full `tests/service` is green against Go | Preserve this as the replacement gate |

## P0 Gate

Run the normal Go checks:

```bash
cd control-plane/service-go
go test ./...
```

Run the strict parity gate:

```bash
cd control-plane/service-go
GO_CONTROL_PLANE_REQUIRE_FULL_PARITY=1 go test ./...
```

The strict gate now passes. Unknown `/api/*` routes return the normal JSON 404 fallback instead of a generic 501.

## P1: Remaining Task Domain Parity

Implemented in Go and currently passing focused HTTP tests:

- session create, list, detail, activate, archive;
- canonical and runtime session message writes;
- deprecated message-route 410 responses;
- normalized conversation read;
- task tree/timeline/execution trace read models;
- task snapshots, timeline views, and projection replay;
- task run create/update/list and canonical run/operation/ledger side effects;
- task create-time relation expansion into `project_tree_links`.

Remaining task-domain work:

- any future BFF-only task read shape not covered by `tests/service`;
- keep phase-view/message ordering expectations in the service suite when behavior changes.

Primary tests:

- `tests/service/project-tree-routes.test.ts`
- `tests/service/task-session-*.test.ts`
- `tests/service/task-phase-*.test.ts`
- `tests/service/task-projection-*.test.ts`

## P2: Project Runtime And Cost

Implemented:

- repositories/credentials identity routes used by current tests and BFF proxy paths;
- project fund reserve/consume/refund compatibility;
- runtime usage ledgers sync/list/detail and runtime usage baseline lookup/derived fallback;
- task operating runtime state/mode plus boss decisions and human escalations;
- cost records, budget list/create/update, and detail basics.

Remaining:

- deeper cost filters and aggregations if BFF requires them.

Primary tests:

- `tests/service/project-fund-execution-routes.test.ts`
- `tests/service/runtime-usage-ledger.test.ts`
- `tests/service/task-operating-runtime-tree.test.ts`

## P3: Workflow, Role, Governance, Dashboard

Implemented:

- workflow templates/stages;
- task workflow read/retry/backfill;
- role conclusions;
- developer change requests;
- role agents, bindings, project overrides;
- dashboard governance overview;
- code changes;
- approvals list/detail/resolve;
- task governance summary and change evaluation smoke path;
- workbench layout get/put.

Remaining:

- governance rule-engine fidelity beyond the lightweight Go summary when product paths require it.

Primary tests:

- `tests/service/role-workflow-storage.test.ts`
- `tests/service/workflow-governance-pg-types.test.ts`
- `tests/service/dashboard-*.test.ts`

## P4: Switch Readiness

Before production switch:

- use the root scripts `dev:service-go`, `test:service-go`, `test:service-go:contract`, and `test:bff:go-smoke` as the repeatable switch gates;
- keep BFF smoke tests running with `CONTROL_PLANE_URL` pointing at Go;
- run UI login/project/task smoke manually through BFF;
- keep the existing Bun/TypeScript Control Plane available as rollback/reference code until production traffic has burned in.

## Next Implementation Queue

1. Keep any future paid-execution or governance persistence routes behind `tests/service` plus BFF smoke coverage.
2. Re-run `go test ./...`, strict parity gate, full `tests/service`, and BFF smoke before changing traffic routing.
3. After production traffic burns in, decide whether to retire the TypeScript service or keep it as a long-term reference implementation.
