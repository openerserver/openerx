#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${ROOT_DIR}/tmp/dev-logs"

mkdir -p "$LOG_DIR"

APP_PORT="${APP_PORT:-4098}"
UI_PORT="${UI_PORT:-5173}"
RUNTIME_PORT="${RUNTIME_PORT:-4096}"
UI_DEV_SERVER_URL="${UI_DEV_SERVER_URL:-http://127.0.0.1:${UI_PORT}}"
OPENCODE_BIN="${OPENCODE_BIN:-/Users/wanglei/.opencode/bin/opencode}"

kill_port() {
  local port="$1"
  local pids

  pids="$(lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

wait_for_http() {
  local name="$1"
  local url="$2"

  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name ready: $url"
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for $name at $url" >&2
  return 1
}

start_app() {
  local log_file="$LOG_DIR/app.log"

  kill_port "$APP_PORT"
  (
    cd "$ROOT_DIR/control-plane/app"
    UI_DEV_SERVER_URL="$UI_DEV_SERVER_URL" exec bun run dev
  ) >"$log_file" 2>&1 &

  echo $! >"$LOG_DIR/app.pid"
  wait_for_http "app" "http://127.0.0.1:${APP_PORT}/health/live"
}

start_runtime() {
  local log_file="$LOG_DIR/opencode-runtime.log"

  kill_port "$RUNTIME_PORT"
  (
    cd "$ROOT_DIR"
    exec "$OPENCODE_BIN" serve --hostname 127.0.0.1 --port "$RUNTIME_PORT" --print-logs
  ) >"$log_file" 2>&1 &

  echo $! >"$LOG_DIR/opencode-runtime.pid"
  wait_for_http "runtime" "http://127.0.0.1:${RUNTIME_PORT}/session"
}

start_web_ui() {
  local log_file="$LOG_DIR/web-ui.log"

  kill_port "$UI_PORT"

  local fallback_pids
  fallback_pids="$(lsof -ti tcp:5174 -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$fallback_pids" ]]; then
    kill $fallback_pids 2>/dev/null || true
    sleep 1
  fi

  (
    cd "$ROOT_DIR/control-plane/web-ui"
    VITE_APP_PORT="$APP_PORT" exec bun run dev --host 127.0.0.1 --port "$UI_PORT"
  ) >"$log_file" 2>&1 &

  echo $! >"$LOG_DIR/web-ui.pid"
  wait_for_http "web-ui" "http://127.0.0.1:${UI_PORT}"
}

echo "Logs: $LOG_DIR"
echo "Starting app, runtime, web-ui..."

start_runtime
start_app
start_web_ui

cat <<EOF
Started successfully.

Commands used:
1. cd control-plane/app && UI_DEV_SERVER_URL=${UI_DEV_SERVER_URL} bun run dev
2. ${OPENCODE_BIN} serve --hostname 127.0.0.1 --port ${RUNTIME_PORT} --print-logs
3. cd control-plane/web-ui && VITE_APP_PORT=${APP_PORT} bun run dev --host 127.0.0.1 --port ${UI_PORT}

Endpoints:
- Web UI: http://127.0.0.1:${UI_PORT}
- App: http://127.0.0.1:${APP_PORT}
- Runtime: http://127.0.0.1:${RUNTIME_PORT}
EOF