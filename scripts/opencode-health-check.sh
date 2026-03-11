#!/bin/bash
# OpenCode 运行时巡检脚本
# 用法: bash scripts/opencode-health-check.sh

set -euo pipefail

SNAP_DIR="$HOME/.local/share/opencode/snapshot"
DB="$HOME/.local/share/opencode/opencode.db"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "========== OpenCode Health Check =========="
echo ""

# 1. Snapshot 磁盘占用
echo "--- Snapshot Disk ---"
if [ -d "$SNAP_DIR" ]; then
  SNAP_SIZE_KB=$(du -sk "$SNAP_DIR" | awk '{print $1}')
  SNAP_SIZE_HUMAN=$(du -sh "$SNAP_DIR" | awk '{print $1}')
  if [ "$SNAP_SIZE_KB" -gt 5242880 ]; then
    echo -e "${RED}[CRITICAL] ${SNAP_SIZE_HUMAN} — 超过 5GB，建议立即清理${NC}"
  elif [ "$SNAP_SIZE_KB" -gt 2097152 ]; then
    echo -e "${YELLOW}[WARNING]  ${SNAP_SIZE_HUMAN} — 超过 2GB，建议保守清理${NC}"
  else
    echo -e "${GREEN}[OK]       ${SNAP_SIZE_HUMAN}${NC}"
  fi
else
  echo "(snapshot 目录不存在)"
fi

# 2. DB 体积
echo ""
echo "--- Database ---"
if [ -f "$DB" ]; then
  DB_SIZE_KB=$(du -sk "$DB" | awk '{print $1}')
  DB_SIZE_HUMAN=$(du -sh "$DB" | awk '{print $1}')
  SESSIONS=$(sqlite3 "$DB" "SELECT count(*) FROM session;" 2>/dev/null || echo "?")
  if [ "$DB_SIZE_KB" -gt 102400 ]; then
    echo -e "${YELLOW}[WARNING]  ${DB_SIZE_HUMAN} (${SESSIONS} sessions) — 超过 100MB${NC}"
  else
    echo -e "${GREEN}[OK]       ${DB_SIZE_HUMAN} (${SESSIONS} sessions)${NC}"
  fi
else
  echo "(数据库不存在)"
fi

# 3. opencode 进程
echo ""
echo "--- Process ---"
OC_PID=$(pgrep -f 'opencode serve' 2>/dev/null | head -1 || true)
if [ -n "$OC_PID" ]; then
  RSS_KB=$(ps -o rss= -p "$OC_PID" 2>/dev/null | tr -d ' ')
  RSS_MB=$((RSS_KB / 1024))
  if [ "$RSS_MB" -gt 1024 ]; then
    echo -e "${RED}[CRITICAL] PID ${OC_PID}, RSS ${RSS_MB}MB — 超过 1GB${NC}"
  else
    echo -e "${GREEN}[OK]       PID ${OC_PID}, RSS ${RSS_MB}MB${NC}"
  fi
else
  echo -e "${YELLOW}[INFO]     opencode 未运行${NC}"
fi

# 4. git pack-objects
echo ""
echo "--- Git Subprocess ---"
PACK_PID=$(pgrep -f pack-objects 2>/dev/null | head -1 || true)
if [ -n "$PACK_PID" ]; then
  PACK_RSS_KB=$(ps -o rss= -p "$PACK_PID" 2>/dev/null | tr -d ' ')
  PACK_RSS_MB=$((PACK_RSS_KB / 1024))
  echo -e "${RED}[WARNING]  git pack-objects running (PID ${PACK_PID}, RSS ${PACK_RSS_MB}MB)${NC}"
else
  echo -e "${GREEN}[OK]       无 git pack-objects 子进程${NC}"
fi

echo ""
echo "==========================================="
