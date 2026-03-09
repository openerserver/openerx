#!/usr/bin/env bash
# 72h post-upgrade health check for OpenCode v1.2.22
# Run: bash infra/vm/health-check.sh
# Use with: watch -n 300 bash infra/vm/health-check.sh  (every 5 min)
set -euo pipefail

OPENCODE_URL="${OPENCODE_URL:-http://127.0.0.1:4096}"
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

check "OpenCode serve"     "$OPENCODE_URL/session"  "200" || ((failures++))
check "Control Plane"      "$CP_URL/health"          "200" || ((failures++))
check "BFF"                "$BFF_URL/health"         "200" || ((failures++))

# SSE connectivity test
sse_ok=$(timeout 3 curl -s -N "$OPENCODE_URL/global/event" 2>/dev/null | head -1 | grep -c "server.connected" || true)
if [[ "$sse_ok" -ge 1 ]]; then
  echo "$(ts) OK   SSE event stream (server.connected received)" | tee -a "$LOG_FILE"
else
  echo "$(ts) FAIL SSE event stream (no server.connected within 3s)" | tee -a "$LOG_FILE"
  ((failures++))
fi

# Version check
version=$(curl -s "$OPENCODE_URL/session" 2>/dev/null | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ "$version" == "1.2.22" ]]; then
  echo "$(ts) OK   Version check ($version)" | tee -a "$LOG_FILE"
else
  echo "$(ts) WARN Version mismatch (got: ${version:-none}, expected: 1.2.22)" | tee -a "$LOG_FILE"
fi

if [[ $failures -gt 0 ]]; then
  echo "$(ts) *** $failures CHECK(S) FAILED — consider rollback: bash infra/vm/rollback.sh ***" | tee -a "$LOG_FILE"
  exit 1
else
  echo "$(ts) All checks passed" | tee -a "$LOG_FILE"
fi
