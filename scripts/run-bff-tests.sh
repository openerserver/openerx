#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failed_files=()
live_test_files=(
  "tests/web-ui-bff/auth-registration.test.ts"
  "tests/web-ui-bff/hooks-integration.test.ts"
  "tests/web-ui-bff/identity-binding.test.ts"
  "tests/web-ui-bff/user-management.test.ts"
  "tests/web-ui-bff/workflow-evaluation.test.ts"
)

is_live_test_file() {
  local rel_path="$1"
  local live_file
  for live_file in "${live_test_files[@]}"; do
    if [[ "$rel_path" == "$live_file" ]]; then
      return 0
    fi
  done
  return 1
}

while IFS= read -r file; do
  rel_path="${file#"$ROOT_DIR/"}"
  if [[ "${RUN_BFF_LIVE_TESTS:-0}" != "1" ]] && is_live_test_file "$rel_path"; then
    echo "==> $rel_path (skipped; set RUN_BFF_LIVE_TESTS=1 to include live BFF tests)"
    continue
  fi

  echo "==> $rel_path"
  if ! (
    cd "$ROOT_DIR/control-plane/web-ui-bff"
    bun test "../../$rel_path" --timeout 120000
  ); then
    failed_files+=("$rel_path")
  fi
done < <(find "$ROOT_DIR/tests/web-ui-bff" -maxdepth 1 -name '*.test.ts' | sort)

if ((${#failed_files[@]} > 0)); then
  echo
  echo "BFF test failures:"
  for file in "${failed_files[@]}"; do
    echo "- $file"
  done
  exit 1
fi
