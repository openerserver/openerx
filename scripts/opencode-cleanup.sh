#!/bin/bash
# OpenCode Snapshot 清理脚本
# 用法: bash scripts/opencode-cleanup.sh [--force]
#   --force  跳过确认直接执行（用于 CI/自动化场景）

set -euo pipefail

SNAP_DIR="$HOME/.local/share/opencode/snapshot"
DB="$HOME/.local/share/opencode/opencode.db"
FORCE="${1:-}"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

confirm() {
  if [ "$FORCE" = "--force" ]; then return 0; fi
  echo -ne "${YELLOW}$1 [y/N] ${NC}"
  read -r answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ]
}

echo "========== OpenCode Cleanup =========="
echo ""

# 检查当前状态
SNAP_SIZE_KB=0
if [ -d "$SNAP_DIR" ]; then
  SNAP_SIZE_KB=$(du -sk "$SNAP_DIR" | awk '{print $1}')
  SNAP_SIZE_HUMAN=$(du -sh "$SNAP_DIR" | awk '{print $1}')
  echo "Snapshot: ${SNAP_SIZE_HUMAN}"
else
  echo "Snapshot: (不存在)"
fi

DB_SIZE_KB=0
if [ -f "$DB" ]; then
  DB_SIZE_KB=$(du -sk "$DB" | awk '{print $1}')
  DB_SIZE_HUMAN=$(du -sh "$DB" | awk '{print $1}')
  SESSIONS=$(sqlite3 "$DB" "SELECT count(*) FROM session;" 2>/dev/null || echo "?")
  echo "Database: ${DB_SIZE_HUMAN} (${SESSIONS} sessions)"
else
  echo "Database: (不存在)"
fi

echo ""

# 判断清理级别
if [ "$SNAP_SIZE_KB" -lt 2097152 ] && [ "$DB_SIZE_KB" -lt 102400 ]; then
  echo -e "${GREEN}当前状态健康，无需清理。${NC}"
  echo "  Snapshot < 2GB, DB < 100MB"
  exit 0
fi

# === 保守清理: 删除 7 天前的会话 ===
if [ "$DB_SIZE_KB" -gt 102400 ] || [ "$SNAP_SIZE_KB" -gt 2097152 ]; then
  OLD_SESSIONS=$(sqlite3 "$DB" "SELECT count(*) FROM session WHERE createdAt < datetime('now', '-7 days');" 2>/dev/null || echo "0")
  echo -e "${YELLOW}发现 ${OLD_SESSIONS} 个超过 7 天的历史会话${NC}"

  if [ "$OLD_SESSIONS" -gt 0 ] && confirm "清理这些历史会话？"; then
    echo "备份数据库..."
    cp "$DB" "$DB.bak-$(date +%Y%m%d-%H%M%S)"

    echo "清理中..."
    sqlite3 "$DB" <<'SQL'
BEGIN;
DELETE FROM part WHERE messageID IN (
  SELECT id FROM message WHERE sessionID IN (
    SELECT id FROM session WHERE createdAt < datetime('now', '-7 days')
  )
);
DELETE FROM message WHERE sessionID IN (
  SELECT id FROM session WHERE createdAt < datetime('now', '-7 days')
);
DELETE FROM session WHERE createdAt < datetime('now', '-7 days');
COMMIT;
VACUUM;
SQL
    NEW_SESSIONS=$(sqlite3 "$DB" "SELECT count(*) FROM session;" 2>/dev/null)
    NEW_DB_SIZE=$(du -sh "$DB" | awk '{print $1}')
    echo -e "${GREEN}完成：剩余 ${NEW_SESSIONS} sessions，DB ${NEW_DB_SIZE}${NC}"
  fi
fi

# === 快速清理: 删除整个 snapshot 目录 ===
if [ "$SNAP_SIZE_KB" -gt 5242880 ]; then
  echo ""
  echo -e "${RED}Snapshot 超过 5GB，建议删除整个 snapshot 目录${NC}"

  if confirm "停止 opencode 并删除 snapshot？"; then
    echo "停止 opencode..."
    kill "$(pgrep -f 'opencode serve')" 2>/dev/null || true
    sleep 2

    echo "删除 snapshot..."
    rm -rf "$SNAP_DIR"

    echo -e "${GREEN}完成。请手动重启 opencode。${NC}"
  fi
elif [ "$SNAP_SIZE_KB" -gt 2097152 ]; then
  echo ""
  echo -e "${YELLOW}Snapshot 超过 2GB 但未达 5GB${NC}"
  echo "历史会话已清理，snapshot 体积会在下次 gc 后自然下降。"
  echo "如仍需彻底清理，请手动运行: rm -rf $SNAP_DIR"
fi

echo ""
echo "======================================="
