#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

files=(
  "tests/web-ui-bff/task-finalize.test.ts"
  "tests/web-ui-bff/workflow-stage-execution.test.ts"
  "tests/web-ui-bff/project-paid-execution-preflight-route.test.ts"
  "tests/web-ui-bff/project-runtime-usage-ledger-routes.test.ts"
  "tests/web-ui-bff/runtime-usage-ledger-project-e2e.test.ts"
  "tests/web-ui-bff/realtime-pipeline-events.test.ts"
  "tests/web-ui-bff/project-execution-trace-route.test.ts"
)

failed_files=()

for rel_path in "${files[@]}"; do
  echo "==> $rel_path"
  if ! (
    cd "$ROOT_DIR/control-plane/web-ui-bff"
    bun test "../../$rel_path" --timeout 120000
  ); then
    failed_files+=("$rel_path")
  fi
done

echo
echo "BFF stable mock batch 8 summary: total=${#files[@]} failed=${#failed_files[@]}"

if ((${#failed_files[@]} > 0)); then
  echo "BFF stable mock batch 8 failures:"
  for rel_path in "${failed_files[@]}"; do
    echo "- $rel_path"
  done
  exit 1
fi

echo "BFF stable mock batch 8 passed"