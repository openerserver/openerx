#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE_LOG="$(mktemp -t openerx-service.XXXXXX.log)"
BFF_LOG="$(mktemp -t openerx-bff.XXXXXX.log)"
SERVICE_PID=""
BFF_PID=""
STARTED_SERVICE=0
STARTED_BFF=0

cleanup() {
  local exit_code=$?

  if [[ "$STARTED_BFF" -eq 1 && -n "$BFF_PID" ]]; then
    kill "$BFF_PID" 2>/dev/null || true
    wait "$BFF_PID" 2>/dev/null || true
  fi

  if [[ "$STARTED_SERVICE" -eq 1 && -n "$SERVICE_PID" ]]; then
    kill "$SERVICE_PID" 2>/dev/null || true
    wait "$SERVICE_PID" 2>/dev/null || true
  fi

  if [[ "$exit_code" -ne 0 ]]; then
    echo
    echo "Control Plane log tail:"
    tail -n 40 "$SERVICE_LOG" 2>/dev/null || true
    echo
    echo "BFF log tail:"
    tail -n 40 "$BFF_LOG" 2>/dev/null || true
  fi

  rm -f "$SERVICE_LOG" "$BFF_LOG"
  exit "$exit_code"
}

trap cleanup EXIT

wait_for_http() {
  local name="$1"
  local url="$2"

  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for $name at $url" >&2
  return 1
}

ensure_service() {
  local name="$1"
  local url="$2"
  local workdir="$3"
  local logfile="$4"
  local pid_var="$5"
  local started_var="$6"

  if curl -fsS "$url" >/dev/null 2>&1; then
    echo "$name already running at $url"
    return 0
  fi

  echo "Starting $name..."
  (
    cd "$workdir"
    bun run dev
  ) >"$logfile" 2>&1 &

  local pid=$!
  printf -v "$pid_var" '%s' "$pid"
  printf -v "$started_var" '%s' 1

  wait_for_http "$name" "$url"
}

echo "Running lint..."
bun run lint

echo "Running type checks..."
bun run typecheck

ensure_service \
  "Control Plane" \
  "http://127.0.0.1:4097/health" \
  "$ROOT_DIR/control-plane/service" \
  "$SERVICE_LOG" \
  SERVICE_PID \
  STARTED_SERVICE

ensure_service \
  "BFF" \
  "http://127.0.0.1:4098/health" \
  "$ROOT_DIR/control-plane/web-ui-bff" \
  "$BFF_LOG" \
  BFF_PID \
  STARTED_BFF

echo "Running default test suites..."
bun run test:all