#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROL_PLANE_URL="${TEST_CP_URL:-http://127.0.0.1:4097}"
READY_CHECK_URL="${CONTROL_PLANE_URL%/}/health/ready"

export DATABASE_DIALECT="${DATABASE_DIALECT:-postgres}"
export DATABASE_URL="${DATABASE_URL:-postgres://127.0.0.1:5432/openerx}"

files=(
  "tests/service/legacy-role-workflow-storage.test.ts"
  "tests/service/project-task-relations.test.ts"
  "tests/service/project-tree-routes.test.ts"
  "tests/service/project-tree-storage.test.ts"
  "tests/service/role-workflow-storage.test.ts"
  "tests/service/task-aggregate-sync.test.ts"
  "tests/service/task-branch-write.test.ts"
  "tests/service/task-conversation-session-sync.test.ts"
  "tests/service/task-operating-runtime-tree.test.ts"
  "tests/service/task-projection-read.test.ts"
  "tests/service/task-projection-routes.test.ts"
  "tests/service/task-route-assembly.test.ts"
  "tests/service/task-route-registrar.test.ts"
  "tests/service/task-route-registration-smoke.test.ts"
  "tests/service/task-run-write-sync.test.ts"
  "tests/service/task-session-message-api.test.ts"
  "tests/service/task-session-message-runtime-sync.test.ts"
  "tests/service/task-session-message-write-api.test.ts"
  "tests/service/task-session-read.test.ts"
  "tests/service/task-snapshot-read.test.ts"
  "tests/service/tree-task-aggregations.test.ts"
)

failed_files=()
preflight_failure=""

check_control_plane_ready() {
  local target="$1"
  local response_body
  local status

  response_body="$(mktemp)"
  status="$(curl --max-time 5 -s -o "$response_body" -w '%{http_code}' "$READY_CHECK_URL" || true)"

  if [[ "$status" == "200" ]]; then
    rm -f "$response_body"
    return 0
  fi

  echo "Control-plane service preflight failed before $target: GET $READY_CHECK_URL => ${status:-curl-error}" >&2
  if [[ -s "$response_body" ]]; then
    cat "$response_body" >&2
    echo >&2
  fi
  rm -f "$response_body"
  echo "Hint: run restart-control-plane-service, then retry this batch." >&2
  return 1
}

for rel_path in "${files[@]}"; do
  echo "==> $rel_path"
  if ! check_control_plane_ready "$rel_path"; then
    preflight_failure="$rel_path"
    break
  fi
  if ! (
    cd "$ROOT_DIR"
    bun test "$rel_path" --timeout 120000
  ); then
    failed_files+=("$rel_path")
  fi
done

echo
echo "Service task-domain current batch summary: total=${#files[@]} failed=${#failed_files[@]}"

if [[ -n "$preflight_failure" ]]; then
  echo "Service task-domain current batch aborted: control-plane service was not ready before $preflight_failure"
  exit 2
fi

if (( ${#failed_files[@]} > 0 )); then
  echo "Service task-domain current batch failures:"
  for rel_path in "${failed_files[@]}"; do
    echo "- $rel_path"
  done
  exit 1
fi

echo "Service task-domain current batch passed"