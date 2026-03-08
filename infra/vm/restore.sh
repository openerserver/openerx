#!/usr/bin/env bash
# OpenerX Restore Script
# Restores from a backup tarball
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-file.tar.gz>"
  echo ""
  echo "Available backups:"
  ls -lt /opt/openerx/backups/openerx_backup_*.tar.gz 2>/dev/null | head -10
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "=== OpenerX Restore ==="
echo "Backup: $BACKUP_FILE"
echo ""
echo "WARNING: This will overwrite the current database!"
read -p "Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# 1. Stop services
echo "Stopping services..."
systemctl stop openerx-bff openerx-control-plane 2>/dev/null || true

# 2. Extract backup
echo "Extracting backup..."
tar -xzf "$BACKUP_FILE" -C /opt/openerx

# 3. Restore database
mv /opt/openerx/data/openerx_backup.db /opt/openerx/data/openerx.db

# 4. Fix permissions
chown -R openerx:openerx /opt/openerx/data

# 5. Restart services
echo "Starting services..."
systemctl start openerx-control-plane openerx-bff

echo "Restore complete."
