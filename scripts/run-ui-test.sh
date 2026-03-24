#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if [[ $# -eq 0 ]]; then
  echo "Usage: bun run test:ui:file -- tests/web-ui/<file>.test.ts [more files or vitest flags]" >&2
  exit 1
fi

normalized_args=()
for arg in "$@"; do
  case "$arg" in
    tests/web-ui/*)
      normalized_args+=("../../$arg")
      ;;
    ./tests/web-ui/*)
      normalized_args+=("../../${arg#./}")
      ;;
    ../../tests/web-ui/*)
      normalized_args+=("$arg")
      ;;
    *)
      normalized_args+=("$arg")
      ;;
  esac
done

cd "$repo_root/control-plane/web-ui"
bun run test -- "${normalized_args[@]}"