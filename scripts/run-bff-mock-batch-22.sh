#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

files=(
  "tests/web-ui-bff/runtime-pipeline.test.ts"
  "tests/web-ui-bff/task-completion-routes.test.ts"
  "tests/web-ui-bff/task-operating-routes.test.ts"
  "tests/web-ui-bff/task-sessions-route.test.ts"
  "tests/web-ui-bff/task-workflow-view-route.test.ts"
  "tests/web-ui-bff/task-execution-trace-route.test.ts"
  "tests/web-ui-bff/realtime-routes.test.ts"
  "tests/web-ui-bff/judge-usage-accounting.test.ts"
  "tests/web-ui-bff/task-runtime-permissions-route.test.ts"
  "tests/web-ui-bff/agent-control-terminate-route.test.ts"
  "tests/web-ui-bff/project-tree-proxy-routes.test.ts"
  "tests/web-ui-bff/chat-settings-assistant-engine.test.ts"
  "tests/web-ui-bff/stage-intervention.test.ts"
  "tests/web-ui-bff/task-finalize.test.ts"
  "tests/web-ui-bff/workflow-stage-execution.test.ts"
  "tests/web-ui-bff/workflow-sync.test.ts"
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
echo "BFF mock batch 22 summary: total=${#files[@]} failed=${#failed_files[@]}"

if ((${#failed_files[@]} > 0)); then
  echo "BFF mock batch 22 failures:"
  for rel_path in "${failed_files[@]}"; do
    echo "- $rel_path"
  done
  exit 1
fi

echo "BFF mock batch 22 passed"