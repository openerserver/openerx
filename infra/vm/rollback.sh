#!/usr/bin/env bash
# Opener-X Rollback Script
# Rolls back to the previous deployment version
set -euo pipefail

DEPLOY_DIR="/opt/openerx"
RELEASES_DIR="$DEPLOY_DIR/releases"
CURRENT_LINK="$DEPLOY_DIR/current"

if [ ! -d "$RELEASES_DIR" ]; then
  echo "Error: No releases directory found at $RELEASES_DIR"
  exit 1
fi

# Find the previous release
CURRENT=$(readlink -f "$CURRENT_LINK" 2>/dev/null || echo "none")
RELEASES=($(ls -t "$RELEASES_DIR" | head -5))

if [ ${#RELEASES[@]} -lt 2 ]; then
  echo "Error: Not enough releases to rollback"
  echo "Current: $CURRENT"
  exit 1
fi

# Select the release before current
ROLLBACK_TO=""
for release in "${RELEASES[@]}"; do
  if [ "$RELEASES_DIR/$release" != "$CURRENT" ]; then
    ROLLBACK_TO="$release"
    break
  fi
done

if [ -z "$ROLLBACK_TO" ]; then
  echo "Error: Could not determine rollback target"
  exit 1
fi

echo "=== Opener-X Rollback ==="
echo "Current: $(basename "$CURRENT")"
echo "Rolling back to: $ROLLBACK_TO"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# 1. Stop services
echo "Stopping services..."
systemctl stop openerx-bff openerx-control-plane 2>/dev/null || true

# 2. Switch symlink
ln -sfn "$RELEASES_DIR/$ROLLBACK_TO" "$CURRENT_LINK"

# 3. Restart
echo "Starting services..."
systemctl start openerx-control-plane openerx-bff

echo "Rollback complete. Now running: $ROLLBACK_TO"
