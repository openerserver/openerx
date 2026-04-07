#!/usr/bin/env bash
# Opener-X health check
# Run: bash infra/vm/health-check.sh
# Use with: watch -n 300 bash infra/vm/health-check.sh  (every 5 min)
set -euo pipefail

BFF_URL="${BFF_URL:-http://127.0.0.1:4098}"
CP_URL="${CP_URL:-http://127.0.0.1:4097}"
LOG_FILE="${LOG_FILE:-/tmp/openerx-health.log}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

check() {
  local name="$1" url="$2" expect="$3"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "$url" 2>/dev/null || echo "000")
  if [[ "$status" == "$expect" ]]; then
    echo "$(ts) OK   $name (HTTP $status)" | tee -a "$LOG_FILE"
  else
    echo "$(ts) FAIL $name (HTTP $status, expected $expect)" | tee -a "$LOG_FILE"
    return 1
  fi
}

echo "--- Health Check $(ts) ---" | tee -a "$LOG_FILE"

failures=0

check "Control Plane"      "$CP_URL/health"          "200" || ((failures++))
check "BFF"                "$BFF_URL/health"         "200" || ((failures++))

if [[ $failures -gt 0 ]]; then
  echo "$(ts) *** $failures CHECK(S) FAILED ***" | tee -a "$LOG_FILE"
  exit 1
else
  echo "$(ts) All checks passed" | tee -a "$LOG_FILE"
fi
