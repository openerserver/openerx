#!/usr/bin/env bash
# Opener-X Backup Script
# Backs up the SQLite database and configuration
set -euo pipefail

BACKUP_DIR="/opt/openerx/backups"
DATA_DIR="/opt/openerx/data"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/openerx_backup_$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "=== Opener-X Backup: $TIMESTAMP ==="

# 1. SQLite hot backup (using .backup command for consistency)
sqlite3 "$DATA_DIR/openerx.db" ".backup '$DATA_DIR/openerx_backup.db'"

# 2. Create tarball
tar -czf "$BACKUP_FILE" \
  -C /opt/openerx \
  data/openerx_backup.db \
  .env \
  opencode-fork/opencode.json \
  opencode-fork/.opencode/

# 3. Cleanup temp backup
rm -f "$DATA_DIR/openerx_backup.db"

# 4. Retain last 30 backups
ls -t "$BACKUP_DIR"/openerx_backup_*.tar.gz | tail -n +31 | xargs -r rm -f

echo "Backup saved: $BACKUP_FILE"
echo "Size: $(du -h "$BACKUP_FILE" | cut -f1)"
