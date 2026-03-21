#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failed_files=()

while IFS= read -r file; do
  rel_path="${file#"$ROOT_DIR/"}"
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