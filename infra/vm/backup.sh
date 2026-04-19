#!/usr/bin/env bash
# Opener-X Backup Script
# Backs up the PostgreSQL database and configuration
set -euo pipefail

BACKUP_DIR="/opt/openerx/backups"
ENV_FILE="/opt/openerx/.env"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/openerx_backup_$TIMESTAMP.tar.gz"
DB_DUMP_FILE="$BACKUP_DIR/openerx_backup_$TIMESTAMP.dump"

mkdir -p "$BACKUP_DIR"

echo "=== Opener-X Backup: $TIMESTAMP ==="

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL must be set in /opt/openerx/.env}"

# 1. PostgreSQL logical backup
pg_dump --format=custom --file="$DB_DUMP_FILE" "$DATABASE_URL"

# 2. Create tarball
tar -czf "$BACKUP_FILE" \
  -C "$BACKUP_DIR" \
  "$(basename "$DB_DUMP_FILE")" \
  -C /opt/openerx \
  .env

# 3. Cleanup temp backup
rm -f "$DB_DUMP_FILE"

# 4. Retain last 30 backups
ls -t "$BACKUP_DIR"/openerx_backup_*.tar.gz | tail -n +31 | xargs -r rm -f

echo "Backup saved: $BACKUP_FILE"
echo "Size: $(du -h "$BACKUP_FILE" | cut -f1)"
