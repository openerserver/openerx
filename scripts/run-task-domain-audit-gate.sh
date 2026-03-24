#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TASK_DOMAIN_AUDIT_ENABLED="${TASK_DOMAIN_AUDIT_ENABLED:-1}"
TASK_DOMAIN_AUDIT_DIALECT="${TASK_DOMAIN_AUDIT_DIALECT:-${DATABASE_DIALECT:-postgres}}"
TASK_DOMAIN_AUDIT_LIMIT="${TASK_DOMAIN_AUDIT_LIMIT:-200}"
TASK_DOMAIN_AUDIT_PROJECT_ID="${TASK_DOMAIN_AUDIT_PROJECT_ID:-proj-default}"
TASK_DOMAIN_AUDIT_TASK_ID="${TASK_DOMAIN_AUDIT_TASK_ID:-}"
TASK_DOMAIN_AUDIT_JSON_OUTPUT="${TASK_DOMAIN_AUDIT_JSON_OUTPUT:-$ROOT_DIR/tmp/task-domain-audit/report.json}"

if [[ "$TASK_DOMAIN_AUDIT_ENABLED" != "1" ]]; then
  echo "[task-domain-audit-gate] skipped because TASK_DOMAIN_AUDIT_ENABLED=$TASK_DOMAIN_AUDIT_ENABLED"
  exit 0
fi

if [[ "$TASK_DOMAIN_AUDIT_DIALECT" != "postgres" ]]; then
  echo "[task-domain-audit-gate] skipped because DATABASE_DIALECT=$TASK_DOMAIN_AUDIT_DIALECT"
  exit 0
fi

audit_args=(--fail-on-mismatch --limit "$TASK_DOMAIN_AUDIT_LIMIT")

if [[ -n "$TASK_DOMAIN_AUDIT_JSON_OUTPUT" ]]; then
  mkdir -p "$(dirname "$TASK_DOMAIN_AUDIT_JSON_OUTPUT")"
  audit_args+=(--json-output "$TASK_DOMAIN_AUDIT_JSON_OUTPUT")
fi

if [[ -n "$TASK_DOMAIN_AUDIT_TASK_ID" ]]; then
  audit_args+=(--task-id "$TASK_DOMAIN_AUDIT_TASK_ID")
else
  audit_args+=(--project-id "$TASK_DOMAIN_AUDIT_PROJECT_ID")
fi

echo "[task-domain-audit-gate] running audit with scope: ${audit_args[*]}"
bun run db:audit:task-domain -- "${audit_args[@]}"
if [[ -n "$TASK_DOMAIN_AUDIT_JSON_OUTPUT" ]]; then
  echo "[task-domain-audit-gate] json report: $TASK_DOMAIN_AUDIT_JSON_OUTPUT"
fi
echo "[task-domain-audit-gate] passed"