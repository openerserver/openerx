#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${1:-$ROOT_DIR/tmp/skillhub-skills}"
TARGET_DIR="${2:-$ROOT_DIR/opencode-fork/.opencode/skills}"
MODE="${SYNC_MODE:-skip}"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

copied=0
skipped=0

while IFS= read -r skill_md; do
  skill_dir="$(dirname "$skill_md")"
  slug="$(basename "$skill_dir")"
  dest_dir="$TARGET_DIR/$slug"

  if [[ -e "$dest_dir" && "$MODE" != "overwrite" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  rm -rf "$dest_dir"
  mkdir -p "$dest_dir"
  cp "$skill_md" "$dest_dir/SKILL.md"

  if [[ -f "$skill_dir/mcp.json" ]]; then
    cp "$skill_dir/mcp.json" "$dest_dir/mcp.json"
  fi

  copied=$((copied + 1))
done < <(find "$SOURCE_DIR" -mindepth 3 -maxdepth 3 -type f -name "SKILL.md" | sort)

echo "copied=$copied skipped=$skipped target=$TARGET_DIR"